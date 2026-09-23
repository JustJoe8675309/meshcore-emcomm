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

        expect(await EmcommMode.ensureHashtagChannel("#Emcomm")).toMatchObject({ idx: 2, added: true, keyMatches: true });
        expect(set.mock.calls[0][0]).toBe(2);
        expect(set.mock.calls[0][1]).toBe("#Emcomm");
        expect(Utils.bytesToHex(set.mock.calls[0][2])).toBe(Utils.bytesToHex(await EmcommMode.hashtagChannelKey("#Emcomm")));
    });

    // a radio holding the channel exactly as it should be
    async function radioWith(slots) {
        const secrets = {};
        for(const [idx, name] of Object.entries(slots)){
            secrets[idx] = name.startsWith("#") ? await EmcommMode.hashtagChannelKey(name) : new Uint8Array(16).fill(7);
        }
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => {
            if(!(idx in slots)) throw new Error("no such channel");
            return { channelIdx: Number(idx), name: slots[idx], secret: secrets[idx] };
        });
        return vi.spyOn(Connection, "setChannel").mockResolvedValue(undefined);
    }

    it("leaves it alone when the radio already has it, with the right key", async () => {
        const set = await radioWith({ 0: "Public", 3: "#Emcomm" });
        expect(await EmcommMode.ensureHashtagChannel("#Emcomm")).toMatchObject({ idx: 3, added: false, keyMatches: true, spelling: "same" });
        expect(set).not.toHaveBeenCalled();
    });

    it("treats a different spelling as the same channel rather than adding a second", async () => {
        // #emcomm and #Emcomm have different keys, so two would be two channels
        // that cannot hear each other
        const set = await radioWith({ 0: "Public", 2: "#emcomm" });
        const result = await EmcommMode.ensureHashtagChannel("#Emcomm");
        expect(result).toMatchObject({ idx: 2, added: false, name: "#emcomm", spelling: "different case" });
        // its key is right for the name the radio holds, but not for the one asked for
        expect(result.keyMatches).toBe(true);
        expect(result.keyIsForAskedName).toBe(false);
        expect(set).not.toHaveBeenCalled();
    });

    it("says when a channel of that name carries a key not worked out from it", async () => {
        // a private channel someone named #Emcomm: the operator would look like
        // they were on the net while nobody could hear them
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => {
            if(idx !== 1) throw new Error("no such channel");
            return { channelIdx: 1, name: "#Emcomm", secret: new Uint8Array(16).fill(0xAB) };
        });
        const set = vi.spyOn(Connection, "setChannel").mockResolvedValue(undefined);
        expect(await EmcommMode.ensureHashtagChannel("#Emcomm")).toMatchObject({ idx: 1, added: false, keyMatches: false });
        // never overwritten: that would cut off whoever is using it
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
        expect(await EmcommMode.ensureHashtagChannel("#Emcomm")).toMatchObject({ idx: 2, added: true, keyMatches: true });
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
        // contact 1 is a companion heard just now, so the age keeps it as well
        expect(plan.remove.map((c) => c.advName)).toEqual(["Contact 3"]);
        expect(plan.keptFavourites).toBe(3);
    });

    it("keeps a companion nobody starred, if it has been heard", () => {
        // companions used to go regardless of age. One rule for every kind now, so
        // a person heard this morning stays whether or not anyone starred them
        const plan = EmcommMode.planTrim([contact(1), contact(2), contact(3)], now);
        expect(plan.remove).toHaveLength(0);
        expect(plan.keptFavourites).toBe(0);
    });

    it("removes a companion nobody starred that has been quiet for months", () => {
        const quiet = now - 200 * 24 * 60 * 60;
        const plan = EmcommMode.planTrim([
            contact(1, { lastAdvert: quiet }),
            contact(2, { lastAdvert: quiet, favourite: true }),
        ], now);
        expect(plan.remove.map((c) => c.advName)).toEqual(["Contact 1"]);
        expect(plan.keptFavourites).toBe(1);
    });

});


