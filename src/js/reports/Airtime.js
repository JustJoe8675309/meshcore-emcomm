/**
 * Estimates how long a report will actually occupy the channel.
 *
 * Airtime matters on an emergency net. A long report split into many packets can
 * hold the channel for minutes, and the operator should see that before keying up
 * rather than after.
 *
 * The packet sizes mirror how the firmware builds a datagram, and the time on air
 * is the standard Semtech LoRa calculation that RadioLib's getTimeOnAir() performs.
 * It is an estimate: it does not include retransmission by repeaters, CAD backoff,
 * or contention with other stations, so real occupancy is the floor given here.
 */
class Airtime {

    // MeshCore uses a longer preamble than the LoRa default of 8 symbols.
    // preambleLengthForSF() in src/helpers/radiolib/RadioLibWrappers.h
    static getPreambleSymbols(sf) {
        return sf <= 8 ? 32 : 16;
    }

    /**
     * Bytes actually transmitted for one part, mirroring the firmware.
     *
     * Channel messages are group datagrams: one channel hash, then the encrypted
     * payload. Direct messages carry a destination and a source hash instead.
     * Both encrypt a 4 byte timestamp plus a type byte ahead of the text, pad up to
     * the cipher block size, and append a 2 byte MAC.
     */
    static getPacketBytes(textBytes, destinationType, nodeName) {

        const isContact = destinationType === "contact";

        // the firmware prepends "<sender name>: " to channel messages only
        const prefixBytes = isContact
            ? 0
            : new TextEncoder().encode(`${nodeName ?? ""}: `).length;

        // 4 byte timestamp + 1 byte txt type / attempt, then the text
        const dataBytes = 5 + prefixBytes + textBytes;

        // encryptThenMAC pads to the cipher block size and appends a MAC
        const encryptedBytes = Math.ceil(dataBytes / 16) * 16 + 2;

        // group datagrams carry one channel hash, direct datagrams carry two
        const hashBytes = isContact ? 2 : 1;

        // 2 byte packet header, with no path bytes while the packet is flooded
        return 2 + hashBytes + encryptedBytes;

    }

    /**
     * Standard LoRa time on air for a payload, in milliseconds.
     * Explicit header, CRC enabled, which is what the firmware uses.
     */
    static getTimeOnAirMillis(packetBytes, radio) {

        const sf = radio.sf;
        const symbolTimeMillis = (Math.pow(2, sf) / radio.bandwidthHz) * 1000;

        // radiolib turns on low data rate optimisation once a symbol exceeds 16ms
        const lowDataRateOptimise = symbolTimeMillis > 16 ? 1 : 0;

        // the device reports 5 to 8, meaning 4/5 to 4/8
        const codingRate = radio.codingRate - 4;

        const preambleSymbols = this.getPreambleSymbols(sf) + 4.25;

        const numerator = (8 * packetBytes) - (4 * sf) + 28 + 16;
        const denominator = 4 * (sf - (2 * lowDataRateOptimise));
        const payloadSymbols = 8 + Math.max(Math.ceil(numerator / denominator) * (codingRate + 4), 0);

        return (preambleSymbols + payloadSymbols) * symbolTimeMillis;

    }

    /**
     * Reads the radio settings the device reported, or null if they are unavailable.
     */
    static getRadioFromSelfInfo(selfInfo) {

        if(!selfInfo || !selfInfo.radioSf || !selfInfo.radioBw || !selfInfo.radioCr){
            return null;
        }

        return {
            sf: selfInfo.radioSf,
            // already in Hz, e.g. 62500 is the 62.5 kHz option in settings
            bandwidthHz: selfInfo.radioBw,
            codingRate: selfInfo.radioCr,
        };

    }

    // How many airtimes of the longest part to leave between channel parts. The
    // radio answers Ok when it has queued a part, before it transmits: that takes
    // one airtime. A repeater then waits a random 0 to 2.5 airtimes before passing a
    // flood packet on (getRetransmitDelay: 5 x airtime x tx_delay_factor 0.5) and
    // spends one more sending it, so 3.5 per hop. Two hops of repeats: 1 + 3.5 + 3.5
    static FLOOD_GAP_AIRTIMES = 8;

    /**
     * The gap to leave between the parts of a channel report: long enough for the
     * repeats of one part to clear before the next goes out, and never under
     * floorMillis. Rounded up to a whole second. The floor alone when the radio
     * settings are not known.
     */
    static channelPartGapMillis(parts, nodeName, selfInfo, floorMillis) {

        const radio = this.getRadioFromSelfInfo(selfInfo);
        if(!radio || !parts || parts.length === 0){
            return floorMillis;
        }

        const encoder = new TextEncoder();
        const longestMillis = Math.max(...parts.map((part) => {
            const packetBytes = this.getPacketBytes(encoder.encode(part).length, "channel", nodeName);
            return this.getTimeOnAirMillis(packetBytes, radio);
        }));

        const gapMillis = Math.ceil((longestMillis * this.FLOOD_GAP_AIRTIMES) / 1000) * 1000;
        return Math.max(floorMillis, gapMillis);

    }

    /**
     * Total estimate for a whole report, including the gaps between parts.
     * Returns null when the radio settings are not known.
     */
    static estimate(parts, destinationType, nodeName, selfInfo, gapMillis) {

        const radio = this.getRadioFromSelfInfo(selfInfo);
        if(!radio || !parts || parts.length === 0){
            return null;
        }

        const encoder = new TextEncoder();

        const transmitMillis = parts.reduce((total, part) => {
            const packetBytes = this.getPacketBytes(encoder.encode(part).length, destinationType, nodeName);
            return total + this.getTimeOnAirMillis(packetBytes, radio);
        }, 0);

        // the pauses we insert between parts are part of how long this ties up the operator
        const gapTotalMillis = Math.max(parts.length - 1, 0) * gapMillis;

        return {
            partCount: parts.length,
            transmitMillis: transmitMillis,
            totalMillis: transmitMillis + gapTotalMillis,
        };

    }

    /**
     * Human readable duration, e.g. "0.6 s" or "3 min 24 s".
     */
    static formatDuration(millis) {

        const seconds = millis / 1000;

        if(seconds < 10){
            return `${seconds.toFixed(1)} s`;
        }

        if(seconds < 60){
            return `${Math.round(seconds)} s`;
        }

        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.round(seconds - (minutes * 60));

        return `${minutes} min ${remainingSeconds} s`;

    }

}

export default Airtime;
