// How the settings page is arranged, and what a live change means for a mode.
//
// The page had grown to nine groups stacked end to end. Transmit power was
// editable in three of them, the node name and the radio settings in two each,
// and two headings a few inches apart read "Emcomm" and "EMCOMM Settings" while
// meaning entirely different things — operator preferences in this browser
// against live settings on the radio.
//
// The split that removes the duplication is not by topic but by *when*: what the
// radio is doing now, against what a mode will write when it is entered. Each
// setting appears once per meaning, under a heading that states the meaning.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import SettingsSection from "../../src/components/settings/SettingsSection.vue";
import ModeProfiles from "../../src/js/modes/ModeProfiles.js";
import GlobalState from "../../src/js/GlobalState.js";
import Utils from "../../src/js/Utils.js";

const NODE_KEY = new Uint8Array(32).fill(0x39);
const NODE = Utils.bytesToHex(NODE_KEY);
const source = readFileSync(resolve("src/components/pages/SettingsPage.vue"), "utf8");

describe("the shape of the settings page", () => {

    const sectionTitles = [...source.matchAll(/<SettingsSection title="([^"]+)"/g)].map((m) => m[1]);

    it("puts one tab per mode, all the same shape", () => {
        // the operator's correction: normal, training and live, identical in
        // layout, each showing what it will write when the station enters it. Any
        // can be edited from any other, so a station in a drill can set up what it
        // comes home to.
        const tabs = readFileSync(resolve("src/components/modes/ModeSettingsTabs.vue"), "utf8");
        expect(tabs).toMatch(/v-for="mode of modes"/);
        expect(source).toMatch(/<ModeSettingsTabs\/>/);
        // and no second, cut-down copy of the form for one of them
        expect(source).not.toContain("channels-only");
        expect(tabs).not.toContain("channelsOnly");
    });

    it("keeps the live radio below them, as its own thing", () => {
        expect(sectionTitles).toEqual(["The radio right now", "Operator", "Backups", "Commands"]);
    });

    it("has one place to edit each thing", () => {
        // the three groups that each used to edit the radio are one group now
        expect(source).not.toContain(">Public Info<");
        expect(source).not.toContain(">Radio Settings<");
        // and transmit power, which was in three of them, is written once here
        expect((source.match(/Transmit Power \(dBm\)/g) ?? []).length).toBe(1);
        expect((source.match(/v-model="radioFreq"/g) ?? []).length).toBe(1);
        expect((source.match(/v-model="name"/g) ?? []).length).toBe(1);
    });

    it("no longer has two headings called Emcomm", () => {
        // "Emcomm" held the operator's callsign and the backups; "EMCOMM Settings"
        // held live radio settings. Nothing about either name said which was which
        expect(source).not.toMatch(/<div class="bg-white p-2 font-semibold">Emcomm<\/div>/);
        expect(sectionTitles.filter((t) => /emcomm/i.test(t))).toEqual([]);
    });

    it("says what a live change does to the mode, where the operator will read it", () => {
        const live = source.match(/<SettingsSection title="The radio right now"[\s\S]{0,400}?>/)?.[0] ?? "";
        expect(live).toContain("written into the mode this station is in");
    });

});

describe("a foldable section", () => {

    const mountSection = (props = {}) => mount(SettingsSection, {
        props: { title: "This station, now", ...props },
        slots: { default: "<div>the fields</div>" },
    });

    it("is shut until it is opened, and says so to a screen reader", async () => {
        const wrapper = mountSection();
        const body = wrapper.find(".divide-y");
        // v-show keeps it in the page and hides it, so the display style is the
        // thing to read: isVisible() does not see it through happy-dom
        expect(wrapper.find("button").attributes("aria-expanded")).toBe("false");
        expect(body.element.style.display).toBe("none");

        await wrapper.find("button").trigger("click");
        expect(wrapper.find("button").attributes("aria-expanded")).toBe("true");
        expect(body.element.style.display).not.toBe("none");
    });

    it("can start open, for the group usually wanted", () => {
        const wrapper = mountSection({ openByDefault: true });
        expect(wrapper.find(".divide-y").element.style.display).not.toBe("none");
        expect(wrapper.text()).toContain("the fields");
    });

    it("carries a line about what the group is for", () => {
        const wrapper = mountSection({ note: "What the radio is doing at this moment." });
        expect(wrapper.text()).toContain("What the radio is doing at this moment.");
    });

});

