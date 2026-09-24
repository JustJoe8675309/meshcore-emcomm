// Backing up a node's configuration, and putting it back.
//
// This is the way home for EMCOMM mode, so what matters is not that a good
// backup round trips. It is that a bad one is recognised as bad: a backup that
// is quietly short looks like a way back right up until the moment it is
// needed, and by then the contacts it is missing have been deleted.

import { describe, it, expect, beforeEach, vi } from "vitest";
import NodeBackup from "../../src/js/NodeBackup.js";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import Utils from "../../src/js/Utils.js";

const NODE_KEY = new Uint8Array(32).fill(0xa7);

function aContact(n, overrides = {}) {
    const publicKey = new Uint8Array(32);
    publicKey[0] = n;
    return {
        publicKey, type: 1, flags: 0, outPathLen: 0, outPath: new Uint8Array(64),
        advName: `Contact ${n}`, lastAdvert: 1000 + n, advLat: 0, advLon: 0,
        ...overrides,
    };
}

function selfInfo(overrides = {}) {
    return {
        name: "Joe-KJ5HBN-HTv3", publicKey: NODE_KEY,
        advLat: 31926942, advLon: -106400044,
        txPower: 22, maxTxPower: 22,
        radioFreq: 910525, radioBw: 62500, radioSf: 7, radioCr: 5,
        manualAddContacts: 0,
        ...overrides,
    };
}

/** A radio that answers reads and records writes. */
function fakeRadio({ channels = {}, self = selfInfo() } = {}) {
    return {
        writes: [],
        on() {}, off() {},
        async getSelfInfo() { return self; },
        async getChannel(idx) {
            if(!(idx in channels)) throw new Error("no such channel");
            return { channelIdx: idx, name: channels[idx].name, secret: channels[idx].secret };
        },
        async setAdvertName(v) { this.writes.push(["name", v]); },
        async setAdvertLatLong(a, b) { this.writes.push(["position", a, b]); },
        async setTxPower(v) { this.writes.push(["txPower", v]); },
        async setRadioParams(f, bw, sf, cr) { this.writes.push(["radio", f, bw, sf, cr]); },
        async setOtherParams(v) { this.writes.push(["manualAdd", v]); },
        async setChannel(idx, name, secret) { this.writes.push(["channel", idx, name, secret]); },
        async addOrUpdateContact(key) { this.writes.push(["contact", Utils.bytesToHex(key).slice(0, 2)]); },
    };
}

describe("capturing a backup", () => {

    let radio;

    beforeEach(() => {
        radio = fakeRadio({ channels: { 0: { name: "Public", secret: new Uint8Array(16).fill(1) } } });
        GlobalState.connection = radio;
        GlobalState.contacts = [aContact(1), aContact(2)];
        GlobalState.contactsAnnounced = 2;
        GlobalState.contactsMissing = 0;
        vi.spyOn(Connection, "loadContacts").mockResolvedValue(undefined);
    });

    it("records the settings needed to put the node back", async () => {
        const backup = await NodeBackup.capture();
        expect(backup.settings).toMatchObject({
            name: "Joe-KJ5HBN-HTv3",
            txPower: 22,
            radioFreq: 910525, radioBw: 62500, radioSf: 7, radioCr: 5,
            advLat: 31926942, advLon: -106400044,
        });
    });

    it("keeps every contact field the device needs back", async () => {
        const backup = await NodeBackup.capture();
        // addOrUpdateContact replaces the whole record, so a field left out here
        // is a field lost on restore
        expect(Object.keys(backup.contacts[0]).sort()).toEqual([
            "advLat", "advLon", "advName", "flags", "lastAdvert",
            "outPath", "outPathLen", "publicKey", "type",
        ]);
    });

    it("re-reads the contact list rather than trusting what is in memory", async () => {
        // a single read over Bluetooth has come back up to 9% short
        await NodeBackup.capture();
        expect(Connection.loadContacts).toHaveBeenCalled();
    });

    it("says so when contacts are missing, rather than looking complete", async () => {
        GlobalState.contactsAnnounced = 265;
        GlobalState.contactsMissing = 13;
        const backup = await NodeBackup.capture();
        expect(backup.warnings.join(" ")).toMatch(/13 of 265/);
    });

    it("carries no warnings when everything was read", async () => {
        const backup = await NodeBackup.capture();
        expect(backup.warnings).toEqual([]);
    });

    it("reads past a channel index it cannot read", async () => {
        // getChannels in the library stops at the first failure, so one unreadable
        // channel would silently truncate the list and take the rest with it
        radio = fakeRadio({ channels: {
            0: { name: "Public", secret: new Uint8Array(16).fill(1) },
            3: { name: "Emcomm Testing", secret: new Uint8Array(16).fill(2) },
        } });
        GlobalState.connection = radio;

        const backup = await NodeBackup.capture();
        expect(backup.channels.map((c) => c.name)).toEqual(["Public", "Emcomm Testing"]);
    });

    it("leaves unused channel slots out", async () => {
        radio = fakeRadio({ channels: {
            0: { name: "Public", secret: new Uint8Array(16).fill(1) },
            1: { name: "   ", secret: new Uint8Array(16) },
        } });
        GlobalState.connection = radio;

        expect((await NodeBackup.capture()).channels).toHaveLength(1);
    });

    it("says so when no channel could be read at all", async () => {
        radio = fakeRadio({ channels: {} });
        GlobalState.connection = radio;
        const backup = await NodeBackup.capture();
        expect(backup.channels).toEqual([]);
        expect(backup.warnings.join(" ")).toMatch(/No channels could be read/);
    });

    it("refuses without a radio", async () => {
        GlobalState.connection = null;
        await expect(NodeBackup.capture()).rejects.toThrow(Connection.DISCONNECTED);
    });

});

