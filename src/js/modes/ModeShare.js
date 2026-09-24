// Handing one station's mode to another.
//
// One operator sets a node up properly, shows a code, and everyone else scans it.
// The code is a link to this app carrying the mode profile, so a phone's own
// camera opens it and an operator who has not installed the app still lands on
// the web one. See docs/MODE-SHARING.md for the decisions behind this.
//
// What travels: the radio settings, the channels with their keys, the rooms, the
// advert intervals and the entering choices. What does not:
//
//   the node name   every station is its own station, and two stations answering
//                   to one name on a net is worse than either being unnamed
//   contacts        not settings: who the radio has heard, which comes back from
//                   that station's own backup
//   normal mode     the radio as its owner had it, which nobody else can hand over
//
// One code per mode, by the operator's choice: a Live code and a Training code,
// so the wrong one cannot be scanned by mistake at a drill.

import ModeProfiles, { MODE_LABELS } from "./ModeProfiles.js";

export const SHARE_VERSION = 1;
export const SHARE_PATH = "#/mode";

// a code older than this is probably from the last incident, not this one
export const STALE_AFTER_MILLIS = 24 * 60 * 60 * 1000;

// the keys are short because they are carried in a QR code, where every byte is
// a module on a phone screen at a muster point
function compact(profile, mode, { includePrivateKeys = true, from = "" } = {}) {
    return {
        v: SHARE_VERSION,
        m: mode,
        t: Date.now(),
        f: from,
        r: {
            f: profile.radio.radioFreq,
            b: profile.radio.radioBw,
            s: profile.radio.radioSf,
            c: profile.radio.radioCr,
            p: profile.radio.txPower,
            l: profile.radio.shareLocation ? 1 : 0,
            a: profile.radio.advertPosition ? 1 : 0,
            k: profile.radio.multiAcks ? 1 : 0,
            u: profile.radio.autoAddContacts ? 1 : 0,
        },
        // a hashtag channel's key comes from its name, so it is not carried: the
        // receiver works it out, and nothing private is in the code that was not
        // already public
        // "a", which channel answered position requests, was dropped when every
        // channel started answering. A code made before that still carries it and
        // still reads: it is simply not looked at.
        c: profile.channels.map((channel) => {
            const hashtag = (channel.name ?? "").startsWith("#");
            const entry = { n: channel.name };
            if(!hashtag && includePrivateKeys){
                entry.k = channel.secret;
            }
            return entry;
        }),
        o: profile.rooms.map((room) => ({ k: room.keyHex, n: room.name })),
        q: profile.autoAnswerPositions ? 1 : 0,
        z: profile.adverts.zeroHopMinutes,
        d: profile.adverts.floodMinutes,
        x: profile.markDrill ? 1 : 0,
        i: profile.trimContacts ? 1 : 0,
        y: profile.syncClock ? 1 : 0,
        g: profile.positionFromGps ? 1 : 0,
        e: profile.announce,
        h: profile.discoverRepeaters ? 1 : 0,
    };
}

