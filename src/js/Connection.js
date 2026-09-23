import GlobalState from "./GlobalState.js";
import { toRaw } from "vue";
import {Constants, WebBleConnection, WebSerialConnection} from "@liamcottle/meshcore.js";
import Database from "./Database.js";
import Utils from "./Utils.js";
import NotificationUtils from "./NotificationUtils.js";
import Position from "./reports/Position.js";
import ContactFlags from "./ContactFlags.js";
import SignedPosts from "./SignedPosts.js";
import RoomKeepAlive from "./rooms/RoomKeepAlive.js";
import AdvertSchedule from "./AdvertSchedule.js";
import { installResilientSerialReads } from "./SerialResilience.js";
import { Advert } from "@liamcottle/meshcore.js";
import Airtime from "./reports/Airtime.js";
import PositionService from "./position/PositionService.js";
import ModeProfiles from "./modes/ModeProfiles.js";

// before any connection exists: the serial read loop starts in its constructor
installResilientSerialReads();

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
        GlobalState.connecting = { step: "Opening the link..." };

        // update connection and listen for events
        GlobalState.connection = connection;
        this.serialiseFrames(connection);
        connection.on?.("recovered", () => this.onSerialRecovered(connection));
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

    // after a serial line error, how often and how many times to ask the radio
    // whether it is back: a reboot took a few seconds on the bench, so this
    // allows thirty
    static RECOVERY_RETRY_MILLIS = 2000;
    static RECOVERY_ATTEMPTS = 15;

    // one recovery at a time: a reboot can raise more than one line error
    static recovering = false;

    // releases a connection setup still waiting on its database; see onConnected
    static abandonConnect = null;

    /**
     * Puts the radio right after a restart: the serial read loop recovering from
     * a line error, or the app's own reboot command.
     *
     * The loop keeps reading through the error now, so the app no longer needs a
     * reconnect after the radio reboots, and a reconnect was what used to set the
     * radio's clock. On the bench node 1 came back from a reboot 656 seconds out,
     * with nothing in the app about to correct it, and every message it sent
     * would have carried the wrong time.
     *
     * So once the radio answers again, which is a few seconds into its reboot,
     * the clock is set and self info is read afresh.
     */
    static async onSerialRecovered(connection) {

        if(this.recovering){
            return;
        }
        this.recovering = true;

        try {
            for(let attempt = 0; attempt < this.RECOVERY_ATTEMPTS; attempt++){

                await Utils.sleep(this.RECOVERY_RETRY_MILLIS);

                // gone, or replaced by another radio, while we waited. Compared raw:
                // GlobalState is reactive, so reading it back gives a proxy that is
                // never identical to the connection it wraps
                if(toRaw(GlobalState.connection) !== toRaw(connection)){
                    return;
                }

                try {
                    await this.exclusive(() => connection.getDeviceTime(), this.READ_TIMEOUT_MILLIS);
                } catch(e) {
                    // still booting
                    continue;
                }

                await this.syncDeviceTime();
                await this.loadSelfInfo(this.READ_TIMEOUT_MILLIS);
                console.log("radio answering again after a restart; clock set");
                return;

            }
            console.log("radio did not answer after a restart; clock left as it was");
        } catch(e) {
            console.log("could not put the radio right after a restart", e);
        } finally {
            this.recovering = false;
        }

    }

    static startConnectionWatchdog() {

        // a new attempt is underway, so the previous failure is no longer the news
        GlobalState.connectionError = null;

        this.clearConnectionWatchdog();

        GlobalState.connectionWatchdog = setTimeout(async () => {

            // the device identified itself in time, nothing to do
            if(GlobalState.selfInfo){
                return;
            }

            await this.disconnect();

            // shown on the connect screen the disconnect above returns us to, rather
            // than in a modal that blocks the page until it is dismissed
            GlobalState.connectionError = this.getNoResponseMessage();

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
        GlobalState.connecting = null;

        // release a setup, and its listeners, still waiting on a database this
        // radio will now never open
        this.abandonConnect?.();
        this.abandonConnect = null;
        // room sessions live on the radio, so they do not survive it going away
        GlobalState.roomLogins = {};
        // and so do the keep-alives that hold them open
        RoomKeepAlive.stopAll();
        SignedPosts.forget();
        // position requests repeat through the radio that was connected
        PositionService.onDisconnected();

        // repeating adverts belong to the radio that was connected, not to the app
        AdvertSchedule.stop();

        // clear previous connection timers
        clearInterval(GlobalState.batteryPercentageInterval);
        GlobalState.batteryPercentageInterval = null;
        this.clearConnectionWatchdog();
        GlobalState.connectionTransport = null;

        // anything still queued was for the radio that just went, and must not
        // hold up the next one
        this.commandQueue = Promise.resolve();

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
        const databaseOpened = new Promise((resolve) => {
            onDatabaseReady = resolve;
        });

        // A radio disconnected before it identified itself never opens a database,
        // so everything waiting on one used to wait for ever: the rest of this
        // setup, and every listener below. Disconnecting now releases them, and
        // each checks that its connection is still the current one before doing
        // anything, since by then it may belong to a radio that has gone
        const connection = GlobalState.connection;
        // a setup for a radio that was replaced without a disconnect is released too
        this.abandonConnect?.();
        const abandoned = new Promise((resolve) => {
            this.abandonConnect = resolve;
        });
        const databaseToBeReady = Promise.race([databaseOpened, abandoned]);
        const isCurrent = () => toRaw(GlobalState.connection) === toRaw(connection);

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

        // adverts, path changes and evictions, each updating the one contact
        this.listenForContactChanges(GlobalState.connection, databaseToBeReady);

        // listen for new message available event
        GlobalState.connection.on(Constants.PushCodes.MsgWaiting, async () => {
            console.log("MsgWaiting");
            await databaseToBeReady;
            if(!isCurrent()){
                return;
            }
            await this.syncMessages();
        });

        // listen for message send confirmed events
        // read received message frames before meshcore.js decodes them: a room post
        // carries its author in four bytes that do not survive being run through a
        // UTF-8 decoder along with the text
        GlobalState.connection.on("rx", (frame) => SignedPosts.observe(frame));

        GlobalState.connection.on(Constants.PushCodes.SendConfirmed, async (event) => {
            console.log("SendConfirmed", event);
            await databaseToBeReady;
            if(!isCurrent()){
                return;
            }
            await Database.Message.setMessageDeliveredByAckCode(event.ackCode, event.roundTrip);
        });

        // each step says what it is doing, for the loading screen. only while this
        // connection is still the one being set up: a disconnect part way clears
        // the screen, and a late step must not bring it back
        const step = (text, done = null, total = null) => {
            if(isCurrent() && GlobalState.connecting != null){
                GlobalState.connecting = { step: text, done: done, total: total };
            }
        };

        try {

            // initial setup without needing database
            step("Waiting for the radio to answer...");
            await this.loadSelfInfo();
            step("Setting the radio's clock...");
            await this.syncDeviceTime();

            // started once self info is in, because the schedule is stored per node and
            // until now we did not know which node this is
            AdvertSchedule.start(Utils.bytesToHex(GlobalState.selfInfo.publicKey));

            // wait for database to be ready
            step("Opening this node's messages...");
            await databaseToBeReady;
            if(!isCurrent()){
                return;
            }

            // fetch data after database is ready. the contact list is most of the
            // wait, a couple of hundred frames on a well used node, so it is counted
            // a pass after the first is making sure none were dropped, and the count
            // sits at the total while it does, so it says so rather than look stuck
            step("Reading contacts...");
            await this.loadContacts((received, announced, pass) => {
                step(pass > 1 ? "Checking for dropped contacts..." : "Reading contacts...", received, announced);
            });
            step("Reading channels...");
            await this.loadChannels((slot, slots, found) => {
                step(`Reading channels... ${found} found`, slot, slots);
            });
            // the first time this app sees a node, its settings and channels as
            // they stand become its normal mode: the station as its owner had it.
            // Never guessed at, and never taken again by itself, since by then the
            // radio may be in an emcomm mode
            if(ModeProfiles.profile("normal") == null){
                step("Remembering this radio's own settings...");
                try {
                    await ModeProfiles.captureNormal();
                } catch(e) {
                    console.log("could not record the radio's normal mode", e);
                }
            }

            step("Reading waiting messages...");
            await this.syncMessages();
            step("Reading the battery...");
            await this.updateBatteryPercentage();

        } finally {
            if(isCurrent()){
                GlobalState.connecting = null;
            }
        }

        // once a minute: the battery, and the clock
        GlobalState.batteryPercentageInterval = setInterval(async () => {
            await this.periodicCheck();
        }, 60000);

        // find out whether the position this device reports is a live fix. deliberately
        // not awaited: it takes eight seconds and nothing else needs to wait for it
        this.probeForLiveGps();

    }

    static async onDisconnected() {
        await this.disconnect();
    }

    /**
     * Reads the radio's self info. The default bound is the connect one, which is
     * generous because a radio can be slow to answer straight after the link
     * opens; pages reading an already connected radio pass the read bound.
     */
    static async loadSelfInfo(timeoutMillis = this.CONNECTION_TIMEOUT_MILLIS) {

        GlobalState.selfInfo = await this.exclusive(() => GlobalState.connection.getSelfInfo(timeoutMillis), timeoutMillis);

        // device answered, so the watchdog no longer needs to fire
        this.clearConnectionWatchdog();

    }

    /**
     * One read of the contact list, bounded.
     *
     * `getContacts` in meshcore.js collects contacts until an `EndOfContacts`
     * frame arrives and waits for it with no timeout at all, so a dropped end
     * marker leaves the promise pending for ever. On Bluetooth that happened
     * mid way through an EMCOMM conversion: every contact had arrived, the end
     * marker had not, and the app sat waiting on a radio that was answering
     * everything else perfectly.
     *
     * So the frames are collected here instead. A read that never sees its end
     * marker returns what it did get, and the caller's merge loop asks again,
     * which is what it was already built to do for dropped contacts.
     */
    static async readContactsOnce(connection) {
        // the whole stream is one command: a contact frame arriving mid read is
        // exactly as much a reply as the end marker
        return await this.exclusive(
            () => this.readContactsStream(connection),
            this.CONTACT_READ_TIMEOUT_MILLIS + this.ACK_TIMEOUT_MILLIS,
        );
    }

    static async readContactsStream(connection) {

        const contacts = new Map();
        let ended = false;

        const onContact = (contact) => contacts.set(Utils.bytesToHex(contact.publicKey), contact);
        const onEnd = () => ended = true;

        connection.on(Constants.ResponseCodes.Contact, onContact);
        connection.on(Constants.ResponseCodes.EndOfContacts, onEnd);

        try {

            await connection.sendCommandGetContacts();

            const deadline = Date.now() + this.CONTACT_READ_TIMEOUT_MILLIS;
            let lastCount = -1;
            let quietSince = Date.now();

            while(!ended && Date.now() < deadline){

                await Utils.sleep(this.CONTACT_READ_POLL_MILLIS);

                // finish early when the frames have stopped coming: without the
                // end marker there is nothing else to wait for, and holding the
                // full timeout on every pass would make a lossy link crawl
                if(contacts.size !== lastCount){
                    lastCount = contacts.size;
                    quietSince = Date.now();
                } else if(contacts.size > 0 && Date.now() - quietSince > this.CONTACT_READ_QUIET_MILLIS){
                    break;
                }

            }

        } finally {
            connection.off(Constants.ResponseCodes.Contact, onContact);
            connection.off(Constants.ResponseCodes.EndOfContacts, onEnd);
        }

        return [...contacts.values()];

    }

    /**
     * Keeps the contact list current as the radio reports changes to it.
     *
     * Every advert the radio hears from a contact, and every path change, used to
     * re-read the entire list. On the bench that was 161 contacts, read twice over
     * Bluetooth because the first pass drops some, for one station's update. Once
     * device commands took turns, everything else waited behind it: the settings
     * page sat empty for twelve seconds after an advert arrived. On a busy mesh
     * during a net, adverts come often enough to keep the queue occupied.
     *
     * The notifications name the contact, so only that contact is fetched. What
     * the firmware sends, from its source and confirmed on the radio:
     *
     *   0x80  an advert from a contact the radio holds, including one it has just
     *         added. Public key only.
     *   0x81  the path to a contact changed. Public key only.
     *   0x8F  the radio evicted its oldest contact to make room. Public key only.
     *   0x8A  heard a station but did not add it (manual add, hop limit, or full).
     *         Not in the radio's list, so not in ours either; ignored as before.
     *
     * The eviction was invisible until now because the next full read dropped it.
     * With single updates nothing would, so it is removed here.
     */
    static listenForContactChanges(connection, ready = Promise.resolve()) {

        // after the wait, the radio this came from may have gone, and a refresh
        // would then ask whichever radio is connected now about a stranger
        const isCurrent = () => toRaw(GlobalState.connection) === toRaw(connection);

        connection.on(Constants.PushCodes.Advert, async (event) => {
            console.log("Advert");
            await ready;
            if(isCurrent()){
                await this.refreshContact(event.publicKey);
            }
        });

        connection.on(Constants.PushCodes.PathUpdated, async (event) => {
            console.log("PathUpdated", event);
            await ready;
            if(isCurrent()){
                await this.refreshContact(event.publicKey);
            }
        });

        // not parsed by meshcore.js, so read off the raw frame
        connection.on("rx", async (frame) => {
            const bytes = new Uint8Array(frame);
            if(bytes[0] === this.PUSH_CONTACT_DELETED && bytes.length >= 33){
                await ready;
                if(isCurrent()){
                    this.forgetContact(bytes.slice(1, 33));
                }
            }
        });

    }

    // CMD_GET_CONTACT_BY_KEY: [30, public key x 32], answered with one contact
    // frame, or ERR not found. Not in meshcore.js
    static CMD_GET_CONTACT_BY_KEY = 30;
    static PUSH_CONTACT_DELETED = 0x8F;

    /**
     * Fetches one contact from the radio and puts it in the list.
     *
     * Measured on the radio: 21 milliseconds, against the several seconds of a
     * full read. If the radio will not answer it, whether on older firmware
     * without the command, with a dropped reply, or for a contact it no longer
     * holds, this falls back to the full read, which is slow but always right.
     */
    static async refreshContact(publicKey) {

        const connection = GlobalState.connection;
        if(connection == null){
            return;
        }

        const key = new Uint8Array(publicKey);

        let reply = null;
        try {
            reply = await this.sendAwaiting(
                connection,
                () => connection.sendToRadioFrame(new Uint8Array([this.CMD_GET_CONTACT_BY_KEY, ...key])),
                [Constants.ResponseCodes.Contact, Constants.ResponseCodes.Err],
            );
        } catch(e) {
            console.log("could not fetch one contact", e);
        }

        const contact = reply?.code === Constants.ResponseCodes.Contact ? reply.data : null;

        // the key check is belt and braces: the queue means no other contact frame
        // can be in flight, but merging the wrong record over a contact would be
        // silent, and the full read costs nothing but time
        if(contact == null || !Utils.isUint8ArrayEqual(new Uint8Array(contact.publicKey), key)){
            // said, because a full read over Bluetooth is seconds of the queue, and
            // which of these it was decides whether anything can be done about it
            const why = reply?.code == null ? "no reply"
                : reply.code === Constants.ResponseCodes.Err ? "not found"
                : "a different contact came back";
            console.log(`one contact read failed (${why}), reading them all`);
            await this.loadContacts();
            return;
        }

        this.mergeContact(contact);

    }

    /** Replaces a contact in the list, or adds it if this is the first we have. */
    static mergeContact(contact) {

        const hex = Utils.bytesToHex(contact.publicKey);
        const contacts = [...GlobalState.contacts];
        const index = contacts.findIndex((c) => Utils.bytesToHex(c.publicKey) === hex);

        if(index >= 0){
            contacts[index] = contact;
        } else {
            contacts.push(contact);
            // the radio's own total went up by one, so the missing count stays true
            if(GlobalState.contactsAnnounced != null){
                GlobalState.contactsAnnounced += 1;
            }
        }

        GlobalState.contacts = contacts;
        this.updateContactsMissing();

    }

    /** Takes a contact the radio has evicted out of the list. */
    static forgetContact(publicKey) {

        const hex = Utils.bytesToHex(publicKey);
        GlobalState.contacts = GlobalState.contacts.filter((c) => Utils.bytesToHex(c.publicKey) !== hex);

        // the radio's total dropped whether or not we had it: it may have been one
        // of the contacts a lossy read never delivered
        if(GlobalState.contactsAnnounced != null){
            GlobalState.contactsAnnounced = Math.max(0, GlobalState.contactsAnnounced - 1);
        }

        this.updateContactsMissing();

    }

    static updateContactsMissing() {
        GlobalState.contactsMissing = GlobalState.contactsAnnounced == null
            ? 0
            : Math.max(0, GlobalState.contactsAnnounced - GlobalState.contacts.length);
    }

    // how long one contact read may take before it is abandoned and asked again
    static CONTACT_READ_TIMEOUT_MILLIS = 20000;
    static CONTACT_READ_POLL_MILLIS = 100;

    // how long without a new contact counts as the list having finished, when the
    // end marker never arrived
    static CONTACT_READ_QUIET_MILLIS = 1500;

    // onProgress, when given, hears how many different contacts have arrived so
    // far and how many the device said it would send
    // how many full reads are under way, to show when one starts on top of another
    static contactLoadsRunning = 0;

    static async loadContacts(onProgress = null) {

        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(this.DISCONNECTED);
        }

        // The device says how many contacts it is about to send, and meshcore.js
        // discards that number, resolving with whatever turned up before the end
        // marker. A truncated list is then indistinguishable from a short one: the
        // contacts tab simply shows fewer people and nothing suggests anyone is
        // missing, which on a roster of two hundred is not something an operator
        // can notice by eye.
        //
        // And they do go missing. A node holding 265 contacts over Bluetooth
        // delivered 252, then 259, then 258 on consecutive reads. Counting the raw
        // frames showed the shortfall is not this app or the library losing them:
        // only 258 ever arrived, all 258 were parsed, and none turned up after the
        // end marker. The notifications are dropped under the burst, and a
        // different few are dropped each time.
        //
        // Which is what makes re-reading worth it. This is a query to the attached
        // device, not a transmission, so it costs no airtime and nothing on the
        // mesh hears it. Merging passes by public key converges on the full list,
        // and a link that loses nothing pays for one pass. Measured on that node:
        // first passes of 240, 248, 250, 254 and 256 out of 265, every one of them
        // complete after two or three.
        //
        // The merged list can briefly run one over the announced count, because a
        // contact can advert, or be evicted, between passes. Harmless: the
        // shortfall below floors at zero, and the next load agrees with the device
        // again.
        let announced = null;
        let pass = 1;
        const onContactsStart = (start) => {
            announced = start?.count ?? null;
            onProgress?.(Math.min(seen.size, announced ?? seen.size), announced, pass);
        };
        connection.on(Constants.ResponseCodes.ContactsStart, onContactsStart);

        // counted by key across passes, so a second pass does not count up again
        const seen = new Set();
        const onContactSeen = (contact) => {
            seen.add(Utils.bytesToHex(contact.publicKey));
            onProgress?.(Math.min(seen.size, announced ?? seen.size), announced, pass);
        };
        if(onProgress){
            connection.on(Constants.ResponseCodes.Contact, onContactSeen);
        }

        const byPublicKey = new Map();
        let passes = 0;

        // two full reads at once take turns pass by pass and double the wait. It
        // looked to have happened on node 2 over Bluetooth, but the console's own
        // timestamps were too coarse to be sure, so it is said here when it does
        this.contactLoadsRunning++;
        if(this.contactLoadsRunning > 1){
            console.log(`contacts: a full read started while ${this.contactLoadsRunning - 1} other was running`);
        }

        try {

            for(let attempt = 0; attempt < this.MAX_CONTACT_LOAD_PASSES; attempt++){

                pass = attempt + 1;
                const before = byPublicKey.size;
                for(const contact of await this.readContactsOnce(connection)){
                    byPublicKey.set(Utils.bytesToHex(contact.publicKey), contact);
                }
                passes++;

                // got the lot, or the device never said how many to expect
                if(announced == null || byPublicKey.size >= announced){
                    break;
                }

                // a pass that added nobody will not be improved on by another
                if(byPublicKey.size === before){
                    break;
                }

            }

        } finally {
            this.contactLoadsRunning--;
            connection.off(Constants.ResponseCodes.ContactsStart, onContactsStart);
            connection.off(Constants.ResponseCodes.Contact, onContactSeen);
        }

        GlobalState.contacts = [...byPublicKey.values()];
        GlobalState.contactsAnnounced = announced;
        GlobalState.contactsMissing = announced == null
            ? 0
            : Math.max(0, announced - GlobalState.contacts.length);

        if(passes > 1){
            console.log(`contacts: ${GlobalState.contacts.length} of ${announced} after ${passes} passes`);
        }

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

    /**
     * How many channel slots the radio has, or null if it will not say. The
     * device info reply carries it as its third byte, which meshcore.js files
     * under "reserved": MAX_CONTACTS / 2, then MAX_GROUP_CHANNELS.
     */
    static async channelSlotCount() {
        try {
            const info = await this.deviceQuery();
            const slots = info?.reserved?.[1];
            return slots > 0 ? slots : null;
        } catch(e) {
            return null;
        }
    }

    // onProgress, when given, hears the slot being read, how many slots there are
    // (null if the radio would not say), and how many configured channels so far
    static async loadChannels(onProgress = null) {

        // ask the device which channels it has configured.
        // older firmware doesn't support this command and may never reply,
        // so this is guarded by a timeout and falls back to the public channel.
        try {

            const connection = GlobalState.connection;
            const slots = onProgress ? await this.channelSlotCount() : null;
            GlobalState.channelsMissing = 0;

            // one slot at a time until the radio says there are no more, which is
            // what meshcore.js getChannels does, but counted. Every slot is read,
            // empty ones too, so on a radio with forty slots this is forty reads
            // Every slot's answer is checked against the slot asked for, and a
            // slot that will not answer is retried and then counted rather than
            // ending the read. `meshcore.js` resolves a channel read with
            // whatever channel info arrives next, whichever slot it is for, so a
            // reply that arrives late is handed to the following read and every
            // slot after it is one out.
            //
            // Node 2 came back from a connect with 7 channels for 8 slots and
            // `#joebot` twice. Nothing warned: the Emcomm Testing row was simply
            // absent, and the Normal profile captured from that read was short a
            // channel it would never have written back on the way home.
            const { channels, missing } = await this.exclusive(async () => {
                const read = [];
                const missing = [];
                let found = 0;
                for(let idx = 0; slots == null || idx < slots; idx++){

                    onProgress?.(idx, slots, found);

                    let channel = null;
                    let failure = null;
                    for(let attempt = 0; attempt < 2; attempt++){
                        try {
                            const answer = await connection.getChannel(idx);
                            if(answer == null || answer.channelIdx === idx){
                                channel = answer;
                                failure = null;
                                break;
                            }
                            // the reply belongs to another slot, so a previous read
                            // answered late. Asking again consumes it and puts the
                            // sequence back in step
                            failure = new Error(`slot ${idx} answered as ${answer.channelIdx}`);
                            console.log(`channel ${failure.message}, reading it again`);
                        } catch(e) {
                            failure = e;
                        }
                    }

                    if(failure != null){
                        // with no slot count from the radio, an error is the only
                        // way the end of the list is known: that is how
                        // meshcore.js finds it, and it must stay that way for
                        // firmware that does not report a count
                        if(slots == null){
                            break;
                        }
                        missing.push(idx);
                        continue;
                    }

                    read.push(channel);
                    if(channel?.name != null && channel.name.trim() !== ""){
                        found++;
                    }

                }
                onProgress?.(slots ?? read.length, slots ?? read.length, found);
                return { channels: read, missing: missing };
            }, 10000);

            GlobalState.channelsMissing = missing.length;
            GlobalState.channelSlots = slots;

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
                const response = await this.exclusive(() => GlobalState.connection.getBatteryVoltage(), this.READ_TIMEOUT_MILLIS);
                GlobalState.batteryPercentage = Utils.getBatteryPercentage(response.batteryMilliVolts);
            } catch(e) {
                // ignore error
            }
        }
    }

    /**
     * The tail of the queue of device commands. Never rejects.
     */
    static commandQueue = Promise.resolve();

    /**
     * How long a queued command may hold the queue before it is abandoned.
     *
     * The queue trades one failure for another: commands no longer answer each
     * other, but a command that never finishes now holds up every command behind
     * it rather than only itself. `meshcore.js` waits for most replies with no
     * timeout at all, and Bluetooth drops frames, so without this bound one lost
     * reply would freeze the whole app until it was reconnected.
     */
    static COMMAND_TIMEOUT_MILLIS = 20000;

    /**
     * How long to hold the queue for the reply to a command we do not otherwise
     * wait on. Local replies come back in well under a second; this is generous.
     */
    static ACK_TIMEOUT_MILLIS = 5000;

    /** How long one frame may take to go out before it is given up on. */
    static FRAME_WRITE_TIMEOUT_MILLIS = 5000;

    /** Headroom over a trace's own timeout, which only starts once it is sent. */
    static TRACE_QUEUE_TIMEOUT_MILLIS = 30000;

    /**
     * How long a simple read of the attached radio may take: its clock, its self
     * info, its firmware details, its battery.
     *
     * These are local, not mesh traffic, and answer in well under a second on
     * either link; 0.2 seconds for self info over Bluetooth on the bench. The
     * general command bound is 20 seconds, and on a radio that had stopped
     * answering, the settings page queued its clock read and its self info read
     * one after the other and took 37 seconds to say it could not read anything.
     */
    static READ_TIMEOUT_MILLIS = 5000;

    /**
     * Runs one device command at a time, and never for ever.
     *
     * Every command in `meshcore.js` sends its bytes and then listens for the
     * response code it expects, on one emitter shared by the whole connection.
     * Nothing ties a reply to the command that asked for it, and the emitter hands
     * each reply to every listener waiting on that code. With two commands in
     * flight, one `Ok` resolves both and one `Err` rejects both: the second reports
     * the first one's answer as its own, before the radio has even read it, and its
     * real reply then arrives for nobody, or for whichever command is next.
     *
     * The settings page hit exactly that: the EMCOMM group reads the clock as it
     * mounts, the page reads self info a moment later, and the answers crossed,
     * leaving every field on the page empty.
     *
     * A failed or abandoned command must not poison the queue, so the chain is
     * kept on a separate promise that always resolves.
     *
     * Only ever wrap a single library call, never a function that itself queues:
     * the queue is not re-entrant, and a queued function waiting on the queue
     * waits on itself until the timeout frees it.
     */
    static async exclusive(fn, timeoutMillis = this.COMMAND_TIMEOUT_MILLIS) {
        const run = this.commandQueue.then(() => Utils.withTimeout(Promise.resolve().then(fn), timeoutMillis));
        this.commandQueue = run.catch(() => {});
        return await run;
    }

    /**
     * Sends a command and holds the queue until the radio answers it.
     *
     * For commands whose reply nothing else waits for. The radio answers them
     * anyway, and an answer nobody collects is delivered to whatever command is
     * waiting next: a path reset's `Ok` would report a setter as confirmed before
     * the radio had read it. Collecting the reply here, while the command still
     * holds the queue, keeps it from landing on anyone else.
     *
     * Never throws on silence. Some of these commands may not be answered at all
     * on some firmware, and waiting a few seconds and carrying on is exactly what
     * they did before. Returns the response code that arrived, or null.
     */
    static async sendAwaiting(connection, send, codes = [Constants.ResponseCodes.Ok, Constants.ResponseCodes.Err], timeoutMillis = this.ACK_TIMEOUT_MILLIS) {
        return await this.exclusive(() => new Promise((resolve, reject) => {

            const listeners = [];
            let timer = null;

            const finish = () => {
                clearTimeout(timer);
                for(const [code, listener] of listeners){
                    connection.off(code, listener);
                }
            };

            for(const code of codes){
                const listener = (data) => {
                    finish();
                    resolve({ code, data });
                };
                listeners.push([code, listener]);
                connection.on(code, listener);
            }

            timer = setTimeout(() => {
                finish();
                resolve({ code: null, data: null });
            }, timeoutMillis);

            Promise.resolve().then(send).catch((e) => {
                finish();
                reject(e);
            });

        }), timeoutMillis + this.ACK_TIMEOUT_MILLIS);
    }

    /**
     * Puts one frame on the wire at a time.
     *
     * On Bluetooth two writes at once fail with "GATT operation already in
     * progress", and `meshcore.js` catches that and only logs it, so the command
     * never reaches the radio and whoever sent it waits for a reply that cannot
     * come. The library marks the spot with a todo for exactly this mutex. The
     * command queue above cannot cover it alone, because the library also writes
     * on its own behalf. Wrapping the connection's frame writer covers every
     * frame, whoever sends it.
     *
     * The chain belongs to this connection, so a stuck write cannot follow the
     * operator onto the next radio they connect.
     */
    static serialiseFrames(connection) {
        if(typeof connection.sendToRadioFrame !== "function"){
            return;
        }
        const send = connection.sendToRadioFrame.bind(connection);
        let tail = Promise.resolve();
        connection.sendToRadioFrame = (frame) => {
            const run = tail.then(() => Utils.withTimeout(send(frame), this.FRAME_WRITE_TIMEOUT_MILLIS));
            tail = run.catch(() => {});
            return run;
        };
    }

    static async deviceQuery(appTargetVer = 1) {
        return await this.exclusive(() => GlobalState.connection.deviceQuery(appTargetVer), this.READ_TIMEOUT_MILLIS);
    }

    /**
     * The device's own clock, or null if it will not say.
     *
     * Queued with everything else: this is what the EMCOMM settings group reads
     * while the settings page is reading self info.
     */
    static async getDeviceTime() {
        return await this.exclusive(() => GlobalState.connection.getDeviceTime(), this.READ_TIMEOUT_MILLIS);
    }

    /**
     * How long to wait for the device to acknowledge a setting.
     *
     * Every setter in `meshcore.js` resolves when an `Ok` frame arrives and
     * rejects when an `Err` does, and waits for one of them with no timeout at
     * all. Bluetooth drops frames, so a dropped `Ok` left the Save button stuck
     * on "Saving..." for ever, on a radio that had very likely applied the change
     * and was answering everything else.
     *
     * Generous, because a busy device can be slow and a false failure would have
     * the operator save again. Long enough to be sure, short enough that the
     * button always comes back.
     */
    static SETTING_TIMEOUT_MILLIS = 15000;

    /**
     * Runs a setting command through the queue, and not for ever.
     *
     * Takes a function rather than a promise. A promise has already been sent by
     * the time it is handed over, so queueing it would queue nothing.
     *
     * A timeout here means the acknowledgement did not arrive, which is not the
     * same as the change not happening, so callers say so rather than reporting a
     * clean failure.
     */
    static async withSettingTimeout(what, fn) {
        try {
            return await this.exclusive(fn, this.SETTING_TIMEOUT_MILLIS);
        } catch(e) {
            if(String(e?.message ?? e) === "timed out"){
                throw new Error(`the radio did not confirm the ${what} within ${Math.round(this.SETTING_TIMEOUT_MILLIS / 1000)} seconds. It may still have been applied.`);
            }
            throw e;
        }
    }

    static async sendZeroHopAdvert() {
        return await this.exclusive(() => GlobalState.connection.sendZeroHopAdvert());
    }

    static async sendFloodAdvert() {
        return await this.exclusive(() => GlobalState.connection.sendFloodAdvert());
    }

    static async setAdvertName(name) {
        await this.withSettingTimeout("name", () => GlobalState.connection.setAdvertName(name));
    }

    static async setAdvertLatLong(latitude, longitude) {
        await this.withSettingTimeout("position", () => GlobalState.connection.setAdvertLatLong(latitude, longitude));
    }

    static async setTxPower(txPower) {
        await this.withSettingTimeout("transmit power", () => GlobalState.connection.setTxPower(txPower));
    }

    static async setRadioParams(radioFreq, radioBw, radioSf, radioCr) {
        await this.withSettingTimeout("radio settings", () => GlobalState.connection.setRadioParams(radioFreq, radioBw, radioSf, radioCr));
    }

    static async setChannel(channelIdx, name, secret) {
        await this.withSettingTimeout("channel", () => GlobalState.connection.setChannel(channelIdx, name, secret));
    }

    /** One channel slot as the radio holds it, or throws when it cannot be read. */
    /**
     * Reads one channel slot, and proves the answer is that slot's.
     *
     * `meshcore.js` resolves a channel read with whatever channel info arrives
     * next, whichever slot it is for. So a read that times out and answers late
     * hands its reply to the *following* read, and every slot after it is one
     * out. On the bench node 2 came back with 7 channels for 8 slots and
     * `#joebot` listed twice, which is what that looks like: the Emcomm Testing
     * row was simply absent, and the captured Normal profile was short by a
     * channel it would never have written back.
     *
     * Nothing warned, because an empty slot and a wrong answer read the same. So
     * the index is checked here, and a mismatch is retried rather than trusted:
     * the retry also consumes the stale reply, which puts the sequence back in
     * step for every slot after it.
     */
    static CHANNEL_READ_ATTEMPTS = 3;

    static async getChannel(channelIdx) {

        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(this.DISCONNECTED);
        }

        let lastError = null;

        for(let attempt = 0; attempt < this.CHANNEL_READ_ATTEMPTS; attempt++){

            let channel;
            try {
                channel = await this.exclusive(() => connection.getChannel(channelIdx), 4000);
            } catch(e) {
                // a timeout is worth another go: the slot may be readable and the
                // radio merely busy, and the reply that arrives late is taken by
                // the next attempt's own check rather than by the next slot
                lastError = e;
                continue;
            }

            if(channel == null || channel.channelIdx === channelIdx){
                return channel;
            }

            console.log(`channel slot ${channelIdx} answered as ${channel.channelIdx}, reading it again`);
            lastError = new Error(`slot ${channelIdx} answered as ${channel.channelIdx}`);

        }

        throw lastError ?? new Error(`slot ${channelIdx} could not be read`);

    }

    /** Empties a channel slot: an empty name and a zeroed key, as the library does. */
    static async deleteChannel(channelIdx) {
        await this.withSettingTimeout("channel", () => GlobalState.connection.setChannel(channelIdx, "", new Uint8Array(16)));
    }

    static async setOtherParams(manualAddContacts) {
        await this.withSettingTimeout("add contacts mode", () => GlobalState.connection.setOtherParams(manualAddContacts));
    }

    // CMD_SET_OTHER_PARAMS. meshcore.js sends only its first setting
    static CMD_SET_OTHER_PARAMS = 38;

    /**
     * The settings CMD_SET_OTHER_PARAMS carries, as the radio last reported them.
     * Self info brings them back as three bytes meshcore.js files under
     * "reserved": multi acks, advert location policy, then the telemetry modes.
     */
    static otherParams(selfInfo = GlobalState.selfInfo) {
        const reserved = selfInfo?.reserved ?? [];
        return {
            manualAddContacts: selfInfo?.manualAddContacts === 1,
            multiAcks: reserved[0] ?? 0,
            advertLocPolicy: reserved[1] ?? 0,
            telemetryModes: reserved[2] ?? 0,
        };
    }

    /**
     * Writes all of CMD_SET_OTHER_PARAMS at once: whether contacts are added by
     * hand, the telemetry permissions, the advert location policy and multi
     * acks. The firmware sets every field the frame reaches, so each one not
     * being changed is sent back as the radio last reported it.
     */
    static async setAllOtherParams(params) {
        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(this.DISCONNECTED);
        }
        const frame = new Uint8Array([
            this.CMD_SET_OTHER_PARAMS,
            params.manualAddContacts ? 1 : 0,
            params.telemetryModes & 0x3F,
            params.advertLocPolicy & 0xFF,
            params.multiAcks & 0xFF,
        ]);
        const reply = await this.sendAwaiting(connection, () => connection.sendToRadioFrame(frame));
        if(reply.code !== Constants.ResponseCodes.Ok){
            throw new Error(reply.code == null ? "the radio did not answer" : "the radio refused it");
        }
    }

    static async addOrUpdateContact(...args) {
        await this.withSettingTimeout("contact", () => GlobalState.connection.addOrUpdateContact(...args));
    }

    static async syncDeviceTime() {
        const timestamp = Math.floor(Date.now() / 1000);
        await this.sendAwaiting(GlobalState.connection, () => GlobalState.connection.sendCommandSetDeviceTime(timestamp));
    }

    static async resetContactPath(publicKey) {
        await this.sendAwaiting(GlobalState.connection, () => GlobalState.connection.sendCommandResetPath(publicKey));
    }

    /**
     * Deliberately does not report failure.
     *
     * This is the contact menu's delete, which was written this way before and
     * is left alone: the contact list is read back afterwards, so the device gets
     * the last word either way. It does now collect the radio's reply, because an
     * uncollected `Ok` would confirm whatever command came next. EMCOMM mode's
     * trim uses the library's own acknowledged call instead, which is the path
     * proven on the radios.
     */
    static async removeContact(publicKey) {
        await this.sendAwaiting(GlobalState.connection, () => GlobalState.connection.sendCommandRemoveContact(publicKey));
    }

    static async shareContact(publicKey) {
        await this.exclusive(() => GlobalState.connection.shareContact(publicKey));
    }

    static async exportContact(publicKey) {
        return await this.exclusive(() => GlobalState.connection.exportContact(publicKey));
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
    // thrown when an operation cannot run because the radio is gone. callers check for
    // it so they can say the link dropped rather than inventing a result
    static DISCONNECTED = "disconnected";

    // the room refused the password, as opposed to never answering at all
    static LOGIN_FAILED = "login-failed";

    // How long to wait for a room to answer a login. meshcore.js allows the
    // device's estimated transmit time plus one second, about 8.8 seconds for a
    // room three hops out, and a real room answered at 12. Flood routing adds a
    // random delay at every hop, so the round trip is far longer than the transmit
    // estimate it is derived from.
    static ROOM_LOGIN_TIMEOUT_MILLIS = 45000;

    // how many times to re-read the contact list when the device says it sent more
    // than arrived. a local query, so this costs no airtime, only a second or two
    static MAX_CONTACT_LOAD_PASSES = 4;

    static async getPosition(timeoutMillis = 5000) {

        const selfInfo = await this.exclusive(() => GlobalState.connection.getSelfInfo(), timeoutMillis);

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

                const selfInfo = await this.exclusive(() => GlobalState.connection.getSelfInfo(), 5000);
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

        // a missing link is not a missing reply. without this the caller cannot tell
        // the two apart and records a disconnected radio as packet loss, which is a
        // measurement of the mesh that never happened
        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(this.DISCONNECTED);
        }

        const startedAt = performance.now();

        // A radio unplugged while a trace is in flight used to surface as the trace's
        // own timeout, seconds later, and a timeout is recorded as packet loss. Which
        // of the two arrived first decided how the cable pull was reported, so the
        // same event could come out as a disconnect or as a lost packet depending on
        // timing. Racing them makes it decided by what happened rather than by when.
        let onDisconnected = null;
        const disconnected = new Promise((resolve, reject) => {
            onDisconnected = () => reject(new Error(this.DISCONNECTED));
            connection.on("disconnected", onDisconnected);
        });

        let reply;
        try {
            // the first byte of their public key is the whole path for a single hop
            reply = await Promise.race([
                // held for the whole trace: until it is sent it can take another
                // command's Sent or Err, and a ping is a few seconds at most
                this.exclusive(
                    () => connection.tracePath([publicKey[0]], extraTimeoutMillis),
                    extraTimeoutMillis + this.TRACE_QUEUE_TIMEOUT_MILLIS,
                ),
                disconnected,
            ]);
        } finally {
            // without this the listener outlives the request, and a later disconnect
            // rejects a promise nobody is waiting on any more
            connection.off("disconnected", onDisconnected);
        }

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
    // Discovery used to listen for a fixed 30 s. At the bench settings every
    // repeater on default settings has answered within about 2 s, so most of that
    // was waiting on nothing. 10 s leaves room for a repeater whose owner has
    // raised its delay, and slower radio settings get longer
    static DISCOVERY_MIN_LISTEN_MILLIS = 10000;

    static discoveryListenMillis() {
        return Airtime.discoveryListenMillis(GlobalState.selfInfo, this.DISCOVERY_MIN_LISTEN_MILLIS);
    }

    static async discoverRepeaters(listenMillis = this.discoveryListenMillis()) {

        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(this.DISCONNECTED);
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
            // queued only until the radio acknowledges: holding the queue for the
            // whole listen would stall everything else for half a minute. Replies
            // come as pushes carrying our tag, so nothing else can take them
            await this.sendAwaiting(connection, () => connection.sendToRadioFrame(request));
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

        await this.withSettingTimeout("contact", () => connection.addOrUpdateContact(
            discovered.publicKey,
            discovered.nodeType,
            0,                              // flags
            0,                              // outPathLen: reached directly
            new Uint8Array(64),             // outPath: empty, nothing to relay through
            name,
            Math.floor(Date.now() / 1000),  // heard just now, which is why we are here
            0,                              // advLat, unknown until it adverts
            0,                              // advLon
        ));

        await this.loadContacts();

        return name;

    }

    /**
     * Adds a contact from a shared `meshcore://` link, or the bare hex inside one.
     *
     * This is the only way to add a room server. Discovery cannot find one: the
     * room firmware does not implement the control packet at all, so a room is
     * invisible until it adverts within earshot, however close it is. A link
     * pasted from another client sidesteps that.
     *
     * The advert is parsed here before it is sent, so bad input is named rather
     * than handed to the radio to reject with a bare error code.
     */
    static async importContact(text) {

        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(this.DISCONNECTED);
        }

        const hex = String(text ?? "")
            .trim()
            .replace(/^meshcore:\/\//i, "")
            .replace(/\s+/g, "");

        if(hex === ""){
            throw new Error("Paste a meshcore:// contact link.");
        }

        if(!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0){
            throw new Error("That does not look like a contact link.");
        }

        const bytes = new Uint8Array(hex.length / 2);
        for(let i = 0; i < bytes.length; i++){
            bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }

        // 32 byte public key, 4 byte timestamp, 64 byte signature, then app data
        if(bytes.length <= 100){
            throw new Error("That link is too short to be a contact.");
        }

        let advert;
        try {
            advert = Advert.fromBytes(bytes);
        } catch(e) {
            throw new Error("That contact link could not be read.");
        }

        const publicKeyHex = Utils.bytesToHex(advert.publicKey);
        const alreadyKnown = GlobalState.contacts.some((c) => Utils.bytesToHex(c.publicKey) === publicKeyHex);

        await this.withSettingTimeout("contact import", () => connection.importContact(bytes));

        // read back rather than assume: the device owns the list, and this should
        // report what it actually holds now
        await this.loadContacts();

        const contact = GlobalState.contacts.find((c) => Utils.bytesToHex(c.publicKey) === publicKeyHex);
        if(contact == null){
            throw new Error("The radio accepted that link but the contact did not appear.");
        }

        return { contact: contact, alreadyKnown: alreadyKnown };

    }

    /**
     * Logs in to a room server, which has to happen before its posts arrive.
     *
     * The password is passed straight through to the radio and kept nowhere: not
     * in this app, not in storage, and not on the node, which has no field for
     * one. `CMD_SEND_LOGIN` carries it in the frame every time, so the operator
     * types it per login. For an emergency client that is the right trade.
     *
     * The waiting is done here rather than by `meshcore.js`, because its `login()`
     * gives up far too early. It waits the device's own estimated transmit time
     * plus one second, which for a room three hops out came to about 8.8 seconds.
     * Measured against a real room: the success push arrived at **12 seconds**, by
     * which point the library had already rejected with "timeout" and removed its
     * listener. The operator was told nobody answered while they were, in fact,
     * logged in. Several apparently dead rooms were this.
     *
     * So the command is sent directly and both answers are read off the raw frames
     * here, the way discovery is:
     *
     *   success: [0x85, permissions, ...public key prefix, ...]
     *   refusal: [0x86, reserved, ...public key prefix]
     *
     * A room never sends the refusal — its source says "no response. Client will
     * timeout" for a wrong password — but repeaters do, and it is the only way to
     * tell a refusal from silence.
     */
    /**
     * What a room granted, read from its login success frame.
     *
     *   [0x85, is_admin, key prefix x6, tag x4, acl permissions, firmware level]
     *
     * The byte right after the push code is a legacy `is_admin` flag, zero or one.
     * The ACL role lives at index 12 and only exists from firmware v7. Reading the
     * legacy byte as though it were the role, which this did, turns an admin login
     * into "role 1, read only", and the app then refuses to post into a room that
     * had granted full rights. That is exactly backwards from the fault it was
     * written to prevent.
     *
     * An older frame carries no role at all. It reports posting as allowed rather
     * than blocked: refusing on a guess is the same mistake in the other
     * direction, and the room will say no for itself by dropping the post.
     */
    static readLoginSuccess(bytes) {

        const isAdmin = bytes[1] !== 0;
        const clockOffsetSeconds = this.readRoomClockOffset(bytes);

        // no ACL byte before v7
        if(bytes.length < 13){
            return { role: null, isAdmin: isAdmin, canPost: true, permissions: null, clockOffsetSeconds };
        }

        const role = bytes[12] & 3;
        return {
            role: role,
            isAdmin: role === 3,
            canPost: role >= 2,
            permissions: bytes[12],
            clockOffsetSeconds,
        };

    }

    /**
     * How far the room's clock is from this one, in seconds, from the room's time
     * in the login success frame (bytes 8 to 11, little endian), or null when the
     * frame is too old to carry it. A room stamps each post with its own clock,
     * and a room without GPS can be well out, so a post's age is only known
     * against the room's time, not ours.
     */
    static readRoomClockOffset(bytes) {
        if(bytes.length < 12){
            return null;
        }
        const roomTime = (bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24)) >>> 0;
        if(roomTime === 0){
            return null;
        }
        return roomTime - Math.floor(Date.now() / 1000);
    }

    static async loginToRoom(publicKey, password) {

        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(this.DISCONNECTED);
        }

        const PUSH_LOGIN_SUCCESS = 0x85;
        const PUSH_LOGIN_FAIL = 0x86;
        const prefix = publicKey.subarray(0, 6);

        const isForThisRoom = (bytes) => {
            for(let i = 0; i < 6; i++){
                if(bytes[2 + i] !== prefix[i]){
                    return false;
                }
            }
            return true;
        };

        let onFrame = null;
        let timer = null;

        const answered = new Promise((resolve, reject) => {

            onFrame = (frame) => {

                const bytes = new Uint8Array(frame);
                if(bytes.length < 8 || !isForThisRoom(bytes)){
                    return;
                }

                if(bytes[0] === PUSH_LOGIN_SUCCESS){
                    resolve(this.readLoginSuccess(bytes));
                } else if(bytes[0] === PUSH_LOGIN_FAIL){
                    reject(new Error(this.LOGIN_FAILED));
                }

            };

            connection.on("rx", onFrame);
            timer = setTimeout(() => reject(new Error("timeout")), this.ROOM_LOGIN_TIMEOUT_MILLIS);

        });

        // a quick refusal can land while the login is still waiting for the radio
        // to say it was sent, before anything awaits this. Marked handled here so
        // that is not reported as an unhandled rejection; the await below still
        // receives it
        answered.catch(() => {});

        try {
            // queued only until the radio says it has sent the login. The room's
            // answer can take the best part of a minute and arrives as a push
            // matched to this room, so nothing else can take it, and holding the
            // queue that long would stall everything else
            const ack = await this.sendAwaiting(
                connection,
                () => connection.sendCommandSendLogin(publicKey, password),
                [Constants.ResponseCodes.Sent, Constants.ResponseCodes.Err],
            );
            if(ack.code === Constants.ResponseCodes.Err){
                throw new Error("the radio would not send the login");
            }
            return await answered;
        } finally {
            clearTimeout(timer);
            connection.off("rx", onFrame);
        }

    }

    /**
     * Marks a contact as a favourite on the radio, or clears the mark.
     *
     * Bit 0 of the contact's flags is the firmware's own favourite bit, so this
     * is the same mark the official app shows rather than a note kept in this
     * browser. The rest of the byte is contact permissions and is preserved: the
     * device command replaces the whole contact record, so every other field has
     * to be sent back exactly as it came.
     */
    static async setContactFavourite(publicKey, favourite) {

        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(this.DISCONNECTED);
        }

        const contact = GlobalState.contacts.find((c) => Utils.isUint8ArrayEqual(c.publicKey, publicKey));
        if(contact == null){
            throw new Error("no such contact");
        }

        await this.withSettingTimeout("favourite", () => connection.addOrUpdateContact(
            contact.publicKey,
            contact.type,
            ContactFlags.withFavourite(contact.flags, favourite),
            contact.outPathLen,
            contact.outPath,
            contact.advName,
            contact.lastAdvert,
            contact.advLat,
            contact.advLon,
        ));

        // read back rather than assume: the device owns this record now, and a
        // write it rejected or altered should not leave the list saying otherwise
        await this.loadContacts();

    }

    static async sendMessage(publicKey, text) {

        // send message
        const message = await this.exclusive(() => GlobalState.connection.sendTextMessage(publicKey, text));

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

    /**
     * A binary datagram on a channel, flooded. Every station holding the channel
     * receives it; clients that do not know the data type show nothing.
     */
    static async sendChannelDatagram(channelIdx, dataType, payload) {
        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(this.DISCONNECTED);
        }
        const reply = await this.sendAwaiting(
            connection,
            () => connection.sendCommandSendChannelData(channelIdx, 0xFF, [], dataType, payload),
        );
        if(reply.code !== Constants.ResponseCodes.Ok){
            throw new Error(reply.code == null ? "the radio did not answer" : "the radio would not send it");
        }
    }

    /**
     * A direct message of text type 1, which the firmware calls command data. It
     * is sent once, with no acknowledgement, and is not kept in the conversation.
     */
    static async sendCommandData(publicKey, text) {
        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(this.DISCONNECTED);
        }
        const reply = await this.sendAwaiting(
            connection,
            () => connection.sendCommandSendTxtMsg(Constants.TxtTypes.CliData, 0, Math.floor(Date.now() / 1000), new Uint8Array(publicKey).subarray(0, 6), text),
            [Constants.ResponseCodes.Sent, Constants.ResponseCodes.Err],
        );
        if(reply.code !== Constants.ResponseCodes.Sent){
            throw new Error(reply.code == null ? "the radio did not answer" : "the radio would not send it");
        }
    }

    /**
     * A post into a room server, as ordinary text, sent once and not kept in the
     * conversation. Text type 1 cannot be used in a room: the room firmware runs
     * it as a command when the sender is an admin, and drops it otherwise.
     */
    static async sendRoomPost(publicKey, text) {
        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(this.DISCONNECTED);
        }
        const reply = await this.sendAwaiting(
            connection,
            () => connection.sendCommandSendTxtMsg(Constants.TxtTypes.Plain, 0, Math.floor(Date.now() / 1000), new Uint8Array(publicKey).subarray(0, 6), text),
            [Constants.ResponseCodes.Sent, Constants.ResponseCodes.Err],
        );
        if(reply.code !== Constants.ResponseCodes.Sent){
            throw new Error(reply.code == null ? "the radio did not answer" : "the radio would not send it");
        }
    }

    // how long past the radio's own estimate to wait for a telemetry answer
    static TELEMETRY_EXTRA_MILLIS = 5000;

    /**
     * Asks a contact's radio for its telemetry: battery, and a position if it has
     * a working GPS and its owner allows it. The firmware answers this itself,
     * with no app needed at the other end.
     *
     * The queue is held only until the radio says it has sent the request, as for
     * a room login; the answer arrives as a push matched to that contact.
     */
    static async requestTelemetry(publicKey) {

        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(this.DISCONNECTED);
        }

        const prefix = new Uint8Array(publicKey).subarray(0, 6);
        let onResponse = null;
        let timer = null;
        let armTimeout = null;

        const answered = new Promise((resolve, reject) => {
            onResponse = (response) => {
                if(Utils.isUint8ArrayEqual(new Uint8Array(response.pubKeyPrefix), prefix)){
                    resolve(response);
                }
            };
            armTimeout = (millis) => {
                timer = setTimeout(() => reject(new Error("timeout")), millis);
            };
            connection.on(Constants.PushCodes.TelemetryResponse, onResponse);
        });
        answered.catch(() => {});

        try {
            const sent = await this.sendAwaiting(
                connection,
                () => connection.sendCommandSendTelemetryReq(new Uint8Array(publicKey)),
                [Constants.ResponseCodes.Sent, Constants.ResponseCodes.Err],
            );
            if(sent.code !== Constants.ResponseCodes.Sent){
                throw new Error("the radio would not send the telemetry request");
            }
            armTimeout((sent.data?.estTimeout ?? 10000) + this.TELEMETRY_EXTRA_MILLIS);
            return await answered;
        } finally {
            clearTimeout(timer);
            connection.off(Constants.PushCodes.TelemetryResponse, onResponse);
        }

    }

    static async sendChannelMessage(channelIdx, text) {

        // send message
        await this.exclusive(() => GlobalState.connection.sendChannelTextMessage(channelIdx, text));

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

            // one message per turn of the queue, so a long backlog lets other
            // commands through between messages rather than holding them all up
            let message;
            try {
                message = await this.exclusive(() => GlobalState.connection.syncNextMessage());
            } catch(e) {
                // a lost reply used to hang here for ever; now it stops this sync,
                // and the next message waiting notification starts another
                console.log("message sync stopped", e);
                break;
            }
            if(!message){
                break;
            }

            // handle received message
            if(message.contactMessage){
                await this.onContactMessageReceived(message.contactMessage);
            } else if(message.channelMessage) {
                await this.onChannelMessageReceived(message.channelMessage);
            } else if(message.channelData) {
                // binary datagrams on a channel. Only position requests and their
                // answers are ours; anything else belongs to some other app
                PositionService.onChannelData(message.channelData);
            }

        }
    }

    static async reboot() {
        const connection = GlobalState.connection;
        await this.exclusive(() => connection.reboot());
        // over a USB bridge the port stays open through the reboot, so no reconnect
        // follows to set the clock the reboot has just cost the radio. Over
        // Bluetooth the link drops and this finds it gone and stops
        this.onSerialRecovered(connection);
    }

    /**
     * The minute timer's work: the battery, and whether the radio's clock has
     * slipped.
     *
     * A reboot costs the radio its clock, and not every reboot says so. One that
     * garbles the serial line is caught by the read loop, and one the app asks
     * for is caught by reboot() above, but a reset button, a brownout or a
     * watchdog restart says nothing at all. On the bench a clean reboot left node
     * 1 204 seconds out with nothing about to notice. So the clock is read here,
     * one small local read a minute, and set when it has drifted.
     */
    static async periodicCheck() {
        await this.updateBatteryPercentage();
        await this.checkClock();
    }

    // beyond this the clock is set. Date time groups are to the minute, and a
    // radio that has just rebooted is usually minutes out, not seconds
    static CLOCK_DRIFT_LIMIT_SECONDS = 30;

    static async checkClock() {
        if(GlobalState.connection == null){
            return;
        }
        try {
            const time = await this.getDeviceTime();
            if(time?.epochSecs == null){
                return;
            }
            const drift = Math.abs(Math.floor(Date.now() / 1000) - time.epochSecs);
            if(drift > this.CLOCK_DRIFT_LIMIT_SECONDS){
                await this.syncDeviceTime();
                console.log(`radio clock was ${drift}s out; set`);
            }
        } catch(e) {
            // a missed check is not worth raising: the next one is a minute away
        }
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

        // A position request or answer sent direct travels as text type 1 with a
        // marker. It is handled, and kept out of the conversation: on the bench the
        // test one landed in the chat as an ordinary message with a notification
        if(message.txtType === Constants.TxtTypes.CliData && PositionService.onDirectText(contact, message.text)){
            return;
        }

        // A room post carries its author in front of the text. Recovered from the
        // raw frame, because the copy the library hands over has had those bytes
        // put through a UTF-8 decoder and any that were not valid UTF-8 are gone.
        const signed = SignedPosts.take(message);

        // a position roll call or answer posted in a room is handled the same
        // way, and kept out of the room's conversation. The post's time is the
        // room's, which says whether it is a replay of an old one after a login
        // every post the room sends moves the keep-alive's since stamp on, so a
        // session that recovers asks only for what it actually missed
        if(contact.type === Constants.AdvType.Room){
            RoomKeepAlive.notePost(contact.publicKey, message.senderTimestamp);
        }

        if(contact.type === Constants.AdvType.Room
            && PositionService.onRoomText(contact, signed?.authorPrefix ?? null, signed ? signed.text : message.text, message.senderTimestamp)){
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
            text: signed ? signed.text : message.text,
            author_prefix: signed ? Utils.bytesToHex(signed.authorPrefix) : null,
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
