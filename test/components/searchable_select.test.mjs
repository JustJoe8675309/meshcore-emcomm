// The combobox behind every picker in the app.
//
// It is a text input pretending to be a select, which means none of the behaviour a
// native select provides for free is provided here: filtering, keyboard movement,
// what Enter does, what Escape does, and telling assistive technology any of it.
// All of that is hand written, so all of it can break silently.

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import vClickOutside from "click-outside-vue3";
import SearchableSelect from "../../src/components/reports/SearchableSelect.vue";

const OPTIONS = [
    { value: "a", label: "ICS-213 General Message", hint: "2 mins ago" },
    { value: "b", label: "ICS-213RR Resource Request" },
    { value: "c", label: "SALUTE Spot Report" },
    { value: "d", label: "Net Check-Out" },
];

function mountSelect(props = {}) {
    return mount(SearchableSelect, {
        props: { options: OPTIONS, inputId: "picker", ...props },
        // registered globally by the app, so a test has to supply it too
        global: { plugins: [vClickOutside] },
    });
}

const input = (wrapper) => wrapper.find("input");
const optionTexts = (wrapper) => wrapper.findAll('[role="option"]').map((o) => o.text());

describe("SearchableSelect", () => {

    let wrapper;
    beforeEach(() => { wrapper = mountSelect(); });

    describe("filtering", () => {

        it("shows nothing until it is opened", () => {
            expect(wrapper.findAll('[role="option"]')).toHaveLength(0);
        });

        it("offers everything once focused", async () => {
            await input(wrapper).trigger("focus");
            expect(optionTexts(wrapper)).toHaveLength(OPTIONS.length);
        });

        it("matches anywhere in the label, not just the start", async () => {
            await input(wrapper).trigger("focus");
            await input(wrapper).setValue("resource");
            expect(optionTexts(wrapper).join()).toMatch(/ICS-213RR/);
            expect(optionTexts(wrapper)).toHaveLength(1);
        });

        it("ignores case, because nobody types ICS in capitals under pressure", async () => {
            await input(wrapper).trigger("focus");
            await input(wrapper).setValue("salute");
            expect(optionTexts(wrapper)).toHaveLength(1);
        });

        it("narrows to both ICS-213 forms on the form number", async () => {
            await input(wrapper).trigger("focus");
            await input(wrapper).setValue("213");
            expect(optionTexts(wrapper)).toHaveLength(2);
        });

        it("says so when nothing matches, rather than showing an empty box", async () => {
            await input(wrapper).trigger("focus");
            await input(wrapper).setValue("qqq");
            expect(wrapper.findAll('[role="option"]')).toHaveLength(0);
            expect(wrapper.text()).toMatch(/Nothing matches/);
        });

        it("does not search the hint, which is metadata rather than a name", async () => {
            await input(wrapper).trigger("focus");
            await input(wrapper).setValue("mins ago");
            expect(wrapper.findAll('[role="option"]')).toHaveLength(0);
        });

    });

    describe("choosing", () => {

        it("emits the value, not the label", async () => {
            await input(wrapper).trigger("focus");
            await wrapper.findAll('[role="option"]')[2].trigger("mousedown");
            expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["c"]);
        });

        it("shows the label of whatever is selected", async () => {
            const w = mountSelect({ modelValue: "d" });
            expect(w.find("input").element.value).toBe("Net Check-Out");
        });

        it("selects the highlighted option on Enter", async () => {
            await input(wrapper).trigger("focus");
            await input(wrapper).setValue("213");
            await input(wrapper).trigger("keydown.down");
            await input(wrapper).trigger("keydown.enter");
            // the second of the two matches, since the highlight moved once
            expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["b"]);
        });

        it("closes on Escape without changing the selection", async () => {
            const w = mountSelect({ modelValue: "a" });
            await w.find("input").trigger("focus");
            await w.find("input").trigger("keydown.esc");
            expect(w.findAll('[role="option"]')).toHaveLength(0);
            expect(w.emitted("update:modelValue")).toBeUndefined();
        });

        it("wraps the highlight rather than stopping at the ends", async () => {
            await input(wrapper).trigger("focus");
            // up from the first option lands on the last
            await input(wrapper).trigger("keydown.up");
            await input(wrapper).trigger("keydown.enter");
            expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["d"]);
        });

    });

    describe("telling assistive technology what this is", () => {

        it("is a combobox controlling a listbox", async () => {
            const el = input(wrapper);
            expect(el.attributes("role")).toBe("combobox");
            expect(el.attributes("aria-expanded")).toBe("false");
            await el.trigger("focus");
            expect(el.attributes("aria-expanded")).toBe("true");
            expect(el.attributes("aria-controls")).toBeTruthy();
        });

        it("points at the highlighted option so a screen reader can follow the keys", async () => {
            await input(wrapper).trigger("focus");
            const first = input(wrapper).attributes("aria-activedescendant");
            await input(wrapper).trigger("keydown.down");
            expect(input(wrapper).attributes("aria-activedescendant")).not.toBe(first);
        });

        it("uses the id it was given, so a label can point at it", () => {
            expect(input(wrapper).attributes("id")).toBe("picker");
        });

    });

    describe("looking like a dropdown", () => {

        it("draws the chevron a native select would", () => {
            expect(wrapper.find("svg").exists()).toBe(true);
        });

        it("turns the chevron over when the list is open", async () => {
            const chevron = () => wrapper.find("svg");
            expect(chevron().classes()).not.toContain("rotate-180");
            await input(wrapper).trigger("focus");
            expect(chevron().classes()).toContain("rotate-180");
        });

        it("keeps the chevron out of the way of the keyboard and the mouse", () => {
            // the input behind it already opens the list; a second tab stop for
            // decoration would make keyboard use worse, not better
            const holder = wrapper.find("svg").element.parentElement;
            expect(holder.className).toContain("pointer-events-none");
            expect(wrapper.find("svg").attributes("aria-hidden")).toBe("true");
        });

    });

});
