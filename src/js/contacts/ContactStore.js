/**
 * What this app already knows about a radio's contacts, kept between connects.
 *
 * The radio streams its contact list through a four-frame Bluetooth queue that drops
 * whatever it cannot fit, and it fills that queue with adverts and messages while the
 * list is going by. Reading all 260 contacts every connect through that queue is what
 * loses some every time -- docs/CONTACT-READ.md has the whole mechanism, verified in
 * the firmware source.
 *
 * So the list is kept here, per node, along with the newest `lastMod` seen. The next
 * connect asks the radio only for what changed since (`CMD_GET_CONTACTS` takes a
 * `since`; the firmware was built for this and the app never used it), which is a
 * handful of frames instead of hundreds. And a full read that comes up short can be
 * repaired by name, because with a stored list the app knows *which* contacts it did
 * not get, not just how many.
 *
 * Kept in localStorage like the node backups, in the same serialised shape, so the two
 * cannot drift apart. Every access is guarded: a browser can refuse storage outright
 * (Brave's Shields throw), and a contact list that will not persist must degrade to
 * today's behaviour -- a full read every connect -- rather than fail the connect.
 */

import Utils from "../Utils.js";

const PREFIX = "contacts_cache:";
const FORMAT_VERSION = 1;

// a save after every advert would write 50 KB of JSON several times a minute on a
// busy mesh; the list is only needed by the *next* connect, so coalesce
const SAVE_DELAY_MILLIS = 2000;

let saveTimer = null;
let pendingSave = null;

class ContactStore {

    static get SAVE_DELAY_MILLIS() {
        return SAVE_DELAY_MILLIS;
    }

    static key(nodeKeyHex) {
        return `${PREFIX}${nodeKeyHex}`;
    }

    /** The one shape, shared with the node backup so neither can drift. */
    static serialise(contact) {
        return {
            publicKey: Utils.bytesToHex(contact.publicKey),
            type: contact.type,
            flags: contact.flags,
            outPathLen: contact.outPathLen,
            outPath: Utils.bytesToHex(contact.outPath ?? new Uint8Array(64)),
            advName: contact.advName,
            lastAdvert: contact.lastAdvert,
            advLat: contact.advLat,
            advLon: contact.advLon,
            lastMod: contact.lastMod ?? 0,
        };
    }

    static deserialise(stored) {
        return {
            publicKey: Utils.hexToBytes(stored.publicKey),
            type: stored.type,
            flags: stored.flags,
            outPathLen: stored.outPathLen,
            outPath: Utils.hexToBytes(stored.outPath),
            advName: stored.advName,
            lastAdvert: stored.lastAdvert,
            advLat: stored.advLat,
            advLon: stored.advLon,
            lastMod: stored.lastMod ?? 0,
        };
    }

    /** The newest `lastMod` in a list, or 0 for an empty one. */
    static newest(contacts) {
        let newest = 0;
        for(const contact of contacts){
            const at = contact.lastMod ?? 0;
            if(at > newest){
                newest = at;
            }
        }
        return newest;
    }

    /**
     * What is stored for a node, or null when nothing is -- or nothing readable.
     * A store that cannot be read is treated as empty, which sends the connect down
     * the full-read path it has always taken.
     */
    static load(nodeKeyHex) {
        if(nodeKeyHex == null){
            return null;
        }
        try {
            const raw = window.localStorage.getItem(this.key(nodeKeyHex));
            if(raw == null){
                return null;
            }
            const stored = JSON.parse(raw);
            if(stored?.formatVersion !== FORMAT_VERSION || !Array.isArray(stored.contacts)){
                return null;
            }
            return {
                contacts: stored.contacts.map((c) => this.deserialise(c)),
                newestLastmod: stored.newestLastmod ?? 0,
                announcedTotal: stored.announcedTotal ?? null,
                savedAt: stored.savedAt ?? null,
            };
        } catch(e) {
            return null;
        }
    }

    /** Write the list now. Returns false when storage refused it. */
    static save(nodeKeyHex, contacts, newestLastmod, announcedTotal) {
        if(nodeKeyHex == null){
            return false;
        }
        try {
            window.localStorage.setItem(this.key(nodeKeyHex), JSON.stringify({
                formatVersion: FORMAT_VERSION,
                savedAt: Date.now(),
                newestLastmod: newestLastmod ?? this.newest(contacts),
                announcedTotal: announcedTotal ?? null,
                contacts: contacts.map((c) => this.serialise(c)),
            }));
            return true;
        } catch(e) {
            return false;
        }
    }

    /**
     * Write the list soon. Live pushes -- an advert heard, a contact evicted -- change
     * one contact at a time and can arrive several times a minute; the store only has
     * to be right by the next connect, so these are coalesced.
     */
    static saveSoon(nodeKeyHex, contacts, newestLastmod, announcedTotal) {
        pendingSave = { nodeKeyHex, contacts, newestLastmod, announcedTotal };
        if(saveTimer == null){
            saveTimer = setTimeout(() => {
                saveTimer = null;
                const p = pendingSave;
                pendingSave = null;
                if(p != null){
                    this.save(p.nodeKeyHex, p.contacts, p.newestLastmod, p.announcedTotal);
                }
            }, SAVE_DELAY_MILLIS);
        }
    }

    /** Write anything still pending, now. For tests and for a disconnect. */
    static flush() {
        if(saveTimer != null){
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        const p = pendingSave;
        pendingSave = null;
        if(p != null){
            this.save(p.nodeKeyHex, p.contacts, p.newestLastmod, p.announcedTotal);
        }
    }

    static forget(nodeKeyHex) {
        try {
            window.localStorage.removeItem(this.key(nodeKeyHex));
        } catch(e) {
            // nothing to forget, or nowhere to forget it from
        }
    }

}

export default ContactStore;
