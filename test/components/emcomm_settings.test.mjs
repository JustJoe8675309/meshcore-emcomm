// The settings EMCOMM mode forces beyond the first version: extra delivery
// acknowledgements, the position in every advert, keeping favourite contacts,
// the net's hashtag channel, answering position requests on it, repeating
// adverts, and who the operator is.
//
// All of them are radio or per node settings, so the backup taken before the
// mode carries them and leaving puts them back.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Constants } from "@liamcottle/meshcore.js";
import Connection from "../../src/js/Connection.js";
import EmcommMode from "../../src/js/EmcommMode.js";
import AdvertSchedule from "../../src/js/AdvertSchedule.js";
import PositionService from "../../src/js/position/PositionService.js";
import OperatorSettings from "../../src/js/reports/OperatorSettings.js";
import ContactFlags from "../../src/js/ContactFlags.js";
import GlobalState from "../../src/js/GlobalState.js";
import Utils from "../../src/js/Utils.js";
import SettingsPage from "../../src/components/pages/SettingsPage.vue";
import EmcommConvertDialog from "../../src/components/settings/EmcommConvertDialog.vue";

const KEY = new Uint8Array(32).fill(0x39);
const NODE = Utils.bytesToHex(KEY);

// multi acks off, no position in adverts, telemetry denied
const RESERVED = new Uint8Array([0, 0, 0]);

function selfInfo(overrides = {}) {
    return {
        name: "Joe-KJ5HBN-HTv3", publicKey: KEY, radioFreq: 910525, radioBw: 62500, radioSf: 7, radioCr: 5,
        txPower: 20, maxTxPower: 22, advLat: 0, advLon: 0, manualAddContacts: 1,
        reserved: RESERVED, ...overrides,
    };
}

function contact(n, { type = Constants.AdvType.Chat, favourite = false, lastAdvert = Math.floor(Date.now() / 1000) } = {}) {
    const publicKey = new Uint8Array(32);
    publicKey[0] = n;
    return { publicKey, type, flags: favourite ? ContactFlags.FAVOURITE_BIT : 0, advName: `Contact ${n}`, lastAdvert, outPathLen: 0, outPath: new Uint8Array(64), advLat: 0, advLon: 0 };
}

describe("the net's hashtag channel", () => {

    it("derives the key the way every client does, matching the protocol document", async () => {
        // the document gives #test as 9cd8fcf22a47333b591d96a2b848b73f
        const key = await EmcommMode.hashtagChannelKey("#test");
        expect(Utils.bytesToHex(key)).toBe("9cd8fcf22a47333b591d96a2b848b73f");
        // the # is added when it is left off, so both spellings give one channel
        expect(Utils.bytesToHex(await EmcommMode.hashtagChannelKey("test"))).toBe("9cd8fcf22a47333b591d96a2b848b73f");
        expect(key).toHaveLength(16);
    });

    it("defaults to #Emcomm", () => {
        expect(EmcommMode.EMCOMM_CHANNEL_NAME).toBe("#Emcomm");
    });

    beforeEach(() => {
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = selfInfo();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
    });

    it("goes in the first free slot", async () => {
        const slots = { 0: "Public", 1: "Emcomm Testing", 2: "" };
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => {
            if(!(idx in slots)) throw new Error("no such channel");
            return { channelIdx: idx, name: slots[idx], secret: new Uint8Array(16) };
        });
        const set = vi.spyOn(Connection, "setChannel").mockResolvedValue(undefined);

        expect(await EmcommMode.ensureHashtagChannel("#Emcomm")).toEqual({ idx: 2, added: true });
        expect(set.mock.calls[0][0]).toBe(2);
        expect(set.mock.calls[0][1]).toBe("#Emcomm");
        expect(Utils.bytesToHex(set.mock.calls[0][2])).toBe(Utils.bytesToHex(await EmcommMode.hashtagChannelKey("#Emcomm")));
    });

    it("leaves it alone when the radio already has it", async () => {
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => {
            const slots = { 0: "Public", 3: "#Emcomm" };
            if(!(idx in slots)) throw new Error("no such channel");
            return { channelIdx: idx, name: slots[idx], secret: new Uint8Array(16) };
        });
        const set = vi.spyOn(Connection, "setChannel").mockResolvedValue(undefined);
        expect(await EmcommMode.ensureHashtagChannel("#Emcomm")).toEqual({ idx: 3, added: false });
        expect(set).not.toHaveBeenCalled();
    });

    it("says so rather than overwriting when every slot is taken", async () => {
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => ({ channelIdx: idx, name: `Channel ${idx}`, secret: new Uint8Array(16) }));
        const set = vi.spyOn(Connection, "setChannel").mockResolvedValue(undefined);
        expect(await EmcommMode.ensureHashtagChannel("#Emcomm")).toBe(null);
        expect(set).not.toHaveBeenCalled();
    });

    it("never takes a slot it could not read, which may hold a channel", async () => {
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => {
            if(idx === 1) throw new Error("unreadable");
            if(idx === 2) return { channelIdx: 2, name: "", secret: new Uint8Array(16) };
            return { channelIdx: idx, name: `Channel ${idx}`, secret: new Uint8Array(16) };
        });
        vi.spyOn(Connection, "setChannel").mockResolvedValue(undefined);
        expect(await EmcommMode.ensureHashtagChannel("#Emcomm")).toEqual({ idx: 2, added: true });
    });

});

