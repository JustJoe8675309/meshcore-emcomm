// Roll calls: asking every station on a channel, or in a room, for its position
// at once, and sending this station's own position to all of them unasked.
//
// Rooms relay posts, not datagrams, so there everything goes as a text post the
// room keeps and replays. The room firmware runs text type 1 from an admin as a
// command, which is why room traffic is plain text, and caps a post at 151 bytes.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Constants } from "@liamcottle/meshcore.js";
import * as Protocol from "../../src/js/position/PositionProtocol.js";
import PositionService, { GROUP_MIN_INTERVAL_MINUTES } from "../../src/js/position/PositionService.js";
import GroupPositionDialog from "../../src/components/position/GroupPositionDialog.vue";
import PositionsPanel from "../../src/components/position/PositionsPanel.vue";
import PositionPrompt from "../../src/components/position/PositionPrompt.vue";
import PositionSettingsGroup from "../../src/components/settings/PositionSettingsGroup.vue";
import Connection from "../../src/js/Connection.js";
import Database from "../../src/js/Database.js";
import NotificationUtils from "../../src/js/NotificationUtils.js";
import GlobalState from "../../src/js/GlobalState.js";
import OperatorSettings from "../../src/js/reports/OperatorSettings.js";

const ME = new Uint8Array(32).fill(0xa7);
const ALPHA = new Uint8Array(32).fill(0x39);
const BRAVO = new Uint8Array(32).fill(0x52);
const ROOM = new Uint8Array(32).fill(0x87);
const ROOM_HEX = Array.from(ROOM).map((b) => b.toString(16).padStart(2, "0")).join("");

const ALPHA_CONTACT = { publicKey: ALPHA, advName: "KJ5HBN-EMCOMM", type: Constants.AdvType.Chat, flags: 0 };
const ROOM_CONTACT = { publicKey: ROOM, advName: "N.E. ELP EMCOMM OBSVR", type: Constants.AdvType.Room, flags: 0 };

const CHANNEL = { kind: "channel", idx: 7, name: "Emcomm Testing" };
const ROOM_VIA = { kind: "room", contactKeyHex: ROOM_HEX, name: "N.E. ELP EMCOMM OBSVR" };

function connect({ lat = 31.7587, lon = -106.4869 } = {}) {
    GlobalState.connection = { on() {}, off() {} };
    GlobalState.selfInfo = { name: "Joe-KJ5HBN-HTv3", publicKey: ME, advLat: Math.round(lat * 1e6), advLon: Math.round(lon * 1e6), radioFreq: 910525, radioBw: 62500, radioSf: 7, radioCr: 5 };
    GlobalState.contacts = [ALPHA_CONTACT, ROOM_CONTACT];
    GlobalState.channels = [{ idx: 7, name: "Emcomm Testing" }, { idx: 0, name: "Public" }];
    GlobalState.gpsStatus = "unconfirmed";
    GlobalState.roomLogins = {};
}

function reset() {
    for(const request of [...PositionService.state.requests]){
        PositionService.stop(request.tag);
    }
    PositionService.state.requests.splice(0);
    PositionService.state.reports.splice(0);
    PositionService.state.prompt = null;
    PositionService.state.groupTarget = null;
    PositionService.autoPending.clear();
}

// what a station sends back to a roll call on the channel
function answerOnChannel(from, tag, extra = {}) {
    PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({
        kind: Protocol.KIND.POSITION, tag, to: ME, from, name: from === ALPHA ? "KJ5HBN" : "KF5XYZ",
        latitude: 31.788, longitude: -106.497, fixTime: 0, flags: 0, ...extra,
    }) });
}

function rollCallFrom(from, tag = 77, heard = []) {
    return Protocol.encode({ kind: Protocol.KIND.ROLL_CALL, tag, to: Protocol.EVERYONE, from, name: "NCS", heard });
}

