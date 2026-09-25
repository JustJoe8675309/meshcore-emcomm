// Asking a station for its position, and answering.
//
// On the bench a channel datagram from node 1 reached node 2 in under half a
// second and was ignored by the chat; a direct message of text type 1 arrived
// too, but the app filed it in the conversation with a notification. These
// check the bytes, the request modes, the answering, and that a direct request
// stays out of the chat.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Constants, CayenneLpp } from "@liamcottle/meshcore.js";
import * as Protocol from "../../src/js/position/PositionProtocol.js";
import PositionService from "../../src/js/position/PositionService.js";
import PositionPrompt from "../../src/components/position/PositionPrompt.vue";
import PositionRequestDialog from "../../src/components/position/PositionRequestDialog.vue";
import PositionsPanel from "../../src/components/position/PositionsPanel.vue";
import Connection from "../../src/js/Connection.js";
import Database from "../../src/js/Database.js";
import NotificationUtils from "../../src/js/NotificationUtils.js";
import GlobalState from "../../src/js/GlobalState.js";
import OperatorSettings from "../../src/js/reports/OperatorSettings.js";
import Geo from "../../src/js/position/Geo.js";

const ME = new Uint8Array(32).fill(0xa7);
const THEM = new Uint8Array(32).fill(0x39);
const NODE = Array.from(ME).map((b) => b.toString(16).padStart(2, "0")).join("");
const THEM_HEX = Array.from(THEM).map((b) => b.toString(16).padStart(2, "0")).join("");

const THEM_CONTACT = { publicKey: THEM, advName: "KJ5HBN-EMCOMM", type: Constants.AdvType.Chat, flags: 0 };

function connect({ lat = 31.7587, lon = -106.4869 } = {}) {
    GlobalState.connection = { on() {}, off() {} };
    GlobalState.selfInfo = { name: "Joe-KJ5HBN-HTv3", publicKey: ME, advLat: Math.round(lat * 1e6), advLon: Math.round(lon * 1e6) };
    GlobalState.contacts = [THEM_CONTACT];
    GlobalState.channels = [{ idx: 7, name: "Emcomm Testing" }, { idx: 0, name: "Public" }];
    GlobalState.gpsStatus = "unconfirmed";
}

function reset() {
    for(const request of [...PositionService.state.requests]){
        PositionService.stop(request.tag);
    }
    PositionService.state.requests.splice(0);
    PositionService.state.reports.splice(0);
    PositionService.state.prompt = null;
    PositionService.state.requestTarget = null;
}

// a request as it arrives on a channel from the other station
function incomingRequest(tag = 1234, to = ME) {
    return Protocol.encode({ kind: Protocol.KIND.REQUEST, tag, to, from: THEM, name: "KJ5HBN-EMCOMM" });
}

describe("the bytes", () => {

    it("carry a request and read back the same", () => {
        const decoded = Protocol.decode(Protocol.encode({ kind: Protocol.KIND.REQUEST, tag: 0xdeadbeef, to: THEM, from: ME, name: "KJ5HBN" }));
        expect(decoded.kind).toBe(Protocol.KIND.REQUEST);
        expect(decoded.tag).toBe(0xdeadbeef);
        expect(Protocol.prefixHex(decoded.to)).toBe(THEM_HEX.slice(0, 12));
        expect(Protocol.prefixHex(decoded.from)).toBe(NODE.slice(0, 12));
        expect(decoded.name).toBe("KJ5HBN");
    });

    it("carry a position to a millionth of a degree, with its flags", () => {
        const decoded = Protocol.decode(Protocol.encode({
            kind: Protocol.KIND.POSITION, tag: 7, to: ME, from: THEM, name: "N",
            latitude: -33.856812, longitude: 151.215301, fixTime: 1790000000,
            flags: Protocol.FLAG.LIVE_FIX | Protocol.FLAG.MESSAGE_TO_FOLLOW,
        }));
        expect(decoded.latitude).toBe(-33.856812);
        expect(decoded.longitude).toBe(151.215301);
        expect(decoded.fixTime).toBe(1790000000);
        expect(decoded.liveFix).toBe(true);
        expect(decoded.messageToFollow).toBe(true);
        expect(decoded.hasPosition).toBe(true);
    });

    it("say plainly when there is no position, rather than send 0, 0", () => {
        const decoded = Protocol.decode(Protocol.encode({ kind: Protocol.KIND.POSITION, tag: 1, to: ME, from: THEM, latitude: 0, longitude: 0, flags: Protocol.FLAG.NO_POSITION }));
        expect(decoded.hasPosition).toBe(false);
    });

    it("ignore anything that is not theirs", () => {
        expect(Protocol.decode(new TextEncoder().encode("DRILL datagram test 2"))).toBe(null);
        expect(Protocol.decode(new Uint8Array([2, 1]))).toBe(null);
        expect(Protocol.fromDirectText("an ordinary message")).toBe(null);
        expect(Protocol.fromDirectText("broken #mce1:!!!")).toBe(null);
    });

    it("cut a long name on a character boundary", () => {
        const name = "Ω".repeat(40);
        const decoded = Protocol.decode(Protocol.encode({ kind: Protocol.KIND.REQUEST, tag: 1, to: THEM, from: ME, name }));
        expect(decoded.name).toBe("Ω".repeat(16));
    });

    it("never let a long readable line push a direct message past 160 bytes", () => {
        const text = Protocol.toDirectText(
            { kind: Protocol.KIND.POSITION, tag: 9, to: THEM, from: ME, name: "", latitude: -33.8568, longitude: 151.2153, fixTime: 0, flags: Protocol.FLAG.LAST_KNOWN },
            `Last known position of ${"Ω".repeat(40)} (not a current fix): 33.8568° S, 151.2153° E`,
        );
        expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(160);
        expect(Protocol.fromDirectText(text).latitude).toBe(-33.8568);
        expect(Protocol.fromDirectText(text).lastKnown).toBe(true);
    });

    it("send direct as a readable line with the payload after it, well inside a message", () => {
        const text = Protocol.toDirectText(
            { kind: Protocol.KIND.POSITION, tag: 9, to: THEM, from: ME, name: "", latitude: 31.7619, longitude: -106.485, fixTime: 0, flags: 0 },
            "Position of KJ5HBN-EMCOMM: 31.7619° N, 106.4850° W",
        );
        expect(text.startsWith("Position of KJ5HBN-EMCOMM")).toBe(true);
        expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(160);
        expect(Protocol.fromDirectText(text).latitude).toBe(31.7619);
    });

});

