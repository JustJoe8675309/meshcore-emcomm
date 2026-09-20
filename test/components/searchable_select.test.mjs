// The combobox behind every picker in the app.
//
// It is a text input pretending to be a select, which means none of the behaviour a
// native select provides for free is provided here: filtering, keyboard movement,
// what Enter does, what Escape does, and telling assistive technology any of it.
// All of that is hand written, so all of it can break silently.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
        // focus only moves for real inside a live document, and this component
        // decides whether the keyboard appears by moving focus
        attachTo: document.body,
        // registered globally by the app, so a test has to supply it too
        global: { plugins: [vClickOutside] },
    });
}

const input = (wrapper) => wrapper.find("input");
const optionTexts = (wrapper) => wrapper.findAll('[role="option"]').map((o) => o.text());
const chevronButton = (wrapper) => wrapper.find("button");

describe("SearchableSelect", () => {

    let wrapper;
    beforeEach(() => { wrapper = mountSelect(); });
    afterEach(() => { wrapper?.unmount(); });

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

        it("keeps the chevron out of the tab order", () => {
            // the input beside it opens the list for a keyboard user already, so a
            // second stop for the same control is only an extra press
            expect(chevronButton(wrapper).attributes("tabindex")).toBe("-1");
            expect(wrapper.find("svg").attributes("aria-hidden")).toBe("true");
        });

    });

    // On a phone the chevron used to be pointer-events-none, so a tap on it went
    // through to the input, focused it, and raised the on screen keyboard over the
    // list the operator was trying to read.
    describe("opening the list without asking for the keyboard", () => {

        it("is a real button rather than something taps fall through", () => {
            const chevron = chevronButton(wrapper);
            expect(chevron.exists()).toBe(true);
            expect(chevron.element.className).not.toContain("pointer-events-none");
        });

        it("opens the list when the chevron is pressed", async () => {
            await chevronButton(wrapper).trigger("mousedown");
            expect(wrapper.findAll('[role="option"]').length).toBe(OPTIONS.length);
        });

        it("asks for no keyboard when opened by the chevron", async () => {
            await chevronButton(wrapper).trigger("mousedown");
            expect(input(wrapper).attributes("inputmode")).toBe("none");
        });

        it("still focuses the input, so arrow keys and screen readers keep working", async () => {
            await chevronButton(wrapper).trigger("mousedown");
            expect(document.activeElement).toBe(input(wrapper).element);
            await input(wrapper).trigger("keydown.down");
            expect(wrapper.vm.highlightedIndex).toBe(1);
        });

        it("does not steal focus from the input on press", async () => {
            // mousedown is where focus moves, so the handler has to prevent it
            const chevron = chevronButton(wrapper);
            const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
            chevron.element.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
        });

        it("asks for the keyboard when the text itself is tapped", async () => {
            await input(wrapper).trigger("focus");
            expect(input(wrapper).attributes("inputmode")).toBe("text");
        });

        it("brings the keyboard back if the text is tapped after the chevron", async () => {
            await chevronButton(wrapper).trigger("mousedown");
            expect(input(wrapper).attributes("inputmode")).toBe("none");

            await input(wrapper).trigger("pointerdown");
            expect(input(wrapper).attributes("inputmode")).toBe("text");
            // and the field is still focused, so typing goes where it should
            expect(document.activeElement).toBe(input(wrapper).element);
        });

        it("bounces focus so the keyboard actually comes up", async () => {
            // This asserts the mechanism rather than the effect, which is weaker
            // and deliberate: a virtual keyboard does not exist in this DOM, so
            // there is nothing to observe. inputmode is only read as a field takes
            // focus, so a field that is already focused has to drop it and take it
            // again. Without this the previous test still passes and a real phone
            // still shows no keyboard, which is exactly how this was missed.
            await chevronButton(wrapper).trigger("mousedown");

            const el = input(wrapper).element;
            const calls = [];
            const realBlur = el.blur.bind(el);
            const realFocus = el.focus.bind(el);
            el.blur = () => { calls.push("blur"); realBlur(); };
            el.focus = () => { calls.push("focus"); realFocus(); };

            await input(wrapper).trigger("pointerdown");

            expect(calls).toEqual(["blur", "focus"]);
        });

        it("leaves focus alone when the text is tapped with no list open", async () => {
            const el = input(wrapper).element;
            const calls = [];
            el.blur = () => calls.push("blur");

            await input(wrapper).trigger("pointerdown");

            // nothing to correct, so nothing should flicker
            expect(calls).toEqual([]);
        });

        it("closes again on a second chevron press", async () => {
            await chevronButton(wrapper).trigger("mousedown");
            expect(wrapper.vm.isOpen).toBe(true);
            await chevronButton(wrapper).trigger("mousedown");
            expect(wrapper.vm.isOpen).toBe(false);
        });

        it("forgets the no-keyboard state once the list closes", async () => {
            await chevronButton(wrapper).trigger("mousedown");
            wrapper.vm.close();
            await wrapper.vm.$nextTick();
            // the next opening decides for itself, rather than inheriting this one
            expect(input(wrapper).attributes("inputmode")).toBe("text");
        });

        it("still lets a chevron opened list be typed into once tapped", async () => {
            await chevronButton(wrapper).trigger("mousedown");
            await input(wrapper).trigger("pointerdown");
            await input(wrapper).setValue("SALUTE");
            expect(optionTexts(wrapper)).toEqual(["SALUTE Spot Report"]);
        });

    });

});
