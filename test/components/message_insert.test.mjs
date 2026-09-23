// Every field the message schema declares has to be copied by the insert.
//
// This reads the source rather than running the database, which is unusual and
// deliberate. `Database.Message.insert` rebuilds the document field by field
// instead of passing what it was given, so a field can exist in the schema, in
// the migration, in the caller and in the view, and still never be stored —
// silently, because nothing rejects the extra property, it is simply not copied.
//
// That is exactly what happened to `author_prefix`. A room post's author was
// recovered from the raw frame, the mangled text was replaced with the real one,
// and then the author was dropped on the way into the database. The text looked
// right, so nothing suggested anything had been lost.
//
// A round trip through RxDB would not catch it either: the document it stores is
// the one the insert built, and that document is self consistent.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { COLLECTIONS } from "../../src/js/Database.js";

const source = readFileSync("src/js/Database.js", "utf8");

/** The property names declared by a collection's schema. */
function schemaProperties(collection) {
    // the schemas themselves, not the shape of the file: this was reading them
    // back out of the source with a fixed indentation, and a refactor that moved
    // them four spaces left made three tests pass on empty lists
    const properties = COLLECTIONS[collection]?.schema?.properties;
    expect(properties, `there is no ${collection} collection`).toBeTruthy();
    return Object.keys(properties);
}

/** The field names the insert for a collection writes. */
function insertedFields(collection) {
    const at = source.indexOf(`database.${collection}.insert({`);
    expect(at).toBeGreaterThan(-1);

    const block = source.slice(at, source.indexOf("});", at));
    return [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
}

describe("the database insert keeps every field the schema declares", () => {

    it("copies every message field", () => {
        const declared = schemaProperties("messages");
        const written = insertedFields("messages");

        expect(declared.length).toBeGreaterThan(5);
        for(const field of declared){
            expect(written, `messages.${field} is in the schema but never copied by insert`).toContain(field);
        }
    });

    it("copies the room post author, which was the one that went missing", () => {
        expect(schemaProperties("messages")).toContain("author_prefix");
        expect(insertedFields("messages")).toContain("author_prefix");
    });

    it("copies every channel message field", () => {
        const declared = schemaProperties("channel_messages");
        const written = insertedFields("channel_messages");

        for(const field of declared){
            expect(written, `channel_messages.${field} is in the schema but never copied by insert`).toContain(field);
        }
    });

    it("keeps every schema's version ahead of its migrations", () => {
        // a field added without bumping the version is stored against the old
        // schema and dropped the same silent way
        for(const [name, collection] of Object.entries(COLLECTIONS)){
            const version = collection.schema.version;
            const migrations = Object.keys(collection.migrationStrategies ?? {}).map(Number);

            if(version === 0){
                expect(migrations, `${name} is at version 0 and needs no migrations`).toEqual([]);
                continue;
            }
            expect(migrations.length, `${name} is at version ${version} with no migrations`).toBeGreaterThan(0);
            expect(Math.max(...migrations), `${name}'s newest migration does not reach version ${version}`).toBe(version);
            // and every step from the version before it, or a document from an
            // older build has no route forward
            expect(migrations.sort((a, b) => a - b)).toEqual(Array.from({ length: version }, (_, i) => i + 1));
        }
    });

    it("has a migration for the channel key, since the rows that predate it have none", () => {
        expect(COLLECTIONS.channel_messages.schema.version).toBeGreaterThan(0);
        expect(COLLECTIONS.channel_messages.migrationStrategies[1]({ channel_idx: 3 }))
            .toEqual({ channel_idx: 3, channel_key: null });
    });

});
