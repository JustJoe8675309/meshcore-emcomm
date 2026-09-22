// What the loading screen counts, and how long discovery listens.
//
// On node 2 the contact count sat at 183 of 183 for three seconds while a second
// pass checked for dropped contacts, and the channel step had no count at all,
// though it took five seconds: the radio has forty slots and every one is read.
// Discovery listened for a fixed 30 s, where on the bench every repeater on
// default settings has answered within about 2 s.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Constants } from "@liamcottle/meshcore.js";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import Database from "../../src/js/Database.js";
import Airtime from "../../src/js/reports/Airtime.js";

const KEY = new Uint8Array(32).fill(0x39);
const SELF_INFO = { name: "KJ5HBN-EMCOMM", publicKey: KEY, radioSf: 7, radioBw: 62500, radioCr: 5 };

// a radio with forty channel slots, thirteen of them configured
function radioWithChannels({ slots = 40, configured = 13, reportsSlots = true } = {}) {
    return {
        on() {}, once() {}, off() {}, close() {},
        deviceQuery: async () => ({ firmwareVer: 8, reserved: reportsSlots ? [175, slots, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0] }),
        getChannel: async (idx) => {
            if(idx >= slots){
                throw new Error("no such slot");
            }
            return { channelIdx: idx, name: idx < configured ? `Channel ${idx}` : "", secret: new Uint8Array(16) };
        },
    };
}

describe("reading channels, counted", () => {

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.channels = [];
    });

    it("counts every slot against the number the radio has, and the configured ones found", async () => {
        GlobalState.connection = radioWithChannels();
        const progress = [];
        await Connection.loadChannels((slot, slots, found) => progress.push([slot, slots, found]));

        expect(progress[0]).toEqual([0, 40, 0]);
        expect(progress[progress.length - 1]).toEqual([40, 40, 13]);
        expect(progress.every(([, slots]) => slots === 40)).toBe(true);
        expect(GlobalState.channels).toHaveLength(13);
    });

    it("still reads them all, to the end, when the radio will not say how many slots it has", async () => {
        GlobalState.connection = radioWithChannels({ reportsSlots: false });
        const progress = [];
        await Connection.loadChannels((slot, slots, found) => progress.push([slot, slots, found]));

        expect(progress.slice(0, -1).every(([, slots]) => slots === null)).toBe(true);
        expect(progress[progress.length - 1]).toEqual([40, 40, 13]);
        expect(GlobalState.channels).toHaveLength(13);
    });

    it("reads the same channels with no one watching", async () => {
        GlobalState.connection = radioWithChannels();
        await Connection.loadChannels();
        expect(GlobalState.channels.map((c) => c.idx)).toEqual([...Array(13).keys()]);
    });

});

describe("the connect steps", () => {

    beforeEach(() => {
        window.localStorage.clear();
        vi.spyOn(Database, "initDatabase").mockResolvedValue(undefined);
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => { GlobalState.selfInfo = SELF_INFO; });
        vi.spyOn(Connection, "syncDeviceTime").mockResolvedValue(undefined);
        vi.spyOn(Connection, "syncMessages").mockResolvedValue(undefined);
        vi.spyOn(Connection, "updateBatteryPercentage").mockResolvedValue(undefined);
        vi.spyOn(Connection, "probeForLiveGps").mockResolvedValue(undefined);
    });

    afterEach(async () => {
        await Connection.disconnect();
        vi.restoreAllMocks();
        GlobalState.selfInfo = null;
    });

    async function runConnect(onStep) {
        const handlers = {};
        const radio = {
            on(code, fn) { (handlers[code] ??= []).push(fn); },
            once(code, fn) { (handlers[code] ??= []).push(fn); },
            off() {}, close() {},
        };
        await Connection.connect(radio, "bluetooth");
        const done = Connection.onConnected();
        // the self info listener is what opens the database
        for(const fn of handlers[Constants.ResponseCodes.SelfInfo] ?? []){
            fn(SELF_INFO);
        }
        await onStep();
        return done;
    }

    it("says it is checking for dropped contacts on a second pass, not reading them again", async () => {
        const seen = [];
        vi.spyOn(Connection, "loadContacts").mockImplementation(async (onProgress) => {
            onProgress(90, 183, 1);
            seen.push({ ...GlobalState.connecting });
            onProgress(183, 183, 2);
            seen.push({ ...GlobalState.connecting });
        });
        vi.spyOn(Connection, "loadChannels").mockResolvedValue(undefined);

        await runConnect(async () => {});

        expect(seen[0]).toEqual({ step: "Reading contacts...", done: 90, total: 183 });
        expect(seen[1]).toEqual({ step: "Checking for dropped contacts...", done: 183, total: 183 });
    });

    it("gives the channels a count and a bar like the contacts", async () => {
        const seen = [];
        vi.spyOn(Connection, "loadContacts").mockResolvedValue(undefined);
        vi.spyOn(Connection, "loadChannels").mockImplementation(async (onProgress) => {
            onProgress(17, 40, 9);
            seen.push({ ...GlobalState.connecting });
        });

        await runConnect(async () => {});

        expect(seen[0]).toEqual({ step: "Reading channels... 9 found", done: 17, total: 40 });
    });

});

describe("how long discovery listens", () => {

    afterEach(() => {
        GlobalState.selfInfo = null;
    });

    it("is 10 s at the bench settings, not the old 30", () => {
        GlobalState.selfInfo = SELF_INFO;
        expect(Connection.discoveryListenMillis()).toBe(10000);
    });

    it("grows for slow settings, to cover the slowest answer a default repeater can give", () => {
        const slow = { radioSf: 12, radioBw: 125000, radioCr: 5 };
        const airtime = Airtime.getTimeOnAirMillis(Airtime.DISCOVERY_PACKET_BYTES, Airtime.getRadioFromSelfInfo(slow));
        const listen = Airtime.discoveryListenMillis(slow, 10000);
        expect(listen).toBeGreaterThanOrEqual(airtime * 12);
        expect(listen).toBeLessThan(airtime * 12 + 1000);
        expect(listen).toBe(19000);
    });

    it("falls back to 10 s when the radio settings are not known", () => {
        GlobalState.selfInfo = null;
        expect(Connection.discoveryListenMillis()).toBe(10000);
    });

    it("is what a discovery listens for when not told otherwise", async () => {
        GlobalState.selfInfo = SELF_INFO;
        const spy = vi.spyOn(Connection, "discoveryListenMillis");
        GlobalState.connection = null;
        await Connection.discoverRepeaters().catch(() => {});
        expect(spy).toHaveBeenCalled();
    });

});
