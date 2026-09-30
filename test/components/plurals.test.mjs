// "1 contact(s)".
//
// From the 28 Sep audit: seven strings hedged the plural with "(s)" while the same
// files pluralised properly in a dozen other places. It reads as unfinished, and these
// are messages a net control reads off a screen mid-incident.
//
// Zero takes the plural, as English does: "0 contacts removed", which is the exact
// message node 1 showed on 29 Sep when a mode switch trimmed nothing.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Utils from "../../src/js/Utils.js";

describe("counting things in a sentence", () => {

    it("agrees with the number", () => {
        expect(Utils.count(1, "contact")).toBe("1 contact");
        expect(Utils.count(2, "contact")).toBe("2 contacts");
    });

    it("gives zero the plural, as English does", () => {
        expect(Utils.count(0, "contact")).toBe("0 contacts");
    });

    it("takes an irregular plural when one is needed", () => {
        expect(Utils.count(1, "entry", "entries")).toBe("1 entry");
        expect(Utils.count(3, "entry", "entries")).toBe("3 entries");
    });

});

describe("nothing hedges a plural any more", () => {

    const files = [
        "src/components/pages/SettingsPage.vue",
        "src/js/modes/ModeSwitch.js",
    ];

    it("has no (s) left in anything the operator reads", () => {
        for(const file of files){
            const source = readFileSync(resolve(file), "utf8");
            const hedges = source.split("\n")
                .map((line, i) => ({ line, at: i + 1 }))
                .filter(({ line }) => /\b\w+\(s\)/.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*"));

            expect(hedges.map((h) => `${file}:${h.at}`)).toEqual([]);
        }
    });

    // the verb has to move too, or "1 contact are not in this backup"
    it("moves the verb with the number, not just the noun", () => {
        const switcher = readFileSync(resolve("src/js/modes/ModeSwitch.js"), "utf8");
        const line = switcher.split("\n").find((l) => l.includes("met since"));
        expect(line).toContain('=== 1 ? "is" : "are"');
        expect(line).toContain('=== 1 ? "was" : "were"');
    });

});
