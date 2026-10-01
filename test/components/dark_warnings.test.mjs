/**
 * Every warning colour the app uses on a white surface has a lift for the dark
 * one, or it goes to mud exactly where an operator needs it to stand out.
 *
 * The warnings went from amber to yellow on 30 Sep at the operator's word, and
 * the first half of that change -- the battery badge alone -- shipped with a lift
 * written by hand for the one class. This walks the source for every yellow
 * class actually in use and checks style.css lifts each, so the next colour that
 * gets added cannot be forgotten in the dark.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function walk(dir, out = []) {
    for(const name of readdirSync(dir)){
        const p = join(dir, name);
        if(statSync(p).isDirectory()){
            walk(p, out);
        } else if(p.endsWith(".vue")){
            out.push(p);
        }
    }
    return out;
}

const css = readFileSync(resolve("src/style.css"), "utf8");
const sources = walk(resolve("src/components")).map((p) => readFileSync(p, "utf8")).join("\n");

describe("warnings in the dark", () => {

    const used = [...new Set(sources.match(/\b(?:text|bg|border)-yellow-\d{2,3}\b/g))].sort();

    it("finds the yellow classes in use at all", () => {
        expect(used).toContain("text-yellow-700");
        expect(used).toContain("text-yellow-800");
        expect(used).toContain("bg-yellow-50");
        expect(used).toContain("border-yellow-300");
    });

    it("lifts every one of them in dark mode", () => {
        // the solid action buttons (bg-yellow-700 with white text, hover 800) are
        // saturated blocks that carry their own text, like the mode banner, and
        // read the same on either surface; everything else is a tint on white
        const needsLift = (cls) => !/^bg-yellow-(700|800)$/.test(cls);
        const unlifted = used.filter(needsLift).filter((cls) => !css.includes(`.dark .${cls} {`));
        expect(unlifted).toEqual([]);
    });

    it("lifts the text up the scale, never down into mud", () => {
        // yellow-700 on white is #a16207; the lifts must be brighter than that
        for(const [cls, hex] of [...css.matchAll(/\.dark \.text-yellow-\d+ \{ color: (#[0-9a-f]{6}); \}/g)].map((m) => [m[0], m[1]])){
            const [r, g] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16)];
            expect(r, cls).toBeGreaterThan(0xa1);
            expect(g, cls).toBeGreaterThan(0x62);
        }
    });

    it("has no amber warnings left, only the favourite stars", () => {
        const amber = [...new Set(sources.match(/\b(?:text|bg|border)-amber-\d{2,3}\b/g))].sort();
        expect(amber).toEqual(["text-amber-200", "text-amber-500"]);
    });

});
