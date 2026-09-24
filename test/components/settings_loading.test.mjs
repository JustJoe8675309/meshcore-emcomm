// The settings page while it waits for the radio.
//
// Device commands now take turns, which stopped the replies crossing. The cost is
// that the settings read can wait behind other work: on the bench, opening
// settings just after an advert arrived meant waiting out a two pass contact
// reload over Bluetooth, several seconds of empty fields. Empty is the dangerous
// state: an empty position box looks like a station with no position, and saving
// it writes 0, 0 — a real place in the Gulf of Guinea. So the page says it is
// reading, and Save stays off until the fields hold what the radio actually said.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SettingsPage from "../../src/components/pages/SettingsPage.vue";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";

const SELF_INFO = {
    name: "KJ5HBN-EMCOMM",
    publicKey: new Uint8Array(32).fill(0x39),
    radioFreq: 910525,
    radioBw: 62.5,
    radioSf: 7,
    radioCr: 5,
    txPower: 20,
    maxTxPower: 22,
    advLat: 31926949,
    advLon: -106400091,
    manualAddContacts: 0,
};

const defer = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

function mountPage() {
    return mount(SettingsPage, {
        global: {
            stubs: {
                Page: { template: "<div><slot/></div>" },
                AppBar: { template: "<div><slot name='trailing'/></div>" },
                EmcommSettingsGroup: true,
                RouterLink: true,
            },
        },
    });
}

const saveButton = (wrapper) => wrapper.findAll("button").find((b) => ["Save", "Saving..."].includes(b.text().trim()));
const latitudeField = (wrapper) => wrapper.findAll("input").find((i) => i.attributes("placeholder") === "e.g: -38.664646");

describe("SettingsPage while reading the radio", () => {

    let read;
    let setPosition;

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = null;

        read = defer();
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => {
            GlobalState.selfInfo = await read.promise;
        });
        vi.spyOn(Connection, "deviceQuery").mockResolvedValue(null);
        setPosition = vi.spyOn(Connection, "setAdvertLatLong").mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
    });

    it("says it is reading, and keeps Save off, while the read is waiting its turn", async () => {
        const wrapper = mountPage();
        await flushPromises();

        expect(wrapper.text()).toContain("Reading settings from the radio");
        expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
        expect(latitudeField(wrapper).element.value).toBe("");
    });

    it("reads with the short bound, so a silent radio is reported in seconds", async () => {
        // with the general bound, and the EMCOMM group's clock read queued first,
        // a radio that had stopped answering took 37 seconds to report
        mountPage();
        await flushPromises();
        expect(Connection.loadSelfInfo).toHaveBeenCalledWith(Connection.READ_TIMEOUT_MILLIS);
    });

    it("fills the fields and turns Save on once the radio answers", async () => {
        const wrapper = mountPage();
        read.resolve(SELF_INFO);
        await flushPromises();

        expect(latitudeField(wrapper).element.value).toBe("31.926949");
        expect(wrapper.text()).not.toContain("Reading settings from the radio");
        expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
    });

    it("fills the fields without waiting for the firmware details", async () => {
        // those are one more turn in the queue, and nothing in the form needs them
        Connection.deviceQuery.mockReturnValue(new Promise(() => {}));

        const wrapper = mountPage();
        read.resolve(SELF_INFO);
        await flushPromises();

        expect(latitudeField(wrapper).element.value).toBe("31.926949");
        expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
    });

    it("keeps Save off, and says why, when the read fails", async () => {
        const wrapper = mountPage();
        read.reject(new Error("timed out"));
        await flushPromises();

        expect(wrapper.text()).toContain("Could not read the current settings");
        expect(wrapper.text()).not.toContain("Reading settings from the radio");
        expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    });

    it("writes nothing if save is reached before the fields have loaded", async () => {
        // the button is disabled, but save must not trust that it is the only way in
        const wrapper = mountPage();
        await flushPromises();

        await wrapper.vm.save();

        expect(setPosition).not.toHaveBeenCalled();
    });

    it("turns Save off again when a later re-read fails", async () => {
        const wrapper = mountPage();
        read.resolve(SELF_INFO);
        await flushPromises();
        expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();

        // the page re-reads after save, convert and restore
        Connection.loadSelfInfo.mockRejectedValueOnce(new Error("timed out"));
        await wrapper.vm.load();
        await flushPromises();

        expect(wrapper.text()).toContain("show what was last read");
        expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    });

});

describe("SettingsPage position fields", () => {

    let latLong;

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.connection = { on() {}, off() {} };
        vi.spyOn(Connection, "deviceQuery").mockResolvedValue(null);
        latLong = vi.spyOn(Connection, "setAdvertLatLong").mockResolvedValue(undefined);
        vi.spyOn(Connection, "setAdvertName").mockResolvedValue(undefined);
        vi.spyOn(Connection, "setRadioParams").mockResolvedValue(undefined);
        vi.spyOn(Connection, "setTxPower").mockResolvedValue(undefined);
        window.alert = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete window.alert;
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
    });

    const withPosition = (advLat, advLon) => vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => {
        GlobalState.selfInfo = { ...SELF_INFO, advLat, advLon };
    });

    const field = (wrapper, placeholder) => wrapper.findAll("input").find((i) => i.attributes("placeholder") === placeholder);

    it("shows no position as blank, not as a place in the Gulf of Guinea", async () => {
        withPosition(0, 0);
        const wrapper = mountPage();
        await flushPromises();

        expect(field(wrapper, "e.g: -38.664646").element.value).toBe("");
        expect(field(wrapper, "e.g: 178.023507").element.value).toBe("");
    });

    it("still shows a real position", async () => {
        withPosition(31926949, -106400091);
        const wrapper = mountPage();
        await flushPromises();

        expect(field(wrapper, "e.g: -38.664646").element.value).toBe("31.926949");
        expect(field(wrapper, "e.g: 178.023507").element.value).toBe("-106.400091");
    });

    it("keeps no position unset when saved blank", async () => {
        withPosition(0, 0);
        const wrapper = mountPage();
        await flushPromises();

        await wrapper.vm.save();

        expect(latLong).toHaveBeenCalledWith(0, 0);
    });

    it("treats a cleared field the same as an empty one", async () => {
        // a number box that has been cleared holds "" rather than null
        withPosition(31926949, -106400091);
        const wrapper = mountPage();
        await flushPromises();
        await field(wrapper, "e.g: -38.664646").setValue("");
        await field(wrapper, "e.g: 178.023507").setValue("");

        await wrapper.vm.save();

        expect(latLong).toHaveBeenCalledWith(0, 0);
    });

});
