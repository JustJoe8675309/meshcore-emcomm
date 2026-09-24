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

    it("puts the station's three states in tabs", () => {
        // what the radio is doing, and what each emcomm mode would write. Normal
        // mode is not among them: saving a live setting writes the mode in use, so
        // in normal mode the live fields are normal mode's, and a tab for it would
        // be the same values twice
        const tabs = source.match(/stationTabs\(\) \{[\s\S]*?\n        \}/)?.[0] ?? "";
        expect(tabs).toContain('id: "now"');
        expect(tabs).toContain('id: "training"');
        expect(tabs).toContain('id: "live"');
        expect(tabs).not.toContain('id: "normal"');
    });

    it("opens on what the radio is doing", () => {
        expect(source).toMatch(/stationTab: "now"/);
    });

    it("keeps the rest as folded groups below the tabs", () => {
        expect(sectionTitles).toEqual(["Operator", "Backups", "Commands"]);
    });

    it("shows a mode's own form under its tab, and normal's channels under the first", () => {
        // the emcomm tabs render the whole mode form; the now tab renders normal
        // mode's channels and rooms alone, because its radio settings are the live
        // ones above them
        expect(source).toMatch(/<ModeSettingsTabs only="normal" channels-only\/>/);
        expect(source).toMatch(/<ModeSettingsTabs :only="stationTab"/);
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
        const note = source.match(/stationTabNote\(\) \{[\s\S]*?\n        \}/)?.[0] ?? "";
        expect(note).toContain("writes it into the mode this");
        // and what an emcomm tab is: a promise about later, not a change now
        expect(note).toContain("Nothing here changes the radio until then.");
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

// "Is this station, now the normal mode?" — asked by the operator, and the answer
// is "only while the station is in normal mode".
//
// The live fields are the radio's, whatever mode it is in. Normal's channels sit
// under the same tab because the mode form is the only way to add a channel, and
// for a while they were headed simply "Channels" — so in a drill that tab showed
// the drill's live radio settings next to normal's channel list, with nothing
// saying they were different things.
describe("whose channels the first tab is showing", () => {

    const source = readFileSync(resolve("src/components/modes/ModeSettingsTabs.vue"), "utf8");

    it("names them as normal mode's when they are shown beside the live settings", () => {
        expect(source).toContain('channelsOnly ? "Channels normal mode writes" : "Channels"');
    });

    it("says the radio is holding another mode's channels when it is", () => {
        const warning = source.match(/v-if="channelsOnly && current !== 'normal'"[\s\S]{0,320}?<\/div>/)?.[0] ?? "";
        expect(warning).toContain("holding that mode's");
        expect(warning).toContain("These are what it comes home to");
        // amber, as the app's other "this is not what you might assume" lines are
        expect(warning).toContain("text-amber-800");
    });

});
