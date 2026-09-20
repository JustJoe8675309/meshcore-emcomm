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

const source = readFileSync("src/js/Database.js", "utf8");

/** The property names declared by a collection's schema. */
function schemaProperties(collection) {
    const start = source.indexOf(`${collection}: {`);
    expect(start).toBeGreaterThan(-1);

    const propertiesAt = source.indexOf("properties: {", start);
    const migrationsAt = source.indexOf("migrationStrategies", start);
    const end = migrationsAt > -1 ? migrationsAt : source.indexOf("\n        },", propertiesAt);

    const block = source.slice(propertiesAt, end);
    return [...block.matchAll(/^\s{20}(\w+):\s*\{/gm)].map((m) => m[1]);
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

    it("keeps the schema version ahead of its migrations", () => {
        // a field added without bumping the version is stored against the old
        // schema and dropped the same silent way
        const messages = source.slice(source.indexOf("messages: {"));
        const version = Number(messages.match(/version:\s*(\d+)/)[1]);
        const migrations = [...messages.slice(0, messages.indexOf("contact_messages_read_state"))
            .matchAll(/^\s{16}(\d+):\s*\(/gm)].map((m) => Number(m[1]));

        expect(migrations.length).toBeGreaterThan(0);
        expect(Math.max(...migrations)).toBe(version);
    });

});
