// Channel traffic belongs to a channel, not to the slot it arrived in.
//
// Reported from the operator's radio: converting the station to Emcomm-Training
// and opening #Emcomm-Training showed a conversation already in progress —
// Public's messages, because Public had been in that slot and channel history was
// filed under the slot number alone. In the station list the brand new channel
// also looked like the busiest thing on the radio.
//
// In a drill that is exactly the confusion DRILL marking exists to prevent, so a
// channel is now identified the way operators identify it: by its shared secret.
// That also means history follows a channel between slots, which mode switching
// does routinely.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ChannelKeys from "../../src/js/channels/ChannelKeys.js";
import Database from "../../src/js/Database.js";
import ChannelListItem from "../../src/components/channels/ChannelListItem.vue";
import StationsList from "../../src/components/stations/StationsList.vue";
import Connection from "../../src/js/Connection.js";
import ModeSwitch from "../../src/js/modes/ModeSwitch.js";
import GlobalState from "../../src/js/GlobalState.js";
import Utils from "../../src/js/Utils.js";

const PUBLIC_SECRET = "8b3387e9c5cdea6ac9e5edbaa115cd72";
const TRAINING_SECRET = "11".repeat(16);

describe("what identifies a channel", () => {

    afterEach(() => {
        GlobalState.channels = [];
    });

    it("is the shared secret, because that is what makes two radios the same channel", () => {
        expect(ChannelKeys.of({ name: "Public", secret: Utils.hexToBytes(PUBLIC_SECRET) })).toBe(PUBLIC_SECRET);
        // profiles and backups keep it as hex already, so both are accepted
        expect(ChannelKeys.of({ name: "Public", secret: PUBLIC_SECRET })).toBe(PUBLIC_SECRET);
    });

    it("is the same key whichever case it was written in", () => {
        expect(ChannelKeys.of({ secret: "AABB".repeat(8) })).toBe("aabb".repeat(8));
    });

    it("is nothing at all for an empty slot, which every radio has plenty of", () => {
        // the firmware answers an unused slot with an empty name and a zero
        // secret; a zero secret shared by 39 empty slots is not an identity
        expect(ChannelKeys.of({ name: "", secret: new Uint8Array(16) })).toBe(null);
        expect(ChannelKeys.of({ name: "", secret: "00".repeat(16) })).toBe(null);
        expect(ChannelKeys.of({ name: "Public" })).toBe(null);
        expect(ChannelKeys.of(null)).toBe(null);
    });

    it("can be asked of the radio by slot, for the paths that only know a slot", () => {
        // a channel message arrives carrying its channel index and nothing else
        GlobalState.channels = [
            { idx: 0, name: "Public", secret: Utils.hexToBytes(PUBLIC_SECRET) },
            { idx: 3, name: "#Emcomm-Training", secret: Utils.hexToBytes(TRAINING_SECRET) },
        ];

        expect(ChannelKeys.forSlot(3)).toBe(TRAINING_SECRET);
        expect(ChannelKeys.forSlot(0)).toBe(PUBLIC_SECRET);
        // a slot the radio has not reported: better no key than the wrong one
        expect(ChannelKeys.forSlot(9)).toBe(null);
    });

});

// The query decides what an operator sees in a conversation, so the selector is
// worth checking directly. RxDB's own matcher is not reachable without opening a
// database on an indexedDB this test environment does not have, so the rows are
// matched here by a stand-in that understands only the three operators the
// selector uses.
function matches(selector, row) {
    if(selector.$or){
        return selector.$or.some((s) => matches(s, row));
    }
    if(selector.$and){
        return selector.$and.every((s) => matches(s, row));
    }
    return Object.entries(selector).every(([field, test]) => {
        if("$eq" in test){
            return (row[field] ?? null) === test.$eq;
        }
        if("$gt" in test){
            return row[field] > test.$gt;
        }
        throw new Error(`the stand-in matcher does not know ${JSON.stringify(test)}`);
    });
}

const publicRow = { channel_idx: 3, channel_key: PUBLIC_SECRET, text: "morning net" };
const trainingRow = { channel_idx: 3, channel_key: TRAINING_SECRET, text: "DRILL check in" };
const legacyRow = { channel_idx: 3, channel_key: null, text: "from before the key was kept" };

