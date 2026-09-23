// The walk through a station's three modes, once.
//
// An operator setting up at a muster point has no time to discover that each mode
// holds its own node name, and one who has never opened the settings tabs would
// enter Emcomm-Live with whatever the defaults happened to be. This asks once, in
// the order the modes matter.
//
// It edits the mode profiles and writes nothing to the radio: entering a mode is
// what writes it, with its own confirmation. That is worth testing rather than
// assuming, because "set the node name" reads like "rename my radio".

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FirstRunSetup, { FirstRunSetup as FirstRun } from "../../src/components/modes/FirstRunSetup.vue";
import Header from "../../src/components/Header.vue";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import ModeProfiles from "../../src/js/modes/ModeProfiles.js";
import Utils from "../../src/js/Utils.js";

const KEY = new Uint8Array(32).fill(0x39);
const NODE = Utils.bytesToHex(KEY);
const SELF_INFO = {
    name: "Joe-KJ5HBN-HTv3", publicKey: KEY, radioFreq: 910525, radioBw: 62.5, radioSf: 7,
    radioCr: 5, txPower: 14, maxTxPower: 22, advLat: 0, advLon: 0, manualAddContacts: 1,
    reserved: [0, 40, 0],
};

function connect() {
    GlobalState.connection = { on() {}, off() {}, close() {} };
    GlobalState.selfInfo = SELF_INFO;
    GlobalState.channels = [{ idx: 0, name: "Public", secret: new Uint8Array(16) }];
    GlobalState.contacts = [];
}

// a radio that answers channel reads, so a mode profile can be read for a step
function quietRadio() {
    vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => (
        idx >= 40 ? Promise.reject(new Error("no such slot")) : {
            channelIdx: idx, name: idx === 0 ? "Public" : "", secret: new Uint8Array(16),
        }
    ));
    vi.spyOn(Connection, "setChannel").mockResolvedValue(undefined);
    vi.spyOn(Connection, "deleteChannel").mockResolvedValue(undefined);
    vi.spyOn(Connection, "setAdvertName").mockResolvedValue(undefined);
    vi.spyOn(Connection, "setRadioParams").mockResolvedValue(undefined);
    vi.spyOn(Connection, "setTxPower").mockResolvedValue(undefined);
}

function mountWizard() {
    return mount(FirstRunSetup, {
        props: { open: true },
        global: { stubs: { ModeSettingsTabs: { props: ["only"], template: "<div class='mode-form'>{{ only }}</div>" } } },
    });
}

const buttonSaying = (wrapper, text) => wrapper.findAll("button").find((b) => b.text().trim() === text);
const shownMode = (wrapper) => wrapper.find(".mode-form").exists() ? wrapper.find(".mode-form").text() : null;