// A mode writes its own radio settings when it is entered, so a live change was
// undone the next time the station came home: the operator raised the transmit
// power, went to a drill, came back, and the power was as it had been.
describe("a live change and the mode in use", () => {

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.selfInfo = { name: "Joe-KJ5HBN-HTv3", publicKey: NODE_KEY };
        ModeProfiles.saveProfile("normal", { ...ModeProfiles.blank(), radio: { ...ModeProfiles.blank().radio, txPower: 14, name: "Joe-KJ5HBN-HTv3" } }, NODE);
        ModeProfiles.setCurrent("normal", NODE);
    });

    afterEach(() => {
        window.localStorage.clear();
        GlobalState.selfInfo = null;
    });

    it("writes the change into the mode the station is in", () => {
        expect(ModeProfiles.noteRadioSettings({ txPower: 22 }, NODE)).toBe(true);
        expect(ModeProfiles.profile("normal", NODE).radio.txPower).toBe(22);
    });

    it("leaves the other modes alone", () => {
        ModeProfiles.saveProfile("live", { ...ModeProfiles.blank(), radio: { ...ModeProfiles.blank().radio, txPower: 22 } }, NODE);
        ModeProfiles.noteRadioSettings({ txPower: 5 }, NODE);

        // what a drill writes is the drill's business
        expect(ModeProfiles.profile("live", NODE).radio.txPower).toBe(22);
        expect(ModeProfiles.profile("normal", NODE).radio.txPower).toBe(5);
    });

    it("takes the name and the radio, and ignores anything else offered", () => {
        ModeProfiles.noteRadioSettings({
            name: "KJ5HBN-EMCOMM", radioFreq: 906875, radioBw: 250000, radioSf: 10, radioCr: 5,
            shareLocation: true, autoAddContacts: true,
            markDrill: true, channels: [], nonsense: 1,
        }, NODE);

        const profile = ModeProfiles.profile("normal", NODE);
        expect(profile.radio).toMatchObject({
            name: "KJ5HBN-EMCOMM", radioFreq: 906875, radioBw: 250000, radioSf: 10, radioCr: 5,
            shareLocation: true, autoAddContacts: true,
        });
        expect(profile.radio.nonsense).toBeUndefined();
        // markDrill belongs to the mode, not to the radio, and is not smuggled in
        expect(profile.markDrill).toBe(false);
    });

    it("leaves a mode with nothing stored alone, since a switch would not overwrite it", () => {
        ModeProfiles.setCurrent("training", NODE);
        expect(ModeProfiles.noteRadioSettings({ txPower: 22 }, NODE)).toBe(false);
        expect(ModeProfiles.profile("training", NODE)).toBe(null);
    });

    it("is called by the settings page after it writes the radio", () => {
        // the order matters: the radio is written first, and the mode is told only
        // once that worked
        const write = source.indexOf("Connection.setTxPower(this.txPower)");
        const note = source.indexOf("ModeProfiles.noteRadioSettings({");
        expect(write).toBeGreaterThan(-1);
        expect(note).toBeGreaterThan(write);
    });

    it("is called by the live toggles too, which change the radio one at a time", () => {
        const group = readFileSync(resolve("src/components/settings/EmcommSettingsGroup.vue"), "utf8");
        expect(group).toContain("noteRadioSettings({ txPower: power })");
        expect(group).toContain("noteRadioSettings({ shareLocation: turningOn })");
        expect(group).toContain("noteRadioSettings({ autoAddContacts: !turningOff })");
    });

});
