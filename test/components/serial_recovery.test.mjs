// After a serial line error: setting the clock, and bounding simple reads.
//
// Once the read loop kept reading through a reboot, the app stopped needing a
// reconnect, and a reconnect was what used to set the radio's clock. On the
// bench node 1 came back from a reboot 656 seconds out. And a radio that had
// stopped answering took the settings page 37 seconds to report, because two
// simple reads each waited out the 20 second general bound in turn.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import { resilientReadLoop } from "../../src/js/SerialResilience.js";

const lineError = (name) => Object.assign(new Error(name), { name });

describe("the read loop announces a recovery", () => {

    it("emits recovered once it is reading the new stream", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const second = { async read() { return { done: true }; }, releaseLock() {} };
        const conn = {
            readBuffer: [],
            reader: { async read() { throw lineError("FramingError"); }, releaseLock() {} },
            serialPort: { readable: { getReader: () => second } },
            async onDataReceived() {},
            emit: vi.fn(),
        };

        await resilientReadLoop.call(conn);

        expect(conn.emit).toHaveBeenCalledWith("recovered", expect.objectContaining({ name: "FramingError" }));
        vi.restoreAllMocks();
    });

});

describe("putting the radio right after a line error", () => {

    let sync;
    let selfInfo;

    beforeEach(() => {
        vi.useFakeTimers();
        Connection.commandQueue = Promise.resolve();
        Connection.recovering = false;
        sync = vi.spyOn(Connection, "syncDeviceTime").mockResolvedValue(undefined);
        selfInfo = vi.spyOn(Connection, "loadSelfInfo").mockResolvedValue(undefined);
        vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        GlobalState.connection = null;
        Connection.recovering = false;
    });

    it("waits for the radio to answer, then sets its clock and reads it afresh", async () => {
        // two polls while it is still booting, then it answers
        let calls = 0;
        const radio = { getDeviceTime: vi.fn(() => ++calls <= 2 ? Promise.reject(new Error("no answer")) : Promise.resolve({ epochSecs: 1 })) };
        GlobalState.connection = radio;

        const done = Connection.onSerialRecovered(radio);
        await vi.advanceTimersByTimeAsync(3 * Connection.RECOVERY_RETRY_MILLIS + 100);
        await done;

        expect(radio.getDeviceTime).toHaveBeenCalledTimes(3);
        expect(sync).toHaveBeenCalledTimes(1);
        expect(selfInfo).toHaveBeenCalledWith(Connection.READ_TIMEOUT_MILLIS);
    });

    it("leaves the clock alone if the radio never answers", async () => {
        const radio = { getDeviceTime: vi.fn(() => Promise.reject(new Error("no answer"))) };
        GlobalState.connection = radio;

        const done = Connection.onSerialRecovered(radio);
        await vi.advanceTimersByTimeAsync((Connection.RECOVERY_ATTEMPTS + 1) * Connection.RECOVERY_RETRY_MILLIS);
        await done;

        expect(radio.getDeviceTime).toHaveBeenCalledTimes(Connection.RECOVERY_ATTEMPTS);
        expect(sync).not.toHaveBeenCalled();
    });

    it("stops if the radio is disconnected while it waits", async () => {
        const radio = { getDeviceTime: vi.fn(() => Promise.resolve({ epochSecs: 1 })) };
        GlobalState.connection = radio;

        const done = Connection.onSerialRecovered(radio);
        GlobalState.connection = null;
        await vi.advanceTimersByTimeAsync(Connection.RECOVERY_RETRY_MILLIS + 100);
        await done;

        expect(radio.getDeviceTime).not.toHaveBeenCalled();
        expect(sync).not.toHaveBeenCalled();
    });

    it("runs once for a reboot that raises several line errors", async () => {
        const radio = { getDeviceTime: vi.fn(() => Promise.resolve({ epochSecs: 1 })) };
        GlobalState.connection = radio;

        const first = Connection.onSerialRecovered(radio);
        const second = Connection.onSerialRecovered(radio);
        await vi.advanceTimersByTimeAsync(Connection.RECOVERY_RETRY_MILLIS + 100);
        await Promise.all([first, second]);

        expect(sync).toHaveBeenCalledTimes(1);
    });

    it("is wired to the connection when a radio connects", () => {
        const handlers = {};
        const radio = { on(event, cb) { handlers[event] = cb; }, off() {} };
        const recovered = vi.spyOn(Connection, "onSerialRecovered").mockResolvedValue(undefined);
        vi.spyOn(Connection, "startConnectionWatchdog").mockImplementation(() => {});

        Connection.connect(radio, "serial");
        handlers.recovered();

        expect(recovered).toHaveBeenCalledWith(radio);
    });

});

