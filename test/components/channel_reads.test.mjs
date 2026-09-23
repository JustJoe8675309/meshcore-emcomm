// Reading the radio's channel slots, and knowing when a read was wrong.
//
// From the bench, 22 September 2026. Node 2's connect read came back with 7
// channels for 8 slots and `#joebot` listed twice. The Emcomm Testing row was
// simply absent, nothing warned, and the Normal profile captured from that read
// was short a channel it would never have written back on the way home.
//
// The cause is in `meshcore.js`: a channel read resolves with whatever channel
// info arrives next, whichever slot it is for. A read that times out and answers
// late hands its reply to the following read, and every slot after it is one out.
//
// The firmware answers every slot below MAX_GROUP_CHANNELS, with an empty name
// for an unused one, and errors only past the end. So an error on its own means
// the end of the list; an error with a slot after it that answered is a hole.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import ModeProfiles from "../../src/js/modes/ModeProfiles.js";

const KEY = new Uint8Array(32).fill(0x39);
const NODE = Array.from(KEY).map((b) => b.toString(16).padStart(2, "0")).join("");
const SELF_INFO = {
    name: "Joe-KJ5HBN-HTv3", publicKey: KEY, radioFreq: 910525, radioBw: 62.5, radioSf: 7,
    radioCr: 5, txPower: 22, maxTxPower: 22, manualAddContacts: 1, reserved: [0, 16, 0],
};

const slot = (idx, name = "") => ({ channelIdx: idx, name: name, secret: new Uint8Array(16) });

function radio({ slots = 8, names = {}, failing = [], answersLate = null } = {}) {
    const asked = [];
    let lateReply = null;
    return {
        asked,
        on() {}, once() {}, off() {}, close() {},
        deviceQuery: async () => ({ firmwareVer: 8, reserved: [175, slots, 0] }),
        getChannel: async (idx) => {

            asked.push(idx);

            // the fault itself: one slot times out, and its reply is handed to
            // whichever read comes next
            if(idx === answersLate && lateReply === null){
                lateReply = slot(idx, names[idx] ?? "");
                throw new Error("timeout");
            }
            if(lateReply != null){
                const stale = lateReply;
                lateReply = null;
                return stale;
            }

            if(failing.includes(idx)){
                throw new Error("timeout");
            }
            if(idx >= slots){
                throw new Error("no such slot");
            }
            return slot(idx, names[idx] ?? "");

        },
    };
}

describe("reading one slot", () => {

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
    });

    it("returns the slot asked for", async () => {
        GlobalState.connection = radio({ names: { 3: "Emcomm Testing" } });
        expect((await Connection.getChannel(3)).name).toBe("Emcomm Testing");
    });

    it("refuses an answer for a different slot, and asks again", async () => {
        // a reply for slot 2 arriving while slot 3 was asked for is how #joebot
        // ended up listed twice and Emcomm Testing not at all
        let answers = 0;
        GlobalState.connection = {
            on() {}, once() {}, off() {},
            getChannel: async (idx) => (answers++ === 0 ? slot(2, "#joebot") : slot(idx, "Emcomm Testing")),
        };

        const channel = await Connection.getChannel(3);

        expect(channel.channelIdx).toBe(3);
        expect(channel.name).toBe("Emcomm Testing");
        expect(answers).toBe(2);
    });

    it("gives up rather than returning another slot's channel", async () => {
        GlobalState.connection = {
            on() {}, once() {}, off() {},
            getChannel: async () => slot(2, "#joebot"),
        };

        await expect(Connection.getChannel(3)).rejects.toThrow(/answered as 2/);
    });

    it("tries a slot that timed out again, since the radio may only have been busy", async () => {
        let attempts = 0;
        GlobalState.connection = {
            on() {}, once() {}, off() {},
            getChannel: async (idx) => {
                attempts++;
                if(attempts === 1) throw new Error("timeout");
                return slot(idx, "Public");
            },
        };

        expect((await Connection.getChannel(0)).name).toBe("Public");
        expect(attempts).toBe(2);
    });

});

