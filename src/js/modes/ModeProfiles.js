// The three modes a station runs in, and what each one holds.
//
//   normal    the radio as it was found: the settings, channels and rooms the
//             operator already had. Captured from the radio the first time this
//             app connects to it, and never guessed at.
//   live      a real incident.
//   training  a drill. The same as live in every way except its own channels and
//             rooms, and that everything it sends is marked DRILL.
//
// A mode is a whole configuration, not a flag: radio settings, channels, rooms,
// which of them answer position requests, and the repeating advert intervals.
// Switching writes it to the radio (see ModeSwitch), so the radio really is in
// that mode rather than the app pretending.
//
// Kept per node, in this browser, because the radio has nowhere to put it. A node
// configured from another machine reads as whatever this browser last set here,
// which is why the banner says what the app believes rather than what it knows.

import { reactive } from "vue";
import GlobalState from "../GlobalState.js";
import Utils from "../Utils.js";
import EmcommMode from "../EmcommMode.js";
import Slots from "../channels/Slots.js";

const STORAGE_PREFIX = "station_modes";

// the order they are listed in, top to bottom on the switch screen and left to
// right in settings: normal, then the drill, then the real thing
export const MODES = ["normal", "training", "live"];

export const MODE_LABELS = {
    normal: "Normal mode",
    live: "Emcomm-Live",
    training: "Emcomm-Training",
};

// black on the mode's colour, which is the pairing that stays readable in
// sunlight and to the colour blind, since the words say it too
export const MODE_CLASSES = {
    normal: "bg-green-500 text-black",
    live: "bg-red-500 text-black",
    training: "bg-yellow-400 text-black",
};

// the channel each emcomm mode starts with. A default, not a rule: an operator
// who removes it in the settings tab meant to, and it stays removed
export const DEFAULT_CHANNELS = {
    live: "#Emcomm",
    training: "#Emcomm-Training",
};

// A channel whose name says emcomm belongs to emergency work whichever mode the
// station is in, so it is carried into every mode rather than cleared with the
// rest. This is what keeps a net's own channel, and the bench's Emcomm Testing,
// on the radio across a switch
const KEEP_ACROSS_MODES = /emcomm/i;

const state = reactive({
    // bumped on every change, since browser storage is not reactive
    revision: 0,
});

class ModeProfiles {

    static get state() {
        return state;
    }

    static storageKey(nodeKeyHex) {
        return `${STORAGE_PREFIX}:${nodeKeyHex}`;
    }

    static nodeKeyHex() {
        const key = GlobalState.selfInfo?.publicKey;
        return key ? Utils.bytesToHex(key) : null;
    }

    /** Everything kept for a node: which mode it is in, and the three profiles. */
    static read(nodeKeyHex = this.nodeKeyHex()) {
        void state.revision;
        const empty = { current: "normal", profiles: {} };
        if(nodeKeyHex == null){
            return empty;
        }
        try {
            const stored = JSON.parse(window.localStorage.getItem(this.storageKey(nodeKeyHex)) ?? "null");
            return {
                current: MODES.includes(stored?.current) ? stored.current : "normal",
                profiles: typeof stored?.profiles === "object" && stored.profiles !== null ? stored.profiles : {},
            };
        } catch(e) {
            return empty;
        }
    }

    static write(stored, nodeKeyHex = this.nodeKeyHex()) {
        if(nodeKeyHex == null){
            return false;
        }
        try {
            window.localStorage.setItem(this.storageKey(nodeKeyHex), JSON.stringify(stored));
            state.revision++;
            return true;
        } catch(e) {
            console.log("could not save the station's modes", e);
            return false;
        }
    }

    /** Which mode this node is in, as far as this browser knows. */
    static current(nodeKeyHex = this.nodeKeyHex()) {
        return this.read(nodeKeyHex).current;
    }

    static setCurrent(mode, nodeKeyHex = this.nodeKeyHex()) {
        const stored = this.read(nodeKeyHex);
        stored.current = MODES.includes(mode) ? mode : "normal";
        return this.write(stored, nodeKeyHex);
    }

    static label(mode) {
        return MODE_LABELS[mode] ?? MODE_LABELS.normal;
    }