describe("the roll call bytes", () => {

    it("carry the stations already heard, three bytes of each key", () => {
        const decoded = Protocol.decode(Protocol.encode({
            kind: Protocol.KIND.ROLL_CALL, tag: 5, to: Protocol.EVERYONE, from: ME, name: "KJ5HBN", heard: ["393939", "525252"],
        }));
        expect(decoded.kind).toBe(Protocol.KIND.ROLL_CALL);
        expect(Protocol.isEveryone(decoded.to)).toBe(true);
        expect(decoded.heard).toEqual(["393939", "525252"]);
        expect(decoded.name).toBe("KJ5HBN");
        expect(Protocol.isHeard(decoded.heard, ALPHA)).toBe(true);
        expect(Protocol.isHeard(decoded.heard, ME)).toBe(false);
    });

    it("are a kind of their own, so a single station request is never mistaken for one", () => {
        const request = Protocol.decode(Protocol.encode({ kind: Protocol.KIND.REQUEST, tag: 1, to: ALPHA, from: ME, name: "x" }));
        expect(request.heard).toBeUndefined();
        expect(Protocol.isEveryone(request.to)).toBe(false);
    });

    it("drop the earliest heard stations to fit a datagram", () => {
        const heard = Array.from({ length: 60 }, (_, i) => i.toString(16).padStart(6, "0"));
        const fitted = Protocol.fitRollCall({ kind: Protocol.KIND.ROLL_CALL, tag: 1, to: Protocol.EVERYONE, from: ME, name: "KJ5HBN", heard }, Protocol.MAX_DATAGRAM_BYTES);
        expect(Protocol.encode(fitted).length).toBeLessThanOrEqual(Protocol.MAX_DATAGRAM_BYTES);
        expect(fitted.heard[fitted.heard.length - 1]).toBe(heard[59]);
    });

    it("fit a room post of 151 bytes, readable line and all, and still read back", () => {
        const heard = Array.from({ length: 40 }, (_, i) => i.toString(16).padStart(6, "0"));
        const text = Protocol.toDirectText(
            { kind: Protocol.KIND.ROLL_CALL, tag: 9, to: Protocol.EVERYONE, from: ME, name: "Ω".repeat(20), heard },
            "Position roll call from KJ5HBN (answering needs MeshCore-Emcomm)",
            Protocol.MAX_ROOM_BYTES,
        );
        expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(151);
        expect(text.startsWith("Position roll call")).toBe(true);
        expect(Protocol.fromDirectText(text).kind).toBe(Protocol.KIND.ROLL_CALL);
    });

});

