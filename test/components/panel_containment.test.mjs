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