    /** An empty profile, so every reader can rely on the shape. */
    static blank() {
        return {
            radio: {
                name: "",
                radioFreq: null, radioBw: null, radioSf: null, radioCr: null,
                txPower: null,
                shareLocation: false,
                advertPosition: false,
                multiAcks: false,
                autoAddContacts: false,
            },
            // written to the radio's slots in this order when the mode is entered
            channels: [],
            // room servers this mode uses, by contact key
            rooms: [],
            autoAnswerPositions: false,
            adverts: { zeroHopMinutes: 0, floodMinutes: 0 },
            // everything sent in this mode is marked DRILL
            markDrill: false,
            // clear companions and long quiet repeaters on entering
            trimContacts: false,
            // set the radio's clock from this device on entering
            syncClock: true,
            // take the advert position from a live GPS fix on entering
            positionFromGps: false,
            // how to announce the station once it is in the mode
            announce: "none",
            // look for repeaters in direct range on entering
            discoverRepeaters: false,
        };
    }

    /** Whether a channel's name means it is kept in every mode. */
    static keepsAcrossModes(name) {
        return KEEP_ACROSS_MODES.test(name ?? "");
    }

    /**
     * Whether a channel on the radio is carried into the mode being entered.
     *
     * A channel whose name says emcomm is carried, which is what keeps a net's
     * own channel and the bench's Emcomm Testing across a switch. **A mode's own
     * default channel is the exception**: `#Emcomm` and `#Emcomm-Training` are
     * part of a mode's configuration rather than channels the operator built, so
     * they stay with their mode. Normal mode comes back as the radio was, with no
     * `#Emcomm-Training` slot left behind in it, and a drill does not end up
     * holding the live incident channel.
     *
     * Nothing is lost either way: a channel not carried is written into the mode
     * being left, key and all, so switching back restores it.
     */
    static carriesInto(name, targetMode) {

        if(!this.keepsAcrossModes(name)){
            return false;
        }

        const wanted = (name ?? "").trim().toLowerCase();
        for(const [mode, channel] of Object.entries(DEFAULT_CHANNELS)){
            if(mode !== targetMode && channel.trim().toLowerCase() === wanted){
                return false;
            }
        }
        return true;

    }

    static defaultChannel(mode) {
        return DEFAULT_CHANNELS[mode] ?? null;
    }

    /** A profile, filled out from what is stored, or the defaults for that mode. */
    static profile(mode, nodeKeyHex = this.nodeKeyHex()) {
        const stored = this.read(nodeKeyHex).profiles[mode];
        const blank = this.blank();
        if(stored == null){
            return null;
        }
        return {
            ...blank,
            ...stored,
            radio: { ...blank.radio, ...(stored.radio ?? {}) },
            channels: Array.isArray(stored.channels) ? stored.channels.map((c) => ({ ...c })) : [],
            rooms: Array.isArray(stored.rooms) ? stored.rooms.map((r) => ({ ...r })) : [],
            adverts: { ...blank.adverts, ...(stored.adverts ?? {}) },
        };
    }

    static saveProfile(mode, profile, nodeKeyHex = this.nodeKeyHex()) {
        const stored = this.read(nodeKeyHex);
        stored.profiles = { ...stored.profiles, [mode]: profile };
        return this.write(stored, nodeKeyHex);
    }

    /**
     * The normal profile, read from the radio as it stands.
     *
     * This is what "normal" means: not a set of recommended settings, but the
     * station as its owner had it before any of this. Taken once, when the app
     * first sees a node, and again only when the operator asks.
     */
    static async captureNormal(nodeKeyHex = this.nodeKeyHex()) {

        const selfInfo = GlobalState.selfInfo;
        if(selfInfo == null){
            throw new Error("the radio has not been read yet");
        }

        const Connection = (await import("../Connection.js")).default;
        const params = Connection.otherParams(selfInfo);

        // Normal mode is the way home: it is what gets written back when the
        // operator leaves an emcomm mode, and a channel missing from it is a
        // channel the radio never gets back. A slot that would not read is not
        // an empty slot, and the two are indistinguishable once this is saved,
        // so a short read is read again and then refused outright. Better no
        // normal profile, which the next connect will take, than a confident
        // wrong one.
        const short = (r) => r.gaps.length > 0 || r.gaveUp;
        let read = await this.readChannelsWithFailures();
        if(short(read)){
            read = await this.readChannelsWithFailures();
        }
        if(short(read)){
            throw new Error(read.gaveUp
                ? "the radio's channels would not read in time, so its own settings were not recorded"
                : `channel slot${read.gaps.length === 1 ? " " + read.gaps[0] : "s " + read.gaps.join(", ")} `
                    + "would not read, so this radio's own settings were not recorded");
        }

        const channels = [];
        for(const channel of read.channels){
            channels.push({ name: channel.name, secret: channel.secret });
        }

        const profile = {
            ...this.blank(),
            radio: {
                name: selfInfo.name,
                radioFreq: selfInfo.radioFreq,
                radioBw: selfInfo.radioBw,
                radioSf: selfInfo.radioSf,
                radioCr: selfInfo.radioCr,
                txPower: selfInfo.txPower,
                shareLocation: EmcommMode.locationSharing(selfInfo) === "all",
                advertPosition: EmcommMode.advertsCarryPosition(selfInfo),
                multiAcks: EmcommMode.multiAcksOn(selfInfo),
                autoAddContacts: !params.manualAddContacts,
            },
            channels: channels,
            capturedAt: Date.now(),
        };

        this.saveProfile("normal", profile, nodeKeyHex);
        return profile;

    }