describe("asking everyone", () => {

    let sent;

    beforeEach(() => {
        vi.useFakeTimers();
        window.localStorage.clear();
        reset();
        connect();
        sent = [];
        vi.spyOn(Connection, "sendChannelDatagram").mockImplementation(async (idx, type, payload) => { sent.push({ idx, message: Protocol.decode(payload) }); });
        vi.spyOn(Connection, "sendRoomPost").mockImplementation(async (key, text) => { sent.push({ key, text, message: Protocol.fromDirectText(text) }); });
        vi.spyOn(Connection, "requestTelemetry").mockRejectedValue(new Error("timeout"));
    });

    afterEach(() => {
        reset();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("once: one roll call to everyone, answers gathered, then closes after 5 minutes", async () => {
        const request = PositionService.startRollCall(CHANNEL, { type: "once" });
        await vi.advanceTimersByTimeAsync(0);
        expect(sent).toHaveLength(1);
        expect(sent[0].idx).toBe(7);
        expect(sent[0].message.kind).toBe(Protocol.KIND.ROLL_CALL);
        expect(Protocol.isEveryone(sent[0].message.to)).toBe(true);

        answerOnChannel(ALPHA, request.tag);
        answerOnChannel(BRAVO, request.tag, { flags: Protocol.FLAG.NO_POSITION });
        // one answer does not end a roll call: others are still answering
        expect(request.status).toBe("running");
        expect(request.rounds[0].answers.map((a) => a.kind)).toEqual(["position", "none"]);

        // no radio is asked by telemetry for a roll call
        await vi.advanceTimersByTimeAsync(5 * 60000);
        expect(Connection.requestTelemetry).not.toHaveBeenCalled();
        expect(request.status).toBe("done");
        expect(request.outcome).toBe("2 stations answered: 1 with a position, 1 with none set.");
    });

    it("still counts an answer given after it closed, marked late", async () => {
        const request = PositionService.startRollCall(CHANNEL, { type: "once" });
        await vi.advanceTimersByTimeAsync(5 * 60000);
        expect(request.outcome).toBe("No station answered.");
        answerOnChannel(ALPHA, request.tag);
        expect(request.rounds[0].answers[0].late).toBe(true);
        expect(request.outcome).toBe("1 station answered: 1 with a position.");
    });

    it("again: asks the same roll call again, naming the stations heard, who stay silent", async () => {
        const request = PositionService.startRollCall(CHANNEL, { type: "again", intervalMinutes: 5, maxCount: 3 });
        await vi.advanceTimersByTimeAsync(0);
        answerOnChannel(ALPHA, request.tag);
        await vi.advanceTimersByTimeAsync(5 * 60000);
        expect(sent).toHaveLength(2);
        expect(sent[1].message.tag).toBe(sent[0].message.tag);
        expect(sent[1].message.heard).toEqual(["393939"]);
        await vi.advanceTimersByTimeAsync(5 * 60000);
        expect(sent).toHaveLength(3);
        await vi.advanceTimersByTimeAsync(10 * 60000);
        expect(sent).toHaveLength(3);
        expect(request.status).toBe("done");
    });

    it("track: a fresh roll call each round, with everyone answering again", async () => {
        const request = PositionService.startRollCall(CHANNEL, { type: "track", intervalMinutes: 5, maxCount: 2 });
        await vi.advanceTimersByTimeAsync(0);
        answerOnChannel(ALPHA, sent[0].message.tag);
        await vi.advanceTimersByTimeAsync(5 * 60000);
        expect(sent).toHaveLength(2);
        expect(sent[1].message.tag).not.toBe(sent[0].message.tag);
        expect(sent[1].message.heard).toEqual([]);
        expect(request.rounds).toHaveLength(2);
        expect(PositionService.currentRound(request).answers).toEqual([]);
        answerOnChannel(ALPHA, sent[1].message.tag);
        expect(PositionService.currentRound(request).answers).toHaveLength(1);
    });

    it("never repeats sooner than every 5 minutes", async () => {
        const request = PositionService.startRollCall(CHANNEL, { type: "again", intervalMinutes: 1, maxCount: 3 });
        expect(request.mode.intervalMinutes).toBe(GROUP_MIN_INTERVAL_MINUTES);
    });

    it("replaces a roll call still running on the same channel", async () => {
        const first = PositionService.startRollCall(CHANNEL, { type: "once" });
        const second = PositionService.startRollCall(CHANNEL, { type: "once" });
        expect(first.status).toBe("stopped");
        expect(first.outcome).toBe("Replaced by a new roll call.");
        expect(second.status).toBe("running");
    });

    it("goes into a room as a post, not type 1, which a room runs as an admin's command", async () => {
        const sendCommandData = vi.spyOn(Connection, "sendCommandData");
        PositionService.startRollCall(ROOM_VIA, { type: "once" });
        await vi.advanceTimersByTimeAsync(0);
        expect(sendCommandData).not.toHaveBeenCalled();
        expect(sent[0].key).toEqual(ROOM);
        expect(new TextEncoder().encode(sent[0].text).length).toBeLessThanOrEqual(151);
        expect(sent[0].text.startsWith("Position roll call from")).toBe(true);
    });

});

describe("being asked with everyone else", () => {

    let sent;

    beforeEach(() => {
        vi.useFakeTimers();
        window.localStorage.clear();
        reset();
        connect();
        OperatorSettings.setCallsign("KJ5HBN");
        sent = [];
        vi.spyOn(Connection, "sendChannelDatagram").mockImplementation(async (idx, type, payload) => { sent.push({ idx, message: Protocol.decode(payload) }); });
        vi.spyOn(Connection, "sendRoomPost").mockImplementation(async (key, text) => { sent.push({ key, text, message: Protocol.fromDirectText(text) }); });
    });

    afterEach(() => {
        reset();
        OperatorSettings.setCallsign("");
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const mark = (settings) => PositionService.saveSettings({ markedChannels: [], markedRooms: [], autoAnswer: false, ...settings });

    it("ignores a roll call on a channel not ticked", () => {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: rollCallFrom(ALPHA) });
        expect(PositionService.state.prompt).toBe(null);
    });

    it("puts one on a ticked channel to the operator, as a roll call", () => {
        mark({ markedChannels: [7] });
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: rollCallFrom(ALPHA) });
        expect(PositionService.state.prompt.rollCall).toBe(true);
        expect(PositionService.state.prompt.name).toBe("NCS");
    });

    it("stays silent when named among the stations already heard", () => {
        mark({ markedChannels: [7] });
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: rollCallFrom(ALPHA, 77, ["a7a7a7"]) });
        expect(PositionService.state.prompt).toBe(null);
    });

    it("ignores its own roll call heard back through a repeater", () => {
        mark({ markedChannels: [7] });
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: rollCallFrom(ME) });
        expect(PositionService.state.prompt).toBe(null);
    });

    it("answers to the station that asked, on the channel, for everyone there to see", async () => {
        mark({ markedChannels: [7] });
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: rollCallFrom(ALPHA, 77) });
        await PositionService.answer(PositionService.state.prompt, {});
        expect(sent[0].idx).toBe(7);
        expect(sent[0].message.kind).toBe(Protocol.KIND.POSITION);
        expect(sent[0].message.tag).toBe(77);
        expect(Protocol.prefixHex(sent[0].message.to)).toBe("393939393939");
        expect(sent[0].message.name).toBe("KJ5HBN");
    });

    it("answering automatically, waits a random moment first, so answers do not collide", async () => {
        mark({ markedChannels: [7], autoAnswer: true });
        vi.spyOn(Math, "random").mockReturnValue(0.5);
        const spread = PositionService.rollCallSpreadMillis();
        expect(spread).toBeGreaterThanOrEqual(10000);
        expect(spread).toBeLessThanOrEqual(60000);
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: rollCallFrom(ALPHA) });
        // the same roll call heard again through another repeater
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: rollCallFrom(ALPHA) });
        await vi.advanceTimersByTimeAsync(0);
        expect(sent).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(Math.floor(spread / 2));
        expect(sent).toHaveLength(1);
        expect(PositionService.state.prompt).toBe(null);
    });

    it("answers a single station's own request automatically at once, as before", async () => {
        mark({ markedChannels: [7], autoAnswer: true });
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({ kind: Protocol.KIND.REQUEST, tag: 3, to: ME, from: ALPHA, name: "NCS" }) });
        await vi.advanceTimersByTimeAsync(0);
        expect(sent).toHaveLength(1);
    });

    it("sends its position unasked to everyone on a channel", async () => {
        const own = await PositionService.shareOwn(CHANNEL);
        expect(own.lastKnown).toBe(true);
        expect(Protocol.isEveryone(sent[0].message.to)).toBe(true);
        expect(sent[0].message.tag).toBe(0);
        expect(sent[0].message.lastKnown).toBe(true);
        expect(sent[0].message.latitude).toBeCloseTo(31.7587, 4);
    });

    it("will not send a position it does not have", async () => {
        connect({ lat: 0, lon: 0 });
        await expect(PositionService.shareOwn(CHANNEL)).rejects.toThrow(/no position/);
        expect(sent).toHaveLength(0);
    });

});

