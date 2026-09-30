// Ask the radio for what changed, not for everything.
//
// The radio streams contacts through a four-frame Bluetooth queue that drops what it
// cannot fit, and fills that queue with adverts while the list goes by, so reading all
// of them every connect loses a few every time. docs/CONTACT-READ.md has the mechanism.
//
// With the list kept between connects, the next connect asks only for contacts
// modified `since` the newest it has -- a handful of frames -- and a full read that
// comes up short can be repaired by name, because the app now knows *which* contacts
// it did not get. Every uncertain outcome falls back to the full read the app has
// always done, so the worst case is today's behaviour.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import ContactStore from "../../src/js/contacts/ContactStore.js";
import Utils from "../../src/js/Utils.js";

const SELF = new Uint8Array(32).fill(0xaa);
const SELF_HEX = Utils.bytesToHex(SELF);

function contact(n, lastMod) {
    const publicKey = new Uint8Array(32);
    publicKey[0] = n;
    publicKey[1] = 0x77;
    return {
        publicKey, advName: `c${n}`, type: 1, flags: 0, outPathLen: 0,
        outPath: new Uint8Array(64), lastAdvert: 1000 + n, advLat: 0, advLon: 0, lastMod,
    };
}

/**
 * A radio that honours `since`, answers by-key fetches, and can be told to drop
 * frames on a given read. Reads are counted by kind so a test can say which path ran.
 */
function radio(list, { dropOnRead = {} } = {}) {
    const all = [...list];
    const listeners = {};
    const emit = (code, value) => (listeners[code] ?? []).slice().forEach((cb) => cb(value));
    const r = {
        all,
        fullReads: 0,
        deltaReads: 0,
        byKeyCalls: 0,
        reads: 0,
        on(event, cb) { (listeners[event] ??= []).push(cb); },
        off(event, cb) { listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb); },
        async sendCommandGetContacts(since) {
            const idx = r.reads++;
            if(since){ r.deltaReads++; } else { r.fullReads++; }
            emit(2, { count: all.length });
            const drop = new Set(dropOnRead[idx] ?? []);
            let newest = 0;
            all.forEach((c, i) => {
                if(since && !(c.lastMod > since)) return;
                if(drop.has(i)) return;
                emit(3, c);
                if(c.lastMod > newest) newest = c.lastMod;
            });
            emit(4, { mostRecentLastmod: newest });
        },
        async sendToRadioFrame(frame) {
            if(frame[0] !== Connection.CMD_GET_CONTACT_BY_KEY) return;
            r.byKeyCalls++;
            const key = frame.slice(1);
            const found = all.find((c) => Utils.isUint8ArrayEqual(c.publicKey, key));
            setTimeout(() => {
                if(found){ emit(3, found); } else { emit(1, {}); }   // 1 = Err
            }, 0);
        },
    };
    return r;
}

const list = (n, lastMod = 100) => Array.from({ length: n }, (_, i) => contact(i, lastMod));

