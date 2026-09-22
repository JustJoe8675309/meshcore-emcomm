// Handing one station's mode to another by code.
//
// The code is a link to this app carrying the mode profile, so a phone's own
// camera opens it. What must be true: the round trip keeps the mode intact, the
// receiving station keeps its own name and contacts, hashtag keys are worked out
// rather than carried, and taking a code in never touches the radio.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Constants } from "@liamcottle/meshcore.js";
import ModeProfiles from "../../src/js/modes/ModeProfiles.js";
import ModeShare from "../../src/js/modes/ModeShare.js";
import ModeSharing from "../../src/components/modes/ModeSharing.vue";
import EmcommMode from "../../src/js/EmcommMode.js";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import Utils from "../../src/js/Utils.js";

const KEY = new Uint8Array(32).fill(0x39);
const NODE = Utils.bytesToHex(KEY);
const OTHER = Utils.bytesToHex(new Uint8Array(32).fill(0x52));

function connect() {
    GlobalState.connection = { on() {}, off() {} };
    GlobalState.selfInfo = {
        name: "Joe-KJ5HBN-HTv3", publicKey: KEY,
        radioFreq: 910525, radioBw: 62500, radioSf: 7, radioCr: 5,
        txPower: 22, maxTxPower: 22, advLat: 0, advLon: 0,
        manualAddContacts: 1, reserved: new Uint8Array([0, 0, 0]),
    };
    GlobalState.contacts = [];
    GlobalState.channels = [];
}

// a mode as a station that has been set up properly would hold it
async function aProfile({ privateChannel = true } = {}) {
    const profile = ModeProfiles.blank();
    profile.radio = {
        name: "KJ5HBN-EMCOMM", radioFreq: 910525, radioBw: 62500, radioSf: 7, radioCr: 5,
        txPower: 22, shareLocation: true, advertPosition: true, multiAcks: true, autoAddContacts: true,
    };
    profile.channels = [
        { name: "#Emcomm", secret: Utils.bytesToHex(await EmcommMode.hashtagChannelKey("#Emcomm")), answerPositions: true },
    ];
    if(privateChannel){
        profile.channels.push({ name: "County Tac", secret: "ab".repeat(16), answerPositions: false });
    }
    profile.rooms = [{ keyHex: OTHER, name: "N.E. ELP EMCOMM OBSVR", answerPositions: true }];
    profile.adverts = { zeroHopMinutes: 30, floodMinutes: 60 };
    profile.autoAnswerPositions = true;
    profile.trimContacts = true;
    profile.announce = "flood";
    profile.discoverRepeaters = true;
    return profile;
}