describe("in a room", () => {

    let sent;

    beforeEach(() => {
        window.localStorage.clear();
        reset();
        connect();
        sent = [];
        vi.spyOn(Connection, "sendRoomPost").mockImplementation(async (key, text) => { sent.push({ key, text, message: Protocol.fromDirectText(text) }); });
    });

    afterEach(() => {
        reset();
        vi.restoreAllMocks();
    });

    const now = () => Math.floor(Date.now() / 1000);
    const post = (message, readable = "Position roll call from NCS") => Protocol.toDirectText(message, readable, Protocol.MAX_ROOM_BYTES);
    const rollCall = () => post({ kind: Protocol.KIND.ROLL_CALL, tag: 12, to: Protocol.EVERYONE, from: ALPHA, name: "NCS", heard: [] });

    it("answers only in a room ticked for it", () => {
        expect(PositionService.onRoomText(ROOM_CONTACT, ALPHA.slice(0, 4), rollCall(), now())).toBe(true);
        expect(PositionService.state.prompt).toBe(null);
        PositionService.saveSettings({ markedChannels: [], markedRooms: [ROOM_HEX], autoAnswer: false });
        PositionService.onRoomText(ROOM_CONTACT, ALPHA.slice(0, 4), rollCall(), now());
        expect(PositionService.state.prompt.via).toEqual(ROOM_VIA);
    });

    it("answers as a post in the room, within the room's 151 bytes", async () => {
        PositionService.saveSettings({ markedChannels: [], markedRooms: [ROOM_HEX], autoAnswer: false });
        PositionService.onRoomText(ROOM_CONTACT, ALPHA.slice(0, 4), rollCall(), now());
        await PositionService.answer(PositionService.state.prompt, {});
        expect(sent[0].key).toEqual(ROOM);
        expect(new TextEncoder().encode(sent[0].text).length).toBeLessThanOrEqual(151);
        expect(sent[0].message.tag).toBe(12);
        expect(sent[0].text.startsWith("Last known position of")).toBe(true);
    });

    it("ignores a roll call the room replays from before a login, but keeps a position it replays", () => {
        PositionService.saveSettings({ markedChannels: [], markedRooms: [ROOM_HEX], autoAnswer: false });
        const old = now() - 20 * 60;
        expect(PositionService.onRoomText(ROOM_CONTACT, ALPHA.slice(0, 4), rollCall(), old)).toBe(true);
        expect(PositionService.state.prompt).toBe(null);
        PositionService.onRoomText(ROOM_CONTACT, ALPHA.slice(0, 4), post({
            kind: Protocol.KIND.POSITION, tag: 0, to: Protocol.EVERYONE, from: ALPHA, name: "KJ5HBN", latitude: 31.788, longitude: -106.497, fixTime: 0, flags: 0,
        }, "Position of KJ5HBN"), old);
        expect(PositionService.state.reports[0].via.kind).toBe("room");
        expect(PositionService.state.reports[0].shared).toBe(true);
    });

    it("judges a post's age by the room's own clock, read at login, not this one", () => {
        PositionService.saveSettings({ markedChannels: [], markedRooms: [ROOM_HEX], autoAnswer: false });
        // a room without GPS running 30 minutes slow: a roll call posted just now
        // carries a time 30 minutes ago by this clock
        const roomNow = now() - 30 * 60;
        GlobalState.roomLogins[ROOM_HEX] = { isAdmin: true, canPost: true, clockOffsetSeconds: -30 * 60 };
        PositionService.onRoomText(ROOM_CONTACT, ALPHA.slice(0, 4), rollCall(), roomNow);
        expect(PositionService.state.prompt?.rollCall).toBe(true);
        // and one really posted 20 minutes ago, by the room's clock, is still a replay
        PositionService.state.prompt = null;
        PositionService.onRoomText(ROOM_CONTACT, ALPHA.slice(0, 4), rollCall(), roomNow - 20 * 60);
        expect(PositionService.state.prompt).toBe(null);
    });

    it("reads the room's clock from the login success frame", () => {
        const roomTime = now() - 1800;
        const frame = new Uint8Array(14);
        frame[0] = 0x85;
        frame[1] = 1;
        frame.set(ROOM.slice(0, 6), 2);
        new DataView(frame.buffer).setUint32(8, roomTime, true);
        frame[12] = 3;
        frame[13] = 9;
        const login = Connection.readLoginSuccess(frame);
        expect(login.canPost).toBe(true);
        expect(Math.abs(login.clockOffsetSeconds - -1800)).toBeLessThanOrEqual(1);
        // a frame from before the room sent its time says nothing about its clock
        expect(Connection.readLoginSuccess(frame.slice(0, 8)).clockOffsetSeconds).toBe(null);
    });

    it("does not believe a post whose code names another author than the room does", () => {
        PositionService.saveSettings({ markedChannels: [], markedRooms: [ROOM_HEX], autoAnswer: false });
        expect(PositionService.onRoomText(ROOM_CONTACT, BRAVO.slice(0, 4), rollCall(), now())).toBe(true);
        expect(PositionService.state.prompt).toBe(null);
    });

    it("leaves an ordinary post alone", () => {
        expect(PositionService.onRoomText(ROOM_CONTACT, ALPHA.slice(0, 4), "DRILL net check in", now())).toBe(false);
    });

    it("keeps a roll call post out of the room's conversation, with no notification", async () => {
        PositionService.saveSettings({ markedChannels: [], markedRooms: [ROOM_HEX], autoAnswer: false });
        const insert = vi.spyOn(Database.Message, "insert").mockResolvedValue({});
        const notify = vi.spyOn(NotificationUtils, "showNewMessageNotification").mockResolvedValue(undefined);
        await Connection.onContactMessageReceived({ pubKeyPrefix: ROOM.slice(0, 6), txtType: 2, text: rollCall(), senderTimestamp: now(), pathLen: 0 });
        expect(insert).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
        expect(PositionService.state.prompt.rollCall).toBe(true);
    });

});

