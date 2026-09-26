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
import ModeSwitch from "../../src/js/modes/ModeSwitch.js";
import ModeSettingsTabs from "../../src/components/modes/ModeSettingsTabs.vue";
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
        expect(wrapper.text()).toContain("Setup wizard");
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

    const wizardShowing = (wrapper) => wrapper.text().includes("Setup wizard");

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

// What a step does with what was typed into it.
//
// Found on the bench: the editor's own Save is the one at the top of the settings
// page, and that is behind this dialog. Until Next saved the step, an operator
// walked all three modes at a muster point and kept none of it.
describe("a wizard step and the real editor", () => {

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

    /** The real editor, rather than the stub the step order tests use. */
    function mountReal() {
        return mount(FirstRunSetup, { props: { open: true } });
    }

    /** Reading a mode is a chain of channel reads, not one turn of the loop. */
    async function editorReady(wrapper) {
        const deadline = Date.now() + 5000;
        while(Date.now() < deadline){
            await flushPromises();
            const tab = wrapper.findComponent(ModeSettingsTabs);
            if(tab.exists() && tab.vm.profile != null){
                return tab;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("the mode editor never finished reading");
    }

    it("saves the step it is leaving, since Next is the only way on", async () => {
        const wrapper = mountReal();
        await buttonSaying(wrapper, "Start").trigger("click");
        const tab = await editorReady(wrapper);

        tab.vm.profile.radio.txPower = 17;
        await buttonSaying(wrapper, "Next").trigger("click");
        await flushPromises();

        expect(ModeProfiles.profile("normal", NODE).radio.txPower).toBe(17);
    });

    it("saves on the way back as well as on the way on", async () => {
        const wrapper = mountReal();
        await buttonSaying(wrapper, "Start").trigger("click");
        await editorReady(wrapper);
        await buttonSaying(wrapper, "Next").trigger("click");
        const tab = await editorReady(wrapper);

        tab.vm.profile.radio.txPower = 19;
        await buttonSaying(wrapper, "Back").trigger("click");
        await flushPromises();

        expect(ModeProfiles.profile("training", NODE).radio.txPower).toBe(19);
    });

    it("tells the operator to press Next, not a button behind the dialog", async () => {
        const wrapper = mountReal();
        await buttonSaying(wrapper, "Start").trigger("click");
        await editorReady(wrapper);

        expect(wrapper.text()).toContain("Next, below, saves this tab");
        expect(wrapper.text()).not.toContain("Save, at the top of the page");
    });

    // Its first screen promises "nothing here is written to the radio". Making
    // Next save the step broke that: a wizard walks all three modes whether or not
    // this browser has seen them, so on a fresh browser every step holds defaults
    // invented seconds earlier — and a station sitting in that mode had its real
    // settings replaced by them. Node 1 came back from another computer at the
    // default maximum power instead of the 14 dBm it had been given.
    it("keeps its promise: a step is written down, never written to the radio", async () => {
        const applied = vi.spyOn(ModeSwitch, "applySettings").mockResolvedValue({ failures: [] });
        ModeProfiles.setCurrent("normal", NODE);

        const wrapper = mountReal();
        await buttonSaying(wrapper, "Start").trigger("click");
        const tab = await editorReady(wrapper);

        // the step being left is the mode this station is in
        expect(tab.vm.tab).toBe("normal");
        tab.vm.profile.radio.txPower = 7;
        await buttonSaying(wrapper, "Next").trigger("click");
        await flushPromises();

        expect(ModeProfiles.profile("normal", NODE).radio.txPower).toBe(7);
        expect(applied).not.toHaveBeenCalled();
    });

    it("says so on the step, rather than that it writes the radio", async () => {
        ModeProfiles.setCurrent("normal", NODE);
        const wrapper = mountReal();
        await buttonSaying(wrapper, "Start").trigger("click");
        await editorReady(wrapper);

        expect(wrapper.text()).toContain("Nothing here reaches the radio");
        expect(wrapper.text()).not.toContain("saving writes these settings to the radio");
    });

    it("has no Save of its own inside the dialog", async () => {
        const wrapper = mountReal();
        await buttonSaying(wrapper, "Start").trigger("click");
        await editorReady(wrapper);

        expect(wrapper.findAll("button").some((b) => b.text().startsWith("Save "))).toBe(false);
    });

});