describe("restoring a backup", () => {

    let radio, backup;

    beforeEach(async () => {
        radio = fakeRadio({ channels: { 0: { name: "Public", secret: new Uint8Array(16).fill(1) } } });
        GlobalState.connection = radio;
        GlobalState.contacts = [aContact(1), aContact(2)];
        GlobalState.contactsAnnounced = 2;
        GlobalState.contactsMissing = 0;
        vi.spyOn(Connection, "loadContacts").mockResolvedValue(undefined);
        vi.spyOn(Connection, "loadChannels").mockResolvedValue(undefined);
        backup = await NodeBackup.capture();
        radio.writes = [];
    });

    it("writes the settings, channels and contacts back", async () => {
        await NodeBackup.restore(backup);
        const kinds = radio.writes.map((w) => w[0]);
        expect(kinds).toContain("name");
        expect(kinds).toContain("radio");
        expect(kinds).toContain("channel");
        expect(kinds.filter((k) => k === "contact")).toHaveLength(2);
    });

    it("puts the radio settings back exactly as they were", async () => {
        await NodeBackup.restore(backup);
        expect(radio.writes.find((w) => w[0] === "radio")).toEqual(["radio", 910525, 62500, 7, 5]);
    });

    it("removes nothing, and reports what the backup does not contain", async () => {
        // restoring must never delete: trimming is EMCOMM mode's business, and
        // keeping them apart means a restore cannot lose anything by itself
        GlobalState.contacts = [aContact(1), aContact(2), aContact(9, { advName: "Met Since" })];
        const result = await NodeBackup.restore(backup);
        expect(result.notInBackup).toEqual(["Met Since"]);
    });

    it("keeps going when one write fails, and says which", async () => {
        // stopping halfway leaves the node in a state that is neither
        radio.setTxPower = async () => { throw new Error("nope"); };
        const result = await NodeBackup.restore(backup);
        expect(result.failures.map((f) => f.what)).toEqual(["transmit power"]);
        expect(radio.writes.filter((w) => w[0] === "contact")).toHaveLength(2);
    });

    it("reports progress so a long restore is not a frozen screen", async () => {
        const seen = [];
        await NodeBackup.restore(backup, (p) => seen.push(p));
        expect(seen.length).toBeGreaterThan(5);
        expect(seen[seen.length - 1].done).toBe(seen[0].total);
    });

    it("refuses a backup written by another version", async () => {
        await expect(NodeBackup.restore({ ...backup, formatVersion: 99 }))
            .rejects.toThrow(/different version/);
    });

    it("refuses without a radio", async () => {
        GlobalState.connection = null;
        await expect(NodeBackup.restore(backup)).rejects.toThrow(Connection.DISCONNECTED);
    });

});

