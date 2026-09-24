// Companions, repeaters and rooms, managed from the settings page.
//
// These live under the mode tabs, where an operator looks for them, but they are
// not part of a mode: a switch does not write contacts and coming home does not
// take them away. So the same list reads in every tab, and a change here reaches
// the radio at once rather than waiting for a switch.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Constants } from "@liamcottle/meshcore.js";
import ContactsGroup from "../../src/components/settings/ContactsGroup.vue";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import Utils from "../../src/js/Utils.js";

const KEY = new Uint8Array(32).fill(0x39);
const ROOM = new Uint8Array(32).fill(0x87);
const PERSON = new Uint8Array(32).fill(0x11);
const RELAY = new Uint8Array(32).fill(0x22);

function contact(publicKey, advName, type) {
    return { publicKey: publicKey, advName: advName, type: type, flags: 0, outPathLen: -1, outPath: new Uint8Array(0), lastAdvert: 0, advLat: 0, advLon: 0 };
}

function connect() {
    GlobalState.connection = { on() {}, off() {} };
    GlobalState.selfInfo = { name: "Joe-KJ5HBN-HTv3", publicKey: KEY };
    GlobalState.contacts = [
        contact(PERSON, "Joe-KJ5HBN-EDC", Constants.AdvType.Chat),
        contact(RELAY, "Franklin Mtn", Constants.AdvType.Repeater),
        contact(ROOM, "N.E. ELP EMCOMM OBSVR", Constants.AdvType.Room),
    ];
}

/** Opens the group, which is shut until it is asked for. */
async function open(wrapper) {
    await wrapper.find("button[aria-expanded]").trigger("click");
    await flushPromises();
}

describe("managing contacts from settings", () => {

    beforeEach(() => {
        connect();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        GlobalState.contacts = [];
    });

    it("shows only its own kind: a room is not a companion", async () => {
        const rooms = mount(ContactsGroup, { props: { kind: "room" } });
        await open(rooms);
        expect(rooms.text()).toContain("N.E. ELP EMCOMM OBSVR");
        expect(rooms.text()).not.toContain("Joe-KJ5HBN-EDC");
        expect(rooms.text()).not.toContain("Franklin Mtn");

        const companions = mount(ContactsGroup, { props: { kind: "companion" } });
        await open(companions);
        expect(companions.text()).toContain("Joe-KJ5HBN-EDC");
        expect(companions.text()).not.toContain("N.E. ELP EMCOMM OBSVR");
    });

    it("renames one on the radio, not only on screen", async () => {
        const renamed = vi.spyOn(Connection, "renameContact").mockResolvedValue();
        const wrapper = mount(ContactsGroup, { props: { kind: "repeater" } });
        await open(wrapper);

        await wrapper.findAll("button").find((b) => b.text() === "Edit").trigger("click");
        await wrapper.find("input[type=text]").setValue("Franklin Mtn North");
        await wrapper.findAll("button").find((b) => b.text() === "Save").trigger("click");
        await flushPromises();

        expect(renamed).toHaveBeenCalledWith(RELAY, "Franklin Mtn North");
        expect(wrapper.text()).toContain("Renamed to Franklin Mtn North");
    });

    it("asks before forgetting one, and does nothing if the answer is no", async () => {
        // forgetting a room loses the way back into it, and forgetting a repeater
        // loses the path through it
        const removed = vi.spyOn(Connection, "removeContact").mockResolvedValue();
        window.confirm = vi.fn(() => false);
        const wrapper = mount(ContactsGroup, { props: { kind: "room" } });
        await open(wrapper);

        await wrapper.findAll("button").find((b) => b.text() === "Delete").trigger("click");
        await flushPromises();

        expect(removed).not.toHaveBeenCalled();
    });

    it("forgets one when the answer is yes, and reads the list back", async () => {
        const removed = vi.spyOn(Connection, "removeContact").mockResolvedValue();
        const reloaded = vi.spyOn(Connection, "loadContacts").mockResolvedValue();
        window.confirm = vi.fn(() => true);
        const wrapper = mount(ContactsGroup, { props: { kind: "room" } });
        await open(wrapper);

        await wrapper.findAll("button").find((b) => b.text() === "Delete").trigger("click");
        await flushPromises();

        expect(removed).toHaveBeenCalledWith(ROOM);
        // the device owns the list, so what it holds now is what is shown
        expect(reloaded).toHaveBeenCalled();
        expect(wrapper.text()).toContain("Forgot N.E. ELP EMCOMM OBSVR");
    });

    it("adds one from a link, which is the only thing that carries a public key", async () => {
        const imported = vi.spyOn(Connection, "importContact").mockResolvedValue({
            contact: contact(new Uint8Array(32).fill(0x44), "EP-ARES-ROOM", Constants.AdvType.Room),
            alreadyKnown: false,
        });
        const wrapper = mount(ContactsGroup, { props: { kind: "room" } });
        await open(wrapper);

        await wrapper.find("input[placeholder='meshcore://...']").setValue("meshcore://abcdef");
        await wrapper.find("form").trigger("submit");
        await flushPromises();

        expect(imported).toHaveBeenCalledWith("meshcore://abcdef");
        expect(wrapper.text()).toContain("Added EP-ARES-ROOM");
    });

    it("says what went wrong rather than leaving the list to imply it", async () => {
        vi.spyOn(Connection, "importContact").mockRejectedValue(new Error("That does not look like a contact link."));
        const wrapper = mount(ContactsGroup, { props: { kind: "companion" } });
        await open(wrapper);

        await wrapper.find("input[placeholder='meshcore://...']").setValue("nonsense");
        await wrapper.find("form").trigger("submit");
        await flushPromises();

        expect(wrapper.text()).toContain("That does not look like a contact link.");
    });

    it("says a room can only be added from a link, since discovery cannot find one", async () => {
        const wrapper = mount(ContactsGroup, { props: { kind: "room" } });
        await open(wrapper);
        expect(wrapper.text()).toContain("does not answer discovery");
    });

    it("says these are not part of a mode, in the heading where it matters", () => {
        // the surrounding tab is all promises about later; this is the radio now
        const wrapper = mount(ContactsGroup, { props: { kind: "companion" } });
        expect(wrapper.text()).toContain("Not part of a mode");
    });

    it("has nothing to offer with no radio connected", () => {
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        const wrapper = mount(ContactsGroup, { props: { kind: "companion" } });
        expect(wrapper.text()).toContain("No radio connected");
    });

});

