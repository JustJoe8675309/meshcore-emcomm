import GlobalState from "./GlobalState.js";
import {Constants, WebBleConnection, WebSerialConnection} from "@liamcottle/meshcore.js";
import Database from "./Database.js";
import Utils from "./Utils.js";
import NotificationUtils from "./NotificationUtils.js";
import Position from "./reports/Position.js";

class Connection {

    // enable to log raw tx/rx bytes to console
    static log = false;

    static async connectViaBluetooth() {
        try {
            await this.connect(await WebBleConnection.open(), "bluetooth");
            return true;
        } catch(e) {

            console.log(e);

            // ignore device not selected error
            if(e.name === "NotFoundError"){
                return false;
            }

            // show error message
            alert("failed to connect to ble device!");

            return false;

        }
    }

    static async connectViaSerial() {
        try {
            await this.connect(await WebSerialConnection.open(), "serial");
            return true;
        } catch(e) {

            console.log(e);

            // ignore device not selected error
            if(e.name === "NotFoundError"){
                return false;
            }

            // show error message
            alert("failed to connect to serial device!");

            return false;

        }
    }

    static async connect(connection, transport = null) {

        // do nothing if connection not provided
        if(!connection){
            return;
        }

        // clear previous connection state
        GlobalState.selfInfo = null;
        GlobalState.contacts = [];
        GlobalState.channels = [];
        GlobalState.batteryPercentage = null;

        // update connection and listen for events
        GlobalState.connection = connection;
        GlobalState.connectionTransport = transport;
        GlobalState.connection.on("connected", () => this.onConnected());
        GlobalState.connection.on("disconnected", () => this.onDisconnected());

        // meshcore.js waits forever for a device that never answers, both in its own
        // onConnected handshake and in getSelfInfo, so the ui would sit on "connecting"
        // with no way back. fail loudly instead.
        this.startConnectionWatchdog();

    }

    // how long to wait for the device to identify itself before giving up
    static CONNECTION_TIMEOUT_MILLIS = 15000;

    static startConnectionWatchdog() {

        this.clearConnectionWatchdog();

        GlobalState.connectionWatchdog = setTimeout(async () => {

            // the device identified itself in time, nothing to do
            if(GlobalState.selfInfo){
                return;
            }

            await this.disconnect();

            alert(this.getNoResponseMessage());

        }, this.CONNECTION_TIMEOUT_MILLIS);

    }

    // the advice differs by transport, and giving serial advice for a bluetooth
    // failure sends people looking in entirely the wrong place
    static getNoResponseMessage() {

        const base = "The device did not respond. Check that it is running MeshCore Companion Radio firmware";

        if(GlobalState.connectionTransport === "bluetooth"){
            return `${base}, built with Bluetooth support. If the device is paired but not responding, reset it. A Bluetooth link that dropped uncleanly can leave the device unable to accept a new connection until it restarts.`;
        }

        if(GlobalState.connectionTransport === "serial"){
            return `${base}, built with USB support. The Bluetooth only builds do not answer over serial. Also check that no other program is using the serial port.`;
        }

        return `${base}, and that it is not already connected to another app.`;

    }

    static clearConnectionWatchdog() {
        clearTimeout(GlobalState.connectionWatchdog);
        GlobalState.connectionWatchdog = null;
    }

    static async disconnect() {

        // disconnect
        GlobalState.connection?.close();

        // update ui
        GlobalState.connection = null;

        // clear previous connection timers
        clearInterval(GlobalState.batteryPercentageInterval);
        GlobalState.batteryPercentageInterval = null;
        this.clearConnectionWatchdog();
        GlobalState.connectionTransport = null;

        // the next device connected may be a different radio entirely
        GlobalState.gpsStatus = "unknown";

    }

