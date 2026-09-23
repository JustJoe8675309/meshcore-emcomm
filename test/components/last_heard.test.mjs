// When a station was last heard, as far as it can be trusted.
//
// `lastAdvert` is not when this radio heard the advert: it is the timestamp the
// other station put in it, from its own clock. On node 1 one contact carried an
// advert dated four years in the future. The one list sorts by Heard Recently by
// default, so that station sat permanently at the top — the row an operator would
// most want to trust during a net.
//
// The operator's rule: a time too far ahead to be real is read as now. The station
// was heard, that much is certain; only its clock is wrong.

import { describe, it, expect } from "vitest";
import LastHeard from "../../src/js/contacts/LastHeard.js";
import EmcommMode from "../../src/js/EmcommMode.js";

const NOW = Math.floor(Date.UTC(2026, 8, 23, 12, 0, 0) / 1000);
const HOUR = 3600;
const DAY = 24 * HOUR;

describe("a time to sort and show by", () => {

    it("believes an ordinary time", () => {
        expect(LastHeard.at(NOW - HOUR, NOW)).toBe(NOW - HOUR);
    });

    it("reads a time from the future as now, rather than the future", () => {
        // the four years ahead one from the bench
        expect(LastHeard.at(NOW + 4 * 365 * DAY, NOW)).toBe(NOW);
        expect(LastHeard.at(NOW + 8 * DAY, NOW)).toBe(NOW);
    });

    it("allows a day of drift between two radios, which is not a fault", () => {
        const slightlyAhead = NOW + 6 * HOUR;
        expect(LastHeard.at(slightlyAhead, NOW)).toBe(slightlyAhead);
    });

    it("gives nothing for a radio whose clock was never set", () => {
        // before 2020 is not a clock that is wrong, it is a clock unset
        expect(LastHeard.at(0, NOW)).toBe(null);
        expect(LastHeard.at(Math.floor(Date.UTC(1970, 0, 2) / 1000), NOW)).toBe(null);
        expect(LastHeard.at(null, NOW)).toBe(null);
        expect(LastHeard.at(undefined, NOW)).toBe(null);
        expect(LastHeard.at(1.5, NOW)).toBe(null);
    });

    it("puts a station with a broken clock behind one genuinely heard since", () => {
        // sorting the way the one list does
        const broken = { name: "future clock", lastAdvert: NOW + 4 * 365 * DAY };
        const real = { name: "heard a minute ago", lastAdvert: NOW - 60 };

        const order = [broken, real]
            .sort((a, b) => (LastHeard.at(b.lastAdvert, NOW) ?? 0) - (LastHeard.at(a.lastAdvert, NOW) ?? 0))
            .map((c) => c.name);

        // read as now, the broken one is level with this moment, and anything
        // heard since outranks it; nothing can outrank a date four years ahead
        expect(order[0]).toBe("future clock");
        expect(LastHeard.at(broken.lastAdvert, NOW)).toBe(NOW);
        expect(LastHeard.at(broken.lastAdvert, NOW + 120)).toBe(NOW + 120);
    });

});

describe("the same rule the trim uses", () => {

    it("calls a future time unreadable, so EMCOMM mode will not drop that contact", () => {
        expect(LastHeard.isUnreadable(NOW + 4 * 365 * DAY, NOW)).toBe(true);
        expect(EmcommMode.hasUnreadableAge({ lastAdvert: NOW + 4 * 365 * DAY }, NOW)).toBe(true);
    });

    it("calls an unset clock unreadable too", () => {
        expect(LastHeard.isUnreadable(0, NOW)).toBe(true);
        expect(EmcommMode.hasUnreadableAge({ lastAdvert: 0 }, NOW)).toBe(true);
        expect(EmcommMode.hasUnreadableAge({}, NOW)).toBe(true);
    });

    it("believes an ordinary time, so the trim may judge that contact's age", () => {
        expect(LastHeard.isUnreadable(NOW - 100 * DAY, NOW)).toBe(false);
        expect(EmcommMode.hasUnreadableAge({ lastAdvert: NOW - 100 * DAY }, NOW)).toBe(false);
    });

});