    /**
     * How long one pass over the channel slots may take before the rest are
     * called unreadable. Bounded because the per-slot retries are not: three
     * attempts of four seconds each, sixteen slots.
     */
    static READ_DEADLINE_MILLIS = 45000;

    /** Every channel the radio holds, by slot, name and key. */
    static async readChannels() {
        return (await this.readChannelsWithFailures()).channels;
    }

    /**
     * The same, with a count of the slots that could not be read.
     *
     * An empty slot and an unreadable one look the same from here, so a radio
     * that answers nothing would otherwise read as a radio with no channels.
     * Anything about to clear slots needs to tell those apart.
     */
    static async readChannelsWithFailures({ deadlineMillis = this.READ_DEADLINE_MILLIS } = {}) {

        const Connection = (await import("../Connection.js")).default;
        const channels = [];
        const failed = [];
        let lastAnswered = -1;
        let gaveUp = false;
        const deadline = Date.now() + deadlineMillis;
        const slots = await Slots.count();

        for(let idx = 0; idx < slots; idx++){

            // A slot the radio will not answer costs three attempts of four
            // seconds, so sixteen of them is over three minutes, and this is
            // called twice by captureNormal and again by every mode switch. On a
            // radio that answers nothing the connect screen would sit on
            // "Remembering this radio's own settings" for six minutes rather than
            // saying it could not read them.
            if(Date.now() > deadline){
                for(let rest = idx; rest < slots; rest++){
                    failed.push(rest);
                }
                console.log(`the channel read gave up after ${Math.round(deadlineMillis / 1000)}s, at slot ${idx}`);
                gaveUp = true;
                break;
            }

            try {
                const channel = await Connection.getChannel(idx);
                lastAnswered = idx;
                const name = (channel?.name ?? "").trim();
                if(name !== ""){
                    channels.push({ idx: idx, name: name, secret: Utils.bytesToHex(channel.secret) });
                }
            } catch(e) {
                failed.push(idx);
            }

        }

        // A radio with fewer slots than this asks for answers the ones past its
        // end with an error — that is how `meshcore.js` finds the end of the list
        // at all — so a failure on its own means nothing. A failure with a slot
        // after it that answered is a hole in the middle, and that is the one that
        // loses a channel silently.
        const gaps = failed.filter((idx) => idx < lastAnswered);

        // Giving up is not the same as reading an empty slot, and the gap rule
        // cannot see the difference: everything abandoned sits after the last slot
        // that answered, so none of it counts as a hole. Anything that writes to
        // the radio from this read has to know the read was cut short.
        return { channels: channels, unreadable: failed.length, gaps: gaps, gaveUp: gaveUp };

    }

    /**
     * The starting point for an emcomm profile: the station as it is, with the
     * settings an incident wants, and its own channel. The operator edits it in
     * settings before ever switching, and nothing is written to the radio here.
     */
    static async defaultEmcommProfile(mode, nodeKeyHex = this.nodeKeyHex()) {

        const normal = this.profile("normal", nodeKeyHex) ?? await this.captureNormal(nodeKeyHex);
        const channelName = DEFAULT_CHANNELS[mode] ?? DEFAULT_CHANNELS.live;
        const secret = Utils.bytesToHex(await EmcommMode.hashtagChannelKey(channelName));

        return {
            ...this.blank(),
            radio: {
                ...normal.radio,
                // the radio settings an incident wants, per docs/EMCOMM-MODE.md
                txPower: GlobalState.selfInfo?.maxTxPower ?? normal.radio.txPower,
                shareLocation: true,
                advertPosition: true,
                multiAcks: true,
                autoAddContacts: true,
            },
            // the net's own channel, plus anything the operator adds
            channels: [{ name: channelName, secret: secret }],
            rooms: [],
            autoAnswerPositions: false,
            adverts: { ...EmcommMode.ADVERT_SCHEDULE },
            markDrill: mode === "training",
            trimContacts: true,
            syncClock: true,
            positionFromGps: true,
            // every operator and repeater on the mesh learns the station is up
            announce: "flood",
            discoverRepeaters: true,
        };

    }

