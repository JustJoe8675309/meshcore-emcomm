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
 *     Position request from KJ5HBN (answering needs MeshCore-Emcomm) #mce1:AQE...
 *
 * Payload, version 1, little endian:
 *
 *     0     version (1)
 *     1     kind: 1 request, 2 position, 3 declined
 *     2-5   tag, chosen by the requester and echoed in the answer
 *     6-11  the station it is for: the one asked, or for an answer, the one that asked
 *     12-17 the station it is from
 *     request:  18.. sender's name, UTF-8
 *     position: 18-21 latitude, 22-25 longitude (millionths of a degree, signed),
 *               26-29 fix time (unix seconds, 0 if not a live fix),
 *               30 flags (1 message to follow, 2 current GPS fix, 4 no position,
 *               8 last known position, not a current fix),
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
});

export const FLAG = Object.freeze({
    MESSAGE_TO_FOLLOW: 1,
    LIVE_FIX: 2,
    NO_POSITION: 4,
    // the position is the last one the radio held, not a fix confirmed current:
    // a radio without GPS, or a GPS whose position has stopped changing
    LAST_KNOWN: 8,
});

export const DIRECT_MARKER = "#mce1:";

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
    const bodyBytes = message.kind === KIND.POSITION ? POSITION_BYTES : 0;
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
        offset += POSITION_BYTES;
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
 * The text of a direct message carrying a payload. The readable part is for a
 * station without this app, which shows the text as it is.
 */
export function toDirectText(message, readable) {
    const payload = ` ${DIRECT_MARKER}${toBase64Url(encode(message))}`;
    // a direct message holds 160 bytes. The payload is what the other app reads,
    // so if anything has to give it is the readable line, cut on a character
    const room = MAX_DIRECT_BYTES - new TextEncoder().encode(payload).length;
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
