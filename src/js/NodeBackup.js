// Capturing a node's configuration so it can be put back.
//
// This is the way home for EMCOMM mode, so it is written to be suspicious of
// itself. A backup that is quietly short is worse than no backup at all: it
// looks like a way back right up until the moment it is needed.
//
// See docs/EMCOMM-MODE.md for the decisions behind this.

import GlobalState from "./GlobalState.js";
import Connection from "./Connection.js";
import Utils from "./Utils.js";

const FORMAT_VERSION = 1;

// slot names. the pre-EMCOMM one is written only when converting, so routine
// use of the backup button cannot replace the way home with the stripped
// configuration it was meant to undo
const SLOT_PRE_EMCOMM = "pre-emcomm";
const SLOT_LATEST = "latest";

const STORAGE_PREFIX = "node_backup";

// channels are read by index until one cannot be read. that is also what a real
// gap looks like, so a bound is needed rather than trusting the loop to end
const MAX_CHANNELS = 16;

class NodeBackup {

    static get SLOT_PRE_EMCOMM() {
        return SLOT_PRE_EMCOMM;
    }

    static get SLOT_LATEST() {
        return SLOT_LATEST;
    }

    /**
     * Reads the node's whole configuration.
     *
     * Everything here is read from the device rather than from GlobalState.
     * `loadChannels` falls back to a default channel list when the device does
     * not answer, and those defaults carry no secret — storing them as though
     * they were the real channels would produce a backup that restores garbage
     * over working channels.
     */
    static async capture() {

        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(Connection.DISCONNECTED);
        }

        const warnings = [];

        // fresh, not the copy cached at connect time
        const selfInfo = await connection.getSelfInfo();

        // re-read and merge until complete: over Bluetooth a single read has
        // come back up to 9% short, and this is the one place that must not be
        await Connection.loadContacts();
        const contacts = GlobalState.contacts;

        if(GlobalState.contactsMissing > 0){
            warnings.push(`${GlobalState.contactsMissing} of ${GlobalState.contactsAnnounced} contacts could not be read.`);
        }

        const channels = await this.captureChannels(connection, warnings);