describe("bounding simple reads", () => {

    beforeEach(() => {
        vi.useFakeTimers();
        Connection.commandQueue = Promise.resolve();
    });

    afterEach(() => {
        vi.useRealTimers();
        GlobalState.connection = null;
    });

    it("gives up on a clock read after the read bound, not the general one", async () => {
        GlobalState.connection = { getDeviceTime: () => new Promise(() => {}) };

        const read = Connection.getDeviceTime();
        const outcome = read.then(() => "answered", (e) => String(e.message));

        await vi.advanceTimersByTimeAsync(Connection.READ_TIMEOUT_MILLIS + 50);
        expect(await outcome).toBe("timed out");
        expect(Connection.READ_TIMEOUT_MILLIS).toBeLessThan(Connection.COMMAND_TIMEOUT_MILLIS);
    });

    it("keeps the longer bound for the self info read at connect", async () => {
        let asked = null;
        GlobalState.connection = { getSelfInfo: (t) => { asked = t; return Promise.resolve({ name: "n" }); } };

        await Connection.loadSelfInfo();

        expect(asked).toBe(Connection.CONNECTION_TIMEOUT_MILLIS);
    });

    it("uses the read bound when a page asks for it", async () => {
        let asked = null;
        GlobalState.connection = { getSelfInfo: (t) => { asked = t; return Promise.resolve({ name: "n" }); } };

        await Connection.loadSelfInfo(Connection.READ_TIMEOUT_MILLIS);

        expect(asked).toBe(Connection.READ_TIMEOUT_MILLIS);
    });

});

describe("catching a restart that says nothing", () => {

    let sync;

    beforeEach(() => {
        Connection.commandQueue = Promise.resolve();
        sync = vi.spyOn(Connection, "syncDeviceTime").mockResolvedValue(undefined);
        vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
    });

    const radioAt = (secondsOut) => ({ getDeviceTime: async () => ({ epochSecs: Math.floor(Date.now() / 1000) - secondsOut }) });

    it("sets a clock that has slipped, as a clean reboot left node 1", async () => {
        // 204 seconds out on the bench, after a reboot that raised no line error
        GlobalState.connection = radioAt(204);
        await Connection.checkClock();
        expect(sync).toHaveBeenCalledTimes(1);
    });

    it("leaves a clock that is in step alone", async () => {
        GlobalState.connection = radioAt(2);
        await Connection.checkClock();
        expect(sync).not.toHaveBeenCalled();
    });

    it("sets a clock that is ahead as well as behind", async () => {
        GlobalState.connection = radioAt(-120);
        await Connection.checkClock();
        expect(sync).toHaveBeenCalledTimes(1);
    });

    it("says nothing and changes nothing when the radio does not answer", async () => {
        GlobalState.connection = { getDeviceTime: () => Promise.reject(new Error("no answer")) };
        await expect(Connection.checkClock()).resolves.toBeUndefined();
        expect(sync).not.toHaveBeenCalled();
    });

    it("does nothing with no radio", async () => {
        GlobalState.connection = null;
        await Connection.checkClock();
        expect(sync).not.toHaveBeenCalled();
    });

    it("runs with the battery check every minute", async () => {
        const battery = vi.spyOn(Connection, "updateBatteryPercentage").mockResolvedValue(undefined);
        const clock = vi.spyOn(Connection, "checkClock").mockResolvedValue(undefined);
        await Connection.periodicCheck();
        expect(battery).toHaveBeenCalled();
        expect(clock).toHaveBeenCalled();
    });

    it("puts the radio right after the app's own reboot command", async () => {
        // over a USB bridge the port stays open, so no reconnect sets the clock
        const radio = { reboot: vi.fn().mockResolvedValue(undefined) };
        GlobalState.connection = radio;
        const recover = vi.spyOn(Connection, "onSerialRecovered").mockResolvedValue(undefined);

        await Connection.reboot();

        expect(radio.reboot).toHaveBeenCalled();
        expect(recover).toHaveBeenCalledWith(radio);
    });

});