describe("the first run walkthrough", () => {

    beforeEach(() => {
        window.localStorage.clear();
        connect();
        quietRadio();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        GlobalState.channels = [];
    });

    it("opens on what this is, and says the radio is not being written to", () => {
        const wrapper = mountWizard();
        expect(wrapper.text()).toContain("Set up this station");
        expect(wrapper.text()).toContain("Nothing here is written to the radio");
        expect(shownMode(wrapper)).toBe(null);
    });

    it("walks the modes in the order they matter", async () => {
        const wrapper = mountWizard();

        await buttonSaying(wrapper, "Start").trigger("click");
        expect(shownMode(wrapper)).toBe("normal");

        await buttonSaying(wrapper, "Next").trigger("click");
        expect(shownMode(wrapper)).toBe("training");

        await buttonSaying(wrapper, "Next").trigger("click");
        expect(shownMode(wrapper)).toBe("live");

        await buttonSaying(wrapper, "Next").trigger("click");
        expect(shownMode(wrapper)).toBe(null);
        expect(wrapper.text()).toContain("Set up");
    });

    it("says what each mode is for, in the operator's terms", async () => {
        const wrapper = mountWizard();
        await buttonSaying(wrapper, "Start").trigger("click");
        expect(wrapper.text()).toContain("The radio as this app first read it");

        await buttonSaying(wrapper, "Next").trigger("click");
        expect(wrapper.text()).toContain("marked DRILL");

        await buttonSaying(wrapper, "Next").trigger("click");
        expect(wrapper.text()).toContain("A real incident");
    });

    it("goes back without losing its place", async () => {
        const wrapper = mountWizard();
        await buttonSaying(wrapper, "Start").trigger("click");
        await buttonSaying(wrapper, "Next").trigger("click");
        expect(shownMode(wrapper)).toBe("training");

        await buttonSaying(wrapper, "Back").trigger("click");
        expect(shownMode(wrapper)).toBe("normal");
    });

    it("names the radio's own name at the end, so nobody thinks it was renamed", async () => {
        const wrapper = mountWizard();
        for(const label of ["Start", "Next", "Next", "Next"]){
            await buttonSaying(wrapper, label).trigger("click");
        }
        expect(wrapper.text()).toContain("Joe-KJ5HBN-HTv3");
        expect(wrapper.text()).toContain("Entering a mode writes that mode's name");
    });

    it("writes nothing to the radio, whichever way it is left", async () => {
        const wrapper = mountWizard();
        for(const label of ["Start", "Next", "Next", "Next", "Close"]){
            const button = buttonSaying(wrapper, label);
            if(button){
                await button.trigger("click");
            }
        }
        expect(Connection.setAdvertName).not.toHaveBeenCalled();
        expect(Connection.setRadioParams).not.toHaveBeenCalled();
        expect(Connection.setChannel).not.toHaveBeenCalled();
        expect(Connection.deleteChannel).not.toHaveBeenCalled();
    });

    it("is marked done when it is finished", async () => {
        expect(FirstRun.isDone(NODE)).toBe(false);
        const wrapper = mountWizard();
        for(const label of ["Start", "Next", "Next", "Next", "Close"]){
            const button = buttonSaying(wrapper, label);
            if(button){
                await button.trigger("click");
            }
        }
        expect(FirstRun.isDone(NODE)).toBe(true);
        expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("is marked done when it is skipped, because the operator was asked", async () => {
        const wrapper = mountWizard();
        await buttonSaying(wrapper, "Not now").trigger("click");

        expect(FirstRun.isDone(NODE)).toBe(true);
        expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("can be walked again, which is what the settings button is for", () => {
        FirstRun.markDone(NODE);
        expect(FirstRun.isDone(NODE)).toBe(true);

        FirstRun.forget(NODE);
        expect(FirstRun.isDone(NODE)).toBe(false);
    });

    it("is per station, not per browser", () => {
        const other = "aa".repeat(32);
        FirstRun.markDone(NODE);

        expect(FirstRun.isDone(NODE)).toBe(true);
        // one laptop drives several radios, and each is a station of its own
        expect(FirstRun.isDone(other)).toBe(false);
    });

    it("asks nothing of a radio that has not said who it is", () => {
        // no node key, so there is no station to ask about
        expect(FirstRun.isDone(null)).toBe(true);
        expect(FirstRun.markDone(null)).toBe(false);
    });

});

describe("when the walkthrough is offered", () => {

    // The real wizard, not a stub of it. Stubbing it here once hid a genuine
    // fault: the header had ended up with two `components` keys, the second
    // overwriting the first, so FirstRunSetup was never registered — and an
    // unregistered component renders as nothing in a production build, silently.
    // A global stub resolves an unregistered component too, so the test passed
    // while the live app showed no wizard at all. Only its innards are stubbed.
    function mountHeader() {
        return mount(Header, {
            global: {
                stubs: {
                    RouterLink: { template: "<a><slot/></a>" },
                    DropDownMenu: true,
                    DropDownMenuItem: true,
                    IconButton: true,
                    ModeBanner: true,
                    ModeSwitchDialog: true,
                    ModeSharing: true,
                    ModeSettingsTabs: { props: ["only"], template: "<div class='mode-form'>{{ only }}</div>" },
                },
            },
        });
    }

    const wizardShowing = (wrapper) => wrapper.text().includes("Set up this station");

    beforeEach(() => {
        window.localStorage.clear();
        quietRadio();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
    });

    it("is offered once the radio has said who it is", async () => {
        connect();
        const wrapper = mountHeader();
        await flushPromises();
        expect(wizardShowing(wrapper)).toBe(true);
    });

    it("is not offered to a station that has been through it", async () => {
        connect();
        FirstRun.markDone(NODE);

        const wrapper = mountHeader();
        await flushPromises();
        expect(wizardShowing(wrapper)).toBe(false);
    });

    it("waits for the radio rather than asking with no station to ask about", async () => {
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = null;

        const wrapper = mountHeader();
        await flushPromises();
        expect(wizardShowing(wrapper)).toBe(false);

        // and offers it the moment the radio answers
        GlobalState.selfInfo = SELF_INFO;
        await flushPromises();
        expect(wizardShowing(wrapper)).toBe(true);
    });

});
