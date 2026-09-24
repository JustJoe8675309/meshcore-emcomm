// Handing one station's mode to another by code.
//
// The code is a link to this app carrying the mode profile, so a phone's own
// camera opens it. What must be true: the round trip keeps the mode intact, the
// receiving station keeps its own name and contacts, hashtag keys are worked out
// rather than carried, and taking a code in never touches the radio.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Constants } from "@liamcottle/meshcore.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
        { name: "#Emcomm", secret: Utils.bytesToHex(await EmcommMode.hashtagChannelKey("#Emcomm")) },
    ];
    if(privateChannel){
        profile.channels.push({ name: "County Tac", secret: "ab".repeat(16) });
    }
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
        expect(shared.profile.adverts).toEqual({ zeroHopMinutes: 30, floodMinutes: 60 });
        expect(shared.profile.autoAnswerPositions).toBe(true);
        expect(shared.profile.trimContacts).toBe(true);
        expect(shared.profile.announce).toBe("flood");
        expect(shared.profile.discoverRepeaters).toBe(true);
    });

    // Codes printed or pasted before rooms left a mode still carry "o". A net that
    // handed one out should not have to hand out a new one.
    it("still reads a code made when a mode listed rooms", async () => {
        const profile = await aProfile();
        const link = ModeShare.link(profile, "live", { origin: "x/" });
        const payload = JSON.parse(atob(decodeURIComponent(link.split("&d=")[1]).replace(/-/g, "+").replace(/_/g, "/")));
        payload.o = [{ k: OTHER, n: "N.E. ELP EMCOMM OBSVR" }];
        const older = `x/#/mode?v=1&d=${encodeURIComponent(btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""))}`;

        const shared = await ModeShare.read(older);
        expect(shared.mode).toBe("live");
        expect(shared.profile.channels).toEqual(profile.channels);
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
        // both the link and the drawn code, because the QR encoder is a dynamic
        // import of its own. Waiting on microtasks alone is not enough: a module
        // still loading needs real time, so this waits on the clock too. Flushing
        // promises a hundred times still failed about one full-suite run in three,
        // with 45 files loading at once
        // what "loaded" means depends on which view it opened in: a scanned code
        // goes straight to the take view and never builds a share link at all, so
        // waiting for one there burnt the whole test budget
        const ready = () => wrapper.vm.view === "take"
            ? wrapper.vm.incoming != null
            : wrapper.vm.link !== "" && wrapper.vm.qrCells != null;
        const deadline = Date.now() + 3000;
        while(Date.now() < deadline && !ready()){
            await flushPromises();
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return wrapper;
    }

    // the take view renders after the link is decoded, which is a dynamic import
    // away, so a fixed number of ticks is a race: the suite failed here about one
    // run in four, reading the share view's text while vm.view already said take
    async function waitForText(wrapper, text) {
        for(let i = 0; i < 50 && !wrapper.text().includes(text); i++){
            await flushPromises();
        }
        return wrapper.text();
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
        // the last line the take view renders, waited for so the three
        // assertions below are read from a finished render rather than a
        // half-finished one. Under the whole suite this raced and read the share
        // view's text while vm.view already said take
        const shown = await waitForText(wrapper, "keeps its own name");
        expect(shown).toContain("Emcomm-Live from KJ5HBN");
        expect(shown).toContain("Channels: #Emcomm, County Tac");
        expect(shown).toContain("keeps its own name");

        await wrapper.findAll("button").find((b) => b.text() === "Save the mode").trigger("click");
        await flushPromises();

        expect(await waitForText(wrapper, "Nothing on the radio has changed")).toContain("Nothing on the radio has changed");
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

    it("has a route for a scanned code to land on", async () => {
        // without one nothing matched the hash, and a scanned code opened a
        // blank app: no page, and so no header to take the link. Found by
        // opening a code in a browser rather than by any test
        const { readFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        // the test file's url is served, not a file url, so resolve from the
        // working directory the runner starts in: the repository root
        const main = readFileSync(resolve("src/main.js"), "utf8");
        expect(main).toContain("path: '/mode'");
        expect(main).toContain('name: "mode"');
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

// The way out of a dialog should not be something to scroll for.
//
// Measured in the live app at 375x812 with a 22px root font: this dialog is
// 1370px tall with a code on screen, because the QR image, the link, the key
// warning and the mode buttons all want to be visible at once. The backdrop
// scrolls, so Close was reachable — at the end of three screens of scrolling,
// which is not where an operator looks for it mid incident.
//
// Checked in the source: happy-dom applies no stylesheet and gives every box zero
// height, so a sticky footer cannot be observed by mounting.
describe("the sharing dialog on a phone", () => {

    const source = readFileSync(resolve("src/components/modes/ModeSharing.vue"), "utf8");

    it("pins Close to the bottom of the scroll", () => {
        const footer = source.match(/<div class="([^"]*)">\s*<button @click="close"/);
        expect(footer?.[1]).toContain("sticky bottom-0");
        // it overlaps what is behind it, so it needs its own background
        expect(footer?.[1]).toContain("bg-white");
    });

    it("scrolls the dialog rather than trapping it", () => {
        // the backdrop is the scroll container the footer sticks inside
        expect(source).toMatch(/fixed inset-0[^"]*overflow-y-auto/);
    });

});
