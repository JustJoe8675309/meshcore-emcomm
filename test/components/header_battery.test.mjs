// The battery badge, and what a phone's header has room for.
//
// Reported from the operator's phone: with Android's font size turned up, the
// header read "Mes... Emc... Ba..." — neither the station name nor the charge.
// Measured in the live app at 375x812 with a 22px root font:
//
//   the line wanted   "Battery 100% - Joe-KJ5HBN-HTv3"   285px
//                     "100% - Joe-KJ5HBN-HTv3"           220px
//                     "Joe-KJ5HBN-HTv3"                  154px
//
//   the line got      as shipped                          38px
//                     with the images 20% smaller         79px
//                     with the battery moved out and the
//                     buttons folded into the menu       160px
//
// So neither shortening the text nor shrinking the icons could fix it on its own:
// the space had to come from the four icon buttons, which wanted 237px of a 375px
// row. The battery moved to its own badge beside the buttons, and below the sm
// breakpoint the sharing and settings buttons fold into the menu that already
// holds the advert commands.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Header from "../../src/components/Header.vue";
import GlobalState from "../../src/js/GlobalState.js";

function mountHeader() {
    return mount(Header, {
        global: {
            stubs: {
                RouterLink: { template: "<a class='router-link'><slot/></a>" },
                DropDownMenu: { template: "<div><slot name='button'/><slot name='items'/></div>" },
                DropDownMenuItem: { template: "<button class='menu-item'><slot/></button>" },
                IconButton: true,
                ModeBanner: true,
                ModeSwitchDialog: true,
                ModeSharing: true,
            },
        },
    });
}

const source = readFileSync(resolve("src/components/Header.vue"), "utf8");
const menuItems = (wrapper) => wrapper.findAll("button.menu-item").map((b) => b.text());

describe("the battery badge", () => {

    beforeEach(() => {
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = { name: "Joe-KJ5HBN-HTv3", publicKey: new Uint8Array(32) };
        GlobalState.batteryPercentage = 100;
    });

    afterEach(() => {
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        GlobalState.batteryPercentage = null;
    });

    it("keeps the charge out of the name line, where it crowded the station out", () => {
        const wrapper = mountHeader();
        const nameLine = wrapper.find(".text-sm.truncate").text();

        expect(nameLine).toContain("Joe-KJ5HBN-HTv3");
        expect(nameLine).not.toContain("100%");
        expect(nameLine).not.toContain("Battery");
    });

    it("shows the charge as its own badge", () => {
        const wrapper = mountHeader();
        expect(wrapper.text()).toContain("100%");
        expect(wrapper.find("[title='Battery 100%']").exists()).toBe(true);
    });

    it("fills the icon in proportion, and never to nothing", () => {
        const wrapper = mountHeader();
        expect(Number(wrapper.vm.batteryFill)).toBeCloseTo(14, 1);

        GlobalState.batteryPercentage = 50;
        expect(Number(wrapper.vm.batteryFill)).toBeCloseTo(7, 1);

        // a sliver, so it still reads as a battery rather than an empty outline
        GlobalState.batteryPercentage = 1;
        expect(Number(wrapper.vm.batteryFill)).toBeGreaterThan(0);
    });

    it("turns red with a fifth left, which is when to look for a cable", () => {
        const wrapper = mountHeader();
        expect(wrapper.vm.batteryLow).toBe(false);

        GlobalState.batteryPercentage = 20;
        expect(wrapper.vm.batteryLow).toBe(true);
    });

    it("says nothing at all when the radio has not reported a charge", () => {
        GlobalState.batteryPercentage = null;
        const wrapper = mountHeader();
        expect(wrapper.find("[title^='Battery']").exists()).toBe(false);
    });

});

describe("what folds away on a narrow screen", () => {

    beforeEach(() => {
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = { name: "Joe-KJ5HBN-HTv3", publicKey: new Uint8Array(32) };
        GlobalState.batteryPercentage = 80;
    });

    afterEach(() => {
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        GlobalState.batteryPercentage = null;
    });

    it("offers sharing and settings in the menu, for the screens that lose their buttons", () => {
        const wrapper = mountHeader();
        const items = menuItems(wrapper);

        expect(items).toContain("Share a station mode");
        expect(items).toContain("Settings");
        // and the advert commands the menu already had
        expect(items).toContain("Advert (Zero Hop)");
    });

    it("hides those two buttons below the breakpoint, and keeps them above it", () => {
        // checked in the source: happy-dom applies no stylesheet, so a Tailwind
        // breakpoint cannot be observed by mounting at all
        const qr = source.match(/<button[^>]*aria-label="Share a station mode"[\s\S]{0,220}?class="([^"]*)"/);
        expect(qr?.[1]).toContain("hidden sm:block");

        const settings = source.match(/<RouterLink :to="\{ name: 'settings' \}"([^>]*)>/);
        expect(settings?.[1]).toContain("hidden sm:block");
    });

    it("keeps those menu items off the wide screens that still have the buttons", () => {
        expect(source).toMatch(/class="sm:hidden"[^>]*>Share a station mode/);
        expect(source).toMatch(/class="sm:hidden"[^>]*>Settings/);
    });

    it("leaves Disconnect one press away at every width", () => {
        const wrapper = mountHeader();
        expect(wrapper.text()).toContain("Disconnect");
    });

});
