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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
function fakeRadio(total, drops = [], { dropEndMarkerOnPass = [] } = {}) {
    const all = Array.from({ length: total }, (_, i) => contact(i));
    let pass = 0;
    const listeners = {};
    const emit = (code, value) => (listeners[code] ?? []).slice().forEach((cb) => cb(value));
    return {
        passes: 0,
        on(event, cb) { (listeners[event] ??= []).push(cb); },
        off(event, cb) { listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb); },
        // the app sends the command and collects the frames itself, because the
        // library waits for an end marker that Bluetooth sometimes drops
        async sendCommandGetContacts() {
            const thisPass = pass++;
            this.passes = pass;
            emit(2, { count: total });                       // ContactsStart
            const withheld = new Set(drops[thisPass] ?? []);
            all.filter((_, i) => !withheld.has(i)).forEach((c) => emit(3, c));
            if(!dropEndMarkerOnPass.includes(thisPass)){
                emit(4, {});                                 // EndOfContacts
            }
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

    it("finishes a read whose end marker never arrived", async () => {
        // getContacts in meshcore.js waits for EndOfContacts with no timeout, so
        // a dropped end marker left the app waiting for ever on a radio that was
        // answering everything else. It happened mid way through a conversion.
        const radio = fakeRadio(10, [], { dropEndMarkerOnPass: [0] });
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(GlobalState.contacts).toHaveLength(10);
        expect(GlobalState.contactsMissing).toBe(0);
    }, 30000);

    it("reads once when the device never says how many to expect", async () => {
        // older firmware sends no ContactsStart, leaving nothing to compare
        // against, so there is no basis for asking again
        const listeners = {};
        const radio = {
            passes: 0,
            on(event, cb) { (listeners[event] ??= []).push(cb); },
            off(event, cb) { listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb); },
            async sendCommandGetContacts() {
                this.passes++;
                (listeners[3] ?? []).forEach((cb) => { cb(contact(0)); cb(contact(1)); });
                (listeners[4] ?? []).forEach((cb) => cb({}));
            },
        };
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(radio.passes).toBe(1);
        expect(GlobalState.contacts).toHaveLength(2);
        expect(GlobalState.contactsAnnounced).toBe(null);
        expect(GlobalState.contactsMissing).toBe(0);
    });

    it("refuses when there is no radio", async () => {
        GlobalState.connection = null;
        await expect(Connection.loadContacts()).rejects.toThrow(Connection.DISCONNECTED);
    });

});

// A roster that takes longer than any fixed budget.
//
// Node 2's list grew to 198 and its reads stopped dead at 131, twice in a row and
// at the same place every pass: the read was capped at 20 seconds from its start
// whether contacts were arriving or not, and over Bluetooth a contact costs
// several notifications. The merge loop then gave up as well, because a second
// pass cut off in the same place adds nobody. A third of the roster was missing,
// and with the way home now refusing to be written short, that blocked the mode
// switch too.
describe("a read the radio is still answering", () => {

    const timings = {
        max: Connection.CONTACT_READ_MAX_MILLIS,
        first: Connection.CONTACT_READ_TIMEOUT_MILLIS,
        quiet: Connection.CONTACT_READ_QUIET_MILLIS,
    };

    beforeEach(() => {
        GlobalState.contacts = [];
        GlobalState.contactsAnnounced = null;
        GlobalState.contactsMissing = 0;
    });

    afterEach(() => {
        // these tests shorten the real timings, and the next test is entitled to
        // the shipped ones
        Connection.CONTACT_READ_MAX_MILLIS = timings.max;
        Connection.CONTACT_READ_TIMEOUT_MILLIS = timings.first;
        Connection.CONTACT_READ_QUIET_MILLIS = timings.quiet;
    });

    // a radio that trickles its contacts out slower than the old budget allowed
    function slowRadio(total, perTick, tickMillis) {
        const all = Array.from({ length: total }, (_, i) => contact(i));
        const listeners = {};
        const emit = (code, value) => (listeners[code] ?? []).slice().forEach((cb) => cb(value));
        return {
            on(event, cb) { (listeners[event] ??= []).push(cb); },
            off(event, cb) { listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb); },
            async sendCommandGetContacts() {
                emit(2, { count: total });
                let sent = 0;
                const tick = () => {
                    for(let i = 0; i < perTick && sent < total; i++){
                        emit(3, all[sent++]);
                    }
                    if(sent < total){
                        setTimeout(tick, tickMillis);
                    } else {
                        emit(4, {});
                    }
                };
                setTimeout(tick, tickMillis);
            },
        };
    }

    it("keeps reading while contacts are still arriving, however long the list is", async () => {
        Connection.CONTACT_READ_MAX_MILLIS = 90000;
        Connection.CONTACT_READ_TIMEOUT_MILLIS = 300;
        GlobalState.connection = slowRadio(60, 2, 20);

        await Connection.loadContacts();

        expect(GlobalState.contacts).toHaveLength(60);
        expect(GlobalState.contactsMissing).toBe(0);
    });

    it("still gives up on a radio that answers nothing at all", async () => {
        Connection.CONTACT_READ_TIMEOUT_MILLIS = 200;
        const listeners = {};
        GlobalState.connection = {
            on(event, cb) { (listeners[event] ??= []).push(cb); },
            off(event, cb) { listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb); },
            async sendCommandGetContacts() { /* silence */ },
        };

        const started = Date.now();
        await Connection.loadContacts();

        expect(GlobalState.contacts).toHaveLength(0);
        expect(Date.now() - started).toBeLessThan(5000);
    });

    it("stops soon after the frames stop, rather than holding the link open", async () => {
        Connection.CONTACT_READ_QUIET_MILLIS = 150;
        Connection.CONTACT_READ_MAX_MILLIS = 90000;
        GlobalState.connection = fakeRadio(10, [[]], { dropEndMarkerOnPass: [0] });

        const started = Date.now();
        await Connection.loadContacts();

        expect(GlobalState.contacts).toHaveLength(10);
        expect(Date.now() - started).toBeLessThan(3000);
    });

});

