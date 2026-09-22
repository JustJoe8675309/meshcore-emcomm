// EMCOMM mode shares location, adds contacts automatically, and runs at full
// power; leaving it puts all three back.
//
// Location sharing is the radio's telemetry permission, which lets it answer a
// position request itself with this app closed. It lives in the same radio
// command as the add contacts mode, the advert location policy and multi acks,
// and the firmware sets every field the command reaches, so each has to be sent
// back as it was. meshcore.js sends only the first of them.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Constants } from "@liamcottle/meshcore.js";
import Connection from "../../src/js/Connection.js";
import EmcommMode from "../../src/js/EmcommMode.js";
import NodeBackup from "../../src/js/NodeBackup.js";
import GlobalState from "../../src/js/GlobalState.js";
import EmcommConvertDialog from "../../src/components/settings/EmcommConvertDialog.vue";
import EmcommSettingsGroup from "../../src/components/settings/EmcommSettingsGroup.vue";
import SettingsPage from "../../src/components/pages/SettingsPage.vue";

const KEY = new Uint8Array(32).fill(0x39);

// multi acks 1, advert location policy 1, telemetry: environment flagged,
// location denied, base denied
const RESERVED = new Uint8Array([1, 1, 0b01_00_00]);

function selfInfo(overrides = {}) {
    return {
        name: "Joe-KJ5HBN-HTv3", publicKey: KEY, radioFreq: 910525, radioBw: 62.5, radioSf: 7, radioCr: 5,
        txPower: 20, maxTxPower: 22, advLat: 0, advLon: 0, manualAddContacts: 1,
        reserved: RESERVED, ...overrides,
    };
}

// a radio that answers Ok to everything, remembering each frame
function radio() {
    const frames = [];
    const handlers = {};
    return {
        frames,
        on(code, fn) { (handlers[code] ??= []).push(fn); },
        off(code, fn) { handlers[code] = (handlers[code] ?? []).filter((f) => f !== fn); },
        async sendToRadioFrame(frame) {
            frames.push(Array.from(frame));
            queueMicrotask(() => { for(const fn of handlers[Constants.ResponseCodes.Ok] ?? []) fn({}); });
        },
    };
}

describe("the other params command", () => {

    beforeEach(() => {
        GlobalState.selfInfo = selfInfo();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
    });

    it("reads the three settings meshcore.js files as reserved", () => {
        expect(Connection.otherParams()).toEqual({ manualAddContacts: true, multiAcks: 1, advertLocPolicy: 1, telemetryModes: 0b010000 });
    });

    it("writes all of them in one frame, in the firmware's order", async () => {
        const r = radio();
        GlobalState.connection = r;
        await Connection.setAllOtherParams({ manualAddContacts: false, telemetryModes: 0b011010, advertLocPolicy: 1, multiAcks: 2 });
        expect(r.frames).toEqual([[38, 0, 0b011010, 1, 2]]);
    });

    it("reads location sharing as on only when both base and location allow anyone", () => {
        expect(EmcommMode.locationSharing(selfInfo())).toBe("off");
        expect(EmcommMode.locationSharing(selfInfo({ reserved: [1, 1, 0b00_10_10] }))).toBe("all");
        expect(EmcommMode.locationSharing(selfInfo({ reserved: [1, 1, 0b00_01_10] }))).toBe("flagged");
        expect(EmcommMode.locationSharing(selfInfo({ reserved: [1, 1, 0b00_10_00] }))).toBe("off");
    });

    it("turns sharing on without touching anything else in the command", async () => {
        const r = radio();
        GlobalState.connection = r;
        vi.spyOn(Connection, "loadSelfInfo").mockResolvedValue(undefined);
        await EmcommMode.setLocationSharing(true);
        // manual add kept, environment kept flagged, base and location to anyone,
        // policy and multi acks as they were
        expect(r.frames).toEqual([[38, 1, 0b01_10_10, 1, 1]]);
    });

    it("turns it off by denying base and location", async () => {
        GlobalState.selfInfo = selfInfo({ reserved: [0, 0, 0b01_10_10] });
        const r = radio();
        GlobalState.connection = r;
        vi.spyOn(Connection, "loadSelfInfo").mockResolvedValue(undefined);
        await EmcommMode.setLocationSharing(false);
        expect(r.frames).toEqual([[38, 1, 0b01_00_00, 0, 0]]);
    });

});

