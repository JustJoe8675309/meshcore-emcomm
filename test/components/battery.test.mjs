/**
 * Charging is inferred from the voltage, because the radio reports millivolts
 * and nothing about the charger. These pin down what counts: a rise a drain
 * cannot make, held while the cell sits near full, and let go when the lift
 * leaves with the plug.
 *
 * The figures come from the bench drains at one reading a minute, 8 mV a point:
 * the reading bounces up to 2 points either way (16 mV), a drain falls under a
 * millivolt a minute, and a charger lifted node 2 from 5% to 24% (152 mV)
 * between one reading and the next.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Battery from "../../src/js/Battery.js";

const feed = (...millivolts) => millivolts.map((mv) => Battery.observe(mv));

describe("telling a charger from a drain", () => {

    beforeEach(() => {
        Battery.reset();
    });

    it("says nothing from a single reading", () => {
        expect(Battery.observe(3800)).toBe(false);
        expect(Battery.observe(4100)).toBe(true);
    });

    it("never calls a drain a charger, bounce included", () => {
        // 26/24/26/24 at 8 mV a point, then on down: node 2's afternoon
        const seen = feed(3608, 3592, 3608, 3592, 3608, 3592, 3576, 3576, 3560, 3576, 3560, 3544);
        expect(seen.every((x) => x === false)).toBe(true);
    });

    it("calls the plug-in at once when the voltage jumps", () => {
        // 5% to 24% between one reading and the next
        expect(feed(3440, 3440, 3592)).toEqual([false, false, true]);
    });

    it("sees a slow charge build over the window, not just a jump", () => {
        // 10 mV a minute: under the mark against the previous reading, over it
        // against the start of the window
        expect(feed(3700, 3710, 3720, 3730)).toEqual([false, false, false, true]);
    });

    it("catches the slow climb of a reconnect in the middle of a charge", () => {
        // node 2 at 33-35% on 30 Sep: two points in the first minute, then
        // nothing for four. A five-minute window never saw a charger here.
        // At 2 mV a minute it is 30 mV after fifteen readings, inside the half hour
        const seen = feed(...Array.from({ length: 16 }, (_, i) => 3664 + 2 * i));
        expect(seen.slice(0, 15).every((x) => x === false)).toBe(true);
        expect(seen[15]).toBe(true);
    });

    it("does not let a bounce three points up count", () => {
        expect(feed(3600, 3624)).toEqual([false, false]);
    });

    it("holds while a nearly full cell stops rising", () => {
        feed(3900, 4000);
        expect(feed(4190, 4195, 4198, 4200, 4200, 4200, 4200, 4200).every((x) => x === true)).toBe(true);
    });

    it("rides a bounce down while charging without letting go", () => {
        feed(3900, 4000);
        expect(Battery.observe(3984)).toBe(true);
    });

    it("lets go when the lift leaves with the plug", () => {
        feed(3900, 4000, 4050);
        expect(Battery.observe(4020)).toBe(false);
    });

    it("judges the next charger against readings taken after the unplug", () => {
        feed(3900, 4000, 4050, 4020);
        // the unplugged cell settles lower, then drains: still not a charger,
        // even though these are all well above where the last window started
        expect(feed(4010, 4005, 4000)).toEqual([false, false, false]);
        expect(Battery.observe(4040)).toBe(true);
    });

    it("only compares across the last half hour", () => {
        // a creep of 1 mV a minute is 30 mV over the thirty-one readings the
        // window holds, so the thirty-first counts
        const creep = feed(...Array.from({ length: 31 }, (_, i) => 3700 + i));
        expect(creep.slice(0, 30).every((x) => x === false)).toBe(true);
        expect(creep[30]).toBe(true);
        Battery.reset();
        // the window drops the oldest: at 0.9 mV a minute, no 31 consecutive
        // readings ever span 30, however long it goes on
        const slower = feed(...Array.from({ length: 80 }, (_, i) => 3700 + Math.floor(i * 0.9)));
        expect(slower.every((x) => x === false)).toBe(true);
        expect(Battery.readings.length).toBe(31);
    });

    it("never calls a long drain with bounce a charger, over hours", () => {
        // 3.8 points an hour, 8 mV a point, sampled once a minute with a two-point
        // bounce every other reading: eight hours of node 2's afternoon
        const readings = Array.from({ length: 480 }, (_, i) => Math.round(3800 - i * 0.5) + (i % 2 ? 16 : 0));
        expect(feed(...readings).every((x) => x === false)).toBe(true);
    });

    it("ignores a reading that is not a number", () => {
        feed(3600);
        expect(Battery.observe(undefined)).toBe(false);
        expect(Battery.observe(NaN)).toBe(false);
        expect(Battery.readings).toEqual([3600]);
    });

    it("forgets the old link's readings on reset", () => {
        feed(3900, 4000);
        expect(Battery.charging).toBe(true);
        Battery.reset();
        expect(Battery.charging).toBe(false);
        expect(Battery.observe(4000)).toBe(false);
    });

});
