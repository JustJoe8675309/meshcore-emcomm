import { reactive } from "vue";

/**
 * Whether a message this station sent was heard being passed on by a repeater.
 *
 * Asked for 29 Sep and built 30 Sep ("the goal is to get a heard by # if your
 * message hits a repeater and you hear the repeat"). A channel message gets no
 * acknowledgement at all, so until this an operator could not tell a message that
 * reached the mesh from one that went nowhere. Hearing a repeater rebroadcast it is
 * the one signal there is.
 *
 * **Heard is not delivered.** It means a repeater picked the message up and sent it
 * on, which proves it left this station's own patch of air -- not that anybody
 * received it. Every place this is shown has to keep that distinction.
 *
 * How it is heard: the radio pushes every packet it receives to the app as raw
 * bytes (PUSH_CODE_LOG_RX_DATA, 0x88), and a repeater's rebroadcast of our own
 * packet arrives there like any other, with the repeater's hash added to the path.
 * Proven on node 2, 30 Sep: one channel message came back five times within three
 * seconds, two copies from repeaters that heard node 2 directly and three more
 * after two or three hops.
 *
 * Matching:
 *  - a **channel** message is matched exactly. The app holds every channel's key,
 *    so the rebroadcast is decrypted, its MAC checked, and its sender name, text
 *    and send time compared with what was sent -- the same plaintext the firmware
 *    builds: a 4-byte time, a flags byte, then "name: text";
 *  - a **direct** message cannot be decrypted here -- that needs the radio's private
 *    key -- so it is matched on the packet's own tags: a text message whose source
 *    hash is this station's and whose destination hash is the contact's, heard in
 *    the minutes after sending. One byte each, so close rather than certain.
 *
 * Each distinct copy counts once: the same repeater does not rebroadcast twice, and
 * the radio logs a copy for every time it hears one, so copies are told apart by
 * the route they came by.
 */
export default class Heard {

    /** how long after a send its rebroadcasts are still looked for */
    static LISTEN_MILLIS = 5 * 60 * 1000;

    /** how far the time inside a channel packet may be from when the app sent it */
    static CLOCK_SLACK_SECONDS = 90;

    /** how many messages keep their heard record, newest first */
    static KEEP = 300;

    static STORAGE_KEY = "heard_repeats";

    static PAYLOAD_TYPE_TXT_MSG = 0x02;
    static PAYLOAD_TYPE_GRP_TXT = 0x05;

    /** message id -> the copies heard, as { key, route, path, snr, at } */
    static state = reactive({ byId: {} });

    /** sends still being listened for */
    static expecting = [];

    static loaded = false;

    // --- what was sent ---------------------------------------------------------

    /**
     * Note a channel message just sent, so its rebroadcasts can be recognised.
     * `secret` is the channel's 16-byte key; `name` is this node's advertised name,
     * which the firmware puts in front of the text.
     */
    static expectChannel({ id, secret, name, text, sentAt = Date.now() }) {
        if(id == null || secret == null || name == null){
            return;
        }
        this.forgetStale();
        this.expecting.push({ kind: "channel", id, secret: new Uint8Array(secret), name, text, sentAt });
    }

    /**
     * Note a direct message just sent. `selfKey` and `contactKey` are the two public
     * keys; only their first bytes are on the wire.
     */
    static expectDirect({ id, selfKey, contactKey, sentAt = Date.now() }) {
        if(id == null || selfKey == null || contactKey == null){
            return;
        }
        this.forgetStale();
        this.expecting.push({ kind: "direct", id, src: selfKey[0], dest: contactKey[0], sentAt });
    }

    static forgetStale(now = Date.now()) {
        this.expecting = this.expecting.filter((e) => now - e.sentAt <= this.LISTEN_MILLIS);
    }

    // --- what was heard --------------------------------------------------------

    /**
     * One raw packet from the radio's receive log. Never throws: a packet that is
     * not ours, or not a packet at all, is simply not counted.
     */
    static async onRawPacket(raw, snr = null, now = Date.now()) {
        try {
            this.forgetStale(now);
            if(this.expecting.length === 0){
                return null;
            }
            const packet = this.parse(raw);
            if(packet == null){
                return null;
            }
            let id = null;
            if(packet.payloadType === this.PAYLOAD_TYPE_GRP_TXT){
                id = await this.matchChannel(packet.payload);
            } else if(packet.payloadType === this.PAYLOAD_TYPE_TXT_MSG){
                id = this.matchDirect(packet.payload);
            }
            if(id == null){
                return null;
            }
            this.record(id, packet, snr, now);
            return id;
        } catch(e) {
            return null;
        }
    }