describe("the radio's emcomm settings, in one command", () => {

    beforeEach(() => {
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = selfInfo();
        vi.spyOn(Connection, "loadSelfInfo").mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
    });

    it("turns on sharing, the position in adverts and extra acknowledgements together", async () => {
        const write = vi.spyOn(Connection, "setAllOtherParams").mockResolvedValue(undefined);
        await EmcommMode.applyRadioPolicies({ shareLocation: true, advertPosition: true, multiAcks: true });
        expect(write).toHaveBeenCalledTimes(1);
        const params = write.mock.calls[0][0];
        expect(params.advertLocPolicy).toBe(EmcommMode.ADVERT_LOC_SHARE);
        expect(params.multiAcks).toBe(1);
        // base and location both set to anyone, which is what sharing means
        expect(EmcommMode.telemetryModes(params.telemetryModes)).toMatchObject({ base: 2, location: 2 });
    });

    it("turns them off again when they are unticked", async () => {
        const write = vi.spyOn(Connection, "setAllOtherParams").mockResolvedValue(undefined);
        await EmcommMode.applyRadioPolicies({ shareLocation: false, advertPosition: false, multiAcks: false });
        const params = write.mock.calls[0][0];
        expect(params.advertLocPolicy).toBe(EmcommMode.ADVERT_LOC_NONE);
        expect(params.multiAcks).toBe(0);
        expect(EmcommMode.telemetryModes(params.telemetryModes)).toMatchObject({ base: 0, location: 0 });
    });

    it("leaves a setting exactly as it was when it is not named", async () => {
        GlobalState.selfInfo = selfInfo({ reserved: new Uint8Array([3, 1, 0b01_10_10]) });
        const write = vi.spyOn(Connection, "setAllOtherParams").mockResolvedValue(undefined);
        await EmcommMode.applyRadioPolicies({ multiAcks: true });
        const params = write.mock.calls[0][0];
        expect(params.advertLocPolicy).toBe(1);
        expect(params.telemetryModes).toBe(0b01_10_10);
        expect(params.multiAcks).toBe(1);
    });

    it("keeps the environment sensor permission alone while changing location", async () => {
        GlobalState.selfInfo = selfInfo({ reserved: new Uint8Array([0, 0, 0b01_00_00]) });
        const write = vi.spyOn(Connection, "setAllOtherParams").mockResolvedValue(undefined);
        await EmcommMode.applyRadioPolicies({ shareLocation: true });
        expect(EmcommMode.telemetryModes(write.mock.calls[0][0].telemetryModes).environment).toBe(1);
    });

    it("reads back what the radio holds", () => {
        GlobalState.selfInfo = selfInfo({ reserved: new Uint8Array([1, 1, 0]) });
        expect(EmcommMode.advertsCarryPosition()).toBe(true);
        expect(EmcommMode.multiAcksOn()).toBe(true);
        GlobalState.selfInfo = selfInfo({ reserved: new Uint8Array([0, 0, 0]) });
        expect(EmcommMode.advertsCarryPosition()).toBe(false);
        expect(EmcommMode.multiAcksOn()).toBe(false);
    });

});

