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

    it("keeps no node name and no power number", () => {
        NetDefaults.save("live", aNetProfile());
        const stored = NetDefaults.get("live");

        // two stations answering to one name is the fault mode sharing refuses
        expect(stored.radio.name).toBeUndefined();
        // radios differ in what they manage, so the number is worked out on loading
        expect(stored.radio.txPower).toBe(null);
        // and what a net does agree on is there
        expect(stored.radio.radioFreq).toBe(906875);
        expect(stored.channels[0].name).toBe("#Emcomm");
    });

    it("is not offered for normal mode, which no net can decide", () => {
        expect(NetDefaults.applies("normal")).toBe(false);
        expect(NetDefaults.save("normal", aNetProfile())).toBe(false);
        expect(NetDefaults.get("normal")).toBe(null);
    });

    it("fills out into a station, keeping that station's name and ceiling", async () => {
        NetDefaults.save("live", aNetProfile());

        const filled = await NetDefaults.forStation("live", { name: "KJ5HBN-EMCOMM", maxTxPower: 17 });

        expect(filled.radio.name).toBe("KJ5HBN-EMCOMM");
        expect(filled.radio.txPower).toBe(17);
        expect(filled.radio.radioFreq).toBe(906875);
        expect(filled.autoAnswerPositions).toBe(true);
        expect(filled.channels.map((c) => c.name)).toEqual(["#Emcomm"]);
    });

    it("hands back nothing for a mode with none written", async () => {
        expect(await NetDefaults.forStation("training", {})).toBe(null);
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

    const open = async () => {
        const wrapper = mount(NetDefaultsGroup);
        await wrapper.find("button[aria-expanded]").trigger("click");
        await flushPromises();
        return wrapper;
    };

    it("opens and edits with no radio connected", async () => {
        const wrapper = await open();

        expect(wrapper.text()).not.toContain("No radio connected");
        expect(wrapper.vm.draft).not.toBe(null);
        expect(wrapper.text()).toContain("Frequency (kHz)");
    });

    it("offers no node name and no transmit power, and says why", async () => {
        const wrapper = await open();

        expect(wrapper.text()).not.toContain("Node name");
        expect(wrapper.text()).not.toContain("Transmit power (dBm)");
        expect(wrapper.text()).toContain("two would answer to one");
        expect(wrapper.text()).toContain("as high as its own radio goes");
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

    it("only marks DRILL where DRILL belongs", async () => {
        const wrapper = await open();
        expect(wrapper.vm.tab).toBe("live");
        expect(wrapper.text()).not.toContain("Mark everything sent DRILL");

        await wrapper.vm.select("training");
        await flushPromises();
        expect(wrapper.text()).toContain("Mark everything sent DRILL");
    });

});