describe("being asked", () => {

    let datagrams;
    let directs;

    beforeEach(() => {
        window.localStorage.clear();
        reset();
        connect();
        OperatorSettings.setCallsign("KJ5HBN");
        datagrams = [];
        directs = [];
        vi.spyOn(Connection, "sendChannelDatagram").mockImplementation(async (idx, type, payload) => { datagrams.push({ idx, type, message: Protocol.decode(payload) }); });
        vi.spyOn(Connection, "sendCommandData").mockImplementation(async (key, text) => { directs.push({ key, text, message: Protocol.fromDirectText(text) }); });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        OperatorSettings.setCallsign("");
        reset();
    });

    const mark = () => PositionService.saveSettings({ autoAnswer: false });

    // Every channel is answered now. It used to be a list of ticked slots, and
    // that list was dragged from slot to slot on every mode switch — three faults
    // in one evening came from it being dragged wrong. The operator's question was
    // never "which channels" but "am I asked first".
    it("asks the operator about a request on any channel it holds", () => {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest() });
        expect(PositionService.state.prompt.name).toBe("KJ5HBN-EMCOMM");
        expect(PositionService.state.prompt.via).toEqual({ kind: "channel", idx: 7, name: "Emcomm Testing" });
    });

    it("answers on a channel that was never chosen for it", () => {
        // slot 0 is Public on the bench radios, and nothing was ever ticked
        PositionService.onChannelData({ channelIdx: 0, dataType: Protocol.DATA_TYPE, data: incomingRequest() });
        expect(PositionService.state.prompt).not.toBe(null);
        expect(PositionService.state.prompt.via.idx).toBe(0);
    });

    it("ignores a request for another station, and another app's datagrams", () => {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest(1, THEM) });
        PositionService.onChannelData({ channelIdx: 7, dataType: 0xFF00, data: incomingRequest() });
        expect(PositionService.state.prompt).toBe(null);
    });

    it("keeps one prompt per station however often it asks", () => {
        for(let i = 0; i < 3; i++){
            PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest(55) });
        }
        expect(PositionService.state.prompt.count).toBe(3);
    });

    it("always asks about a direct request, since it is addressed to this station", () => {
        const text = Protocol.toDirectText({ kind: Protocol.KIND.REQUEST, tag: 3, to: ME, from: THEM, name: "" }, "Position request");
        expect(PositionService.onDirectText(THEM_CONTACT, text)).toBe(true);
        expect(PositionService.state.prompt.via.kind).toBe("direct");
        expect(PositionService.state.prompt.name).toBe("KJ5HBN-EMCOMM");
    });

    it("sends the position on the same channel, answering the tag", async () => {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest(77) });
        await PositionService.answer(PositionService.state.prompt);

        expect(datagrams).toHaveLength(1);
        const { idx, type, message } = datagrams[0];
        expect(idx).toBe(7);
        expect(type).toBe(Protocol.DATA_TYPE);
        expect(message.kind).toBe(Protocol.KIND.POSITION);
        expect(message.tag).toBe(77);
        expect(Protocol.prefixHex(message.to)).toBe(THEM_HEX.slice(0, 12));
        expect(message.latitude).toBeCloseTo(31.7587, 6);
        expect(message.liveFix).toBe(false);
        expect(message.messageToFollow).toBe(false);
        expect(PositionService.state.prompt).toBe(null);
    });

    it("answers a direct request directly, with a readable line", async () => {
        const text = Protocol.toDirectText({ kind: Protocol.KIND.REQUEST, tag: 3, to: ME, from: THEM, name: "" }, "Position request");
        PositionService.onDirectText(THEM_CONTACT, text);
        await PositionService.answer(PositionService.state.prompt, { messageToFollow: true });

        expect(datagrams).toHaveLength(0);
        expect(directs).toHaveLength(1);
        // no confirmed GPS on this radio, so it goes as a last known position, and says so
        expect(directs[0].text).toMatch(/^Last known position of KJ5HBN \(not a current fix\): 31\.7587° N, 106\.4869° W #mce1:/);
        expect(directs[0].message.lastKnown).toBe(true);
        expect(directs[0].message.messageToFollow).toBe(true);
    });

    it("says it has no position rather than send 0, 0", async () => {
        connect({ lat: 0, lon: 0 });
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest() });
        await PositionService.answer(PositionService.state.prompt);
        expect(datagrams[0].message.hasPosition).toBe(false);
    });

    it("declines by callsign", async () => {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest(5) });
        await PositionService.decline(PositionService.state.prompt);
        expect(datagrams[0].message.kind).toBe(Protocol.KIND.DECLINED);
        expect(datagrams[0].message.name).toBe("KJ5HBN");
        expect(datagrams[0].message.tag).toBe(5);
    });

    it("declines by node name when no callsign is set", async () => {
        OperatorSettings.setCallsign("");
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest(5) });
        await PositionService.decline(PositionService.state.prompt);
        expect(datagrams[0].message.name).toBe("Joe-KJ5HBN-HTv3");
    });

    it("answers straight away when set to answer automatically", async () => {
        PositionService.saveSettings({ markedChannels: [7], autoAnswer: true });
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest(8) });
        await flushPromises();
        expect(PositionService.state.prompt).toBe(null);
        expect(datagrams[0].message.kind).toBe(Protocol.KIND.POSITION);
    });

    it("keeps its settings per radio", () => {
        PositionService.saveSettings({ autoAnswer: true });
        expect(PositionService.settings().autoAnswer).toBe(true);
        GlobalState.selfInfo = { ...GlobalState.selfInfo, publicKey: THEM };
        expect(PositionService.settings().autoAnswer).toBe(false);
    });

});

