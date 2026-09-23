// Rows that hold text must not have a fixed height.
//
// Reported from the operator's phone: the battery percentage painted over the
// green mode banner, while the same build on the computer was fine.
//
// The header's top row was `flex p-2 h-16`. That height is 4rem, so it scales
// with the root font — but its contents, a bold name line and a smaller battery
// line plus padding, grow faster than the row does. Android's own font size
// setting is enough to tip it over. Measured in the live app at 375x812, by
// raising the root font and reading the element boxes:
//
//     root font   row height   overlap of the banner
//     16px        64px         none, 10px clear
//     18px        72px         14px
//     20px        80px         15px
//     22px        88px         17px
//     24px        96px         18px
//
// With min-h-16 the row grows instead: 16px is unchanged at 64px, and 18px and
// 22px clear the banner by 9 to 11px.
//
// This is checked against the component source rather than by mounting, because
// happy-dom has no layout engine: every box it reports is zero, so an overlap
// cannot be measured here. The measuring was done in a real browser; this keeps
// the rule from being undone by someone tidying classes later.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (file) => readFileSync(resolve("src/components", file), "utf8");

// the row itself: the first flex div, since the header wraps it in a plain one
const firstRow = (file) => {
    const classes = [...source(file).matchAll(/<div class="([^"]*)"/g)].map((m) => m[1]);
    return classes.find((c) => /\bflex\b/.test(c)) ?? "";
};

describe("the header and app bar rows", () => {

    it("gives the header row a floor, not a fixed height", () => {
        const classes = firstRow("Header.vue");
        expect(classes).toMatch(/\bmin-h-16\b/);
        expect(classes).not.toMatch(/(^|\s)h-16(\s|$)/);
    });

    it("gives the app bar row a floor too, since it holds a title and a subtitle", () => {
        const classes = firstRow("AppBar.vue");
        expect(classes).toMatch(/\bmin-h-16\b/);
        expect(classes).not.toMatch(/(^|\s)h-16(\s|$)/);
    });

    it("keeps the mode banner out of the row above it, in its own full width row", () => {
        // it used to live inside the name column, where the row's height and the
        // column's width clipped it to "Normal mode · tap to"
        const header = source("Header.vue");
        const banner = header.indexOf("<ModeBanner");
        const rowEnd = header.indexOf("</div>\n\n    <!-- which mode this station is in");
        expect(banner).toBeGreaterThan(-1);
        expect(banner).toBeGreaterThan(rowEnd);
    });

    it("leaves no fixed height on a row that holds wrapping text", () => {
        // the two above are the only rows of this shape; a new one should either
        // grow or be named here with a reason
        const files = ["Header.vue", "AppBar.vue"];
        for(const file of files){
            const text = source(file);
            const rows = text.match(/<div class="[^"]*\bflex\b[^"]*"/g) ?? [];
            for(const row of rows){
                expect(row).not.toMatch(/(^|\s)h-1[0-9](\s|")/);
            }
        }
    });

});
