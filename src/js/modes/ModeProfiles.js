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

const STORAGE_PREFIX = "station_modes";

export const MODES = ["normal", "live", "training"];

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
        const channels = [];
        for(const channel of await this.readChannels()){
            channels.push({ name: channel.name, secret: channel.secret, answerPositions: false });
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
    static async readChannelsWithFailures() {
        const Connection = (await import("../Connection.js")).default;
        const channels = [];
        let unreadable = 0;
        for(let idx = 0; idx < 16; idx++){
            try {
                const channel = await Connection.getChannel(idx);
                const name = (channel?.name ?? "").trim();
                if(name !== ""){
                    channels.push({ idx: idx, name: name, secret: Utils.bytesToHex(channel.secret) });
                }
            } catch(e) {
                unreadable++;
            }
        }
        return { channels: channels, unreadable: unreadable };
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
            channels: [{ name: channelName, secret: secret, answerPositions: true }],
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