    static async onConnected() {

        // weird way to allow us to lock all other callbacks from doing anything, until the database is ready...
        // maybe we should use some sort of lock or mutex etc.
        // basically, we need to wait for SelfInfo to be fetched before we can init the database.
        // we use this to create a new database instance that is unique based on the devices public key.
        // initDatabase is async, which means all the other callbacks could fire before the database is ready
        // this means when we try to access the database when it isn't ready yet, we get fun errors...
        // so we need to force the callbacks to wait until the database is ready
        // we will just resolve this promise when the database is ready, and all the callbacks should be set to await it
        var onDatabaseReady = null;
        const databaseToBeReady = new Promise((resolve) => {
            onDatabaseReady = resolve;
        });

        // log raw tx bytes if enabled
        GlobalState.connection.on("tx", async (data) => {
            if(this.log){
                console.log("tx", data);
            }
        });

        // log raw rx bytes if enabled
        GlobalState.connection.on("rx", async (data) => {
            if(this.log){
                console.log("rx", data);
            }
        });

        // listen for self info, and then init database
        GlobalState.connection.once(Constants.ResponseCodes.SelfInfo, async (selfInfo) => {
            await Database.initDatabase(Utils.bytesToHex(selfInfo.publicKey));
            onDatabaseReady();
        });

        // listen for adverts
        GlobalState.connection.on(Constants.PushCodes.Advert, async () => {
            console.log("Advert");
            await databaseToBeReady;
            await this.loadContacts();
        });

        // listen for path updates
        GlobalState.connection.on(Constants.PushCodes.PathUpdated, async (event) => {
            console.log("PathUpdated", event);
            await databaseToBeReady;
            await this.loadContacts();
        });

        // listen for new message available event
        GlobalState.connection.on(Constants.PushCodes.MsgWaiting, async () => {
            console.log("MsgWaiting");
            await databaseToBeReady;
            await this.syncMessages();
        });

        // listen for message send confirmed events
        GlobalState.connection.on(Constants.PushCodes.SendConfirmed, async (event) => {
            console.log("SendConfirmed", event);
            await databaseToBeReady;
            await Database.Message.setMessageDeliveredByAckCode(event.ackCode, event.roundTrip);
        });

        // initial setup without needing database
        await this.loadSelfInfo();
        await this.syncDeviceTime();

        // wait for database to be ready
        await databaseToBeReady;

        // fetch data after database is ready
        await this.loadContacts();
        await this.loadChannels();
        await this.syncMessages();
        await this.updateBatteryPercentage();

        // auto update battery percentage once per minute
        GlobalState.batteryPercentageInterval = setInterval(async () => {
            await this.updateBatteryPercentage();
        }, 60000);

        // find out whether the position this device reports is a live fix. deliberately
        // not awaited: it takes eight seconds and nothing else needs to wait for it
        this.probeForLiveGps();

    }

    static async onDisconnected() {
        await this.disconnect();
    }

    static async loadSelfInfo() {

        GlobalState.selfInfo = await GlobalState.connection.getSelfInfo(this.CONNECTION_TIMEOUT_MILLIS);

        // device answered, so the watchdog no longer needs to fire
        this.clearConnectionWatchdog();

    }

    static async loadContacts() {
        GlobalState.contacts = await GlobalState.connection.getContacts();
    }

    // used when the device can't tell us which channels it has configured
    static get defaultChannels() {
        return [
            {
                idx: 0,
                name: "Public Channel",
                description: "This is the default public channel.",
            },
        ];
    }

    static async loadChannels() {

        // ask the device which channels it has configured.
        // older firmware doesn't support this command and may never reply,
        // so this is guarded by a timeout and falls back to the public channel.
        try {

            const channels = await Utils.withTimeout(GlobalState.connection.getChannels(), 10000);

            // unused channel slots come back with an empty name, so skip those.
            // the rest of the app identifies a channel by "idx", so normalise "channelIdx" here.
            const configuredChannels = channels
                .filter((channel) => channel.name != null && channel.name.trim() !== "")
                .map((channel) => {
                    return {
                        idx: channel.channelIdx,
                        name: channel.name,
                        secret: channel.secret,
                    };
                });

            if(configuredChannels.length > 0){
                GlobalState.channels = configuredChannels;
                return;
            }

        } catch(e) {
            console.log("failed to load channels from device, falling back to default channels", e);
        }

        GlobalState.channels = this.defaultChannels;

    }

