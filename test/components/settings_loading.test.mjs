// The settings page while it waits for the radio.
//
// Device commands now take turns, which stopped the replies crossing. The cost is
// that the settings read can wait behind other work: on the bench, opening
// settings just after an advert arrived meant waiting out a two pass contact
// reload over Bluetooth, several seconds of empty fields. Empty is the dangerous
// state. An empty Name box looks like a node with no name, and saving it writes
// one. So the page says it is reading, and Save stays off until the fields hold
// what the radio actually said.

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
                EmcommConvertDialog: true,
                EmcommSettingsGroup: true,
                RouterLink: true,
            },
        },
    });
}

const saveButton = (wrapper) => wrapper.findAll("button").find((b) => ["Save", "Saving..."].includes(b.text().trim()));
const nameField = (wrapper) => wrapper.findAll("input").find((i) => i.attributes("placeholder") === "e.g: Anonymous");

describe("SettingsPage while reading the radio", () => {

    let read;
    let setAdvertName;

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = null;

        read = defer();
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => {
            GlobalState.selfInfo = await read.promise;
        });
        vi.spyOn(Connection, "deviceQuery").mockResolvedValue(null);
        setAdvertName = vi.spyOn(Connection, "setAdvertName").mockResolvedValue(undefined);
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
        expect(nameField(wrapper).element.value).toBe("");
    });

    it("fills the fields and turns Save on once the radio answers", async () => {
        const wrapper = mountPage();
        read.resolve(SELF_INFO);
        await flushPromises();

        expect(nameField(wrapper).element.value).toBe("KJ5HBN-EMCOMM");
        expect(wrapper.text()).not.toContain("Reading settings from the radio");
        expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
    });

    it("fills the fields without waiting for the firmware details", async () => {
        // those are one more turn in the queue, and nothing in the form needs them
        Connection.deviceQuery.mockReturnValue(new Promise(() => {}));

        const wrapper = mountPage();
        read.resolve(SELF_INFO);
        await flushPromises();

        expect(nameField(wrapper).element.value).toBe("KJ5HBN-EMCOMM");
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

        expect(setAdvertName).not.toHaveBeenCalled();
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
