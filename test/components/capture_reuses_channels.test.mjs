// The connect's capture reuses the channel read the connect has just made.
//
// The capture that records the way home read every channel slot again straight
// after the connect had read them all -- forty round trips on a forty-slot radio,
// three slow attempts for any slot that will not answer, and the "Remembering this
// radio's own settings" step on a Bluetooth connect waiting on all of it. The
// connect's own read is slot by slot and checked the same way, so the capture now
// takes it -- but only when it can carry the guarantee the capture's own read
// exists for: a slot that would not read must never pass for an empty one, since a
// channel's key cannot be heard again. So: same connection, read to the end, the
// same slot count. Otherwise the capture reads for itself, exactly as before.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import NodeBackup from "../../src/js/NodeBackup.js";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import Slots from "../../src/js/channels/Slots.js";

const KEY = new Uint8Array(32).fill(0x5c);
const slot = (idx, name = "") => ({ channelIdx: idx, name, secret: new Uint8Array(16).fill(idx + 1) });

function radio({ slots = 8, names = {}, failing = [] } = {}) {
    const asked = [];
    return {
        asked,
        on() {}, once() {}, off() {}, close() {},
        deviceQuery: async () => ({ firmwareVer: 8, reserved: [175, slots, 0] }),
        getSelfInfo: async () => ({ name: "NOCALL-HT", publicKey: KEY, radioFreq: 910525, radioBw: 62.5, radioSf: 7, radioCr: 5, txPower: 22, maxTxPower: 22, manualAddContacts: 0 }),
        getChannel: async (idx) => {
            asked.push(idx);
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

describe("the capture on a connect", () => {

    beforeEach(() => {
        Slots.forget();
        GlobalState.contacts = [];
        GlobalState.contactsMissing = 0;
        GlobalState.contactsAnnounced = 0;
        GlobalState.channels = [];
        Connection.lastChannelRead = null;
        vi.spyOn(Connection, "loadContacts").mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        Connection.lastChannelRead = null;
        Slots.forget();
    });

    it("keeps the connect's read of every slot, marked complete", async () => {
        GlobalState.connection = radio({ slots: 16, names: { 0: "Public", 3: "Emcomm Testing" }, failing: [5] });
        await Connection.loadChannels(() => {});
        const read = Connection.lastChannelRead;
        expect(read.connection).toBe(GlobalState.connection);
        expect(read.slots).toBe(16);
        expect(read.complete).toBe(true);
        expect(read.failed).toEqual([5]);
        expect(read.lastAnswered).toBe(15);
        expect(read.entries.map((c) => c.channelIdx)).toEqual([0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    });

    it("forgets the last read as soon as a new one starts, so a read that fails part way leaves nothing to reuse", async () => {
        GlobalState.connection = radio({ slots: 16, names: { 0: "Public" } });
        await Connection.loadChannels(() => {});
        expect(Connection.lastChannelRead.complete).toBe(true);

        // the same connection, and a read that throws part way: a stale read from
        // earlier must not survive it and be reused as though it were this one
        let calls = 0;
        await Connection.loadChannels(() => { if(++calls === 3) throw new Error("the screen fell over"); });
        expect(Connection.lastChannelRead).toBe(null);
    });

    it("does not offer a read that ran out of time: a slot it never reached is not empty", async () => {
        GlobalState.connection = radio({ slots: 16, names: { 0: "Public" } });
        const deadline = Connection.CHANNEL_READ_DEADLINE_MILLIS;
        Connection.CHANNEL_READ_DEADLINE_MILLIS = -1;
        try {
            await Connection.loadChannels(() => {});
        } finally {
            Connection.CHANNEL_READ_DEADLINE_MILLIS = deadline;
        }
        expect(Connection.lastChannelRead.complete).toBe(false);
    });

    it("does not offer a read that found the end of the list by an error", async () => {
        // no progress callback means no slot count asked for: the end is wherever
        // the first error falls, which is not the same as knowing it
        GlobalState.connection = radio({ slots: 16, names: { 0: "Public" } });
        await Connection.loadChannels();
        expect(Connection.lastChannelRead.slots).toBe(null);
        expect(Connection.lastChannelRead.complete).toBe(false);
    });

    // Slots.count never goes below 16 (no radio has fewer, and both bench radios
    // report 40), so these radios have 16: an 8-slot read would rightly not be
    // reused for a capture that reads 16
    it("reuses a good read, asking the radio for no slot again", async () => {
        const device = radio({ slots: 16, names: { 0: "Public", 3: "Emcomm Testing", 6: "#joebot" } });
        GlobalState.connection = device;
        await Connection.loadChannels(() => {});
        device.asked.length = 0;

        const backup = await NodeBackup.capture({ reread: false, channelRead: Connection.lastChannelRead });
        expect(device.asked).toEqual([]);
        expect(backup.channels.map((c) => [c.idx, c.name])).toEqual([[0, "Public"], [3, "Emcomm Testing"], [6, "#joebot"]]);
        expect(backup.channels[1].secret).toBe("04".repeat(16));
    });

    it("judges a reused read exactly as a fresh one: the same channels, holes and unreadable count", async () => {
        const shape = { slots: 16, names: { 0: "Public", 4: "Emcomm Testing", 7: "#weather" }, failing: [2] };

        GlobalState.connection = radio(shape);
        await Connection.loadChannels(() => {});
        const reused = await NodeBackup.capture({ reread: false, channelRead: Connection.lastChannelRead });

        Slots.forget();
        GlobalState.connection = radio(shape);
        const fresh = await NodeBackup.capture({ reread: false });

        expect(reused.channels).toEqual(fresh.channels);
        expect(reused.missing.channelSlots).toEqual([2]);
        expect(reused.missing).toEqual(fresh.missing);
        expect(reused.warnings ?? null).toEqual(fresh.warnings ?? null);
        expect(NodeBackup.captureIsDegraded(reused)).toBe(NodeBackup.captureIsDegraded(fresh));
        expect(NodeBackup.captureIsDegraded(reused)).toBe(true);
    });

    it("still says when no slot read at all, from a reused read too", async () => {
        GlobalState.connection = radio({ slots: 16, failing: Array.from({ length: 16 }, (_, i) => i) });
        await Connection.loadChannels(() => {});
        expect(Connection.lastChannelRead.complete).toBe(true);
        const backup = await NodeBackup.capture({ reread: false, channelRead: Connection.lastChannelRead });
        expect(backup.channels).toEqual([]);
        expect(backup.missing.channelSlotsUnreadable).toBe(16);
        expect(NodeBackup.captureIsDegraded(backup)).toBe(true);
    });

    it("reads for itself when the read is from another connection", async () => {
        GlobalState.connection = radio({ slots: 16, names: { 0: "Public" } });
        await Connection.loadChannels(() => {});
        const old = Connection.lastChannelRead;

        Slots.forget();
        const device = radio({ slots: 16, names: { 0: "Public", 1: "New" } });
        GlobalState.connection = device;
        const backup = await NodeBackup.capture({ reread: false, channelRead: old });
        expect(device.asked.length).toBeGreaterThan(0);
        expect(backup.channels.map((c) => c.name)).toEqual(["Public", "New"]);
    });

    it("reads for itself when the read is incomplete", async () => {
        const device = radio({ slots: 16, names: { 0: "Public" } });
        GlobalState.connection = device;
        await Connection.loadChannels(() => {});
        device.asked.length = 0;
        await NodeBackup.capture({ reread: false, channelRead: { ...Connection.lastChannelRead, complete: false } });
        expect(device.asked.length).toBeGreaterThan(0);
    });

    it("reads for itself when the slot count differs from the one it would read", async () => {
        const device = radio({ slots: 16, names: { 0: "Public" } });
        GlobalState.connection = device;
        await Connection.loadChannels(() => {});
        device.asked.length = 0;
        await NodeBackup.capture({ reread: false, channelRead: { ...Connection.lastChannelRead, slots: 4 } });
        expect(device.asked.length).toBeGreaterThan(0);
    });

    it("reads for itself when given nothing, which is what a mode switch or a manual backup does", async () => {
        const device = radio({ slots: 16, names: { 0: "Public" } });
        GlobalState.connection = device;
        await Connection.loadChannels(() => {});
        device.asked.length = 0;
        await NodeBackup.capture({ reread: false });
        expect(device.asked).toHaveLength(16);
    });

});
