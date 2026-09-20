// Repeater discovery, against a fake radio.
//
// This exists because of a real bug. The request frame was built without its
// command byte, so it went to the device starting with the control payload and was
// discarded. Nothing caught it: the build passed, the logic suites passed, and the
// feature failed by reporting "no repeater answered", which is a legitimate result.
// It took sending the frame by hand alongside to find it.
//
// So these assert the bytes on the wire, not just that the function returns.

import { describe, it, expect, beforeEach } from "vitest";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";

// a radio that records what it was sent and lets a test push frames back
function fakeRadio() {
    const listeners = {};
    return {
        sent: [],
        on(event, cb) { (listeners[event] ??= []).push(cb); },
        off(event, cb) { listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb); },
        async sendToRadioFrame(bytes) { this.sent.push(new Uint8Array(bytes)); },
        // pretend a frame arrived from the mesh
        receive(bytes) { this.emit("rx", new Uint8Array(bytes)); },
        emit(event, ...args) { (listeners[event] ?? []).slice().forEach((cb) => cb(...args)); },
        listenerCount(event = "rx") { return (listeners[event] ?? []).length; },
    };
}

// a DISCOVER_RESP as the firmware builds it, wrapped in the push frame the
// companion adds: [0x8E, our snr, rssi, path len, ...payload]
function discoverResponse({ tag, theirSnrQuarters, ourSnrQuarters, rssi, key, nodeType = 2 }) {
    return [
        0x8E, ourSnrQuarters & 0xFF, rssi & 0xFF, 0,
        0x90 | nodeType,
        theirSnrQuarters & 0xFF,
        ...tag,
        ...key,
    ];
}

const KEY_A = Array.from({ length: 32 }, (_, i) => i + 1);
const KEY_B = Array.from({ length: 32 }, (_, i) => 200 - i);

describe("discoverRepeaters", () => {

    let radio;

    beforeEach(() => {
        radio = fakeRadio();
        GlobalState.connection = radio;
    });

    it("sends a frame the device will accept", async () => {

        const pending = Connection.discoverRepeaters(30);
        // the frame goes out before the listening window, so it is already recorded
        await new Promise((r) => setTimeout(r, 5));

        expect(radio.sent).toHaveLength(1);
        const frame = radio.sent[0];

        // the bug: without this byte the device sees 0x80 where a command belongs
        expect(frame[0]).toBe(55);
        // DISCOVER_REQ, with prefix_only clear so replies carry the whole key
        expect(frame[1]).toBe(0x80);
        // one bit per advert type, and repeaters are type 2
        expect(frame[2]).toBe(1 << 2);
        // tag, then the optional since field
        expect(frame).toHaveLength(11);
        expect(Array.from(frame.slice(7))).toEqual([0, 0, 0, 0]);

        await pending;

    });

    it("reads both signal readings out of a reply", async () => {

        const pending = Connection.discoverRepeaters(60);
        await new Promise((r) => setTimeout(r, 5));
        const tag = Array.from(radio.sent[0].slice(3, 7));

        radio.receive(discoverResponse({
            tag,
            theirSnrQuarters: 47,    // 11.75 dB, how well they heard us
            ourSnrQuarters: 50,      // 12.50 dB, how well we heard them
            rssi: -74,
            key: KEY_A,
        }));

        const found = await pending;

        expect(found).toHaveLength(1);
        expect(found[0].snrThere).toBe(11.75);
        expect(found[0].snrBack).toBe(12.5);
        expect(found[0].rssi).toBe(-74);
        expect(found[0].nodeType).toBe(2);

    });

    it("reads negative signal readings, which are the interesting ones", async () => {

        const pending = Connection.discoverRepeaters(60);
        await new Promise((r) => setTimeout(r, 5));
        const tag = Array.from(radio.sent[0].slice(3, 7));

        // -4.5 dB and -18.25 dB as signed quarter dB bytes
        radio.receive(discoverResponse({ tag, theirSnrQuarters: -18, ourSnrQuarters: -73, rssi: -120, key: KEY_A }));

        const found = await pending;
        expect(found[0].snrThere).toBe(-4.5);
        expect(found[0].snrBack).toBe(-18.25);
        expect(found[0].rssi).toBe(-120);

    });

    it("ignores replies carrying somebody else's tag", async () => {

        const pending = Connection.discoverRepeaters(60);
        await new Promise((r) => setTimeout(r, 5));
        const tag = Array.from(radio.sent[0].slice(3, 7));
        const otherTag = tag.map((b) => (b + 1) & 0xFF);

        // replies are broadcast, so another operator's discovery reaches us too
        radio.receive(discoverResponse({ tag: otherTag, theirSnrQuarters: 40, ourSnrQuarters: 40, rssi: -70, key: KEY_B }));
        radio.receive(discoverResponse({ tag, theirSnrQuarters: 40, ourSnrQuarters: 40, rssi: -70, key: KEY_A }));

        const found = await pending;
        expect(found).toHaveLength(1);
        expect(found[0].publicKeyHex.startsWith("0102")).toBe(true);

    });

    it("counts a repeater once however often it answers", async () => {

        const pending = Connection.discoverRepeaters(60);
        await new Promise((r) => setTimeout(r, 5));
        const tag = Array.from(radio.sent[0].slice(3, 7));

        radio.receive(discoverResponse({ tag, theirSnrQuarters: 40, ourSnrQuarters: 40, rssi: -70, key: KEY_A }));
        radio.receive(discoverResponse({ tag, theirSnrQuarters: 44, ourSnrQuarters: 44, rssi: -60, key: KEY_A }));

        const found = await pending;
        expect(found).toHaveLength(1);
        // the first answer is kept, not the last
        expect(found[0].snrThere).toBe(10);

    });

    it("ignores frames that are not discovery responses", async () => {

        const pending = Connection.discoverRepeaters(60);
        await new Promise((r) => setTimeout(r, 5));
        const tag = Array.from(radio.sent[0].slice(3, 7));

        radio.receive([0x8B, 0, 0, 0, 0x90 | 2, 40, ...tag, ...KEY_A]);   // telemetry, not control data
        radio.receive([0x8E, 0, 0, 0, 0x80, 40, ...tag, ...KEY_A]);       // control data, but a request
        radio.receive([0x8E, 0, 0]);                                       // truncated

        const found = await pending;
        expect(found).toHaveLength(0);

    });

    it("lets go of the radio when it finishes", async () => {
        await Connection.discoverRepeaters(20);
        expect(radio.listenerCount()).toBe(0);
    });

    it("refuses to run without a radio, rather than reporting nothing found", async () => {
        GlobalState.connection = null;
        await expect(Connection.discoverRepeaters(20)).rejects.toThrow(Connection.DISCONNECTED);
    });

});

