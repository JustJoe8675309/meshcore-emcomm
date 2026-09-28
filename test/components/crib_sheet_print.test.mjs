// Whether the printed crib sheet can be longer than one page.
//
// The sheet lives inside a `fixed inset-0 overflow-y-auto` backdrop, with two more
// scrolling containers above that. The print stylesheet used to lift it out with
// `position: absolute`, which does not escape a positioned ancestor: it resolves
// against the backdrop, stays inside its scroll box, and the printer is handed a
// single page.
//
// That is invisible for one form, because every single form fits on a page. It was
// found on 28 Sep by printing the booklet, which came out as one page holding two
// of its twenty-six forms and then the bare heading of the third.
//
// So the sheet is lifted onto the body for the duration of the print and put back
// afterwards, which is the only way out of three nested scroll boxes. These tests
// hold the lift, the restore, and the class the stylesheet keys on.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import ReportCribSheet from "../../src/components/reports/ReportCribSheet.vue";

const mountOpen = () => mount(ReportCribSheet, {
    props: { open: true, form: null },
    attachTo: document.body,
});

describe("the crib sheet gets out of its scroll box to print", () => {

    let wrapper;

    afterEach(() => {
        wrapper?.unmount();
        document.body.classList.remove("crib-printing");
    });

    it("is lifted onto the body when printing starts", () => {
        wrapper = mountOpen();
        const sheet = document.getElementById("crib-sheet");
        expect(sheet.parentNode).not.toBe(document.body);

        window.dispatchEvent(new Event("beforeprint"));

        expect(document.getElementById("crib-sheet").parentNode).toBe(document.body);
    });

    it("tells the stylesheet it is out, so the page rules apply", () => {
        wrapper = mountOpen();

        window.dispatchEvent(new Event("beforeprint"));

        expect(document.body.classList.contains("crib-printing")).toBe(true);
    });

    it("puts it back exactly where it was when printing ends", () => {
        wrapper = mountOpen();
        const sheet = document.getElementById("crib-sheet");
        const parent = sheet.parentNode;
        const next = sheet.nextSibling;

        window.dispatchEvent(new Event("beforeprint"));
        window.dispatchEvent(new Event("afterprint"));

        const back = document.getElementById("crib-sheet");
        expect(back.parentNode).toBe(parent);
        expect(back.nextSibling).toBe(next);
        expect(document.body.classList.contains("crib-printing")).toBe(false);
    });

    // a second beforeprint without an afterprint in between must not overwrite the
    // remembered home with "the body", which would strand the sheet there
    it("does not lose where it came from if printing starts twice", () => {
        wrapper = mountOpen();
        const parent = document.getElementById("crib-sheet").parentNode;

        window.dispatchEvent(new Event("beforeprint"));
        window.dispatchEvent(new Event("beforeprint"));
        window.dispatchEvent(new Event("afterprint"));

        expect(document.getElementById("crib-sheet").parentNode).toBe(parent);
    });

    // closing the dialog mid-print would otherwise leave the sheet on the body,
    // visible on screen and outside the app's layout
    it("never leaves the sheet parked on the body when it goes away", () => {
        wrapper = mountOpen();
        window.dispatchEvent(new Event("beforeprint"));
        expect(document.getElementById("crib-sheet").parentNode).toBe(document.body);

        wrapper.unmount();
        wrapper = null;

        expect(document.getElementById("crib-sheet")).toBe(null);
        expect(document.body.classList.contains("crib-printing")).toBe(false);
    });

});
