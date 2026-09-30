// One full contact read at a time.
//
// Node 3 over Bluetooth, 30 Sep: three full reads shared one link during a single
// connect -- the connect's own, plus two started by single-contact reads that got
// somebody else's answer back and fell back to reading everything. Reads at once take
// turns pass by pass, and the interleaved frames are the likeliest reason a single
// read got the wrong answer to begin with. Node 3 converged in three passes and still
// took 201 seconds.
//
// The radio here yields between frames, which is what lets a second caller arrive in
// the middle of a read. A synchronous fake cannot overlap anything.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";

const tick = () => new Promise((r) => setTimeout(r, 2));

function contact(n) {
    const publicKey = new Uint8Array(32);
    publicKey[0] = n;
    return { publicKey, advName: `c${n}`, type: 1, lastAdvert: 1 };
}

function slowRadio(total, { fail = false } = {}) {
    const all = Array.from({ length: total }, (_, i) => contact(i));
    const listeners = {};
    const emit = (code, value) => (listeners[code] ?? []).slice().forEach((cb) => cb(value));
    return {
        fullReads: 0,
        singleReads: 0,
        on(event, cb) { (listeners[event] ??= []).push(cb); },
        off(event, cb) { listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb); },
        async sendCommandGetContacts() {
            this.fullReads++;
            if(fail){ throw new Error("radio went away"); }
            emit(2, { count: total });
            for(const c of all){
                await tick();                                 // a frame at a time
                emit(3, c);
            }
            emit(4, {});
        },
        async sendToRadioFrame() {
            this.singleReads++;
        },
    };
}

describe("one full contact read at a time", () => {

    let radio;

    beforeEach(() => {
        radio = slowRadio(6);
        GlobalState.connection = radio;
        GlobalState.contacts = [];
        GlobalState.contactsAnnounced = null;
        GlobalState.contactsMissing = 0;
        Connection.contactLoadInFlight = null;
    });

    afterEach(() => {
        GlobalState.connection = null;
        Connection.contactLoadInFlight = null;
        vi.restoreAllMocks();
    });

    it("lets a second caller join the read already running, rather than start another", async () => {
        const first = Connection.loadContacts();
        await tick();                                          // it is under way
        const second = Connection.loadContacts();

        await Promise.all([first, second]);

        expect(radio.fullReads).toBe(1);
        expect(GlobalState.contacts).toHaveLength(6);
    });

    // the fallback that piled reads up on node 3
    it("makes a single-contact refresh wait for the full read instead of asking", async () => {
        const full = Connection.loadContacts();
        await tick();

        await Connection.refreshContact(contact(3).publicKey);

        expect(radio.singleReads).toBe(0);
        expect(radio.fullReads).toBe(1);
        // and by the time it returned, the read it waited on had delivered
        expect(GlobalState.contacts.map((c) => c.publicKey[0])).toContain(3);
        await full;
    });

    it("starts a fresh read once the last one has finished", async () => {
        await Connection.loadContacts();
        await Connection.loadContacts();

        expect(radio.fullReads).toBe(2);
        expect(Connection.contactLoadInFlight).toBe(null);
    });

    // a read left over from a radio that has gone must not be joined by the next one
    it("does not join a read that belongs to a different radio", async () => {
        const first = Connection.loadContacts();
        await tick();

        const another = slowRadio(3);
        GlobalState.connection = another;
        const second = Connection.loadContacts();

        await Promise.all([first, second]);

        expect(radio.fullReads).toBe(1);
        expect(another.fullReads).toBe(1);
    });

    // the old radio's read finishing late must not wipe the record of the new radio's
    // read, or the next caller on the new radio starts a duplicate after all
    it("keeps the new radio's read on the books when the old radio's read finishes late", async () => {
        const old = slowRadio(2);
        GlobalState.connection = old;
        const first = Connection.loadContacts();
        await tick();

        const fresh = slowRadio(8);
        GlobalState.connection = fresh;
        const second = Connection.loadContacts();
        await first;                                           // old read done, new still running

        const third = Connection.loadContacts();
        await Promise.all([second, third]);

        expect(fresh.fullReads).toBe(1);
    });

    it("clears the way after a read that failed, so the next one is not stuck joining it", async () => {
        GlobalState.connection = slowRadio(4, { fail: true });
        await expect(Connection.loadContacts()).rejects.toThrow();
        expect(Connection.contactLoadInFlight).toBe(null);

        GlobalState.connection = radio;
        await Connection.loadContacts();
        expect(radio.fullReads).toBe(1);
        expect(GlobalState.contacts).toHaveLength(6);
    });

    it("still refuses without a radio", async () => {
        GlobalState.connection = null;
        await expect(Connection.loadContacts()).rejects.toThrow(Connection.DISCONNECTED);
    });

});
