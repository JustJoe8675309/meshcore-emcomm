// Every menu option can be reached by keyboard and announced.
//
// From the 28 Sep audit, against the contacts filter and order menu: the options were
// plain `div`s with `cursor-pointer` -- no role, no tabindex, no accessible name. Mouse
// only, and silent to a screen reader. `DropDownMenuItem` is behind all five menus in
// the app, so it was every one of them.
//
// Deliberately a plain button rather than role="menuitem": the ARIA menu roles promise
// arrow-key navigation and focus management, and claiming the role without honouring it
// leaves a screen reader user pressing arrows that do nothing.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DropDownMenuItem from "../../src/components/DropDownMenuItem.vue";

describe("a menu option", () => {

    it("is a button, so Tab reaches it and Enter presses it", () => {
        const wrapper = mount(DropDownMenuItem, { slots: { default: "Heard Recently" } });
        expect(wrapper.element.tagName).toBe("BUTTON");
        expect(wrapper.attributes("type")).toBe("button");
    });

    it("is announced with its own words", () => {
        const wrapper = mount(DropDownMenuItem, { slots: { default: "Advert (Zero Hop)" } });
        expect(wrapper.text()).toBe("Advert (Zero Hop)");
    });

    it("still emits its click, which is how every menu acts on it", async () => {
        const wrapper = mount(DropDownMenuItem, {
            slots: { default: "A-Z" },
            attrs: { onClick: () => wrapper.vm.$el.setAttribute("data-clicked", "yes") },
        });
        await wrapper.trigger("click");
        expect(wrapper.attributes("data-clicked")).toBe("yes");
    });

    // A button centres its content and shrinks to fit; the menu rows are full width.
    //
    // Checked on the rendered element, not the source. The first version of this test
    // grepped the file and passed with the classes removed, because the comment above
    // the template says the words "w-full text-left" while explaining why they are
    // there. A source grep cannot tell code from the prose describing it.
    it("keeps the full-width left-aligned look a row needs", () => {
        const classes = mount(DropDownMenuItem, { slots: { default: "A-Z" } }).classes();
        expect(classes).toContain("w-full");
        expect(classes).toContain("text-left");
    });

    // the honesty rule: do not claim a role whose keyboard contract is not implemented.
    // Checked on the rendered element, not the source -- the file's own comment explains
    // the decision and says the words, which is not the same as claiming them
    it("does not claim a menu role it does not honour", () => {
        const wrapper = mount(DropDownMenuItem, { slots: { default: "A-Z" } });
        expect(wrapper.attributes("role")).toBe(undefined);
    });

});

describe("the contacts filter and order menu, which reported this", () => {

    it("builds its options from the component, not from bare divs", () => {
        const source = readFileSync(resolve("src/components/stations/StationsList.vue"), "utf8");
        const menu = source.slice(source.indexOf("Show"), source.indexOf("Heard Recently") + 40);

        // every clickable option goes through DropDownMenuItem
        const clickables = menu.match(/<div[^>]*@click/g) ?? [];
        expect(clickables).toEqual([]);
        expect(menu).toContain("<DropDownMenuItem");
    });

});
