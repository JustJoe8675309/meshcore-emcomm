// Adding a contact from a shared meshcore:// link.
//
// This is the only way to add a room server. Discovery cannot find one, and not
// because of range: the room firmware does not implement the control packet at
// all, so a room stays invisible until it adverts within earshot.
//
// The link is parsed here before anything is transmitted, so bad input is named
// rather than handed to the radio to refuse with a bare error code.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Advert } from "@liamcottle/meshcore.js";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import Utils from "../../src/js/Utils.js";

const ROOM_KEY = new Uint8Array(32).fill(0x33);

// 32 byte public key, 4 byte timestamp, 64 byte signature, then app data
function advertBytes(publicKey = ROOM_KEY) {
    const bytes = new Uint8Array(32 + 4 + 64 + 8);
    bytes.set(publicKey, 0);
    bytes.set([0x80, 0x03], 100);
    return bytes;
}

const asLink = (bytes) => `meshcore://${Utils.bytesToHex(bytes)}`;

function aRoomContact(publicKey = ROOM_KEY) {
    return { publicKey, type: 3, advName: "Test Room", flags: 0, outPathLen: -1 };
}

describe("importing a contact from a link", () => {

    let imported;

    beforeEach(() => {
        imported = [];
        GlobalState.contacts = [];
        GlobalState.connection = {
            on() {}, off() {},
            async importContact(bytes) { imported.push(bytes); },
        };
        // stand in for the device's contact list coming back with the new entry
        vi.spyOn(Connection, "loadContacts").mockImplementation(async () => {
            GlobalState.contacts = [aRoomContact()];
        });
    });

    it("accepts a meshcore link and reports what was added", async () => {
        const result = await Connection.importContact(asLink(advertBytes()));
        expect(imported).toHaveLength(1);
        expect(result.contact.advName).toBe("Test Room");
        expect(result.alreadyKnown).toBe(false);
    });

    it("accepts the bare hex without the scheme", async () => {
        await Connection.importContact(Utils.bytesToHex(advertBytes()));
        expect(imported).toHaveLength(1);
    });

    it("tolerates whitespace and a pasted newline", async () => {
        await Connection.importContact(`  meshcore://${Utils.bytesToHex(advertBytes())}\n `);
        expect(imported).toHaveLength(1);
    });

    it("says the contact was already known rather than pretending it is new", async () => {
        GlobalState.contacts = [aRoomContact()];
        const result = await Connection.importContact(asLink(advertBytes()));
        expect(result.alreadyKnown).toBe(true);
    });

    it("reads the contacts back rather than assuming the import took", async () => {
        await Connection.importContact(asLink(advertBytes()));
        expect(Connection.loadContacts).toHaveBeenCalled();
    });

    it("says so if the radio accepted the link but nothing appeared", async () => {
        Connection.loadContacts.mockImplementation(async () => {
            GlobalState.contacts = [];
        });
        await expect(Connection.importContact(asLink(advertBytes())))
            .rejects.toThrow(/did not appear/);
    });

    describe("refusing bad input before transmitting", () => {

        const rejects = async (text, pattern) => {
            await expect(Connection.importContact(text)).rejects.toThrow(pattern);
            expect(imported).toHaveLength(0);
        };

        it("asks for something when given nothing", async () => {
            await rejects("", /Paste a meshcore/);
            await rejects("   ", /Paste a meshcore/);
        });

        it("rejects text that is not hex", async () => {
            await rejects("meshcore://not-a-contact", /does not look like/);
        });

        it("rejects a half byte", async () => {
            await rejects("abc", /does not look like/);
        });

        it("rejects something far too short to be an advert", async () => {
            // a public key alone is not a contact
            await rejects(Utils.bytesToHex(new Uint8Array(32).fill(1)), /too short/);
        });

        it("refuses when there is no radio", async () => {
            GlobalState.connection = null;
            await expect(Connection.importContact(asLink(advertBytes())))
                .rejects.toThrow(Connection.DISCONNECTED);
        });

    });

    it("sends the exact bytes the link carried", async () => {
        const bytes = advertBytes();
        await Connection.importContact(asLink(bytes));
        expect(Array.from(imported[0])).toEqual(Array.from(bytes));
    });

    it("round trips what the app's own export produces", async () => {
        // export writes `meshcore://` + hex, so import has to read that back
        const bytes = advertBytes();
        const exported = `meshcore://${Utils.bytesToHex(bytes)}`;
        await Connection.importContact(exported);
        expect(Array.from(imported[0])).toEqual(Array.from(bytes));
        // and the key the advert carries is the one looked up afterwards
        expect(Utils.bytesToHex(Advert.fromBytes(bytes).publicKey)).toBe(Utils.bytesToHex(ROOM_KEY));
    });

});