        return {
            formatVersion: FORMAT_VERSION,
            capturedAt: Date.now(),
            nodeName: selfInfo.name,
            nodePublicKey: Utils.bytesToHex(selfInfo.publicKey),
            settings: {
                name: selfInfo.name,
                advLat: selfInfo.advLat,
                advLon: selfInfo.advLon,
                txPower: selfInfo.txPower,
                maxTxPower: selfInfo.maxTxPower,
                radioFreq: selfInfo.radioFreq,
                radioBw: selfInfo.radioBw,
                radioSf: selfInfo.radioSf,
                radioCr: selfInfo.radioCr,
                manualAddContacts: selfInfo.manualAddContacts,
            },
            channels: channels,
            contacts: contacts.map((contact) => {
                return {
                    publicKey: Utils.bytesToHex(contact.publicKey),
                    type: contact.type,
                    flags: contact.flags,
                    outPathLen: contact.outPathLen,
                    outPath: Utils.bytesToHex(contact.outPath ?? new Uint8Array(64)),
                    advName: contact.advName,
                    lastAdvert: contact.lastAdvert,
                    advLat: contact.advLat,
                    advLon: contact.advLon,
                };
            }),
            contactsAnnounced: GlobalState.contactsAnnounced,
            warnings: warnings,
        };

    }

    /**
     * Every configured channel, by index.
     *
     * `getChannels` in the library stops at the first index it cannot read, and
     * a channel whose key is not 16 bytes is never emitted at all, so one such
     * channel would silently truncate the list. Reading each index here means a
     * gap is recorded as a gap rather than as the end.
     */
    static async captureChannels(connection, warnings) {

        const channels = [];
        let unreadable = 0;

        for(let idx = 0; idx < MAX_CHANNELS; idx++){

            let channel = null;
            try {
                channel = await Utils.withTimeout(connection.getChannel(idx), 4000);
            } catch(e) {
                // an empty slot and an unreadable one look the same from here, so
                // keep going rather than assuming the list has ended
                unreadable++;
                continue;
            }

            if(channel?.name == null || channel.name.trim() === ""){
                continue;
            }

            channels.push({
                idx: channel.channelIdx,
                name: channel.name,
                secret: Utils.bytesToHex(channel.secret),
            });

        }

        // every slot failing means the device does not answer this command at all,
        // which is worth saying: the backup then holds no channels by accident
        if(channels.length === 0 && unreadable > 0){
            warnings.push("No channels could be read from this device, so none are in this backup.");
        }

        return channels;

    }

    /**
     * Writes a backup back to the node.
     *
     * Additive: it restores settings, channels and contacts, and reports any
     * contact the node holds that the backup does not. Removing those is the
     * business of EMCOMM mode's trimming, kept separate so that restoring can
     * never itself delete anything.
     */
    static async restore(backup, onProgress = () => {}) {

        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(Connection.DISCONNECTED);
        }

        if(backup?.formatVersion !== FORMAT_VERSION){
            throw new Error("This backup was written by a different version of the app.");
        }

        const failures = [];
        const settings = backup.settings;

        const steps = 5 + backup.channels.length + backup.contacts.length;
        let done = 0;
        const step = (what) => onProgress({ done: ++done, total: steps, what: what });

        // settings first: they are few, and a failure here is worth knowing about
        // before spending minutes on contacts
        await this.attempt(failures, "name", () => Connection.setAdvertName(settings.name));
        step("name");
        await this.attempt(failures, "position", () => Connection.setAdvertLatLong(settings.advLat, settings.advLon));
        step("position");
        await this.attempt(failures, "transmit power", () => Connection.setTxPower(settings.txPower));
        step("transmit power");
        await this.attempt(failures, "radio settings", () => Connection.setRadioParams(
            settings.radioFreq, settings.radioBw, settings.radioSf, settings.radioCr,
        ));
        step("radio settings");

        await this.attempt(failures, "add contacts mode", () => Connection.setOtherParams(settings.manualAddContacts === 1));
        step("add contacts mode");

        for(const channel of backup.channels){
            await this.attempt(failures, `channel ${channel.name}`, () => Connection.setChannel(
                channel.idx, channel.name, Utils.hexToBytes(channel.secret),
            ));
            step(`channel ${channel.name}`);
        }

        for(const contact of backup.contacts){
            await this.attempt(failures, contact.advName || contact.publicKey.slice(0, 8), () => Connection.addOrUpdateContact(
                Utils.hexToBytes(contact.publicKey),
                contact.type,
                contact.flags,
                contact.outPathLen,
                Utils.hexToBytes(contact.outPath),
                contact.advName,
                contact.lastAdvert,
                contact.advLat,
                contact.advLon,
            ));
            step(contact.advName || "a contact");
        }

        // read back rather than assume: the device owns this now
        await Connection.loadContacts();
        await Connection.loadChannels();

        const backedUp = new Set(backup.contacts.map((c) => c.publicKey));
        const extra = GlobalState.contacts
            .filter((c) => !backedUp.has(Utils.bytesToHex(c.publicKey)))
            .map((c) => c.advName || Utils.bytesToHex(c.publicKey).slice(0, 8));

        return { failures: failures, notInBackup: extra };

    }

    // one failure should not abandon the rest: a restore that stops halfway
    // leaves the node in a state that is neither
    static async attempt(failures, what, action) {
        try {
            await action();
        } catch(e) {
            failures.push({ what: what, reason: String(e?.message ?? e) });
        }
    }

    // ---------------------------------------------------------------- storage

    static storageKey(nodePublicKeyHex, slot) {
        return `${STORAGE_PREFIX}:${nodePublicKeyHex}:${slot}`;
    }

    static save(backup, slot) {
        try {
            window.localStorage.setItem(this.storageKey(backup.nodePublicKey, slot), JSON.stringify(backup));
            return true;
        } catch(e) {
            // quota, private browsing, or storage turned off. the caller has to
            // know, because the operator may be about to rely on this
            console.log("failed to save backup", e);
            return false;
        }
    }

    static load(nodePublicKeyHex, slot) {
        try {
            const raw = window.localStorage.getItem(this.storageKey(nodePublicKeyHex, slot));
            return raw == null ? null : JSON.parse(raw);
        } catch(e) {
            console.log("failed to read backup", e);
            return null;
        }
    }

    /** Both slots for a node, newest first, with the empty ones left out. */
    static list(nodePublicKeyHex) {
        return [SLOT_PRE_EMCOMM, SLOT_LATEST]
            .map((slot) => ({ slot: slot, backup: this.load(nodePublicKeyHex, slot) }))
            .filter((entry) => entry.backup != null)
            .sort((a, b) => (b.backup.capturedAt ?? 0) - (a.backup.capturedAt ?? 0));
    }

    // ------------------------------------------------------------------ files

    static toFile(backup) {
        const name = (backup.nodeName || "node").replace(/[^A-Za-z0-9-_]+/g, "-");
        const stamp = new Date(backup.capturedAt).toISOString().slice(0, 19).replace(/[:T]/g, "-");
        return {
            filename: `meshcore-backup-${name}-${stamp}.json`,
            contents: JSON.stringify(backup, null, 2),
        };
    }

    /**
     * Reads a backup from a file's text, refusing anything that is not one.
     *
     * Checked before it can be offered for restore: a file that is not a backup,
     * or is a backup of a different node, would otherwise be written over a
     * working configuration.
     */
    static fromFile(text, expectedNodePublicKeyHex = null) {

        let backup;
        try {
            backup = JSON.parse(text);
        } catch(e) {
            throw new Error("That file is not a backup.");
        }

        if(backup?.formatVersion !== FORMAT_VERSION || !Array.isArray(backup.contacts)){
            throw new Error("That file is not a backup this version of the app can read.");
        }

        if(expectedNodePublicKeyHex != null && backup.nodePublicKey !== expectedNodePublicKeyHex){
            throw new Error(`That backup is for a different node (${backup.nodeName || "unnamed"}).`);
        }

        return backup;

    }

}

export default NodeBackup;
