// The whole connect on one screen, in the order it happens.
//
// Asked for on 29 Sep after watching node 2 come up over Bluetooth. A single line that
// replaces itself says what is happening now and nothing about how far through it is:
// "Checking for dropped contacts" sat there a long while with no way to tell whether
// that was most of the work or a fraction of it.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ConnectSteps from "../../src/components/ConnectSteps.vue";

const step = (key, label, status, done = null, total = null, detail = null, word = null) =>
    ({ key, label, status, done, total, detail, word });

const mountWith = (steps) => mount(ConnectSteps, { props: { steps } });

describe("the connect screen", () => {

    it("shows every step at once, in order", () => {
        const wrapper = mountWith([
            step("answer", "Waiting for the radio to answer", "done"),
            step("contacts", "Reading contacts", "running", 90, 183),
            step("battery", "Reading the battery", "pending"),
        ]);

        const text = wrapper.text();
        expect(text).toContain("Waiting for the radio to answer");
        expect(text).toContain("Reading contacts");
        expect(text).toContain("Reading the battery");
        expect(text.indexOf("Waiting for the radio")).toBeLessThan(text.indexOf("Reading contacts"));
        expect(text.indexOf("Reading contacts")).toBeLessThan(text.indexOf("Reading the battery"));
    });

    it("says Complete in the middle of a finished bar, and paints it green", () => {
        const wrapper = mountWith([step("answer", "Waiting", "done")]);

        expect(wrapper.text()).toContain("Complete");
        const bar = wrapper.find("li div.absolute");
        expect(bar.classes()).toContain("bg-green-600");
        expect(bar.attributes("style")).toContain("width: 100%");
    });

    it("fills left to right with the percentage while it works, in blue", () => {
        const wrapper = mountWith([step("contacts", "Reading contacts", "running", 90, 180)]);

        expect(wrapper.text()).toContain("50%");
        expect(wrapper.text()).toContain("90 of 180");
        const bar = wrapper.find("li div.absolute");
        expect(bar.classes()).toContain("bg-blue-600");
        expect(bar.attributes("style")).toContain("width: 50%");
    });

    // a bar that has to move invites a made-up number, and a made-up number here is
    // something an operator would later use to judge whether a radio is slow or broken
    it("claims no percentage for a step the radio gives no count for", () => {
        const wrapper = mountWith([step("clock", "Setting the radio's clock", "running")]);

        expect(wrapper.text()).toContain("Working");
        expect(wrapper.text()).not.toMatch(/\d+%/);
        expect(wrapper.find("li div.absolute").classes()).toContain("animate-pulse");
    });

    it("leaves a step that has not started empty", () => {
        const wrapper = mountWith([step("battery", "Reading the battery", "pending")]);

        expect(wrapper.text()).not.toContain("Complete");
        expect(wrapper.find("li div.absolute").attributes("style")).toContain("width: 0%");
    });

    // the way home is only recorded for a station in normal mode; a green "Complete"
    // against something that never ran would be a lie an operator could act on
    it("says a skipped step was not needed rather than complete", () => {
        const wrapper = mountWith([step("normal", "Remembering this radio's own settings", "skipped")]);

        expect(wrapper.text()).toContain("Not needed");
        expect(wrapper.text()).not.toContain("Complete");
        expect(wrapper.find("li div.absolute").classes()).not.toContain("bg-green-600");
    });

    // one row for both contact passes: the second restarts the count, so the bar goes
    // back to the left, and the word is what makes that a new pass rather than lost
    // ground. Two rows were tried first and merged at the operator's request
    it("says which pass a step is on, beside its percentage", () => {
        const reading = mountWith([step("contacts", "Contacts", "running", 90, 180, null, "Reading")]);
        expect(reading.text()).toContain("Reading 50%");

        const checking = mountWith([step("contacts", "Contacts", "running", 45, 180, null, "Checking")]);
        expect(checking.text()).toContain("Checking 25%");
    });

    it("uses the word alone when the step has no count to give", () => {
        const wrapper = mountWith([step("contacts", "Contacts", "running", null, null, null, "Checking")]);
        expect(wrapper.text()).toContain("Checking");
        expect(wrapper.text()).not.toMatch(/\d+%/);
    });

    it("still says Complete when it is done, whatever word it was using", () => {
        const wrapper = mountWith([step("contacts", "Contacts", "done", 180, 180, null, "Checking")]);
        expect(wrapper.text()).toContain("Complete");
        expect(wrapper.text()).not.toContain("Checking");
    });

    it("prefers the step's own running detail to its name", () => {
        const wrapper = mountWith([
            step("channels", "Reading channels", "running", 17, 40, "Reading channels, 9 found"),
        ]);

        expect(wrapper.text()).toContain("Reading channels, 9 found");
    });

    it("counts how many are behind you", () => {
        const wrapper = mountWith([
            step("a", "A", "done"),
            step("b", "B", "skipped"),
            step("c", "C", "running"),
            step("d", "D", "pending"),
        ]);

        expect(wrapper.text()).toContain("2 of 4");
    });

    it("offers a way out, since a connect can hang", async () => {
        const wrapper = mountWith([step("a", "A", "running")]);

        await wrapper.findAll("button").find((b) => b.text() === "Disconnect").trigger("click");

        expect(wrapper.emitted("cancel")).toBeTruthy();
    });

    it("never shows a bar past full, whatever the radio reports", () => {
        const wrapper = mountWith([step("contacts", "Reading contacts", "running", 200, 180)]);
        expect(wrapper.find("li div.absolute").attributes("style")).toContain("width: 100%");
    });

});
