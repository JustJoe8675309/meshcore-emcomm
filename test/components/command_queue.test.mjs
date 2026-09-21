// One device command at a time.
//
// Every command in meshcore.js writes its bytes and then registers a `once()`
// listener for the response code it expects, on one emitter shared by the whole
// connection. Nothing ties a reply to the command that asked for it, so with two
// in flight the first Ok or Err to arrive is taken by whichever listener was
// registered first — which may belong to the other command.
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

        // b must be waiting, not racing a for the next frame off the wire
        await Promise.resolve();
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
