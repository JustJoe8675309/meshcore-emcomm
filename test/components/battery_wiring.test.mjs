/**
 * The minute read feeds the voltage to Battery.js and the header reads the
 * answer from GlobalState. Battery.js is tested on its own; this checks the
 * wiring, which a green Battery suite cannot see.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import Battery from "../../src/js/Battery.js";

describe("the battery read and the charger", () => {

    let readings;

    beforeEach(() => {
        Battery.reset();
        readings = [];
        GlobalState.connection = {
            on() {}, off() {}, async close() {},
            getBatteryVoltage: async () => ({ batteryMilliVolts: readings.shift() }),
        };
        GlobalState.batteryPercentage = null;
        GlobalState.batteryMilliVolts = null;
        GlobalState.batteryCharging = false;
    });

    afterEach(() => {
        GlobalState.connection = null;
        GlobalState.batteryCharging = false;
        Battery.reset();
        vi.restoreAllMocks();
    });

    it("keeps the voltage as well as the percentage", async () => {
        readings = [3800];
        await Connection.updateBatteryPercentage();
        expect(GlobalState.batteryMilliVolts).toBe(3800);
        expect(GlobalState.batteryPercentage).toBe(50);
        expect(GlobalState.batteryCharging).toBe(false);
    });

    it("raises the charging flag when the voltage jumps, from the same read", async () => {
        readings = [3440, 3592];
        await Connection.updateBatteryPercentage();
        expect(GlobalState.batteryCharging).toBe(false);
        await Connection.updateBatteryPercentage();
        expect(GlobalState.batteryCharging).toBe(true);
        expect(GlobalState.batteryPercentage).toBe(24);
    });

    it("drops the flag when the plug comes out", async () => {
        readings = [3900, 4000, 4050, 4020];
        for(let i = 0; i < 3; i++){
            await Connection.updateBatteryPercentage();
        }
        expect(GlobalState.batteryCharging).toBe(true);
        await Connection.updateBatteryPercentage();
        expect(GlobalState.batteryCharging).toBe(false);
    });

    it("leaves the flag alone when the radio does not answer", async () => {
        readings = [3900, 4000];
        await Connection.updateBatteryPercentage();
        await Connection.updateBatteryPercentage();
        expect(GlobalState.batteryCharging).toBe(true);
        GlobalState.connection.getBatteryVoltage = async () => { throw new Error("no answer"); };
        await Connection.updateBatteryPercentage();
        expect(GlobalState.batteryCharging).toBe(true);
        expect(GlobalState.batteryPercentage).toBe(75);
    });

    it("starts the next link's trend from nothing", async () => {
        readings = [3900, 4000];
        await Connection.updateBatteryPercentage();
        await Connection.updateBatteryPercentage();
        expect(Battery.charging).toBe(true);

        // what disconnect() does with the battery, without the rest of a disconnect
        Connection.disconnect();
        expect(GlobalState.batteryCharging).toBe(false);
        expect(Battery.readings).toEqual([]);
    });

});
