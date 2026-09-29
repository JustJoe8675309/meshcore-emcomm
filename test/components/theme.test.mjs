// Light or dark, and following the device when told to.
//
// Asked for on 29 Sep, and not a decoration: this app is read at night at a muster
// point, where a white screen costs the operator their night vision and is visible
// across a field. The opposite is true at midday, which is why the default follows
// the device rather than picking a side.
//
// Three states rather than a switch. An operator whose phone is already dark for the
// evening should not have to set this too; one who wants the app light while the phone
// is dark should be able to say so and have it stick.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Theme from "../../src/js/Theme.js";

// happy-dom has matchMedia, so the device preference is faked by replacing it
function devicePrefers(dark, { listenable = true } = {}) {
    const listeners = [];
    const mql = {
        matches: dark,
        media: "(prefers-color-scheme: dark)",
        addEventListener: listenable ? (_, fn) => listeners.push(fn) : undefined,
        removeEventListener: listenable ? () => {} : undefined,
        addListener: listenable ? undefined : (fn) => listeners.push(fn),
        removeListener: listenable ? undefined : () => {},
    };
    vi.stubGlobal("matchMedia", () => mql);
    return {
        // pretend the device switched, the way a phone does at sunset
        change(nowDark) {
            mql.matches = nowDark;
            listeners.forEach((fn) => fn(mql));
        },
    };
}

const isDark = () => document.documentElement.classList.contains("dark");

describe("light, dark, or whatever the device says", () => {

    beforeEach(() => {
        window.localStorage.clear();
        document.documentElement.classList.remove("dark");
        document.documentElement.style.colorScheme = "";
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("follows a device set to dark when nothing has been chosen", () => {
        devicePrefers(true);

        Theme.start();

        expect(Theme.state.choice).toBe("system");
        expect(Theme.state.resolved).toBe("dark");
        expect(isDark()).toBe(true);
    });

    it("follows a device set to light", () => {
        devicePrefers(false);

        Theme.start();

        expect(Theme.state.resolved).toBe("light");
        expect(isDark()).toBe(false);
    });

    it("keeps following the device when it changes at sunset", () => {
        const device = devicePrefers(false);
        Theme.start();
        expect(isDark()).toBe(false);

        device.change(true);

        expect(isDark()).toBe(true);
    });

    // an operator who has said "light" means it, even on a phone that goes dark
    it("stops following the device once a choice is made", () => {
        const device = devicePrefers(false);
        Theme.start();
        Theme.set("light");

        device.change(true);

        expect(Theme.state.choice).toBe("light");
        expect(isDark()).toBe(false);
    });

    it("remembers the choice for next time", () => {
        devicePrefers(false);
        Theme.start();

        Theme.set("dark");

        expect(window.localStorage.getItem("theme")).toBe("dark");
        // and a fresh start honours it over the device
        document.documentElement.classList.remove("dark");
        Theme.start();
        expect(isDark()).toBe(true);
    });

    // the browser's own scrollbars and form controls, which otherwise stay white
    it("tells the browser which scheme is on screen", () => {
        devicePrefers(true);

        Theme.start();

        expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("refuses a choice it does not recognise", () => {
        devicePrefers(false);
        Theme.start();

        expect(Theme.set("puce")).toBe(false);
        expect(Theme.state.choice).toBe("system");
    });

    // Brave's Shields set to block all cookies make localStorage throw. Losing the
    // theme is not a reason to fail to start, which is the same lesson the station
    // list learned the hard way.
    it("still starts when the browser refuses storage", () => {
        devicePrefers(true);
        vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
            throw new DOMException("The operation is insecure.", "SecurityError");
        });
        vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
            throw new DOMException("The operation is insecure.", "SecurityError");
        });

        Theme.start();

        expect(isDark()).toBe(true);
        // and a choice still applies for this session, even unremembered
        expect(Theme.set("light")).toBe(true);
        expect(isDark()).toBe(false);
    });

    // older WebKit, which is a lot of the iOS field, has addListener and not
    // addEventListener
    it("follows a device that only has the old listener", () => {
        const device = devicePrefers(false, { listenable: false });
        Theme.start();

        device.change(true);

        expect(isDark()).toBe(true);
    });

    it("carries on when the browser will not answer about the device at all", () => {
        vi.stubGlobal("matchMedia", undefined);

        expect(() => Theme.start()).not.toThrow();
        expect(Theme.state.resolved).toBe("light");
    });

});
