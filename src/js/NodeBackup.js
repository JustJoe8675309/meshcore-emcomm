// Capturing a node's configuration so it can be put back.
//
// This is the way home for EMCOMM mode, so it is written to be suspicious of
// itself. A backup that is quietly short is worse than no backup at all: it
// looks like a way back right up until the moment it is needed.
//
// See docs/EMCOMM-MODE.md for the decisions behind this.

import GlobalState from "./GlobalState.js";
import Connection from "./Connection.js";
import Slots from "./channels/Slots.js";
import Utils from "./Utils.js";
import AdvertSchedule from "./AdvertSchedule.js";
import PositionService from "./position/PositionService.js";
import OperatorSettings from "./reports/OperatorSettings.js";
import Geo from "./position/Geo.js";

const FORMAT_VERSION = 1;

// slot names. the pre-EMCOMM one is written only when converting, so routine
// use of the backup button cannot replace the way home with the stripped
// configuration it was meant to undo
const SLOT_PRE_EMCOMM = "pre-emcomm";
const SLOT_LATEST = "latest";

const STORAGE_PREFIX = "node_backup";

// channels are read by index until one cannot be read. that is also what a real
// gap looks like, so a bound is needed rather than trusting the loop to end
// the radio's own count, so a channel above slot 16 is in the way home too
const CHANNEL_SLOTS_FALLBACK = 16;

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
    /**
     * @param {object} [options]
     * @param {boolean} [options.reread] Read the contacts again first. A caller that
     *   has only just read them should pass false and save the radio the work.
     */
    static async capture({ reread = true } = {}) {

        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(Connection.DISCONNECTED);
        }

        const warnings = [];

        // fresh, not the copy cached at connect time
        const selfInfo = await Connection.exclusive(() => connection.getSelfInfo());

        // Re-read and merge until complete: over Bluetooth a single read comes back
        // short, and this is the one place that must not be.
        //
        // **Unless the caller has just done exactly that.** The connect reads the whole
        // list and merges passes until it is complete or out of time, and then this ran
        // the same expensive read again -- 260 contacts twice on every connect. On node
        // 2 the connect merged its way to 194 of 260 in 127 s, and this second read
        // reached only 160 and replaced the better list with it. The read that exists
        // because it must not be short produced a shorter list than the one it
        // overwrote, and left the app showing the worse of the two.
        //
        // Skipping it is not a shortcut: `contactsMissing` says whether the list in
        // hand is complete, and it is recorded below either way, so a short list is
        // still marked short. What is lost is only a second chance at the same link,
        // which the evidence says is as likely to make things worse as better.
        if(reread){
            await Connection.loadContacts();
        }
        const contacts = GlobalState.contacts;

        if(GlobalState.contactsMissing > 0){
            warnings.push(`${GlobalState.contactsMissing} of ${GlobalState.contactsAnnounced} contacts could not be read.`);
        }

        const read = await this.captureChannels(connection, warnings);
        const channels = read.channels;

        return {
            formatVersion: FORMAT_VERSION,
            capturedAt: Date.now(),
            // what this backup knows it is missing, so a caller can refuse to
            // rely on it rather than reading the warnings as prose
            missing: {
                contacts: GlobalState.contactsMissing ?? 0,
                contactsAnnounced: GlobalState.contactsAnnounced ?? null,
                channelSlots: read.missingSlots,
                // slots that errored; with no channels read at all this is the only
                // sign that the radio was not simply empty
                channelSlotsUnreadable: read.unreadable ?? 0,
            },
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
                // the rest of the same radio command: telemetry permissions, which
                // decide who may ask this radio for its position, the advert
                // location policy and multi acks. EMCOMM mode changes the first,
                // so leaving it has to be able to put them back
                ...(Array.isArray(selfInfo.reserved) || ArrayBuffer.isView(selfInfo.reserved) ? {
                    telemetryModes: selfInfo.reserved[2],
                    advertLocPolicy: selfInfo.reserved[1],
                    multiAcks: selfInfo.reserved[0],
                } : {}),
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
            // what this app keeps for the node in the browser rather than on the
            // radio. EMCOMM mode is where repeating adverts and position answering
            // are most likely to be turned on, so leaving it puts these back too
            app: this.captureApp(Utils.bytesToHex(selfInfo.publicKey)),
            warnings: warnings,
        };

    }

    static captureApp(nodePublicKeyHex) {
        return {
            advertSchedule: AdvertSchedule.get(nodePublicKeyHex),
            positionSettings: PositionService.settings(nodePublicKeyHex),
            // the net may run on zulu while this operator does not. The callsign
            // is not here: it names the person, not the node, and one typed
            // during an incident should not be taken away on leaving
            dtgZone: OperatorSettings.state.dtgZone,
        };
    }

    /** Puts back the app's own settings for the node, when the backup has them. */
    static restoreApp(backup) {
        const app = backup.app;
        const key = backup.nodePublicKey;
        if(app == null || key == null){
            return false;
        }
        if(app.advertSchedule){
            AdvertSchedule.set(key, app.advertSchedule);
            // the schedule runs for the connected radio only
            if(GlobalState.selfInfo && Utils.bytesToHex(GlobalState.selfInfo.publicKey) === key){
                AdvertSchedule.start(key);
            }
        }
        if(app.positionSettings){
            PositionService.saveSettings(app.positionSettings, key);
        }
        if(app.dtgZone){
            OperatorSettings.setDtgZone(app.dtgZone);
        }
        return true;
    }

    /**
     * What the node holds now that the backup does not: contacts, and channels in
     * slots the backup had empty. Read from the device for channels, since the
     * list shown falls back to defaults when the device does not answer.
     */
    static async extras(backup) {
        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(Connection.DISCONNECTED);
        }
        await Connection.loadContacts();
        const backedUp = new Set(backup.contacts.map((c) => c.publicKey));
        const contacts = GlobalState.contacts.filter((c) => !backedUp.has(Utils.bytesToHex(c.publicKey)));
        const channelSlots = new Set(backup.channels.map((c) => c.idx));
        const channels = (await this.captureChannels(connection, [])).channels.filter((c) => !channelSlots.has(c.idx));
        return { contacts, channels };
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
        const failed = [];
        let unreadable = 0;
        let lastAnswered = -1;

        const slots = await Slots.count();

        for(let idx = 0; idx < slots; idx++){

            let channel = null;
            try {
                // through Connection, which checks the answer belongs to the slot
                // asked for: the library resolves a read with whatever channel
                // info arrives next, so a late reply lands on the following slot
                channel = await Connection.getChannel(idx);
                lastAnswered = idx;
            } catch(e) {
                // an empty slot and an unreadable one look the same from here, so
                // keep going rather than assuming the list has ended
                unreadable++;
                failed.push(idx);
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

        // A radio with fewer slots than this asks for errors on the ones past its
        // end, so a failure on its own means nothing. A failure with a slot after
        // it that answered is a hole, and a hole in a backup is a channel the
        // radio does not get back.
        const gaps = failed.filter((idx) => idx < lastAnswered);
        if(gaps.length > 0){
            warnings.push(`Channel slot${gaps.length === 1 ? "" : "s"} ${gaps.join(", ")} would not read, `
                + `so ${gaps.length === 1 ? "a channel" : "channels"} may be missing from this backup.`);
        }
        // Reported structurally as well as in the prose above. A radio that answered
        // no slot at all leaves `gaps` empty -- there is no slot after the failures to
        // prove they were holes -- so a total failure and a radio with no channels are
        // indistinguishable by count. A caller deciding whether to overwrite the way
        // home has to be able to tell them apart, and warnings are not for reading.
        return { channels: channels, missingSlots: gaps, unreadable: unreadable };

    }

    /**
     * What this backup is missing, in the operator's words, or null when it is
     * whole.
     *
     * The pre-EMCOMM backup is the way home and is never replaced while the
     * station is away from normal mode, so anything missing from it is missing
     * for the whole incident. On the bench node 2's read was 13 contacts short
     * and the switch was held back by hand; the app should be the one holding it
     * back.
     */
    static shortfall(backup) {

        if(backup == null){
            return "there is no backup at all";
        }

        const missing = backup.missing ?? {};
        const parts = [];

        if(missing.contacts > 0){
            parts.push(`${missing.contacts}`
                + `${missing.contactsAnnounced ? " of " + missing.contactsAnnounced : ""} contacts could not be read`);
        }
        const slots = missing.channelSlots ?? [];
        if(slots.length > 0){
            parts.push(`channel slot${slots.length === 1 ? "" : "s"} ${slots.join(", ")} would not read`);
        }

        return parts.length === 0 ? null : parts.join(", and ");

    }

    /**
     * Writes a backup back to the node.
     *
     * Additive unless told otherwise: it restores settings, channels and
     * contacts, and reports any contact the node holds that the backup does not.
     *
     * Leaving EMCOMM mode is meant to put the node back as it was, so it can pass
     * `remove`: the contacts and channels found by extras() that the operator has
     * agreed to remove. Nothing is removed without that list, so an ordinary
     * restore still never deletes anything.
     */
    static async restore(backup, onProgress = () => {}, { remove = null, keepPosition = false } = {}) {

        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(Connection.DISCONNECTED);
        }

        if(backup?.formatVersion !== FORMAT_VERSION){
            throw new Error("This backup was written by a different version of the app.");
        }

        const failures = [];
        const settings = backup.settings;

        const removeContacts = remove?.contacts ?? [];
        const removeChannels = remove?.channels ?? [];
        const steps = 5 + backup.channels.length + backup.contacts.length + removeContacts.length + removeChannels.length;
        let done = 0;
        const step = (what) => onProgress({ done: ++done, total: steps, what: what });

        // settings first: they are few, and a failure here is worth knowing about
        // before spending minutes on contacts
        await this.attempt(failures, "name", () => Connection.setAdvertName(settings.name));
        step("name");
        // The position is not part of a mode, and the settings page says so in
        // those words: "it stays as it is through every switch". Coming home has
        // to leave it alone, so `keepPosition` is set by the way home.
        //
        // The backup holds the position as it was when the backup was taken --
        // at connect, before the incident -- so writing that back silently undid
        // a position entered by hand during the incident. A station without GPS
        // is the only kind that enters one by hand, which makes it exactly the
        // station that cannot afford to lose it: its adverts go back to carrying
        // no position and nothing says so. Found on the bench: a position set by
        // hand at 19:02 was gone after a round trip through normal mode.
        //
        // An explicit restore (Load last backup, Load from file) still writes it.
        // There the operator has asked for the recorded settings to be put back.
        // Even then a backup with no position never clears one set since:
        // restoring "adds them back and removes nothing", as the page promises.
        if(keepPosition){
            step("position left as it is");
        } else if(!Geo.isPosition(settings.advLat / 1e6, settings.advLon / 1e6)){
            // the radio holds these as whole micro-degrees, so they are divided
            // before the check: 31761900 is 31.761900 and not an impossible latitude
            step("position left as it is");
        } else {
            await this.attempt(failures, "position", () => Connection.setAdvertLatLong(settings.advLat, settings.advLon));
            step("position");
        }
        await this.attempt(failures, "transmit power", () => Connection.setTxPower(settings.txPower));
        step("transmit power");
        await this.attempt(failures, "radio settings", () => Connection.setRadioParams(
            settings.radioFreq, settings.radioBw, settings.radioSf, settings.radioCr,
        ));
        step("radio settings");

        // a backup from before these were kept restores the add contacts mode
        // alone, as it always did
        if(settings.telemetryModes != null){
            await this.attempt(failures, "add contacts mode and location sharing", () => Connection.setAllOtherParams({
                manualAddContacts: settings.manualAddContacts === 1,
                telemetryModes: settings.telemetryModes,
                advertLocPolicy: settings.advertLocPolicy ?? 0,
                multiAcks: settings.multiAcks ?? 0,
            }));
            step("add contacts mode and location sharing");
        } else {
            await this.attempt(failures, "add contacts mode", () => Connection.setOtherParams(settings.manualAddContacts === 1));
            step("add contacts mode");
        }

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

        // what was added since the backup, when the operator chose to remove it
        for(const contact of removeContacts){
            const name = contact.advName || Utils.bytesToHex(contact.publicKey).slice(0, 8);
            await this.attempt(failures, `removing ${name}`, () => Connection.removeContact(contact.publicKey));
            step(`removing ${name}`);
        }
        for(const channel of removeChannels){
            await this.attempt(failures, `clearing channel ${channel.name}`, () => Connection.deleteChannel(channel.idx));
            step(`clearing channel ${channel.name}`);
        }

        this.restoreApp(backup);

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

    /**
     * True when this capture did not manage to read the radio properly.
     *
     * Only the channels are judged here. A channel's key cannot be heard again, so a
     * capture that could not read them is not a picture of the radio and must never
     * replace one that is -- `captureNormal` already refuses outright on a short read
     * for exactly this reason, and the backup had no equivalent.
     *
     * Found on node 2 over Bluetooth on 29 Sep: a slow link returned no channels at
     * all, and the guard announced "8 channels are missing -- 8 recorded, 0 on the
     * radio" with the wording reserved for something unrecoverable. It was a failed
     * read. The alarm that matters most is the one that must not cry wolf.
     */
    static captureIsDegraded(backup) {
        const missing = backup?.missing;
        if(missing == null){
            return false;
        }
        // A hole: a slot that would not read with a slot after it that did.
        if((missing.channelSlots?.length ?? 0) > 0){
            return true;
        }
        // Nothing answered at all. The count on its own is not enough and the first
        // version of this used it: a radio with fewer slots than the app asks for
        // errors on the ones past its end, so `unreadable` is above zero on a
        // perfectly good read. Only a failure with nothing read is a failed read.
        return (backup.channels?.length ?? 0) === 0 && (missing.channelSlotsUnreadable ?? 0) > 0;
    }

    /**
     * What a fresh capture would cost the stored one, if anything.
     *
     * The way home is refreshed on every normal-mode connect, deliberately: it is how
     * a channel added with another app becomes part of it, and node 3 lost a channel
     * to a record three days old. But the refresh had no guard, so a connect that
     * followed a bad round trip wrote the diminished radio straight over the good
     * record. On 29 Sep that turned 253 contacts into 211, then 210, and the evidence
     * of the loss went with it.
     *
     * Returns null when the fresh capture costs nothing worth asking about, or
     * `{ contactsLost, channelsLost }` when it does.
     *
     * The two are judged differently on purpose:
     *
     *  * **Any channel lost asks.** Channels are few, each one is deliberate, and they
     *    carry secrets that cannot be recovered by waiting. Losing one is never
     *    housekeeping.
     *  * **Contacts have to drop materially.** They come and go on their own -- a
     *    contact forgotten on purpose is ordinary, and a station re-adverts and comes
     *    back by itself. Asking about one or two would train the operator to dismiss
     *    this unread, which is the habit that would make it useless when it matters.
     *    More than ten, or more than a fifth of them, is not housekeeping.
     */
    static shrinkage(stored, fresh) {
        if(stored == null || fresh == null){
            return null;
        }
        const storedContacts = stored.contacts?.length ?? 0;
        const freshContacts = fresh.contacts?.length ?? 0;
        const storedChannels = stored.channels?.length ?? 0;
        const freshChannels = fresh.channels?.length ?? 0;

        // Contacts the fresh read is known to have missed are not contacts the radio
        // lost. Node 2's own stored backup records 33 of 258 unread, so a roster that
        // reads short every time would otherwise raise this alarm every time.
        const freshUnread = fresh.missing?.contacts ?? 0;
        const contactsLost = storedContacts - (freshContacts + freshUnread);
        const channelsLost = storedChannels - freshChannels;

        const contactsMatter = contactsLost > 10 || (contactsLost > 0 && contactsLost >= storedContacts / 5);
        const channelsMatter = channelsLost > 0;
        if(!contactsMatter && !channelsMatter){
            return null;
        }
        return {
            contactsLost: Math.max(0, contactsLost),
            channelsLost: Math.max(0, channelsLost),
            storedContacts,
            freshContacts,
            storedChannels,
            freshChannels,
            capturedAt: stored.capturedAt ?? null,
        };
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
