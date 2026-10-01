/**
 * "Heard by N": a repeater was heard passing our own message on.
 *
 * Asked for 29 Sep, built 30 Sep. The radio pushes every packet it hears to the
 * app raw (PUSH_CODE_LOG_RX_DATA), and a repeater's rebroadcast of our packet
 * arrives among them. A channel copy is decrypted with the channel's key and
 * matched on name, text and send time; a direct copy, which the app cannot
 * decrypt, on its source and destination hashes.
 *
 * The crypto was checked against node 2's own packets on 30 Sep: five copies of
 * one channel message, MAC good, text exactly as sent. These tests use a made-up
 * key and NOCALL, since the real key and name stay out of the repository.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Heard, { ChannelCrypto } from "../../src/js/messages/Heard.js";
import GlobalState from "../../src/js/GlobalState.js";
import Database from "../../src/js/Database.js";
import Connection from "../../src/js/Connection.js";
import MessageViewer from "../../src/components/messages/MessageViewer.vue";

const SECRET = Uint8Array.from({ length: 16 }, (_, i) => 0x10 + i);
const OTHER_SECRET = Uint8Array.from({ length: 16 }, (_, i) => 0xA0 + i);
const NAME = "NOCALL-HT";
const SENT_AT = 1790830000000;            // ms, when the app sent it
const RADIO_TS = Math.floor(SENT_AT / 1000) + 1;   // the radio's own clock, a second later

const FLOOD = 0x01;
const GRP_TXT = 0x05;
const TXT_MSG = 0x02;

/** A packet as it arrives raw: header, path length, path, payload. */
function packet(payloadType, path, payload, route = FLOOD, transport = null) {
    const header = (payloadType << 2) | route;
    const head = transport ? [header, ...transport, path.length] : [header, path.length];
    return Uint8Array.from([...head, ...path, ...payload]);
}

async function channelCopy(path, { name = NAME, text = "DRILL test", timestamp = RADIO_TS, secret = SECRET } = {}) {
    return packet(GRP_TXT, path, await ChannelCrypto.groupTextPayload(secret, { timestamp, name, text }));
}

describe("the channel crypto, as the firmware does it", () => {

    it("round-trips a message through AES-128 ECB in whole blocks", async () => {
        const plain = new TextEncoder().encode("forty bytes of text to cover three blocks");
        const cipher = await ChannelCrypto.encrypt(SECRET, plain);
        expect(cipher.length).toBe(48);
        const back = await ChannelCrypto.decrypt(SECRET, cipher);
        expect(new TextDecoder().decode(back.slice(0, plain.length))).toBe("forty bytes of text to cover three blocks");
        expect(Array.from(back.slice(plain.length))).toEqual(new Array(48 - plain.length).fill(0));
    });

    it("encrypts each block on its own, as ECB does, so equal blocks give equal cipher", async () => {
        const plain = new Uint8Array(32).fill(0x41);
        const cipher = await ChannelCrypto.encrypt(SECRET, plain);
        expect(Array.from(cipher.slice(0, 16))).toEqual(Array.from(cipher.slice(16, 32)));
    });

    it("tags a channel packet with the first byte of SHA-256 of the key", async () => {
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", SECRET));
        expect(await ChannelCrypto.channelHash(SECRET)).toBe(digest[0]);
    });

    it("reads back the time, the flags, the name and the text", async () => {
        const payload = await ChannelCrypto.groupTextPayload(SECRET, { timestamp: RADIO_TS, name: NAME, text: "a: colon inside", flags: 0 });
        const plain = await ChannelCrypto.decrypt(SECRET, payload.slice(3));
        expect(ChannelCrypto.readGroupText(plain)).toEqual({ timestamp: RADIO_TS, flags: 0, name: NAME, text: "a: colon inside" });
        expect(await ChannelCrypto.macMatches(SECRET, payload.slice(3), payload.slice(1, 3))).toBe(true);
    });

});