describe("the convert dialog", () => {

    const mountDialog = () => mount(EmcommConvertDialog, {
        props: {
            current: selfInfo(),
            plan: { remove: [], keep: [], keptForUnreadableAge: 0, counts: { companions: 0, repeaters: 0, rooms: 0 } },
        },
    });

    it("adds contacts automatically, shares location and raises power, by default", async () => {
        const wrapper = mountDialog();
        expect(wrapper.text()).toContain("Add contacts automatically");
        expect(wrapper.text()).toContain("Share location with stations that ask");
        expect(wrapper.text()).toContain("The EMCOMM default");
        expect(wrapper.text()).not.toContain("Stop adding contacts automatically");
        wrapper.vm.confirm();
        const choices = wrapper.emitted("confirm")[0][0];
        expect(choices.autoAddContacts).toBe(true);
        expect(choices.shareLocation).toBe(true);
        expect(choices.txPower).toBe(22);
    });

});

describe("converting", () => {

    function mountPage() {
        return mount(SettingsPage, {
            global: {
                stubs: {
                    Page: { template: "<div><slot/></div>" },
                    AppBar: { template: "<div><slot name='trailing'/></div>" },
                    EmcommConvertDialog: true,
                    EmcommSettingsGroup: true,
                    PositionSettingsGroup: true,
                    RouterLink: true,
                },
            },
        });
    }

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = selfInfo();
        GlobalState.contacts = [];
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => {});
        vi.spyOn(Connection, "deviceQuery").mockResolvedValue(null);
        vi.spyOn(EmcommMode, "applySettings").mockResolvedValue({ failures: [] });
        vi.spyOn(EmcommMode, "trim").mockResolvedValue({ removed: 0, notRemoved: [] });
        vi.spyOn(EmcommMode, "announce").mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    it("writes sharing, adverts carrying the position and extra acknowledgements in one command", async () => {
        // one radio command holds all three, so they are written together rather
        // than read and rewritten three times
        const policies = vi.spyOn(EmcommMode, "applyRadioPolicies").mockResolvedValue(undefined);
        const manual = vi.spyOn(EmcommMode, "setManualAddContacts").mockResolvedValue(undefined);
        const wrapper = mountPage();
        await flushPromises();
        wrapper.vm.convertPlan = { remove: [], keep: [], keptForUnreadableAge: 0 };
        await wrapper.vm.runConvert({ name: null, radio: null, txPower: 22, syncClock: false, setPositionFromGps: false, advert: "none", discover: false, autoAddContacts: true, shareLocation: true, advertPosition: true, multiAcks: true });
        expect(policies).toHaveBeenCalledWith({ shareLocation: true, advertPosition: true, multiAcks: true });
        // manual add off, which is automatic contacts on
        expect(manual).toHaveBeenCalledWith(false);
    });

    it("writes what was unticked as off, rather than leaving it to chance", async () => {
        const policies = vi.spyOn(EmcommMode, "applyRadioPolicies").mockResolvedValue(undefined);
        const manual = vi.spyOn(EmcommMode, "setManualAddContacts").mockResolvedValue(undefined);
        const wrapper = mountPage();
        await flushPromises();
        wrapper.vm.convertPlan = { remove: [], keep: [], keptForUnreadableAge: 0 };
        await wrapper.vm.runConvert({ name: null, radio: null, txPower: null, syncClock: false, setPositionFromGps: false, advert: "none", discover: false, autoAddContacts: false, shareLocation: false, advertPosition: false, multiAcks: false });
        expect(policies).toHaveBeenCalledWith({ shareLocation: false, advertPosition: false, multiAcks: false });
        expect(manual).not.toHaveBeenCalled();
    });

    it("carries on, and says so, if the radio will not take them", async () => {
        vi.spyOn(EmcommMode, "applyRadioPolicies").mockRejectedValue(new Error("the radio refused it"));
        vi.spyOn(EmcommMode, "setManualAddContacts").mockResolvedValue(undefined);
        const wrapper = mountPage();
        await flushPromises();
        wrapper.vm.convertPlan = { remove: [], keep: [], keptForUnreadableAge: 0 };
        await wrapper.vm.runConvert({ name: null, radio: null, txPower: null, syncClock: false, setPositionFromGps: false, advert: "none", discover: false, autoAddContacts: true, shareLocation: true, advertPosition: true, multiAcks: true });
        expect(wrapper.vm.backupWarnings.join(" ")).toMatch(/were not set: the radio refused it/);
    });

});

