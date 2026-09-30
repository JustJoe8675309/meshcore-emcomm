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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

    it("gives up rather than looping when passes stop adding anybody", async () => {
        // the same contact withheld every time, so retrying cannot help.
        // One barren pass is not enough to conclude that: over Bluetooth a
        // different few are dropped each pass, so a pass that happens to add
        // nobody sits between passes that do. Two in a row is the signal.
        const radio = fakeRadio(10, [[5], [5], [5], [5], [5], [5]]);
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(radio.passes).toBe(3);
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

    it("takes a refusal as its cue to listen, and still gets the whole list", async () => {
        // the pause is longer than the quiet window, so the first pass ends with
        // the radio still mid list. Asking again is refused, and the pass after a
        // refusal listens for the rest of that iteration rather than asking again
        Connection.CONTACT_READ_QUIET_MILLIS = 60;
        const radio = iteratingRadio(40, { pauseAfter: 20, pauseMillis: 200 });
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(GlobalState.contacts).toHaveLength(40);
        expect(GlobalState.contactsMissing).toBe(0);
        // a refusal is expected and harmless; what matters is that it stops
        // asking once it has been refused
        expect(radio.refusals).toBeLessThanOrEqual(1);
    });

    it("does not stop early just because a listening pass added nobody", async () => {
        Connection.CONTACT_READ_QUIET_MILLIS = 60;
        const radio = iteratingRadio(30, { pauseAfter: 12, pauseMillis: 260 });
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(GlobalState.contacts).toHaveLength(30);
    });

});

// The Bluetooth send queue is four frames deep and drops what will not fit:
//
//     if (send_queue_len >= FRAME_QUEUE_SIZE) {      // FRAME_QUEUE_SIZE 4
//       BLE_DEBUG_PRINTLN("writeFrame(), send_queue is full!");
//       return 0;
//     }
//
// Adverts, channel messages and acks share that queue, so on a busy mesh a burst
// costs a few contacts, and the end of list marker goes the same way. A different
// few are lost each pass, which is exactly what makes merging work — but halving
// the shortfall each time needs six or seven passes, not four. Node 2 at 198
// contacts delivered 94 to 141 per pass.
describe("a link that drops a different few every pass", () => {

    const quiet = Connection.CONTACT_READ_QUIET_MILLIS;

    beforeEach(() => {
        GlobalState.contacts = [];
        GlobalState.contactsAnnounced = null;
        GlobalState.contactsMissing = 0;
        // every pass here ends on the quiet rule, since the end marker is dropped,
        // so the real four seconds would make this suite crawl
        Connection.CONTACT_READ_QUIET_MILLIS = 40;
    });

    afterEach(() => {
        Connection.CONTACT_READ_QUIET_MILLIS = quiet;
        GlobalState.connection = null;
    });

    // half the list per pass, a different half each time, and the end marker lost
    // with it, which is what the radio actually does
    function lossyRadio(total) {
        const all = Array.from({ length: total }, (_, i) => contact(i));
        const listeners = {};
        const emit = (code, value) => (listeners[code] ?? []).slice().forEach((cb) => cb(value));
        let pass = 0;
        return {
            passes: 0,
            on(event, cb) { (listeners[event] ??= []).push(cb); },
            off(event, cb) { listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb); },
            async sendCommandGetContacts() {
                const n = pass++;
                this.passes = pass;
                emit(2, { count: total });
                // a deterministic but shifting half, as timing-dependent loss looks
                all.forEach((c, i) => { if((i + n) % 2 === 0) emit(3, c); });
                // no end marker: it is dropped with the rest
            },
        };
    }

    it("converges on the whole roster over several passes", async () => {
        const radio = lossyRadio(198);
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(GlobalState.contacts).toHaveLength(198);
        expect(GlobalState.contactsMissing).toBe(0);
        expect(radio.passes).toBeGreaterThan(1);
    });

    it("keeps asking rather than listening when no end marker arrived", async () => {
        // the firmware clears its iterator when it queues the end marker, so a
        // marker that was dropped does not mean the radio is still mid list. The
        // build that listened instead of asking made node 2 worse: 141 became 107
        const radio = lossyRadio(40);
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(radio.passes).toBeGreaterThan(1);
        expect(GlobalState.contacts).toHaveLength(40);
    });

});

