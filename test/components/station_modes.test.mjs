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
import NetDefaults from "../../src/js/modes/NetDefaults.js";
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

// what the fake radio reports, and what the app now works to: the slot count came
// from the radio once a channel above slot 16 turned out to be invisible to modes
const RADIO_SLOTS = 40;
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

// the radio's channel slots, as the app reads and writes them.
//
// An unused slot answers with an empty name: the firmware's getChannel returns
// true for every idx below MAX_GROUP_CHANNELS and false only past the end, so a
// fake that errors on an unused slot in the middle is not a radio, and it hides
// the one fault worth catching — a hole in the middle of the list.
const SLOT_COUNT = 16;

function answerFor(slots, idx) {
    if(idx >= SLOT_COUNT) throw new Error("no such channel");
    const slot = slots[idx];
    return slot == null
        ? { channelIdx: idx, name: "", secret: new Uint8Array(16) }
        : { channelIdx: idx, name: slot.name, secret: Utils.hexToBytes(slot.secret) };
}

function radioChannels(slots) {
    const written = [];
    vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => answerFor(slots, idx));
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
            expect(profile.trimContacts).toBe(true);
            expect(profile.adverts.zeroHopMinutes).toBe(30);
        }

        expect(live.channels.map((c) => c.name)).toEqual(["#Emcomm"]);
        expect(training.channels.map((c) => c.name)).toEqual(["#Emcomm-Training"]);

        // A real incident answers a position request by itself: an operator
        // driving or working a task cannot tap Send, and a roll call would get
        // silence from the stations that matter most. A drill asks, because the
        // operator is at the radio learning what the prompt does.
        expect(live.autoAnswerPositions).toBe(true);
        expect(training.autoAnswerPositions).toBe(false);

        // And a drill is not paid for by the whole mesh: every repeater that
        // hears a flood advert rebroadcasts it, so training keeps the zero hop
        // and announces itself to its neighbours only.
        expect(live.announce).toBe("flood");
        expect(live.adverts.floodMinutes).toBe(60);
        expect(training.announce).toBe("zerohop");
        expect(training.adverts.floodMinutes).toBe(0);

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

    // A backup taken once and kept for ever drifts away from the radio it claims
    // to describe: node 3's was three days old, from a build that still stopped at
    // 16 channel slots, and a round trip cleared #emcomm-testing out of slot 16
    // with nothing to put back. Connecting to a station in normal mode takes one
    // now, so by the time a switch runs there usually is one — and a switch in an
    // incident does not stop to read the whole radio first.
    it("takes the way home only when there is not one already", async () => {
        await ModeSwitch.apply("live");
        expect(NodeBackup.load(NODE, NodeBackup.SLOT_PRE_EMCOMM).nodeName).toBe("before");
        expect(NodeBackup.capture).toHaveBeenCalledTimes(1);

        await ModeSwitch.apply("normal");
        await ModeSwitch.apply("training");

        // the one from before is still the way home, and the radio was not read
        // again to say so
        expect(NodeBackup.load(NODE, NodeBackup.SLOT_PRE_EMCOMM).nodeName).toBe("before");
        expect(NodeBackup.capture).toHaveBeenCalledTimes(1);
    });

    it("puts back a channel normal mode knows about that the backup never saw", async () => {
        // the backup remembers only Public; the radio also had Emcomm Testing,
        // which is in the normal profile because this build read it
        NodeBackup.capture.mockResolvedValue({
            formatVersion: 1, nodePublicKey: NODE, nodeName: "before", capturedAt: 1, settings: {},
            channels: [{ idx: 0, name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" }],
            contacts: [], warnings: [],
        });

        await ModeSwitch.apply("live");
        written.length = 0;
        const result = await ModeSwitch.apply("normal");

        const restored = written.filter((w) => w.name === "Emcomm Testing");
        expect(restored.length).toBe(1);
        // into a slot the backup did not claim
        expect(restored[0].idx).not.toBe(0);

        // the channel wording, not the contacts one, which also says "not in the backup"
        expect(result.warnings.join(" ")).toContain("put back from normal mode's own list");
    });

    // The restore puts the app's own settings back from the backup, and that
    // snapshot predates the switch: it does not know which slots the channels came
    // home to. Node 3 showed it thirteen seconds apart — the switch wrote [7, 16]
    // and the restore wrote [7] over the top, then captured that into the next
    // backup, so the mistake carried itself forward.
    it("has the last word on who answers, after the backup puts its own settings back", async () => {
        const normal = await ModeProfiles.profileOrDefault("normal", NODE);
        normal.autoAnswerPositions = true;
        ModeProfiles.saveProfile("normal", normal, NODE);

        NodeBackup.capture.mockResolvedValue({
            formatVersion: 1, nodePublicKey: NODE, nodeName: "before", capturedAt: 1, settings: {},
            channels: [
                { idx: 0, name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" },
                { idx: 3, name: "Emcomm Testing", secret: "11111111111111111111111111111111" },
            ],
            contacts: [], warnings: [],
        });
        // as the real restore does: it writes the settings the backup carries
        NodeBackup.restore.mockImplementation(async () => {
            PositionService.saveSettings({ autoAnswer: false }, NODE);
            return { failures: [], notInBackup: [] };
        });

        await ModeSwitch.apply("live");
        await ModeSwitch.apply("normal");

        const saved = JSON.parse(window.localStorage.getItem(`position_settings:${NODE}`) ?? "{}");
        expect(saved.autoAnswer).toBe(true);
    });

    it("does not write a second copy of a channel the backup restored", async () => {
        NodeBackup.capture.mockResolvedValue({
            formatVersion: 1, nodePublicKey: NODE, nodeName: "before", capturedAt: 1, settings: {},
            channels: [
                { idx: 0, name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" },
                // the same channel under another name: matching by name would miss it
                { idx: 4, name: "Testing, Emcomm", secret: "11111111111111111111111111111111" },
            ],
            contacts: [], warnings: [],
        });

        await ModeSwitch.apply("live");
        written.length = 0;
        await ModeSwitch.apply("normal");

        expect(written.filter((w) => w.secret === "11111111111111111111111111111111")).toEqual([]);
    });

    it("writes the mode's channels from slot 0 and clears the rest", async () => {
        await ModeSwitch.apply("live");
        expect(written[0]).toMatchObject({ idx: 0, name: "#Emcomm" });
        // Emcomm Testing goes with it, being an emcomm channel; Public does not
        expect(written[1]).toMatchObject({ idx: 1, name: "Emcomm Testing" });
        expect(written.slice(2).every((w) => w.secret === "cleared")).toBe(true);
        expect(written.map((w) => w.name)).not.toContain("Public");
        expect(written).toHaveLength(RADIO_SLOTS);
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
        // every channel is answered, so what the mode carries is whether the
        // operator is asked first — and a live incident does not ask
        expect(PositionService.settings(NODE)).toEqual({ autoAnswer: true });
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
        // a drill announces to its neighbours; only a live incident is worth a
        // flood, which every repeater that hears it rebroadcasts
        const result = await ModeSwitch.apply("training");
        expect(EmcommMode.announce).toHaveBeenCalledWith(false);
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
        expect(written).toHaveLength(RADIO_SLOTS);
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
        expect(text).toContain("Contacts not heard in 90 days are dropped");
        expect(written).toEqual([]);
        expect(Connection.setAdvertName).not.toHaveBeenCalled();
    });

    it("says what happens to the channels it is not keeping, not just that they go", async () => {
        // it used to read "Any other channel is cleared from the radio", which is
        // true of the slots and wrong about the consequence: an emcomm channel is
        // carried over, and anything else is kept in the mode being left with its
        // key. An operator reading the old line would reasonably not switch at all
        GlobalState.channels = [
            { idx: 0, name: "Public", secret: new Uint8Array(16) },
            { idx: 3, name: "Emcomm Testing", secret: new Uint8Array(16).fill(1) },
            { idx: 4, name: "County Tac", secret: new Uint8Array(16).fill(2) },
        ];

        const text = (await ModeSwitch.describe("live")).changes.join(" ");

        expect(text).toContain("Emcomm Testing is an emcomm channel, so it is carried over as well");
        expect(text).toMatch(/Public, County Tac leave the radio's slots but are kept in Normal mode, with their keys/);
        expect(text).not.toContain("Any other channel is cleared");
    });

    it("does not bring a mode's own channel back into normal mode", async () => {
        // it did, because the carry rule is "any channel with emcomm in its name".
        // #Emcomm-Training is part of the training mode rather than a channel the
        // operator built, so normal comes back as the radio was
        ModeProfiles.saveProfile("training", await ModeProfiles.defaultEmcommProfile("training", NODE), NODE);
        ModeProfiles.setCurrent("training", NODE);
        Connection.getChannel.mockImplementation(async (idx) => answerFor({
            0: { name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" },
            1: { name: "#Emcomm-Training", secret: "cd".repeat(16) },
            2: { name: "Emcomm Testing", secret: "ef".repeat(16) },
        }, idx));

        await ModeSwitch.apply("normal");

        const normal = ModeProfiles.profile("normal", NODE);
        const names = normal.channels.map((c) => c.name);
        expect(names).not.toContain("#Emcomm-Training");
        // the net's own emcomm channel is still carried, which is the whole point
        // of the rule
        expect(names).toContain("Emcomm Testing");
        // and the training mode keeps its channel for next time
        expect(ModeProfiles.profile("training", NODE).channels.map((c) => c.name)).toContain("#Emcomm-Training");
    });

    it("keeps a live incident channel out of a drill, and the other way round", async () => {
        ModeProfiles.setCurrent("live", NODE);
        expect(ModeProfiles.carriesInto("#Emcomm", "training")).toBe(false);
        expect(ModeProfiles.carriesInto("#Emcomm-Training", "live")).toBe(false);
        // each into its own mode, and a channel the operator made either way
        expect(ModeProfiles.carriesInto("#Emcomm", "live")).toBe(true);
        expect(ModeProfiles.carriesInto("#Emcomm-Training", "training")).toBe(true);
        expect(ModeProfiles.carriesInto("Emcomm Testing", "normal")).toBe(true);
        expect(ModeProfiles.carriesInto("Public", "normal")).toBe(false);
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

    it("keeps a favourite whatever its age, and anything heard lately", async () => {
        const longAgo = Math.floor(Date.now() / 1000) - 400 * 24 * 60 * 60;
        GlobalState.contacts = [
            contact(1),                                                                   // companion, heard now
            contact(2, { favourite: true }),                                              // starred
            contact(3, { type: Constants.AdvType.Repeater, lastAdvert: longAgo }),        // quiet, unstarred
            contact(4, { type: Constants.AdvType.Repeater, lastAdvert: longAgo, favourite: true }),
            contact(5, { type: Constants.AdvType.Room, lastAdvert: longAgo, favourite: true }),
            contact(6, { lastAdvert: longAgo }),                                          // companion, quiet
        ];

        await ModeSwitch.apply("live");

        // the two quiet unstarred ones, and nothing else: a companion heard now
        // stays, where it used to be cleared for being a companion
        expect(removed.sort()).toEqual(["03", "06"]);
    });

    it("keeps a channel the new mode does not hold, rather than losing its key", async () => {
        // a private channel made during an incident: its key is on the radio and
        // nowhere else, so clearing the slot would destroy it
        Connection.getChannel.mockImplementation(async (idx) => answerFor({
            0: { name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" },
            1: { name: "County Tac", secret: "ab".repeat(16) },
        }, idx));
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

    it("leaves the slots exactly as they are if the channels could not be read first", async () => {
        // it used to write the mode's channels anyway and warn that a channel in
        // no mode "may have been lost". Clearing a slot this app never read
        // destroys the key of whatever was in it, and a private channel's key is
        // on the radio and nowhere else, so now nothing is written at all
        Connection.getChannel.mockRejectedValue(new Error("the radio did not answer"));
        GlobalState.contacts = [];

        const result = await ModeSwitch.apply("live");

        expect(written).toEqual([]);
        expect(result.warnings.join(" ")).toContain("left exactly as they are");
        expect(result.warnings.join(" ")).toContain("would destroy the key");
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
            expect(classes).not.toMatch(/\bh-16\b/);
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
        // describing a switch reads the radio's channels, which is a chain of
        // awaits rather than one: a single flush drained it most of the time and
        // not always, which is a flake in the test and not in the dialog
        const deadline = Date.now() + 5000;
        while(Date.now() < deadline && !wrapper.text().includes("Channels become: #Emcomm")){
            await flushPromises();
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
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

        // pressing Switch must never accept an incomplete way home: the button
        // used to hand its own click event through as that flag, which is truthy
        expect(apply).toHaveBeenCalledWith("live", expect.any(Function), { acceptIncompleteBackup: false });
        expect(wrapper.text()).toContain("This station is now in Emcomm-Live");
        expect(wrapper.text()).toContain("3 contact(s) removed");
    });

    it("stops and asks when the way home would be incomplete, and writes nothing", async () => {
        // node 2's read was 13 contacts short on the bench and the switch was held
        // back by hand. Those contacts would not have come back on the way home,
        // because the backup is taken once and never again while away from normal
        const refusal = new Error(`${ModeSwitch.INCOMPLETE_BACKUP}: 13 of 186 contacts could not be read`);
        refusal.incompleteBackup = true;
        refusal.shortfall = "13 of 186 contacts could not be read";
        const apply = vi.spyOn(ModeSwitch, "apply")
            .mockRejectedValueOnce(refusal)
            .mockResolvedValue({ mode: "live", from: "normal", failures: [], warnings: [] });

        const wrapper = mount(ModeSwitchDialog, { props: { open: true } });
        await flushPromises();
        wrapper.vm.chosen = "live";
        await flushPromises();

        await wrapper.findAll("button").find((b) => b.text().includes("Switch to Emcomm-Live")).trigger("click");
        await flushPromises();

        expect(wrapper.text()).toContain("Nothing has been changed");
        expect(wrapper.text()).toContain("13 of 186 contacts could not be read");
        expect(wrapper.text()).not.toContain("This station is now in");

        // and going ahead is a second, deliberate press
        const anyway = wrapper.findAll("button").find((b) => b.text().includes("Switch anyway"));
        expect(anyway).toBeTruthy();
        await anyway.trigger("click");
        await flushPromises();

        expect(apply).toHaveBeenLastCalledWith("live", expect.any(Function), { acceptIncompleteBackup: true });
        expect(wrapper.text()).toContain("This station is now in Emcomm-Live");
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

    // A tab reads the radio for a mode it has never shown, through a dynamic
    // import, so how many turns of the loop that takes is not fixed: wait for the
    // fields themselves rather than guessing a number of ticks.
    //
    // flushPromises alone drains microtasks, and a module still loading needs real
    // time, which is why this waits on the clock too. Under the whole suite, with
    // 45 files loading at once, the microtask-only version failed about one run in
    // ten and the audit reported it as a broken test.
    async function open(wrapper, mode) {
        await tab(wrapper, mode).trigger("click");
        const deadline = Date.now() + 5000;
        while(Date.now() < deadline){
            await flushPromises();
            if(wrapper.vm.profile != null && wrapper.text().includes("Frequency (kHz)")){
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(wrapper.vm.profile).not.toBe(null);
        expect(wrapper.text()).toContain("Frequency (kHz)");
    }

    it("has a tab for each mode, showing the same fields for each", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        for(const mode of MODES){
            await open(wrapper, mode);
            for(const label of ["Node name", "Frequency (kHz)", "Transmit power (dBm)", "Channels", "Zero hop", "Flood"]){
                expect(wrapper.text()).toContain(label);
            }
        }
    });

    // The operator's case: a station in a drill setting up what it comes home to.
    // Editing normal mode has to work from inside another mode, and take effect
    // when the station goes back rather than at once.
    it("edits a mode the station is not in, and changes nothing until it is entered", async () => {
        ModeProfiles.setCurrent("training", NODE);
        const setTxPower = vi.spyOn(Connection, "setTxPower").mockResolvedValue(undefined);
        const setRadioParams = vi.spyOn(Connection, "setRadioParams").mockResolvedValue(undefined);
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();

        await open(wrapper, "normal");
        wrapper.vm.profile.radio.txPower = 17;
        wrapper.vm.profile.adverts.zeroHopMinutes = 45;
        wrapper.vm.save();
        await flushPromises();

        // saved where the switch home will read it
        const saved = ModeProfiles.profile("normal", NODE);
        expect(saved.radio.txPower).toBe(17);
        expect(saved.adverts.zeroHopMinutes).toBe(45);

        // and the radio, which is in another mode, was not touched
        expect(setTxPower).not.toHaveBeenCalled();
        expect(setRadioParams).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain("Normal mode saved");
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

        wrapper.vm.newChannelName = "County Tac";
        await wrapper.vm.addChannel();
        const named = wrapper.vm.profile.channels.find((c) => c.name === "County Tac");
        expect(named.secret).toHaveLength(32);
        expect(named.secret).not.toBe(added.secret);
    });

    it("saves a mode", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "live");

        wrapper.vm.profile.adverts.zeroHopMinutes = 45;
        wrapper.vm.save();
        await flushPromises();

        expect(ModeProfiles.profile("live", NODE).adverts.zeroHopMinutes).toBe(45);
        expect(wrapper.text()).toContain("Emcomm-Live saved");
    });

    // Every room this radio is in answers a roll call, so a list of which ones a
    // mode "uses" named them and did nothing else. What replaced it manages the
    // room contacts themselves, which is the thing an operator could not do.
    // A mode is a long form and an operator comes to it for one thing, so it
    // opens as a list of headings and nothing else.
    it("folds every heading, and opens none of them", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "live");

        // a heading button reads as its title and its note run together
        const fold = (heading) => wrapper.findAll("button[aria-expanded]").find((b) => b.text().startsWith(heading));
        // Operator sits under Radio: the person at the radio, then who it knows,
        // then what it can hear
        const headings = ["Radio", "Operator", "Companions", "Repeaters", "Channels", "Rooms", "Also"];
        for(const heading of headings){
            const found = fold(heading);
            expect(found, heading).not.toBe(undefined);
            expect(found.attributes("aria-expanded"), heading).toBe("false");
        }

        await fold("Also").trigger("click");
        expect(fold("Also").attributes("aria-expanded")).toBe("true");
    });

    it("puts every tick under Also, not among the radio's numbers", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "live");

        const also = wrapper.findAll("button[aria-expanded]").find((b) => b.text().startsWith("Also"));
        const panel = also.element.parentElement.querySelector("div");
        // the four radio ones, the mode's own, and what entering it does
        const ticks = panel.querySelectorAll("input[type=checkbox]");
        expect(ticks.length).toBe(10);

        // and none is left beside the frequency and power fields
        const radio = wrapper.findAll("button[aria-expanded]").find((b) => b.text().startsWith("Radio"));
        expect(radio.element.parentElement.querySelectorAll("input[type=checkbox]").length).toBe(0);
    });

    it("offers the radio's contacts in every mode, saying they are not the mode's", async () => {
        for(const mode of MODES){
            const wrapper = mount(ModeSettingsTabs);
            await flushPromises();
            await open(wrapper, mode);

            const headings = wrapper.findAll("button[aria-expanded]").map((b) => b.text());
            for(const kind of ["Companions", "Repeaters", "Rooms"]){
                expect(headings.some((h) => h.startsWith(kind)), `${mode}: ${kind}`).toBe(true);
            }
            expect(wrapper.text()).toContain("Not part of a mode");
        }
    });

    it("edits a channel, and a # rename takes the new name's key", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "live");

        wrapper.vm.startEditChannel(0);
        wrapper.vm.editChannelName = "#Emcomm-Training";
        await wrapper.vm.saveChannel(0);

        const expected = Utils.bytesToHex(await EmcommMode.hashtagChannelKey("#Emcomm-Training"));
        expect(wrapper.vm.profile.channels[0]).toEqual({ name: "#Emcomm-Training", secret: expected });
        expect(wrapper.vm.editingChannel).toBe(null);
    });

    it("will not save a private channel with a key that is not a key", async () => {
        // the radio does not refuse a short key, it simply hears nothing, which is
        // the worst way to find out
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "live");

        wrapper.vm.startEditChannel(0);
        wrapper.vm.editChannelName = "County Tac";
        wrapper.vm.editChannelSecret = "abcd";
        await flushPromises();
        expect(wrapper.vm.canSaveChannel).toBe(false);

        wrapper.vm.editChannelSecret = "ab".repeat(16);
        await flushPromises();
        expect(wrapper.vm.canSaveChannel).toBe(true);
    });

    // Reading a mode reads the radio, so a tab switch used to throw away whatever
    // had been typed into the tab being left, without saying so.
    it("keeps what was typed into a tab that is left without saving", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "live");

        wrapper.vm.profile.radio.txPower = 17;
        expect(wrapper.vm.unsaved).toBe(true);
        await flushPromises();
        expect(wrapper.text()).toContain("Not saved yet");

        await open(wrapper, "training");
        expect(wrapper.vm.profile.radio.txPower).not.toBe(17);

        await open(wrapper, "live");
        expect(wrapper.vm.profile.radio.txPower).toBe(17);
        // and still nothing written down until Save
        expect(ModeProfiles.profile("live", NODE).radio.txPower).not.toBe(17);
    });

    it("stops calling a tab unsaved once it is saved", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "live");

        wrapper.vm.profile.radio.txPower = 19;
        await wrapper.vm.save();
        await flushPromises();

        expect(wrapper.vm.unsaved).toBe(false);
        expect(wrapper.text()).not.toContain("Not saved yet");
    });

    it("keeps no list of rooms a mode uses", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "live");

        wrapper.vm.save();
        await flushPromises();

        expect(ModeProfiles.profile("live", NODE).rooms).toBeUndefined();
        expect(wrapper.text()).not.toContain("which of them this mode uses");
    });

    // Saving the mode the station is in used to be a promise about later, like
    // saving any other mode: the operator raised the power, saved, and the radio
    // went on at the old power until they switched away and back. That is why the
    // page carried a second copy of every one of these fields.
    it("writes the mode in use to the radio when it is saved", async () => {
        const applied = vi.spyOn(ModeSwitch, "applySettings").mockResolvedValue({ failures: [] });
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "normal");

        wrapper.vm.profile.radio.txPower = 22;
        await wrapper.vm.save();

        expect(applied).toHaveBeenCalledWith("normal");
        expect(ModeProfiles.profile("normal", NODE).radio.txPower).toBe(22);
        expect(wrapper.text()).toContain("written to the radio");
    });

    it("leaves the radio alone when the mode saved is not the one in use", async () => {
        const applied = vi.spyOn(ModeSwitch, "applySettings").mockResolvedValue({ failures: [] });
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "live");

        wrapper.vm.profile.radio.txPower = 22;
        await wrapper.vm.save();

        expect(applied).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain("when this station enters that mode");
    });

    it("keeps the operator's work when the radio will not take it", async () => {
        vi.spyOn(ModeSwitch, "applySettings").mockRejectedValue(new Error("timed out"));
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "normal");

        wrapper.vm.profile.radio.txPower = 22;
        await wrapper.vm.save();

        // the profile is written before the radio is touched, so a silent radio
        // does not cost the operator what they just typed
        expect(ModeProfiles.profile("normal", NODE).radio.txPower).toBe(22);
        expect(wrapper.text()).toContain("could not be written to the radio");
    });

    it("says that channels wait for a switch, since writing them clears slots", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "normal");
        expect(wrapper.text()).toContain("Channels are written when a mode is entered");
    });

    // It had a section of its own, with a button that acted at once. It is a tick
    // in Also now, because it is a mode setting like the others and saving the
    // mode in use writes it — but it is the one tick with a consequence while the
    // app is shut, so the explanation came with it.
    it("carries the tick that answers from the radio itself, and says what it means", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "normal");

        expect(wrapper.text()).toContain("Answer from the radio itself");
        expect(wrapper.text()).toContain("with this app closed");
        expect(wrapper.text()).toContain("stock app");
    });

    it("writes that tick to the radio when the mode in use is saved", async () => {
        quietRadio();
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "normal");

        wrapper.vm.profile.radio.shareLocation = true;
        await wrapper.vm.save();
        await flushPromises();

        expect(EmcommMode.applyRadioPolicies).toHaveBeenCalledWith(expect.objectContaining({ shareLocation: true }));
    });

    it("explains manual and automatic answering beside its tick", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "normal");

        expect(wrapper.text()).toContain("each request asks you first");
        expect(wrapper.text()).toContain("the only choice is whether you are asked");
    });

    // DRILL marks an exercise, and a station's everyday operating is not one. A
    // tick that puts DRILL on real traffic is a way to be disbelieved when it
    // matters.
    // They were in every profile and ran on every switch with no screen offering
    // them: an operator could not see that entering a mode would move their
    // position or announce them to the whole mesh, let alone stop it.
    it("offers what entering the mode does, in every mode", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();

        for(const mode of MODES){
            await open(wrapper, mode);
            expect(wrapper.text(), mode).toContain("On entering this mode");
            expect(wrapper.text(), mode).toContain("Announce the station");
            expect(wrapper.text(), mode).toContain("Set the radio's clock from this device");
            expect(wrapper.text(), mode).toContain("Take the position from a live GPS fix");
            expect(wrapper.text(), mode).toContain("Search for repeaters in direct range");
        }
    });

    it("saves what entering the mode does, rather than losing it", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "live");

        wrapper.vm.profile.announce = "zerohop";
        wrapper.vm.profile.syncClock = false;
        wrapper.vm.profile.discoverRepeaters = false;
        await wrapper.vm.save();
        await flushPromises();

        const saved = ModeProfiles.profile("live", NODE);
        expect(saved.announce).toBe("zerohop");
        expect(saved.syncClock).toBe(false);
        expect(saved.discoverRepeaters).toBe(false);
    });

    it("does not offer the DRILL tick in normal mode", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "normal");
        expect(wrapper.text()).not.toContain("Mark everything sent DRILL");

        await open(wrapper, "training");
        expect(wrapper.text()).toContain("Mark everything sent DRILL");
    });

    it("leaves normal unmarked even if an older profile had it set", async () => {
        ModeProfiles.saveProfile("normal", {
            ...await ModeProfiles.profileOrDefault("normal", NODE),
            markDrill: true,
        }, NODE);

        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "normal");
        await wrapper.vm.save();
        await flushPromises();

        expect(ModeProfiles.profile("normal", NODE).markDrill).toBe(false);
    });

    // A mode that has been edited into a mess needs a way back that does not mean
    // remembering what it started as.
    it("can start an emcomm mode again from its defaults", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "live");

        wrapper.vm.profile.radio.txPower = 3;
        wrapper.vm.profile.channels = [];
        await wrapper.vm.resetToDefault();
        await flushPromises();

        expect(wrapper.vm.profile.radio.txPower).toBe(22);
        expect(wrapper.vm.profile.channels.map((c) => c.name)).toEqual(["#Emcomm"]);
        expect(wrapper.vm.profile.autoAnswerPositions).toBe(true);
    });

    it("shows the defaults without writing them down or sending them", async () => {
        const applied = vi.spyOn(ModeSwitch, "applySettings").mockResolvedValue({ failures: [] });
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "live");

        // put the saved mode somewhere the defaults are not, so the reset has
        // something to undo
        wrapper.vm.profile.radio.txPower = 3;
        await wrapper.vm.save();
        await flushPromises();
        expect(ModeProfiles.profile("live", NODE).radio.txPower).toBe(3);

        await wrapper.vm.resetToDefault();
        await flushPromises();

        // on screen, not written down
        expect(wrapper.vm.profile.radio.txPower).toBe(22);
        expect(ModeProfiles.profile("live", NODE).radio.txPower).toBe(3);
        expect(applied).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain("until you press Save");
        // and the operator can see it is not saved yet
        expect(wrapper.vm.unsaved).toBe(true);
    });

    // The editing lives in Settings; a mode tab only offers to load, because a tab
    // is about one station and a net default is about the net.
    it("offers the net default on an emcomm mode and never on normal", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();

        const offered = () => wrapper.findAll("button").some((b) => b.text().startsWith("Load the net default"));

        // there is always one: the operator's, or the settings the app ships with
        await open(wrapper, "live");
        expect(offered()).toBe(true);

        await open(wrapper, "normal");
        expect(offered()).toBe(false);
    });

    it("loads it while keeping the station's own name and ceiling", async () => {
        NetDefaults.save("live", {
            ...ModeProfiles.blank(),
            radio: { name: "SOMEONE ELSE", txPower: null, radioFreq: 915000, radioBw: 250000, radioSf: 10, radioCr: 5 },
            channels: [{ name: "#Emcomm", secret: "22".repeat(16) }],
        });

        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "live");
        await wrapper.vm.loadNetDefault();
        await flushPromises();

        expect(wrapper.vm.profile.radio.radioFreq).toBe(915000);
        // this station stays itself: its own name, and as high as its radio goes
        expect(wrapper.vm.profile.radio.name).not.toBe("SOMEONE ELSE");
        expect(wrapper.vm.profile.radio.txPower).toBe(22);
        // and nothing is written down until Save
        expect(ModeProfiles.profile("live", NODE).radio.radioFreq).not.toBe(915000);
        expect(wrapper.text()).toContain("until you press Save");
    });

    it("offers no such button for normal mode, which has no default", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();

        await open(wrapper, "live");
        expect(wrapper.findAll("button").some((b) => b.text().startsWith("Start "))).toBe(true);

        await open(wrapper, "normal");
        expect(wrapper.findAll("button").some((b) => b.text().startsWith("Start "))).toBe(false);
    });

    it("has no Save of its own, and says where the one Save is", async () => {
        // two Save buttons on one page is one too many: the operator who pressed
        // the wrong one saved half of what they had changed
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await open(wrapper, "normal");

        expect(wrapper.findAll("button").some((b) => b.text().startsWith("Save "))).toBe(false);
        expect(wrapper.text()).toContain("at the top of the page, saves this tab");
    });

});

