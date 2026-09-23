// Putting a station into a mode.
//
// A mode is written to the radio, not pretended at: the radio's settings and its
// channel slots really change, so what it can hear changes with them. That is the
// point, and it is also why this is deliberate, reported step by step, and always
// undoable.
//
// The way home is a full backup taken before the first switch away from normal,
// kept in its own slot so a routine backup during an incident cannot replace it.
// Switching back to normal writes that backup, which is where the contacts come
// from: a mode profile holds settings and channels, never contacts.
//
// Order matters. Settings first, because a failure there is worth knowing about
// before minutes of channel and contact writes. Channels next, so the radio is
// on the right ones before anything is announced. Contacts last, because that is
// the slow half.

import GlobalState from "../GlobalState.js";
import Connection from "../Connection.js";
import Utils from "../Utils.js";
import EmcommMode from "../EmcommMode.js";
import NodeBackup from "../NodeBackup.js";
import AdvertSchedule from "../AdvertSchedule.js";
import PositionService from "../position/PositionService.js";
import ModeProfiles from "./ModeProfiles.js";

const MAX_CHANNEL_SLOTS = 16;

class ModeSwitch {

    /**
     * What switching to a mode would do, in the operator's words, so it can be
     * shown before anything is written. Read only.
     */
    static async describe(mode, nodeKeyHex = ModeProfiles.nodeKeyHex()) {

        const profile = await ModeProfiles.profileOrDefault(mode, nodeKeyHex);
        const current = GlobalState.selfInfo;
        const changes = [];

        if(profile.radio.name && profile.radio.name !== current?.name){
            changes.push(`Name becomes ${profile.radio.name}, from ${current?.name ?? "unknown"}.`);
        }
        if(profile.radio.radioFreq != null && !EmcommMode.radioMatches(current, profile.radio)){
            changes.push(`Radio becomes ${profile.radio.radioFreq} kHz, BW ${profile.radio.radioBw}, SF ${profile.radio.radioSf}, CR ${profile.radio.radioCr}. Stations on the old settings cannot hear this one.`);
        }
        if(profile.radio.txPower != null && profile.radio.txPower !== current?.txPower){
            changes.push(`Transmit power becomes ${profile.radio.txPower} dBm, from ${current?.txPower ?? "unknown"}.`);
        }

        // "Any other channel is cleared from the radio" was true of the slots and
        // wrong about the consequence, which is what an operator reads it for.
        // A channel whose name says emcomm is carried into the mode being
        // entered, and any other channel the new mode does not hold is written
        // into the mode being left, keys and all, so nothing is destroyed.
        // Reading the radio here would cost sixteen reads in front of a dialog,
        // so this uses the channel list already loaded.
        const channels = profile.channels.map((c) => c.name);
        changes.push(channels.length === 0
            ? "Every channel is cleared from the radio."
            : `Channels become: ${channels.join(", ")}.`);

        const held = new Set(profile.channels.map((c) => (c.name ?? "").trim().toLowerCase()));
        const onRadio = (GlobalState.channels ?? []).filter((c) => (c.name ?? "").trim() !== "");
        const carried = onRadio.filter((c) => ModeProfiles.carriesInto(c.name, mode) && !held.has(c.name.trim().toLowerCase()));
        const archived = onRadio.filter((c) => !ModeProfiles.carriesInto(c.name, mode) && !held.has(c.name.trim().toLowerCase()));

        if(carried.length > 0){
            changes.push(`${carried.map((c) => c.name).join(", ")} `
                + `${carried.length === 1 ? "is an emcomm channel, so it is carried over as well" : "are emcomm channels, so they are carried over as well"}.`);
        }
        if(archived.length > 0){
            changes.push(`${archived.map((c) => c.name).join(", ")} `
                + `${archived.length === 1 ? "leaves the radio's slots but is kept" : "leave the radio's slots but are kept"} `
                + `in ${ModeProfiles.label(ModeProfiles.current(nodeKeyHex))}, with ${archived.length === 1 ? "its key" : "their keys"}, `
                + "so switching back restores it.");
        }

        if(mode === "normal"){
            changes.push("Contacts are written back from the backup taken before this station left normal mode.");
        } else if(profile.trimContacts){
            changes.push("Companions are cleared, and repeaters and rooms not heard in 90 days are dropped. The backup keeps them.");
        }

        if(profile.positionFromGps){
            changes.push("The advert position is taken from a live GPS fix, if there is one.");
        }
        if(profile.announce === "flood"){
            changes.push("A flood advert goes out, so the whole mesh learns this station is up.");
        } else if(profile.announce === "zerohop"){
            changes.push("A zero hop advert goes out, so stations in direct range learn this station is up.");
        }
        if(profile.discoverRepeaters){
            changes.push("Repeaters in direct range are searched for.");
        }
        if(profile.markDrill){
            changes.push("Everything sent is marked DRILL.");
        }

        return { profile: profile, changes: changes };

    }

