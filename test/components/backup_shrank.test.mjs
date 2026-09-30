// A connect must not quietly write a smaller radio over the way home.
//
// Found on node 1 on 29 Sep. A round trip lost 42 of the operator's contacts; the next
// connect captured the diminished radio straight over the good record, and a later one
// wrote over that, so 253 contacts became 211 then 210 and the evidence of the loss
// went with it.
//
// The refresh itself is not the bug and must not be removed: it is how a channel added
// with another app becomes part of the way home, and node 3 lost a channel to a record
// three days old. What was missing was a look before the write.
//
// See also [[serial-close-loses-writes]] for what caused the loss in the first place.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import NodeBackup from "../../src/js/NodeBackup.js";
import GlobalState from "../../src/js/GlobalState.js";
import ModeProfiles from "../../src/js/modes/ModeProfiles.js";
import BackupShrankDialog from "../../src/components/modes/BackupShrankDialog.vue";

const backup = (contacts, channels, missing = { contacts: 0, channelSlots: [], channelSlotsUnreadable: 0 }) => ({
    missing,
    contacts: Array.from({ length: contacts }, (_, i) => ({ publicKey: `${i}`.padStart(64, "0") })),
    channels: Array.from({ length: channels }, (_, i) => ({ idx: i, name: `c${i}`, secret: "00" })),
    capturedAt: 1790737170962,
    nodePublicKey: "aa".repeat(32),
});

describe("noticing that a capture would shrink the way home", () => {

    it("says nothing when the radio holds the same or more", () => {
        expect(NodeBackup.shrinkage(backup(211, 13), backup(211, 13))).toBe(null);
        expect(NodeBackup.shrinkage(backup(211, 13), backup(260, 16))).toBe(null);
    });

    // the real case: 253 contacts recorded, 211 on the radio
    it("notices the loss that started this", () => {
        const found = NodeBackup.shrinkage(backup(253, 13), backup(211, 13));
        expect(found).not.toBe(null);
        expect(found.contactsLost).toBe(42);
        expect(found.storedContacts).toBe(253);
        expect(found.freshContacts).toBe(211);
    });

    // a contact forgotten on purpose is ordinary. Asking about it would train the
    // operator to dismiss this unread, which is the habit that makes it useless later
    it("keeps quiet about ordinary housekeeping", () => {
        expect(NodeBackup.shrinkage(backup(211, 13), backup(210, 13))).toBe(null);
        expect(NodeBackup.shrinkage(backup(211, 13), backup(201, 13))).toBe(null);
    });

    it("speaks up once more than ten contacts are gone", () => {
        expect(NodeBackup.shrinkage(backup(211, 13), backup(200, 13))?.contactsLost).toBe(11);
    });

    // eleven of twenty is not housekeeping even though eleven of two hundred is
    it("scales to a small roster, where a fifth is few", () => {
        expect(NodeBackup.shrinkage(backup(20, 13), backup(19, 13))).toBe(null);
        expect(NodeBackup.shrinkage(backup(20, 13), backup(16, 13))?.contactsLost).toBe(4);
    });

    // a channel's key cannot be heard again, unlike a station, which re-adverts
    it("asks about a single lost channel, however many contacts are fine", () => {
        const found = NodeBackup.shrinkage(backup(211, 13), backup(211, 12));
        expect(found).not.toBe(null);
        expect(found.channelsLost).toBe(1);
        expect(found.contactsLost).toBe(0);
    });

    it("has nothing to compare against on a first connect", () => {
        expect(NodeBackup.shrinkage(null, backup(211, 13))).toBe(null);
        expect(NodeBackup.shrinkage(backup(211, 13), null)).toBe(null);
    });

});