// The clock must not stop a read that is working.
//
// Node 2 over Bluetooth, 29 Sep: pass 1 reached 120 of 260, pass 2 reached 194, and
// the flat 120 s budget stopped it at 127 s with the passes still climbing. The way
// home was then saved missing 46 contacts. A budget should end a read that has
// stalled, not one that is still bringing people in.
describe("how long a read is allowed", () => {

    // a radio that takes real time per pass, so the budget can be reached
    function slowRadio(total, drops, millisPerPass) {
        const all = Array.from({ length: total }, (_, i) => contact(i));
        let pass = 0;
        const listeners = {};
        const emit = (code, value) => (listeners[code] ?? []).slice().forEach((cb) => cb(value));
        return {
            passes: 0,
            on(event, cb) { (listeners[event] ??= []).push(cb); },
            off(event, cb) { listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb); },
            async sendCommandGetContacts() {
                const thisPass = pass++;
                this.passes = pass;
                vi.setSystemTime(new Date(Date.now() + millisPerPass));
                emit(2, { count: total });
                const withheld = new Set(drops[thisPass] ?? drops[drops.length - 1] ?? []);
                all.filter((_, i) => !withheld.has(i)).forEach((c) => emit(3, c));
                emit(4, {});
            },
        };
    }

    // withhold a shrinking set, so every pass genuinely gains
    const gaining = (total, perPass) => Array.from({ length: 12 }, (_, p) => {
        const keep = Math.max(0, total - (p + 1) * perPass);
        return Array.from({ length: keep }, (_, i) => total - 1 - i);
    });

    beforeEach(() => {
        vi.useFakeTimers();
        GlobalState.contacts = [];
        GlobalState.contactsAnnounced = null;
        GlobalState.contactsMissing = 0;
    });

    afterEach(() => {
        vi.useRealTimers();
        GlobalState.connection = null;
    });

    it("carries on past the budget while the passes are still gaining", async () => {
        // 50 s a pass: the budget is behind us from pass 3 onward
        const radio = slowRadio(100, gaining(100, 20), 50000);
        GlobalState.connection = radio;

        await Connection.loadContacts();

        // a flat budget would have stopped at three passes and left contacts behind
        expect(radio.passes).toBeGreaterThan(3);
        expect(GlobalState.contacts).toHaveLength(100);
        expect(GlobalState.contactsMissing).toBe(0);
    });

    it("still stops at the budget once a read has stalled", async () => {
        // the same two withheld every pass: nothing to gain by going on
        const radio = slowRadio(100, [[1, 2]], 50000);
        GlobalState.connection = radio;

        await Connection.loadContacts();

        expect(radio.passes).toBeLessThanOrEqual(3);
        expect(GlobalState.contactsMissing).toBe(2);
    });

    // "gaining" has to mean gaining enough to be worth the wait. A link handing over
    // one contact a pass is not converging, it is trickling, and holding the connect
    // open to the ceiling for it costs the operator minutes to gain a handful
    it("treats a trickle as stalled, not as progress", async () => {
        const radio = slowRadio(100, gaining(100, 1), 50000);
        GlobalState.connection = radio;
        const startedAt = Date.now();

        await Connection.loadContacts();

        expect(Date.now() - startedAt).toBeLessThan(Connection.CONTACT_LOAD_CEILING_MILLIS);
        expect(radio.passes).toBeLessThanOrEqual(3);
    });

    // "still gaining" must not mean "for ever" on a link dribbling a few a minute
    it("stops at the ceiling however well it is going", async () => {
        const radio = slowRadio(400, gaining(400, 4), 60000);
        GlobalState.connection = radio;
        const startedAt = Date.now();

        await Connection.loadContacts();

        // elapsed, not the epoch: one pass may overshoot the ceiling, not many
        const elapsed = Date.now() - startedAt;
        expect(elapsed).toBeLessThanOrEqual(Connection.CONTACT_LOAD_CEILING_MILLIS + 60000);
        expect(GlobalState.contacts.length).toBeLessThan(400);
        // and it says it fell short rather than settling quietly
        expect(GlobalState.contactsMissing).toBeGreaterThan(0);
    });

});