describe("hearing our own channel message passed on", () => {

    beforeEach(() => {
        Heard.reset();
        Heard.expectChannel({ id: "msg-1", secret: SECRET, name: NAME, text: "DRILL test", sentAt: SENT_AT });
    });

    afterEach(() => {
        Heard.reset();
    });

    it("counts a repeater's copy", async () => {
        expect(await Heard.onRawPacket(await channelCopy([0x87]), 12, SENT_AT + 1000)).toBe("msg-1");
        expect(Heard.count("msg-1")).toBe(1);
        expect(Heard.copies("msg-1")[0]).toMatchObject({ path: ["87"], snr: 12 });
    });

    it("counts each route once, and every different route", async () => {
        // node 2's 30 Sep message: two repeaters that heard it directly, three
        // copies after more hops -- and the radio logs a copy each time it hears one
        for(const path of [[0x87], [0xba], [0x87], [0x87, 0x97], [0x87, 0x79, 0xfa], [0x87, 0x97, 0xf2]]){
            await Heard.onRawPacket(await channelCopy(path), 0, SENT_AT + 2000);
        }
        expect(Heard.count("msg-1")).toBe(5);
    });

    it("does not count somebody else's message on the same channel", async () => {
        await Heard.onRawPacket(await channelCopy([0x87], { name: "W1AW-BASE" }), 0, SENT_AT + 1000);
        await Heard.onRawPacket(await channelCopy([0x87], { text: "something else" }), 0, SENT_AT + 1000);
        expect(Heard.count("msg-1")).toBe(0);
    });

    it("does not count the same words on another channel", async () => {
        await Heard.onRawPacket(await channelCopy([0x87], { secret: OTHER_SECRET }), 0, SENT_AT + 1000);
        expect(Heard.count("msg-1")).toBe(0);
    });

    it("does not even decrypt a packet tagged for another channel", async () => {
        const mac = vi.spyOn(ChannelCrypto, "macMatches");
        const decrypt = vi.spyOn(ChannelCrypto, "decrypt");
        try {
            const copy = await channelCopy([0x87], { secret: OTHER_SECRET });
            // the tags differ for these two keys; if they ever collide this test
            // has stopped testing anything, so say so
            expect(copy[3]).not.toBe(await ChannelCrypto.channelHash(SECRET));
            await Heard.onRawPacket(copy, 0, SENT_AT + 1000);
            expect(mac).not.toHaveBeenCalled();
            expect(decrypt).not.toHaveBeenCalled();
        } finally {
            mac.mockRestore();
            decrypt.mockRestore();
        }
    });

    it("does not count a copy whose MAC does not check", async () => {
        const copy = await channelCopy([0x87]);
        copy[3 + 1] ^= 0xFF;      // header, path length, one hop, then the channel hash and MAC
        await Heard.onRawPacket(copy, 0, SENT_AT + 1000);
        expect(Heard.count("msg-1")).toBe(0);
    });

    it("does not count the same words sent long before -- the time inside must agree", async () => {
        await Heard.onRawPacket(await channelCopy([0x87], { timestamp: RADIO_TS - 600 }), 0, SENT_AT + 1000);
        expect(Heard.count("msg-1")).toBe(0);
        await Heard.onRawPacket(await channelCopy([0x87], { timestamp: RADIO_TS + 60 }), 0, SENT_AT + 1000);
        expect(Heard.count("msg-1")).toBe(1);
    });

    it("stops listening five minutes after the send", async () => {
        await Heard.onRawPacket(await channelCopy([0x87]), 0, SENT_AT + Heard.LISTEN_MILLIS + 1);
        expect(Heard.count("msg-1")).toBe(0);
    });

    it("reads a transport flood packet, which carries two codes before the path", async () => {
        const payload = await ChannelCrypto.groupTextPayload(SECRET, { timestamp: RADIO_TS, name: NAME, text: "DRILL test" });
        await Heard.onRawPacket(packet(GRP_TXT, [0x87], payload, 0x00, [1, 2, 3, 4]), 0, SENT_AT + 1000);
        expect(Heard.count("msg-1")).toBe(1);
    });

    it("tells two sends of the same words apart by their time", async () => {
        Heard.expectChannel({ id: "msg-2", secret: SECRET, name: NAME, text: "DRILL test", sentAt: SENT_AT + 200000 });
        await Heard.onRawPacket(await channelCopy([0x87], { timestamp: RADIO_TS + 200 }), 0, SENT_AT + 201000);
        expect(Heard.count("msg-1")).toBe(0);
        expect(Heard.count("msg-2")).toBe(1);
    });

    it("never throws on rubbish", async () => {
        expect(await Heard.onRawPacket(new Uint8Array([]), 0, SENT_AT)).toBe(null);
        expect(await Heard.onRawPacket(new Uint8Array([0x15, 0x3f]), 0, SENT_AT)).toBe(null);
        expect(await Heard.onRawPacket(packet(GRP_TXT, [0x87], [1, 2, 3, 4, 5]), 0, SENT_AT)).toBe(null);
        expect(await Heard.onRawPacket(undefined, 0, SENT_AT)).toBe(null);
    });

});

