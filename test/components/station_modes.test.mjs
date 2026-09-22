// The three modes a station runs in: Normal, Emcomm-Live and Emcomm-Training.
//
// A mode is a whole configuration written to the radio, so these check what is
// written, that the way home is taken before anything changes, and that the only
// difference between the modes is what is in them.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Constants } from "@liamcottle/meshcore.js";
import ModeProfiles, { MODES, MODE_LABELS } from "../../src/js/modes/ModeProfiles.js";
import ModeSwitch from "../../src/js/modes/ModeSwitch.js";
import ModeBanner from "../../src/components/modes/ModeBanner.vue";
import ModeSwitchDialog from "../../src/components/modes/ModeSwitchDialog.vue";
import ModeSettingsTabs from "../../src/components/modes/ModeSettingsTabs.vue";
import Connection from "../../src/js/Connection.js";
import EmcommMode from "../../src/js/EmcommMode.js";
import NodeBackup from "../../src/js/NodeBackup.js";
import AdvertSchedule from "../../src/js/AdvertSchedule.js";
import PositionService from "../../src/js/position/PositionService.js";
import ReportEncoder from "../../src/js/reports/ReportEncoder.js";
import ReportForms from "../../src/js/reports/ReportForms.js";
import GlobalState from "../../src/js/GlobalState.js";
import Utils from "../../src/js/Utils.js";

const KEY = new Uint8Array(32).fill(0x39);
const NODE = Utils.bytesToHex(KEY);
const ROOM = new Uint8Array(32).fill(0x87);
const ROOM_HEX = Utils.bytesToHex(ROOM);

function selfInfo(overrides = {}) {
    return {
        name: "Joe-KJ5HBN-HTv3", publicKey: KEY,
        radioFreq: 906875, radioBw: 250000, radioSf: 10, radioCr: 5,
        txPower: 14, maxTxPower: 22, advLat: 31758700, advLon: -106486900,
        manualAddContacts: 1, reserved: new Uint8Array([0, 0, 0]),
        ...overrides,
    };
}

function connect(overrides = {}) {
    GlobalState.connection = { on() {}, off() {} };
    GlobalState.selfInfo = selfInfo(overrides);
    GlobalState.contacts = [{ publicKey: ROOM, advName: "N.E. ELP EMCOMM OBSVR", type: Constants.AdvType.Room, flags: 0 }];
    GlobalState.channels = [];
    GlobalState.gpsStatus = "unconfirmed";
}

// the radio's channel slots, as the app reads and writes them
function radioChannels(slots) {
    const written = [];
    vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => {
        if(!(idx in slots)) throw new Error("no such channel");
        return { channelIdx: idx, name: slots[idx].name, secret: Utils.hexToBytes(slots[idx].secret) };
    });
    vi.spyOn(Connection, "setChannel").mockImplementation(async (idx, name, secret) => {
        written.push({ idx, name, secret: Utils.bytesToHex(secret) });
    });
    vi.spyOn(Connection, "deleteChannel").mockImplementation(async (idx) => {
        written.push({ idx, name: "", secret: "cleared" });
    });
    return written;
}

function quietRadio() {
    vi.spyOn(Connection, "setAdvertName").mockResolvedValue(undefined);
    vi.spyOn(Connection, "setRadioParams").mockResolvedValue(undefined);
    vi.spyOn(Connection, "setTxPower").mockResolvedValue(undefined);
    vi.spyOn(Connection, "syncDeviceTime").mockResolvedValue(undefined);
    vi.spyOn(Connection, "loadSelfInfo").mockResolvedValue(undefined);
    vi.spyOn(Connection, "loadChannels").mockResolvedValue(undefined);
    vi.spyOn(Connection, "loadContacts").mockResolvedValue(undefined);
    vi.spyOn(Connection, "sendZeroHopAdvert").mockResolvedValue(undefined);
    vi.spyOn(Connection, "discoverRepeaters").mockResolvedValue([]);
    vi.spyOn(EmcommMode, "applyRadioPolicies").mockResolvedValue(undefined);
    vi.spyOn(EmcommMode, "setManualAddContacts").mockResolvedValue(undefined);
    vi.spyOn(EmcommMode, "announce").mockResolvedValue(undefined);
    vi.spyOn(EmcommMode, "trim").mockResolvedValue({ removed: 0, notRemoved: [] });
    vi.spyOn(PositionService, "updateFromGps").mockResolvedValue({ updated: true, position: { latitude: 1, longitude: 2 } });
    vi.spyOn(AdvertSchedule, "start").mockImplementation(() => {});
}