describe("the roll call form", () => {

    beforeEach(() => {
        window.localStorage.clear();
        reset();
        connect();
    });

    afterEach(() => {
        reset();
        vi.restoreAllMocks();
    });

    const mountDialog = () => mount(GroupPositionDialog, { global: { mocks: { $router: { push: vi.fn() } } } });
    const goButton = (wrapper) => wrapper.findAll("button").find((b) => /Start roll call|^Send$/.test(b.text()));

    it("refuses under 5 minutes and warns under 15", async () => {
        const wrapper = mountDialog();
        PositionService.openGroup("rollcall", CHANNEL);
        await flushPromises();
        expect(wrapper.text()).toContain("Position roll call on Emcomm Testing");
        await wrapper.find('input[value="again"]').setValue(true);
        wrapper.vm.intervalMinutes = 2;
        await flushPromises();
        expect(wrapper.text()).toContain("The shortest interval for a roll call is 5 minutes");
        expect(goButton(wrapper).attributes("disabled")).toBeDefined();
        wrapper.vm.intervalMinutes = 10;
        await flushPromises();
        expect(wrapper.text()).toContain("Under 15 minutes is a lot of traffic");
        expect(goButton(wrapper).attributes("disabled")).toBeUndefined();
    });

    it("starts the roll call and shows the Positions tab", async () => {
        const start = vi.spyOn(PositionService, "startRollCall").mockReturnValue({});
        const wrapper = mountDialog();
        PositionService.openGroup("rollcall", CHANNEL);
        await flushPromises();
        await goButton(wrapper).trigger("click");
        expect(start).toHaveBeenCalledWith(CHANNEL, { type: "once", intervalMinutes: 15, maxCount: 3 });
        expect(wrapper.vm.$router.push).toHaveBeenCalledWith({ name: "main", query: { tab: "positions" } });
        expect(PositionService.state.groupTarget).toBe(null);
    });

    it("says in a room that stock apps see the post, and it takes a place in the room's store", async () => {
        const wrapper = mountDialog();
        PositionService.openGroup("rollcall", ROOM_VIA);
        await flushPromises();
        expect(wrapper.text()).toContain("Position roll call in N.E. ELP EMCOMM OBSVR");
        expect(wrapper.text()).toContain("32 places");
    });

    it("sends this station's position, saying it goes as last known without a live fix", async () => {
        const share = vi.spyOn(PositionService, "shareOwn").mockResolvedValue({});
        const wrapper = mountDialog();
        PositionService.openGroup("share", CHANNEL);
        await flushPromises();
        expect(wrapper.text()).toContain("Send my position on Emcomm Testing");
        expect(wrapper.text()).toContain("last known position, not a current fix");
        await goButton(wrapper).trigger("click");
        await flushPromises();
        expect(share).toHaveBeenCalledWith(CHANNEL);
    });

    it("has nothing to send from a radio with no position", async () => {
        connect({ lat: 0, lon: 0 });
        const wrapper = mountDialog();
        PositionService.openGroup("share", CHANNEL);
        await flushPromises();
        expect(wrapper.text()).toContain("no position set");
        expect(goButton(wrapper).attributes("disabled")).toBeDefined();
    });

});