describe("the code", () => {

    beforeEach(() => {
        window.localStorage.clear();
        connect();
    });

    afterEach(() => {
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    it("is a link to this app, so a phone's camera opens it", async () => {
        const link = ModeShare.link(await aProfile(), "live", { origin: "https://app.meshcore-emcomm.workers.dev/" });
        expect(link.startsWith("https://app.meshcore-emcomm.workers.dev/#/mode?v=1&d=")).toBe(true);
    });

    it("carries the whole mode there and back", async () => {
        const profile = await aProfile();
        const shared = await ModeShare.read(ModeShare.link(profile, "live", { origin: "x/" }));

        expect(shared.mode).toBe("live");
        expect(shared.profile.radio).toMatchObject({
            radioFreq: 910525, radioBw: 62500, radioSf: 7, radioCr: 5, txPower: 22,
            shareLocation: true, advertPosition: true, multiAcks: true, autoAddContacts: true,
        });
        expect(shared.profile.channels).toEqual(profile.channels);
        expect(shared.profile.rooms).toEqual(profile.rooms);
        expect(shared.profile.adverts).toEqual({ zeroHopMinutes: 30, floodMinutes: 60 });
        expect(shared.profile.autoAnswerPositions).toBe(true);
        expect(shared.profile.trimContacts).toBe(true);
        expect(shared.profile.announce).toBe("flood");
        expect(shared.profile.discoverRepeaters).toBe(true);
    });

    it("never carries the node name: two stations must not answer to one", async () => {
        const shared = await ModeShare.read(ModeShare.link(await aProfile(), "live", { origin: "x/" }));
        expect(shared.profile.radio.name).toBe("");
    });

    it("carries a hashtag channel by name, and works its key out at the other end", async () => {
        const profile = await aProfile({ privateChannel: false });
        const link = ModeShare.link(profile, "live", { origin: "x/" });
        // the key is not in the code, since anyone can derive it from the name
        expect(link).not.toContain(profile.channels[0].secret.slice(0, 8));
        const shared = await ModeShare.read(link);
        expect(shared.profile.channels[0].secret).toBe(profile.channels[0].secret);
    });

    it("can leave a private channel's key out, naming it instead", async () => {
        const profile = await aProfile();
        const shared = await ModeShare.read(ModeShare.link(profile, "live", { includePrivateKeys: false, origin: "x/" }));
        expect(shared.profile.channels.map((c) => c.name)).toEqual(["#Emcomm"]);
        expect(shared.missingKeys).toEqual(["County Tac"]);
    });

    it("says who shared it, and when", async () => {
        const shared = await ModeShare.read(ModeShare.link(await aProfile(), "training", { from: "KJ5HBN", origin: "x/" }));
        expect(shared.from).toBe("KJ5HBN");
        expect(shared.at).toBeGreaterThan(Date.now() - 5000);
        expect(shared.stale).toBe(false);
    });

    it("marks a code from before today as stale rather than refusing it", async () => {
        const profile = await aProfile();
        const link = ModeShare.link(profile, "live", { origin: "x/" });
        vi.spyOn(Date, "now").mockReturnValue(new Date().getTime() + 3 * 24 * 60 * 60 * 1000);
        const shared = await ModeShare.read(link);
        expect(shared.stale).toBe(true);
        expect(shared.profile.channels).toHaveLength(2);
        Date.now.mockRestore();
    });

    it("refuses what is not one of ours, with a reason", async () => {
        await expect(ModeShare.read("")).rejects.toThrow(/empty/);
        await expect(ModeShare.read("https://example.com/hello")).rejects.toThrow(/not a station mode code/);
        await expect(ModeShare.read("#/mode?v=1&d=" + btoa('{"v":99,"m":"live"}').replace(/=+$/, ""))).rejects.toThrow(/different version/);
        await expect(ModeShare.read("#/mode?v=1&d=" + btoa('{"v":1,"m":"normal"}').replace(/=+$/, ""))).rejects.toThrow(/only the emcomm modes/);
    });

    it("reads the payload on its own, for a code pasted without its link", async () => {
        const link = ModeShare.link(await aProfile(), "live", { origin: "x/" });
        const payload = link.split("d=")[1];
        expect((await ModeShare.read(payload)).mode).toBe("live");
    });

});

describe("taking a code in", () => {

    beforeEach(() => {
        window.localStorage.clear();
        connect();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    it("saves the mode but keeps this station's own name for it", async () => {
        ModeProfiles.saveProfile("live", { ...ModeProfiles.blank(), radio: { ...ModeProfiles.blank().radio, name: "KF5XYZ-EMCOMM" } }, NODE);
        const shared = await ModeShare.read(ModeShare.link(await aProfile(), "live", { origin: "x/" }));

        const saved = ModeShare.save(shared, "live", NODE);

        expect(saved.radio.name).toBe("KF5XYZ-EMCOMM");
        expect(saved.channels.map((c) => c.name)).toEqual(["#Emcomm", "County Tac"]);
        expect(ModeProfiles.profile("live", NODE).channels).toHaveLength(2);
    });

    it("can be saved into the other emcomm mode on purpose", async () => {
        const shared = await ModeShare.read(ModeShare.link(await aProfile(), "live", { origin: "x/" }));
        ModeShare.save(shared, "training", NODE);
        expect(ModeProfiles.profile("training", NODE).channels.map((c) => c.name)).toEqual(["#Emcomm", "County Tac"]);
        // and the live mode is untouched
        expect(ModeProfiles.profile("live", NODE)).toBe(null);
    });

    it("never touches the radio or changes the mode in use", async () => {
        const write = vi.spyOn(Connection, "setChannel").mockResolvedValue(undefined);
        const settings = vi.spyOn(Connection, "setRadioParams").mockResolvedValue(undefined);
        const shared = await ModeShare.read(ModeShare.link(await aProfile(), "live", { origin: "x/" }));

        ModeShare.save(shared, "live", NODE);

        expect(write).not.toHaveBeenCalled();
        expect(settings).not.toHaveBeenCalled();
        expect(ModeProfiles.current(NODE)).toBe("normal");
    });

});

describe("the sharing screen", () => {

    beforeEach(() => {
        window.localStorage.clear();
        connect();
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => {
            if(idx !== 0) throw new Error("no such channel");
            return { channelIdx: 0, name: "Public", secret: Utils.hexToBytes("8b3387e9c5cdea6ac9e5edbaa115cd72") };
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    async function open(props = {}) {
        const wrapper = mount(ModeSharing, { props: { open: true, ...props } });
        for(let i = 0; i < 50 && wrapper.vm.link === ""; i++){
            await flushPromises();
        }
        return wrapper;
    }

    it("offers a code for each emcomm mode, and never for normal", async () => {
        const wrapper = await open();
        const buttons = wrapper.findAll("button").map((b) => b.text());
        expect(buttons).toContain("Emcomm-Training");
        expect(buttons).toContain("Emcomm-Live");
        expect(buttons).not.toContain("Normal mode");
    });

    it("draws a code for the mode chosen, and shows the link", async () => {
        const wrapper = await open();
        expect(wrapper.vm.qrCells.length).toBeGreaterThan(20);
        expect(wrapper.find("svg[role=img]").exists()).toBe(true);
        expect(wrapper.text()).toContain("#/mode?v=1&d=");
    });

    it("warns that a code carrying private keys can be photographed", async () => {
        const wrapper = await open();
        wrapper.vm.profile = await aProfile();
        await flushPromises();
        expect(wrapper.text()).toMatch(/carries the key to 1 private channel/);
        expect(wrapper.text()).toContain("Anyone who photographs it");
    });

    it("says nothing private is in a code of hashtag channels alone", async () => {
        const wrapper = await open();
        wrapper.vm.profile = await aProfile({ privateChannel: false });
        await flushPromises();
        expect(wrapper.text()).toContain("nothing private is in the code");
    });

    it("shows what a scanned code would change, and saves it without touching the radio", async () => {
        const link = ModeShare.link(await aProfile(), "live", { from: "KJ5HBN", origin: "x/" });
        const wrapper = await open({ incomingLink: link });
        await flushPromises();

        expect(wrapper.vm.view).toBe("take");
        expect(wrapper.text()).toContain("Emcomm-Live from KJ5HBN");
        expect(wrapper.text()).toContain("Channels: #Emcomm, County Tac");
        expect(wrapper.text()).toContain("keeps its own name");

        await wrapper.findAll("button").find((b) => b.text() === "Save the mode").trigger("click");
        await flushPromises();

        expect(wrapper.text()).toContain("Nothing on the radio has changed");
        expect(ModeProfiles.profile("live", NODE).channels).toHaveLength(2);
        expect(ModeProfiles.current(NODE)).toBe("normal");
    });

    it("says why a pasted code could not be read", async () => {
        const wrapper = await open();
        wrapper.vm.view = "take";
        wrapper.vm.pasted = "https://example.com/not-a-code";
        await wrapper.vm.readPasted();
        await flushPromises();
        expect(wrapper.text()).toContain("not a station mode code");
    });

});

describe("the header", () => {

    beforeEach(() => {
        window.localStorage.clear();
        connect();
    });

    afterEach(() => {
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.location.hash = "";
        window.localStorage.clear();
    });

    async function mountHeader() {
        const { default: Header } = await import("../../src/components/Header.vue");
        return mount(Header, { global: { stubs: { RouterLink: true, DropDownMenu: true, DropDownMenuItem: true, IconButton: true, ModeSwitchDialog: true, ModeBanner: true, ModeSharing: true } } });
    }

    it("has the code button beside the settings gear", async () => {
        const wrapper = await mountHeader();
        const button = wrapper.findAll("button").find((b) => b.attributes("aria-label") === "Share a station mode");
        expect(button).toBeTruthy();
        await button.trigger("click");
        expect(wrapper.vm.sharingOpen).toBe(true);
    });

    it("opens the sharing screen for a link the app was opened with, then clears it", async () => {
        window.location.hash = "#/mode?v=1&d=abc";
        const wrapper = await mountHeader();
        expect(wrapper.vm.sharingOpen).toBe(true);
        expect(wrapper.vm.incomingLink).toContain("#/mode?v=1&d=abc");
        // spent: it must not reopen on the next reload
        expect(window.location.hash).toBe("#/");
    });

});
