// What a net starts from, as against what a station holds.
//
// A mode profile belongs to a station: keyed by its public key, carrying its name.
// A net default is the settings a net agreed on, written once and dropped into any
// radio that turns up — so it lives in the browser, not on a node, and can be
// edited with nothing connected at all.
//
// The operator's split: editing happens in Settings, and a mode tab only offers to
// load. A mode tab is about one station; this is about the net.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import NetDefaultsGroup from "../../src/components/settings/NetDefaultsGroup.vue";
import ConnectButtons from "../../src/components/connect/ConnectButtons.vue";
import NetDefaults from "../../src/js/modes/NetDefaults.js";
import ModeProfiles from "../../src/js/modes/ModeProfiles.js";
import GlobalState from "../../src/js/GlobalState.js";
import EmcommMode from "../../src/js/EmcommMode.js";
import Utils from "../../src/js/Utils.js";

function aNetProfile(overrides = {}) {
    return {
        ...ModeProfiles.blank(),
        radio: {
            name: "SHOULD NOT BE KEPT", txPower: 22,
            radioFreq: 906875, radioBw: 250000, radioSf: 10, radioCr: 5,
            shareLocation: true, advertPosition: true, multiAcks: true, autoAddContacts: true,
        },
        channels: [{ name: "#Emcomm", secret: "11".repeat(16) }],
        autoAnswerPositions: true,
        adverts: { zeroHopMinutes: 30, floodMinutes: 60 },
        announce: "flood",
        trimContacts: true,
        ...overrides,
    };
}

describe("a net default", () => {

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
    });

    afterEach(() => {
        window.localStorage.clear();
        vi.restoreAllMocks();
    });

    it("is kept per browser, not per node, so no radio is needed", () => {
        expect(NetDefaults.hasAny()).toBe(false);
        expect(NetDefaults.save("live", aNetProfile())).toBe(true);
        expect(NetDefaults.has("live")).toBe(true);
        expect(NetDefaults.has("training")).toBe(false);
    });

    it("keeps no node name, whatever it was given", () => {
        NetDefaults.save("live", aNetProfile());
        const stored = NetDefaults.get("live");

        // two stations answering to one name is the fault mode sharing refuses
        expect(stored.radio.name).toBeUndefined();
        // and what a net does agree on is there
        expect(stored.radio.radioFreq).toBe(906875);
        expect(stored.channels[0].name).toBe("#Emcomm");
    });

    // A net of handhelds and base nodes does not share a ceiling, so the usual
    // answer is "as high as each one goes" — but a net with a reason to name a
    // number can name one.
    it("keeps a power the net named, and null for as high as each radio goes", () => {
        NetDefaults.save("live", aNetProfile({ radio: { ...aNetProfile().radio, txPower: 17 } }));
        expect(NetDefaults.get("live").radio.txPower).toBe(17);

        NetDefaults.save("live", aNetProfile({ radio: { ...aNetProfile().radio, txPower: null } }));
        expect(NetDefaults.get("live").radio.txPower).toBe(null);
    });

    it("is not offered for normal mode, which no net can decide", () => {
        expect(NetDefaults.applies("normal")).toBe(false);
        expect(NetDefaults.save("normal", aNetProfile())).toBe(false);
        expect(NetDefaults.get("normal")).toBe(null);
    });

    it("fills out into a station, keeping that station's name and ceiling", async () => {
        NetDefaults.save("live", aNetProfile({ radio: { ...aNetProfile().radio, txPower: null } }));

        const filled = await NetDefaults.forStation("live", { name: "KJ5HBN-EMCOMM", maxTxPower: 17 });

        expect(filled.radio.name).toBe("KJ5HBN-EMCOMM");
        // the net named no number, so this radio's own ceiling
        expect(filled.radio.txPower).toBe(17);
        expect(filled.radio.radioFreq).toBe(906875);
        expect(filled.autoAnswerPositions).toBe(true);
        expect(filled.channels.map((c) => c.name)).toEqual(["#Emcomm"]);
    });

    // A fresh install is not empty: it ships with MeshCore's published USA and
    // Canada settings, the only preset it publishes, so nobody types the same
    // four numbers to get started.
    it("ships with the USA settings until somebody writes their own", async () => {
        expect(NetDefaults.has("training")).toBe(false);

        const shipped = await NetDefaults.forStation("training", { name: "A station", maxTxPower: 17 });
        expect(shipped.radio).toMatchObject({ radioFreq: 910525, radioBw: 62500, radioSf: 7, radioCr: 5 });
        expect(shipped.radio.name).toBe("A station");
        expect(shipped.radio.txPower).toBe(17);
        expect(shipped.channels.map((c) => c.name)).toEqual(["#Emcomm-Training"]);
        expect(shipped.markDrill).toBe(true);
    });

    it("prefers the operator's own once there is one", async () => {
        NetDefaults.save("training", aNetProfile({ radio: { radioFreq: 869525, radioBw: 250000, radioSf: 10, radioCr: 5 } }));
        const mine = await NetDefaults.forStation("training", {});
        expect(mine.radio.radioFreq).toBe(869525);
    });

    it("has nothing at all for normal mode", async () => {
        expect(await NetDefaults.forStation("normal", {})).toBe(null);
    });

    it("can be forgotten, and says stations keep what they have", () => {
        NetDefaults.save("live", aNetProfile());
        NetDefaults.clear("live");
        expect(NetDefaults.has("live")).toBe(false);
    });

});

