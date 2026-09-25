// Where the station is, and what its clock says.
//
// The two things about a radio that no mode holds. They moved into the mode tabs
// beside the operator and the contacts when "This radio now" was dismantled: most
// of that section was the mode's own settings a second time, and existed only
// because saving a mode did not reach the radio. Saving the mode in use does now.
//
// These act when pressed rather than waiting for Save, because neither is a
// promise about a mode.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import RadioNowGroup from "../../src/components/settings/RadioNowGroup.vue";
import Connection from "../../src/js/Connection.js";
import EmcommMode from "../../src/js/EmcommMode.js";
import GlobalState from "../../src/js/GlobalState.js";

const SELF_INFO = {
    name: "KJ5HBN-EMCOMM",
    publicKey: new Uint8Array(32).fill(0x39),
    radioFreq: 910525, radioBw: 62500, radioSf: 7, radioCr: 5,
    txPower: 20, maxTxPower: 22,
    advLat: 31926949, advLon: -106400091,
    manualAddContacts: 0,
};

function connect(overrides = {}) {
    GlobalState.connection = { on() {}, off() {} };
    GlobalState.selfInfo = { ...SELF_INFO, ...overrides };
}

/** Opens both folds, which start shut like every other group. */
async function open(wrapper) {
    for(const button of wrapper.findAll("button[aria-expanded]")){
        await button.trigger("click");
    }
    await flushPromises();
}

const field = (wrapper, placeholder) => wrapper.findAll("input").find((i) => i.attributes("placeholder") === placeholder);

describe("the position and clock group", () => {

    let latLong;

    beforeEach(() => {
        connect();
        latLong = vi.spyOn(Connection, "setAdvertLatLong").mockResolvedValue(undefined);
        vi.spyOn(Connection, "loadSelfInfo").mockResolvedValue(undefined);
        vi.spyOn(Connection, "getDeviceTime").mockResolvedValue({ epochSecs: Math.floor(Date.now() / 1000) });
        vi.spyOn(Connection, "syncDeviceTime").mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
    });

    it("shows the radio's position, and writes it when pressed", async () => {
        const wrapper = mount(RadioNowGroup);
        await flushPromises();
        await open(wrapper);

        expect(field(wrapper, "e.g: -38.664646").element.value).toBe("31.926949");
        expect(field(wrapper, "e.g: 178.023507").element.value).toBe("-106.400091");

        await wrapper.findAll("button").find((b) => b.text() === "Write to the radio").trigger("click");
        await flushPromises();

        expect(latLong).toHaveBeenCalledWith(31926949, -106400091);
        expect(wrapper.text()).toContain("Position written to the radio");
    });

    it("shows no position as blank, not as a place in the Gulf of Guinea", async () => {
        connect({ advLat: 0, advLon: 0 });
        const wrapper = mount(RadioNowGroup);
        await flushPromises();
        await open(wrapper);

        expect(field(wrapper, "e.g: -38.664646").element.value).toBe("");
        expect(wrapper.text()).toContain("Not set");
    });

    it("treats a cleared field the same as an empty one, and leaves it unset", async () => {
        // a number box that has been cleared holds "" rather than null
        const wrapper = mount(RadioNowGroup);
        await flushPromises();
        await open(wrapper);

        await field(wrapper, "e.g: -38.664646").setValue("");
        await field(wrapper, "e.g: 178.023507").setValue("");
        await wrapper.findAll("button").find((b) => b.text() === "Write to the radio").trigger("click");
        await flushPromises();

        expect(latLong).toHaveBeenCalledWith(0, 0);
    });

    it("takes a live fix only from one the radio reports now", async () => {
        const applied = vi.spyOn(EmcommMode, "applySettings").mockResolvedValue({ failures: [] });
        const wrapper = mount(RadioNowGroup);
        await flushPromises();
        await open(wrapper);

        await wrapper.findAll("button").find((b) => b.text() === "Set from live GPS fix").trigger("click");
        await flushPromises();

        expect(applied).toHaveBeenCalledWith({ setPositionFromGps: true });
        expect(wrapper.text()).toContain("left alone rather than set to 0, 0");
    });

    it("says the radio would not take it, rather than looking done", async () => {
        latLong.mockRejectedValue(new Error("timed out"));
        const wrapper = mount(RadioNowGroup);
        await flushPromises();
        await open(wrapper);

        await wrapper.findAll("button").find((b) => b.text() === "Write to the radio").trigger("click");
        await flushPromises();

        expect(wrapper.text()).toContain("Position failed: timed out");
    });

    it("reads the clock drift and can sync it", async () => {
        const wrapper = mount(RadioNowGroup);
        await flushPromises();
        await open(wrapper);

        expect(wrapper.text()).toContain("In step");

        await wrapper.findAll("button").find((b) => b.text() === "Sync to this device").trigger("click");
        await flushPromises();

        expect(Connection.syncDeviceTime).toHaveBeenCalled();
    });

    it("says a drifted clock in seconds", async () => {
        Connection.getDeviceTime.mockResolvedValue({ epochSecs: Math.floor(Date.now() / 1000) - 90 });
        const wrapper = mount(RadioNowGroup);
        await flushPromises();
        await open(wrapper);

        expect(wrapper.text()).toContain("90s out");
    });

    it("says these are not part of a mode", () => {
        const wrapper = mount(RadioNowGroup);
        expect(wrapper.text()).toContain("Not part of a mode");
    });

    it("has nothing to offer with no radio connected", async () => {
        GlobalState.connection = null;
        const wrapper = mount(RadioNowGroup);
        await open(wrapper);
        expect(wrapper.text()).toContain("No radio connected");
    });

});