describe("the delta read", () => {

    beforeEach(() => {
        try { window.localStorage.clear(); } catch(e) {}
        GlobalState.selfInfo = { name: "Joe-NOCALL-GRN", publicKey: SELF };
        GlobalState.contacts = [];
        GlobalState.contactsAnnounced = null;
        GlobalState.contactsMissing = 0;
        Connection.contactLoadInFlight = null;
    });

    afterEach(() => {
        ContactStore.flush();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        vi.restoreAllMocks();
    });

    it("reads everything the first time, and keeps it", async () => {
        const r = radio(list(20));
        GlobalState.connection = r;

        await Connection.loadContacts();

        expect(r.fullReads).toBe(1);
        expect(r.deltaReads).toBe(0);
        expect(GlobalState.contacts).toHaveLength(20);
        const stored = ContactStore.load(SELF_HEX);
        expect(stored.contacts).toHaveLength(20);
        expect(stored.newestLastmod).toBe(100);
        expect(stored.announcedTotal).toBe(20);
    });

    it("asks only for what changed the next time, and does not read everything", async () => {
        const r = radio(list(20));
        GlobalState.connection = r;
        await Connection.loadContacts();
        r.fullReads = 0; r.deltaReads = 0;

        // nothing changed on the radio
        GlobalState.contacts = [];
        await Connection.loadContacts();

        expect(r.deltaReads).toBe(1);
        expect(r.fullReads).toBe(0);
        expect(GlobalState.contacts).toHaveLength(20);
        expect(GlobalState.contactsMissing).toBe(0);
    });

    it("merges the changed ones into what it already had", async () => {
        const r = radio(list(20));
        GlobalState.connection = r;
        await Connection.loadContacts();
        r.fullReads = 0; r.deltaReads = 0;

        // three stations advertised since, one of them new
        r.all[3] = { ...r.all[3], advName: "c3-renamed", lastMod: 200 };
        r.all[7] = { ...r.all[7], lastMod: 201 };
        r.all.push(contact(99, 202));
        GlobalState.contacts = [];

        await Connection.loadContacts();

        expect(r.deltaReads).toBe(1);
        expect(r.fullReads).toBe(0);
        expect(GlobalState.contacts).toHaveLength(21);
        expect(GlobalState.contacts.find((c) => c.publicKey[0] === 3).advName).toBe("c3-renamed");
        expect(ContactStore.load(SELF_HEX).newestLastmod).toBe(202);
    });

    it("tries the delta once more when a frame of it was dropped, before anything heavier", async () => {
        // read #1 is the first delta; it drops the frame at index 20, a new station
        const r = radio(list(20), { dropOnRead: { 1: [20] } });
        GlobalState.connection = r;
        await Connection.loadContacts();
        r.all.push(contact(99, 200));
        r.all.push(contact(98, 201));
        GlobalState.contacts = [];
        r.fullReads = 0; r.deltaReads = 0;

        await Connection.loadContacts();

        expect(r.deltaReads).toBe(2);
        expect(r.fullReads).toBe(0);
        expect(GlobalState.contacts).toHaveLength(22);
    });

    // the radio holds fewer than the store: contacts were evicted while away and
    // the pushes that would have said so were never seen. Nothing to delta against
    it("falls back to a full read when the radio holds fewer than it remembers", async () => {
        const r = radio(list(20));
        GlobalState.connection = r;
        await Connection.loadContacts();
        r.all.splice(0, 5);                                   // five gone from the radio
        GlobalState.contacts = [];
        r.fullReads = 0; r.deltaReads = 0;

        await Connection.loadContacts();

        // recognised on the first delta, not retried: the count already says a
        // second delta could not help
        expect(r.deltaReads).toBe(1);
        expect(r.fullReads).toBe(1);
        expect(GlobalState.contacts).toHaveLength(15);
        expect(ContactStore.load(SELF_HEX).contacts).toHaveLength(15);
    });

    // the radio's clock went backwards, so nothing is "newer than" the stored mark
    // even though there are contacts the store never saw
    it("falls back to a full read when a delta cannot account for the count", async () => {
        const r = radio(list(20, 100));
        GlobalState.connection = r;
        await Connection.loadContacts();
        r.all.push(contact(50, 10));                            // new, but an old-looking lastMod
        r.all.push(contact(51, 11));
        GlobalState.contacts = [];
        r.fullReads = 0; r.deltaReads = 0;

        await Connection.loadContacts();

        expect(r.fullReads).toBe(1);
        expect(GlobalState.contacts).toHaveLength(22);
    });

    // Restored by hand, not by restoreAllMocks: left in place, these spies poisoned
    // every test after this one in the file -- no store to read, nothing saved -- and
    // the repair and save tests below failed for a reason that had nothing to do
    // with the code they test. Found by running the same scenario in isolation.
    it("behaves like a first connect when storage is refused", async () => {
        const getItem = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
        const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
        try {
            const r = radio(list(12));
            GlobalState.connection = r;

            await Connection.loadContacts();

            expect(r.fullReads).toBe(1);
            expect(GlobalState.contacts).toHaveLength(12);
        } finally {
            getItem.mockRestore();
            setItem.mockRestore();
        }
    });

});

describe("repairing a short full read by name", () => {

    beforeEach(() => {
        try { window.localStorage.clear(); } catch(e) {}
        GlobalState.selfInfo = { name: "Joe-NOCALL-GRN", publicKey: SELF };
        GlobalState.contacts = [];
        GlobalState.contactsAnnounced = null;
        GlobalState.contactsMissing = 0;
        Connection.contactLoadInFlight = null;
    });

    afterEach(() => {
        ContactStore.flush();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        vi.restoreAllMocks();
    });

    // the store knows which ones the read did not deliver, so it asks for those
    // by key -- one frame each -- instead of streaming the whole list again
    it("fetches the ones it knows it is missing, one frame apiece", async () => {
        const r = radio(list(20));
        GlobalState.connection = r;
        await Connection.loadContacts();                       // store now has 20

        // radio holds fewer -> full read; and that full read drops the same two on
        // every pass, which the pass-merge can never recover
        r.all.splice(19, 1);
        const stubborn = { 1: [2, 9], 2: [2, 9], 3: [2, 9], 4: [2, 9], 5: [2, 9], 6: [2, 9], 7: [2, 9], 8: [2, 9], 9: [2, 9] };
        const r2 = radio(r.all, { dropOnRead: stubborn });
        GlobalState.connection = r2;
        GlobalState.contacts = [];

        await Connection.loadContacts();

        expect(r2.fullReads).toBeGreaterThan(0);
        // exactly the two the read kept dropping: not the ones already in hand, and
        // not the one the radio no longer holds, because the count was met first
        expect(r2.byKeyCalls).toBe(2);
        expect(GlobalState.contacts).toHaveLength(19);
        expect(GlobalState.contactsMissing).toBe(0);
    });

    it("drops a remembered contact the radio says it no longer holds", async () => {
        const r = radio(list(10));
        GlobalState.connection = r;
        await Connection.loadContacts();

        // radio lost #4; and the full read that follows keeps dropping #7
        r.all.splice(4, 1);
        const r2 = radio(r.all, { dropOnRead: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i, [6]])) });
        GlobalState.connection = r2;
        GlobalState.contacts = [];

        await Connection.loadContacts();

        expect(GlobalState.contacts).toHaveLength(9);
        expect(GlobalState.contacts.some((c) => c.publicKey[0] === 4)).toBe(false);
        expect(ContactStore.load(SELF_HEX).contacts.some((c) => c.publicKey[0] === 4)).toBe(false);
    });

    it("does nothing by key when there is nothing remembered to ask for", async () => {
        const r = radio(list(10), { dropOnRead: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i, [3]])) });
        GlobalState.connection = r;

        await Connection.loadContacts();

        expect(r.byKeyCalls).toBe(0);
        expect(GlobalState.contacts).toHaveLength(9);
        expect(GlobalState.contactsMissing).toBe(1);           // still honest about it
    });

});