describe("reading every slot", () => {

    beforeEach(() => {
        GlobalState.channels = [];
        GlobalState.channelsMissing = 0;
        GlobalState.channelSlots = null;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.channels = [];
        GlobalState.channelsMissing = 0;
    });

    it("reads past a slot that will not answer, rather than stopping there", async () => {
        // it used to break out of the loop, so one sulky slot hid every channel
        // after it
        GlobalState.connection = radio({ slots: 8, names: { 0: "Public", 3: "Emcomm Testing", 6: "#joebot" }, failing: [1] });

        await Connection.loadChannels(() => {});

        expect(GlobalState.channels.map((c) => c.name)).toEqual(["Public", "Emcomm Testing", "#joebot"]);
    });

    it("counts the slots that would not read, so the list can say a channel may be missing", async () => {
        GlobalState.connection = radio({ slots: 8, names: { 0: "Public" }, failing: [2, 5] });

        await Connection.loadChannels(() => {});

        expect(GlobalState.channelsMissing).toBe(2);
        expect(GlobalState.channelSlots).toBe(8);
    });

    it("says nothing is missing when every slot answered", async () => {
        GlobalState.connection = radio({ slots: 8, names: { 0: "Public", 1: "Emcomm Testing" } });

        await Connection.loadChannels(() => {});

        expect(GlobalState.channelsMissing).toBe(0);
        expect(GlobalState.channels).toHaveLength(2);
    });

    it("never files one slot's channel under another, even when a reply arrives late", async () => {
        const device = radio({ slots: 8, names: { 0: "Public", 2: "#joebot", 3: "Emcomm Testing" }, answersLate: 2 });
        GlobalState.connection = device;

        await Connection.loadChannels(() => {});

        // the old code returned #joebot twice and dropped Emcomm Testing
        const names = GlobalState.channels.map((c) => c.name);
        expect(names.filter((n) => n === "#joebot")).toHaveLength(1);
        expect(names).toContain("Emcomm Testing");
        expect(GlobalState.channels.every((c, i, all) => all.findIndex((o) => o.idx === c.idx) === i)).toBe(true);
    });

    it("still ends the list on an error when the radio will not say how many slots it has", async () => {
        // with no count, the error past the end is the only end marker there is,
        // which is how meshcore.js finds it
        GlobalState.connection = radio({ slots: 4, names: { 0: "Public", 1: "Emcomm Testing" } });
        GlobalState.connection.deviceQuery = async () => ({ firmwareVer: 8, reserved: [0, 0, 0] });

        await Connection.loadChannels(() => {});

        expect(GlobalState.channels).toHaveLength(2);
        expect(GlobalState.channelsMissing).toBe(0);
    });

});

describe("the way home, captured from a read", () => {

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.selfInfo = SELF_INFO;
        GlobalState.contacts = [];
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
        GlobalState.selfInfo = null;
        GlobalState.connection = null;
    });

    it("records the radio's own channels when every slot read", async () => {
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => (
            idx >= 8 ? Promise.reject(new Error("no such slot")) : slot(idx, idx === 0 ? "Public" : idx === 3 ? "Emcomm Testing" : "")
        ));

        const profile = await ModeProfiles.captureNormal(NODE);

        expect(profile.channels.map((c) => c.name)).toEqual(["Public", "Emcomm Testing"]);
        expect(ModeProfiles.profile("normal", NODE).channels).toHaveLength(2);
    });

    it("refuses to record a short read, rather than saving a way home missing a channel", async () => {
        // node 2's read was short by Emcomm Testing. Saved, that is a channel the
        // radio never gets back when the operator leaves an emcomm mode
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => {
            if(idx === 3) throw new Error("timeout");
            if(idx >= 8) throw new Error("no such slot");
            return slot(idx, idx === 0 ? "Public" : "");
        });

        await expect(ModeProfiles.captureNormal(NODE)).rejects.toThrow(/channel slot 3 would not read/);
        expect(ModeProfiles.profile("normal", NODE)).toBe(null);
    });

    it("reads again before refusing, since a busy radio answers the second time", async () => {
        let pass = 0;
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => {
            if(idx === 0) pass++;
            if(idx === 3 && pass === 1) throw new Error("timeout");
            if(idx >= 8) throw new Error("no such slot");
            return slot(idx, idx === 0 ? "Public" : idx === 3 ? "Emcomm Testing" : "");
        });

        const profile = await ModeProfiles.captureNormal(NODE);

        expect(profile.channels.map((c) => c.name)).toEqual(["Public", "Emcomm Testing"]);
    });

    it("is not troubled by the errors past the end of the list", async () => {
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => (
            idx >= 2 ? Promise.reject(new Error("no such slot")) : slot(idx, `Channel ${idx}`)
        ));

        const read = await ModeProfiles.readChannelsWithFailures();

        expect(read.channels).toHaveLength(2);
        expect(read.unreadable).toBe(14);
        expect(read.gaps).toEqual([]);
    });

    it("calls a failure with an answered slot after it a hole, and names it", async () => {
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => {
            if(idx === 1 || idx === 4) throw new Error("timeout");
            if(idx >= 6) throw new Error("no such slot");
            return slot(idx, `Channel ${idx}`);
        });

        const read = await ModeProfiles.readChannelsWithFailures();

        expect(read.gaps).toEqual([1, 4]);
    });

});