    static async updateBatteryPercentage() {
        if(GlobalState.connection){
            try {
                const response = await GlobalState.connection.getBatteryVoltage();
                GlobalState.batteryPercentage = Utils.getBatteryPercentage(response.batteryMilliVolts);
            } catch(e) {
                // ignore error
            }
        }
    }

    static async deviceQuery(appTargetVer = 1) {
        return await GlobalState.connection.deviceQuery(appTargetVer);
    }

    static async setAdvertName(name) {
        await GlobalState.connection.setAdvertName(name);
    }

    static async setAdvertLatLong(latitude, longitude) {
        await GlobalState.connection.setAdvertLatLong(latitude, longitude);
    }

    static async setTxPower(txPower) {
        await GlobalState.connection.setTxPower(txPower);
    }

    static async setRadioParams(radioFreq, radioBw, radioSf, radioCr) {
        await GlobalState.connection.setRadioParams(radioFreq, radioBw, radioSf, radioCr);
    }

    static async syncDeviceTime() {
        const timestamp = Math.floor(Date.now() / 1000);
        await GlobalState.connection.sendCommandSetDeviceTime(timestamp);
    }

    static async resetContactPath(publicKey) {
        await GlobalState.connection.sendCommandResetPath(publicKey);
    }

    static async removeContact(publicKey) {
        await GlobalState.connection.sendCommandRemoveContact(publicKey);
    }

    static async shareContact(publicKey) {
        await GlobalState.connection.shareContact(publicKey);
    }

    static async exportContact(publicKey) {
        return await GlobalState.connection.exportContact(publicKey);
    }

    /**
     * The device's own position, freshly queried.
     *
     * Deliberately re-queries rather than reading the selfInfo cached at connect
     * time: a station that has moved since it connected would otherwise report
     * where it used to be, which is the one thing a position must never do.
     *
     * This does return a live fix, which was worth confirming rather than assuming,
     * since the same field holds a manually set position on a node without GPS.
     * Polling a stationary Heltec V4 gave 31.926964, 31.926963, 31.926962, 31.926960,
     * 31.926959 over 24 seconds: half a metre of receiver wander. A stored constant
     * would have repeated exactly. At the four decimal places a report carries, all
     * five round to the same value, so the jitter costs nothing.
     *
     * Returns null when the device has no usable position, so the caller can say
     * so rather than writing a plausible looking wrong one into a report.
     */
    static async getPosition(timeoutMillis = 5000) {

        const selfInfo = await Utils.withTimeout(GlobalState.connection.getSelfInfo(), timeoutMillis);

        return Position.fromDevice(selfInfo.advLat, selfInfo.advLon);

    }

    /**
     * How many times the probe below reads the position, and how far apart.
     *
     * Five reads two seconds apart span eight seconds, which is long enough that a
     * receiver holding still will still have wandered in its lowest digits.
     */
    static GPS_PROBE_READS = 5;
    static GPS_PROBE_INTERVAL_MILLIS = 2000;

    /**
     * Works out whether the device is serving a live GPS fix.
     *
     * MeshCore exposes one position for the local device and nothing that says where
     * it came from. On a node with GPS it is the live fix; on a node without, it is
     * whatever was typed into Settings, possibly while parked somewhere else months
     * ago. Nothing in the protocol distinguishes them: the board string names the
     * board, not the sensor, and there is no capability flag to read.
     *
     * So it is measured. A live receiver wanders by a metre or so even standing
     * still, which shows up in the sixth decimal; a stored constant repeats exactly.
     * If any read differs from the first, the fix is live and that is certain.
     *
     * The converse is not certain, which is why this returns a verdict rather than a
     * fact: five identical reads are good evidence of no GPS, but an unusually steady
     * fix would look the same. Callers should treat "unconfirmed" as "do not trust
     * this position to be current", not as "this radio has no GPS".
     */
    static async probeForLiveGps() {

        GlobalState.gpsStatus = "checking";

        try {

            var first = null;

            for(let i = 0; i < this.GPS_PROBE_READS; i++){

                if(i > 0){
                    await Utils.sleep(this.GPS_PROBE_INTERVAL_MILLIS);
                }

                // the device may go away underneath us mid probe
                if(GlobalState.connection == null){
                    GlobalState.gpsStatus = "unknown";
                    return;
                }

                const selfInfo = await Utils.withTimeout(GlobalState.connection.getSelfInfo(), 5000);
                const reading = `${selfInfo.advLat},${selfInfo.advLon}`;

                // a device with no position at all cannot demonstrate anything
                if(Position.fromDevice(selfInfo.advLat, selfInfo.advLon) === null){
                    GlobalState.gpsStatus = "unconfirmed";
                    return;
                }

                if(first === null){
                    first = reading;
                } else if(reading !== first){
                    // it moved, so it is live, and there is nothing left to prove
                    GlobalState.gpsStatus = "live";
                    return;
                }

            }

            GlobalState.gpsStatus = "unconfirmed";

        } catch(e) {
            console.log("gps probe failed", e);
            GlobalState.gpsStatus = "unconfirmed";
        }

    }

