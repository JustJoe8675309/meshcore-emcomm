// Every button in the header can be announced.
//
// From the 28 Sep audit: two header buttons carried neither aria-label nor title, and
// a screen reader announced them as "button". The share button next to them carried
// both, so this was an oversight rather than a decision.
//
// Disconnect is the one worth understanding. On a wide screen it reads "Disconnect"
// and needs nothing. Below the sm breakpoint that word is hidden and the button is an
// X and nothing else -- so the name has to be on the element, not in the text. That
// also means **mounting cannot catch it**: happy-dom applies no stylesheet, so the
// hidden span is still in the DOM and every button looks named. The rule is checked
// against the source instead.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Header from "../../src/components/Header.vue";
import GlobalState from "../../src/js/GlobalState.js";

const source = readFileSync(resolve("src/components/Header.vue"), "utf8");

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
                DisconnectDialog: true,
                ModeSharing: true,
                FirstRunSetup: true,
                LeftInModeDialog: true,
                BackupShrankDialog: true,
            },
        },
    });
}

describe("the header's buttons can be announced", () => {

    beforeEach(() => {
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = { name: "Joe-NOCALL-HTv3", publicKey: new Uint8Array(32) };
        GlobalState.batteryPercentage = 80;
    });

    afterEach(() => {
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        GlobalState.batteryPercentage = null;
    });

    it("gives every button a name, by label or by its own words", () => {
        const wrapper = mountHeader();
        const nameless = wrapper.findAll("button")
            .filter((b) => b.attributes("aria-label") == null && b.text().trim() === "")
            .map((b) => b.html().slice(0, 80));

        expect(nameless).toEqual([]);
    });

    // the rule mounting cannot see: a button whose only content is an icon
    it("labels every button that is an icon and nothing else", () => {
        const buttons = source.match(/<button[\s\S]*?<\/button>/g) ?? [];
        const iconOnly = buttons.filter((b) => {
            const withoutTags = b.replace(/<[^>]*>/g, "").trim();
            return withoutTags === "" && b.includes("<svg");
        });

        expect(iconOnly.length).toBeGreaterThan(0);
        for(const button of iconOnly){
            expect(button).toMatch(/aria-label="[^"]+"/);
        }
    });

    // its word is hidden below the sm breakpoint, leaving an X and nothing else
    it("names Disconnect on the element, not only in its text", () => {
        const button = source.match(/<button @click="disconnect"[\s\S]*?<\/button>/)?.[0] ?? "";
        expect(button).toContain('aria-label="Disconnect"');
        expect(button).toContain('class="hidden sm:block">Disconnect</span>');
    });

    it("names the advert menu and settings", () => {
        expect(source).toContain('aria-label="Adverts"');
        expect(source).toContain('aria-label="Settings"');
    });

});
