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
import ModeSettingsTabs from "../../src/components/modes/ModeSettingsTabs.vue";

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

describe("SettingsPage while reading the radio", () => {

    let read;

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = null;

        read = defer();
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => {
            GlobalState.selfInfo = await read.promise;
        });
        vi.spyOn(Connection, "deviceQuery").mockResolvedValue(null);
        vi.spyOn(Connection, "setAdvertLatLong").mockResolvedValue(undefined);
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
    });

    it("reads with the short bound, so a silent radio is reported in seconds", async () => {
        // with the general bound, and the EMCOMM group's clock read queued first,
        // a radio that had stopped answering took 37 seconds to report
        mountPage();
        await flushPromises();
        expect(Connection.loadSelfInfo).toHaveBeenCalledWith(Connection.READ_TIMEOUT_MILLIS);
    });

    it("turns Save on once the radio answers", async () => {
        const wrapper = mountPage();
        read.resolve(SELF_INFO);
        await flushPromises();

        expect(wrapper.text()).not.toContain("Reading settings from the radio");
        expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
    });

    it("is ready without waiting for the firmware details", async () => {
        // those are one more turn in the queue, and nothing in the form needs them
        Connection.deviceQuery.mockReturnValue(new Promise(() => {}));

        const wrapper = mountPage();
        read.resolve(SELF_INFO);
        await flushPromises();

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

    it("writes nothing if save is reached before the radio has answered", async () => {
        // the button is disabled, but save must not trust that it is the only way in
        Connection.loadSelfInfo.mockImplementation(() => new Promise(() => {}));
        const wrapper = mountPage();
        await flushPromises();

        const savedTab = vi.spyOn(wrapper.findComponent(ModeSettingsTabs).vm, "save").mockResolvedValue(undefined);
        await wrapper.vm.save();

        expect(savedTab).not.toHaveBeenCalled();
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

    // Where this station is moved into the mode tabs with the clock, and is
    // written when pressed rather than by Save. Covered in radio_now.test.mjs.
    it("has none of the radio's own fields to fill", async () => {
        // the position moved into the mode tabs with the clock; what number boxes
        // remain on the page belong to the net defaults, which belong to no radio
        const wrapper = mountPage();
        await flushPromises();
        for(const placeholder of ["e.g: -38.664646", "e.g: 178.023507", "e.g: 917.375", "e.g: 22"]){
            expect(wrapper.findAll("input").some((i) => i.attributes("placeholder") === placeholder), placeholder).toBe(false);
        }
    });


});

// One Save. The page used to have two: this one for the live fields, and another
// inside the mode tab for the mode. An operator who pressed the wrong one saved
// half of what they had changed.
describe("the one Save", () => {

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = null;
        GlobalState.contacts = [];
        GlobalState.channels = [];
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => {
            GlobalState.selfInfo = SELF_INFO;
        });
        vi.spyOn(Connection, "deviceQuery").mockResolvedValue(null);
        vi.spyOn(Connection, "setAdvertLatLong").mockResolvedValue(undefined);
        vi.spyOn(Connection, "getChannel").mockResolvedValue({ channelIdx: 0, name: "", secret: new Uint8Array(16) });
        window.alert = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
    });

    it("saves the mode tab on show", async () => {
        const wrapper = mountPage();
        await flushPromises();

        const tabs = wrapper.findComponent(ModeSettingsTabs);
        const savedTab = vi.spyOn(tabs.vm, "save").mockResolvedValue(undefined);

        await wrapper.vm.save();

        expect(savedTab).toHaveBeenCalled();
    });

    it("does not before the radio has answered", async () => {
        Connection.loadSelfInfo.mockImplementation(() => new Promise(() => {}));
        const wrapper = mountPage();
        await flushPromises();

        const tabs = wrapper.findComponent(ModeSettingsTabs);
        const savedTab = vi.spyOn(tabs.vm, "save").mockResolvedValue(undefined);

        await wrapper.vm.save();

        expect(savedTab).not.toHaveBeenCalled();
    });

});