describe("a read that produced nothing", () => {

    beforeEach(() => {
        GlobalState.channels = [];
        GlobalState.channelsMissing = 0;
        GlobalState.channelsReadFailed = false;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.channels = [];
        GlobalState.channelsReadFailed = false;
    });

    it("does not pass a made up Public channel off as one that was read", async () => {
        // node 2 came up listing one channel it had never read, on a radio holding
        // eight, after the slot count was lost on a busy Bluetooth link
        GlobalState.connection = {
            on() {}, once() {}, off() {},
            deviceQuery: async () => { throw new Error("busy"); },
            getChannel: async () => { throw new Error("timeout"); },
        };

        await Connection.loadChannels(() => {});

        expect(GlobalState.channelsReadFailed).toBe(true);
        expect(GlobalState.channels.map((c) => c.name)).not.toContain("Public Channel");
    });

    it("asks for the slot count twice before giving up on it", async () => {
        let queries = 0;
        GlobalState.connection = {
            on() {}, once() {}, off() {},
            deviceQuery: async () => {
                queries++;
                if(queries === 1) throw new Error("busy");
                return { firmwareVer: 13, reserved: [175, 40, 0] };
            },
            getChannel: async (idx) => (idx >= 40 ? Promise.reject(new Error("no such slot")) : slot(idx, idx === 0 ? "Public" : "")),
        };

        await Connection.loadChannels(() => {});

        expect(queries).toBe(2);
        expect(GlobalState.channelSlots).toBe(40);
        expect(GlobalState.channels.map((c) => c.name)).toEqual(["Public"]);
    });

    it("says a radio with no channels has no channels, without crying failure", async () => {
        GlobalState.connection = radio({ slots: 8, names: {} });

        await Connection.loadChannels(() => {});

        expect(GlobalState.channels).toEqual([]);
        expect(GlobalState.channelsReadFailed).toBe(false);
    });

    it("treats slot 0 failing as a failed read, not as the end of the list", async () => {
        GlobalState.connection = {
            on() {}, once() {}, off() {},
            deviceQuery: async () => ({ firmwareVer: 13, reserved: [175, 0, 0] }),
            getChannel: async () => { throw new Error("timeout"); },
        };

        await Connection.loadChannels(() => {});

        expect(GlobalState.channelsReadFailed).toBe(true);
    });

});

describe("a read that cannot finish in time", () => {

    beforeEach(() => {
        GlobalState.channels = [];
        GlobalState.channelsMissing = 0;
        GlobalState.channelsReadFailed = false;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Connection.CHANNEL_READ_DEADLINE_MILLIS = 60000;
        GlobalState.connection = null;
        GlobalState.channels = [];
        GlobalState.channelsReadFailed = false;
    });

    it("keeps what it read and calls the rest missing, rather than throwing the lot away", async () => {
        // the whole forty slot loop used to share one ten second budget. Over
        // Bluetooth it ran out, the read threw, and the list fell back to an
        // assumed public channel: the silent failure the retries were meant to end
        Connection.CHANNEL_READ_DEADLINE_MILLIS = 5;
        GlobalState.connection = {
            on() {}, once() {}, off() {},
            deviceQuery: async () => ({ firmwareVer: 13, reserved: [175, 40, 0] }),
            getChannel: async (idx) => {
                await new Promise((r) => setTimeout(r, 2));
                return slot(idx, idx === 0 ? "Public" : idx === 1 ? "Emcomm Testing" : "");
            },
        };

        await Connection.loadChannels(() => {});

        expect(GlobalState.channels.map((c) => c.name)).toContain("Public");
        expect(GlobalState.channelsMissing).toBeGreaterThan(0);
        expect(GlobalState.channelsReadFailed).toBe(false);
    });

});

// The mode system's channel read is bounded too.
//
// Checking each slot's answer means a slot the radio will not answer costs three
// attempts of four seconds, so sixteen of them is over three minutes — and
// captureNormal reads twice, and every mode switch reads again. On a radio that
// answers nothing the connect screen would have sat on "Remembering this radio's
// own settings" for six minutes rather than saying it could not read them.
describe("a mode read that cannot finish in time", () => {

    const deadline = ModeProfiles.READ_DEADLINE_MILLIS;

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.selfInfo = SELF_INFO;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        ModeProfiles.READ_DEADLINE_MILLIS = deadline;
        window.localStorage.clear();
        GlobalState.selfInfo = null;
        GlobalState.connection = null;
    });

    it("gives up on the rest rather than working through every slot", async () => {
        ModeProfiles.READ_DEADLINE_MILLIS = 30;
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => {
            await new Promise((r) => setTimeout(r, 12));
            return slot(idx, idx === 0 ? "Public" : "");
        });

        const started = Date.now();
        const read = await ModeProfiles.readChannelsWithFailures();

        expect(Date.now() - started).toBeLessThan(1000);
        expect(read.channels.map((c) => c.name)).toEqual(["Public"]);
        // everything it never got to is counted, not quietly treated as empty
        expect(read.unreadable).toBeGreaterThan(8);
    });

    it("refuses to record a way home from a read that gave up", async () => {
        ModeProfiles.READ_DEADLINE_MILLIS = 30;
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => {
            await new Promise((r) => setTimeout(r, 12));
            return slot(idx, `Channel ${idx}`);
        });

        await expect(ModeProfiles.captureNormal(NODE)).rejects.toThrow(/would not read/);
    });

    it("still reads a healthy radio in full", async () => {
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => (
            idx >= 8 ? Promise.reject(new Error("no such slot")) : slot(idx, idx < 3 ? `Channel ${idx}` : "")
        ));

        const read = await ModeProfiles.readChannelsWithFailures();

        expect(read.channels).toHaveLength(3);
        expect(read.gaps).toEqual([]);
    });

});
