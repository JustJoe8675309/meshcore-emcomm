// One device command at a time.
//
// Every command in meshcore.js writes its bytes and then listens for the response
// code it expects, on one emitter shared by the whole connection. Nothing ties a
// reply to the command that asked for it, and the emitter hands each reply to
// every listener waiting on that code. With two commands in flight one Ok
// resolves both: the second reports the first one's answer as its own, before
// the radio has read it, and its real reply then lands on whichever command is
// next.
//
// The settings page hit exactly that. The EMCOMM group reads the device clock as
// it mounts, the page reads self info a moment later, the answers crossed, and
// every field on the page came up empty. The fields had prefilled before that
// group existed.

import { describe, it, expect, beforeEach, vi } from "vitest";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";

const defer = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

describe("Connection.exclusive", () => {

    beforeEach(() => {
        Connection.commandQueue = Promise.resolve();
    });

    it("does not start a command while another is in flight", async () => {

        const first = defer();
        const started = [];

        const a = Connection.exclusive(() => { started.push("a"); return first.promise; });
        const b = Connection.exclusive(() => { started.push("b"); return Promise.resolve("b"); });

        // b must be waiting, not racing a for the next frame off the wire. A real
        // tick, not a microtask: the timeout wrapped round each command adds a
        // couple of those before it starts
        await new Promise((r) => setTimeout(r, 0));
        expect(started).toEqual(["a"]);

        first.resolve("a");
        expect(await a).toBe("a");
        expect(await b).toBe("b");
        expect(started).toEqual(["a", "b"]);

    });

    it("keeps the results with the commands that asked for them", async () => {
        const results = await Promise.all([
            Connection.exclusive(() => Promise.resolve("self info")),
            Connection.exclusive(() => Promise.resolve("device time")),
        ]);
        expect(results).toEqual(["self info", "device time"]);
    });

    it("runs commands in the order they were asked for", async () => {
        const order = [];
        await Promise.all([
            Connection.exclusive(async () => { order.push(1); }),
            Connection.exclusive(async () => { order.push(2); }),
            Connection.exclusive(async () => { order.push(3); }),
        ]);
        expect(order).toEqual([1, 2, 3]);
    });

    it("gives a failure to its own caller and nobody else", async () => {
        const failing = Connection.exclusive(() => Promise.reject(new Error("no answer")));
        const following = Connection.exclusive(() => Promise.resolve("fine"));

        await expect(failing).rejects.toThrow("no answer");
        expect(await following).toBe("fine");
    });

    it("keeps taking commands after one fails", async () => {
        // a poisoned queue would take the whole settings page down with one
        // unanswered command, which is how this went wrong in the first place
        await Connection.exclusive(() => Promise.reject(new Error("first"))).catch(() => {});
        await Connection.exclusive(() => Promise.reject(new Error("second"))).catch(() => {});
        expect(await Connection.exclusive(() => Promise.resolve("still here"))).toBe("still here");
    });

});

describe("settings page reads, queued", () => {

    beforeEach(() => {
        Connection.commandQueue = Promise.resolve();
    });

    it("reads self info and the clock one after the other", async () => {

        const inFlight = [];
        let maxInFlight = 0;

        const track = (value) => async () => {
            inFlight.push(value);
            maxInFlight = Math.max(maxInFlight, inFlight.length);
            await new Promise((resolve) => setTimeout(resolve, 1));
            inFlight.pop();
            return value;
        };

        GlobalState.connection = {
            getSelfInfo: track({ name: "KJ5HBN" }),
            getDeviceTime: track({ epochSecs: 1 }),
        };

        // the order the settings page issues them: the child group mounts first
        const [time, selfInfo] = await Promise.all([
            Connection.getDeviceTime(),
            Connection.loadSelfInfo().then(() => GlobalState.selfInfo),
        ]);

        expect(maxInFlight).toBe(1);
        expect(time).toEqual({ epochSecs: 1 });
        expect(selfInfo).toEqual({ name: "KJ5HBN" });

        GlobalState.connection = null;

    });

});


// An emitter that behaves the way meshcore.js's does: every listener waiting on a
// code gets the reply, not just the first. That is the property that makes an
// uncollected reply dangerous, so the tests below need it rather than a stub.
function meshcoreEmitter() {
    const listeners = new Map();
    return {
        on(code, cb) { if(!listeners.has(code)) listeners.set(code, []); listeners.get(code).push(cb); },
        off(code, cb) { listeners.set(code, (listeners.get(code) ?? []).filter((f) => f !== cb)); },
        once(code, cb) {
            const wrapper = (...args) => { this.off(code, wrapper); cb(...args); };
            this.on(code, wrapper);
        },
        emit(code, ...args) { for(const cb of [...(listeners.get(code) ?? [])]) setTimeout(() => cb(...args), 0); },
        count(code) { return (listeners.get(code) ?? []).length; },
    };
}

const OK = 0;
const ERR = 1;

describe("Connection.exclusive, bounded", () => {

    beforeEach(() => {
        Connection.commandQueue = Promise.resolve();
    });

    it("abandons a command that never answers, and the queue carries on", async () => {
        // the new failure a queue brings: one lost reply would otherwise freeze
        // every command behind it until the radio was reconnected
        const hung = Connection.exclusive(() => new Promise(() => {}), 20);
        const next = Connection.exclusive(() => Promise.resolve("got through"));

        await expect(hung).rejects.toThrow("timed out");
        expect(await next).toBe("got through");
    });

    it("starts a command's clock when it runs, not when it joins the queue", async () => {
        // a setter queued behind a slow contact read must not time out for time
        // it spent waiting its turn
        const slow = Connection.exclusive(() => new Promise((r) => setTimeout(() => r("slow"), 60)), 200);
        const quick = Connection.exclusive(() => Promise.resolve("quick"), 40);

        expect(await slow).toBe("slow");
        expect(await quick).toBe("quick");
    });

});