    /** Header, transport codes, path and payload, as the firmware lays them out. */
    static parse(raw) {
        const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw ?? []);
        if(bytes.length < 2){
            return null;
        }
        const header = bytes[0];
        const route = header & 0x03;
        const payloadType = (header >> 2) & 0x0F;
        let i = 1;
        // transport flood and transport direct carry two 16-bit codes first
        if(route === 0x00 || route === 0x03){
            i += 4;
        }
        if(i >= bytes.length){
            return null;
        }
        const pathLen = bytes[i++];
        const hashSize = (pathLen >> 6) + 1;
        const hashCount = pathLen & 63;
        const pathEnd = i + hashSize * hashCount;
        if(pathEnd > bytes.length){
            return null;
        }
        const hashes = [];
        for(let h = 0; h < hashCount; h++){
            hashes.push(bytes.slice(i + h * hashSize, i + (h + 1) * hashSize));
        }
        return { route, payloadType, hashes, payload: bytes.slice(pathEnd) };
    }

    static async matchChannel(payload) {
        // channel hash (1), MAC (2), then whole AES blocks
        if(payload.length < 3 + 16 || (payload.length - 3) % 16 !== 0){
            return null;
        }
        const channelHash = payload[0];
        const mac = payload.slice(1, 3);
        const cipher = payload.slice(3);
        for(const e of this.expecting){
            if(e.kind !== "channel"){
                continue;
            }
            if((await ChannelCrypto.channelHash(e.secret)) !== channelHash){
                continue;
            }
            if(!(await ChannelCrypto.macMatches(e.secret, cipher, mac))){
                continue;
            }
            const plain = ChannelCrypto.readGroupText(await ChannelCrypto.decrypt(e.secret, cipher));
            if(plain.name !== e.name || plain.text !== e.text){
                continue;
            }
            if(Math.abs(plain.timestamp - e.sentAt / 1000) > this.CLOCK_SLACK_SECONDS){
                continue;
            }
            return e.id;
        }
        return null;
    }

    static matchDirect(payload) {
        // destination hash, source hash, MAC (2), then the cipher
        if(payload.length < 4){
            return null;
        }
        const dest = payload[0];
        const src = payload[1];
        // the newest send to that contact owns it: a second message to the same
        // station supersedes the first, and its copies are the ones still flying
        const candidates = this.expecting.filter((e) => e.kind === "direct" && e.src === src && e.dest === dest);
        if(candidates.length === 0){
            return null;
        }
        return candidates.reduce((a, b) => (b.sentAt >= a.sentAt ? b : a)).id;
    }

    static record(id, packet, snr, now) {
        this.load();
        const path = packet.hashes.map((h) => Array.from(h, (b) => b.toString(16).padStart(2, "0")).join(""));
        // a direct packet's path is the route still to go, a flood packet's the
        // route so far; either way two copies by the same route are one copy
        const key = `${packet.route}:${path.join(">")}`;
        const copies = this.state.byId[id] ?? [];
        if(copies.some((c) => c.key === key)){
            return;
        }
        this.state.byId[id] = [...copies, { key, route: packet.route, path, snr, at: now }];
        this.save();
    }

    // --- what is shown ---------------------------------------------------------

    /** How many copies of this message have been heard. */
    static count(id) {
        this.load();
        return this.state.byId[id]?.length ?? 0;
    }

    static copies(id) {
        this.load();
        return this.state.byId[id] ?? [];
    }

    /**
     * The words for the tap-through. Repeaters are named where the hash picks out
     * exactly one known contact; a one-byte hash often does not, so the hex stays.
     */
    static describe(id, contacts = []) {
        const copies = this.copies(id);
        const name = (hex) => {
            const byte = parseInt(hex.slice(0, 2), 16);
            const matches = contacts.filter((c) => c.publicKey?.[0] === byte);
            return matches.length === 1 ? `${matches[0].advName ?? matches[0].name ?? hex} (${hex})` : hex;
        };
        const lines = copies.map((c) => {
            if(c.path.length === 0){
                return "direct from a neighbour";
            }
            const via = c.path.map(name).join(" → ");
            const snr = c.snr == null ? "" : `, SNR ${c.snr}`;
            return `${via}${snr}`;
        });
        return [
            `Heard by ${copies.length}: a repeater passed it on ${copies.length === 1 ? "once" : `${copies.length} times`}.`,
            "Heard is not delivered: it shows the message left this station, not that anybody received it.",
            "",
            ...lines,
        ].join("\n");
    }

    // --- keeping it ------------------------------------------------------------

    static load() {
        if(this.loaded){
            return;
        }
        this.loaded = true;
        try {
            const stored = JSON.parse(localStorage.getItem(this.STORAGE_KEY) ?? "{}");
            if(stored && typeof stored === "object"){
                Object.assign(this.state.byId, stored);
            }
        } catch(e) {
            // a browser that refuses storage still counts, it just forgets on reload
        }
    }

    static save() {
        try {
            const ids = Object.keys(this.state.byId);
            if(ids.length > this.KEEP){
                const newest = (id) => Math.max(...this.state.byId[id].map((c) => c.at));
                ids.sort((a, b) => newest(a) - newest(b));
                for(const id of ids.slice(0, ids.length - this.KEEP)){
                    delete this.state.byId[id];
                }
            }
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state.byId));
        } catch(e) {
            // as above
        }
    }

    /** For tests, and for nothing else. */
    static reset() {
        this.expecting = [];
        for(const id of Object.keys(this.state.byId)){
            delete this.state.byId[id];
        }
        this.loaded = true;
    }

}