describe("renaming a contact on the radio", () => {

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.contacts = [];
    });

    it("writes the whole record back, changing only the name", async () => {
        const written = [];
        GlobalState.connection = {
            addOrUpdateContact: (...args) => {
                written.push(args);
                return Promise.resolve();
            },
        };
        GlobalState.contacts = [{
            publicKey: RELAY, advName: "Franklin Mtn", type: Constants.AdvType.Repeater,
            flags: 1, outPathLen: 2, outPath: new Uint8Array([9, 8]), lastAdvert: 1758000000,
            advLat: 31758700, advLon: -106486900,
        }];
        vi.spyOn(Connection, "loadContacts").mockResolvedValue();

        await Connection.renameContact(RELAY, "Franklin Mtn North");

        expect(written).toHaveLength(1);
        const [publicKey, type, flags, outPathLen, outPath, advName, lastAdvert, lat, lon] = written[0];
        expect(Utils.bytesToHex(publicKey)).toBe(Utils.bytesToHex(RELAY));
        expect(advName).toBe("Franklin Mtn North");
        // everything else is the record as it stood: a favourite must not be lost
        // to a rename, and neither must the path through a repeater
        expect(type).toBe(Constants.AdvType.Repeater);
        expect(flags).toBe(1);
        expect(outPathLen).toBe(2);
        expect(Array.from(outPath)).toEqual([9, 8]);
        expect(lastAdvert).toBe(1758000000);
        expect(lat).toBe(31758700);
        expect(lon).toBe(-106486900);
    });

    it("refuses an empty name rather than writing one", async () => {
        GlobalState.connection = { addOrUpdateContact: () => Promise.resolve() };
        GlobalState.contacts = [];
        await expect(Connection.renameContact(RELAY, "   ")).rejects.toThrow("needs a name");
    });

});
