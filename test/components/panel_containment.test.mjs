// Scrolling panels must contain what is positioned inside them.
//
// Found on node 1: opening the transmission confirmation on the Reports tab
// scrolled the whole page and showed a white band below the app. The screen
// reader "required" labels on the report form are absolutely positioned, and
// with no positioned ancestor they were placed against the page instead of the
// panel. Wherever the panel was scrolled to, they stuck out below the app, so the
// page itself became scrollable, and bringing the confirmation into view
// scrolled it. In a 450 px window the page measured 661 px; with the panel
// positioned it measures 450.
//
// happy-dom does no layout, so this checks the one class that fixes it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf-8");
    const scroller = source.match(/<div class="([^"]*overflow-y-auto[^"]*)">/);
    return scroller?.[1].split(/\s+/) ?? [];
};

describe("scrolling panels", () => {

    for(const file of [
        "src/components/reports/ReportsPanel.vue",
        "src/components/ping/PingPanel.vue",
        "src/components/pages/SettingsPage.vue",
    ]){
        it(`${file} is positioned, so nothing inside it can stretch the page`, () => {
            expect(root(file)).toContain("relative");
        });
    }

});

// A dialog's buttons must be reachable without scrolling to find them.
//
// Measured in the live app at 375x812 with a 22px root font: the sharing dialog is
// 1370px tall with a code showing, and the first run wizard puts a whole settings
// form in each of its three mode steps. The backdrop scrolls, so nothing was
// unreachable — but Close, Next and "Switch mode" were all below the fold, which
// mid incident reads as a dialog with no way out.
//
// happy-dom gives every box zero height, so this checks the classes that pin them.
describe("dialog footers", () => {

    const buttonRow = (file, marker) => {
        const source = readFileSync(join(process.cwd(), file), "utf-8");
        const at = source.indexOf(marker);
        expect(at).toBeGreaterThan(-1);
        return source.slice(0, at).match(/<div class="([^"]*)">\s*(<!--[\s\S]*?-->\s*)?$/)?.[1] ?? "";
    };

    for(const [file, marker] of [
        ["src/components/modes/ModeSharing.vue", '<button @click="close"'],
        ["src/components/modes/FirstRunSetup.vue", `<button v-if="step !== 'done'" @click="skip"`],
        ["src/components/modes/ModeSwitchDialog.vue", '<button @click="close"'],
    ]){
        it(`${file} keeps its buttons on screen`, () => {
            const classes = buttonRow(file, marker);
            expect(classes).toContain("sticky bottom-0");
            // it sits over the content behind it, so it needs its own background
            expect(classes).toContain("bg-white");
        });
    }

});