function toBase64Url(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for(const b of bytes){
        binary += String.fromCharCode(b);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
    const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "===".slice((base64.length + 3) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

class ModeShare {

    /**
     * The link for one mode. origin is where the app is served from, so a code
     * made on a phone opens the same app the operator already has.
     */
    static link(profile, mode, { includePrivateKeys = true, from = "", origin = null } = {}) {
        const where = origin ?? (typeof window !== "undefined" ? `${window.location.origin}/` : "/");
        const data = toBase64Url(JSON.stringify(compact(profile, mode, { includePrivateKeys, from })));
        return `${where}${SHARE_PATH}?v=${SHARE_VERSION}&d=${data}`;
    }

    /** How many private channel keys a code would carry, for the warning. */
    static privateKeyCount(profile) {
        return profile.channels.filter((c) => !(c.name ?? "").startsWith("#")).length;
    }

    /**
     * Reads a shared code, from a link or from the payload alone.
     *
     * Returns { mode, from, at, profile, missingKeys } or throws with a reason
     * the operator can act on. The profile is filled out to the same shape
     * ModeProfiles uses, with hashtag channel keys worked out from their names.
     */
    static async read(text) {

        const raw = (text ?? "").trim();
        if(raw === ""){
            throw new Error("that is empty");
        }

        const match = raw.match(/[?&]d=([A-Za-z0-9_-]+)/);
        const payload = match ? match[1] : raw;

        let data;
        try {
            data = JSON.parse(fromBase64Url(payload));
        } catch(e) {
            throw new Error("that is not a station mode code");
        }

        if(data?.v !== SHARE_VERSION){
            throw new Error("that code was made by a different version of the app");
        }
        if(!["live", "training"].includes(data.m)){
            throw new Error("only the emcomm modes can be shared");
        }

        const blank = ModeProfiles.blank();
        const missingKeys = [];
        const channels = [];

        for(const channel of data.c ?? []){
            const name = channel.n ?? "";
            if(name.startsWith("#")){
                const { default: EmcommMode } = await import("../EmcommMode.js");
                const { default: Utils } = await import("../Utils.js");
                channels.push({ name, secret: Utils.bytesToHex(await EmcommMode.hashtagChannelKey(name)) });
            } else if(channel.k){
                channels.push({ name, secret: channel.k });
            } else {
                // shared without its key: named so the operator knows what to add
                missingKeys.push(name);
            }
        }

        const profile = {
            ...blank,
            radio: {
                ...blank.radio,
                // the name is deliberately not carried: this station keeps its own
                name: "",
                radioFreq: data.r?.f ?? null,
                radioBw: data.r?.b ?? null,
                radioSf: data.r?.s ?? null,
                radioCr: data.r?.c ?? null,
                txPower: data.r?.p ?? null,
                shareLocation: data.r?.l === 1,
                advertPosition: data.r?.a === 1,
                multiAcks: data.r?.k === 1,
                autoAddContacts: data.r?.u === 1,
            },
            channels: channels,
            rooms: (data.o ?? []).map((room) => ({ keyHex: room.k, name: room.n })),
            autoAnswerPositions: data.q === 1,
            adverts: { zeroHopMinutes: data.z ?? 0, floodMinutes: data.d ?? 0 },
            markDrill: data.x === 1,
            trimContacts: data.i === 1,
            syncClock: data.y === 1,
            positionFromGps: data.g === 1,
            announce: ["none", "zerohop", "flood"].includes(data.e) ? data.e : "none",
            discoverRepeaters: data.h === 1,
        };

        return {
            mode: data.m,
            from: data.f ?? "",
            at: Number.isFinite(data.t) ? data.t : null,
            stale: Number.isFinite(data.t) ? Date.now() - data.t > STALE_AFTER_MILLIS : false,
            missingKeys: missingKeys,
            profile: profile,
        };

    }

    /**
     * Saving a shared profile into a mode, keeping this station's own name.
     *
     * The radio is not touched: the banner is where a mode is entered, with its
     * own confirmation. Two deliberate steps, both taken by the operator holding
     * the radio.
     */
    static save(shared, mode, nodeKeyHex = ModeProfiles.nodeKeyHex()) {
        const existing = ModeProfiles.profile(mode, nodeKeyHex);
        const profile = {
            ...shared.profile,
            radio: {
                ...shared.profile.radio,
                // whatever this station already called itself in that mode
                name: existing?.radio?.name ?? "",
            },
        };
        ModeProfiles.saveProfile(mode, profile, nodeKeyHex);
        return profile;
    }

    /** What taking this code in would change, in the operator's words. */
    static describe(shared, mode) {
        const profile = shared.profile;
        const lines = [];
        lines.push(profile.channels.length === 0
            ? "No channels: this mode would clear every channel from the radio when entered."
            : `Channels: ${profile.channels.map((c) => c.name).join(", ")}.`);
        if(profile.radio.radioFreq != null){
            lines.push(`Radio: ${profile.radio.radioFreq} kHz, BW ${profile.radio.radioBw}, SF ${profile.radio.radioSf}, CR ${profile.radio.radioCr}.`);
        }
        if(profile.radio.txPower != null){
            lines.push(`Transmit power: ${profile.radio.txPower} dBm.`);
        }
        if(profile.rooms.length > 0){
            lines.push(`Rooms: ${profile.rooms.map((r) => r.name).join(", ")}.`);
        }
        lines.push(`Repeating adverts: ${profile.adverts.zeroHopMinutes || "no"} zero hop, ${profile.adverts.floodMinutes || "no"} flood, in minutes.`);
        if(profile.markDrill){
            lines.push("Everything sent in it is marked DRILL.");
        }
        lines.push(`Your station keeps its own name, its contacts and its ${MODE_LABELS.normal}.`);
        return lines;
    }

}

export default ModeShare;