describe("the trim, with favourites", () => {

    const now = Math.floor(Date.now() / 1000);
    const longAgo = now - 200 * 24 * 60 * 60;

    it("keeps a starred contact of any type or age: those are the ones that matter", () => {
        const plan = EmcommMode.planTrim([
            contact(1),
            contact(2, { favourite: true }),
            contact(3, { type: Constants.AdvType.Repeater, lastAdvert: longAgo }),
            contact(4, { type: Constants.AdvType.Repeater, lastAdvert: longAgo, favourite: true }),
            contact(5, { type: Constants.AdvType.Room, lastAdvert: longAgo, favourite: true }),
        ], now);
        expect(plan.remove.map((c) => c.advName)).toEqual(["Contact 1", "Contact 3"]);
        expect(plan.keptFavourites).toBe(3);
    });

    it("still removes every companion that is not starred", () => {
        const plan = EmcommMode.planTrim([contact(1), contact(2), contact(3)], now);
        expect(plan.remove).toHaveLength(3);
        expect(plan.keptFavourites).toBe(0);
    });

});

describe("what the convert dialog asks for", () => {

    function mountDialog() {
        return mount(EmcommConvertDialog, {
            props: {
                plan: { remove: [], keep: [], keptForUnreadableAge: 0, keptFavourites: 0, counts: { companions: 0, repeaters: 0, rooms: 0 } },
                current: selfInfo(),
            },
        });
    }

    beforeEach(() => {
        window.localStorage.clear();
        OperatorSettings.setCallsign("KJ5HBN");
        OperatorSettings.setDtgZone("local");
    });

    afterEach(() => {
        OperatorSettings.setCallsign("");
        window.localStorage.clear();
    });

    it("defaults to the emcomm settings, with the position in adverts and acknowledgements on", async () => {
        const wrapper = mountDialog();
        await wrapper.findAll("button").find((b) => b.text() === "Convert").trigger("click");
        expect(wrapper.emitted("confirm")[0][0]).toMatchObject({
            advertPosition: true,
            multiAcks: true,
            channelName: "#Emcomm",
            answerPositionsOnChannel: true,
            autoAnswerPositions: false,
            advertSchedule: { zeroHopMinutes: 30, floodMinutes: 60 },
            callsign: "KJ5HBN",
            dtgZone: "local",
        });
    });

    it("lets each of them be changed", async () => {
        const wrapper = mountDialog();
        wrapper.vm.advertPosition = false;
        wrapper.vm.addChannel = false;
        wrapper.vm.autoAnswerPositions = true;
        wrapper.vm.zeroHopMinutes = 45;
        wrapper.vm.floodMinutes = 0;
        wrapper.vm.dtgZone = "zulu";
        await flushPromises();
        await wrapper.findAll("button").find((b) => b.text() === "Convert").trigger("click");
        expect(wrapper.emitted("confirm")[0][0]).toMatchObject({
            advertPosition: false,
            channelName: null,
            answerPositionsOnChannel: false,
            autoAnswerPositions: true,
            advertSchedule: { zeroHopMinutes: 45, floodMinutes: 0 },
            dtgZone: "zulu",
        });
    });

    it("turns repeating adverts off altogether when unticked", async () => {
        const wrapper = mountDialog();
        wrapper.vm.repeatAdverts = false;
        await flushPromises();
        await wrapper.findAll("button").find((b) => b.text() === "Convert").trigger("click");
        expect(wrapper.emitted("confirm")[0][0].advertSchedule).toBe(null);
    });

});