describe("current fix or last known position", () => {

    let datagrams;
    let reads;

    beforeEach(() => {
        window.localStorage.clear();
        reset();
        connect();
        PositionService.saveSettings({ markedChannels: [7], autoAnswer: false });
        PositionService.FRESHNESS_INTERVAL_MILLIS = 0;
        datagrams = [];
        vi.spyOn(Connection, "sendChannelDatagram").mockImplementation(async (idx, type, payload) => { datagrams.push(Protocol.decode(payload)); });
        reads = 0;
    });

    afterEach(() => {
        PositionService.FRESHNESS_INTERVAL_MILLIS = 1500;
        vi.restoreAllMocks();
        reset();
    });

    // the radio's position on each re-read: a live receiver wanders in the last digit
    function radioReads(...positions) {
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => {
            const [lat, lon] = positions[Math.min(reads, positions.length - 1)];
            reads++;
            GlobalState.selfInfo = { ...GlobalState.selfInfo, advLat: lat, advLon: lon };
        });
    }

    async function askAndSend() {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest() });
        await PositionService.answer(PositionService.state.prompt);
        return datagrams[0];
    }

    it("sends a current fix when the GPS position is still changing", async () => {
        GlobalState.gpsStatus = "live";
        radioReads([31758701, -106486900]);
        const sent = await askAndSend();
        expect(sent.liveFix).toBe(true);
        expect(sent.lastKnown).toBe(false);
        expect(sent.fixTime).toBeGreaterThan(0);
        expect(sent.latitude).toBeCloseTo(31.758701, 6);
        expect(reads).toBe(1);
    });

    it("sends last known when a GPS found live at connect has stopped changing", async () => {
        GlobalState.gpsStatus = "live";
        radioReads([31758700, -106486900]);
        const sent = await askAndSend();
        expect(reads).toBe(PositionService.FRESHNESS_READS);
        expect(sent.liveFix).toBe(false);
        expect(sent.lastKnown).toBe(true);
        expect(sent.fixTime).toBe(0);
    });

    it("sends last known from a radio with no confirmed GPS, without re-reading it", async () => {
        GlobalState.gpsStatus = "unconfirmed";
        radioReads([31758701, -106486900]);
        const sent = await askAndSend();
        expect(reads).toBe(0);
        expect(sent.lastKnown).toBe(true);
    });

    it("sends last known if the re-read fails, rather than claim a current fix", async () => {
        GlobalState.gpsStatus = "live";
        vi.spyOn(Connection, "loadSelfInfo").mockRejectedValue(new Error("timeout"));
        vi.spyOn(console, "log").mockImplementation(() => {});
        const sent = await askAndSend();
        expect(sent.lastKnown).toBe(true);
    });

    it("says so, in amber, where the answer is shown", async () => {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({
            kind: Protocol.KIND.POSITION, tag: 1, to: ME, from: THEM, name: "KJ5HBN",
            latitude: 31.788, longitude: -106.497, fixTime: 0, flags: Protocol.FLAG.LAST_KNOWN,
        }) });
        const wrapper = mount(PositionsPanel);
        await flushPromises();
        expect(wrapper.text()).toContain("Last known position, not a current fix");
    });

    it("does not call a position from a radio's telemetry current", async () => {
        vi.useFakeTimers();
        vi.spyOn(Connection, "requestTelemetry").mockResolvedValue({ pubKeyPrefix: THEM.slice(0, 6), lppSensorData: new Uint8Array([1, 136, 4, 223, 37, 239, 195, 192, 1, 220, 194]) });
        PositionService.start(THEM_CONTACT, { kind: "channel", idx: 7, name: "Emcomm Testing" }, { type: "once" });
        await vi.advanceTimersByTimeAsync(30000);
        vi.useRealTimers();
        const report = PositionService.latestByStation()[0];
        expect(report.liveFix).toBe(false);
        const wrapper = mount(PositionsPanel);
        await flushPromises();
        expect(wrapper.text()).toContain("From its radio's GPS, which does not say how current it is");
    });

});

describe("entering the current position when only a last known one is held", () => {

    let datagrams;
    let written;

    function mountPrompt() {
        return mount(PositionPrompt, { global: { mocks: { $router: { push() {} } } } });
    }

    const button = (wrapper, text) => wrapper.findAll("button").find((b) => b.text() === text);

    beforeEach(() => {
        window.localStorage.clear();
        reset();
        connect();
        PositionService.saveSettings({ markedChannels: [7], autoAnswer: false });
        PositionService.FRESHNESS_INTERVAL_MILLIS = 0;
        datagrams = [];
        written = [];
        vi.spyOn(Connection, "sendChannelDatagram").mockImplementation(async (idx, type, payload) => { datagrams.push(Protocol.decode(payload)); });
        vi.spyOn(Connection, "setAdvertLatLong").mockImplementation(async (lat, lon) => { written.push([lat, lon]); });
        // the radio reads back what was written to it
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => {
            const last = written[written.length - 1];
            if(last){
                GlobalState.selfInfo = { ...GlobalState.selfInfo, advLat: last[0], advLon: last[1] };
            }
        });
    });

    afterEach(() => {
        PositionService.FRESHNESS_INTERVAL_MILLIS = 1500;
        vi.restoreAllMocks();
        reset();
    });

    it("is offered when the position would go as last known, and says why", async () => {
        const wrapper = mountPrompt();
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest() });
        await flushPromises();
        expect(wrapper.text()).toContain("last known position, not a current fix");
        expect(button(wrapper, "Enter current position")).toBeTruthy();
    });

    it("is not offered when the GPS fix is current", async () => {
        GlobalState.gpsStatus = "live";
        let n = 0;
        Connection.loadSelfInfo.mockImplementation(async () => { GlobalState.selfInfo = { ...GlobalState.selfInfo, advLat: 31758700 + (++n) }; });
        const wrapper = mountPrompt();
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest() });
        await flushPromises();
        expect(wrapper.text()).toContain("Current GPS fix");
        expect(button(wrapper, "Enter current position")).toBeFalsy();
    });

    it("saves the entry to the radio and sends it marked as entered by hand, with its time", async () => {
        const wrapper = mountPrompt();
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest() });
        await flushPromises();
        await button(wrapper, "Enter current position").trigger("click");
        // it starts from what the radio holds
        expect(wrapper.vm.entryLatitude).toBe("31.7587");
        wrapper.vm.entryLatitude = "31.9270";
        wrapper.vm.entryLongitude = "-106.4001";
        await flushPromises();
        expect(wrapper.text()).toContain("13R CR");
        await button(wrapper, "Save to radio and send").trigger("click");
        await flushPromises();

        expect(written).toEqual([[31927000, -106400100]]);
        const sent = datagrams[0];
        expect(sent.manual).toBe(true);
        expect(sent.lastKnown).toBe(false);
        expect(sent.liveFix).toBe(false);
        expect(sent.fixTime).toBeGreaterThan(0);
        expect(sent.latitude).toBeCloseTo(31.927, 6);
        // and the radio now holds it, as its position for any later answer
        expect(GlobalState.selfInfo.advLat).toBe(31927000);
    });

    it("will not send an entry that is not a position", async () => {
        const wrapper = mountPrompt();
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest() });
        await flushPromises();
        await button(wrapper, "Enter current position").trigger("click");
        wrapper.vm.entryLatitude = "95";
        wrapper.vm.entryLongitude = "-106.4";
        await flushPromises();
        expect(wrapper.text()).toContain("Not a position");
        expect(button(wrapper, "Save to radio and send").attributes("disabled")).toBeDefined();
        wrapper.vm.entryLatitude = "0";
        wrapper.vm.entryLongitude = "0";
        await flushPromises();
        expect(button(wrapper, "Save to radio and send").attributes("disabled")).toBeDefined();
        expect(written).toEqual([]);
    });

    it("can go back to sending the last known position", async () => {
        const wrapper = mountPrompt();
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest() });
        await flushPromises();
        await button(wrapper, "Enter current position").trigger("click");
        await wrapper.findAll("button").find((b) => b.text() === "Send the last known position instead").trigger("click");
        await button(wrapper, "Send").trigger("click");
        await flushPromises();
        expect(written).toEqual([]);
        expect(datagrams[0].lastKnown).toBe(true);
    });

    it("offers to send without a position, not a last known one, when the radio has none", async () => {
        // on the bench node 1 had none, and the button still spoke of a last known position
        connect({ lat: 0, lon: 0 });
        const wrapper = mountPrompt();
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest() });
        await flushPromises();
        await button(wrapper, "Enter current position").trigger("click");
        expect(wrapper.text()).not.toContain("Send the last known position instead");
        await button(wrapper, "Send without a position").trigger("click");
        await button(wrapper, "Send").trigger("click");
        await flushPromises();
        expect(written).toEqual([]);
        expect(datagrams[0].hasPosition).toBe(false);
    });

    it("tells a direct asker it was entered by hand", async () => {
        PositionService.onDirectText(THEM_CONTACT, Protocol.toDirectText({ kind: Protocol.KIND.REQUEST, tag: 3, to: ME, from: THEM, name: "" }, "x"));
        const directs = [];
        vi.spyOn(Connection, "sendCommandData").mockImplementation(async (key, text) => { directs.push(text); });
        await PositionService.answer(PositionService.state.prompt, { manualPosition: { latitude: 31.927, longitude: -106.4001 } });
        expect(directs[0]).toMatch(/^Position of Joe-KJ5HBN-HTv3 \(entered by hand\): 31\.9270° N, 106\.4001° W #mce1:/);
    });

    it("is shown as entered by hand where it is received, not as last known", async () => {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({
            kind: Protocol.KIND.POSITION, tag: 1, to: ME, from: THEM, name: "KJ5HBN",
            latitude: 31.788, longitude: -106.497, fixTime: Math.floor(Date.now() / 1000), flags: Protocol.FLAG.MANUAL,
        }) });
        const wrapper = mount(PositionsPanel);
        await flushPromises();
        expect(wrapper.text()).toMatch(/Entered by hand at .+, not GPS/);
        expect(wrapper.text()).not.toContain("Last known position, not a current fix");
    });

    it("shows two stations a few metres apart as the same location, with no bearing", async () => {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({
            kind: Protocol.KIND.POSITION, tag: 1, to: ME, from: THEM, name: "KJ5HBN",
            latitude: 31.75871, longitude: -106.48691, fixTime: 0, flags: 0,
        }) });
        const wrapper = mount(PositionsPanel);
        await flushPromises();
        expect(wrapper.text()).toContain("Same location as this station");
        expect(wrapper.text()).not.toMatch(/\d{3}° magnetic/);
    });

});