describe("the positions list, for a roll call", () => {

    beforeEach(() => {
        vi.useFakeTimers();
        window.localStorage.clear();
        reset();
        connect();
        vi.spyOn(Connection, "sendChannelDatagram").mockResolvedValue(undefined);
    });

    afterEach(() => {
        reset();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("lists each station that answered, with where it is from here", async () => {
        const request = PositionService.startRollCall(CHANNEL, { type: "once" });
        await vi.advanceTimersByTimeAsync(0);
        answerOnChannel(ALPHA, request.tag);
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({ kind: Protocol.KIND.DECLINED, tag: request.tag, to: ME, from: BRAVO, name: "KF5XYZ" }) });
        const wrapper = mount(PositionsPanel);
        await flushPromises();
        const text = wrapper.text();
        expect(text).toContain("Everyone on Emcomm Testing");
        expect(text).toContain("Listening");
        expect(text).toContain("2 answered");
        expect(text).toMatch(/KJ5HBN\s*· KJ5HBN-EMCOMM\s*31\.7880° N, 106\.4970° W, 2\.1 mi \(3\.4 km\), \d{3}° magnetic/);
        expect(text).toMatch(/KF5XYZ\s*declined/);
    });

    it("labels a position sent to everyone unasked", async () => {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({
            kind: Protocol.KIND.POSITION, tag: 0, to: Protocol.EVERYONE, from: ALPHA, name: "KJ5HBN", latitude: 31.788, longitude: -106.497, fixTime: 0, flags: 0,
        }) });
        const wrapper = mount(PositionsPanel);
        await flushPromises();
        expect(wrapper.text()).toContain("Sent to everyone on Emcomm Testing, unasked");
    });

});

