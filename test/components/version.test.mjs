// What version this station is running, shown where it can be read out.
//
// Asked for on 29 Sep. "What version are you on?" is a question that gets asked
// across a net, and until now it was only answerable from a developer console: the
// build carries a content hash in its filename and the service worker cache is
// stamped with it, but neither is something anybody can say aloud.
//
// The values are injected by the build. The thing these tests are really protecting
// is that a *wrong* answer is never shown -- a station claiming 1.1 while running 1.0
// is worse than one claiming nothing, because it is the answer the net would act on.
// So anything the build did not supply comes back null and the label is left off.

import { describe, it, expect } from "vitest";
import Version from "../../src/js/Version.js";

describe("the version a station reports", () => {

    it("shows major and minor, and the date it was built", () => {
        expect(Version.label("1.1.0", "2026-09-29T20:41:00.000Z")).toBe("v1.1 · 29 Sep 2026");
    });

    // the patch is what changes when a typo is fixed. It would make the label long
    // enough to crowd the station name on a phone, which is the one thing in that
    // header that has to stay readable
    it("leaves the patch off", () => {
        expect(Version.number("1.1.7")).toBe("1.1");
        expect(Version.number("2.0.0")).toBe("2.0");
    });

    it("does not lose a two digit minor", () => {
        expect(Version.label("1.12.0", "2026-10-01T00:00:00.000Z")).toBe("v1.12 · 1 Oct 2026");
    });

    // a build that supplied nothing must not produce "vundefined" or a bare separator
    it("says nothing at all when the build supplied nothing", () => {
        expect(Version.label("", "")).toBe(null);
        expect(Version.label(undefined, undefined)).toBe(null);
    });

    it("shows what it has when only one of the two arrived", () => {
        expect(Version.label("1.1.0", "")).toBe("v1.1");
        expect(Version.label("", "2026-09-29T20:41:00.000Z")).toBe("29 Sep 2026");
    });

    it("refuses a date it cannot read rather than printing Invalid Date", () => {
        expect(Version.built("not a date")).toBe(null);
        expect(Version.label("1.1.0", "not a date")).toBe("v1.1");
    });

    it("refuses a version it cannot read", () => {
        expect(Version.number("")).toBe(null);
        expect(Version.number("1")).toBe(null);
        // ".5" gets past the two-part check and would otherwise render as "v.5"
        expect(Version.number(".5")).toBe(null);
    });

    // The stamp is the commit's own date and carries the author's offset. Rendering it
    // through getUTCDate turned an evening commit in El Paso into the following day --
    // a version stamped 30 Sep for work done on the 29th. The calendar date is read
    // straight off the front of the string instead, which keeps the author's day and is
    // still the same on every station, because the string is baked into the build.
    it("keeps the date the commit was actually made on", () => {
        expect(Version.built("2026-09-29T20:38:19-06:00")).toBe("29 Sep 2026");
        expect(Version.built("2026-09-30T01:00:00+09:00")).toBe("30 Sep 2026");
    });

    it("reads a UTC stamp the same way", () => {
        expect(Version.built("2026-10-01T02:00:00.000Z")).toBe("1 Oct 2026");
        expect(Version.built("2026-09-30T23:30:00.000Z")).toBe("30 Sep 2026");
    });

    // the stamp has to BE a date, not merely contain one: a build that injected
    // something descriptive should show nothing rather than a date dug out of it
    it("refuses a string that merely contains a date", () => {
        expect(Version.built("built on 2026-09-29")).toBe(null);
        expect(Version.built("not a date")).toBe(null);
    });

    it("refuses a month that is not one", () => {
        expect(Version.built("2026-13-01T00:00:00.000Z")).toBe(null);
        expect(Version.built("2026-00-01T00:00:00.000Z")).toBe(null);
    });

});