// Writing the settings of the mode the station is already in. Not a switch:
// there is nothing to back up, nothing to restore, and the channels are already
// the ones this mode named.
describe("saving the mode in use", () => {

    beforeEach(async () => {
        window.localStorage.clear();
        connect();
        radioChannels({ 0: { name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" } });
        quietRadio();
        await ModeProfiles.captureNormal(NODE);
        ModeProfiles.saveProfile("normal", {
            ...await ModeProfiles.profileOrDefault("normal", NODE),
            radio: { name: "Joe-KJ5HBN-HTv3", radioFreq: 906875, radioBw: 250000, radioSf: 10, radioCr: 5,
                     txPower: 22, shareLocation: true, advertPosition: true, multiAcks: false, autoAddContacts: false },
        }, NODE);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    it("writes the radio's settings, and reads them back", async () => {
        const result = await ModeSwitch.applySettings("normal");

        expect(result.failures).toEqual([]);
        expect(Connection.setTxPower).toHaveBeenCalledWith(22);
        expect(Connection.setRadioParams).toHaveBeenCalledWith(906875, 250000, 10, 5);
        expect(Connection.setAdvertName).toHaveBeenCalledWith("Joe-KJ5HBN-HTv3");
        expect(EmcommMode.applyRadioPolicies).toHaveBeenCalledWith({ shareLocation: true, advertPosition: true, multiAcks: false });
        expect(EmcommMode.setManualAddContacts).toHaveBeenCalledWith(true);
        // the radio owns what it holds, so the page is shown what it says
        expect(Connection.loadSelfInfo).toHaveBeenCalled();
    });

    it("does not touch the channels, which is what a switch is for", async () => {
        // writing them means clearing every slot the mode does not name, and a
        // private channel's key is on the radio and nowhere else
        await ModeSwitch.applySettings("normal");
        expect(Connection.setChannel).not.toHaveBeenCalled();
        expect(Connection.deleteChannel).not.toHaveBeenCalled();
    });

    it("takes no backup and restores nothing: the station is not going anywhere", async () => {
        const captured = vi.spyOn(NodeBackup, "capture");
        const restored = vi.spyOn(NodeBackup, "restore");
        await ModeSwitch.applySettings("normal");
        expect(captured).not.toHaveBeenCalled();
        expect(restored).not.toHaveBeenCalled();
    });

    it("reports what the radio would not take, rather than claiming it worked", async () => {
        Connection.setTxPower.mockRejectedValue(new Error("timed out"));
        const result = await ModeSwitch.applySettings("normal");
        expect(result.failures.map((f) => f.what)).toContain("transmit power");
    });

    it("refuses with no radio connected", async () => {
        GlobalState.connection = null;
        await expect(ModeSwitch.applySettings("normal")).rejects.toThrow();
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

describe("marking a message DRILL", () => {

    const NODE = "aa".repeat(32);

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.selfInfo = { publicKey: new Uint8Array(32).fill(0xaa) };
    });

    afterEach(() => {
        window.localStorage.clear();
        GlobalState.selfInfo = null;
    });

    function inMode(mode, markDrill) {
        ModeProfiles.saveProfile(mode, { ...ModeProfiles.blank(), markDrill }, NODE);
        ModeProfiles.setCurrent(mode, NODE);
    }

    it("marks traffic in a mode that says to", () => {
        inMode("training", true);
        expect(ModeProfiles.markText("SAG needed at mile 4")).toBe("DRILL SAG needed at mile 4");
    });

    it("leaves traffic alone in a mode that does not", () => {
        inMode("live", false);
        expect(ModeProfiles.markText("SAG needed at mile 4")).toBe("SAG needed at mile 4");
    });

    it("does not mark a message the operator has already marked", () => {
        // it read "DRILL DRILL SAG needed" on the bench, which is a stutter, not a
        // marking, and six wasted characters of a 160 byte message
        inMode("training", true);
        expect(ModeProfiles.markText("DRILL SAG needed")).toBe("DRILL SAG needed");
        expect(ModeProfiles.markText("drill: net secure")).toBe("drill: net secure");
        expect(ModeProfiles.markText("This is a DRILL")).toBe("This is a DRILL");
    });

    it("still marks a message that merely contains the letters", () => {
        inMode("training", true);
        expect(ModeProfiles.markText("Need a drillbit at the aid station"))
            .toBe("DRILL Need a drillbit at the aid station");
    });

    it("leaves an empty message as it is, so nothing is sent as a bare DRILL", () => {
        inMode("training", true);
        expect(ModeProfiles.markText("")).toBe("");
        expect(ModeProfiles.markText(null)).toBe(null);
    });

});

// Coming home without two of everything.
//
// Node 2's eight channels sat at slots 0, 1, 4, 7, 8, 10, 11 and 13. A round trip
// through Emcomm-Training brought them home as twelve occupied slots, with
// #elp-mesh, #joebot, #silvercity and #elp-test each in two places: the switch
// wrote the Normal profile's list from slot 0, and then the backup restore wrote
// the same channels back at the slots it had recorded.
describe("the channels on the way home", () => {

    const NODE_KEY = new Uint8Array(32).fill(0x39);
    const NODE_HEX = Array.from(NODE_KEY).map((b) => b.toString(16).padStart(2, "0")).join("");

    let written;

    beforeEach(async () => {
        window.localStorage.clear();
        connect();
        written = radioChannels({
            0: { name: "#Emcomm-Training", secret: "aa".repeat(16) },
            1: { name: "Emcomm Testing", secret: "11".repeat(16) },
        });
        quietRadio();
        vi.spyOn(NodeBackup, "restore").mockResolvedValue({ failures: [], notInBackup: [] });

        // the way home, with the slots the channels came from
        NodeBackup.save({
            formatVersion: 1, nodePublicKey: NODE_HEX, nodeName: "KJ5HBN-EMCOMM", capturedAt: 1,
            settings: {}, contacts: [], warnings: [],
            channels: [
                { idx: 0, name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" },
                { idx: 4, name: "#elp-mesh", secret: "cc".repeat(16) },
                { idx: 13, name: "Emcomm Testing", secret: "11".repeat(16) },
            ],
        }, NodeBackup.SLOT_PRE_EMCOMM);

        ModeProfiles.saveProfile("normal", {
            ...ModeProfiles.blank(),
            radio: { name: "KJ5HBN-EMCOMM" },
            channels: [
                { name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72", answerPositions: false },
                { name: "#elp-mesh", secret: "cc".repeat(16), answerPositions: false },
                { name: "Emcomm Testing", secret: "11".repeat(16), answerPositions: true },
            ],
        }, NODE_HEX);
        ModeProfiles.setCurrent("training", NODE_HEX);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    it("leaves the channels to the backup, which knows the slot each was in", async () => {
        await ModeSwitch.apply("normal");

        // nothing written into a slot by the switch itself: every write is a clear
        expect(written.filter((w) => w.name !== "").map((w) => w.name)).toEqual([]);
        expect(written.filter((w) => w.name === "")).toHaveLength(RADIO_SLOTS);
        expect(NodeBackup.restore).toHaveBeenCalledTimes(1);
    });

    it("still writes the profile's channels when the backup holds none", async () => {
        // an older backup, or one taken from a radio that would not answer
        const backup = NodeBackup.load(NODE_HEX, NodeBackup.SLOT_PRE_EMCOMM);
        NodeBackup.save({ ...backup, channels: [] }, NodeBackup.SLOT_PRE_EMCOMM);

        await ModeSwitch.apply("normal");

        expect(written.filter((w) => w.name !== "").map((w) => w.name))
            .toEqual(["Public", "#elp-mesh", "Emcomm Testing"]);
    });

    it("leaves nothing to carry from slot to slot", async () => {
        await ModeSwitch.apply("normal");

        // every channel is answered wherever it lands, so the only thing the
        // switch writes is the mode's auto or manual choice. The list this used to
        // keep caused three separate faults in one evening: a tick left on the
        // channel that used to be in that slot, a tick lost when a channel came
        // home to a different one, and the backup's own copy overwriting the right
        // answer with an old one.
        const settings = JSON.parse(window.localStorage.getItem(`position_settings:${NODE_HEX}`));
        expect(Object.keys(settings)).toEqual(["autoAnswer"]);
    });

});

// Whether the operator is asked before their position goes out.
//
// This used to be a list of ticked channels and rooms as well, kept against slot
// numbers, and dragged from slot to slot on every mode switch. Three faults in
// one evening came from that dragging. Every channel and room is answered now, so
// the only choice left is auto or manual — and it still has to survive a switch,
// which is what this block is about.
describe("remembering whether to answer automatically", () => {

    const NODE_KEY = new Uint8Array(32).fill(0x39);
    const NODE_HEX = Array.from(NODE_KEY).map((b) => b.toString(16).padStart(2, "0")).join("");

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.selfInfo = { name: "KJ5HBN-EMCOMM", publicKey: NODE_KEY };
        GlobalState.channels = [
            { idx: 0, name: "Public", secret: new Uint8Array(16) },
            { idx: 13, name: "Emcomm Testing", secret: new Uint8Array(16).fill(1) },
        ];
        ModeProfiles.saveProfile("normal", {
            ...ModeProfiles.blank(),
            channels: [
                { name: "Public", secret: "00".repeat(16) },
                { name: "Emcomm Testing", secret: "01".repeat(16) },
            ],
        }, NODE_HEX);
        ModeProfiles.setCurrent("normal", NODE_HEX);
    });

    afterEach(() => {
        window.localStorage.clear();
        GlobalState.selfInfo = null;
        GlobalState.channels = [];
        GlobalState.contacts = [];
    });

    it("writes the choice into the mode in use", async () => {
        ModeProfiles.noteAnswerChoices({ autoAnswer: true }, NODE_HEX);
        expect(ModeProfiles.profile("normal", NODE_HEX).autoAnswerPositions).toBe(true);

        ModeProfiles.noteAnswerChoices({ autoAnswer: false }, NODE_HEX);
        expect(ModeProfiles.profile("normal", NODE_HEX).autoAnswerPositions).toBe(false);
    });

    it("leaves a mode with nothing stored alone, since a switch would not overwrite it", async () => {
        ModeProfiles.setCurrent("live", NODE_HEX);
        expect(ModeProfiles.noteAnswerChoices({ autoAnswer: true }, NODE_HEX)).toBe(false);
        expect(ModeProfiles.profile("live", NODE_HEX)).toBe(null);
    });

    it("keeps no list of channels or rooms to answer on", async () => {
        ModeProfiles.noteAnswerChoices({ autoAnswer: true }, NODE_HEX);
        const saved = JSON.parse(window.localStorage.getItem(`position_settings:${NODE_HEX}`) ?? "{}");
        expect(saved.markedChannels).toBeUndefined();
        expect(saved.markedRooms).toBeUndefined();
    });

});

// A way home that fails after the slots were cleared.
//
// Giving the backup the channels means the switch clears every slot and leaves
// the writing to the restore. That is right when the restore runs — it knows
// which slot each channel was in — but the restore is a few hundred radio writes
// over Bluetooth, and a radio that drops in the middle used to leave the node
// holding no channels at all: deaf on every channel until somebody noticed.
describe("when the way home cannot write", () => {

    const NODE_KEY = new Uint8Array(32).fill(0x39);
    const NODE_HEX = Array.from(NODE_KEY).map((b) => b.toString(16).padStart(2, "0")).join("");

    let written;

    beforeEach(() => {
        window.localStorage.clear();
        connect();
        written = radioChannels({
            0: { name: "#Emcomm-Training", secret: "aa".repeat(16) },
            1: { name: "Emcomm Testing", secret: "11".repeat(16) },
        });
        quietRadio();

        NodeBackup.save({
            formatVersion: 1, nodePublicKey: NODE_HEX, nodeName: "KJ5HBN-EMCOMM", capturedAt: 1,
            settings: {}, contacts: [], warnings: [],
            channels: [
                { idx: 0, name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" },
                { idx: 9, name: "#elp-mesh", secret: "cc".repeat(16) },
            ],
        }, NodeBackup.SLOT_PRE_EMCOMM);

        ModeProfiles.saveProfile("normal", {
            ...ModeProfiles.blank(),
            radio: { name: "KJ5HBN-EMCOMM" },
            channels: [
                { name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72", answerPositions: false },
                { name: "#elp-mesh", secret: "cc".repeat(16), answerPositions: false },
            ],
        }, NODE_HEX);
        ModeProfiles.setCurrent("training", NODE_HEX);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    it("puts the channels back from the mode's own list rather than leaving none", async () => {
        vi.spyOn(NodeBackup, "restore").mockRejectedValue(new Error("disconnected"));

        const result = await ModeSwitch.apply("normal");

        // the profile's own two, plus Emcomm Testing, which the carry rule had
        // already added to normal mode because it was on the radio and its name
        // says emcomm
        const names = written.filter((w) => w.name !== "").map((w) => w.name);
        expect(names).toEqual(["Public", "#elp-mesh", "Emcomm Testing"]);
        expect(result.failures.some((f) => f.what === "the backup")).toBe(true);
        expect(result.warnings.join(" ")).toContain("put back from this mode's own list");
    });

    it("says the slots may not be the ones they were in, because only the backup knew", async () => {
        vi.spyOn(NodeBackup, "restore").mockRejectedValue(new Error("disconnected"));

        const result = await ModeSwitch.apply("normal");

        expect(result.warnings.join(" ")).toMatch(/may not be in the slots they were in/);
    });

    it("still reaches normal mode, so the operator is not stuck between two", async () => {
        vi.spyOn(NodeBackup, "restore").mockRejectedValue(new Error("disconnected"));

        await ModeSwitch.apply("normal");

        expect(ModeProfiles.current(NODE_HEX)).toBe("normal");
    });

});

// A refusal belongs to the mode it was about to switch to.
//
// The incomplete-backup block and its "Switch anyway, without a complete way
// home" button stayed on screen when the operator changed their mind about which
// mode to enter, so consent given about one mode would have carried into a switch
// to another.
describe("the refusal does not follow the operator to another mode", () => {

    let apply;

    beforeEach(async () => {
        window.localStorage.clear();
        connect();
        radioChannels({ 0: { name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" } });
        quietRadio();
        await ModeProfiles.captureNormal(NODE);

        const refusal = new Error(`${ModeSwitch.INCOMPLETE_BACKUP}: 13 of 186 contacts could not be read`);
        refusal.incompleteBackup = true;
        refusal.shortfall = "13 of 186 contacts could not be read";
        apply = vi.spyOn(ModeSwitch, "apply").mockRejectedValue(refusal);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    it("clears the refusal when the chosen mode changes", async () => {
        const wrapper = mount(ModeSwitchDialog, { props: { open: true } });
        await flushPromises();
        wrapper.vm.chosen = "live";
        await flushPromises();

        await wrapper.findAll("button").find((b) => b.text().includes("Switch to Emcomm-Live")).trigger("click");
        await flushPromises();
        expect(wrapper.text()).toContain("Nothing has been changed");

        // changes their mind
        wrapper.vm.chosen = "training";
        await flushPromises();

        expect(wrapper.text()).not.toContain("Nothing has been changed");
        expect(wrapper.findAll("button").some((b) => b.text().includes("Switch anyway"))).toBe(false);
    });

});

// A station left in a mode, on a computer that has never seen it at home.
//
// Found on a second computer with node 1 left in Emcomm-Training. The connect
// dialog asked, the operator said it was in a drill, and the app promised to
// record nothing. Then the settings page and the setup wizard each filled their
// Normal tab by asking for "normal, or a default" — which read the radio as it
// stood, which was the drill, and saved it as this station's home. A later trip
// home would have written a drill to the radio and cleared the real channels.
describe("normal mode on a station that is not at home", () => {

    beforeEach(() => {
        window.localStorage.clear();
        connect();
        radioChannels({ 0: { name: "#Emcomm-Training", secret: "11".repeat(16) } });
        quietRadio();
        ModeProfiles.setCurrent("training", NODE);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    it("is not invented from the radio, and nothing is written down", async () => {
        expect(await ModeProfiles.profileOrDefault("normal", NODE)).toBe(null);
        expect(ModeProfiles.profile("normal", NODE)).toBe(null);
        expect(ModeProfiles.normalUnknown(NODE)).toBe(true);
    });

    it("is read from the radio as usual when the station is in normal mode", async () => {
        ModeProfiles.setCurrent("normal", NODE);
        const profile = await ModeProfiles.profileOrDefault("normal", NODE);
        expect(profile).not.toBe(null);
        expect(ModeProfiles.profile("normal", NODE)).not.toBe(null);
        expect(ModeProfiles.normalUnknown(NODE)).toBe(false);
    });

    it("says so on the Normal tab, with nothing to save", async () => {
        const tabButton = (wrapper, mode) => wrapper.findAll("button").find((b) => b.text().includes(MODE_LABELS[mode]));
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();
        await tabButton(wrapper, "normal").trigger("click");
        await flushPromises();

        expect(wrapper.text()).toContain("no record of this station's normal settings");
        expect(wrapper.text()).not.toContain("Transmit power (dBm)");
        // and looking at it wrote nothing
        expect(ModeProfiles.profile("normal", NODE)).toBe(null);

        // saving cannot reach the radio either
        await wrapper.vm.save();
        expect(ModeProfiles.profile("normal", NODE)).toBe(null);
    });

    // Caught by the test above, not by looking: reading a mode reads the radio's
    // channel slots, and a tab tapped while that runs used to get the first
    // mode's profile when the slow read came back.
    it("does not let a slow read land on a tab the operator has left", async () => {
        const wrapper = mount(ModeSettingsTabs);
        await flushPromises();

        // training is on show and reading; the operator taps Normal, which has
        // nothing to show at all
        const tabButton = (mode) => wrapper.findAll("button").find((b) => b.text().includes(MODE_LABELS[mode]));
        await tabButton("normal").trigger("click");
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 50));
        await flushPromises();

        expect(wrapper.vm.tab).toBe("normal");
        expect(wrapper.vm.profile).toBe(null);
        expect(wrapper.text()).toContain("no record of this station's normal settings");
    });

    it("refuses to go home when there is no backup either", async () => {
        await expect(ModeSwitch.apply("normal")).rejects.toThrow("no record of this station's normal settings");
        // and nothing was written on the way to refusing
        expect(Connection.setChannel).not.toHaveBeenCalled();
        expect(Connection.setTxPower).not.toHaveBeenCalled();
    });

    it("goes home from the backup, writing nothing of its own", async () => {
        NodeBackup.save({
            nodePublicKey: NODE,
            channels: [{ name: "Public", secret: "8b3387e9c5cdea6ac9e5edbaa115cd72" }],
            contacts: [],
            settings: {},
            takenAt: new Date().toISOString(),
        }, NodeBackup.SLOT_PRE_EMCOMM);
        vi.spyOn(NodeBackup, "restore").mockResolvedValue({ failures: [], added: 0, warnings: [] });

        const result = await ModeSwitch.apply("normal");

        expect(NodeBackup.restore).toHaveBeenCalled();
        // the drill's settings are not written as home
        expect(Connection.setTxPower).not.toHaveBeenCalled();
        expect(Connection.setAdvertName).not.toHaveBeenCalled();
        expect(EmcommMode.applyRadioPolicies).not.toHaveBeenCalled();
        expect(result.mode).toBe("normal");
    });

    it("says what a trip home would do, rather than describing invented settings", async () => {
        const blocked = await ModeSwitch.describe("normal", NODE);
        expect(blocked.profile).toBe(null);
        expect(blocked.blocked).toContain("no record");

        NodeBackup.save({ nodePublicKey: NODE, channels: [], contacts: [], settings: {}, takenAt: new Date().toISOString() }, NodeBackup.SLOT_PRE_EMCOMM);
        const fromBackup = await ModeSwitch.describe("normal", NODE);
        expect(fromBackup.blocked).toBe(undefined);
        expect(fromBackup.changes.join(" ")).toContain("from the backup");
    });

});
