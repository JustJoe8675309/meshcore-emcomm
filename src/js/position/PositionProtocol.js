/**
 * The messages this app uses to ask a station for its position, and to answer.
 *
 * On a channel they travel as channel datagrams: binary packets that every
 * client on the channel receives and decrypts, but only this app shows. Stock
 * clients see nothing at all. The datagram's application ID is in the range the
 * firmware leaves free for testing without registration, 0xFF00 to 0xFFFE.
 *
 * Direct to a contact there is no datagram, so the same bytes go as a direct
 * message of text type 1, the firmware's "command data". Clients without this
 * app show that as ordinary text, so the text leads with a readable line saying
 * what it is, and the payload follows a marker this app looks for:
 *
 *     Position request from KJ5HBN (answering needs Mesh-Emcomm) #mce1:AQE...
 *
 * In a room server there are no datagrams, and text type 1 cannot be used: a
 * room runs text type 1 from an admin as a command. So in a room the same text
 * goes as an ordinary post, which the room relays to everyone in it, capped at
 * the room's 151 bytes.
 *
 * Payload, version 1, little endian:
 *
 *     0     version (1)
 *     1     kind: 1 request, 2 position, 3 declined, 4 roll call
 *     2-5   tag, chosen by the requester and echoed in the answer
 *     6-11  the station it is for: the one asked, or for an answer, the one that
 *           asked. All zeros is everyone: a roll call, or a position sent unasked
 *     12-17 the station it is from
 *     request:  18.. sender's name, UTF-8
 *     roll call: 18 how many stations are already heard, 19.. the first three
 *               bytes of each one's key, then the sender's name. Those stations
 *               stay silent when it is asked again, so only the missed answer
 *     position: 18-21 latitude, 22-25 longitude (millionths of a degree, signed),
 *               26-29 fix time (unix seconds, 0 if not a live fix),
 *               30 flags (1 message to follow, 2 current GPS fix, 4 no position,
 *               8 last known position, not a current fix,
 *               16 entered by hand by the operator just now, with its time),
 *               31.. sender's name
 *     declined: 18.. sender's name
 *
 * Datagrams carry no sender identity of their own, hence the prefixes and the
 * name. Nothing here is signed, so anyone holding the channel key could forge a
 * position; that was an accepted limit for the first version.
 */

export const DATA_TYPE = 0xFF50;
export const VERSION = 1;

export const KIND = Object.freeze({
    REQUEST: 1,
    POSITION: 2,
    DECLINED: 3,
    // a request to every station on a channel or in a room at once. A kind of
    // its own, so an app from before it ignores it rather than misreading it
    ROLL_CALL: 4,
});

export const FLAG = Object.freeze({
    MESSAGE_TO_FOLLOW: 1,
    LIVE_FIX: 2,
    NO_POSITION: 4,
    // the position is the last one the radio held, not a fix confirmed current:
    // a radio without GPS, or a GPS whose position has stopped changing
    LAST_KNOWN: 8,
    // the operator has just typed the position in, and it is on the radio now:
    // current by their word, not by a GPS
    MANUAL: 16,
});

export const DIRECT_MARKER = "#mce1:";

// MAX_POST_TEXT_LEN in the room server firmware: 160 less 9
export const MAX_ROOM_BYTES = 151;
// kept well inside what a channel datagram carries
export const MAX_DATAGRAM_BYTES = 120;
// how much of each heard station's key a roll call carries
export const HEARD_PREFIX_BYTES = 3;

const PREFIX_BYTES = 6;
const HEADER_BYTES = 18;
const POSITION_BYTES = 13;
const MAX_NAME_BYTES = 32;
// MAX_TEXT_LEN in the firmware; a direct message carries no name prefix
const MAX_DIRECT_BYTES = 160;

function toPrefix(bytes) {
    const prefix = new Uint8Array(PREFIX_BYTES);
    prefix.set(Array.from(bytes ?? []).slice(0, PREFIX_BYTES));
    return prefix;
}