// The radio holds the iterator, not the app.
//
// The firmware streams one contact per pass of its serial loop, from an iterator
// it keeps, and answers a fresh CMD_GET_CONTACTS with ERR_CODE_BAD_STATE while
// that iterator is still running. Node 2 reported "141 of 198 after 4 passes",
// which was one pass of 141 and three refusals that added nobody: the read had
// stopped on a quiet gap while the radio was still working through the list.
describe("a radio still working through its own list", () => {

    // a radio that streams slowly, pauses mid list, and refuses a new request
    // while its iterator is running, exactly as the firmware does
    function iteratingRadio(total, { pauseAfter, pauseMillis, perTick = 4, tickMillis = 10 } = {}) {
        const all = Array.from({ length: total }, (_, i) => contact(i));
        const listeners = {};
        const emit = (code, value) => (listeners[code] ?? []).slice().forEach((cb) => cb(value));
        const radio = {
            requests: 0,
            refusals: 0,
            iterating: false,
            on(event, cb) { (listeners[event] ??= []).push(cb); },
            off(event, cb) { listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb); },
            async sendCommandGetContacts() {
                radio.requests++;
                if(radio.iterating){
                    radio.refusals++;
                    return; // ERR_CODE_BAD_STATE: nothing is sent, the iterator carries on
                }
                radio.iterating = true;
                emit(2, { count: total });
                let sent = 0;
                const tick = () => {
                    for(let i = 0; i < perTick && sent < total; i++){
                        emit(3, all[sent++]);
                    }
                    if(sent >= total){
                        radio.iterating = false;
                        emit(4, {});
                        return;
                    }
                    setTimeout(tick, sent === pauseAfter ? pauseMillis : tickMillis);
                };
                setTimeout(tick, tickMillis);
            },
        };
        return radio;
    }

    beforeEach(() => {
        GlobalState.contacts = [];
        GlobalState.contactsAnnounced = null;
        GlobalState.contactsMissing = 0;
    });

    afterEach(() => {
        Connection.CONTACT_READ_QUIET_MILLIS = 4000;
        Connection.CONTACT_READ_MAX_MILLIS = 90000;
        GlobalState.connection = null;
    });

    it("listens for the rest of the list instead of asking for one it will not get", async () => {
        // the pause is longer than the quiet window, so the first pass ends with
        // the radio still mid list
        Connection.CONTACT_READ_QUIET_MILLIS = 60;
        const radio = iteratingRadio(40, { pauseAfter: 20, pauseMillis: 200 });
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(GlobalState.contacts).toHaveLength(40);
        expect(GlobalState.contactsMissing).toBe(0);
        // asked once, and never refused, because it stopped asking
        expect(radio.refusals).toBe(0);
        expect(radio.requests).toBe(1);
    });

    it("does not stop early just because a listening pass added nobody", async () => {
        Connection.CONTACT_READ_QUIET_MILLIS = 60;
        const radio = iteratingRadio(30, { pauseAfter: 12, pauseMillis: 260 });
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(GlobalState.contacts).toHaveLength(30);
    });

});
