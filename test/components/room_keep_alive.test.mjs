// Holding a room session open, so its posts keep arriving.
//
// From the bench, 22 September 2026: node 1 posted a roll call into a room both
// nodes were logged into as admins, the room acknowledged it in 794 ms, and node
// 2 heard nothing for minutes. The room had counted three failed pushes to node 2
// and stopped pushing to it, which nothing in the app ever cleared — logging in
// again with a blank password takes the ACL path, which resets none of it. One
// keep-alive request and the post arrived within seconds.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import RoomKeepAlive from "../../src/js/rooms/RoomKeepAlive.js";
import GlobalState from "../../src/js/GlobalState.js";

const ROOM = new Uint8Array(32).fill(0x87);
const OTHER = new Uint8Array(32).fill(0x57);

function fakeConnection() {
    return {
        sent: [],
        async sendCommandSendBinaryReq(publicKey, params) {
            this.sent.push({ publicKey, params });
        },
    };
}

const since = (params) => params[1] | (params[2] << 8) | (params[3] << 16) | (params[4] << 24);

describe("room keep-alive", () => {

    let connection;

    beforeEach(() => {
        vi.useFakeTimers();
        connection = fakeConnection();
        GlobalState.connection = connection;
        RoomKeepAlive.stopAll();
    });

    afterEach(() => {
        RoomKeepAlive.stopAll();
        vi.useRealTimers();
        GlobalState.connection = null;
    });

    it("sends one the moment a room is logged in to, rather than waiting out the interval", async () => {
        RoomKeepAlive.start(ROOM);
        await vi.advanceTimersByTimeAsync(0);

        expect(connection.sent).toHaveLength(1);
        expect(connection.sent[0].publicKey).toBe(ROOM);
        expect(connection.sent[0].params[0]).toBe(0x02); // REQ_TYPE_KEEP_ALIVE
    });

    it("keeps sending them for as long as the session lasts", async () => {
        RoomKeepAlive.start(ROOM);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(RoomKeepAlive.INTERVAL_MILLIS * 3);

        expect(connection.sent).toHaveLength(4);
    });

    it("asks for nothing in particular until a post has actually been seen", async () => {
        RoomKeepAlive.start(ROOM);
        await vi.advanceTimersByTimeAsync(0);

        // zero leaves the room's own since stamp alone, which is right when there
        // is nothing received to know better from
        expect(since(connection.sent[0].params)).toBe(0);
    });

    it("carries the newest post received, so a recovered session asks only for what it missed", async () => {
        RoomKeepAlive.start(ROOM);
        await vi.advanceTimersByTimeAsync(0);

        RoomKeepAlive.notePost(ROOM, 1790129498);
        await vi.advanceTimersByTimeAsync(RoomKeepAlive.INTERVAL_MILLIS);

        expect(since(connection.sent[1].params)).toBe(1790129498);
    });

    it("never moves the since stamp backwards, whatever order posts arrive in", async () => {
        RoomKeepAlive.notePost(ROOM, 1790129498);
        RoomKeepAlive.notePost(ROOM, 1790120000);
        RoomKeepAlive.start(ROOM);
        await vi.advanceTimersByTimeAsync(0);

        expect(since(connection.sent[0].params)).toBe(1790129498);
    });

    it("ignores a post with no usable time, rather than asking the room for everything since 1970", async () => {
        RoomKeepAlive.notePost(ROOM, 0);
        RoomKeepAlive.notePost(ROOM, null);
        RoomKeepAlive.notePost(ROOM, undefined);
        RoomKeepAlive.start(ROOM);
        await vi.advanceTimersByTimeAsync(0);

        expect(since(connection.sent[0].params)).toBe(0);
    });

    it("keeps each room's place separately", async () => {
        RoomKeepAlive.notePost(ROOM, 1790129498);
        RoomKeepAlive.notePost(OTHER, 1790100000);
        RoomKeepAlive.start(ROOM);
        RoomKeepAlive.start(OTHER);
        await vi.advanceTimersByTimeAsync(0);

        const byRoom = new Map(connection.sent.map((s) => [s.publicKey, since(s.params)]));
        expect(byRoom.get(ROOM)).toBe(1790129498);
        expect(byRoom.get(OTHER)).toBe(1790100000);
    });

    it("does not start a second timer for a room already being kept alive", async () => {
        RoomKeepAlive.start(ROOM);
        RoomKeepAlive.start(ROOM);
        await vi.advanceTimersByTimeAsync(0);
        connection.sent.length = 0;

        await vi.advanceTimersByTimeAsync(RoomKeepAlive.INTERVAL_MILLIS);
        expect(connection.sent).toHaveLength(1);
    });

    it("stops when the radio goes away, since the session went with it", async () => {
        RoomKeepAlive.start(ROOM);
        await vi.advanceTimersByTimeAsync(0);

        RoomKeepAlive.stopAll();
        expect(RoomKeepAlive.isRunning(ROOM)).toBe(false);

        connection.sent.length = 0;
        await vi.advanceTimersByTimeAsync(RoomKeepAlive.INTERVAL_MILLIS * 2);
        expect(connection.sent).toHaveLength(0);
    });

    it("forgets where it had got to once the radio is gone, so a new radio is not sent a stranger's since stamp", async () => {
        RoomKeepAlive.notePost(ROOM, 1790129498);
        RoomKeepAlive.stopAll();

        RoomKeepAlive.start(ROOM);
        await vi.advanceTimersByTimeAsync(0);
        expect(since(connection.sent[0].params)).toBe(0);
    });

    it("carries on after a send fails, because a radio that is busy now may not be in two minutes", async () => {
        connection.sendCommandSendBinaryReq = vi.fn()
            .mockRejectedValueOnce(new Error("busy"))
            .mockResolvedValue(undefined);

        RoomKeepAlive.start(ROOM);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(RoomKeepAlive.INTERVAL_MILLIS);

        expect(connection.sendCommandSendBinaryReq).toHaveBeenCalledTimes(2);
    });

    it("sends nothing at all when there is no radio", async () => {
        GlobalState.connection = null;
        expect(await RoomKeepAlive.send(ROOM)).toBe(false);
    });

});
