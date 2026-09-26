// What your net starts from, kept in this browser rather than on a radio.
//
// A mode profile belongs to a station: it is keyed by that node's public key and
// it holds that node's name. A net default is the other thing an operator wants —
// the settings the whole net agreed on, written down once, ready to drop into any
// station that turns up. So it is stored per browser and per mode, with nothing in
// it that belongs to one particular radio, which is also why it can be edited with
// no radio connected at all.
//
// Two things are deliberately left out, for the same reasons mode sharing leaves
// them out:
//
//   The node name. Every station is its own station, and copying a name would put
//   two KJ5HBN-EMCOMMs on the net.
//
//   A transmit power number. Radios differ in what they can manage, so this holds
//   null for "as high as this radio goes" and the number is worked out when it is
//   loaded into a station.
//
// Normal mode has no net default and never will. Normal is the radio as its owner
// has it, learnt by reading a radio that is in it; a net cannot agree on what
// somebody else's everyday settings are.

import { reactive } from "vue";
import ModeProfiles from "./ModeProfiles.js";

const KEY = "net_defaults";
const MODES = ["training", "live"];

// so a page redraws when the defaults are saved from somewhere else
const state = reactive({ revision: 0 });

class NetDefaults {

    static get state() {
        return state;
    }

    static get MODES() {
        return MODES;
    }

    /** Whether this mode can have a net default at all. */
    static applies(mode) {
        return MODES.includes(mode);
    }

    static all() {
        try {
            const raw = window.localStorage.getItem(KEY);
            return raw == null ? {} : JSON.parse(raw);
        } catch(e) {
            console.log("could not read the net defaults", e);
            return {};
        }
    }

    /** The net default for a mode, or null when none has been written. */
    static get(mode) {
        void state.revision;
        if(!this.applies(mode)){
            return null;
        }
        return this.all()[mode] ?? null;
    }

    static has(mode) {
        return this.get(mode) != null;
    }

    /** Whether anything at all has been set up, for deciding what to offer. */
    static hasAny() {
        void state.revision;
        return MODES.some((mode) => this.all()[mode] != null);
    }

    /**
     * Writes a mode's net default, keeping only what a net can agree on.
     *
     * Takes a profile in the shape the mode tabs use, so the same editor can save
     * one, and strips the two things that belong to a station rather than a net.
     */
    static save(mode, profile) {

        if(!this.applies(mode) || profile == null){
            return false;
        }

        const { name, txPower, ...radio } = profile.radio ?? {};

        const stored = {
            radio: { ...radio, txPower: null },
            channels: JSON.parse(JSON.stringify(profile.channels ?? [])),
            autoAnswerPositions: profile.autoAnswerPositions === true,
            adverts: { ...(profile.adverts ?? {}) },
            markDrill: profile.markDrill === true,
            trimContacts: profile.trimContacts === true,
            syncClock: profile.syncClock === true,
            positionFromGps: profile.positionFromGps === true,
            announce: profile.announce ?? "none",
            discoverRepeaters: profile.discoverRepeaters === true,
            savedAt: Date.now(),
        };

        try {
            window.localStorage.setItem(KEY, JSON.stringify({ ...this.all(), [mode]: stored }));
            state.revision++;
            return true;
        } catch(e) {
            console.log("could not save the net defaults", e);
            return false;
        }

    }

    static clear(mode) {
        try {
            const all = this.all();
            delete all[mode];
            window.localStorage.setItem(KEY, JSON.stringify(all));
            state.revision++;
            return true;
        } catch(e) {
            console.log("could not clear the net defaults", e);
            return false;
        }
    }

    /**
     * A net default filled out into a profile a station can use.
     *
     * The station keeps its own name, and the power becomes as high as this radio
     * goes, because those are the two things a net cannot decide for it.
     */
    static async forStation(mode, { name = null, maxTxPower = null } = {}) {

        const stored = this.get(mode);
        if(stored == null){
            return null;
        }

        const { savedAt, ...profile } = stored;
        return {
            ...ModeProfiles.blank(),
            ...profile,
            radio: {
                ...profile.radio,
                name: name ?? "",
                txPower: maxTxPower,
            },
            channels: JSON.parse(JSON.stringify(profile.channels)),
        };

    }

    /**
     * A starting point for the editor when nothing has been written yet: the app's
     * own default for that mode, with the station's parts taken out.
     *
     * Needs a radio, because the app's default takes its radio settings from the
     * station it is looking at. With none connected it hands back a blank, which
     * is honest: the net has to say what frequency it is on.
     */
    static async startingPoint(mode) {

        // The decisions, which need nothing: the net's channel, the ticks, the
        // advert intervals, what to announce.
        const defaults = await ModeProfiles.emcommDefaults(mode);
        const { name, txPower, ...radio } = defaults.radio;
        const starting = { ...defaults, radio: { ...radio, name: "", txPower: null } };

        // and the four readings, from a station if one is here to read. The net
        // has to say what frequency it is on, and a radio in front of us is a
        // better first guess than an empty box.
        try {
            const station = await ModeProfiles.defaultEmcommProfile(mode);
            starting.radio.radioFreq = station.radio.radioFreq;
            starting.radio.radioBw = station.radio.radioBw;
            starting.radio.radioSf = station.radio.radioSf;
            starting.radio.radioCr = station.radio.radioCr;
        } catch(e) {
            // no radio to read, which is the case this editor exists for
        }

        return starting;

    }

}

export default NetDefaults;
