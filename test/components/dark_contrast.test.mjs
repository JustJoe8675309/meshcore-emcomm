// Every button and message bubble stays readable in the dark theme.
//
// Asked for 1 Oct ("look at all of the buttons and chat bubbles in dark mode and ensure
// they are still easily readable"). A sweep of every button, link-button and bubble in
// the components -- each state a :class can give it, hover and disabled included --
// resolved to the colours the dark theme actually paints (Tailwind's palette, then the
// .dark overrides in style.css) found: the field notes' "i" buttons at 1.9:1, the
// primary blue buttons and our own bubbles at 3.68:1, hover states that went paler
// (2.54:1), a failed bubble at 3.76:1, and disabled greys at 2.54:1. All fixed; this
// keeps them fixed. Body-size text wants 4.5:1; a disabled button 3:1.
//
// A source sweep, not a browser: it sees buttons that only appear in a dialog or a
// rare state. A button with no colour of its own is taken to show the lifted body ink
// on the darkest surface it can sit on, and one with no background, on both.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(join(ROOT, "package.json"));
const colors = require("tailwindcss/colors");

function palette(name) {
    if(name === "white") return "#ffffff";
    if(name === "black") return "#000000";
    let m = name.match(/^\[(#[0-9a-fA-F]{3,6})\]$/);
    if(m) return m[1].length === 4 ? "#" + [...m[1].slice(1)].map((c) => c + c).join("") : m[1];
    m = name.match(/^([a-z]+)-(\d{2,3})$/);
    if(m && colors[m[1]] && colors[m[1]][m[2]]) return colors[m[1]][m[2]];
    return null;
}

const css = readFileSync(join(ROOT, "src/style.css"), "utf8");
const darkText = {}, darkBg = {}, darkBgState = { hover: {}, disabled: {} };
for(const rule of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)){
    const colour = rule[2].match(/(?:^|;)\s*color:\s*(#[0-9a-fA-F]{3,6})/)?.[1];
    const bg = rule[2].match(/background-color:\s*(#[0-9a-fA-F]{3,6})/)?.[1];
    for(const sel of rule[1].split(",").map((x) => x.trim())){
        let m = sel.match(/^\.dark \.text-([a-z0-9-]+)$/);
        if(m && colour) darkText[m[1]] = colour;
        m = sel.match(/^\.dark \.bg-([a-z0-9-]+)$/);
        if(m && bg) darkBg[m[1]] = bg;
        m = sel.match(/^\.dark \.(hover|disabled)\\:bg-([a-z0-9-]+):(hover|disabled)$/);
        if(m && bg) darkBgState[m[1]][m[2]] = bg;
    }
}
const keepBlack = new Set(["green-500", "red-500", "yellow-400"]);   // banner blocks keep black text

const PAGE = "#0f1216", SURFACE = "#1b1f24";

// a received bubble's dark colours, read from the stylesheet like everything else
const bubbleRule = css.match(/\.dark \.bubble-in \{([^}]*)\}/)?.[1] ?? "";
const BUBBLE_IN = {
    bg: bubbleRule.match(/background-color:\s*(#[0-9a-fA-F]{3,6})/)?.[1] ?? null,
    text: bubbleRule.match(/(?:^|;)\s*color:\s*(#[0-9a-fA-F]{3,6})/)?.[1] ?? null,
};
const INHERITED = "#e8eaed";   // lifted body ink, what a button with no colour of its own shows

function lum(h) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const TEXT_RE = /^text-(white|black|[a-z]+-\d{2,3}|\[#[0-9a-fA-F]{3,6}\])$/;
const BG_RE = /^bg-(white|black|[a-z]+-\d{2,3}|\[#[0-9a-fA-F]{3,6}\])$/;

function resolve(classes, prefix = "") {
    const pick = (re) => {
        let v = null;
        for(const c of classes){
            if(prefix ? c.startsWith(prefix) : !c.includes(":")){
                const bare = prefix ? c.slice(prefix.length) : c;
                const m = bare.match(re);
                if(m) v = m[1];
            }
        }
        return v;
    };
    return { text: pick(TEXT_RE), bg: pick(BG_RE) };
}

function darkColours(classes, state) {
    const base = resolve(classes);
    const over = state ? resolve(classes, state + ":") : { text: null, bg: null };
    const textName = over.text ?? base.text;
    const bgName = over.bg ?? base.bg;
    let bg = null;
    if(classes.includes("bubble-in")) bg = BUBBLE_IN.bg ?? palette(bgName);
    else if(over.bg && darkBgState[state]?.[over.bg]) bg = darkBgState[state][over.bg];
    else if(bgName) bg = darkBg[bgName] ?? palette(bgName);
    let text;
    if(classes.includes("bubble-in") && !textName) text = BUBBLE_IN.text ?? INHERITED;
    else if(!textName) text = INHERITED;
    else if(textName === "black" && bgName && keepBlack.has(bgName)) text = "#000000";
    else text = darkText[textName] ?? palette(textName);
    return { text, bg, textName: textName ?? "(inherited)", bgName: bgName ?? (classes.includes("bubble-in") ? "bubble-in" : "(none)") };
}

// ---- elements --------------------------------------------------------------------
function walk(dir, out = []) {
    for(const n of readdirSync(dir)){
        const p = join(dir, n);
        if(statSync(p).isDirectory()) walk(p, out); else if(p.endsWith(".vue")) out.push(p);
    }
    return out;
}

function tags(src) {
    const out = [];
    const re = /<(button|RouterLink|router-link|a|div|span|label)\b/g;
    let m;
    while((m = re.exec(src))){
        let i = m.index, q = null;
        for(; i < src.length; i++){
            const ch = src[i];
            if(q){ if(ch === q) q = null; continue; }
            if(ch === '"' || ch === "'") { q = ch; continue; }
            if(ch === ">") break;
        }
        const tag = src.slice(m.index, i + 1);
        const close = src.indexOf(`</${m[1]}>`, i);
        const inner = close > 0 ? src.slice(i + 1, Math.min(close, i + 400)) : "";
        out.push({ name: m[1], tag, inner, line: src.slice(0, m.index).split("\n").length });
    }
    return out;
}

function variants(tag) {
    const stat = (tag.match(/\sclass="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean);
    const dyn = tag.match(/:class="([^"]*)"/)?.[1] ?? "";
    const lits = [...dyn.matchAll(/'([^']*)'|`([^`]*)`/g)].map((x) => (x[1] ?? x[2]).split(/\s+/).filter(Boolean));
    if(lits.length === 0) return [stat];
    return lits.map((l) => [...stat, ...l]);
}

const results = [];
for(const file of walk(join(ROOT, "src/components"))){
    const src = readFileSync(file, "utf8");
    const tpl = src.split("<script")[0];
    for(const t of tags(tpl)){
        const allClasses = (t.tag.match(/class="([^"]*)"/g) ?? []).join(" ");
        const isButton = t.name === "button" || /\brounded(-\w+)?\b/.test(allClasses) && /\bbg-/.test(allClasses) && /px-\d/.test(allClasses);
        const isBubble = /rounded-xl shadow/.test(allClasses);
        // anything else that paints its own text on its own background: a badge, a
        // banner, a label. An unread count is white on red at 12px
        const isBadge = /\btext-(white|black|[a-z]+-\d{2,3})\b/.test(allClasses) && /\bbg-(white|black|[a-z]+-\d{2,3}|\[#)/.test(allClasses);
        if(!(isButton || isBubble || isBadge)) continue;
        if(t.name !== "button" && !isBubble && !/\bbg-/.test(allClasses)) continue;
        const label = t.inner.replace(/<[^>]+>/g, " ").replace(/\{\{[^}]*\}\}/g, "{…}").replace(/\s+/g, " ").trim().slice(0, 44) || "(icon)";
        for(const cls of variants(t.tag)){
            for(const state of ["", "hover", "disabled"]){
                if(state && !cls.some((c) => c.startsWith(state + ":"))) continue;
                const d = darkColours(cls, state);
                const grounds = d.bg ? [d.bg] : [SURFACE, PAGE];
                const worst = Math.min(...grounds.map((g) => contrast(d.text, g)));
                results.push({
                    file: relative(ROOT, file).replace(/\\/g, "/"), line: t.line, kind: isBubble ? "bubble" : "button",
                    label, state: state || "normal", text: d.text, bg: d.bg ?? "transparent", textName: d.textName, bgName: d.bgName,
                    // an icon with no words is a graphic, which needs 3:1 rather than 4.5
                    icon: label === "(icon)" || label.startsWith("<path") || label.startsWith("<svg"),
                    ratio: Math.round(worst * 100) / 100,
                });
            }
        }
    }
}


const seen = new Set();
const rows = results.filter((r) => { const k = `${r.file}:${r.line}:${r.state}:${r.textName}:${r.bgName}`; if(seen.has(k)) return false; seen.add(k); return true; });
const show = (r) => `${r.ratio.toFixed(2)} ${r.file}:${r.line} [${r.state}] "${r.label}" ${r.textName} on ${r.bgName}`;

describe("buttons and bubbles in the dark", () => {

    it("finds the buttons and bubbles at all", () => {
        expect(rows.length).toBeGreaterThan(200);
        expect(rows.some((r) => r.kind === "bubble")).toBe(true);
        expect(rows.some((r) => r.file.endsWith("Header.vue"))).toBe(true);
    });

    it("keeps every button and bubble, normal and hovered, at 4.5:1 or better", () => {
        expect(rows.filter((r) => r.state !== "disabled" && r.ratio < (r.icon ? 3 : 4.5)).map(show)).toEqual([]);
    });

    // The root of most of what the sweep found: a colour with no dark version. A dark
    // text colour left alone is dark ink on a dark surface; a pale background left
    // alone is a bright box that lifted text then sits on. Any new one fails here.
    it("gives every dark text colour and every pale background a dark version", () => {
        const overridden = new Set([...css.matchAll(/\.dark \.(text|bg)-([a-z]+-\d{2,3})\b/g)].map((m) => `${m[1]}-${m[2]}`));
        const unlifted = [];
        for(const file of walk(join(ROOT, "src/components"))){
            const tpl = readFileSync(file, "utf8").split("<script")[0];
            for(const m of tpl.matchAll(/(?<![:\w-])(text|bg)-([a-z]+)-(\d{2,3})\b/g)){
                const key = `${m[1]}-${m[2]}-${m[3]}`;
                const hex = colors[m[2]]?.[m[3]];
                if(!hex || overridden.has(key)) continue;
                const l = lum(hex);
                if((m[1] === "text" && l < 0.18) || (m[1] === "bg" && l > 0.6)){
                    unlifted.push(`${key} in ${relative(ROOT, file).replace(/\\/g, "/")}`);
                }
            }
        }
        expect([...new Set(unlifted)]).toEqual([]);
    });

    it("keeps a disabled button's label readable, at 3:1 or better", () => {
        expect(rows.filter((r) => r.state === "disabled" && r.ratio < 3).map(show)).toEqual([]);
    });

    it("measures the colours it should: a received bubble is grey with white text, our own is blue", () => {
        const bubbles = rows.filter((r) => r.kind === "bubble");
        expect(bubbles.some((r) => r.bg === "#374151" && r.text === "#ffffff")).toBe(true);
        expect(bubbles.some((r) => r.bg === "#2563eb" && r.text === "#ffffff")).toBe(true);
    });

});