// The cable pull case, which is the one that produces a wrong number rather than
// an error: a trace still in flight when the radio goes away used to surface as
// the trace's own timeout, and a timeout is recorded as packet loss. Whether a
// cable pull read as a disconnect or as a lost packet then came down to which
// happened first.
describe("pingContact when the radio goes away", () => {

    beforeEach(() => {
        GlobalState.connection = null;
    });

    it("gives up as soon as the link drops, rather than waiting for the trace to time out", async () => {

        const radio = fakeRadio();
        // a trace that never answers, standing in for the seconds before a timeout
        radio.tracePath = () => new Promise(() => {});
        GlobalState.connection = radio;

        const ping = Connection.pingContact(new Uint8Array(32));
        radio.emit("disconnected");

        await expect(ping).rejects.toThrow(Connection.DISCONNECTED);

    });

    it("still reports a real reply, and does not leave a listener behind", async () => {

        const radio = fakeRadio();
        radio.tracePath = async () => ({ pathSnrs: [25], lastSnr: 11.5 });
        GlobalState.connection = radio;

        const reply = await Connection.pingContact(new Uint8Array(32));
        expect(reply.snrThere).toBe(6.25);

        // a listener that outlives its request rejects a promise nobody awaits
        expect(radio.listenerCount("disconnected")).toBe(0);

    });

    it("does not leave a listener behind when the trace fails either", async () => {

        const radio = fakeRadio();
        radio.tracePath = async () => { throw new Error("timeout"); };
        GlobalState.connection = radio;

        await expect(Connection.pingContact(new Uint8Array(32))).rejects.toThrow("timeout");
        expect(radio.listenerCount("disconnected")).toBe(0);

    });

    it("refuses before transmitting when there is no radio at all", async () => {
        await expect(Connection.pingContact(new Uint8Array(32))).rejects.toThrow(Connection.DISCONNECTED);
    });

});