describe("keeping the store current between connects", () => {

    beforeEach(() => {
        vi.useFakeTimers();
        try { window.localStorage.clear(); } catch(e) {}
        GlobalState.selfInfo = { name: "Joe-NOCALL-GRN", publicKey: SELF };
        GlobalState.contacts = list(5);
        GlobalState.contactsAnnounced = 5;
        GlobalState.contactsMissing = 0;
    });

    afterEach(() => {
        ContactStore.flush();
        vi.useRealTimers();
        GlobalState.selfInfo = null;
        GlobalState.contacts = [];
    });

    it("writes a contact the radio pushed, so the next delta does not need it", () => {
        Connection.mergeContact(contact(40, 500));
        vi.advanceTimersByTime(ContactStore.SAVE_DELAY_MILLIS + 10);

        const stored = ContactStore.load(SELF_HEX);
        expect(stored.contacts.some((c) => c.publicKey[0] === 40)).toBe(true);
        expect(stored.newestLastmod).toBe(500);
    });

    it("forgets a contact the radio evicted", () => {
        Connection.mergeContact(contact(40, 500));
        Connection.forgetContact(contact(2, 100).publicKey);
        vi.advanceTimersByTime(ContactStore.SAVE_DELAY_MILLIS + 10);

        expect(ContactStore.load(SELF_HEX).contacts.some((c) => c.publicKey[0] === 2)).toBe(false);
    });

    // a busy mesh pushes several times a minute; the store only has to be right by
    // the next connect
    it("coalesces a burst of pushes into one write", () => {
        const writes = vi.spyOn(window.localStorage, "setItem");
        try {
            for(let i = 0; i < 12; i++){
                Connection.mergeContact(contact(60 + i, 600 + i));
            }
            // one timer for the burst, not one per push piling up
            expect(vi.getTimerCount()).toBe(1);
            vi.advanceTimersByTime(ContactStore.SAVE_DELAY_MILLIS + 10);

            expect(writes).toHaveBeenCalledTimes(1);
        } finally {
            writes.mockRestore();
        }
    });

});

describe("the store itself", () => {

    afterEach(() => {
        try { window.localStorage.clear(); } catch(e) {}
    });

    // the same shape as the node backup, so the two cannot drift apart
    it("round-trips a contact through the serialised shape", () => {
        const c = contact(5, 123);
        const back = ContactStore.deserialise(ContactStore.serialise(c));
        expect(Utils.bytesToHex(back.publicKey)).toBe(Utils.bytesToHex(c.publicKey));
        expect(back.advName).toBe("c5");
        expect(back.lastMod).toBe(123);
        expect(back.outPath).toHaveLength(64);
    });

    it("finds the newest lastmod, and calls an empty list zero", () => {
        expect(ContactStore.newest([contact(1, 5), contact(2, 9), contact(3, 7)])).toBe(9);
        expect(ContactStore.newest([])).toBe(0);
    });

    it("treats an unreadable entry as nothing stored", () => {
        window.localStorage.setItem(ContactStore.key("ab"), "{not json");
        expect(ContactStore.load("ab")).toBe(null);
        window.localStorage.setItem(ContactStore.key("ab"), JSON.stringify({ formatVersion: 99, contacts: [] }));
        expect(ContactStore.load("ab")).toBe(null);
    });

    it("has nothing for a node it has never seen, and nothing without a node", () => {
        expect(ContactStore.load("cd")).toBe(null);
        expect(ContactStore.load(null)).toBe(null);
        expect(ContactStore.save(null, [], 0, 0)).toBe(false);
    });

});