describe("the queue of requests", () => {

    const OTHER = new Uint8Array(32).fill(0x55);
    const THIRD = new Uint8Array(32).fill(0x66);

    function requestFrom(from, name, tag, idx = 7) {
        PositionService.onChannelData({ channelIdx: idx, dataType: Protocol.DATA_TYPE, data: Protocol.encode({ kind: Protocol.KIND.REQUEST, tag, to: ME, from, name }) });
    }

    beforeEach(() => {
        window.localStorage.clear();
        reset();
        connect();
        GlobalState.channels = [{ idx: 7, name: "Emcomm Testing" }, { idx: 3, name: "Net" }];
        PositionService.saveSettings({ markedChannels: [7, 3], autoAnswer: false });
        vi.spyOn(Connection, "sendChannelDatagram").mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        reset();
    });

    it("keeps every station that asks, and shows them one at a time, first come first", () => {
        requestFrom(THEM, "KJ5HBN", 1);
        requestFrom(OTHER, "W5ABC", 2);
        requestFrom(THIRD, "KF5XYZ", 3);
        expect(PositionService.state.prompts.map((p) => p.name)).toEqual(["KJ5HBN", "W5ABC", "KF5XYZ"]);
        expect(PositionService.state.prompt.name).toBe("KJ5HBN");
    });

    it("keeps only the newest request from a station that asks again, in its place", () => {
        requestFrom(THEM, "KJ5HBN", 1);
        requestFrom(OTHER, "W5ABC", 2);
        requestFrom(THEM, "KJ5HBN", 9, 3);
        const queue = PositionService.state.prompts;
        expect(queue).toHaveLength(2);
        expect(queue[0].name).toBe("KJ5HBN");
        // the newest: its tag and the channel it came on this time
        expect(queue[0].tag).toBe(9);
        expect(queue[0].via.name).toBe("Net");
        expect(queue[0].count).toBe(2);
    });

    it("brings up the next once one is answered, declined or put off", async () => {
        requestFrom(THEM, "KJ5HBN", 1);
        requestFrom(OTHER, "W5ABC", 2);
        requestFrom(THIRD, "KF5XYZ", 3);
        await PositionService.answer(PositionService.state.prompt);
        expect(PositionService.state.prompt.name).toBe("W5ABC");
        await PositionService.decline(PositionService.state.prompt);
        expect(PositionService.state.prompt.name).toBe("KF5XYZ");
        PositionService.dismissPrompt();
        expect(PositionService.state.prompt).toBe(null);
    });

    it("says on the prompt who else is waiting", async () => {
        const wrapper = mount(PositionPrompt, { global: { mocks: { $router: { push() {} } } } });
        requestFrom(THEM, "KJ5HBN", 1);
        requestFrom(OTHER, "W5ABC", 2);
        requestFrom(THIRD, "KF5XYZ", 3);
        await flushPromises();
        expect(wrapper.text()).toContain("KJ5HBN asks for your position");
        expect(wrapper.text()).toContain("2 more stations are waiting");
        expect(wrapper.text()).toContain("W5ABC, KF5XYZ");
    });

    it("empties when the radio disconnects", () => {
        requestFrom(THEM, "KJ5HBN", 1);
        requestFrom(OTHER, "W5ABC", 2);
        PositionService.onDisconnected();
        expect(PositionService.state.prompts).toEqual([]);
    });

});