describe("which messages a channel shows", () => {

    it("shows its own, and not those of whatever held the slot before", () => {
        const selector = Database.ChannelMessage.belongsTo(3, TRAINING_SECRET);

        expect(matches(selector, trainingRow)).toBe(true);
        // the reported fault: Public's traffic in the #Emcomm-Training conversation
        expect(matches(selector, publicRow)).toBe(false);
    });

    it("keeps its own history when it moves slot, which switching modes does", () => {
        // the same channel, written back into slot 7 on the way home
        const selector = Database.ChannelMessage.belongsTo(7, PUBLIC_SECRET);
        expect(matches(selector, publicRow)).toBe(true);
    });

    it("still shows the messages that predate the key, by slot", () => {
        // nobody loses their history by installing this build
        expect(matches(Database.ChannelMessage.belongsTo(3, TRAINING_SECRET), legacyRow)).toBe(true);
        // but only in the slot they arrived in, which is all the data says
        expect(matches(Database.ChannelMessage.belongsTo(5, TRAINING_SECRET), legacyRow)).toBe(false);
    });

    it("falls back to the slot when the channel has no key", () => {
        const selector = Database.ChannelMessage.belongsTo(3, null);
        expect(matches(selector, legacyRow)).toBe(true);
        expect(matches(selector, publicRow)).toBe(true);
    });

    it("counts only this channel's messages as unread", () => {
        const unread = (idx, key, since) => [publicRow, trainingRow, legacyRow]
            .map((row, i) => ({ ...row, timestamp: 100 + i }))
            .filter((row) => matches({
                $and: [{ timestamp: { $gt: since } }, Database.ChannelMessage.belongsTo(idx, key)],
            }, row));

        // a new channel in a used slot arrived with a badge showing the old
        // channel's whole history
        expect(unread(3, TRAINING_SECRET, 0).map((r) => r.text))
            .toEqual(["DRILL check in", "from before the key was kept"]);
        expect(unread(3, TRAINING_SECRET, 101).map((r) => r.text)).toEqual(["from before the key was kept"]);
    });

});

