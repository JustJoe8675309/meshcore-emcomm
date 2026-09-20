// Recovering the author of a room post.
//
// A room relays other people's posts, so every post carries who wrote it. The
// room firmware puts it in front of the text (examples/simple_room_server):
//
//     reply_data[len++] = (TXT_TYPE_SIGNED_PLAIN << 2) | (attempt & 3);
//     memcpy(&reply_data[len], post.author.pub_key, 4);   // author prefix
//     memcpy(&reply_data[len], post.text, text_len);      // then the text
//
// `meshcore.js` reads the whole remainder with `readString()`, which UTF-8
// decodes those four bytes along with the message. Any byte that is not valid
// UTF-8 becomes U+FFFD there and is gone for good, so the prefix cannot be
// recovered from the decoded string afterwards, and the count of characters to
// strip is not even four. On the bench one post decoded to `Ta\x16G` and another
// to `v9` plus a replacement character, from the same four byte field.
//
// So the frames are read as they arrive, before the library touches them, and
// the author prefix and the real text are kept here until the parsed message
// turns up. Matching is by the sender's key prefix and their timestamp, both of
// which are in the frame and in the parsed message: a queue would mis-attribute
// every later post if one frame were ever missed, and a post under the wrong
// callsign is worse than a post under none.

import Utils from "./Utils.js";

// txt_type is packed: the type is the upper six bits, the low two are a retry
// counter the room varies so retransmissions hash differently
const TXT_TYPE_SIGNED_PLAIN = 2;

// ResponseCodes, and the fixed part of each frame before the sender key prefix
const CONTACT_MSG_RECV = 7;
const CONTACT_MSG_RECV_V3 = 16;
const V3_EXTRA_BYTES = 3;   // snr, then two reserved

const AUTHOR_PREFIX_BYTES = 4;

// a post is only worth holding until its parsed twin arrives
const MAX_HELD = 64;

class SignedPosts {

    static held = new Map();

    static isSignedPlain(txtType) {
        return (txtType >> 2) === TXT_TYPE_SIGNED_PLAIN;
    }

    static key(publicKeyPrefix, senderTimestamp) {
        return `${Utils.bytesToHex(publicKeyPrefix)}:${senderTimestamp}`;
    }

    /**
     * Reads a received message frame and, when it is a signed post, remembers the
     * author prefix and the correctly decoded text. Anything else is ignored.
     */
    static observe(frame) {

        const bytes = new Uint8Array(frame);
        const code = bytes[0];
        if(code !== CONTACT_MSG_RECV && code !== CONTACT_MSG_RECV_V3){
            return;
        }

        // [code, (snr, reserved, reserved)?, key prefix x6, path len, txt type, timestamp x4, text...]
        let at = 1 + (code === CONTACT_MSG_RECV_V3 ? V3_EXTRA_BYTES : 0);
        if(bytes.length < at + 12){
            return;
        }

        const publicKeyPrefix = bytes.subarray(at, at + 6);
        at += 6;
        at += 1;                            // path len
        const txtType = bytes[at++];

        if(!this.isSignedPlain(txtType)){
            return;
        }

        const view = new DataView(bytes.buffer, bytes.byteOffset);
        const senderTimestamp = view.getUint32(at, true);
        at += 4;

        if(bytes.length < at + AUTHOR_PREFIX_BYTES){
            return;
        }

        const authorPrefix = bytes.slice(at, at + AUTHOR_PREFIX_BYTES);
        const text = new TextDecoder().decode(bytes.subarray(at + AUTHOR_PREFIX_BYTES));

        if(this.held.size >= MAX_HELD){
            // drop the oldest rather than grow without bound: a post whose parsed
            // twin never arrives would otherwise be kept for the whole session
            this.held.delete(this.held.keys().next().value);
        }

        this.held.set(this.key(publicKeyPrefix, senderTimestamp), {
            authorPrefix: authorPrefix,
            text: text,
        });

    }

    /**
     * The author and clean text for a parsed message, or null when it is not a
     * signed post or its frame was never seen.
     */
    static take(message) {

        if(!this.isSignedPlain(message?.txtType ?? 0)){
            return null;
        }

        const key = this.key(message.pubKeyPrefix, message.senderTimestamp);
        const found = this.held.get(key);
        if(!found){
            return null;
        }

        this.held.delete(key);
        return found;

    }

    static forget() {
        this.held.clear();
    }

    /**
     * The contact who wrote a post, by the four byte prefix the room sent.
     *
     * Four bytes is not a lot, and the firmware's own comment about the six byte
     * sender prefix says as much, so a collision is possible. The caller shows a
     * name where one matches and the raw prefix where none does, rather than
     * guessing.
     */
    static findAuthor(contacts, authorPrefix) {
        return (contacts ?? []).find((contact) => {
            for(let i = 0; i < authorPrefix.length; i++){
                if(contact.publicKey[i] !== authorPrefix[i]){
                    return false;
                }
            }
            return true;
        }) ?? null;
    }

}

export default SignedPosts;
