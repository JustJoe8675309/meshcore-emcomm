// Loading the contact list off the device.
//
// Bluetooth drops notifications under a burst. A node holding 265 contacts
// delivered 252, then 259, then 258 on consecutive reads. Counting the raw
// frames showed the loss is not in this app or in the library: only 258 ever
// arrived, all 258 were parsed, and none came after the end marker.
//
// A different few are dropped each time, which is what makes re-reading work.
// It is a query to the attached device, not a transmission, so it costs no
// airtime and nothing on the mesh hears it.

import { describe, it, expect, beforeEach } from "vitest";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";

function contact(n) {
    const publicKey = new Uint8Array(32);
    publicKey[0] = n & 0xff;
    publicKey[1] = (n >> 8) & 0xff;
    return { publicKey, type: 1, advName: `Contact ${n}`, flags: 0, outPathLen: 0 };
}

/**
 * A radio holding `total` contacts that only delivers some of them each read.
 * `drops` lists which indexes to withhold on each successive pass.
 */
function fakeRadio(total, drops = []) {
    const all = Array.from({ length: total }, (_, i) => contact(i));
    let pass = 0;
    const listeners = {};
    return {
        passes: 0,
        on(event, cb) { (listeners[event] ??= []).push(cb); },
        off(event, cb) { listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb); },
        async getContacts() {
            // ResponseCodes.ContactsStart is 2: the device always announces the
            // true total, however many it then manages to deliver
            (listeners[2] ?? []).forEach((cb) => cb({ count: total }));
            const withheld = new Set(drops[pass] ?? []);
            pass++;
            this.passes = pass;
            return all.filter((_, i) => !withheld.has(i));
        },
    };
}

describe("loading contacts from a lossy link", () => {

    beforeEach(() => {
        GlobalState.contacts = [];
        GlobalState.contactsAnnounced = null;
        GlobalState.contactsMissing = 0;
    });

    it("reads once when nothing is dropped", async () => {
        const radio = fakeRadio(10);
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(radio.passes).toBe(1);
        expect(GlobalState.contacts).toHaveLength(10);
        expect(GlobalState.contactsMissing).toBe(0);
    });

    it("re-reads and merges when the device sent fewer than it announced", async () => {
        // a different few lost each pass, as the real link behaves
        const radio = fakeRadio(10, [[1, 4, 7], [2, 4], [2]]);
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(GlobalState.contacts).toHaveLength(10);
        expect(GlobalState.contactsMissing).toBe(0);
        expect(radio.passes).toBeGreaterThan(1);
    });

    it("stops as soon as it has them all", async () => {
        const radio = fakeRadio(10, [[3], []]);
        GlobalState.connection = radio;

        await Connection.loadContacts();

        // second pass completed the set, so there is no reason for a third
        expect(radio.passes).toBe(2);
    });

    it("keeps no duplicates when a contact arrives on more than one pass", async () => {
        const radio = fakeRadio(10, [[9], [8]]);
        GlobalState.connection = radio;

        await Connection.loadContacts();

        const keys = new Set(GlobalState.contacts.map((c) => c.publicKey.join(",")));
        expect(keys.size).toBe(GlobalState.contacts.length);
        expect(GlobalState.contacts).toHaveLength(10);
    });

    it("gives up rather than looping when a pass adds nobody", async () => {
        // the same contact withheld every time, so retrying cannot help
        const radio = fakeRadio(10, [[5], [5], [5], [5], [5], [5]]);
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(radio.passes).toBe(2);
        expect(GlobalState.contacts).toHaveLength(9);
        // and it still says somebody is missing rather than quietly settling
        expect(GlobalState.contactsMissing).toBe(1);
    });

    it("stops after a bounded number of passes", async () => {
        // loses a different one each pass forever, so it must not retry for ever
        const radio = fakeRadio(20, [[0], [1], [2], [3], [4], [5], [6], [7]]);
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(radio.passes).toBeLessThanOrEqual(Connection.MAX_CONTACT_LOAD_PASSES);
    });

    it("still reports a shortfall it could not make up", async () => {
        const radio = fakeRadio(10, [[1, 2], [1, 2], [1, 2], [1, 2]]);
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(GlobalState.contactsAnnounced).toBe(10);
        expect(GlobalState.contactsMissing).toBe(2);
    });

    it("reads once when the device never says how many to expect", async () => {
        const radio = fakeRadio(10);
        // a device that sends no ContactsStart leaves nothing to compare against
        radio.getContacts = async function() {
            this.passes = (this.passes ?? 0) + 1;
            return [contact(0), contact(1)];
        };
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(radio.passes).toBe(1);
        expect(GlobalState.contactsAnnounced).toBe(null);
        expect(GlobalState.contactsMissing).toBe(0);
    });

    it("refuses when there is no radio", async () => {
        GlobalState.connection = null;
        await expect(Connection.loadContacts()).rejects.toThrow(Connection.DISCONNECTED);
    });

});
