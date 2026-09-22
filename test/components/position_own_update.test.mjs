// Updating this station's own position from the Positions tab.
//
// The GPS is tried first, every time: a receiver with no fix when the app
// connected may have one now. Only when there is none does it ask the operator,
// in the same fields the answer prompt uses.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import PositionsPanel from "../../src/components/position/PositionsPanel.vue";
import PositionService from "../../src/js/position/PositionService.js";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import Utils from "../../src/js/Utils.js";

const KEY = new Uint8Array(32).fill(0xa7);

function connect({ lat = 31.7587, lon = -106.4869 } = {}) {
    GlobalState.connection = { on() {}, off() {} };
    GlobalState.selfInfo = { name: "Joe-KJ5HBN-HTv3", publicKey: KEY, advLat: Math.round(lat * 1e6), advLon: Math.round(lon * 1e6) };
    GlobalState.contacts = [];
    GlobalState.channels = [];
    GlobalState.gpsStatus = "unconfirmed";
}

const button = (wrapper, text) => wrapper.findAll("button").find((b) => b.text() === text);

describe("updating this station's position", () => {

    let written;

    beforeEach(() => {
        window.localStorage.clear();
        PositionService.state.reports.splice(0);
        PositionService.state.requests.splice(0);
        connect();
        written = [];
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
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
    });

    it("takes the position from the GPS when there is a fix, and says so", async () => {
        vi.spyOn(Connection, "probeForLiveGps").mockImplementation(async () => { GlobalState.gpsStatus = "live"; });
        vi.spyOn(Connection, "getPosition").mockResolvedValue({ latitude: 31.92702, longitude: -106.40012 });

        const wrapper = mount(PositionsPanel);
        await button(wrapper, "Update position").trigger("click");
        await flushPromises();

        expect(written).toEqual([[31927020, -106400120]]);
        expect(wrapper.text()).toMatch(/Updated from the GPS at/);
        // no entry fields: nothing to ask
        expect(button(wrapper, "Save to radio")).toBeFalsy();
        expect(wrapper.text()).toContain("31.9270° N, 106.4001° W");
    });

    it("asks the operator when there is no fix, saying why, prefilled with what the radio holds", async () => {
        vi.spyOn(Connection, "probeForLiveGps").mockImplementation(async () => { GlobalState.gpsStatus = "unconfirmed"; });

        const wrapper = mount(PositionsPanel);
        await button(wrapper, "Update position").trigger("click");
        await flushPromises();

        expect(wrapper.text()).toContain("There is no live GPS fix, so enter the position.");
        expect(wrapper.vm.entryLatitude).toBe("31.7587");
        expect(wrapper.vm.entryLongitude).toBe("-106.4869");
        expect(written).toEqual([]);
    });

    it("saves what was typed to the radio, and shows it as this station's position", async () => {
        vi.spyOn(Connection, "probeForLiveGps").mockImplementation(async () => { GlobalState.gpsStatus = "unconfirmed"; });

        const wrapper = mount(PositionsPanel);
        await button(wrapper, "Update position").trigger("click");
        await flushPromises();
        wrapper.vm.entryLatitude = "31.9270";
        wrapper.vm.entryLongitude = "-106.4001";
        await flushPromises();
        await button(wrapper, "Save to radio").trigger("click");
        await flushPromises();

        expect(written).toEqual([[31927000, -106400100]]);
        expect(wrapper.text()).toMatch(/Saved to the radio at .*entered by hand/);
        expect(wrapper.text()).toContain("31.9270° N, 106.4001° W");
    });

    it("takes an MGRS reference too", async () => {
        vi.spyOn(Connection, "probeForLiveGps").mockImplementation(async () => { GlobalState.gpsStatus = "unconfirmed"; });

        const wrapper = mount(PositionsPanel);
        await button(wrapper, "Update position").trigger("click");
        await flushPromises();
        await button(wrapper, "MGRS").trigger("click");
        wrapper.vm.entryMgrsText = "13R CR 67640 33201";
        await flushPromises();
        await button(wrapper, "Save to radio").trigger("click");
        await flushPromises();

        expect(written).toHaveLength(1);
        expect(written[0][0] / 1e6).toBeCloseTo(31.927, 3);
        expect(written[0][1] / 1e6).toBeCloseTo(-106.4001, 3);
    });

    it("refuses a position the radio cannot hold, rather than writing it", async () => {
        vi.spyOn(Connection, "probeForLiveGps").mockImplementation(async () => { GlobalState.gpsStatus = "unconfirmed"; });

        const wrapper = mount(PositionsPanel);
        await button(wrapper, "Update position").trigger("click");
        await flushPromises();
        wrapper.vm.entryLatitude = "95";
        wrapper.vm.entryLongitude = "-106.4";
        await flushPromises();

        expect(wrapper.text()).toContain("Not a position");
        expect(button(wrapper, "Save to radio").attributes("disabled")).toBeDefined();
        // 0, 0 is a real place in the Gulf of Guinea, so it is refused as well
        wrapper.vm.entryLatitude = "0";
        wrapper.vm.entryLongitude = "0";
        await flushPromises();
        expect(button(wrapper, "Save to radio").attributes("disabled")).toBeDefined();
        expect(written).toEqual([]);
    });

    it("leaves the position alone on Cancel", async () => {
        vi.spyOn(Connection, "probeForLiveGps").mockImplementation(async () => { GlobalState.gpsStatus = "unconfirmed"; });

        const wrapper = mount(PositionsPanel);
        await button(wrapper, "Update position").trigger("click");
        await flushPromises();
        await button(wrapper, "Cancel").trigger("click");
        await flushPromises();

        expect(written).toEqual([]);
        expect(wrapper.text()).toContain("The position was left as it was");
        expect(button(wrapper, "Update position")).toBeTruthy();
    });

    it("offers the entry on a radio with no position at all, with empty fields", async () => {
        connect({ lat: 0, lon: 0 });
        vi.spyOn(Connection, "probeForLiveGps").mockImplementation(async () => { GlobalState.gpsStatus = "unconfirmed"; });

        const wrapper = mount(PositionsPanel);
        expect(wrapper.text()).toContain("Your radio has no position set");
        await button(wrapper, "Update position").trigger("click");
        await flushPromises();

        expect(wrapper.vm.entryLatitude).toBe("");
        expect(button(wrapper, "Save to radio")).toBeTruthy();
    });

    it("says so when the radio refuses the write, rather than claiming it worked", async () => {
        vi.spyOn(Connection, "probeForLiveGps").mockImplementation(async () => { GlobalState.gpsStatus = "unconfirmed"; });
        Connection.setAdvertLatLong.mockRejectedValue(new Error("the radio did not answer"));

        const wrapper = mount(PositionsPanel);
        await button(wrapper, "Update position").trigger("click");
        await flushPromises();
        wrapper.vm.entryLatitude = "31.9270";
        wrapper.vm.entryLongitude = "-106.4001";
        await flushPromises();
        await button(wrapper, "Save to radio").trigger("click");
        await flushPromises();

        expect(wrapper.text()).toContain("Not saved: the radio did not answer");
        expect(button(wrapper, "Save to radio")).toBeTruthy();
    });

    it("cannot be pressed with no radio connected", async () => {
        GlobalState.connection = null;
        const wrapper = mount(PositionsPanel);
        expect(button(wrapper, "Update position").attributes("disabled")).toBeDefined();
    });

});

describe("the shared entry fields", () => {

    it("are the same component the answer prompt uses, so one cannot drift from the other", async () => {
        const panel = await import("../../src/components/position/PositionsPanel.vue");
        const prompt = await import("../../src/components/position/PositionPrompt.vue");
        expect(panel.default.components.PositionEntry).toBe(prompt.default.components.PositionEntry);
    });

});