describe("the prompt, for a roll call in a room", () => {

    beforeEach(() => {
        window.localStorage.clear();
        reset();
        connect();
        PositionService.FRESHNESS_INTERVAL_MILLIS = 0;
    });

    afterEach(() => {
        reset();
        vi.restoreAllMocks();
    });

    it("says it asks everyone, and that the answer is a post everyone in the room sees", async () => {
        PositionService.saveSettings({ markedChannels: [], markedRooms: [ROOM_HEX], autoAnswer: false });
        const wrapper = mount(PositionPrompt, { global: { mocks: { $router: { push: vi.fn() } } } });
        PositionService.onRoomText(ROOM_CONTACT, ALPHA.slice(0, 4), Protocol.toDirectText(
            { kind: Protocol.KIND.ROLL_CALL, tag: 12, to: Protocol.EVERYONE, from: ALPHA, name: "NCS", heard: [] }, "x", Protocol.MAX_ROOM_BYTES,
        ), Math.floor(Date.now() / 1000));
        await flushPromises();
        expect(wrapper.text()).toContain("NCS asks everyone for their position");
        expect(wrapper.text()).toContain("In the room N.E. ELP EMCOMM OBSVR");
    });

    it("opens the room's conversation for Send with message", async () => {
        PositionService.saveSettings({ markedChannels: [], markedRooms: [ROOM_HEX], autoAnswer: false });
        vi.spyOn(Connection, "sendRoomPost").mockResolvedValue(undefined);
        const push = vi.fn();
        const wrapper = mount(PositionPrompt, { global: { mocks: { $router: { push } } } });
        PositionService.onRoomText(ROOM_CONTACT, ALPHA.slice(0, 4), Protocol.toDirectText(
            { kind: Protocol.KIND.ROLL_CALL, tag: 12, to: Protocol.EVERYONE, from: ALPHA, name: "NCS", heard: [] }, "x", Protocol.MAX_ROOM_BYTES,
        ), Math.floor(Date.now() / 1000));
        await flushPromises();
        await wrapper.findAll("button").find((b) => b.text() === "Send with message").trigger("click");
        await flushPromises();
        expect(push).toHaveBeenCalledWith({ name: "contact.messages", params: { publicKey: ROOM_HEX } });
    });

});

describe("the settings, for rooms", () => {

    beforeEach(() => {
        window.localStorage.clear();
        reset();
        connect();
    });

    it("lists the radio's rooms, none ticked, and saves one ticked", async () => {
        const wrapper = mount(PositionSettingsGroup);
        expect(wrapper.text()).toContain("Answer in these rooms");
        const box = wrapper.findAll("label").find((l) => l.text() === "N.E. ELP EMCOMM OBSVR").find("input");
        expect(box.element.checked).toBe(false);
        await box.setValue(true);
        expect(PositionService.settings().markedRooms).toEqual([ROOM_HEX]);
    });

});
