/**
 * The battery badge on a charger, and the badge at nought.
 *
 * Asked for 30 Sep ("can you tell when it is charging and represent that state
 * with a lightning bolt in the battery icon"). The radio cannot tell, so the
 * answer is inferred from the voltage trend in Battery.js; the header only has
 * to show what that inference says. Charging replaces the fill with a bolt,
 * silences the yellow and red stages -- a rising 20% is not a warning -- and
 * says so in the title.
 *
 * The badge at 0% is here too: it was `v-if="GlobalState.batteryPercentage"`,
 * which hid the badge at the one reading an operator most needs to see.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
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

const badge = (wrapper) => wrapper.find("[title^='Battery']");

describe("the battery badge on a charger", () => {

    beforeEach(() => {
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = { name: "Joe-KJ5ZZZ-HTv3", publicKey: new Uint8Array(32) };
        GlobalState.batteryPercentage = 24;
        GlobalState.batteryCharging = false;
    });

    afterEach(() => {
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        GlobalState.batteryPercentage = null;
        GlobalState.batteryCharging = false;
    });

    it("shows a bolt in place of the fill while charging", () => {
        GlobalState.batteryCharging = true;
        const wrapper = mountHeader();
        expect(wrapper.find("svg [data-charging]").exists()).toBe(true);
        expect(wrapper.find("svg [data-fill]").exists()).toBe(false);
    });

    it("shows the fill and no bolt when it is not", () => {
        const wrapper = mountHeader();
        expect(wrapper.find("svg [data-charging]").exists()).toBe(false);
        expect(wrapper.find("svg [data-fill]").exists()).toBe(true);
    });

    it("keeps the level in the number beside the bolt", () => {
        GlobalState.batteryCharging = true;
        expect(badge(mountHeader()).text()).toBe("24%");
    });

    it("goes green, not a warning colour, while the battery is filling", () => {
        GlobalState.batteryCharging = true;
        GlobalState.batteryPercentage = 9;
        const wrapper = mountHeader();
        expect(wrapper.vm.batteryState).toBe("charging");
        expect(wrapper.vm.batteryColour).toBe("text-green-700");
        expect(wrapper.find("svg rect").attributes("stroke-width")).toBe("1.5");
    });

    it("says so where the advice goes", () => {
        GlobalState.batteryCharging = true;
        expect(mountHeader().vm.batteryTitle).toBe("Battery 24% — charging");
    });

    it("goes back to the stages the moment the charger is gone", () => {
        GlobalState.batteryCharging = true;
        GlobalState.batteryPercentage = 12;
        const wrapper = mountHeader();
        expect(wrapper.vm.batteryState).toBe("charging");
        GlobalState.batteryCharging = false;
        expect(wrapper.vm.batteryState).toBe("flat");
        expect(wrapper.vm.batteryTitle).toBe("Battery 12% — this station is about to go down");
    });

});

describe("the battery badge at nought", () => {

    beforeEach(() => {
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = { name: "Joe-KJ5ZZZ-HTv3", publicKey: new Uint8Array(32) };
    });

    afterEach(() => {
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        GlobalState.batteryPercentage = null;
    });

    it("is shown, red, rather than vanishing", () => {
        GlobalState.batteryPercentage = 0;
        const wrapper = mountHeader();
        expect(badge(wrapper).exists()).toBe(true);
        expect(badge(wrapper).text()).toBe("0%");
        expect(wrapper.vm.batteryColour).toBe("text-red-600");
    });

    it("is still absent when there has been no reading", () => {
        GlobalState.batteryPercentage = null;
        expect(badge(mountHeader()).exists()).toBe(false);
    });

});