describe("entering the current position as MGRS", () => {

    let datagrams;
    let written;

    const button = (wrapper, text) => wrapper.findAll("button").find((b) => b.text() === text);

    beforeEach(() => {
        window.localStorage.clear();
        reset();
        connect();
        PositionService.saveSettings({ markedChannels: [7], autoAnswer: false });
        datagrams = [];
        written = [];
        vi.spyOn(Connection, "sendChannelDatagram").mockImplementation(async (idx, type, payload) => { datagrams.push(Protocol.decode(payload)); });
        vi.spyOn(Connection, "setAdvertLatLong").mockImplementation(async (lat, lon) => { written.push([lat, lon]); });
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => {
            const last = written[written.length - 1];
            if(last){
                GlobalState.selfInfo = { ...GlobalState.selfInfo, advLat: last[0], advLon: last[1] };
            }
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        reset();
    });

    async function openEntry() {
        const wrapper = mount(PositionPrompt, { global: { mocks: { $router: { push() {} } } } });
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest() });
        await flushPromises();
        await button(wrapper, "Enter current position").trigger("click");
        await button(wrapper, "MGRS").trigger("click");
        return wrapper;
    }

    it("starts from the radio's position as a reference, and shows it back in degrees", async () => {
        const wrapper = await openEntry();
        expect(wrapper.vm.entryMgrsText).toBe("13R CR 59180 14651");
        wrapper.vm.entryMgrsText = "13R CR 67640 33201";
        await flushPromises();
        expect(wrapper.text()).toContain("31.9270° N, 106.4001° W");
    });

    it("saves and sends the position the reference names", async () => {
        const wrapper = await openEntry();
        wrapper.vm.entryMgrsText = "13R CR 67640 33201";
        await flushPromises();
        await button(wrapper, "Save to radio and send").trigger("click");
        await flushPromises();
        expect(written).toHaveLength(1);
        const [lat, lon] = written[0];
        expect(Geo.distanceMetres(lat / 1e6, lon / 1e6, 31.92702, -106.40012)).toBeLessThan(1);
        expect(datagrams[0].manual).toBe(true);
    });

    it("says how big the square is for a shorter reference", async () => {
        const wrapper = await openEntry();
        wrapper.vm.entryMgrsText = "13R CR 676 332";
        await flushPromises();
        expect(wrapper.text()).toContain("to within 100 m");
    });

    it("will not send a reference it cannot read", async () => {
        const wrapper = await openEntry();
        wrapper.vm.entryMgrsText = "13R CR 6764 332";
        await flushPromises();
        expect(wrapper.text()).toContain("Not an MGRS reference");
        expect(button(wrapper, "Save to radio and send").attributes("disabled")).toBeDefined();
        wrapper.vm.entryMgrsText = "";
        await flushPromises();
        expect(button(wrapper, "Save to radio and send").attributes("disabled")).toBeDefined();
        expect(written).toEqual([]);
    });

    it("carries a position across when switching between degrees and MGRS", async () => {
        const wrapper = await openEntry();
        wrapper.vm.entryMgrsText = "13R CR 67640 33201";
        await flushPromises();
        await button(wrapper, "Degrees").trigger("click");
        expect(Number(wrapper.vm.entryLatitude)).toBeCloseTo(31.92702, 4);
        expect(Number(wrapper.vm.entryLongitude)).toBeCloseTo(-106.40012, 4);
    });

});

describe("the prompt", () => {

    let pushed;

    function mountPrompt() {
        pushed = [];
        return mount(PositionPrompt, { global: { mocks: { $router: { push: (to) => pushed.push(to) } } } });
    }

    beforeEach(() => {
        window.localStorage.clear();
        reset();
        connect();
        PositionService.saveSettings({ markedChannels: [7], autoAnswer: false });
        vi.spyOn(Connection, "sendChannelDatagram").mockResolvedValue(undefined);
        vi.spyOn(Connection, "sendCommandData").mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        reset();
    });

    const button = (wrapper, text) => wrapper.findAll("button").find((b) => b.text() === text);

    it("offers Send, Send with message and Decline, and shows what would go", async () => {
        const wrapper = mountPrompt();
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest() });
        await flushPromises();
        expect(wrapper.text()).toContain("KJ5HBN-EMCOMM asks for your position");
        expect(wrapper.text()).toContain("On Emcomm Testing");
        expect(wrapper.text()).toContain("31.7587° N, 106.4869° W");
        expect(wrapper.text()).toContain("13R");
        expect(button(wrapper, "Send")).toBeTruthy();
        expect(button(wrapper, "Send with message")).toBeTruthy();
        expect(button(wrapper, "Decline")).toBeTruthy();
    });

    it("Send with message opens the channel the request came on", async () => {
        const wrapper = mountPrompt();
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest() });
        await flushPromises();
        await button(wrapper, "Send with message").trigger("click");
        await flushPromises();
        expect(pushed).toEqual([{ name: "channel.messages", params: { channelIdx: "7" } }]);
    });

    it("Send with message opens the conversation a direct request came from", async () => {
        const wrapper = mountPrompt();
        PositionService.onDirectText(THEM_CONTACT, Protocol.toDirectText({ kind: Protocol.KIND.REQUEST, tag: 3, to: ME, from: THEM, name: "" }, "x"));
        await flushPromises();
        await button(wrapper, "Send with message").trigger("click");
        await flushPromises();
        expect(pushed).toEqual([{ name: "contact.messages", params: { publicKey: THEM_HEX } }]);
    });

    it("plain Send opens nothing", async () => {
        const wrapper = mountPrompt();
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest() });
        await flushPromises();
        await button(wrapper, "Send").trigger("click");
        await flushPromises();
        expect(pushed).toEqual([]);
        expect(wrapper.text()).not.toContain("asks for your position");
    });

    it("says so, and stays up, when the answer does not go", async () => {
        Connection.sendChannelDatagram.mockRejectedValue(new Error("the radio refused it"));
        const wrapper = mountPrompt();
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest() });
        await flushPromises();
        await button(wrapper, "Send").trigger("click");
        await flushPromises();
        expect(wrapper.text()).toContain("Not sent: the radio refused it");
        expect(wrapper.text()).toContain("asks for your position");
    });

});

