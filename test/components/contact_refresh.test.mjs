// One contact at a time.
//
// Every advert the radio heard used to re-read the whole contact list: 161
// contacts, twice over Bluetooth, for one station's update. With device commands
// taking turns, everything else waited behind that read, and the settings page
// sat empty for twelve seconds on the bench after an advert arrived.
//
// The notification names the contact, and the firmware has a command that
// returns one contact by key. On the radio: 21 ms for the contact, 9 ms for ERR
// not found. These tests hold the fallbacks to account too, because the full
// read is still the right answer whenever the one-contact fetch cannot be
// trusted.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Constants } from "@liamcottle/meshcore.js";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";

const key = (fill) => new Uint8Array(32).fill(fill);
const contact = (fill, advName) => ({ publicKey: key(fill), type: 1, flags: 0, outPathLen: 0, outPath: new Uint8Array(64), advName, lastAdvert: 1, advLat: 0, advLon: 0, lastMod: 1 });

// A radio whose emitter hands each reply to every listener, a tick later, the
// way meshcore.js does. `answer` decides what command 30 gets back.
function fakeRadio(answer) {
    const listeners = new Map();
    const radio = {
        sent: [],
        on(code, cb) { if(!listeners.has(code)) listeners.set(code, []); listeners.get(code).push(cb); },
        off(code, cb) { listeners.set(code, (listeners.get(code) ?? []).filter((f) => f !== cb)); },
        emit(code, ...args) { for(const cb of [...(listeners.get(code) ?? [])]) setTimeout(() => cb(...args), 0); },
        async sendToRadioFrame(frame) {
            const bytes = new Uint8Array(frame);
            radio.sent.push(bytes);
            if(bytes[0] === 30){
                const reply = answer(bytes.slice(1, 33));
                if(reply) setTimeout(() => radio.emit(reply.code, reply.data), 0);
            }
        },
    };
    return radio;
}

const names = () => GlobalState.contacts.map((c) => c.advName);
const settle = () => new Promise((r) => setTimeout(r, 30));

describe("refreshing one contact", () => {

    let fullRead;

    beforeEach(() => {
        Connection.commandQueue = Promise.resolve();
        GlobalState.contacts = [contact(1, "Alpha"), contact(2, "Bravo")];
        GlobalState.contactsAnnounced = 2;
        GlobalState.contactsMissing = 0;
        fullRead = vi.spyOn(Connection, "loadContacts").mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.contacts = [];
        GlobalState.contactsAnnounced = null;
        GlobalState.contactsMissing = 0;
    });

    it("asks the radio for that contact alone, in the frame the firmware expects", async () => {
        const radio = fakeRadio(() => ({ code: Constants.ResponseCodes.Contact, data: contact(2, "Bravo moved") }));
        GlobalState.connection = radio;

        await Connection.refreshContact(key(2));

        expect(radio.sent).toHaveLength(1);
        expect(Array.from(radio.sent[0])).toEqual([30, ...key(2)]);
    });

    it("updates that contact in place, and does not re-read the list", async () => {
        GlobalState.connection = fakeRadio(() => ({ code: Constants.ResponseCodes.Contact, data: contact(2, "Bravo moved") }));

        await Connection.refreshContact(key(2));

        expect(names()).toEqual(["Alpha", "Bravo moved"]);
        expect(fullRead).not.toHaveBeenCalled();
    });

    it("adds a contact the radio has just taken on, and keeps the missing count true", async () => {
        // an auto added station arrives as a plain advert, not as a new-advert
        // notice: the firmware sets is_new only for stations it did not keep
        GlobalState.connection = fakeRadio(() => ({ code: Constants.ResponseCodes.Contact, data: contact(3, "Charlie") }));

        await Connection.refreshContact(key(3));

        expect(names()).toEqual(["Alpha", "Bravo", "Charlie"]);
        expect(GlobalState.contactsAnnounced).toBe(3);
        expect(GlobalState.contactsMissing).toBe(0);
    });

    it("falls back to the full read when the radio says it has no such contact", async () => {
        GlobalState.connection = fakeRadio(() => ({ code: Constants.ResponseCodes.Err, data: {} }));

        await Connection.refreshContact(key(9));

        expect(fullRead).toHaveBeenCalledTimes(1);
        expect(names()).toEqual(["Alpha", "Bravo"]);
    });

    it("falls back to the full read when the radio does not answer", async () => {
        // older firmware without the command, or a reply lost over Bluetooth
        const saved = Connection.ACK_TIMEOUT_MILLIS;
        Connection.ACK_TIMEOUT_MILLIS = 20;
        try {
            GlobalState.connection = fakeRadio(() => null);
            await Connection.refreshContact(key(2));
            expect(fullRead).toHaveBeenCalledTimes(1);
        } finally {
            Connection.ACK_TIMEOUT_MILLIS = saved;
        }
    });

    it("will not merge a record for a different contact over this one", async () => {
        GlobalState.connection = fakeRadio(() => ({ code: Constants.ResponseCodes.Contact, data: contact(1, "Alpha, wrongly") }));

        await Connection.refreshContact(key(2));

        expect(names()).toEqual(["Alpha", "Bravo"]);
        expect(fullRead).toHaveBeenCalledTimes(1);
    });

    it("does nothing with no radio", async () => {
        GlobalState.connection = null;
        await Connection.refreshContact(key(2));
        expect(fullRead).not.toHaveBeenCalled();
        expect(names()).toEqual(["Alpha", "Bravo"]);
    });

});