    /**
     * Sends one zero hop trace to a contact and reports what came back.
     *
     * This is the measurement behind the ping tab. A trace goes out and returns
     * along the same hop, so the reply carries the signal to noise ratio measured
     * at each end: how well they heard us, and how well we heard them. Those two
     * numbers are often very different, and a link that works in one direction
     * only is exactly the failure worth finding before an incident rather than
     * during one.
     *
     * Zero hop on purpose. It tests the direct path to that station rather than
     * whatever route the mesh might find, which is the thing an operator needs to
     * know, and it does not ask every repeater in range to relay a test.
     *
     * Throws on timeout, which the caller records as a lost packet.
     */
    static async pingContact(publicKey, extraTimeoutMillis = 0) {

        const startedAt = performance.now();

        // the first byte of their public key is the whole path for a single hop
        const reply = await GlobalState.connection.tracePath([publicKey[0]], extraTimeoutMillis);

        const timeMillis = Math.round(performance.now() - startedAt);

        // snrs arrive as signed bytes in quarter dB steps
        const toSnr = (byte) => new Int8Array([byte])[0] / 4;

        return {
            // how well the far end heard us, measured there
            snrThere: toSnr((reply.pathSnrs ?? [])[0] ?? 0),
            // how well we heard the reply, measured here
            snrBack: reply.lastSnr,
            timeMillis: timeMillis,
        };

    }

    /**
     * Asks every repeater in direct range to identify itself.
     *
     * This is the discovery the official app performs, and it is not an advert.
     * Adverts announce us and draw no reply; discovery is a separate control packet
     * with its own request and response, and repeaters answer it specifically.
     *
     * meshcore.js 1.15.0 implements neither side, so both are assembled by hand
     * here: the command byte 55 is missing from its command list, which jumps 54 to
     * 56, and the 0x8E push code arrives as an unhandled frame it only logs. Both
     * are marked v8+ in the firmware, so an older device will answer with an error
     * rather than a response.
     *
     * Sent zero hop, which is the point: it finds the repeaters this station can
     * actually work directly, including ones that have not adverted since we came
     * into range and are therefore invisible to the contact list.
     *
     * Each reply carries two signal readings, which is what makes it worth more
     * than a ping: the responder reports how well it heard us, and our own radio
     * reports how well we heard the reply.
     */
    static async discoverRepeaters(listenMillis = 30000) {

        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error("not connected");
        }

        // repeaters answer only if the filter names their type
        const ADV_TYPE_REPEATER = 2;
        const CTL_DISCOVER_REQ = 0x80;
        const CTL_DISCOVER_RESP = 0x90;
        const PUSH_CONTROL_DATA = 0x8E;
        const CMD_SEND_CONTROL_DATA = 55;

        // the tag comes back in every reply, so responses to an earlier run, or to
        // somebody else's run, are not counted as ours
        const tag = new Uint8Array(4);
        crypto.getRandomValues(tag);

        const request = new Uint8Array([
            CMD_SEND_CONTROL_DATA,          // the frame is a command; the control payload follows it
            CTL_DISCOVER_REQ,               // prefix_only left clear, so replies carry the full key
            1 << ADV_TYPE_REPEATER,
            ...tag,
            0, 0, 0, 0,                     // since: no cutoff, answer regardless of age
        ]);