describe("what a mode is", () => {

    beforeEach(() => {
        window.localStorage.clear();
        connect();
        radioChannels({ 0: { name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" }, 3: { name: "Emcomm Testing", secret: "11".repeat(16) } });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    it("has three, named as the banner names them", () => {
        // listed in this order, normal first and the real incident last
        expect(MODES).toEqual(["normal", "training", "live"]);
        expect(MODE_LABELS).toEqual({ normal: "Normal mode", live: "Emcomm-Live", training: "Emcomm-Training" });
    });

    it("starts in normal, and normal is the radio as it was found", async () => {
        expect(ModeProfiles.current(NODE)).toBe("normal");
        const normal = await ModeProfiles.captureNormal(NODE);
        expect(normal.radio).toMatchObject({
            name: "Joe-KJ5HBN-HTv3", radioFreq: 906875, radioBw: 250000, radioSf: 10, radioCr: 5, txPower: 14,
            shareLocation: false, advertPosition: false, multiAcks: false, autoAddContacts: false,
        });
        expect(normal.channels.map((c) => c.name)).toEqual(["Public", "Emcomm Testing"]);
        // nothing is announced, nothing is trimmed: it is where the station lives
        expect(normal.announce).toBe("none");
        expect(normal.trimContacts).toBe(false);
        expect(normal.markDrill).toBe(false);
    });

    it("gives live and training the emcomm settings, each with its own channel", async () => {
        await ModeProfiles.captureNormal(NODE);
        const live = await ModeProfiles.profileOrDefault("live", NODE);
        const training = await ModeProfiles.profileOrDefault("training", NODE);

        for(const profile of [live, training]){
            expect(profile.radio).toMatchObject({ txPower: 22, shareLocation: true, advertPosition: true, multiAcks: true, autoAddContacts: true });
            expect(profile.adverts).toEqual({ zeroHopMinutes: 30, floodMinutes: 60 });
            expect(profile.trimContacts).toBe(true);
            expect(profile.announce).toBe("flood");
        }

        expect(live.channels.map((c) => c.name)).toEqual(["#Emcomm"]);
        expect(training.channels.map((c) => c.name)).toEqual(["#Emcomm-Training"]);
        // the one real difference between them
        expect(live.markDrill).toBe(false);
        expect(training.markDrill).toBe(true);
        // each channel's key is the one every client derives from its name
        expect(live.channels[0].secret).toBe(Utils.bytesToHex(await EmcommMode.hashtagChannelKey("#Emcomm")));
    });

    it("keeps each node's modes apart", async () => {
        ModeProfiles.setCurrent("live", NODE);
        expect(ModeProfiles.current("ff".repeat(32))).toBe("normal");
        expect(ModeProfiles.current(NODE)).toBe("live");
    });

    it("says whether traffic is marked DRILL, from the mode in use", async () => {
        await ModeProfiles.profileOrDefault("training", NODE);
        expect(ModeProfiles.marksDrill(NODE)).toBe(false);
        ModeProfiles.setCurrent("training", NODE);
        expect(ModeProfiles.marksDrill(NODE)).toBe(true);
    });

});

describe("switching a station's mode", () => {

    let written;

    beforeEach(async () => {
        window.localStorage.clear();
        connect();
        written = radioChannels({ 0: { name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" }, 3: { name: "Emcomm Testing", secret: "11".repeat(16) } });
        quietRadio();
        vi.spyOn(NodeBackup, "capture").mockResolvedValue({ formatVersion: 1, nodePublicKey: NODE, nodeName: "before", capturedAt: 1, settings: {}, channels: [], contacts: [], warnings: [] });
        vi.spyOn(NodeBackup, "restore").mockResolvedValue({ failures: [], notInBackup: [] });
        await ModeProfiles.captureNormal(NODE);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    it("takes the way home before it changes anything", async () => {
        const order = [];
        NodeBackup.capture.mockImplementation(async () => {
            order.push("backup");
            return { formatVersion: 1, nodePublicKey: NODE, nodeName: "before", capturedAt: 1, settings: {}, channels: [], contacts: [], warnings: [] };
        });
        Connection.setRadioParams.mockImplementation(async () => { order.push("radio"); });

        await ModeSwitch.apply("live");

        expect(order[0]).toBe("backup");
        expect(NodeBackup.load(NODE, NodeBackup.SLOT_PRE_EMCOMM).nodeName).toBe("before");
    });

    it("never replaces the way home on a second switch away from normal", async () => {
        await ModeSwitch.apply("live");
        NodeBackup.capture.mockResolvedValue({ formatVersion: 1, nodePublicKey: NODE, nodeName: "during", capturedAt: 2, settings: {}, channels: [], contacts: [], warnings: [] });
        await ModeSwitch.apply("training");
        expect(NodeBackup.load(NODE, NodeBackup.SLOT_PRE_EMCOMM).nodeName).toBe("before");
    });

    it("writes the mode's channels from slot 0 and clears the rest", async () => {
        await ModeSwitch.apply("live");
        expect(written[0]).toMatchObject({ idx: 0, name: "#Emcomm" });
        // Emcomm Testing goes with it, being an emcomm channel; Public does not
        expect(written[1]).toMatchObject({ idx: 1, name: "Emcomm Testing" });
        expect(written.slice(2).every((w) => w.secret === "cleared")).toBe(true);
        expect(written.map((w) => w.name)).not.toContain("Public");
        expect(written).toHaveLength(16);
    });

    it("carries a channel whose name says emcomm into every mode, and says so", async () => {
        const result = await ModeSwitch.apply("live");
        expect(result.warnings.join(" ")).toContain("Emcomm Testing is an emcomm channel, so it was carried into Emcomm-Live");
        // and it is in that mode from now on, so the next switch keeps it too
        expect(ModeProfiles.profile("live", NODE).channels.map((c) => c.name)).toEqual(["#Emcomm", "Emcomm Testing"]);
    });

    it("gives live and training their own channel by default, and does not force it back", async () => {
        const live = await ModeProfiles.profileOrDefault("live", NODE);
        expect(live.channels.map((c) => c.name)).toEqual(["#Emcomm"]);
        const training = await ModeProfiles.profileOrDefault("training", NODE);
        expect(training.channels.map((c) => c.name)).toEqual(["#Emcomm-Training"]);

        // an operator who removes it meant to: it stays removed
        ModeProfiles.saveProfile("live", { ...live, channels: [] }, NODE);
        expect((await ModeProfiles.profileOrDefault("live", NODE)).channels).toEqual([]);
    });

    it("writes the radio settings, and the app's own settings for the node", async () => {
        await ModeSwitch.apply("live");
        expect(Connection.setAdvertName).toHaveBeenCalledWith("Joe-KJ5HBN-HTv3");
        expect(Connection.setTxPower).toHaveBeenCalledWith(22);
        expect(EmcommMode.applyRadioPolicies).toHaveBeenCalledWith({ shareLocation: true, advertPosition: true, multiAcks: true });
        expect(EmcommMode.setManualAddContacts).toHaveBeenCalledWith(false);
        // the channel it wrote is the one that answers position requests
        expect(PositionService.settings(NODE).markedChannels).toEqual([0]);
        expect(AdvertSchedule.get(NODE)).toEqual({ zeroHopMinutes: 30, floodMinutes: 60 });
        expect(AdvertSchedule.start).toHaveBeenCalledWith(NODE);
    });

    it("trims contacts entering an emcomm mode, and writes the backup going back to normal", async () => {
        await ModeSwitch.apply("live");
        expect(EmcommMode.trim).toHaveBeenCalled();
        expect(NodeBackup.restore).not.toHaveBeenCalled();

        await ModeSwitch.apply("normal");
        expect(NodeBackup.restore).toHaveBeenCalledTimes(1);
        expect(NodeBackup.restore.mock.calls[0][0].nodeName).toBe("before");
        expect(ModeProfiles.current(NODE)).toBe("normal");
    });

    it("announces the station in an emcomm mode, and says what the repeater search found", async () => {
        Connection.discoverRepeaters.mockResolvedValue([{ name: "FEDF MC Repeater" }]);
        const result = await ModeSwitch.apply("training");
        expect(EmcommMode.announce).toHaveBeenCalledWith(true);
        expect(result.warnings.join(" ")).toContain("1 repeater(s) answered");
    });

    it("says the station is in the mode only after the radio was read back", async () => {
        const order = [];
        Connection.loadSelfInfo.mockImplementation(async () => { order.push("read back"); });
        await ModeSwitch.apply("live");
        expect(order).toEqual(["read back"]);
        expect(ModeProfiles.current(NODE)).toBe("live");
    });

    it("carries on past a setting the radio will not take, and names it", async () => {
        Connection.setTxPower.mockRejectedValue(new Error("the radio refused it"));
        const result = await ModeSwitch.apply("live");
        expect(result.failures).toEqual([{ what: "transmit power", reason: "the radio refused it" }]);
        // and the rest still happened
        expect(written).toHaveLength(16);
        expect(ModeProfiles.current(NODE)).toBe("live");
    });

    it("refuses with no radio, and changes nothing", async () => {
        GlobalState.connection = null;
        await expect(ModeSwitch.apply("live")).rejects.toThrow(Connection.DISCONNECTED);
        expect(ModeProfiles.current(NODE)).toBe("normal");
    });

    it("says what a switch would do before anything is written", async () => {
        const described = await ModeSwitch.describe("live");
        const text = described.changes.join(" ");
        expect(text).toContain("Transmit power becomes 22 dBm, from 14");
        expect(text).toContain("Channels become: #Emcomm");
        expect(text).toContain("Companions are cleared");
        expect(written).toEqual([]);
        expect(Connection.setAdvertName).not.toHaveBeenCalled();
    });

    it("warns going back to normal with no backup to write", async () => {
        ModeProfiles.setCurrent("live", NODE);
        const result = await ModeSwitch.apply("normal");
        expect(result.warnings.join(" ")).toContain("no backup from before this station left normal mode");
    });

});

describe("what a switch must never destroy", () => {

    let written, removed;

    beforeEach(async () => {
        window.localStorage.clear();
        connect();
        written = radioChannels({
            0: { name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" },
            3: { name: "Emcomm Testing", secret: "11".repeat(16) },
        });
        quietRadio();
        // the trim is the real one here: that is what is being checked
        EmcommMode.trim.mockRestore();
        removed = [];
        GlobalState.connection.removeContact = async (key) => {
            removed.push(Utils.bytesToHex(key).slice(0, 2));
            GlobalState.contacts = GlobalState.contacts.filter((c) => Utils.bytesToHex(c.publicKey) !== Utils.bytesToHex(key));
        };
        vi.spyOn(NodeBackup, "capture").mockResolvedValue({ formatVersion: 1, nodePublicKey: NODE, nodeName: "before", capturedAt: 1, settings: {}, channels: [], contacts: [], warnings: [] });
        vi.spyOn(NodeBackup, "restore").mockResolvedValue({ failures: [], notInBackup: [] });
        await ModeProfiles.captureNormal(NODE);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    function contact(n, { favourite = false, type = Constants.AdvType.Chat, lastAdvert = Math.floor(Date.now() / 1000) } = {}) {
        const publicKey = new Uint8Array(32);
        publicKey[0] = n;
        return {
            publicKey, type, flags: favourite ? 1 : 0, advName: `Contact ${n}`,
            lastAdvert, outPathLen: 0, outPath: new Uint8Array(64), advLat: 0, advLon: 0,
        };
    }

    it("keeps a favourite companion, and a favourite repeater quiet for years", async () => {
        const longAgo = Math.floor(Date.now() / 1000) - 400 * 24 * 60 * 60;
        GlobalState.contacts = [
            contact(1),
            contact(2, { favourite: true }),
            contact(3, { type: Constants.AdvType.Repeater, lastAdvert: longAgo }),
            contact(4, { type: Constants.AdvType.Repeater, lastAdvert: longAgo, favourite: true }),
            contact(5, { type: Constants.AdvType.Room, lastAdvert: longAgo, favourite: true }),
        ];

        await ModeSwitch.apply("live");

        // only the unstarred companion and the unstarred quiet repeater go
        expect(removed.sort()).toEqual(["01", "03"]);
    });

    it("keeps a channel the new mode does not hold, rather than losing its key", async () => {
        // a private channel made during an incident: its key is on the radio and
        // nowhere else, so clearing the slot would destroy it
        Connection.getChannel.mockImplementation(async (idx) => {
            const slots = {
                0: { name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" },
                1: { name: "County Tac", secret: "ab".repeat(16) },
            };
            if(!(idx in slots)) throw new Error("no such channel");
            return { channelIdx: idx, name: slots[idx].name, secret: Utils.hexToBytes(slots[idx].secret) };
        });
        GlobalState.contacts = [];

        const result = await ModeSwitch.apply("live");

        const normal = ModeProfiles.profile("normal", NODE);
        const kept = normal.channels.find((c) => c.name === "County Tac");
        expect(kept.secret).toBe("ab".repeat(16));
        expect(result.warnings.join(" ")).toContain("County Tac was on the radio but in no mode, so it was kept in Normal mode");
    });

    it("does not copy a channel the new mode already holds", async () => {
        Connection.getChannel.mockImplementation(async (idx) => {
            if(idx !== 0) throw new Error("no such channel");
            const secret = "8b3387e9c5cdea6ac9e5edbaa115cd72";
            return { channelIdx: 0, name: "Public", secret: Utils.hexToBytes(secret) };
        });
        GlobalState.contacts = [];
        const live = await ModeProfiles.profileOrDefault("live", NODE);
        live.channels = [{ name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72", answerPositions: false }];
        ModeProfiles.saveProfile("live", live, NODE);

        const result = await ModeSwitch.apply("live");

        expect(ModeProfiles.profile("normal", NODE).channels.filter((c) => c.name === "Public")).toHaveLength(1);
        expect(result.warnings.join(" ")).not.toContain("in no mode");
    });

    it("says so rather than staying quiet if the channels could not be read first", async () => {
        Connection.getChannel.mockRejectedValue(new Error("the radio did not answer"));
        GlobalState.contacts = [];
        const result = await ModeSwitch.apply("live");
        expect(result.warnings.join(" ")).toContain("any channel in no mode may have been lost");
    });

});

describe("the banner", () => {

    beforeEach(() => {
        window.localStorage.clear();
        connect();
    });

    afterEach(() => {
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    const colours = { normal: "bg-green-500", live: "bg-red-500", training: "bg-yellow-400" };

    it("says which mode the station is in, in its own colour, with black letters", () => {
        for(const mode of MODES){
            ModeProfiles.setCurrent(mode, NODE);
            const wrapper = mount(ModeBanner);
            expect(wrapper.text()).toContain(MODE_LABELS[mode]);
            expect(wrapper.find("button").classes()).toContain(colours[mode]);
            expect(wrapper.find("button").classes()).toContain("text-black");
        }
    });

    it("goes right across the header, outside the column that clips the node name", async () => {
        // on a phone it sat inside the name column, under a row of fixed height:
        // it read "Normal mode · tap to" with the rest cut off
        const { default: Header } = await import("../../src/components/Header.vue");
        const wrapper = mount(Header, { global: { stubs: { RouterLink: true, DropDownMenu: true, DropDownMenuItem: true, IconButton: true, ModeSwitchDialog: true } } });
        const banner = wrapper.findComponent(ModeBanner);
        expect(banner.exists()).toBe(true);

        const button = banner.find("button");
        expect(button.classes()).toContain("w-full");

        // nothing between it and the header hides what overflows or fixes a height
        let parent = button.element.parentElement;
        while(parent && parent !== wrapper.element.parentElement){
            const classes = parent.className ?? "";
            expect(classes).not.toContain("overflow-hidden");
            expect(classes).not.toContain("truncate");
            expect(classes).not.toMatch(/h-16/);
            parent = parent.parentElement;
        }
    });

    it("asks to be opened when pressed", async () => {
        const wrapper = mount(ModeBanner);
        await wrapper.find("button").trigger("click");
        expect(wrapper.emitted("open")).toHaveLength(1);
    });

    it("is not there with no radio connected", () => {
        GlobalState.connection = null;
        expect(mount(ModeBanner).find("button").exists()).toBe(false);
    });

});

describe("the mode switch dialog", () => {

    beforeEach(async () => {
        window.localStorage.clear();
        connect();
        radioChannels({ 0: { name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" } });
        quietRadio();
        await ModeProfiles.captureNormal(NODE);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    it("offers the three modes, marks the one in use, and says what a switch would do", async () => {
        const wrapper = mount(ModeSwitchDialog, { props: { open: true } });
        await flushPromises();
        expect(wrapper.text()).toContain("Emcomm-Live");
        expect(wrapper.text()).toContain("this station is in this mode");

        wrapper.vm.chosen = "live";
        await flushPromises();
        expect(wrapper.text()).toContain("Channels become: #Emcomm");
        // nothing written by looking
        expect(Connection.setAdvertName).not.toHaveBeenCalled();
    });

    it("switches when pressed, and says so", async () => {
        const apply = vi.spyOn(ModeSwitch, "apply").mockResolvedValue({ mode: "live", from: "normal", failures: [], warnings: ["3 contact(s) removed, 10 left."] });
        const wrapper = mount(ModeSwitchDialog, { props: { open: true } });
        await flushPromises();
        wrapper.vm.chosen = "live";
        await flushPromises();

        await wrapper.findAll("button").find((b) => b.text().includes("Switch to Emcomm-Live")).trigger("click");
        await flushPromises();

        expect(apply).toHaveBeenCalledWith("live", expect.any(Function));
        expect(wrapper.text()).toContain("This station is now in Emcomm-Live");
        expect(wrapper.text()).toContain("3 contact(s) removed");
    });

    it("cannot switch to the mode it is already in", async () => {
        const wrapper = mount(ModeSwitchDialog, { props: { open: true } });
        await flushPromises();
        expect(wrapper.findAll("button").find((b) => b.text().includes("Switch to Normal mode")).attributes("disabled")).toBeDefined();
    });

    it("says what would not go, rather than claiming the switch was clean", async () => {
        vi.spyOn(ModeSwitch, "apply").mockResolvedValue({ mode: "live", from: "normal", failures: [{ what: "transmit power", reason: "the radio refused it" }], warnings: [] });
        const wrapper = mount(ModeSwitchDialog, { props: { open: true } });
        await flushPromises();
        wrapper.vm.chosen = "live";
        await flushPromises();
        await wrapper.findAll("button").find((b) => b.text().includes("Switch to")).trigger("click");
        await flushPromises();
        expect(wrapper.text()).toContain("transmit power was not set: the radio refused it");
    });

});

describe("the settings tabs", () => {

    beforeEach(async () => {
        window.localStorage.clear();
        connect();
        radioChannels({ 0: { name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" } });
        await ModeProfiles.captureNormal(NODE);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    const tab = (wrapper, mode) => wrapper.findAll("button").find((b) => b.text().includes(MODE_LABELS[mode]));

    // a tab reads the radio for a mode it has never shown, through a dynamic
    // import, so how many turns of the loop that takes is not fixed: wait for the
    // profile itself rather than guessing a number of ticks
    async function open(wrapper, mode) {
        await tab(wrapper, mode).trigger("click");
        for(let i = 0; i < 50 && wrapper.vm.profile == null; i++){
            await flushPromises();
        }
        expect(wrapper.vm.profile).not.toBe(null);
    }

    it("has a tab for each mode, showing the same fields for each", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        for(const mode of MODES){
            await open(wrapper, mode);
            for(const label of ["Node name", "Frequency (kHz)", "Transmit power (dBm)", "Channels", "Rooms", "Zero hop", "Flood"]){
                expect(wrapper.text()).toContain(label);
            }
        }
    });

    it("shows each mode's own channels", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        expect(wrapper.text()).toContain("Public");

        await open(wrapper, "training");
        expect(wrapper.text()).toContain("#Emcomm-Training");
        expect(wrapper.text()).not.toContain("Public");
    });

    it("adds a # channel with the key derived from its name, and a named one with a random key", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "live");

        wrapper.vm.newChannelName = "#Drill-Net";
        await wrapper.vm.addChannel();
        const added = wrapper.vm.profile.channels.find((c) => c.name === "#Drill-Net");
        expect(added.secret).toBe(Utils.bytesToHex(await EmcommMode.hashtagChannelKey("#Drill-Net")));
        expect(added.answerPositions).toBe(true);

        wrapper.vm.newChannelName = "County Tac";
        await wrapper.vm.addChannel();
        const named = wrapper.vm.profile.channels.find((c) => c.name === "County Tac");
        expect(named.secret).toHaveLength(32);
        expect(named.secret).not.toBe(added.secret);
    });

    it("saves a mode, and keeps the rooms it uses", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "live");

        wrapper.vm.toggleRoom({ keyHex: ROOM_HEX, name: "N.E. ELP EMCOMM OBSVR" }, true);
        wrapper.vm.profile.adverts.zeroHopMinutes = 45;
        wrapper.vm.save();
        await flushPromises();

        const saved = ModeProfiles.profile("live", NODE);
        expect(saved.rooms).toEqual([{ keyHex: ROOM_HEX, name: "N.E. ELP EMCOMM OBSVR", answerPositions: true }]);
        expect(saved.adverts.zeroHopMinutes).toBe(45);
        expect(wrapper.text()).toContain("Emcomm-Live saved");
    });

    it("says that saving the mode in use does not change the radio by itself", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        expect(wrapper.text()).toContain("switch into the mode again from the banner to write it");
    });

    it("can take the radio's settings again for normal mode", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        GlobalState.selfInfo = selfInfo({ name: "Renamed", txPower: 20 });
        await wrapper.vm.recapture();
        expect(ModeProfiles.profile("normal", NODE).radio).toMatchObject({ name: "Renamed", txPower: 20 });
    });

});

describe("training marks what it sends", () => {

    beforeEach(async () => {
        window.localStorage.clear();
        connect();
        radioChannels({ 0: { name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" } });
        await ModeProfiles.profileOrDefault("training", NODE);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    const form = ReportForms.find((f) => f.id === "ics213");

    it("puts DRILL on every part, not just the first", () => {
        const values = { to: "Ops", from: "KJ5HBN", subject: "Exercise", datetime: "221830L SEP", message: "x".repeat(300) };
        const marked = ReportEncoder.prepare(form, values, "Joe-KJ5HBN-HTv3", "channel", { markDrill: true });
        expect(marked.parts.length).toBeGreaterThan(1);
        expect(marked.parts.every((p) => p.startsWith("DRILL ["))).toBe(true);
        // and every part still fits: the marking is budgeted for, not added after
        for(const part of marked.parts){
            expect(ReportEncoder.byteLength(part)).toBeLessThanOrEqual(marked.budgetBytes);
        }
    });

    it("marks a report that fits in one packet too", () => {
        const values = { to: "Ops", from: "KJ5HBN", subject: "Exercise", datetime: "221830L SEP", message: "short" };
        const marked = ReportEncoder.prepare(form, values, "Joe-KJ5HBN-HTv3", "channel", { markDrill: true });
        expect(marked.parts).toHaveLength(1);
        expect(marked.parts[0].startsWith("DRILL ICS-213")).toBe(true);
    });

    it("leaves the other modes' traffic exactly as it was", () => {
        const values = { to: "Ops", from: "KJ5HBN", subject: "Real", datetime: "221830L SEP", message: "x".repeat(300) };
        const plain = ReportEncoder.prepare(form, values, "Joe-KJ5HBN-HTv3", "channel");
        expect(plain.parts.every((p) => p.startsWith("["))).toBe(true);
    });

});