describe("hearing our own direct message passed on", () => {

    const SELF = Uint8Array.from([0x42, 0x24, 1, 2]);
    const CONTACT = Uint8Array.from([0x5a, 0x11, 3, 4]);

    beforeEach(() => {
        Heard.reset();
        Heard.expectDirect({ id: "dm-1", selfKey: SELF, contactKey: CONTACT, sentAt: SENT_AT });
    });

    afterEach(() => {
        Heard.reset();
    });

    it("counts a text message from us to that contact", async () => {
        await Heard.onRawPacket(packet(TXT_MSG, [0x87], [0x5a, 0x42, 0xaa, 0xbb, 9, 9, 9, 9]), 0, SENT_AT + 1000);
        expect(Heard.count("dm-1")).toBe(1);
    });

    it("does not count the contact's reply, a message to somebody else, or somebody else's to our contact", async () => {
        await Heard.onRawPacket(packet(TXT_MSG, [0x87], [0x42, 0x5a, 0xaa, 0xbb, 9, 9]), 0, SENT_AT + 1000);
        await Heard.onRawPacket(packet(TXT_MSG, [0x87], [0x77, 0x42, 0xaa, 0xbb, 9, 9]), 0, SENT_AT + 1000);
        await Heard.onRawPacket(packet(TXT_MSG, [0x87], [0x5a, 0x77, 0xaa, 0xbb, 9, 9]), 0, SENT_AT + 1000);
        expect(Heard.count("dm-1")).toBe(0);
    });

    it("gives a copy to the newest message to that contact", async () => {
        Heard.expectDirect({ id: "dm-2", selfKey: SELF, contactKey: CONTACT, sentAt: SENT_AT + 30000 });
        await Heard.onRawPacket(packet(TXT_MSG, [0x87], [0x5a, 0x42, 0xaa, 0xbb, 9, 9]), 0, SENT_AT + 31000);
        expect(Heard.count("dm-1")).toBe(0);
        expect(Heard.count("dm-2")).toBe(1);
    });

});

describe("saying what was heard", () => {

    beforeEach(() => {
        Heard.reset();
    });

    afterEach(() => {
        Heard.reset();
        try { localStorage.removeItem(Heard.STORAGE_KEY); } catch(e) {}
    });

    it("names a repeater the hash picks out alone, leaves the hex when it does not, and says heard is not delivered", async () => {
        Heard.expectChannel({ id: "m", secret: SECRET, name: NAME, text: "DRILL test", sentAt: SENT_AT });
        await Heard.onRawPacket(await channelCopy([0x87]), 12, SENT_AT + 1000);
        await Heard.onRawPacket(await channelCopy([0x87, 0x79]), 3.25, SENT_AT + 1000);
        const contacts = [
            { advName: "Hilltop Rptr", publicKey: Uint8Array.from([0x87, 1]) },
            { advName: "One", publicKey: Uint8Array.from([0x79, 1]) },
            { advName: "Two", publicKey: Uint8Array.from([0x79, 2]) },
        ];
        const text = Heard.describe("m", contacts);
        expect(text).toContain("Heard by 2");
        expect(text).toContain("Heard is not delivered");
        expect(text).toContain("Hilltop Rptr (87), SNR 12");
        expect(text).toContain("Hilltop Rptr (87) → 79, SNR 3.25");
    });

    it("keeps the count across a reload", async () => {
        Heard.expectChannel({ id: "kept", secret: SECRET, name: NAME, text: "DRILL test", sentAt: SENT_AT });
        await Heard.onRawPacket(await channelCopy([0x87]), 0, SENT_AT + 1000);
        const stored = JSON.parse(localStorage.getItem(Heard.STORAGE_KEY));
        expect(stored.kept).toHaveLength(1);

        Heard.reset();
        Heard.loaded = false;
        expect(Heard.count("kept")).toBe(1);
    });

    it("keeps only the newest few hundred messages", async () => {
        Heard.KEEP = 3;
        try {
            for(let i = 0; i < 5; i++){
                Heard.expectChannel({ id: `m${i}`, secret: SECRET, name: NAME, text: `t${i}`, sentAt: SENT_AT });
                await Heard.onRawPacket(await channelCopy([0x87], { text: `t${i}` }), 0, SENT_AT + 1000 + i);
            }
            expect(Object.keys(Heard.state.byId).sort()).toEqual(["m2", "m3", "m4"]);
        } finally {
            Heard.KEEP = 300;
        }
    });

});