describe("asking", () => {

    let sent;

    beforeEach(() => {
        vi.useFakeTimers();
        window.localStorage.clear();
        reset();
        connect();
        sent = [];
        vi.spyOn(Connection, "sendChannelDatagram").mockImplementation(async (idx, type, payload) => { sent.push({ idx, message: Protocol.decode(payload) }); });
        vi.spyOn(Connection, "sendCommandData").mockImplementation(async (key, text) => { sent.push({ key, text, message: Protocol.fromDirectText(text) }); });
        vi.spyOn(Connection, "requestTelemetry").mockRejectedValue(new Error("timeout"));
    });

    afterEach(() => {
        reset();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // an answer from the other station, as their app would send it
    function answer(tag, kind = Protocol.KIND.POSITION, extra = {}) {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({
            kind, tag, to: ME, from: THEM, name: "KJ5HBN-EMCOMM", latitude: 31.788, longitude: -106.497, fixTime: 0, flags: 0, ...extra,
        }) });
    }

    const channel = { kind: "channel", idx: 7, name: "Emcomm Testing" };

    it("once: one request, then the station's radio after 30 s, then gives up", async () => {
        const request = PositionService.start(THEM_CONTACT, channel, { type: "once" });
        await vi.advanceTimersByTimeAsync(0);
        expect(sent).toHaveLength(1);
        expect(sent[0].message.kind).toBe(Protocol.KIND.REQUEST);
        expect(sent[0].idx).toBe(7);

        await vi.advanceTimersByTimeAsync(30000);
        expect(Connection.requestTelemetry).toHaveBeenCalledTimes(1);
        expect(request.status).toBe("gave up");
        expect(request.outcome).toBe("No answer after 1 request.");
        expect(sent).toHaveLength(1);
    });

    it("a request that gave up is still closed by a late answer to it, saying it came late", async () => {
        // on the bench a person answered a single request a minute after it was sent
        const request = PositionService.start(THEM_CONTACT, channel, { type: "once" });
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(30000);
        expect(request.status).toBe("gave up");
        expect(request.radioNote).toMatch(/did not answer either/);

        await vi.advanceTimersByTimeAsync(30000);
        answer(request.tag, Protocol.KIND.POSITION, { flags: Protocol.FLAG.MANUAL });
        expect(request.status).toBe("answered");
        expect(request.outcome).toBe("KJ5HBN-EMCOMM answered. The answer came after this app had stopped asking.");
        expect(request.radioNote).toBe(null);
    });

    it("a late answer carrying another tag does not reopen a request that gave up", async () => {
        const request = PositionService.start(THEM_CONTACT, channel, { type: "once" });
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(30000);
        answer((request.tag + 1) >>> 0);
        expect(request.status).toBe("gave up");
    });

    it("a request stopped by the operator stays stopped when an answer comes", async () => {
        const request = PositionService.start(THEM_CONTACT, channel, { type: "once" });
        await vi.advanceTimersByTimeAsync(0);
        PositionService.stop(request.tag);
        answer(request.tag);
        expect(request.status).toBe("stopped");
    });

    it("repeat: asks every interval until the answer comes, then stops", async () => {
        const request = PositionService.start(THEM_CONTACT, channel, { type: "repeat", intervalMinutes: 2, forMinutes: 60 });
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(2 * 60000);
        await vi.advanceTimersByTimeAsync(2 * 60000);
        expect(sent).toHaveLength(3);
        expect(request.status).toBe("running");

        answer(request.tag);
        expect(request.status).toBe("answered");
        await vi.advanceTimersByTimeAsync(10 * 60000);
        expect(sent).toHaveLength(3);

        const report = PositionService.latestByStation()[0];
        expect(report.name).toBe("KJ5HBN-EMCOMM");
        expect(report.requestedByUs).toBe(true);
    });

    // "every 1 minute for 2 minutes" is three asks: now, and at each minute
    // inside the window. The operator is told the number before they send.
    // "Every 1 minute for 2 minutes" asks now and in a minute; at two minutes the
    // window is spent. Six for "every 5 minutes for 30", at 0, 5, 10, 15, 20, 25.
    it("repeat: stops when the window closes, and says so", async () => {
        const request = PositionService.start(THEM_CONTACT, channel, { type: "repeat", intervalMinutes: 1, forMinutes: 2 });
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(60000);
        expect(sent).toHaveLength(2);

        // and nothing after the window, however long anyone waits
        await vi.advanceTimersByTimeAsync(10 * 60000);
        expect(sent).toHaveLength(2);
        expect(request.status).toBe("gave up");
        expect(request.outcome).toBe("No answer after 2 requests.");
    });

    // The count used to be decided each time round, by asking whether another
    // interval still fitted inside the window. It sent 2 of the 3 the dialog had
    // promised on the bench, because by the second send the clock was a fraction
    // past the minute — and under fake timers, which advance exactly, it sent 3.
    // So the test agreed with the dialog while the radios did not.
    it("repeat: sends the same number however slow the radio is", async () => {
        const request = PositionService.start(THEM_CONTACT, channel, { type: "repeat", intervalMinutes: 5, forMinutes: 30 });

        // a second and a half of send latency on every one of them
        for(let i = 0; i < 8; i++){
            await vi.advanceTimersByTimeAsync(1500);
            await vi.advanceTimersByTimeAsync(5 * 60000);
        }

        expect(sent).toHaveLength(6);
        expect(request.outcome).toBe("No answer after 6 requests.");
    });

    it("repeat: a window shorter than the interval still sends once", async () => {
        // asking every 10 minutes for 2 would otherwise be a repeat that repeats
        // nothing; the window is widened to hold one interval
        const request = PositionService.start(THEM_CONTACT, channel, { type: "repeat", intervalMinutes: 10, forMinutes: 2 });
        expect(request.mode.forMinutes).toBe(10);
        await vi.advanceTimersByTimeAsync(0);
        expect(sent).toHaveLength(1);
    });

    it("repeat: stops early when answered", async () => {
        const request = PositionService.start(THEM_CONTACT, channel, { type: "repeat", intervalMinutes: 1, forMinutes: 5 });
        await vi.advanceTimersByTimeAsync(0);
        answer(request.tag);
        await vi.advanceTimersByTimeAsync(10 * 60000);
        expect(sent).toHaveLength(1);
        expect(request.status).toBe("answered");
    });

    it("a decline stops the repeats and names who declined", async () => {
        const request = PositionService.start(THEM_CONTACT, channel, { type: "repeat", intervalMinutes: 1, forMinutes: 60 });
        await vi.advanceTimersByTimeAsync(0);
        answer(request.tag, Protocol.KIND.DECLINED);
        await vi.advanceTimersByTimeAsync(5 * 60000);
        expect(sent).toHaveLength(1);
        expect(request.status).toBe("declined");
        expect(request.outcome).toBe("Declined by KJ5HBN-EMCOMM.");
        expect(PositionService.latestByStation()[0].source).toBe("declined");
    });

    it("will not repeat faster than once a minute", async () => {
        PositionService.start(THEM_CONTACT, channel, { type: "repeat", intervalMinutes: 0, forMinutes: 10 });
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(59000);
        expect(sent).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(sent).toHaveLength(2);
    });

    it("goes direct when asked to, with the readable line first", async () => {
        PositionService.start(THEM_CONTACT, { kind: "direct" }, { type: "once" });
        await vi.advanceTimersByTimeAsync(0);
        expect(Connection.sendCommandData).toHaveBeenCalledTimes(1);
        expect(sent[0].text).toMatch(/^Position request from Joe-KJ5HBN-HTv3 \(answering needs Mesh-Emcomm\) #mce1:/);
    });

    it("takes a position from the station's radio when its app does not answer", async () => {
        // node 2's real answer on the bench, with sharing on: battery 4.27 V, GPS
        // 31.9269 N 106.4000 W at 1220.5 m, chip at 60 C, then padding
        const lpp = [1, 116, 1, 171, 1, 136, 4, 223, 37, 239, 195, 192, 1, 220, 194, 1, 103, 2, 88, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        expect(lpp[5]).toBe(CayenneLpp.LPP_GPS);
        Connection.requestTelemetry.mockResolvedValue({ pubKeyPrefix: THEM.slice(0, 6), lppSensorData: new Uint8Array(lpp) });
        const request = PositionService.start(THEM_CONTACT, channel, { type: "once" });
        await vi.advanceTimersByTimeAsync(30000);
        expect(request.status).toBe("answered");
        const report = PositionService.latestByStation()[0];
        expect(report.source).toBe("radio");
        expect(report.latitude).toBeCloseTo(31.9269, 4);
        expect(report.longitude).toBeCloseTo(-106.4000, 4);
    });

    it("says silence may mean either, since a radio that does not share says nothing", async () => {
        // on the bench, with sharing off, node 2 did not answer at all
        const request = PositionService.start(THEM_CONTACT, channel, { type: "repeat", intervalMinutes: 5, forMinutes: 60 });
        await vi.advanceTimersByTimeAsync(30000);
        expect(request.radioNote).toBe("Its radio did not answer either: it may not share location, or may be out of range.");
    });

    it("says why when the radio answers without a position", async () => {
        Connection.requestTelemetry.mockResolvedValue({ pubKeyPrefix: THEM.slice(0, 6), lppSensorData: new Uint8Array([1, 116, 1, 160]) });
        const request = PositionService.start(THEM_CONTACT, channel, { type: "repeat", intervalMinutes: 5, forMinutes: 60 });
        await vi.advanceTimersByTimeAsync(30000);
        expect(request.status).toBe("running");
        expect(request.radioNote).toMatch(/no working GPS, or its owner does not share location/);
    });

    it("stops everything when the radio disconnects", async () => {
        const request = PositionService.start(THEM_CONTACT, channel, { type: "repeat", intervalMinutes: 1, forMinutes: 60 });
        await vi.advanceTimersByTimeAsync(0);
        PositionService.onDisconnected();
        await vi.advanceTimersByTimeAsync(5 * 60000);
        expect(sent).toHaveLength(1);
        expect(request.status).toBe("stopped");
    });

    it("shows positions others send on a channel, not only answers to its own", () => {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({
            kind: Protocol.KIND.POSITION, tag: 1, to: new Uint8Array(32).fill(0x11), from: THEM, name: "KJ5HBN-EMCOMM",
            latitude: 31.788, longitude: -106.497, fixTime: 0, flags: 0,
        }) });
        const report = PositionService.latestByStation()[0];
        expect(report.requestedByUs).toBe(false);
        expect(report.via.name).toBe("Emcomm Testing");
    });

});