describe("Connection.sendAwaiting", () => {

    beforeEach(() => {
        Connection.commandQueue = Promise.resolve();
    });

    it("collects a reply that nothing else was waiting for", async () => {

        // a path reset is fire and forget, but the radio still answers Ok. That Ok
        // must not reach the setter queued behind it
        const radio = meshcoreEmitter();

        const reset = Connection.sendAwaiting(radio, () => setTimeout(() => radio.emit(OK), 5), [OK, ERR], 500);

        let setterConfirmed = false;
        const setter = Connection.exclusive(() => new Promise((resolve) => {
            radio.once(OK, () => { setterConfirmed = true; resolve(); });
            // the radio has not answered the setter yet
        }), 100).catch(() => "unconfirmed");

        expect((await reset).code).toBe(OK);
        expect(await setter).toBe("unconfirmed");
        expect(setterConfirmed).toBe(false);

    });

    it("reports which reply arrived", async () => {
        const radio = meshcoreEmitter();
        const result = await Connection.sendAwaiting(radio, () => radio.emit(ERR), [OK, ERR], 500);
        expect(result.code).toBe(ERR);
    });

    it("carries on after silence rather than throwing", async () => {
        // some commands may go unanswered on some firmware; waiting briefly and
        // carrying on is what they always did
        const radio = meshcoreEmitter();
        const result = await Connection.sendAwaiting(radio, () => {}, [OK, ERR], 20);
        expect(result.code).toBe(null);
    });

    it("leaves no listener behind, answered or not", async () => {
        const radio = meshcoreEmitter();
        await Connection.sendAwaiting(radio, () => radio.emit(OK), [OK, ERR], 500);
        await Connection.sendAwaiting(radio, () => {}, [OK, ERR], 20);
        expect(radio.count(OK)).toBe(0);
        expect(radio.count(ERR)).toBe(0);
    });

    it("passes a failed send to its caller", async () => {
        const radio = meshcoreEmitter();
        const failed = Connection.sendAwaiting(radio, () => { throw new Error("link down"); }, [OK, ERR], 500);
        await expect(failed).rejects.toThrow("link down");
        expect(radio.count(OK)).toBe(0);
    });

});

describe("Connection.serialiseFrames", () => {

    it("puts one frame on the wire at a time", async () => {

        // on Bluetooth two writes at once fail with "GATT operation already in
        // progress", and the library swallows that, so the command is lost
        let writing = 0;
        let overlapped = false;
        const order = [];

        const connection = {
            async sendToRadioFrame(frame) {
                writing++;
                if(writing > 1) overlapped = true;
                await new Promise((r) => setTimeout(r, 5));
                order.push(frame);
                writing--;
            },
        };

        Connection.serialiseFrames(connection);
        await Promise.all([
            connection.sendToRadioFrame("a"),
            connection.sendToRadioFrame("b"),
            connection.sendToRadioFrame("c"),
        ]);

        expect(overlapped).toBe(false);
        expect(order).toEqual(["a", "b", "c"]);

    });

    it("gives up on a write that never finishes, and sends the next", async () => {

        const saved = Connection.FRAME_WRITE_TIMEOUT_MILLIS;
        Connection.FRAME_WRITE_TIMEOUT_MILLIS = 20;

        try {
            const sent = [];
            const connection = {
                async sendToRadioFrame(frame) {
                    if(frame === "stuck") return new Promise(() => {});
                    sent.push(frame);
                },
            };

            Connection.serialiseFrames(connection);
            const stuck = connection.sendToRadioFrame("stuck");
            const next = connection.sendToRadioFrame("next");

            await expect(stuck).rejects.toThrow("timed out");
            await next;
            expect(sent).toEqual(["next"]);
        } finally {
            Connection.FRAME_WRITE_TIMEOUT_MILLIS = saved;
        }

    });

    it("gives each connection its own line", async () => {
        // a stuck write on the last radio must not hold up the next one
        const first = { async sendToRadioFrame() { return new Promise(() => {}); } };
        const second = { sent: [], async sendToRadioFrame(frame) { this.sent.push(frame); } };

        Connection.serialiseFrames(first);
        Connection.serialiseFrames(second);

        first.sendToRadioFrame("stuck").catch(() => {});
        await second.sendToRadioFrame("hello");
        expect(second.sent).toEqual(["hello"]);
    });

    it("leaves a connection without a frame writer alone", () => {
        const stub = { on() {}, off() {} };
        expect(() => Connection.serialiseFrames(stub)).not.toThrow();
        expect(stub.sendToRadioFrame).toBeUndefined();
    });

});

describe("disconnecting", () => {

    it("does not leave the next radio queued behind the last one", async () => {
        Connection.commandQueue = Promise.resolve();
        Connection.exclusive(() => new Promise(() => {}), 60000).catch(() => {});

        GlobalState.connection = { close() {} };
        await Connection.disconnect();

        expect(await Connection.exclusive(() => Promise.resolve("fresh"))).toBe("fresh");
    });

});