function encodeName(name) {
    const bytes = new TextEncoder().encode(name ?? "");
    if(bytes.length <= MAX_NAME_BYTES){
        return bytes;
    }
    // cut on a character boundary, never through a multi byte character
    let end = MAX_NAME_BYTES;
    while(end > 0 && (bytes[end] & 0xC0) === 0x80){
        end--;
    }
    return bytes.slice(0, end);
}

function decodeName(bytes) {
    return new TextDecoder().decode(bytes).replace(/\0+$/, "");
}

export function prefixHex(bytes) {
    return Array.from(bytes ?? []).slice(0, PREFIX_BYTES).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Addressed to every station: a roll call, or a position sent unasked. */
export const EVERYONE = new Uint8Array(PREFIX_BYTES);

export function isEveryone(prefix) {
    return Array.from(prefix ?? []).slice(0, PREFIX_BYTES).every((b) => b === 0);
}

function hexToBytes(hex) {
    const bytes = new Uint8Array(Math.floor((hex ?? "").length / 2));
    for(let i = 0; i < bytes.length; i++){
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

/** Whether a station, by its key, is among a roll call's heard list. */
export function isHeard(heard, publicKey) {
    const mine = prefixHex(publicKey).slice(0, HEARD_PREFIX_BYTES * 2);
    return (heard ?? []).includes(mine);
}

/** A random tag for a new request, so its answers can be told from others'. */
export function newTag() {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return bytes[0];
}

/**
 * Builds a payload. message is
 *   { kind, tag, to, from, name } and for a position also
 *   { latitude, longitude, fixTime, flags }
 * with to and from as public keys (only the first six bytes are used).
 */
export function encode(message) {

    const name = encodeName(message.name);
    const heard = message.kind === KIND.ROLL_CALL ? (message.heard ?? []).slice(0, 255) : [];
    const bodyBytes = message.kind === KIND.POSITION ? POSITION_BYTES
        : message.kind === KIND.ROLL_CALL ? 1 + heard.length * HEARD_PREFIX_BYTES
        : 0;
    const bytes = new Uint8Array(HEADER_BYTES + bodyBytes + name.length);
    const view = new DataView(bytes.buffer);

    bytes[0] = VERSION;
    bytes[1] = message.kind;
    view.setUint32(2, message.tag >>> 0, true);
    bytes.set(toPrefix(message.to), 6);
    bytes.set(toPrefix(message.from), 12);

    let offset = HEADER_BYTES;
    if(message.kind === KIND.POSITION){
        const noPosition = (message.flags & FLAG.NO_POSITION) !== 0;
        view.setInt32(offset, noPosition ? 0 : Math.round(message.latitude * 1e6), true);
        view.setInt32(offset + 4, noPosition ? 0 : Math.round(message.longitude * 1e6), true);
        view.setUint32(offset + 8, (message.fixTime ?? 0) >>> 0, true);
        bytes[offset + 12] = message.flags ?? 0;
        offset += POSITION_BYTES;
    } else if(message.kind === KIND.ROLL_CALL){
        bytes[offset++] = heard.length;
        for(const hex of heard){
            bytes.set(hexToBytes(hex).slice(0, HEARD_PREFIX_BYTES), offset);
            offset += HEARD_PREFIX_BYTES;
        }
    }

    bytes.set(name, offset);
    return bytes;

}

/** Reads a payload, or returns null for anything that is not one of ours. */
export function decode(payload) {

    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload ?? []);
    if(bytes.length < HEADER_BYTES || bytes[0] !== VERSION){
        return null;
    }

    const kind = bytes[1];
    if(!Object.values(KIND).includes(kind)){
        return null;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const message = {
        kind,
        tag: view.getUint32(2, true),
        to: bytes.slice(6, 12),
        from: bytes.slice(12, 18),
    };

    let offset = HEADER_BYTES;
    if(kind === KIND.POSITION){
        if(bytes.length < HEADER_BYTES + POSITION_BYTES){
            return null;
        }
        message.flags = bytes[offset + 12];
        message.hasPosition = (message.flags & FLAG.NO_POSITION) === 0;
        message.latitude = view.getInt32(offset, true) / 1e6;
        message.longitude = view.getInt32(offset + 4, true) / 1e6;
        message.fixTime = view.getUint32(offset + 8, true);
        message.messageToFollow = (message.flags & FLAG.MESSAGE_TO_FOLLOW) !== 0;
        message.liveFix = (message.flags & FLAG.LIVE_FIX) !== 0;
        message.lastKnown = (message.flags & FLAG.LAST_KNOWN) !== 0;
        message.manual = (message.flags & FLAG.MANUAL) !== 0;
        offset += POSITION_BYTES;
    } else if(kind === KIND.ROLL_CALL){
        const count = bytes[offset] ?? 0;
        if(bytes.length < offset + 1 + count * HEARD_PREFIX_BYTES){
            return null;
        }
        message.heard = [];
        for(let i = 0; i < count; i++){
            const start = offset + 1 + i * HEARD_PREFIX_BYTES;
            message.heard.push(prefixHex(bytes.slice(start, start + HEARD_PREFIX_BYTES)));
        }
        offset += 1 + count * HEARD_PREFIX_BYTES;
    }

    message.name = decodeName(bytes.slice(offset));
    return message;

}

function toBase64Url(bytes) {
    let binary = "";
    for(const b of bytes){
        binary += String.fromCharCode(b);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
    const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "===".slice((base64.length + 3) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * A roll call cut down to fit, if need be, by leaving out the stations heard
 * earliest. One left out only answers again, which costs a packet, not an answer.
 */
export function fitRollCall(message, maxBytes) {
    if(message.kind !== KIND.ROLL_CALL){
        return message;
    }
    let heard = [...(message.heard ?? [])];
    while(heard.length > 0 && encode({ ...message, heard }).length > maxBytes){
        heard = heard.slice(1);
    }
    return { ...message, heard };
}

// base64 grows the payload by a third, and the marker and a space come before it
function payloadTextBytes(message) {
    return 1 + DIRECT_MARKER.length + Math.ceil(encode(message).length * 4 / 3);
}

/**
 * The text of a direct message or room post carrying a payload. The readable
 * part is for a station without this app, which shows the text as it is.
 * maxBytes is 160 for a direct message and 151 for a room post.
 */
export function toDirectText(message, readable, maxBytes = MAX_DIRECT_BYTES) {
    // keep at least a short readable line, trimming a long heard list to make room
    let fitted = message;
    if(message.kind === KIND.ROLL_CALL){
        let heard = [...(message.heard ?? [])];
        while(heard.length > 0 && payloadTextBytes({ ...message, heard }) > maxBytes - 24){
            heard = heard.slice(1);
        }
        fitted = { ...message, heard };
    }
    const payload = ` ${DIRECT_MARKER}${toBase64Url(encode(fitted))}`;
    // the payload is what the other app reads, so if anything has to give it is
    // the readable line, cut on a character
    const room = maxBytes - new TextEncoder().encode(payload).length;
    let text = readable ?? "";
    while(new TextEncoder().encode(text).length > room){
        text = text.slice(0, -1);
    }
    return `${text}${payload}`;
}

/** The payload inside a direct message's text, or null if there is none. */
export function fromDirectText(text) {
    const at = (text ?? "").lastIndexOf(DIRECT_MARKER);
    if(at < 0){
        return null;
    }
    const encoded = text.slice(at + DIRECT_MARKER.length).trim().split(/\s/)[0];
    try {
        return decode(fromBase64Url(encoded));
    } catch(e) {
        return null;
    }
}