describe("leaving EMCOMM mode puts sharing back", () => {

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
    });

    it("a backup keeps the whole command, not only the add contacts mode", async () => {
        // the radio's own answer, with the reserved bytes as meshcore.js reads them
        GlobalState.connection = { on() {}, off() {}, getSelfInfo: async () => selfInfo() };
        GlobalState.contacts = [];
        GlobalState.contactsMissing = 0;
        vi.spyOn(Connection, "loadContacts").mockResolvedValue(undefined);
        vi.spyOn(NodeBackup, "captureChannels").mockResolvedValue([]);
        const backup = await NodeBackup.capture();
        expect(backup.settings.telemetryModes).toBe(0b010000);
        expect(backup.settings.advertLocPolicy).toBe(1);
        expect(backup.settings.multiAcks).toBe(1);
        // and it survives being saved as JSON, as backups are
        expect(JSON.parse(JSON.stringify(backup)).settings.telemetryModes).toBe(0b010000);
    });

    it("a restore writes the whole command back", async () => {
        GlobalState.connection = { on() {}, off() {} };
        const all = vi.spyOn(Connection, "setAllOtherParams").mockResolvedValue(undefined);
        const onlyManual = vi.spyOn(Connection, "setOtherParams").mockResolvedValue(undefined);
        for(const name of ["setAdvertName", "setAdvertLatLong", "setTxPower", "setRadioParams", "setChannel", "addOrUpdateContact"]){
            vi.spyOn(Connection, name).mockResolvedValue(undefined);
        }
        vi.spyOn(Connection, "loadContacts").mockResolvedValue(undefined);
        const backup = {
            formatVersion: NodeBackup.FORMAT_VERSION ?? 1,
            settings: { name: "n", advLat: 0, advLon: 0, txPower: 20, radioFreq: 910525, radioBw: 62.5, radioSf: 7, radioCr: 5, manualAddContacts: 1, telemetryModes: 0b010000, advertLocPolicy: 1, multiAcks: 1 },
            channels: [], contacts: [],
        };
        await NodeBackup.restore(backup).catch((e) => { throw e; });
        expect(all).toHaveBeenCalledWith({ manualAddContacts: true, telemetryModes: 0b010000, advertLocPolicy: 1, multiAcks: 1 });
        expect(onlyManual).not.toHaveBeenCalled();
    });

    it("an older backup, from before these were kept, restores the add contacts mode as before", async () => {
        GlobalState.connection = { on() {}, off() {} };
        const all = vi.spyOn(Connection, "setAllOtherParams").mockResolvedValue(undefined);
        const onlyManual = vi.spyOn(Connection, "setOtherParams").mockResolvedValue(undefined);
        for(const name of ["setAdvertName", "setAdvertLatLong", "setTxPower", "setRadioParams", "setChannel", "addOrUpdateContact"]){
            vi.spyOn(Connection, name).mockResolvedValue(undefined);
        }
        vi.spyOn(Connection, "loadContacts").mockResolvedValue(undefined);
        const backup = {
            formatVersion: NodeBackup.FORMAT_VERSION ?? 1,
            settings: { name: "n", advLat: 0, advLon: 0, txPower: 20, radioFreq: 910525, radioBw: 62.5, radioSf: 7, radioCr: 5, manualAddContacts: 0 },
            channels: [], contacts: [],
        };
        await NodeBackup.restore(backup);
        expect(all).not.toHaveBeenCalled();
        expect(onlyManual).toHaveBeenCalledWith(false);
    });

});

describe("the EMCOMM settings group", () => {

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
    });

    it("shows location sharing and turns it on", async () => {
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = selfInfo();
        vi.spyOn(Connection, "getDeviceTime").mockResolvedValue(null);
        vi.spyOn(Connection, "loadSelfInfo").mockResolvedValue(undefined);
        const share = vi.spyOn(EmcommMode, "setLocationSharing").mockResolvedValue(undefined);
        const wrapper = mount(EmcommSettingsGroup);
        await flushPromises();
        expect(wrapper.text()).toContain("Location sharing");
        expect(wrapper.text()).toContain("Off");
        const button = wrapper.findAll("button").find((b) => b.text() === "Turn on" && b.element.closest("div").textContent.includes("Location sharing"));
        await button.trigger("click");
        await flushPromises();
        expect(share).toHaveBeenCalledWith(true);
    });

});