describe("putting the node back exactly, when leaving EMCOMM mode", () => {

    const NODE_HEX = Utils.bytesToHex(NODE_KEY);
    let radio, backup, removed;

    beforeEach(async () => {
        window.localStorage.clear();
        radio = fakeRadio({ channels: { 0: { name: "Public", secret: new Uint8Array(16).fill(1) } } });
        GlobalState.connection = radio;
        GlobalState.selfInfo = selfInfo();
        GlobalState.contacts = [aContact(1), aContact(2)];
        GlobalState.contactsAnnounced = 2;
        GlobalState.contactsMissing = 0;
        vi.spyOn(Connection, "loadContacts").mockResolvedValue(undefined);
        vi.spyOn(Connection, "loadChannels").mockResolvedValue(undefined);
        removed = [];
        vi.spyOn(Connection, "removeContact").mockImplementation(async (key) => { removed.push(Utils.bytesToHex(key).slice(0, 2)); });
        const { default: AdvertSchedule } = await import("../../src/js/AdvertSchedule.js");
        const { default: PositionService } = await import("../../src/js/position/PositionService.js");
        AdvertSchedule.set(NODE_HEX, { zeroHopMinutes: 0, floodMinutes: 0 });
        PositionService.saveSettings({ autoAnswer: false }, NODE_HEX);
        backup = await NodeBackup.capture();
        radio.writes = [];
    });

    it("keeps this app's advert schedule, position settings and report time zone in the backup", () => {
        expect(backup.app.advertSchedule).toEqual({ zeroHopMinutes: 0, floodMinutes: 0 });
        expect(backup.app.positionSettings).toEqual({ autoAnswer: false });
        expect(backup.app.dtgZone).toBe("local");
        // the callsign names the person, not the node, so it is not taken back
        expect(backup.app.callsign).toBeUndefined();
    });

    it("puts the report time zone back, and leaves the callsign alone", async () => {
        const { default: OperatorSettings } = await import("../../src/js/reports/OperatorSettings.js");
        OperatorSettings.setDtgZone("zulu");
        OperatorSettings.setCallsign("KJ5HBN");
        await NodeBackup.restore(backup);
        expect(OperatorSettings.state.dtgZone).toBe("local");
        expect(OperatorSettings.callsign).toBe("KJ5HBN");
        OperatorSettings.setCallsign("");
    });

    it("puts them back: repeating adverts and position answering turned on in the mode go off again", async () => {
        const { default: AdvertSchedule } = await import("../../src/js/AdvertSchedule.js");
        const { default: PositionService } = await import("../../src/js/position/PositionService.js");
        vi.spyOn(AdvertSchedule, "start").mockImplementation(() => {});
        AdvertSchedule.set(NODE_HEX, { zeroHopMinutes: 30, floodMinutes: 240 });
        PositionService.saveSettings({ autoAnswer: true }, NODE_HEX);
        await NodeBackup.restore(backup);
        expect(AdvertSchedule.get(NODE_HEX)).toEqual({ zeroHopMinutes: 0, floodMinutes: 0 });
        expect(PositionService.settings(NODE_HEX)).toEqual({ autoAnswer: false });
        expect(AdvertSchedule.start).toHaveBeenCalledWith(NODE_HEX);
    });

    it("finds the contacts and channels added since, reading channels from the radio", async () => {
        GlobalState.contacts = [aContact(1), aContact(2), aContact(9, { advName: "Met Since" })];
        radio.getChannel = async (idx) => {
            const channels = { 0: "Public", 4: "Incident Tac 1" };
            if(!(idx in channels)) throw new Error("no such channel");
            return { channelIdx: idx, name: channels[idx], secret: new Uint8Array(16).fill(3) };
        };
        const extras = await NodeBackup.extras(backup);
        expect(extras.contacts.map((c) => c.advName)).toEqual(["Met Since"]);
        expect(extras.channels.map((c) => [c.idx, c.name])).toEqual([[4, "Incident Tac 1"]]);
    });

    it("removes what it was told to, and only that", async () => {
        const extras = { contacts: [aContact(9, { advName: "Met Since" })], channels: [{ idx: 4, name: "Incident Tac 1" }] };
        const result = await NodeBackup.restore(backup, () => {}, { remove: extras });
        expect(result.failures).toEqual([]);
        expect(removed).toEqual(["09"]);
        const cleared = radio.writes.find((w) => w[0] === "channel" && w[1] === 4);
        expect(cleared[2]).toBe("");
        expect(Array.from(cleared[3])).toEqual(new Array(16).fill(0));
    });

    it("still removes nothing unless told to", async () => {
        GlobalState.contacts = [aContact(1), aContact(2), aContact(9)];
        await NodeBackup.restore(backup);
        expect(removed).toEqual([]);
        expect(radio.writes.filter((w) => w[0] === "channel" && w[2] === "")).toEqual([]);
    });

    it("restores a backup from before the app's settings were kept, leaving them alone", async () => {
        const { default: AdvertSchedule } = await import("../../src/js/AdvertSchedule.js");
        AdvertSchedule.set(NODE_HEX, { zeroHopMinutes: 30, floodMinutes: 0 });
        const { app, ...older } = backup;
        await NodeBackup.restore(older);
        expect(AdvertSchedule.get(NODE_HEX).zeroHopMinutes).toBe(30);
    });

});