describe("wired into sending and the conversation", () => {

    const SELF_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

    beforeEach(() => {
        Heard.reset();
        GlobalState.selfInfo = { name: NAME, publicKey: SELF_KEY };
        GlobalState.channels = [{ idx: 13, name: "Emcomm Testing", secret: SECRET }];
        GlobalState.connection = {
            on() {}, off() {},
            sendChannelTextMessage: async () => {},
        };
    });

    afterEach(() => {
        Heard.reset();
        GlobalState.selfInfo = null;
        GlobalState.channels = [];
        GlobalState.connection = null;
        vi.restoreAllMocks();
    });

    it("listens for a channel message as soon as it is sent, with its key and our name", async () => {
        vi.spyOn(Database.ChannelMessage, "insert").mockResolvedValue({ id: "row-7" });
        const expect_ = vi.spyOn(Heard, "expectChannel");
        await Connection.sendChannelMessage(13, "DRILL test");
        expect(expect_).toHaveBeenCalledWith(expect.objectContaining({ id: "row-7", secret: SECRET, name: NAME, text: "DRILL test" }));

        // and the copy that comes back is counted against that row
        await Heard.onRawPacket(await channelCopy([0x87], { timestamp: Math.floor(Date.now() / 1000) }), 9);
        expect(Heard.count("row-7")).toBe(1);
    });

    it("listens for a direct message as soon as it is sent", async () => {
        GlobalState.connection.sendTextMessage = async () => ({ expectedAckCrc: 1, result: 0, estTimeout: 100000 });
        vi.spyOn(Database.Message, "insert").mockResolvedValue({ id: "dm-9" });
        const expect_ = vi.spyOn(Heard, "expectDirect");
        vi.useFakeTimers({ toFake: ["setTimeout"] });
        try {
            await Connection.sendMessage(Uint8Array.from([0x5a, 2, 3]), "hello");
        } finally {
            vi.useRealTimers();
        }
        expect(expect_).toHaveBeenCalledWith(expect.objectContaining({ id: "dm-9", selfKey: SELF_KEY }));
    });

    it("shows Heard by N on our own channel bubble, and nothing on one not heard", async () => {
        const rows = [
            { id: "heard-row", from: Array.from(SELF_KEY, (b) => b.toString(16).padStart(2, "0")).join(""), text: "DRILL test", timestamp: SENT_AT, channel_idx: 13 },
            { id: "quiet-row", from: Array.from(SELF_KEY, (b) => b.toString(16).padStart(2, "0")).join(""), text: "DRILL two", timestamp: SENT_AT + 1, channel_idx: 13 },
        ];
        vi.spyOn(Database.ChannelMessagesReadState, "touch").mockResolvedValue(undefined);
        vi.spyOn(Database.ChannelMessage, "getChannelMessages").mockReturnValue({
            $: { subscribe: (cb) => { cb(rows.map((r) => ({ toJSON: () => r }))); return { unsubscribe() {} }; } },
        });
        Heard.expectChannel({ id: "heard-row", secret: SECRET, name: NAME, text: "DRILL test", sentAt: SENT_AT });
        const wrapper = mount(MessageViewer, { props: { type: "channel", channel: GlobalState.channels[0] } });
        await flushPromises();
        expect(wrapper.findAll("[data-heard]")).toHaveLength(0);

        await Heard.onRawPacket(await channelCopy([0x87]), 0, SENT_AT + 1000);
        await Heard.onRawPacket(await channelCopy([0xba]), 0, SENT_AT + 1000);
        await flushPromises();
        const shown = wrapper.findAll("[data-heard]");
        expect(shown).toHaveLength(1);
        expect(shown[0].text()).toContain("Heard by 2");
        wrapper.unmount();
    });

});
