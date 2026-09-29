// What the connect screen says when the browser will not do the transport at all.
//
// Reported from a phone on 29 Sep: in Brave, "you click and nothing happens". Brave
// disables Web Bluetooth by default behind brave://flags/#brave-web-bluetooth-api,
// and there `navigator.bluetooth` still exists while requestDevice rejects with
// NotFoundError -- which this code swallowed, because NotFoundError is also what a
// cancelled chooser throws. So the operator pressed Connect and got silence.
//
// The two meanings have to be told apart before the catch: the browser is asked
// whether it can do Bluetooth at all, and only then is NotFoundError read as "the
// operator closed the chooser".
//
// It is not one odd build. Firefox and Safari have no Web Bluetooth, and iOS has none
// in any browser, so this is most of the phones somebody might pick up in a hurry.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";

describe("a browser that cannot do the transport says so", () => {

    let bluetooth;
    let serial;

    beforeEach(() => {
        bluetooth = navigator.bluetooth;
        serial = navigator.serial;
        GlobalState.connectionError = null;
    });

    afterEach(() => {
        Object.defineProperty(navigator, "bluetooth", { value: bluetooth, configurable: true });
        Object.defineProperty(navigator, "serial", { value: serial, configurable: true });
        GlobalState.connectionError = null;
        vi.restoreAllMocks();
    });

    const setBluetooth = (value) => Object.defineProperty(navigator, "bluetooth", { value, configurable: true });
    const setSerial = (value) => Object.defineProperty(navigator, "serial", { value, configurable: true });

    it("names the browser problem when there is no Web Bluetooth at all", async () => {
        setBluetooth(undefined);

        const ok = await Connection.connectViaBluetooth();

        expect(ok).toBe(false);
        expect(GlobalState.connectionError).toMatch(/cannot use Bluetooth/i);
        // and points at the way that does work
        expect(GlobalState.connectionError).toMatch(/Serial|cable/i);
    });

    // the Brave case: the API is there, switched off, and requestDevice would reject
    // with the same NotFoundError a cancelled chooser throws
    it("tells the operator when Bluetooth is present but switched off", async () => {
        setBluetooth({ getAvailability: async () => false, requestDevice: async () => { throw new Error("should not be reached"); } });

        const ok = await Connection.connectViaBluetooth();

        expect(ok).toBe(false);
        expect(GlobalState.connectionError).toMatch(/turned off|no Bluetooth adapter/i);
        // the one instruction that actually fixes it
        expect(GlobalState.connectionError).toContain("brave://flags/#brave-web-bluetooth-api");
    });

    it("stays silent when the operator simply closed the chooser", async () => {
        setBluetooth({
            getAvailability: async () => true,
            requestDevice: async () => {
                const e = new Error("User cancelled");
                e.name = "NotFoundError";
                throw e;
            },
        });

        const ok = await Connection.connectViaBluetooth();

        expect(ok).toBe(false);
        // nothing to report: they chose not to pick a device
        expect(GlobalState.connectionError).toBe(null);
    });

    it("reports a real Bluetooth failure rather than swallowing it", async () => {
        setBluetooth({
            getAvailability: async () => true,
            requestDevice: async () => {
                const e = new Error("GATT boom");
                e.name = "NetworkError";
                throw e;
            },
        });

        const ok = await Connection.connectViaBluetooth();

        expect(ok).toBe(false);
        expect(GlobalState.connectionError).toMatch(/Could not connect over Bluetooth/i);
        expect(GlobalState.connectionError).toContain("GATT boom");
    });

    it("names the browser problem when there is no Web Serial", async () => {
        setSerial(undefined);

        const ok = await Connection.connectViaSerial();

        expect(ok).toBe(false);
        expect(GlobalState.connectionError).toMatch(/cannot use a USB serial cable/i);
        expect(GlobalState.connectionError).toMatch(/Bluetooth/i);
    });

    // a second attempt that gets further must not leave the first one's message on
    // screen, which would have the operator chasing a problem they already fixed
    it("clears the last message when a new attempt starts", async () => {
        setBluetooth(undefined);
        await Connection.connectViaBluetooth();
        expect(GlobalState.connectionError).not.toBe(null);

        setBluetooth({
            getAvailability: async () => true,
            requestDevice: async () => {
                const e = new Error("User cancelled");
                e.name = "NotFoundError";
                throw e;
            },
        });
        await Connection.connectViaBluetooth();

        expect(GlobalState.connectionError).toBe(null);
    });

});
