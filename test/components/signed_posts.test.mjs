// Recovering the author of a room post.
//
// A room relays other people's posts, so each carries four bytes of the author's
// public key in front of the text. meshcore.js runs the whole remainder through
// a UTF-8 decoder, so any of those bytes that is not valid UTF-8 becomes U+FFFD
// and is gone: the prefix cannot be recovered afterwards, and the number of
// characters to strip is not even four.
//
// The bytes below are the ones actually received from a room on the bench. One
// post's prefix decoded to `Ta\x16G`, four characters; another's to two
// characters and a replacement character, from the same four byte field. Both
// were shown to the operator as mojibake in front of the message.

import { describe, it, expect, beforeEach } from "vitest";
import SignedPosts from "../../src/js/SignedPosts.js";

const ROOM_PREFIX = [0xd2, 0x0f, 0xaa, 0x5c, 0xbb, 0x4b];

// TXT_TYPE_SIGNED_PLAIN is 2, packed as (type << 2) | retry counter
const SIGNED = (2 << 2) | 1;
const PLAIN = (0 << 2) | 0;

function frame({ code = 7, keyPrefix = ROOM_PREFIX, txtType = SIGNED, timestamp = 1789900000, author = [0x54, 0x61, 0x16, 0x47], text = "Test" } = {}) {
    const bytes = [code];
    if(code === 16){
        bytes.push(40, 0, 0);   // snr and two reserved
    }
    bytes.push(...keyPrefix);
    bytes.push(3);              // path len
    bytes.push(txtType);
    bytes.push(timestamp & 0xff, (timestamp >> 8) & 0xff, (timestamp >> 16) & 0xff, (timestamp >>> 24) & 0xff);
    if(author){
        bytes.push(...author);
    }
    bytes.push(...new TextEncoder().encode(text));
    return new Uint8Array(bytes);
}

// what meshcore.js hands over for the same frame
function parsed({ keyPrefix = ROOM_PREFIX, txtType = SIGNED, timestamp = 1789900000, text = "Test" } = {}) {
    return { pubKeyPrefix: new Uint8Array(keyPrefix), txtType, senderTimestamp: timestamp, text };
}

describe("SignedPosts", () => {

    beforeEach(() => SignedPosts.forget());

    it("recognises a signed post by its packed text type", () => {
        // the low two bits are a retry counter the room varies, so the type is
        // the upper bits and a plain comparison against 2 would miss it
        expect(SignedPosts.isSignedPlain((2 << 2) | 0)).toBe(true);
        expect(SignedPosts.isSignedPlain((2 << 2) | 3)).toBe(true);
        expect(SignedPosts.isSignedPlain(PLAIN)).toBe(false);
        expect(SignedPosts.isSignedPlain((1 << 2) | 0)).toBe(false);
    });

    it("recovers the author and the text an operator should see", () => {
        SignedPosts.observe(frame({ author: [0x54, 0x61, 0x16, 0x47], text: "Moved to Rpi" }));
        const found = SignedPosts.take(parsed({ text: "anything" }));

        expect(Array.from(found.authorPrefix)).toEqual([0x54, 0x61, 0x16, 0x47]);
        expect(found.text).toBe("Moved to Rpi");
    });

    it("recovers a prefix that UTF-8 decoding would have destroyed", () => {
        // 0x9c is not valid UTF-8 on its own, which is how one bench post lost a
        // byte and decoded to three characters instead of four
        SignedPosts.observe(frame({ author: [0x76, 0x39, 0x9c, 0x11], text: "Test" }));
        const found = SignedPosts.take(parsed());

        expect(Array.from(found.authorPrefix)).toEqual([0x76, 0x39, 0x9c, 0x11]);
        expect(found.text).toBe("Test");
    });

    it("reads the V3 frame, which carries a signal reading first", () => {
        SignedPosts.observe(frame({ code: 16, text: "From V3" }));
        expect(SignedPosts.take(parsed()).text).toBe("From V3");
    });

    it("leaves an ordinary message alone", () => {
        SignedPosts.observe(frame({ txtType: PLAIN, author: null, text: "Just a message" }));
        expect(SignedPosts.take(parsed({ txtType: PLAIN }))).toBe(null);
    });

    it("matches on sender and timestamp, not on arrival order", () => {
        // a queue would mis-attribute every later post if one frame were missed,
        // and a post under the wrong callsign is worse than one under none
        SignedPosts.observe(frame({ timestamp: 1000, author: [1, 1, 1, 1], text: "first" }));
        SignedPosts.observe(frame({ timestamp: 2000, author: [2, 2, 2, 2], text: "second" }));

        const second = SignedPosts.take(parsed({ timestamp: 2000 }));
        const first = SignedPosts.take(parsed({ timestamp: 1000 }));

        expect(second.text).toBe("second");
        expect(Array.from(second.authorPrefix)).toEqual([2, 2, 2, 2]);
        expect(first.text).toBe("first");
    });

    it("gives nothing for a post whose frame was never seen", () => {
        expect(SignedPosts.take(parsed({ timestamp: 999 }))).toBe(null);
    });

    it("does not hand the same post out twice", () => {
        SignedPosts.observe(frame());
        expect(SignedPosts.take(parsed())).not.toBe(null);
        expect(SignedPosts.take(parsed())).toBe(null);
    });

    it("ignores frames that are not received messages", () => {
        SignedPosts.observe(new Uint8Array([0x85, 0, 1, 2, 3, 4, 5, 6]));
        SignedPosts.observe(new Uint8Array([0x8E, 0, 0, 0, 0x90]));
        expect(SignedPosts.take(parsed())).toBe(null);
    });

    it("ignores a truncated frame rather than reading past the end", () => {
        SignedPosts.observe(new Uint8Array([7, 0xd2, 0x0f]));
        SignedPosts.observe(frame().slice(0, 12));
        expect(SignedPosts.take(parsed())).toBe(null);
    });

    it("does not grow without bound when posts are never claimed", () => {
        for(let i = 0; i < 200; i++){
            SignedPosts.observe(frame({ timestamp: 100000 + i }));
        }
        expect(SignedPosts.held.size).toBeLessThanOrEqual(64);
    });

    describe("naming the author", () => {

        const contacts = [
            { advName: "Zeimin Green", publicKey: new Uint8Array([0x54, 0x61, 0x16, 0x47, 0x0c, ...new Array(27).fill(0)]) },
            { advName: "Someone Else", publicKey: new Uint8Array([0x99, 0x99, 0x99, 0x99, ...new Array(28).fill(0)]) },
        ];

        it("finds the contact the prefix belongs to", () => {
            expect(SignedPosts.findAuthor(contacts, [0x54, 0x61, 0x16, 0x47]).advName).toBe("Zeimin Green");
        });

        it("returns nobody rather than the nearest match", () => {
            // four bytes can collide, and a post under the wrong callsign is worse
            // than a post under none
            expect(SignedPosts.findAuthor(contacts, [0x54, 0x61, 0x16, 0x48])).toBe(null);
        });

        it("copes with an empty contact list", () => {
            expect(SignedPosts.findAuthor([], [1, 2, 3, 4])).toBe(null);
            expect(SignedPosts.findAuthor(null, [1, 2, 3, 4])).toBe(null);
        });

    });

});
