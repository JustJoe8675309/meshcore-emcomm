// Which text type a direct position request travels as, which is the one byte
// that decides whether the station on the other end sees anything at all.
//
// It used to go as CliData. The stock MeshCore app treats that as data and shows
// nothing, so a station running it was asked for its position and never knew —
// while the text carried a sentence written for exactly that person, "Position
// request from KJ5HBN (answering needs Mesh-Emcomm)", which nobody could read.
//
// Plain text now, so they can read it and answer in words. Channels and rooms are
// deliberately unchanged: those go to everyone, and machine noise in every stock
// user's channel every time somebody runs a roll call is how a net gets asked to
// stop.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Constants } from "@liamcottle/meshcore.js";
import Connection from "../../src/js/Connection.js";
import PositionService from "../../src/js/position/PositionService.js";
import GlobalState from "../../src/js/GlobalState.js";
import Database from "../../src/js/Database.js";

const THEM = new Uint8Array(32).fill(0x4c);

function aContact(publicKey = THEM) {
    return { publicKey, advName: "Joe-KJ5HBN-EDC", type: Constants.AdvType.Chat, flags: 0 };
}

describe("a direct position message on the air", () => {

    let sent;

    beforeEach(() => {
        sent = [];
        GlobalState.connection = {
            on() {}, off() {},
            sendCommandSendTxtMsg(txtType, attempt, timestamp, prefix, text) {
                sent.push({ txtType, text });
                return Promise.resolve();
            },
        };
        // the radio's acknowledgement, which sendCommandData waits for
        vi.spyOn(Connection, "sendAwaiting").mockImplementation(async (connection, send) => {
            await send();
            return { code: Constants.ResponseCodes.Sent };
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
    });

    it("goes as plain text, so a stock app shows it", async () => {
        await Connection.sendCommandData(THEM, "Position request from KJ5HBN #mce1:abc");

        expect(sent).toHaveLength(1);
        expect(sent[0].txtType).toBe(Constants.TxtTypes.Plain);
        expect(sent[0].txtType).toBe(0);
        // and the sentence a stock operator reads is still in front of the payload
        expect(sent[0].text.startsWith("Position request from KJ5HBN")).toBe(true);
    });

    it("is no longer sent as data, which showed nothing at all", async () => {
        await Connection.sendCommandData(THEM, "x #mce1:abc");
        expect(sent[0].txtType).not.toBe(Constants.TxtTypes.CliData);
    });

});

describe("a direct position message coming back", () => {

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.contacts = [];
        GlobalState.selfInfo = null;
    });

    // The marker identifies it, not the type: this app sends plain now, and a
    // station still on an older build sends CliData. Both must be heard, and both
    // kept out of the conversation rather than landing in the chat with a
    // notification, which is what happened on the bench once.
    const arrives = async (txtType) => {
        GlobalState.contacts = [aContact()];
        GlobalState.selfInfo = { name: "KJ5HBN-EMCOMM", publicKey: new Uint8Array(32).fill(0x39) };
        const handled = vi.spyOn(PositionService, "onDirectText").mockReturnValue(true);
        const saved = vi.spyOn(Database.Message, "insert").mockResolvedValue({});
        // happy-dom has no Notification, and a message that reaches the
        // conversation goes on to raise one
        globalThis.Notification = { requestPermission: async () => "denied" };

        await Connection.onContactMessageReceived({
            pubKeyPrefix: THEM.slice(0, 6),
            txtType: txtType,
            text: "Position request from KJ5HBN #mce1:abc",
            senderTimestamp: Math.floor(Date.now() / 1000),
        });

        return { handled, saved };
    };

    it("is taken when it arrives as plain text, as this app now sends", async () => {
        const { handled, saved } = await arrives(Constants.TxtTypes.Plain);
        expect(handled).toHaveBeenCalled();
        // and kept out of the conversation
        expect(saved).not.toHaveBeenCalled();
    });

    it("is still taken from a station on an older build, which sends data", async () => {
        const { handled, saved } = await arrives(Constants.TxtTypes.CliData);
        expect(handled).toHaveBeenCalled();
        expect(saved).not.toHaveBeenCalled();
    });

    // so the two above are testing the check rather than a handler that runs
    // whatever arrives
    it("is not taken from a signed message, which is somebody else's kind", async () => {
        const { handled, saved } = await arrives(Constants.TxtTypes.SignedPlain);
        expect(handled).not.toHaveBeenCalled();
        // it went on to the conversation instead, which is where it belongs
        expect(saved).toHaveBeenCalled();
    });

});
