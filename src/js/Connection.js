import GlobalState from "./GlobalState.js";
import {Constants, WebBleConnection, WebSerialConnection} from "@liamcottle/meshcore.js";
import Database from "./Database.js";
import Utils from "./Utils.js";
import NotificationUtils from "./NotificationUtils.js";

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