describe("the views ask for the channel they are showing", () => {

    beforeEach(() => {
        GlobalState.contactsMissing = 0;
        GlobalState.contactsAnnounced = null;
        GlobalState.contacts = [];
        window.localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it("counts unread against the channel, in the channel list", async () => {
        const seen = [];
        vi.spyOn(Database.ChannelMessage, "getChannelMessages").mockReturnValue({
            $: { subscribe: () => ({ unsubscribe() {} }) },
        });
        vi.spyOn(Database.ChannelMessagesReadState, "get").mockReturnValue({
            // RxDB hands a subscriber the current value straight away, and that
            // first call is what computes the badge
            $: { subscribe: (fn) => { fn({ timestamp: 0 }); return { unsubscribe() {} }; } },
            exec: async () => ({ timestamp: 0 }),
        });
        vi.spyOn(Database.ChannelMessage, "getChannelMessagesUnreadCount").mockImplementation((idx, since, key) => {
            seen.push({ idx, key });
            return { exec: async () => 0 };
        });

        const wrapper = mount(ChannelListItem, {
            props: { channel: { idx: 3, name: "#Emcomm-Training", secret: Utils.hexToBytes(TRAINING_SECRET) } },
            global: { stubs: { RouterLink: { template: "<a><slot/></a>" }, ChannelDropDownMenu: true } },
        });
        await flushPromises();
        wrapper.unmount();

        expect(seen.length).toBeGreaterThan(0);
        expect(seen[0]).toEqual({ idx: 3, key: TRAINING_SECRET });
    });

    it("sorts the one list by when this channel was last busy", async () => {
        const asked = [];
        vi.spyOn(Database.ChannelMessage, "getLatestChannelMessage").mockImplementation((idx, key) => {
            asked.push({ idx, key });
            return { exec: async () => null };
        });

        const wrapper = mount(StationsList, {
            props: {
                contacts: [],
                channels: [{ idx: 3, name: "#Emcomm-Training", secret: Utils.hexToBytes(TRAINING_SECRET) }],
            },
            global: { stubs: { ContactListItem: true, ChannelListItem: true, DropDownMenu: true, IconButton: true } },
        });
        await flushPromises();
        wrapper.unmount();

        expect(asked).toEqual([{ idx: 3, key: TRAINING_SECRET }]);
    });

    // The conversation and the channel menu are read from source: mounting the
    // message viewer means mounting a radio connection and a room session with it,
    // and what matters here is one argument at one call site.
    it("opens the conversation on the channel, not the slot", () => {
        const source = readFileSync(resolve("src/components/messages/MessageViewer.vue"), "utf8");
        expect(source).toContain("getChannelMessages(this.channel.idx, ChannelKeys.of(this.channel))");
    });

    it("deletes the history of the channel the operator had open", () => {
        // the way out of a conversation that is already mixed, and the reason it
        // has to delete by channel: on a station that has switched modes, the
        // channel's rows are no longer all in one slot
        const source = readFileSync(resolve("src/components/channels/ChannelDropDownMenu.vue"), "utf8");
        expect(source).toContain("deleteChannelMessages(this.channel.idx, ChannelKeys.of(this.channel))");
    });

});

describe("the last moment a station knows whose traffic a slot holds", () => {

    it("is the switch, and the switch claims those rows before overwriting", () => {
        // the loop is over the channels just read from the radio, before any
        // setChannel or deleteChannel runs; ordering is what makes it work, so it
        // is checked as ordering
        const source = readFileSync(resolve("src/js/modes/ModeSwitch.js"), "utf8");
        const attribute = source.indexOf("Database.ChannelMessage.attributeSlot");
        const clears = source.indexOf("Connection.deleteChannel(idx)");
        const writes = source.indexOf("Connection.setChannel(idx, channel.name");

        expect(attribute).toBeGreaterThan(-1);
        expect(attribute).toBeLessThan(writes);
        expect(attribute).toBeLessThan(clears);
    });

    it("does not refuse a switch over message history", () => {
        // the radio is the point of the exercise; a database that will not answer
        // is worth a line in the log and nothing more
        const source = readFileSync(resolve("src/js/modes/ModeSwitch.js"), "utf8");
        const at = source.indexOf("Database.ChannelMessage.attributeSlot");
        const around = source.slice(at - 200, at + 400);
        expect(around).toContain("try {");
        expect(around).toContain("catch");
    });

    it("stamps nothing when there is no channel to stamp it with", async () => {
        // an empty slot's zero secret must not become 39 slots' worth of one
        // shared identity
        expect(await Database.ChannelMessage.attributeSlot(4, null)).toBe(0);
    });

});

// Attributing by slot cannot be undone, so the dialog says it is about to happen.
//
// On a station whose conversation is already mixed — the fault that started all
// this — attributing by slot files the wrong channel's traffic under the channel
// that is there now, permanently. The operator can clear that one conversation
// first, and can only do that if they are told.
describe("what the switch dialog says about saved messages", () => {

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = {
            name: "Joe-KJ5HBN-HTv3", publicKey: new Uint8Array(32).fill(0x39),
            radioFreq: 906875, radioBw: 250000, radioSf: 10, radioCr: 5,
            txPower: 14, maxTxPower: 22, advLat: 0, advLon: 0,
            manualAddContacts: 1, reserved: new Uint8Array([0, 40, 0]),
        };
        GlobalState.channels = [{ idx: 0, name: "Public", secret: Utils.hexToBytes(PUBLIC_SECRET) }];
        vi.spyOn(Connection, "getChannel").mockImplementation(async (idx) => (
            idx >= 40 ? Promise.reject(new Error("no such slot")) : {
                channelIdx: idx, name: idx === 0 ? "Public" : "", secret: new Uint8Array(16),
            }
        ));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        GlobalState.channels = [];
    });

    it("counts them, and says what clearing one looks like", async () => {
        vi.spyOn(Database.ChannelMessage, "countUnattributed").mockResolvedValue(214);

        const { changes } = await ModeSwitch.describe("training");
        const line = changes.find((c) => c.includes("214"));

        expect(line).toBeTruthy();
        expect(line).toContain("Delete Message History");
    });

    it("says nothing when every message already knows its channel", async () => {
        vi.spyOn(Database.ChannelMessage, "countUnattributed").mockResolvedValue(0);

        const { changes } = await ModeSwitch.describe("training");
        expect(changes.some((c) => c.includes("Delete Message History"))).toBe(false);
    });

    it("describes the switch anyway when the database will not answer", async () => {
        vi.spyOn(Database.ChannelMessage, "countUnattributed").mockRejectedValue(new Error("the database is not open"));

        const { changes } = await ModeSwitch.describe("training");
        expect(changes.length).toBeGreaterThan(0);
        expect(changes.some((c) => c.includes("Delete Message History"))).toBe(false);
    });

});