describe("converting applies them", () => {

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

    const choices = (overrides = {}) => ({
        name: null, radio: null, txPower: null, syncClock: false, setPositionFromGps: false,
        advert: "none", discover: false, autoAddContacts: false, shareLocation: true,
        advertPosition: true, multiAcks: true, channelName: "#Emcomm", answerPositionsOnChannel: true,
        autoAnswerPositions: false, advertSchedule: { zeroHopMinutes: 30, floodMinutes: 60 },
        callsign: "KJ5HBN", dtgZone: "zulu", ...overrides,
    });

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = selfInfo();
        GlobalState.contacts = [];
        GlobalState.channels = [];
        vi.spyOn(Connection, "loadSelfInfo").mockResolvedValue(undefined);
        vi.spyOn(Connection, "loadChannels").mockResolvedValue(undefined);
        vi.spyOn(Connection, "deviceQuery").mockResolvedValue(null);
        vi.spyOn(EmcommMode, "applySettings").mockResolvedValue({ failures: [] });
        vi.spyOn(EmcommMode, "trim").mockResolvedValue({ removed: 0, notRemoved: [] });
        vi.spyOn(EmcommMode, "announce").mockResolvedValue(undefined);
        vi.spyOn(EmcommMode, "applyRadioPolicies").mockResolvedValue(undefined);
        vi.spyOn(EmcommMode, "ensureHashtagChannel").mockResolvedValue({ idx: 4, added: true });
        vi.spyOn(AdvertSchedule, "start").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        OperatorSettings.setCallsign("");
        window.localStorage.clear();
    });

    async function convert(overrides = {}) {
        const wrapper = mountPage();
        await flushPromises();
        wrapper.vm.convertPlan = { remove: [], keep: [], keptForUnreadableAge: 0 };
        await wrapper.vm.runConvert(choices(overrides));
        return wrapper;
    }

    it("adds the channel and ticks it for position requests", async () => {
        await convert();
        expect(EmcommMode.ensureHashtagChannel).toHaveBeenCalledWith("#Emcomm");
        expect(PositionService.settings(NODE).markedChannels).toEqual([4]);
        expect(PositionService.settings(NODE).autoAnswer).toBe(false);
    });

    it("keeps the channels already ticked", async () => {
        PositionService.saveSettings({ markedChannels: [7], markedRooms: [], autoAnswer: false }, NODE);
        await convert();
        expect(PositionService.settings(NODE).markedChannels).toEqual([4, 7]);
    });

    it("says so when the channel was already there, or there was no room for it", async () => {
        EmcommMode.ensureHashtagChannel.mockResolvedValue({ idx: 3, added: false });
        let wrapper = await convert();
        expect(wrapper.vm.backupWarnings.join(" ")).toContain("already on the radio, in slot 3");

        EmcommMode.ensureHashtagChannel.mockResolvedValue(null);
        wrapper = await convert();
        expect(wrapper.vm.backupWarnings.join(" ")).toContain("No free channel slot");
    });

    it("sets the repeating adverts and starts them", async () => {
        await convert();
        expect(AdvertSchedule.get(NODE)).toEqual({ zeroHopMinutes: 30, floodMinutes: 60 });
        expect(AdvertSchedule.start).toHaveBeenCalledWith(NODE);
    });

    it("leaves the advert schedule alone when it was unticked", async () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: 0, floodMinutes: 0 });
        await convert({ advertSchedule: null });
        expect(AdvertSchedule.get(NODE)).toEqual({ zeroHopMinutes: 0, floodMinutes: 0 });
        expect(AdvertSchedule.start).not.toHaveBeenCalled();
    });

    it("records the operator's callsign and the net's time zone", async () => {
        await convert();
        expect(OperatorSettings.callsign).toBe("KJ5HBN");
        expect(OperatorSettings.state.dtgZone).toBe("zulu");
    });

    it("turns answering automatically on when that was chosen", async () => {
        await convert({ autoAnswerPositions: true });
        expect(PositionService.settings(NODE).autoAnswer).toBe(true);
    });

    it("carries on when the channel cannot be added", async () => {
        EmcommMode.ensureHashtagChannel.mockRejectedValue(new Error("the radio refused it"));
        const wrapper = await convert();
        expect(wrapper.vm.backupWarnings.join(" ")).toContain("#Emcomm was not added: the radio refused it");
        expect(wrapper.vm.backupError).toBe(null);
    });

});