/**
 * MeshCore's channel crypto, done with the browser's own WebCrypto.
 *
 * The firmware encrypts a channel packet with AES-128 in ECB mode, the plaintext
 * zero-padded to whole blocks, and puts the first two bytes of an HMAC-SHA256 of
 * the cipher in front of it, keyed with the channel secret. WebCrypto has no ECB,
 * but one block of CBC with a zero IV is exactly one block of ECB, so each block
 * is done on its own. Decrypting needs one more step, since CBC insists on valid
 * padding: a second block is made that decrypts to a full padding block, and the
 * browser strips it. Checked against node 2's own packets, 30 Sep: the MAC matched
 * and the text read back as sent.
 */
export class ChannelCrypto {

    static keyCache = new Map();

    static hexOf(bytes) {
        return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }

    static async keys(secret) {
        const id = this.hexOf(secret);
        if(!this.keyCache.has(id)){
            const aes = await crypto.subtle.importKey("raw", secret.slice(0, 16), { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);
            // the firmware keys the MAC with its 32-byte secret field, the channel's
            // 16 bytes followed by zeros
            const macKey = new Uint8Array(32);
            macKey.set(secret.slice(0, 32));
            const hmac = await crypto.subtle.importKey("raw", macKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
            const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", secret.slice(0, 16)))[0];
            this.keyCache.set(id, { aes, hmac, hash });
        }
        return this.keyCache.get(id);
    }

    /** The one-byte tag a channel packet starts with: the first byte of SHA-256 of the key. */
    static async channelHash(secret) {
        return (await this.keys(secret)).hash;
    }

    static async encryptBlock(aes, block) {
        const out = await crypto.subtle.encrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, aes, block);
        return new Uint8Array(out).slice(0, 16);
    }

    static async decryptBlock(aes, block) {
        const padding = new Uint8Array(16).map((_, i) => 16 ^ block[i]);
        const both = new Uint8Array(32);
        both.set(block);
        both.set(await this.encryptBlock(aes, padding), 16);
        return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, aes, both));
    }

    static async encrypt(secret, plain) {
        const { aes } = await this.keys(secret);
        const padded = new Uint8Array(Math.ceil(plain.length / 16) * 16);
        padded.set(plain);
        const out = new Uint8Array(padded.length);
        for(let b = 0; b < padded.length; b += 16){
            out.set(await this.encryptBlock(aes, padded.slice(b, b + 16)), b);
        }
        return out;
    }

    static async decrypt(secret, cipher) {
        const { aes } = await this.keys(secret);
        const out = new Uint8Array(cipher.length);
        for(let b = 0; b < cipher.length; b += 16){
            out.set(await this.decryptBlock(aes, cipher.slice(b, b + 16)), b);
        }
        return out;
    }

    static async mac(secret, cipher) {
        const { hmac } = await this.keys(secret);
        return new Uint8Array(await crypto.subtle.sign("HMAC", hmac, cipher)).slice(0, 2);
    }

    static async macMatches(secret, cipher, mac) {
        const want = await this.mac(secret, cipher);
        return want[0] === mac[0] && want[1] === mac[1];
    }

    /** A 4-byte little-endian time, a flags byte, then "name: text", zero padded. */
    static readGroupText(plain) {
        const timestamp = (plain[0] | (plain[1] << 8) | (plain[2] << 16) | (plain[3] << 24)) >>> 0;
        let end = plain.length;
        while(end > 5 && plain[end - 1] === 0){
            end--;
        }
        const body = new TextDecoder().decode(plain.slice(5, end));
        const split = body.indexOf(": ");
        return {
            timestamp,
            flags: plain[4],
            name: split < 0 ? null : body.slice(0, split),
            text: split < 0 ? body : body.slice(split + 2),
        };
    }

    /** The whole channel packet payload the firmware would send, for tests. */
    static async groupTextPayload(secret, { timestamp, name, text, flags = 0 }) {
        const body = new TextEncoder().encode(`${name}: ${text}`);
        const plain = new Uint8Array(5 + body.length);
        plain[0] = timestamp & 0xFF;
        plain[1] = (timestamp >> 8) & 0xFF;
        plain[2] = (timestamp >> 16) & 0xFF;
        plain[3] = (timestamp >>> 24) & 0xFF;
        plain[4] = flags;
        plain.set(body, 5);
        const cipher = await this.encrypt(secret, plain);
        const mac = await this.mac(secret, cipher);
        const payload = new Uint8Array(3 + cipher.length);
        payload[0] = await this.channelHash(secret);
        payload.set(mac, 1);
        payload.set(cipher, 3);
        return payload;
    }

}