    /** The profile for a mode, making the default first if there is none yet. */
    static async profileOrDefault(mode, nodeKeyHex = this.nodeKeyHex()) {

        const existing = this.profile(mode, nodeKeyHex);
        if(existing != null){
            return existing;
        }

        const profile = mode === "normal"
            ? await this.captureNormal(nodeKeyHex)
            : await this.defaultEmcommProfile(mode, nodeKeyHex);
        this.saveProfile(mode, profile, nodeKeyHex);
        return profile;

    }

    /** Whether traffic sent now should be marked DRILL. */
    static marksDrill(nodeKeyHex = this.nodeKeyHex()) {
        const mode = this.current(nodeKeyHex);
        return this.profile(mode, nodeKeyHex)?.markDrill === true;
    }

    /**
     * The text to actually send, marked DRILL when the mode in use says so.
     *
     * An operator who has already written DRILL into the message gets no second
     * one: "DRILL DRILL SAG needed" reads as a stutter rather than a marking, and
     * on a 160 byte message the wasted six characters are real. The check is a
     * whole word, so a message about a drill bit or Drillfield Road is still
     * marked.
     */
    static markText(text, nodeKeyHex = this.nodeKeyHex()) {
        if(text == null || text === "" || !this.marksDrill(nodeKeyHex)){
            return text;
        }
        return /\bDRILL\b/i.test(text) ? text : `DRILL ${text}`;
    }

    /**
     * Records a setting changed on the live radio into the mode in use.
     *
     * A mode writes its own radio settings when it is entered, so a change made on
     * the settings page was undone the next time the station came home: the
     * operator raised the transmit power, went to a drill, came back, and the power
     * was as it had been, with nothing said. The mode in use is the one that would
     * undo it, so that is the one updated. In normal mode, where a station spends
     * its life, that means normal mode keeps up with the radio.
     *
     * It deliberately does not touch the other modes. What a drill writes is the
     * drill's business, and "the radio as this app first found it" would stop
     * meaning anything if every mode followed every change made in another.
     */
    static noteRadioSettings(settings, nodeKeyHex = this.nodeKeyHex()) {

        const mode = this.current(nodeKeyHex);
        const profile = this.profile(mode, nodeKeyHex);
        if(profile == null){
            // nothing stored for this mode, so there is nothing a switch would
            // write over the change that was just made
            return false;
        }

        const allowed = ["name", "radioFreq", "radioBw", "radioSf", "radioCr", "txPower",
            "shareLocation", "advertPosition", "multiAcks", "autoAddContacts"];
        for(const [key, value] of Object.entries(settings ?? {})){
            if(allowed.includes(key) && value != null){
                profile.radio[key] = value;
            }
        }

        this.saveProfile(mode, profile, nodeKeyHex);
        return true;

    }

    /**
     * Records the auto or manual choice into the mode in use.
     *
     * The setting in the settings page writes the live per-node value, which is
     * what `PositionService` reads. A mode switch then writes that same value from
     * the mode's profile, so a choice made anywhere but the mode settings tab was
     * quietly undone by the next switch. On the bench node 2's choice survived a
     * round trip through Emcomm-Training only after this was added.
     *
     * This used to carry lists of ticked channels and rooms as well. Every channel
     * and room is answered now, so there is nothing left to record but whether the
     * operator is asked first.
     */
    static noteAnswerChoices({ autoAnswer }, nodeKeyHex = this.nodeKeyHex()) {

        const mode = this.current(nodeKeyHex);
        const profile = this.profile(mode, nodeKeyHex);
        if(profile == null){
            // nothing stored for this mode yet, so there is nothing a switch would
            // overwrite: the live settings stand on their own
            return false;
        }

        if(autoAnswer != null){
            profile.autoAnswerPositions = autoAnswer === true;
        }

        this.saveProfile(mode, profile, nodeKeyHex);
        return true;

    }

    static forget(nodeKeyHex) {
        try {
            window.localStorage.removeItem(this.storageKey(nodeKeyHex));
            state.revision++;
        } catch(e) {
            console.log("could not clear the station's modes", e);
        }
    }

}

export default ModeProfiles;
