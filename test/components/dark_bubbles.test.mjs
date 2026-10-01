// A received message's bubble in the dark theme.
//
// Its light grey (#efefef) is written into the class, so the dark theme's palette
// lifts never reached it, while its text was lifted to near white with everything
// else: white on near white, caught by the operator on 30 Sep ("make the background
// gray and the text white"). The bubble now carries `bubble-in`, which style.css
// gives a grey and white text in the dark theme only.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import MessageViewer from "../../src/components/messages/MessageViewer.vue";
import GlobalState from "../../src/js/GlobalState.js";
import Database from "../../src/js/Database.js";

const ME = new Uint8Array(32).fill(0x11);
const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const css = readFileSync(resolve("src/style.css"), "utf8");

function lum(h) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("a received bubble in the dark", () => {

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.selfInfo = null;
    });

    it("marks received bubbles, and only those", async () => {
        GlobalState.selfInfo = { name: "NOCALL-HT", publicKey: ME };
        const rows = [
            { id: "in", from: "ab".repeat(32), text: "NOCALL-BASE: hello", timestamp: 1, channel_idx: 1 },
            { id: "out", from: hex(ME), text: "hello back", timestamp: 2, channel_idx: 1 },
        ];
        vi.spyOn(Database.ChannelMessagesReadState, "touch").mockResolvedValue(undefined);
        vi.spyOn(Database.ChannelMessage, "getChannelMessages").mockReturnValue({
            $: { subscribe: (cb) => { cb(rows.map((r) => ({ toJSON: () => r }))); return { unsubscribe() {} }; } },
        });
        const wrapper = mount(MessageViewer, { props: { type: "channel", channel: { idx: 1, name: "#test" } } });
        await flushPromises();
        expect(wrapper.find("[data-bubble='in']").classes()).toContain("bubble-in");
        expect(wrapper.find("[data-bubble='out']").classes()).not.toContain("bubble-in");
        wrapper.unmount();
    });

    it("is grey with white text in the dark theme, and readable", () => {
        const rule = css.match(/\.dark \.bubble-in \{ background-color: (#[0-9a-f]{6}); color: (#[0-9a-f]{6}); \}/);
        expect(rule).not.toBe(null);
        const [, background, text] = rule;
        expect(text).toBe("#ffffff");
        expect(contrast(text, background)).toBeGreaterThan(7);
        // grey, not the near white it was: well away from white
        expect(contrast(background, "#ffffff")).toBeGreaterThan(7);
    });

    it("keeps a room post's author readable on that grey", () => {
        const background = css.match(/\.dark \.bubble-in \{ background-color: (#[0-9a-f]{6});/)[1];
        const author = css.match(/\.dark \.bubble-in \.text-blue-700 \{ color: (#[0-9a-f]{6}); \}/)?.[1];
        expect(author).toBeTruthy();
        expect(contrast(author, background)).toBeGreaterThanOrEqual(4.5);
    });

});