describe("the positions list", () => {

    beforeEach(() => {
        window.localStorage.clear();
        reset();
        connect();
    });

    afterEach(() => {
        reset();
    });

    it("gives degrees, MGRS, miles and kilometres, and a magnetic bearing stated as such", async () => {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({
            kind: Protocol.KIND.POSITION, tag: 1, to: ME, from: THEM, name: "KJ5HBN-EMCOMM",
            latitude: 31.788, longitude: -106.497, fixTime: 0, flags: Protocol.FLAG.MESSAGE_TO_FOLLOW,
        }) });
        const wrapper = mount(PositionsPanel);
        await flushPromises();
        const text = wrapper.text();
        expect(text).toContain("31.7880° N, 106.4970° W");
        expect(text).toMatch(/13R CR \d{5} \d{5}/);
        expect(text).toMatch(/\d+\.\d mi \(\d+\.\d km\)/);
        expect(text).toMatch(/\d{3}° magnetic/);
        expect(text).toMatch(/declination \d+\.\d° E/);
        expect(text).toContain("Message to follow");
    });

    it("makes both the degrees and the MGRS reference open the map app on the station", async () => {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({
            kind: Protocol.KIND.POSITION, tag: 1, to: ME, from: THEM, name: "KJ5HBN", latitude: 31.788, longitude: -106.497, fixTime: 0, flags: 0,
        }) });
        const wrapper = mount(PositionsPanel);
        await flushPromises();
        const expected = Geo.mapLink(31.788, -106.497, "KJ5HBN");
        const links = wrapper.findAll("a").filter((a) => a.attributes("href") === expected);
        expect(links.map((a) => a.text())).toEqual(["31.7880° N, 106.4970° W", expect.stringMatching(/^13R CR /)]);
        // this station's own position links too
        expect(wrapper.findAll("a").some((a) => a.attributes("href") === Geo.mapLink(31.7587, -106.4869, "This station"))).toBe(true);
    });

    it("opens a web map in a new tab, so the app is still there to come back to", async () => {
        const { default: MapLink } = await import("../../src/components/position/MapLink.vue");
        const spy = vi.spyOn(Geo, "platform").mockReturnValue("other");
        const web = mount(MapLink, { props: { latitude: 31.788, longitude: -106.497, text: "x", label: "y" } });
        expect(web.find("a").attributes("target")).toBe("_blank");
        expect(web.find("a").attributes("rel")).toBe("noopener noreferrer");
        spy.mockReturnValue("android");
        const app = mount(MapLink, { props: { latitude: 31.788, longitude: -106.497, text: "x", label: "y" } });
        expect(app.find("a").attributes("href")).toMatch(/^geo:/);
        expect(app.find("a").attributes("target")).toBeUndefined();
        spy.mockRestore();
    });

    it("names the radio beside the operator's callsign when they differ", async () => {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({
            kind: Protocol.KIND.POSITION, tag: 1, to: ME, from: THEM, name: "KJ5HBN", latitude: 31.788, longitude: -106.497, fixTime: 0, flags: 0,
        }) });
        const wrapper = mount(PositionsPanel);
        await flushPromises();
        expect(wrapper.text()).toContain("KJ5HBN · KJ5HBN-EMCOMM");
    });

    it("keeps the last known position under a later decline", async () => {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({
            kind: Protocol.KIND.POSITION, tag: 1, to: ME, from: THEM, name: "KJ5HBN", latitude: 31.788, longitude: -106.497, fixTime: 0, flags: 0,
        }) });
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({
            kind: Protocol.KIND.DECLINED, tag: 2, to: ME, from: THEM, name: "KJ5HBN",
        }) });
        const wrapper = mount(PositionsPanel);
        await flushPromises();
        const text = wrapper.text();
        expect(text).toContain("Declined by KJ5HBN");
        expect(text).toContain("Last position received");
        expect(text).toContain("31.7880° N, 106.4970° W");
        expect(text).toMatch(/\d{3}° magnetic/);
    });

    it("shows no last known position when there never was one", async () => {
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({
            kind: Protocol.KIND.DECLINED, tag: 2, to: ME, from: THEM, name: "KJ5HBN",
        }) });
        const wrapper = mount(PositionsPanel);
        await flushPromises();
        expect(wrapper.text()).not.toContain("Last position received");
    });

    it("says why there is no distance when this radio has no position", async () => {
        connect({ lat: 0, lon: 0 });
        PositionService.onChannelData({ channelIdx: 7, dataType: Protocol.DATA_TYPE, data: Protocol.encode({
            kind: Protocol.KIND.POSITION, tag: 1, to: ME, from: THEM, name: "N", latitude: 31.788, longitude: -106.497, fixTime: 0, flags: 0,
        }) });
        const wrapper = mount(PositionsPanel);
        await flushPromises();
        expect(wrapper.text()).toContain("Your radio has no position set");
        expect(wrapper.text()).not.toMatch(/magnetic/);
    });

});