    /**
     * Switches the station into a mode. onProgress({ what, done, total }).
     *
     * Every step is attempted on its own and failures are collected: stopping
     * halfway leaves a radio that is in neither mode, which is worse than one
     * that is in the new mode with a named setting that would not take.
     */
    /**
     * Thrown when the backup that would be the way home is short of what the
     * radio holds. The caller can ask the operator and call again with
     * `{ acceptIncompleteBackup: true }`.
     */
    static INCOMPLETE_BACKUP = "the way home would be incomplete";

    static async apply(mode, onProgress = () => {}, { acceptIncompleteBackup = false } = {}) {

        if(GlobalState.connection == null){
            throw new Error(Connection.DISCONNECTED);
        }

        const nodeKeyHex = ModeProfiles.nodeKeyHex();
        const from = ModeProfiles.current(nodeKeyHex);
        // what other stations know this node as, to tell whether to advert after
        const nameBefore = GlobalState.selfInfo?.name ?? null;
        const profile = await ModeProfiles.profileOrDefault(mode, nodeKeyHex);
        const failures = [];
        const warnings = [];

        // the way home, before the first change of any kind. Taken only when
        // leaving normal, and never replaced while away from it
        if(from === "normal" && mode !== "normal" && NodeBackup.load(nodeKeyHex, NodeBackup.SLOT_PRE_EMCOMM) == null){
            onProgress({ what: "Backing up before any change" });
            const backup = await NodeBackup.capture();

            // This backup is never replaced while the station is away from normal
            // mode, so whatever is missing from it is missing for the whole
            // incident: contacts that will not come back, channels whose keys are
            // gone. On the bench node 2's read was 13 contacts short and the
            // switch was held back by hand. The app holds it back now, and
            // nothing is written or saved until the operator says to go anyway.
            const shortfall = NodeBackup.shortfall(backup);
            if(shortfall != null && !acceptIncompleteBackup){
                const refusal = new Error(`${this.INCOMPLETE_BACKUP}: ${shortfall}`);
                refusal.shortfall = shortfall;
                refusal.incompleteBackup = true;
                throw refusal;
            }

            if(!NodeBackup.save(backup, NodeBackup.SLOT_PRE_EMCOMM)){
                throw new Error("the backup could not be saved, so nothing was changed");
            }
            for(const warning of backup.warnings){
                warnings.push(warning);
            }
            if(shortfall != null){
                warnings.push(`The way home is incomplete and will not be taken again while this station is `
                    + `away from normal mode: ${shortfall}.`);
            }
        }

        const attempt = async (what, action) => {
            onProgress({ what: what });
            try {
                await action();
            } catch(e) {
                failures.push({ what: what, reason: String(e?.message ?? e) });
            }
        };

        // --- the radio's own settings

        if(profile.radio.name){
            await attempt("the node name", () => Connection.setAdvertName(profile.radio.name));
        }
        if(profile.radio.radioFreq != null){
            await attempt("the radio settings", () => Connection.setRadioParams(
                profile.radio.radioFreq, profile.radio.radioBw, profile.radio.radioSf, profile.radio.radioCr,
            ));
        }
        if(profile.radio.txPower != null){
            await attempt("transmit power", () => Connection.setTxPower(profile.radio.txPower));
        }
        await attempt("sharing, adverts and acknowledgements", () => EmcommMode.applyRadioPolicies({
            shareLocation: profile.radio.shareLocation,
            advertPosition: profile.radio.advertPosition,
            multiAcks: profile.radio.multiAcks,
        }));
        await attempt("how contacts are added", () => EmcommMode.setManualAddContacts(!profile.radio.autoAddContacts));

        if(profile.syncClock){
            await attempt("the radio's clock", () => Connection.syncDeviceTime());
        }
        if(profile.positionFromGps){
            await attempt("the position from the GPS", async () => {
                const result = await PositionService.updateFromGps();
                if(!result.updated){
                    throw new Error(`${result.reason}, so the position was left alone`);
                }
            });
        }

        // --- channels: the mode's own, in order, and nothing else

        // What is on the radio now decides two things. A channel whose name says
        // emcomm is emergency work whatever mode the station is in, so it is
        // carried into the mode being entered rather than cleared. Anything else
        // the new mode does not hold is written into the mode being left, because
        // a private channel's random key is on the radio and nowhere else, and
        // clearing its slot would destroy it with no way back
        try {

            const read = await ModeProfiles.readChannelsWithFailures();
            const onRadio = read.channels;
            if(onRadio.length === 0 && read.unreadable === MAX_CHANNEL_SLOTS){
                throw new Error("the radio answered no channel at all");
            }

            const key = (channel) => JSON.stringify([channel.name, channel.secret]);
            const inTarget = new Set(profile.channels.map(key));

            const carried = onRadio.filter((c) => ModeProfiles.carriesInto(c.name, mode) && !inTarget.has(key(c)));
            if(carried.length > 0){
                profile.channels = [
                    ...profile.channels,
                    ...carried.map((c) => ({ name: c.name, secret: c.secret, answerPositions: false })),
                ].slice(0, MAX_CHANNEL_SLOTS);
                ModeProfiles.saveProfile(mode, profile, nodeKeyHex);
                for(const channel of carried){
                    inTarget.add(key(channel));
                }
                warnings.push(`${carried.map((c) => c.name).join(", ")} ${carried.length === 1 ? "is an emcomm channel, so it was" : "are emcomm channels, so they were"} carried into ${ModeProfiles.label(mode)}.`);
            }

            const leaving = ModeProfiles.profile(from, nodeKeyHex);
            if(leaving != null){
                const known = new Set(leaving.channels.map(key));
                const kept = onRadio.filter((c) => !inTarget.has(key(c)) && !known.has(key(c)));
                if(kept.length > 0){
                    leaving.channels = [
                        ...leaving.channels,
                        ...kept.map((c) => ({ name: c.name, secret: c.secret, answerPositions: false })),
                    ].slice(0, MAX_CHANNEL_SLOTS);
                    ModeProfiles.saveProfile(from, leaving, nodeKeyHex);
                    warnings.push(`${kept.map((c) => c.name).join(", ")} ${kept.length === 1 ? "was" : "were"} on the radio but in no mode, so ${kept.length === 1 ? "it was" : "they were"} kept in ${ModeProfiles.label(from)} rather than lost.`);
                }
            }

        } catch(e) {
            warnings.push(`The radio's channels could not be read before writing the new ones, so any channel in no mode may have been lost: ${e?.message ?? e}`);
        }

        // Going home, the backup owns the channels. It records the slot each one
        // was in, and the restore below writes them back there; writing the
        // profile's list from slot 0 as well leaves the radio holding both copies.
        //
        // Node 2 proved it on the bench: eight channels at slots 0, 1, 4, 7, 8,
        // 10, 11 and 13 came home as twelve occupied slots, with #elp-mesh,
        // #joebot, #silvercity and #elp-test each in two places. Slot numbers are
        // part of "the radio exactly as it was", so the backup's layout wins and
        // this only clears the way for it.
        const homeBackup = mode === "normal" ? NodeBackup.load(nodeKeyHex, NodeBackup.SLOT_PRE_EMCOMM) : null;
        const backupOwnsChannels = (homeBackup?.channels?.length ?? 0) > 0;

        const marked = [];
        for(let idx = 0; idx < MAX_CHANNEL_SLOTS; idx++){
            const channel = backupOwnsChannels ? null : profile.channels[idx];
            if(channel){
                await attempt(`the channel ${channel.name}`, () => Connection.setChannel(idx, channel.name, Utils.hexToBytes(channel.secret)));
                if(channel.answerPositions){
                    marked.push(idx);
                }
            } else {
                // clearing a slot that is already empty costs one write and keeps
                // this simple; the radio does not mind
                await attempt(`clearing channel slot ${idx}`, () => Connection.deleteChannel(idx));
            }
        }

        // the marks follow the slots the backup will write, so a channel answering
        // position requests keeps doing it at the slot it comes back in
        if(backupOwnsChannels){
            const answering = new Set(profile.channels.filter((c) => c.answerPositions).map((c) => c.name));
            for(const channel of homeBackup.channels){
                if(answering.has(channel.name) && channel.idx != null){
                    marked.push(channel.idx);
                }
            }
        }

        // --- this app's own settings for the node

        PositionService.saveSettings({
            markedChannels: marked,
            markedRooms: profile.rooms.filter((r) => r.answerPositions).map((r) => r.keyHex),
            autoAnswer: profile.autoAnswerPositions === true,
        }, nodeKeyHex);

        AdvertSchedule.set(nodeKeyHex, profile.adverts);
        AdvertSchedule.start(nodeKeyHex);

        // --- contacts: back from the backup, or trimmed for an incident

        if(mode === "normal"){
            const backup = homeBackup;
            if(backup == null){
                warnings.push("There was no backup from before this station left normal mode, so contacts were left as they are.");
            } else {
                onProgress({ what: "the contacts from the backup" });
                const result = await NodeBackup.restore(backup, (p) => onProgress({ what: p.what, done: p.done, total: p.total }));
                for(const failure of result.failures){
                    failures.push(failure);
                }
                if(result.notInBackup.length > 0){
                    warnings.push(`${result.notInBackup.length} contact(s) met since are not in the backup and were left alone: ${result.notInBackup.slice(0, 5).join(", ")}${result.notInBackup.length > 5 ? "..." : ""}`);
                }
            }
        } else if(profile.trimContacts){
            const plan = EmcommMode.planTrim(GlobalState.contacts);
            const result = await EmcommMode.trim(plan, (p) => onProgress({ what: `removing ${p.what}`, done: p.done, total: p.total }));
            warnings.push(`${result.removed} contact(s) removed, ${GlobalState.contacts.length} left.`);
            if(result.notRemoved.length > 0){
                warnings.push(`${result.notRemoved.length} could not be removed: ${result.notRemoved.slice(0, 5).join(", ")}${result.notRemoved.length > 5 ? "..." : ""}`);
            }
        }

        // --- read the radio back, and only then say it is in the mode

        onProgress({ what: "reading the radio back" });
        await Connection.loadSelfInfo(Connection.READ_TIMEOUT_MILLIS);
        await Connection.loadChannels();
        ModeProfiles.setCurrent(mode, nodeKeyHex);
        GlobalState.emcommModeRevision += 1;

        // --- announcing, last, so the radio is right before anything goes out

        if(profile.announce === "flood" || profile.announce === "zerohop"){
            await attempt("announcing the station", () => EmcommMode.announce(profile.announce === "flood"));
        } else if(profile.radio.name && profile.radio.name !== nameBefore){
            // stations in range still know the old name until something says so
            await attempt("telling stations in range the name", () => Connection.sendZeroHopAdvert());
        }

        if(profile.discoverRepeaters){
            onProgress({ what: "looking for repeaters in direct range" });
            try {
                const found = await Connection.discoverRepeaters();
                warnings.push(found.length === 0
                    ? "No repeater answered the search. That is a normal result, not an error."
                    : `${found.length} repeater(s) answered. Add them from the Repeater Search tab.`);
            } catch(e) {
                warnings.push(`The repeater search did not run: ${e?.message ?? e}`);
            }
        }

        return { mode: mode, from: from, failures: failures, warnings: warnings };

    }

}

export default ModeSwitch;