describe("what the dialog does with the answer", () => {

    beforeEach(() => {
        vi.spyOn(NodeBackup, "save").mockReturnValue(true);
        vi.spyOn(ModeProfiles, "captureNormal").mockResolvedValue({});
        GlobalState.backupShrank = {
            shrinkage: NodeBackup.shrinkage(backup(253, 13), backup(211, 12)),
            backup: backup(211, 12),
            nodeKeyHex: "aa".repeat(32),
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.backupShrank = null;
    });

    it("says what is missing, in both kinds", () => {
        const wrapper = mount(BackupShrankDialog);
        expect(wrapper.text()).toContain("42 contacts missing");
        expect(wrapper.text()).toContain("1 channel is missing");
        expect(wrapper.text()).toContain("253 recorded, 211 on the radio");
    });

    it("says a channel's key cannot be got back, which is why it asks at all", () => {
        expect(mount(BackupShrankDialog).text()).toContain("cannot be heard again");
    });

    // the whole point: nothing is written until this is answered
    it("writes nothing while it is asking", () => {
        mount(BackupShrankDialog);
        expect(NodeBackup.save).not.toHaveBeenCalled();
        expect(ModeProfiles.captureNormal).not.toHaveBeenCalled();
    });

    it("writes nothing at all when the older record is kept", async () => {
        const wrapper = mount(BackupShrankDialog);

        await wrapper.findAll("button").find((b) => b.text().startsWith("Keep the older record")).trigger("click");

        expect(NodeBackup.save).not.toHaveBeenCalled();
        expect(ModeProfiles.captureNormal).not.toHaveBeenCalled();
        expect(GlobalState.backupShrank).toBe(null);
    });

    // both writes, or the profile and the backup would disagree about normal mode
    it("writes both when the radio is said to be right", async () => {
        const wrapper = mount(BackupShrankDialog);

        await wrapper.findAll("button").find((b) => b.text().startsWith("The radio is right")).trigger("click");
        await new Promise((r) => setTimeout(r, 0));

        expect(ModeProfiles.captureNormal).toHaveBeenCalledOnce();
        expect(NodeBackup.save).toHaveBeenCalledWith(expect.anything(), NodeBackup.SLOT_PRE_EMCOMM);
        expect(GlobalState.backupShrank).toBe(null);
    });

    it("is not on screen at all when there is nothing to ask", () => {
        GlobalState.backupShrank = null;
        expect(mount(BackupShrankDialog).find('[role="dialog"]').exists()).toBe(false);
    });

});

// The check that nearly was not tested.
//
// It first lived inline in the connect path, and every test above passed with it
// removed: the comparison and the dialog were both covered, and nothing noticed that
// nothing called them. A green suite guarding dead code. It is a method now so this
// can be asserted for real.
describe("recording normal mode at connect", () => {

    beforeEach(() => {
        vi.spyOn(NodeBackup, "save").mockReturnValue(true);
        vi.spyOn(ModeProfiles, "captureNormal").mockResolvedValue({});
        GlobalState.backupShrank = null;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.backupShrank = null;
    });

    it("writes the record when the radio has not shrunk", async () => {
        vi.spyOn(NodeBackup, "load").mockReturnValue(backup(211, 13));

        const outcome = await ModeProfiles.recordNormal(backup(215, 13), "aa".repeat(32));

        expect(outcome).toBe("saved");
        expect(NodeBackup.save).toHaveBeenCalledWith(expect.anything(), NodeBackup.SLOT_PRE_EMCOMM);
        expect(ModeProfiles.captureNormal).toHaveBeenCalledOnce();
        expect(GlobalState.backupShrank).toBe(null);
    });

    it("asks, and writes nothing, when it would shrink the way home", async () => {
        vi.spyOn(NodeBackup, "load").mockReturnValue(backup(253, 13));

        const outcome = await ModeProfiles.recordNormal(backup(211, 13), "aa".repeat(32));

        expect(outcome).toBe("asked");
        expect(NodeBackup.save).not.toHaveBeenCalled();
        expect(ModeProfiles.captureNormal).not.toHaveBeenCalled();
        expect(GlobalState.backupShrank?.shrinkage.contactsLost).toBe(42);
    });

    // the first connect to a radio has nothing to compare against and must not stall
    it("writes on a first connect, with no stored record", async () => {
        vi.spyOn(NodeBackup, "load").mockReturnValue(null);

        const outcome = await ModeProfiles.recordNormal(backup(211, 13), "aa".repeat(32));

        expect(outcome).toBe("saved");
        expect(NodeBackup.save).toHaveBeenCalledOnce();
    });

});

// A capture that could not read the radio is not evidence about the radio.
//
// Found on node 2 over Bluetooth on 29 Sep, live: a slow link returned no channels at
// all and the guard announced "8 channels are missing -- 8 recorded, 0 on the radio",
// in the wording reserved for something that cannot be recovered. Nothing had happened
// to the radio. The alarm that matters most is the one that must not cry wolf.
//
// The capture already recorded what it failed to read; shrinkage() simply ignored it.
describe("a capture that did not read properly", () => {

    const degradedChannels = { contacts: 0, channelSlots: [], channelSlotsUnreadable: 8 };
    const holeInTheMiddle = { contacts: 0, channelSlots: [3], channelSlotsUnreadable: 1 };
    const clean = { contacts: 0, channelSlots: [], channelSlotsUnreadable: 0 };

    it("is recognised when no slot answered at all", () => {
        expect(NodeBackup.captureIsDegraded(backup(200, 0, degradedChannels))).toBe(true);
    });

    // a total failure leaves channelSlots empty: there is no later slot to prove the
    // failures were holes, which is exactly why the count alone cannot tell
    it("is recognised when the count alone could not tell", () => {
        const b = backup(200, 0, degradedChannels);
        expect(b.missing.channelSlots).toEqual([]);
        expect(NodeBackup.captureIsDegraded(b)).toBe(true);
    });

    it("is recognised when a slot in the middle would not read", () => {
        expect(NodeBackup.captureIsDegraded(backup(200, 7, holeInTheMiddle))).toBe(true);
    });

    // backups saved before this field existed carry channelSlots and nothing else, so
    // the gap list is the only thing that can speak for them
    it("is recognised in a backup saved before the count was recorded", () => {
        const old = backup(200, 7, { contacts: 0, channelSlots: [3] });
        expect(old.missing.channelSlotsUnreadable).toBe(undefined);
        expect(NodeBackup.captureIsDegraded(old)).toBe(true);
    });

    it("is not claimed of a clean capture, or an old one with no record of it", () => {
        expect(NodeBackup.captureIsDegraded(backup(200, 8, clean))).toBe(false);
        expect(NodeBackup.captureIsDegraded({ contacts: [], channels: [] })).toBe(false);
    });

    describe("what recordNormal does with it", () => {

        beforeEach(() => {
            vi.spyOn(NodeBackup, "save").mockReturnValue(true);
            vi.spyOn(ModeProfiles, "captureNormal").mockResolvedValue({});
            GlobalState.backupShrank = null;
        });

        afterEach(() => {
            vi.restoreAllMocks();
            GlobalState.backupShrank = null;
        });

        // node 2's exact case: a good stored record, a fresh capture that read nothing
        it("neither writes it nor raises the alarm", async () => {
            vi.spyOn(NodeBackup, "load").mockReturnValue(backup(225, 8, clean));

            const outcome = await ModeProfiles.recordNormal(backup(192, 0, degradedChannels), "aa".repeat(32));

            expect(outcome).toBe("skipped");
            expect(NodeBackup.save).not.toHaveBeenCalled();
            expect(ModeProfiles.captureNormal).not.toHaveBeenCalled();
            expect(GlobalState.backupShrank).toBe(null);
        });

        // better no record than a confident wrong one, which is what captureNormal
        // has always done with a short read
        it("skips even when there is no stored record to protect", async () => {
            vi.spyOn(NodeBackup, "load").mockReturnValue(null);

            const outcome = await ModeProfiles.recordNormal(backup(192, 0, degradedChannels), "aa".repeat(32));

            expect(outcome).toBe("skipped");
            expect(NodeBackup.save).not.toHaveBeenCalled();
        });

        it("still writes a clean capture", async () => {
            vi.spyOn(NodeBackup, "load").mockReturnValue(backup(225, 8, clean));

            const outcome = await ModeProfiles.recordNormal(backup(230, 8, clean), "aa".repeat(32));

            expect(outcome).toBe("saved");
            expect(NodeBackup.save).toHaveBeenCalledOnce();
        });

    });

});

describe("contacts the read is known to have missed", () => {

    const short = (n) => ({ contacts: n, channelSlots: [], channelSlotsUnreadable: 0 });
    const clean = { contacts: 0, channelSlots: [], channelSlotsUnreadable: 0 };

    // node 2's stored backup records 33 of 258 unread. A roster that reads short every
    // time would otherwise raise this alarm every time
    it("are not counted as contacts the radio lost", () => {
        expect(NodeBackup.shrinkage(backup(225, 8, clean), backup(192, 8, short(33)))).toBe(null);
    });

    it("still notices a loss beyond what the read missed", () => {
        const found = NodeBackup.shrinkage(backup(225, 8, clean), backup(150, 8, short(33)));
        expect(found).not.toBe(null);
        expect(found.contactsLost).toBe(42);
    });

});

// A short contact read must not replace a record that is not short.
//
// The shrinkage guard deliberately does not fire on this -- contacts a read is known
// to have missed are not contacts the radio lost, or a roster that reads short every
// time would raise the alarm every time. That is right for the alarm, and it leaves
// this hole: the short capture simply overwrites, quietly.
//
// Node 2 over Bluetooth reads about 200 of 260, and its way home was saved missing 46.
// Coming home writes the backup's contacts back, so the ones never read are the ones
// the operator does not get back.
describe("a short read against a complete record", () => {

    const short = (n) => ({ contacts: n, channelSlots: [], channelSlotsUnreadable: 0 });
    const clean = { contacts: 0, channelSlots: [], channelSlotsUnreadable: 0 };

    beforeEach(() => {
        vi.spyOn(NodeBackup, "save").mockReturnValue(true);
        vi.spyOn(ModeProfiles, "captureNormal").mockResolvedValue({});
        GlobalState.backupShrank = null;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.backupShrank = null;
    });

    it("keeps the complete one and writes nothing", async () => {
        vi.spyOn(NodeBackup, "load").mockReturnValue(backup(260, 8, clean));

        const outcome = await ModeProfiles.recordNormal(backup(214, 8, short(46)), "aa".repeat(32));

        expect(outcome).toBe("kept");
        expect(NodeBackup.save).not.toHaveBeenCalled();
        expect(ModeProfiles.captureNormal).not.toHaveBeenCalled();
        // and it is not an alarm: nothing has gone wrong with the radio
        expect(GlobalState.backupShrank).toBe(null);
    });

    // a record missing some contacts beats no record at all, and it says what it is
    it("keeps a short first capture, since restoring only ever adds", async () => {
        vi.spyOn(NodeBackup, "load").mockReturnValue(null);

        const outcome = await ModeProfiles.recordNormal(backup(214, 8, short(46)), "aa".repeat(32));

        expect(outcome).toBe("saved");
        expect(NodeBackup.save).toHaveBeenCalledOnce();
    });

    it("refreshes when the stored record was short and this one holds more", async () => {
        vi.spyOn(NodeBackup, "load").mockReturnValue(backup(180, 8, short(80)));

        const outcome = await ModeProfiles.recordNormal(backup(214, 8, short(46)), "aa".repeat(32));

        expect(outcome).toBe("saved");
    });

    // seen on node 2: a read of 191 replaced a stored 214 because both were short.
    // The first version of this rule only protected a complete record, so the worse
    // of two short reads still won
    it("keeps the fuller record when both reads are short", async () => {
        vi.spyOn(NodeBackup, "load").mockReturnValue(backup(214, 8, short(46)));

        const outcome = await ModeProfiles.recordNormal(backup(191, 8, short(69)), "aa".repeat(32));

        expect(outcome).toBe("kept");
        expect(NodeBackup.save).not.toHaveBeenCalled();
    });

    // a complete read holding fewer is a real loss, and belongs to the guard that asks
    it("does not silently keep when a complete read holds fewer", async () => {
        vi.spyOn(NodeBackup, "load").mockReturnValue(backup(260, 8, clean));

        const outcome = await ModeProfiles.recordNormal(backup(200, 8, clean), "aa".repeat(32));

        expect(outcome).toBe("asked");
        expect(GlobalState.backupShrank).not.toBe(null);
    });

    it("still writes a complete read over a complete record", async () => {
        vi.spyOn(NodeBackup, "load").mockReturnValue(backup(260, 8, clean));

        const outcome = await ModeProfiles.recordNormal(backup(262, 8, clean), "aa".repeat(32));

        expect(outcome).toBe("saved");
    });

});
