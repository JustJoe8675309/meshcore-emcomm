// Day and night in one press.
//
// Asked for on 29 Sep. Settings already had a three-way choice -- follow the device,
// light, dark -- but night mode is something an operator reaches for when the light
// changes around them, not something worth walking into a settings page for.
//
// The toggle flips what is actually on screen, which is why it reads resolve() and not
// choice(): from "follow the device" at night, the honest flip is to light. A toggle
// that read the choice would set "dark" and appear to do nothing.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import Theme from "../../src/js/Theme.js";
import GlobalState from "../../src/js/GlobalState.js";
import Header from "../../src/components/Header.vue";

function mountHeader() {
    return mount(Header, {
        global: {
            stubs: {
                RouterLink: { template: "<a class='router-link'><slot/></a>" },
                DropDownMenu: { template: "<div><slot name='button'/><slot name='items'/></div>" },
                DropDownMenuItem: { template: "<button class='menu-item'><slot/></button>" },
                IconButton: true, ModeBanner: true, ModeSwitchDialog: true,
                DisconnectDialog: true, ModeSharing: true, FirstRunSetup: true,
                LeftInModeDialog: true, BackupShrankDialog: true,
            },
        },
    });
}

describe("flipping day and night", () => {

    afterEach(() => {
        try { window.localStorage.clear(); } catch(e) {}
        Theme.apply("system");
        vi.restoreAllMocks();
    });

    it("goes to dark from light", () => {
        Theme.set("light");
        expect(Theme.toggle()).toBe("dark");
        expect(Theme.choice()).toBe("dark");
    });

    it("goes to light from dark", () => {
        Theme.set("dark");
        expect(Theme.toggle()).toBe("light");
    });

    // the bug a toggle written against choice() would have: from "system" at night it
    // would set "dark", which is already what is on screen, and nothing would happen
    it("flips what is on screen, not the stored choice", () => {
        vi.spyOn(Theme, "prefersDark").mockReturnValue(true);
        Theme.apply("system");
        expect(Theme.resolve()).toBe("dark");

        expect(Theme.toggle()).toBe("light");
        expect(Theme.resolve()).toBe("light");
    });

    it("leaves the page painted the way it says", () => {
        Theme.set("light");
        Theme.toggle();
        expect(document.documentElement.classList.contains("dark")).toBe(true);

        Theme.toggle();
        expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

});

describe("the toggle in the header", () => {

    beforeEach(() => {
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = { name: "Joe-NOCALL-HTv3", publicKey: new Uint8Array(32) };
        GlobalState.batteryPercentage = 80;
        Theme.set("light");
    });

    afterEach(() => {
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        GlobalState.batteryPercentage = null;
        try { window.localStorage.clear(); } catch(e) {}
        Theme.apply("system");
    });

    // a button is named for what pressing it does
    it("offers Night mode while it is day, and Day mode while it is night", async () => {
        const wrapper = mountHeader();
        expect(wrapper.text()).toContain("Night mode");

        Theme.set("dark");
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain("Day mode");
    });

    it("flips the theme when pressed", async () => {
        const wrapper = mountHeader();
        const button = wrapper.findAll("button").find((b) => b.attributes("aria-label") === "Night mode");

        expect(button).not.toBe(undefined);
        await button.trigger("click");

        expect(Theme.resolve()).toBe("dark");
    });

    // the phone has no room for a fifth icon: the station name is what loses
    it("folds away below the breakpoint and is offered in the menu there", () => {
        const wrapper = mountHeader();
        const button = wrapper.findAll("button").find((b) => b.attributes("aria-label") === "Night mode");
        expect(button.classes()).toContain("hidden");
        expect(button.classes()).toContain("sm:block");

        const item = wrapper.findAll("button.menu-item").find((b) => b.text() === "Night mode");
        expect(item).not.toBe(undefined);
    });

});
