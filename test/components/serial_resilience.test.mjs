// Reading on through a serial line error.
//
// Found on the bench: node 1's USB bridge keeps the port open while the radio
// behind it reboots, the reboot puts a garbled byte on the line, and Web Serial
// reports a FramingError. meshcore.js logged it and stopped reading without
// saying so, and the app showed the radio as connected while hearing nothing.
// Line errors are recoverable in Web Serial: the port hands out a new stream.

import { describe, it, expect, vi, afterEach } from "vitest";
import { WebSerialConnection } from "@liamcottle/meshcore.js";
import { resilientReadLoop, RECOVERABLE_SERIAL_ERRORS } from "../../src/js/SerialResilience.js";
import "../../src/js/Connection.js";

const lineError = (name) => Object.assign(new Error(name), { name });

// a reader that hands out the given steps: a chunk of bytes, an error, or done
function reader(steps) {
    const reader = {
        released: false,
        async read() {
            const step = steps.shift();
            if(step === undefined || step === "done") return { value: undefined, done: true };
            if(step instanceof Error) throw step;
            return { value: Uint8Array.from(step), done: false };
        },
        releaseLock() { reader.released = true; },
    };
    return reader;
}

// a connection shaped like WebSerialConnection, with a port whose readable
// hands out the next reader each time it is asked, as Web Serial does after a
// line error
function connection(readers) {
    const first = readers.shift();
    const received = [];
    return {
        received,
        readBuffer: [],
        reader: first,
        serialPort: { get readable() { const next = readers.shift(); return next ? { getReader: () => next } : null; } },
        async onDataReceived(value) { received.push(Array.from(value)); this.readBuffer.push(...value); },
    };
}

afterEach(() => vi.restoreAllMocks());

describe("reading through a serial line error", () => {

    it("is what WebSerialConnection now reads with", () => {
        // installed on the class when the app's Connection module loads, before
        // any connection starts its loop
        expect(WebSerialConnection.prototype.readLoop).toBe(resilientReadLoop);
    });

    it("carries on after a framing error, on the stream the port hands out next", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const first = reader([[1, 2], lineError("FramingError")]);
        const second = reader([[3, 4], "done"]);
        const conn = connection([first, second]);

        await resilientReadLoop.call(conn);

        expect(conn.received).toEqual([[1, 2], [3, 4]]);
        expect(first.released).toBe(true);
        expect(conn.reader).toBe(second);
    });

    it("treats every error Web Serial documents as recoverable the same way", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        for(const name of RECOVERABLE_SERIAL_ERRORS){
            const conn = connection([reader([lineError(name)]), reader([[9], "done"])]);
            await resilientReadLoop.call(conn);
            expect(conn.received).toEqual([[9]]);
        }
    });

    it("drops the half frame that was buffered when the line glitched", async () => {
        // a garbled length left in the buffer would hold every later frame back
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const conn = connection([reader([[0x3e, 0x40], lineError("FramingError")]), reader(["done"])]);

        await resilientReadLoop.call(conn);

        expect(conn.readBuffer).toEqual([]);
    });

    it("still stops on a lost device, which is the pulled cable", async () => {
        // the port's own disconnect event is what tells the app; the loop just ends
        vi.spyOn(console, "error").mockImplementation(() => {});
        const lost = reader([lineError("NetworkError")]);
        const conn = connection([lost, reader([[1], "done"])]);

        await resilientReadLoop.call(conn);

        expect(conn.received).toEqual([]);
        expect(lost.released).toBe(true);
    });

    it("stops quietly when the connection is being closed", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const conn = connection([reader([new TypeError("Releasing Default reader")]), reader([[1], "done"])]);

        await resilientReadLoop.call(conn);

        expect(conn.received).toEqual([]);
        expect(error).not.toHaveBeenCalled();
    });

    it("stops if the port has no stream left to read", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const conn = connection([reader([lineError("BreakError")])]);

        await expect(resilientReadLoop.call(conn)).resolves.toBeUndefined();
    });

});
