import GlobalState from "../GlobalState.js";

/**
 * How many channel slots this radio has.
 *
 * Everything that reads, writes or clears channel slots used to stop at 16, in
 * four separate places, while both bench radios report **40** and the one list
 * reads all of them. A channel the operator put in slot 16 or above was therefore
 * invisible to station modes and missing from the backup — so "the radio exactly
 * as it was" quietly did not include it. Nothing cleared it either, which is the
 * only reason it never lost anybody a channel.
 *
 * The count comes from the radio: `CMD_DEVICE_QUERY` carries `MAX_GROUP_CHANNELS`
 * as the second of the bytes `meshcore.js` files under "reserved". Asking is
 * cheap, but not free, so the answer is held for as long as the connection lasts
 * and forgotten with it.
 *
 * A radio that will not say gets the fallback below rather than a guess at 40:
 * writing past a radio's real end is answered with an error, which the channel
 * read already counts as "past the end" rather than as a hole.
 */
class Slots {

    /** What the firmware has shipped for years, and what the bench radios report. */
    static DEFAULT = 40;

    /** No radio answers fewer than this, and the mode profiles were built on it. */
    static FLOOR = 16;

    static cached = null;
    static cachedFor = null;

    /**
     * The slot count to work to. Never throws: a radio that will not answer is a
     * radio to get on with, not one to stop for.
     */
    static async count() {

        const connection = GlobalState.connection;
        if(connection == null){
            return this.DEFAULT;
        }

        if(this.cached != null && this.cachedFor === connection){
            return this.cached;
        }

        const Connection = (await import("../Connection.js")).default;
        let reported = null;
        try {
            reported = await Connection.channelSlotCount();
        } catch(e) {
            reported = null;
        }

        const count = Math.max(this.FLOOR, reported ?? this.DEFAULT);
        this.cached = count;
        this.cachedFor = connection;
        return count;

    }

    /** Forgotten with the radio it was read from. */
    static forget() {
        this.cached = null;
        this.cachedFor = null;
    }

}

export default Slots;