describe("the net defaults editor", () => {

    beforeEach(() => {
        window.localStorage.clear();
        // the case that matters: no radio at all
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
    });

    afterEach(() => {
        window.localStorage.clear();
        vi.restoreAllMocks();
    });

    // Filling the editor works out a channel key and, when a radio is there,
    // reads it: a chain of awaits rather than one turn of the loop.
    const open = async () => {
        const wrapper = mount(NetDefaultsGroup);
        await wrapper.find("button[aria-expanded]").trigger("click");
        const deadline = Date.now() + 5000;
        while(Date.now() < deadline && wrapper.vm.draft == null){
            await flushPromises();
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return wrapper;
    };

    it("opens and edits with no radio connected", async () => {
        const wrapper = await open();

        expect(wrapper.text()).not.toContain("No radio connected");
        expect(wrapper.vm.draft).not.toBe(null);
        expect(wrapper.text()).toContain("Frequency (kHz)");
    });

    // It handed back a blank form when no radio was connected — every tick off,
    // no channel, adverts at zero — because the whole default was built from a
    // station. Only four of its fields actually need one.
    it("starts from the settings the app ships with, filled in", async () => {
        const wrapper = await open();

        expect(wrapper.vm.draft.channels.map((c) => c.name)).toEqual(["#Emcomm"]);
        expect(wrapper.vm.draft.radio.shareLocation).toBe(true);
        expect(wrapper.vm.draft.radio.multiAcks).toBe(true);
        expect(wrapper.vm.draft.autoAnswerPositions).toBe(true);
        expect(wrapper.vm.draft.adverts).toEqual({ zeroHopMinutes: 30, floodMinutes: 60 });
        expect(wrapper.vm.draft.announce).toBe("flood");

        // and the four numbers nobody should have to type: MeshCore's published
        // USA and Canada preset. It handed back a blank form once.
        expect(wrapper.vm.draft.radio).toMatchObject({ radioFreq: 910525, radioBw: 62500, radioSf: 7, radioCr: 5 });
        expect(wrapper.text()).toContain("what the app ships with");
    });

    it("offers no node name, and says why", async () => {
        const wrapper = await open();

        expect(wrapper.text()).not.toContain("Node name");
        expect(wrapper.text()).toContain("two would answer to one");
    });

    it("offers a power the net can name, or each radio's own ceiling", async () => {
        const wrapper = await open();

        expect(wrapper.text()).toContain("Transmit power");
        expect(wrapper.text()).toContain("As high as each radio goes");
        expect(wrapper.vm.draft.radio.txPower).toBe(null);

        wrapper.vm.setFixedPower();
        expect(wrapper.vm.draft.radio.txPower).toBe(22);
        wrapper.vm.setMaxPower();
        expect(wrapper.vm.draft.radio.txPower).toBe(null);
    });

    it("offers what entering the mode does, rather than doing it unannounced", async () => {
        const wrapper = await open();
        expect(wrapper.text()).toContain("On entering the mode");
        expect(wrapper.text()).toContain("Announce the station");
        expect(wrapper.text()).toContain("Set the radio's clock");
        expect(wrapper.text()).toContain("Search for repeaters");
    });

    // The page has a Save of its own, which saves the mode tab and not this. Two
    // Saves on one page was a fault worth fixing once already, so this one says
    // which is which rather than leaving it to be found out.
    it("says the page's Save is not this one", async () => {
        const wrapper = await open();
        expect(wrapper.text()).toContain("saves the mode tab above, not this");
    });

    it("saves what was typed, and says where to load it", async () => {
        const wrapper = await open();

        wrapper.vm.draft.radio.radioFreq = 915000;
        wrapper.vm.save();
        await flushPromises();

        expect(NetDefaults.get("live").radio.radioFreq).toBe(915000);
        expect(wrapper.text()).toContain("Load it into a station");
    });

    it("keeps one per mode", async () => {
        const wrapper = await open();

        wrapper.vm.draft.radio.radioFreq = 915000;
        wrapper.vm.save();
        await wrapper.vm.select("training");
        await flushPromises();

        wrapper.vm.draft.radio.radioFreq = 906875;
        wrapper.vm.save();
        await flushPromises();

        expect(NetDefaults.get("live").radio.radioFreq).toBe(915000);
        expect(NetDefaults.get("training").radio.radioFreq).toBe(906875);
    });

    it("adds a # channel with the key every client works out from the name", async () => {
        const wrapper = await open();
        const before = wrapper.vm.draft.channels.length;

        wrapper.vm.newChannelName = "#Emcomm-Training";
        await wrapper.vm.addChannel();

        const added = wrapper.vm.draft.channels[wrapper.vm.draft.channels.length - 1];
        expect(wrapper.vm.draft.channels.length).toBe(before + 1);
        expect(added.secret).toBe(Utils.bytesToHex(await EmcommMode.hashtagChannelKey("#Emcomm-Training")));
    });

    // The strip read "Emcomm-Training" and "Emcomm-Live", the same as the mode
    // tabs further up the same page. A button pressed here looked exactly like one
    // pressed there: the mode tab did not move, the wrong mode was edited and
    // saved to the radio, and the only sign was a line of small print.
    it("is named for the defaults, not for the modes the tabs are named for", async () => {
        const wrapper = await open();
        const strip = wrapper.findAll("button").map((b) => b.text().replace(/\s+/g, " "));

        expect(strip.some((t) => t.startsWith("Training defaults"))).toBe(true);
        expect(strip.some((t) => t.startsWith("Live defaults"))).toBe(true);
        // and nothing here reads as a mode tab
        expect(strip.some((t) => t.startsWith("Emcomm-Training"))).toBe(false);
        expect(strip.some((t) => t.startsWith("Emcomm-Live"))).toBe(false);
    });

    it("only marks DRILL where DRILL belongs", async () => {
        const wrapper = await open();
        expect(wrapper.vm.tab).toBe("live");
        expect(wrapper.text()).not.toContain("Mark everything sent DRILL");

        await wrapper.vm.select("training");
        await flushPromises();
        expect(wrapper.text()).toContain("Mark everything sent DRILL");
    });

});

// Settings needs a database, and the database is opened per node — so with no
// radio to hand there was no way in to the net defaults at all. Which is exactly
// when an operator wants to write them: the night before, on a phone, with the
// radios still in the bag. Found by trying it.
describe("reaching the net defaults before a radio", () => {

    afterEach(() => {
        window.localStorage.clear();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
    });

    it("is offered on the connect screen, beside the crib sheet", () => {
        const wrapper = mount(ConnectButtons);
        const button = wrapper.findAll("button").find((b) => b.text() === "Net defaults");

        expect(button).not.toBe(undefined);
        expect(wrapper.text()).toContain("Set it up before a radio is to hand");
    });

    it("opens the same editor, already open", async () => {
        const wrapper = mount(ConnectButtons);
        await wrapper.findAll("button").find((b) => b.text() === "Net defaults").trigger("click");

        const deadline = Date.now() + 5000;
        while(Date.now() < deadline && !wrapper.text().includes("Frequency (kHz)")){
            await flushPromises();
            await new Promise((resolve) => setTimeout(resolve, 10));
        }

        expect(wrapper.findComponent(NetDefaultsGroup).exists()).toBe(true);
        // and it is open rather than a heading to press again
        expect(wrapper.text()).toContain("Frequency (kHz)");
    });

});

