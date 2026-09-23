// The real schemas, against a real storage.
//
// Everything else about channel history is checked by reading the query or the
// source, because the app's own database is Dexie over an indexedDB this
// environment does not have. That leaves the two things most likely to be wrong
// and least likely to be noticed: whether the schema accepts the documents the
// app writes, and whether the storage will actually run the query the app asks.
// Both otherwise fail for the first time on a radio.
//
// So this opens RxDB's in-memory storage with the collections the app declares —
// imported, not copied, so they cannot drift — and puts messages through it.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRxDatabase, addRxPlugin } from "rxdb/plugins/core";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import { COLLECTIONS } from "../../src/js/Database.js";

addRxPlugin(RxDBMigrationSchemaPlugin);

const PUBLIC = "8b3387e9c5cdea6ac9e5edbaa115cd72";
const TRAINING = "11".repeat(16);

// the selector the app uses, so this tests that query and not a copy of it
function belongsTo(channelIdx, channelKey) {
    if(channelKey == null){
        return { channel_idx: { $eq: channelIdx } };
    }
    return {
        $or: [
            { channel_key: { $eq: channelKey } },
            { $and: [{ channel_key: { $eq: null } }, { channel_idx: { $eq: channelIdx } }] },
        ],
    };
}

let database;
let id = 0;

const row = (channelIdx, channelKey, text) => ({
    id: `row-${++id}`,
    channel_idx: channelIdx,
    channel_key: channelKey,
    from: null,
    path_len: 0,
    txt_type: 0,
    sender_timestamp: 1700000000,
    text: text,
    timestamp: 1700000000000 + id,
});

describe("the channel message schema and its queries", () => {

    beforeEach(async () => {
        database = await createRxDatabase({
            name: `test_db_${Date.now()}_${++id}`,
            storage: getRxStorageMemory(),
            // the app sets this too: a count over a selector with no index needs it
            allowSlowCount: true,
        });
        await database.addCollections(COLLECTIONS);
    });

    afterEach(async () => {
        await database?.remove();
    });

    it("stores a message with its channel's key, and one without", async () => {
        await database.channel_messages.insert(row(3, TRAINING, "DRILL check in"));
        // a message that arrived before the radio's channels were known
        await database.channel_messages.insert(row(3, null, "no key"));

        const all = await database.channel_messages.find().exec();
        expect(all.map((d) => d.channel_key).sort()).toEqual([TRAINING, null].sort());
    });

    it("runs the query that keeps one channel's traffic out of another's", async () => {
        await database.channel_messages.insert(row(3, PUBLIC, "morning net"));
        await database.channel_messages.insert(row(3, TRAINING, "DRILL check in"));
        await database.channel_messages.insert(row(3, null, "from before the key"));

        const found = await database.channel_messages.find({
            selector: belongsTo(3, TRAINING),
            sort: [{ timestamp: "asc" }],
        }).exec();

        expect(found.map((d) => d.text)).toEqual(["DRILL check in", "from before the key"]);
    });

    it("finds a channel's messages at a slot it is no longer in", async () => {
        await database.channel_messages.insert(row(3, PUBLIC, "morning net"));

        const found = await database.channel_messages.find({ selector: belongsTo(7, PUBLIC) }).exec();
        expect(found.map((d) => d.text)).toEqual(["morning net"]);
    });

    it("counts unread over the same selector, which needs the slow count the app allows", async () => {
        const first = row(3, TRAINING, "one");
        const second = row(3, TRAINING, "two");
        await database.channel_messages.insert(first);
        await database.channel_messages.insert(second);
        await database.channel_messages.insert(row(3, PUBLIC, "not this channel's"));

        const unread = await database.channel_messages.count({
            selector: { $and: [{ timestamp: { $gt: first.timestamp } }, belongsTo(3, TRAINING)] },
        }).exec();

        expect(unread).toBe(1);
    });

    it("patches a slot's unkeyed rows onto the channel that is leaving it", async () => {
        await database.channel_messages.insert(row(3, null, "public's, from before the key"));
        await database.channel_messages.insert(row(4, null, "another slot's"));

        const unkeyed = await database.channel_messages.find({
            selector: { $and: [{ channel_idx: { $eq: 3 } }, { channel_key: { $eq: null } }] },
        }).exec();
        for(const document of unkeyed){
            await document.patch({ channel_key: PUBLIC });
        }

        // the channel about to be written into slot 3 sees nothing
        const training = await database.channel_messages.find({ selector: belongsTo(3, TRAINING) }).exec();
        expect(training).toEqual([]);
        // and slot 4 was left alone
        const other = await database.channel_messages.find({ selector: belongsTo(4, TRAINING) }).exec();
        expect(other.map((d) => d.text)).toEqual(["another slot's"]);
    });

    it("counts what is not yet attributed, which is what the switch preview reports", async () => {
        await database.channel_messages.insert(row(3, null, "one"));
        await database.channel_messages.insert(row(4, null, "two"));
        await database.channel_messages.insert(row(5, TRAINING, "three"));

        const count = await database.channel_messages.count({
            selector: { channel_key: { $eq: null } },
        }).exec();
        expect(count).toBe(2);
    });

});

// The migration itself is not run here.
//
// It needs two opens of one storage, and the second one hangs: RxDB elects a
// leader across tabs before migrating, through the Web Locks API and a broadcast
// channel that this environment has neither of. What can be checked is checked
// elsewhere — the strategy is called directly in `message_insert.test.mjs`, and
// every version has a strategy covering every step from the one before it — and
// the rest is a line in the hardware checklist: a station with existing history
// must still have it after the first connect on this build.