describe("the request form", () => {

    beforeEach(() => {
        window.localStorage.clear();
        reset();
        connect();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        reset();
    });

    it("warns under five minutes and will not go under one", async () => {
        const wrapper = mount(PositionRequestDialog, { global: { mocks: { $router: { push() {} } } } });
        PositionService.openRequest(THEM_CONTACT);
        await flushPromises();
        wrapper.vm.modeType = "custom";
        wrapper.vm.customInterval = 3;
        wrapper.vm.customFor = 30;
        await flushPromises();
        expect(wrapper.text()).toContain("floods the whole mesh");
        expect(wrapper.vm.canSend).toBe(true);
        wrapper.vm.customInterval = 0;
        await flushPromises();
        expect(wrapper.text()).toContain("The shortest interval is 1 minute");
        expect(wrapper.vm.canSend).toBe(false);
    });

    it("offers the intervals worth one press, and lets the rest be typed", async () => {
        const wrapper = mount(PositionRequestDialog, { global: { mocks: { $router: { push() {} } } } });
        PositionService.openRequest(THEM_CONTACT);
        await flushPromises();

        const choices = wrapper.findAll("select")
            .find((s) => (s.attributes("aria-label") ?? "").startsWith("Minutes between requests"))
            .findAll("option").map((o) => o.text());
        expect(choices).toEqual(["1", "5", "15", "30", "60"]);
    });

    it("says how many requests that is before any go out", async () => {
        const wrapper = mount(PositionRequestDialog, { global: { mocks: { $router: { push() {} } } } });
        PositionService.openRequest(THEM_CONTACT);
        await flushPromises();

        wrapper.vm.modeType = "preset";
        wrapper.vm.presetInterval = 5;
        wrapper.vm.presetFor = 30;
        await flushPromises();
        // now, then every five minutes while the half hour lasts: 0 to 25
        expect(wrapper.text()).toContain("6 requests");
        expect(wrapper.text()).toContain("25 minutes from now");
    });

    // A channel or a room is a group message, which floods. A direct request goes
    // along the path the radio knows to that station, and only floods without one.
    it("warns about flooding only when the request would flood", async () => {
        const wrapper = mount(PositionRequestDialog, { global: { mocks: { $router: { push() {} } } } });
        PositionService.openRequest({ ...THEM_CONTACT, outPathLen: 0 });
        await flushPromises();

        wrapper.vm.modeType = "preset";
        wrapper.vm.presetInterval = 1;
        wrapper.vm.presetFor = 30;
        await flushPromises();

        // one hop away, asked directly: two packets, not a flood
        expect(wrapper.text()).toContain("goes out to that station and comes back");
        expect(wrapper.text()).not.toContain("floods the whole mesh");

        // the same station asked on a channel is a group message
        wrapper.vm.viaKey = "channel:0";
        await flushPromises();
        expect(wrapper.text()).toContain("floods the whole mesh");
    });

    it("says minute rather than minutes when there is one", async () => {
        const wrapper = mount(PositionRequestDialog, { global: { mocks: { $router: { push() {} } } } });
        PositionService.openRequest(THEM_CONTACT);
        await flushPromises();

        wrapper.vm.modeType = "preset";
        wrapper.vm.presetInterval = 1;
        wrapper.vm.presetFor = 2;
        await flushPromises();

        expect(wrapper.text()).toContain("about 1 minute from now");
    });

    // The promise and the sending are the same rule now. They were not, and the
    // difference only showed on the radios.
    it("promises exactly what the service will send", async () => {
        const wrapper = mount(PositionRequestDialog, { global: { mocks: { $router: { push() {} } } } });
        PositionService.openRequest(THEM_CONTACT);
        await flushPromises();

        for(const [interval, forMinutes] of [[1, 2], [5, 30], [15, 60], [1, 1]]){
            wrapper.vm.modeType = "custom";
            wrapper.vm.customInterval = interval;
            wrapper.vm.customFor = forMinutes;
            await flushPromises();
            expect(wrapper.vm.askCount, `every ${interval} for ${forMinutes}`).toBe(
                PositionService.askCount({ type: "repeat", intervalMinutes: interval, forMinutes: forMinutes }),
            );
        }
    });

    it("refuses a window shorter than the gap between requests", async () => {
        const wrapper = mount(PositionRequestDialog, { global: { mocks: { $router: { push() {} } } } });
        PositionService.openRequest(THEM_CONTACT);
        await flushPromises();

        wrapper.vm.modeType = "custom";
        wrapper.vm.customInterval = 15;
        wrapper.vm.customFor = 5;
        await flushPromises();

        expect(wrapper.text()).toContain("would send one and stop");
        expect(wrapper.vm.canSend).toBe(false);
    });

    it("sends by the route chosen and opens the positions tab", async () => {
        const start = vi.spyOn(PositionService, "start").mockReturnValue({});
        const pushed = [];
        const wrapper = mount(PositionRequestDialog, { global: { mocks: { $router: { push: (to) => pushed.push(to) } } } });
        PositionService.openRequest(THEM_CONTACT);
        await flushPromises();
        wrapper.vm.viaKey = "channel:7";
        wrapper.vm.modeType = "custom";
        wrapper.vm.customInterval = 10;
        wrapper.vm.customFor = 40;
        await flushPromises();
        await wrapper.findAll("button").find((b) => b.text() === "Request").trigger("click");
        expect(start).toHaveBeenCalledWith(THEM_CONTACT, { kind: "channel", idx: 7, name: "Emcomm Testing" }, { type: "repeat", intervalMinutes: 10, forMinutes: 40 });
        expect(pushed).toEqual([{ name: "main", query: { tab: "positions" } }]);
        expect(PositionService.state.requestTarget).toBe(null);
    });

});

describe("a direct request in the message stream", () => {

    beforeEach(() => {
        window.localStorage.clear();
        reset();
        connect();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        reset();
    });

    it("is kept out of the conversation, with no notification", async () => {
        const insert = vi.spyOn(Database.Message, "insert").mockResolvedValue({});
        const notify = vi.spyOn(NotificationUtils, "showNewMessageNotification").mockResolvedValue(undefined);
        const text = Protocol.toDirectText({ kind: Protocol.KIND.REQUEST, tag: 3, to: ME, from: THEM, name: "" }, "Position request from KJ5HBN-EMCOMM");

        await Connection.onContactMessageReceived({ pubKeyPrefix: THEM.slice(0, 6), txtType: Constants.TxtTypes.CliData, text, senderTimestamp: 1, pathLen: 0 });

        expect(insert).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
        expect(PositionService.state.prompt.via.kind).toBe("direct");
    });

    it("leaves any other type 1 message where it was, in the conversation", async () => {
        const insert = vi.spyOn(Database.Message, "insert").mockResolvedValue({});
        vi.spyOn(NotificationUtils, "showNewMessageNotification").mockResolvedValue(undefined);
        await Connection.onContactMessageReceived({ pubKeyPrefix: THEM.slice(0, 6), txtType: Constants.TxtTypes.CliData, text: "DRILL type 1 test", senderTimestamp: 1, pathLen: 0 });
        expect(insert).toHaveBeenCalledTimes(1);
    });

    it("hands a channel datagram to the position service during message sync", async () => {
        PositionService.saveSettings({ markedChannels: [7], autoAnswer: false });
        const queue = [{ channelData: { channelIdx: 7, dataType: Protocol.DATA_TYPE, data: incomingRequest() } }, null];
        GlobalState.connection = { on() {}, off() {}, syncNextMessage: async () => queue.shift() };
        await Connection.syncMessages();
        expect(PositionService.state.prompt.name).toBe("KJ5HBN-EMCOMM");
    });

});