describe("forgetting an evicted contact", () => {

    beforeEach(() => {
        GlobalState.contacts = [contact(1, "Alpha"), contact(2, "Bravo")];
        GlobalState.contactsAnnounced = 2;
        GlobalState.contactsMissing = 0;
    });

    afterEach(() => {
        GlobalState.contacts = [];
        GlobalState.contactsAnnounced = null;
    });

    it("takes it out of the list, with the radio's total", () => {
        Connection.forgetContact(key(1));
        expect(names()).toEqual(["Bravo"]);
        expect(GlobalState.contactsAnnounced).toBe(1);
        expect(GlobalState.contactsMissing).toBe(0);
    });

    it("counts the eviction even of a contact a lossy read never delivered", () => {
        // one short, then the radio evicts: its total drops whoever it was
        GlobalState.contacts = [contact(1, "Alpha")];
        GlobalState.contactsMissing = 1;

        Connection.forgetContact(key(7));

        expect(names()).toEqual(["Alpha"]);
        expect(GlobalState.contactsAnnounced).toBe(1);
        expect(GlobalState.contactsMissing).toBe(0);
    });

});

describe("listening for contact changes", () => {

    let radio;
    let fullRead;

    beforeEach(() => {
        Connection.commandQueue = Promise.resolve();
        GlobalState.contacts = [contact(1, "Alpha"), contact(2, "Bravo")];
        GlobalState.contactsAnnounced = 2;
        radio = fakeRadio((k) => ({ code: Constants.ResponseCodes.Contact, data: { ...contact(k[0], "updated"), publicKey: k } }));
        GlobalState.connection = radio;
        Connection.listenForContactChanges(radio);
        fullRead = vi.spyOn(Connection, "loadContacts").mockResolvedValue(undefined);
        vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.contacts = [];
        GlobalState.contactsAnnounced = null;
    });

    it("fetches only the contact an advert names", async () => {
        radio.emit(Constants.PushCodes.Advert, { publicKey: key(2) });

        // waits on the result, not a fixed time: the chain is several timer hops,
        // and under a full parallel run a fixed wait was sometimes too short
        await vi.waitFor(() => expect(names()).toEqual(["Alpha", "updated"]));
        expect(radio.sent.map((f) => f[0])).toEqual([30]);
        expect(fullRead).not.toHaveBeenCalled();
    });

    it("does the same for a path change", async () => {
        radio.emit(Constants.PushCodes.PathUpdated, { publicKey: key(1) });

        await vi.waitFor(() => expect(names()).toEqual(["updated", "Bravo"]));
        expect(fullRead).not.toHaveBeenCalled();
    });

    it("drops a contact the radio says it evicted", async () => {
        radio.emit("rx", new Uint8Array([0x8F, ...key(1)]));
        await settle();

        expect(names()).toEqual(["Bravo"]);
        expect(radio.sent).toHaveLength(0);
    });

    it("leaves a heard but unkept station out of the list, as before", async () => {
        // 0x8A carries a full record, but for a station the radio chose not to
        // keep, so it does not belong in a list of the radio's contacts
        radio.emit("rx", new Uint8Array([0x8A, ...key(5)]));
        await settle();

        expect(names()).toEqual(["Alpha", "Bravo"]);
        expect(radio.sent).toHaveLength(0);
    });

    it("waits for the database before touching the list", async () => {
        let open;
        const ready = new Promise((r) => { open = r; });
        const quiet = fakeRadio((k) => ({ code: Constants.ResponseCodes.Contact, data: { ...contact(k[0], "updated"), publicKey: k } }));
        GlobalState.connection = quiet;
        Connection.listenForContactChanges(quiet, ready);

        quiet.emit(Constants.PushCodes.Advert, { publicKey: key(2) });
        await settle();
        expect(quiet.sent).toHaveLength(0);

        open();
        await vi.waitFor(() => expect(quiet.sent.map((f) => f[0])).toEqual([30]));
    });

});