// A row in the one list belongs to a channel, not to a slot.
//
// Found on the bench, on the build that fixed the conversation. Node 1 switched
// to Emcomm-Training, which put #Emcomm-Training into slot 0 where Public had
// been. The conversation opened correctly empty — and the list showed
// "#Emcomm-Training 91", Public's unread count, on a drill channel that had
// never carried a message.
//
// Vue keyed the row by slot, so it reused Public's component and only updated the
// name; mounted() never ran again and the subscription stayed on Public's key.
// The message viewer had already been given a watcher for the same reason when
// the router reused it between two conversations. This row had not.
describe("a channel row after the slot changes hands", () => {

    const PUBLIC = { idx: 0, name: "Public", secret: new Uint8Array(16).fill(0x8b) };
    const TRAINING = { idx: 0, name: "#Emcomm-Training", secret: new Uint8Array(16).fill(0x03) };

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("is keyed by the channel, so a new occupant gets its own row", async () => {
        const rows = [];
        vi.spyOn(Database.ChannelMessage, "getLatestChannelMessage").mockReturnValue({ exec: async () => null });

        const wrapper = mount(StationsList, {
            props: { contacts: [], channels: [PUBLIC] },
            global: { stubs: { ContactListItem: true, ChannelListItem: true, DropDownMenu: true, IconButton: true } },
        });
        await flushPromises();
        rows.push(wrapper.vm.rows[0].key);

        await wrapper.setProps({ channels: [TRAINING] });
        await flushPromises();
        rows.push(wrapper.vm.rows[0].key);

        expect(rows[0]).not.toBe(rows[1]);
        expect(rows[1]).toContain("0303");
    });

    it("counts the new channel's messages, not the old one's", async () => {
        const asked = [];
        vi.spyOn(Database.ChannelMessage, "getChannelMessages").mockReturnValue({
            $: { subscribe: () => ({ unsubscribe() {} }) },
        });
        vi.spyOn(Database.ChannelMessagesReadState, "get").mockReturnValue({
            $: { subscribe: (fn) => { fn({ timestamp: 0 }); return { unsubscribe() {} }; } },
            exec: async () => ({ timestamp: 0 }),
        });
        vi.spyOn(Database.ChannelMessage, "getChannelMessagesUnreadCount").mockImplementation((idx, since, key) => {
            asked.push(key);
            return { exec: async () => (key === Utils.bytesToHex(PUBLIC.secret) ? 91 : 0) };
        });

        const wrapper = mount(ChannelListItem, {
            props: { channel: PUBLIC },
            global: { stubs: { RouterLink: { template: "<a><slot/></a>" }, ChannelDropDownMenu: true } },
        });
        await flushPromises();
        expect(wrapper.vm.unreadMessagesCount).toBe(91);

        // the same row, handed a different channel by a mode switch
        await wrapper.setProps({ channel: TRAINING });
        await flushPromises();

        expect(asked.at(-1)).toBe(Utils.bytesToHex(TRAINING.secret));
        expect(wrapper.vm.unreadMessagesCount).toBe(0);
        wrapper.unmount();
    });

    it("lets go of the old channel's subscriptions", async () => {
        let live = 0;
        vi.spyOn(Database.ChannelMessage, "getChannelMessages").mockReturnValue({
            $: { subscribe: () => { live++; return { unsubscribe() { live--; } }; } },
        });
        vi.spyOn(Database.ChannelMessagesReadState, "get").mockReturnValue({
            $: { subscribe: () => { live++; return { unsubscribe() { live--; } }; } },
            exec: async () => ({ timestamp: 0 }),
        });
        vi.spyOn(Database.ChannelMessage, "getChannelMessagesUnreadCount").mockReturnValue({ exec: async () => 0 });

        const wrapper = mount(ChannelListItem, {
            props: { channel: PUBLIC },
            global: { stubs: { RouterLink: { template: "<a><slot/></a>" }, ChannelDropDownMenu: true } },
        });
        await flushPromises();
        expect(live).toBe(2);

        await wrapper.setProps({ channel: TRAINING });
        await flushPromises();
        // two, not four: the old channel's are gone rather than left running
        expect(live).toBe(2);

        wrapper.unmount();
        expect(live).toBe(0);
    });

});
