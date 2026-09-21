// Settings that the device never acknowledges.
//
// Every setter in meshcore.js resolves on an `Ok` frame, rejects on an `Err`,
// and waits for one of them with no timeout at all. Bluetooth drops frames, so a
// dropped `Ok` left the Save button stuck on "Saving..." for ever, on a radio
// that had very likely applied the change and was answering everything else.
//
// A timeout here does not mean the change failed. It means the acknowledgement
// never arrived, which is a different thing, and the message says so rather than
// reporting a clean failure the operator would act on.

import { describe, it, expect, beforeEach, vi } from "vitest";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";

function silentRadio() {
    // answers nothing at all, like a radio whose Ok frame was dropped
    return {
        on() {}, off() {},
        setAdvertName: () => new Promise(() => {}),
        setAdvertLatLong: () => new Promise(() => {}),
        setTxPower: () => new Promise(() => {}),
        setRadioParams: () => new Promise(() => {}),
        setChannel: () => new Promise(() => {}),
        setOtherParams: () => new Promise(() => {}),
    };
}

describe("a setting the radio never acknowledges", () => {

    beforeEach(() => {
        vi.useFakeTimers();
        GlobalState.connection = silentRadio();
    });

    const expectTimesOut = async (promise) => {
        const settled = promise.then(() => "resolved", (e) => e);
        await vi.advanceTimersByTimeAsync(Connection.SETTING_TIMEOUT_MILLIS + 100);
        return await settled;
    };

    it("gives up rather than waiting for ever", async () => {
        const result = await expectTimesOut(Connection.setAdvertName("KJ5HBN-EMCOMM"));
        expect(result).toBeInstanceOf(Error);
    });

    it("says the change may still have been applied", async () => {
        // the operator saving again on a change that already landed is a worse
        // outcome than telling them plainly that this is not known
        const result = await expectTimesOut(Connection.setTxPower(22));
        expect(result.message).toMatch(/may still have been applied/);
    });

    it("names which setting it was waiting on", async () => {
        const result = await expectTimesOut(Connection.setRadioParams(910525, 62500, 7, 5));
        expect(result.message).toMatch(/radio settings/);
    });

    it("bounds every setting that waits for an acknowledgement", async () => {
        const calls = [
            ["name", () => Connection.setAdvertName("x")],
            ["position", () => Connection.setAdvertLatLong(1, 2)],
            ["transmit power", () => Connection.setTxPower(22)],
            ["radio settings", () => Connection.setRadioParams(1, 2, 3, 4)],
            ["channel", () => Connection.setChannel(0, "Public", new Uint8Array(16))],
            ["add contacts mode", () => Connection.setOtherParams(true)],
        ];

        for(const [what, call] of calls){
            const result = await expectTimesOut(call());
            expect(result, `${what} waited for ever`).toBeInstanceOf(Error);
            expect(result.message).toContain(what);
        }
    });

});

describe("a setting the radio refuses", () => {

    beforeEach(() => {
        vi.useRealTimers();
        GlobalState.connection = {
            on() {}, off() {},
            setAdvertName: () => Promise.reject(new Error("device said no")),
        };
    });

    it("passes the real reason through rather than calling it a timeout", async () => {
        await expect(Connection.setAdvertName("x")).rejects.toThrow("device said no");
    });

});
