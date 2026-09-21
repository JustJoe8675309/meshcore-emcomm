// Repeating adverts.
//
// The two kinds cost very different amounts of air: a zero hop advert is heard
// only by stations in direct range, a flood routed one is rebroadcast by every
// repeater that hears it. A timer that fires the wrong one, fires too often, or
// fires when the operator thought it was off, transmits without anybody watching.
// So the rules about what a typed number means are tested rather than assumed.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import AdvertSchedule from "../../src/js/AdvertSchedule.js";
import GlobalState from "../../src/js/GlobalState.js";

const NODE = "aabbccdd";

describe("AdvertSchedule.normaliseMinutes", () => {

    it("reads a cleared field as off", () => {
        // an operator who emptied the box meant to stop it, not to send every 0 min
        expect(AdvertSchedule.normaliseMinutes("")).toBe(0);
        expect(AdvertSchedule.normaliseMinutes(null)).toBe(0);
        expect(AdvertSchedule.normaliseMinutes(undefined)).toBe(0);
    });

    it("reads zero and negatives as off rather than as intervals", () => {
        expect(AdvertSchedule.normaliseMinutes(0)).toBe(0);
        expect(AdvertSchedule.normaliseMinutes(-15)).toBe(0);
    });

    it("reads nonsense as off, because off transmits nothing", () => {
        expect(AdvertSchedule.normaliseMinutes("soon")).toBe(0);
        expect(AdvertSchedule.normaliseMinutes(Infinity)).toBe(0);
    });

    it("keeps a sensible number, from the string a text field gives it", () => {
        expect(AdvertSchedule.normaliseMinutes("15")).toBe(15);
        expect(AdvertSchedule.normaliseMinutes(60)).toBe(60);
    });

    it("rounds a fraction to a whole minute instead of transmitting on a fraction", () => {
        expect(AdvertSchedule.normaliseMinutes(2.4)).toBe(2);
        expect(AdvertSchedule.normaliseMinutes(0.4)).toBe(0);
    });

    it("clamps a slip of the keyboard rather than arming a day-long timer", () => {
        expect(AdvertSchedule.normaliseMinutes(999999)).toBe(AdvertSchedule.MAX_MINUTES);
    });

});

describe("AdvertSchedule flood caution", () => {

    it("warns under an hour, where the whole mesh pays for the repeat", () => {
        expect(AdvertSchedule.isFloodTooFast(5)).toBe(true);
        expect(AdvertSchedule.isFloodTooFast(59)).toBe(true);
    });

    it("does not warn at an hour or slower", () => {
        expect(AdvertSchedule.isFloodTooFast(60)).toBe(false);
        expect(AdvertSchedule.isFloodTooFast(120)).toBe(false);
    });

    it("does not warn about a schedule that is off", () => {
        expect(AdvertSchedule.isFloodTooFast(0)).toBe(false);
        expect(AdvertSchedule.isFloodTooFast("")).toBe(false);
    });

});

describe("AdvertSchedule storage", () => {

    beforeEach(() => window.localStorage.clear());

    it("reads as off for a node that has never been set", () => {
        expect(AdvertSchedule.get(NODE)).toEqual({ zeroHopMinutes: 0, floodMinutes: 0 });
    });

    it("stores and reads back both intervals", () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: "10", floodMinutes: "120" });
        expect(AdvertSchedule.get(NODE)).toEqual({ zeroHopMinutes: 10, floodMinutes: 120 });
    });

    it("keeps each node's schedule to itself", () => {
        // a handheld and a base are the same app and different stations
        AdvertSchedule.set(NODE, { zeroHopMinutes: 10, floodMinutes: 0 });
        expect(AdvertSchedule.get("99887766")).toEqual({ zeroHopMinutes: 0, floodMinutes: 0 });
    });

    it("reads a corrupt entry as off rather than throwing on page load", () => {
        window.localStorage.setItem(`advert_schedule:${NODE}`, "{not json");
        expect(AdvertSchedule.get(NODE)).toEqual({ zeroHopMinutes: 0, floodMinutes: 0 });
    });

    it("reports what it actually stored, not what it was handed", () => {
        const saved = AdvertSchedule.set(NODE, { zeroHopMinutes: 2.6, floodMinutes: "nope" });
        expect(saved).toEqual({ zeroHopMinutes: 3, floodMinutes: 0 });
    });

});

describe("AdvertSchedule timers", () => {

    let zeroHop;
    let flood;

    beforeEach(() => {
        vi.useFakeTimers();
        window.localStorage.clear();
        zeroHop = vi.fn().mockResolvedValue(undefined);
        flood = vi.fn().mockResolvedValue(undefined);
        GlobalState.connection = {
            sendZeroHopAdvert: zeroHop,
            sendFloodAdvert: flood,
        };
    });

    afterEach(() => {
        AdvertSchedule.stop();
        GlobalState.connection = null;
        vi.useRealTimers();
    });

    it("sends nothing the moment it starts", async () => {
        // otherwise every page reload puts a burst on the air, and during testing
        // the page is reloaded constantly
        AdvertSchedule.set(NODE, { zeroHopMinutes: 10, floodMinutes: 60 });
        AdvertSchedule.start(NODE);
        expect(zeroHop).not.toHaveBeenCalled();
        expect(flood).not.toHaveBeenCalled();
    });

    it("sends a zero hop advert once its interval has passed", async () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: 10, floodMinutes: 0 });
        AdvertSchedule.start(NODE);

        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(zeroHop).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(zeroHop).toHaveBeenCalledTimes(2);

        // the kind that was left off stays off
        expect(flood).not.toHaveBeenCalled();
    });

    it("runs the two kinds on their own intervals", async () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: 10, floodMinutes: 60 });
        AdvertSchedule.start(NODE);

        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
        expect(zeroHop).toHaveBeenCalledTimes(6);
        expect(flood).toHaveBeenCalledTimes(1);
    });

    it("stops sending once stopped", async () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: 10, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        AdvertSchedule.stop();

        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
        expect(zeroHop).not.toHaveBeenCalled();
        expect(AdvertSchedule.running()).toEqual([]);
    });

    it("does not double the transmit rate when started twice", async () => {
        // the settings page can be opened, left and opened again in one session
        AdvertSchedule.set(NODE, { zeroHopMinutes: 10, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        AdvertSchedule.start(NODE);

        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(zeroHop).toHaveBeenCalledTimes(1);
    });

    it("starts nothing for a node with both turned off", async () => {
        AdvertSchedule.start(NODE);
        expect(AdvertSchedule.running()).toEqual([]);

        await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
        expect(zeroHop).not.toHaveBeenCalled();
        expect(flood).not.toHaveBeenCalled();
    });

    it("keeps running after a failed advert", async () => {
        // a busy radio refusing one advert must not silently end the schedule
        zeroHop.mockRejectedValueOnce(new Error("busy"));
        AdvertSchedule.set(NODE, { zeroHopMinutes: 10, floodMinutes: 0 });
        AdvertSchedule.start(NODE);

        await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
        expect(zeroHop).toHaveBeenCalledTimes(2);
    });

    it("sends nothing at all with no radio connected", async () => {
        GlobalState.connection = null;
        AdvertSchedule.set(NODE, { zeroHopMinutes: 10, floodMinutes: 0 });
        AdvertSchedule.start(NODE);

        await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
        expect(zeroHop).not.toHaveBeenCalled();
    });

});