        const found = new Map();

        const onFrame = (frame) => {

            const bytes = new Uint8Array(frame);

            // [push code, our snr, rssi, path len, ...control payload]
            if(bytes.length < 11 || bytes[0] !== PUSH_CONTROL_DATA){
                return;
            }

            const payload = bytes.subarray(4);
            if((payload[0] & 0xF0) !== CTL_DISCOVER_RESP){
                return;
            }

            // not our request
            for(let i = 0; i < 4; i++){
                if(payload[2 + i] !== tag[i]){
                    return;
                }
            }

            const publicKey = payload.subarray(6);
            const publicKeyHex = Utils.bytesToHex(publicKey);

            // a repeater can answer more than once; keep the first
            if(found.has(publicKeyHex)){
                return;
            }

            found.set(publicKeyHex, {
                publicKey: publicKey,
                publicKeyHex: publicKeyHex,
                nodeType: payload[0] & 0x0F,
                // both readings are signed bytes in quarter dB steps
                snrThere: new Int8Array([payload[1]])[0] / 4,
                snrBack: new Int8Array([bytes[1]])[0] / 4,
                rssi: new Int8Array([bytes[2]])[0],
                pathLen: bytes[3],
            });

        };

        connection.on("rx", onFrame);

        try {
            await connection.sendToRadioFrame(request);
            // replies are spread over a random widened delay, since many nodes may
            // answer at once, so this listens rather than waiting for one response
            await Utils.sleep(listenMillis);
        } finally {
            connection.off("rx", onFrame);
        }