describe("storing backups", () => {

    let backup;

    beforeEach(async () => {
        GlobalState.connection = fakeRadio();
        GlobalState.contacts = [aContact(1)];
        GlobalState.contactsAnnounced = 1;
        GlobalState.contactsMissing = 0;
        vi.spyOn(Connection, "loadContacts").mockResolvedValue(undefined);
        window.localStorage.clear();
        backup = await NodeBackup.capture();
    });

    it("keeps the two slots apart", async () => {
        NodeBackup.save({ ...backup, capturedAt: 1000 }, NodeBackup.SLOT_PRE_EMCOMM);
        NodeBackup.save({ ...backup, capturedAt: 2000 }, NodeBackup.SLOT_LATEST);

        // routine use of the backup button must not replace the way home
        expect(NodeBackup.load(backup.nodePublicKey, NodeBackup.SLOT_PRE_EMCOMM).capturedAt).toBe(1000);
        expect(NodeBackup.load(backup.nodePublicKey, NodeBackup.SLOT_LATEST).capturedAt).toBe(2000);
    });

    it("keeps each node's backups separate", () => {
        NodeBackup.save(backup, NodeBackup.SLOT_LATEST);
        expect(NodeBackup.load("ffff", NodeBackup.SLOT_LATEST)).toBe(null);
    });

    it("lists what exists, newest first", () => {
        NodeBackup.save({ ...backup, capturedAt: 1000 }, NodeBackup.SLOT_PRE_EMCOMM);
        NodeBackup.save({ ...backup, capturedAt: 5000 }, NodeBackup.SLOT_LATEST);
        expect(NodeBackup.list(backup.nodePublicKey).map((e) => e.slot))
            .toEqual([NodeBackup.SLOT_LATEST, NodeBackup.SLOT_PRE_EMCOMM]);
    });

    it("reports nothing rather than throwing when a slot is empty", () => {
        expect(NodeBackup.load(backup.nodePublicKey, NodeBackup.SLOT_LATEST)).toBe(null);
        expect(NodeBackup.list(backup.nodePublicKey)).toEqual([]);
    });

});

describe("backup files", () => {

    let backup;

    beforeEach(async () => {
        GlobalState.connection = fakeRadio();
        GlobalState.contacts = [aContact(1)];
        GlobalState.contactsAnnounced = 1;
        GlobalState.contactsMissing = 0;
        vi.spyOn(Connection, "loadContacts").mockResolvedValue(undefined);
        backup = await NodeBackup.capture();
    });

    it("names the file after the node and the moment", () => {
        const file = NodeBackup.toFile(backup);
        expect(file.filename).toMatch(/^meshcore-backup-Joe-KJ5HBN-HTv3-\d{4}-\d{2}-\d{2}/);
        expect(file.filename.endsWith(".json")).toBe(true);
    });

    it("round trips through a file", () => {
        const file = NodeBackup.toFile(backup);
        const read = NodeBackup.fromFile(file.contents);
        expect(read.contacts).toHaveLength(1);
        expect(read.settings.radioFreq).toBe(910525);
    });

    it("refuses a file that is not a backup", () => {
        expect(() => NodeBackup.fromFile("not json at all")).toThrow(/not a backup/);
        expect(() => NodeBackup.fromFile('{"hello":true}')).toThrow(/not a backup/);
    });

    it("refuses a backup belonging to a different node", () => {
        // writing another node's contacts and channels over this one would be
        // both wrong and hard to undo
        const file = NodeBackup.toFile(backup);
        expect(() => NodeBackup.fromFile(file.contents, "ffffffff")).toThrow(/different node/);
    });

    it("accepts a backup for the node it belongs to", () => {
        const file = NodeBackup.toFile(backup);
        expect(() => NodeBackup.fromFile(file.contents, backup.nodePublicKey)).not.toThrow();
    });

});