        return [...found.values()];

    }

    /**
     * Saves a repeater found by discovery as a contact.
     *
     * Discovery gives us the public key and the node type but no name, because
     * DISCOVER_RESP does not carry one. So the contact is created with a name built
     * from the key, which the device replaces with the real one the first time the
     * repeater adverts. Better a placeholder that can be pinged now than nothing
     * until the repeater happens to announce itself.
     *
     * The path is recorded as zero hop, which is not a guess: it answered a zero hop
     * discovery, so that is exactly how far away it is.
     */
    static async addDiscoveredRepeater(discovered) {

        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error("not connected");
        }

        const name = `Repeater ${discovered.publicKeyHex.slice(0, 6)}`;

        await connection.addOrUpdateContact(
            discovered.publicKey,
            discovered.nodeType,
            0,                              // flags
            0,                              // outPathLen: reached directly
            new Uint8Array(64),             // outPath: empty, nothing to relay through
            name,
            Math.floor(Date.now() / 1000),  // heard just now, which is why we are here
            0,                              // advLat, unknown until it adverts
            0,                              // advLon
        );

        await this.loadContacts();

        return name;

    }

    static async sendMessage(publicKey, text) {

        // send message
        const message = await GlobalState.connection.sendTextMessage(publicKey, text);

        // save to database
        const databaseMessage = await Database.Message.insert({
            status: "sending",
            to: publicKey,
            from: GlobalState.selfInfo.publicKey,
            path_len: null,
            txt_type: Constants.TxtTypes.Plain,
            sender_timestamp: Date.now(),
            text: text,
            timestamp: Date.now(),
            expected_ack_crc: message.expectedAckCrc,
            send_type: message.result,
            error: null,
        });

        // mark message as failed after estimated timeout
        setTimeout(async () => {
            await Database.Message.setMessageFailedById(databaseMessage.id, "timeout");
        }, message.estTimeout);

        // a caller sending a report in parts has to wait for this one to be acknowledged
        // before sending the next, so hand back what it takes to do that
        return {
            id: databaseMessage.id,
            estTimeout: message.estTimeout,
        };

    }

    // how often to check whether a direct message has been acknowledged
    static DELIVERY_POLL_MILLIS = 250;

    // how long to keep waiting past the firmware's own estimate, so that the timeout
    // marking has a chance to land and we report the real status rather than our own
    static DELIVERY_GRACE_MILLIS = 2000;

    /**
     * How many times to retransmit a part that was not acknowledged, before stopping
     * and asking the operator.
     *
     * Bounded on purpose. A transient collision clears in an attempt or two, but past
     * that the other station is off, out of range, or the channel is congested, and
     * transmitting into that helps nobody while occupying air everyone shares. The
     * device does its own retries underneath each of these, within the timeout it
     * reports back, so the real number of transmissions is higher than this.
     */
    static MAX_PART_RETRIES = 3;

    /**
     * Gap before the nth retry, growing so a congested channel is given room to clear
     * rather than being hit again immediately.
     */
    static retryBackoffMillis(attempt) {
        return 2000 * Math.pow(2, attempt - 1);
    }

    /**
     * Waits for a direct message to be acknowledged, and returns its final status.
     *
     * Direct messages are acknowledged one at a time. The device tracks a single
     * outstanding message, so transmitting the next part before this one resolves
     * loses it: proven on the air, where part 2 sent two seconds behind part 1 never
     * arrived, and the identical part delivered when sent on its own.
     *
     * Channel messages are not acknowledged at all, so this does not apply to them.
     */
    static async waitForDelivery(messageId, timeoutMillis) {

        const deadline = Date.now() + timeoutMillis;

        while(Date.now() < deadline){

            const message = await Database.Message.getMessageById(messageId);

            // the row is gone, so there is nothing left to wait for
            if(!message){
                return "missing";
            }

            if(message.status !== "sending"){
                return message.status;
            }

            await Utils.sleep(this.DELIVERY_POLL_MILLIS);

        }

        return "timeout";

    }

    static async sendChannelMessage(channelIdx, text) {

        // send message
        await GlobalState.connection.sendChannelTextMessage(channelIdx, text);

        // save to database
        await Database.ChannelMessage.insert({
            channel_idx: channelIdx,
            from: GlobalState.selfInfo.publicKey,
            path_len: null,
            txt_type: Constants.TxtTypes.Plain,
            sender_timestamp: Date.now(),
            text: text,
        });

    }

    static async syncMessages() {
        while(true){

            // sync messages until no more returned
            const message = await GlobalState.connection.syncNextMessage();
            if(!message){
                break;
            }

            // handle received message
            if(message.contactMessage){
                await this.onContactMessageReceived(message.contactMessage);
            } else if(message.channelMessage) {
                await this.onChannelMessageReceived(message.channelMessage);
            }

        }
    }

    static async reboot() {
        await GlobalState.connection.reboot();
    }

    static async onContactMessageReceived(message) {

        console.log("onContactMessageReceived", message);

        // find first contact that matches this public key prefix
        // todo, maybe use the most recently updated contact in case of collision? ideally we should be given the full hash by firmware anyway...
        const contact = GlobalState.contacts.find((contact) => {
            const messagePublicKeyPrefix = message.pubKeyPrefix;
            const contactPublicKeyPrefix = contact.publicKey.slice(0, message.pubKeyPrefix.length);
            return Utils.isUint8ArrayEqual(messagePublicKeyPrefix, contactPublicKeyPrefix);
        });

        // ensure contact exists
        // shouldn't be possible to receive a message if firmware doesn't have the contact, since keys will be missing for decryption
        // however, it could be possible that the contact doesn't exist in javascript memory when the message is received
        if(!contact){
            console.log("couldn't find contact, received message has been dropped");
            return;
        }

        // save message to database
        await Database.Message.insert({
            status: "received",
            to: GlobalState.selfInfo.publicKey,
            from: contact.publicKey,
            path_len: message.pathLen,
            txt_type: message.txtType,
            sender_timestamp: message.senderTimestamp,
            text: message.text,
            expected_ack_crc: null,
            error: null,
        });

        // show notification
        await NotificationUtils.showNewMessageNotification(contact, message.text);

    }

    static async onChannelMessageReceived(message) {

        console.log("onChannelMessageReceived", message);

        // save message to database
        await Database.ChannelMessage.insert({
            channel_idx: message.channelIdx,
            from: null,
            path_len: message.pathLen,
            txt_type: message.txtType,
            sender_timestamp: message.senderTimestamp,
            text: message.text,
        });

    }

}

export default Connection;
