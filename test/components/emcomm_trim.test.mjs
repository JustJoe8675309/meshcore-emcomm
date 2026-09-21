// Deciding which contacts EMCOMM mode removes, and removing them.
//
// The rules are in docs/EMCOMM-MODE.md. What these check is mostly the edges,
// because the middle is obvious and the edges are where a contact gets deleted
// that should not have been.
//
// The case worth the most attention is an unreadable age. `lastAdvert` is the
// advertising node's own clock, not when this node heard it, and on the bench a
// contact claimed an advert about four years in the future. Deleting a working
// repeater because its clock is wrong costs routing during an incident.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Constants } from "@liamcottle/meshcore.js";
import EmcommMode from "../../src/js/EmcommMode.js";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import Utils from "../../src/js/Utils.js";

const NOW = Math.floor(Date.UTC(2026, 8, 20) / 1000);
const DAY = 24 * 60 * 60;

let nextKey = 1;
function contact(type, daysAgo, overrides = {}) {
    const publicKey = new Uint8Array(32);
    publicKey[0] = nextKey++;
    return {
        publicKey,
        type,
        advName: `${type}-${daysAgo}`,
        lastAdvert: NOW - (daysAgo * DAY),
        ...overrides,
    };
}

const names = (list) => list.map((c) => c.advName);

describe("planning the trim", () => {

    beforeEach(() => { nextKey = 1; });

    it("removes every companion, however recently heard", () => {
        // a person's node re-adds itself the moment it adverts, so they are the
        // cheapest thing to clear and the easiest to get back
        const plan = EmcommMode.planTrim([
            contact(Constants.AdvType.Chat, 0),
            contact(Constants.AdvType.Chat, 200),
        ], NOW);

        expect(plan.remove).toHaveLength(2);
        expect(plan.keep).toHaveLength(0);
    });

    it("keeps repeaters and rooms heard inside 90 days", () => {
        const plan = EmcommMode.planTrim([
            contact(Constants.AdvType.Repeater, 1),
            contact(Constants.AdvType.Repeater, 89),
            contact(Constants.AdvType.Room, 30),
        ], NOW);

        expect(plan.remove).toHaveLength(0);
        expect(plan.keep).toHaveLength(3);
    });

    it("removes repeaters and rooms quiet for more than 90 days", () => {
        const plan = EmcommMode.planTrim([
            contact(Constants.AdvType.Repeater, 91),
            contact(Constants.AdvType.Room, 365),
        ], NOW);

        expect(plan.remove).toHaveLength(2);
    });

    it("keeps one heard exactly 90 days ago", () => {
        // the boundary belongs to the side that keeps, since keeping is the
        // cheaper mistake
        const plan = EmcommMode.planTrim([contact(Constants.AdvType.Repeater, 90)], NOW);
        expect(plan.remove).toHaveLength(0);
    });

    describe("an age that cannot be read", () => {

        const keptBy = (lastAdvert) => EmcommMode.planTrim(
            [contact(Constants.AdvType.Repeater, 0, { lastAdvert, advName: "Odd" })], NOW,
        );

        it("keeps a repeater whose clock says the future", () => {
            // the bench case: an advert dated about four years ahead
            const plan = keptBy(NOW + (4 * 365 * DAY));
            expect(names(plan.keep)).toEqual(["Odd"]);
            expect(plan.keptForUnreadableAge).toBe(1);
        });

        it("keeps one whose clock was never set", () => {
            expect(names(keptBy(0).keep)).toEqual(["Odd"]);
            expect(names(keptBy(1).keep)).toEqual(["Odd"]);
        });

        it("keeps one dated before MeshCore existed", () => {
            expect(names(keptBy(Math.floor(Date.UTC(2015, 0, 1) / 1000)).keep)).toEqual(["Odd"]);
        });

        it("keeps one with no timestamp at all", () => {
            expect(names(keptBy(undefined).keep)).toEqual(["Odd"]);
            expect(names(keptBy(null).keep)).toEqual(["Odd"]);
        });

        it("tolerates a clock running slightly fast", () => {
            // an hour ahead is drift, not nonsense, and the contact is recent, so
            // it is kept on its merits rather than flagged
            const plan = keptBy(NOW + 3600);
            expect(names(plan.keep)).toEqual(["Odd"]);
            expect(plan.keptForUnreadableAge).toBe(0);
        });

        it("still removes a companion with an unreadable age", () => {
            // companions go regardless, so the age never gets a say
            const plan = EmcommMode.planTrim(
                [contact(Constants.AdvType.Chat, 0, { lastAdvert: NOW + (4 * 365 * DAY) })], NOW,
            );
            expect(plan.remove).toHaveLength(1);
        });

    });

    it("leaves types it does not understand alone", () => {
        // sensors, and whatever a later firmware adds. not ours to judge
        const plan = EmcommMode.planTrim([contact(4, 500), contact(0, 500)], NOW);
        expect(plan.remove).toHaveLength(0);
        expect(plan.keep).toHaveLength(2);
    });

    it("counts what it is about to remove, by kind", () => {
        const plan = EmcommMode.planTrim([
            contact(Constants.AdvType.Chat, 1),
            contact(Constants.AdvType.Chat, 2),
            contact(Constants.AdvType.Repeater, 100),
            contact(Constants.AdvType.Room, 100),
            contact(Constants.AdvType.Repeater, 1),
        ], NOW);

        expect(plan.counts).toEqual({ companions: 2, rooms: 1, repeaters: 1 });
        expect(plan.keep).toHaveLength(1);
    });

    it("copes with an empty list", () => {
        expect(EmcommMode.planTrim([], NOW).remove).toEqual([]);
        expect(EmcommMode.planTrim(null, NOW).remove).toEqual([]);
    });

});

describe("carrying out the trim", () => {

    let radio, plan;

    function fakeRadio({ ignores = [] } = {}) {
        return {
            attempts: [],
            held: [],
            on() {}, off() {},
            async removeContact(publicKey) {
                const hex = Utils.bytesToHex(publicKey);
                this.attempts.push(hex);
                if(ignores.includes(this.attempts.filter((a) => a === hex).length)){
                    // the command went out and nothing happened, which is what a
                    // dropped frame looks like from here
                    return;
                }
                this.held = this.held.filter((c) => Utils.bytesToHex(c.publicKey) !== hex);
            },
        };
    }

    beforeEach(() => {
        nextKey = 1;
        const contacts = [
            contact(Constants.AdvType.Chat, 1),
            contact(Constants.AdvType.Chat, 2),
            contact(Constants.AdvType.Repeater, 1),
        ];
        plan = EmcommMode.planTrim(contacts, NOW);
        radio = fakeRadio();
        radio.held = [...contacts];
        GlobalState.connection = radio;
        GlobalState.contacts = radio.held;
        vi.spyOn(Connection, "loadContacts").mockImplementation(async () => {
            GlobalState.contacts = radio.held;
        });
    });

    it("removes what the plan named and nothing else", async () => {
        const result = await EmcommMode.trim(plan);
        expect(result.removed).toBe(2);
        expect(result.notRemoved).toEqual([]);
        expect(names(radio.held)).toEqual(["2-1"]);   // the repeater
    });

    it("reads the list back rather than trusting the commands took", async () => {
        await EmcommMode.trim(plan);
        expect(Connection.loadContacts).toHaveBeenCalled();
    });

    it("tries again for a removal the device ignored", async () => {
        // one command per contact over a link measured dropping frames
        radio = fakeRadio({ ignores: [1] });
        const contacts = [contact(Constants.AdvType.Chat, 1)];
        radio.held = [...contacts];
        GlobalState.connection = radio;
        Connection.loadContacts.mockImplementation(async () => {
            GlobalState.contacts = radio.held;
        });

        const result = await EmcommMode.trim(EmcommMode.planTrim(contacts, NOW));

        expect(result.removed).toBe(1);
        expect(radio.attempts).toHaveLength(2);   // first ignored, second took
    });

    it("gives up after a bounded number of passes and names the survivors", async () => {
        radio = fakeRadio({ ignores: [1, 2, 3, 4, 5] });
        const contacts = [contact(Constants.AdvType.Chat, 1, { advName: "Stubborn" })];
        radio.held = [...contacts];
        GlobalState.connection = radio;
        Connection.loadContacts.mockImplementation(async () => {
            GlobalState.contacts = radio.held;
        });

        const result = await EmcommMode.trim(EmcommMode.planTrim(contacts, NOW));

        expect(result.removed).toBe(0);
        expect(result.notRemoved).toEqual(["Stubborn"]);
        expect(radio.attempts.length).toBeLessThanOrEqual(3);
    });

    it("reports progress, since this is hundreds of commands", async () => {
        const seen = [];
        await EmcommMode.trim(plan, (p) => seen.push(p));
        expect(seen.length).toBeGreaterThan(0);
        expect(seen[0]).toMatchObject({ pass: 1 });
    });

    it("refuses without a radio", async () => {
        GlobalState.connection = null;
        await expect(EmcommMode.trim(plan)).rejects.toThrow(Connection.DISCONNECTED);
    });

});

describe("the radio preset", () => {

    it("is the only one MeshCore publishes", () => {
        // USA/Canada (Recommended) from the FAQ. Frequency in kHz, bandwidth in
        // Hz, matching what the device reports so they round trip untouched.
        expect(EmcommMode.US_PRESET).toEqual({
            radioFreq: 910525, radioBw: 62500, radioSf: 7, radioCr: 5,
        });
    });

    it("recognises a radio already on those settings", () => {
        // the bench node is, so the dialog shows no change and is a confirm
        expect(EmcommMode.radioMatches(
            { radioFreq: 910525, radioBw: 62500, radioSf: 7, radioCr: 5 }, EmcommMode.US_PRESET,
        )).toBe(true);
    });

    it("spots a radio that differs in any one field", () => {
        for(const field of ["radioFreq", "radioBw", "radioSf", "radioCr"]){
            const self = { ...EmcommMode.US_PRESET, [field]: 1 };
            expect(EmcommMode.radioMatches(self, EmcommMode.US_PRESET)).toBe(false);
        }
    });

});

describe("applying the settings", () => {

    let radio;

    function settingsRadio() {
        return {
            calls: [],
            on() {}, off() {},
            async setAdvertName(v) { this.calls.push(["name", v]); },
            async setRadioParams(f, bw, sf, cr) { this.calls.push(["radio", f, bw, sf, cr]); },
            async setTxPower(v) { this.calls.push(["txPower", v]); },
            async setAdvertLatLong(a, b) { this.calls.push(["position", a, b]); },
            async setOtherParams(v) { this.calls.push(["manualAdd", v]); },
            async sendFloodAdvert() { this.calls.push(["advert", "flood"]); },
            async sendZeroHopAdvert() { this.calls.push(["advert", "zerohop"]); },
        };
    }

    beforeEach(() => {
        radio = settingsRadio();
        GlobalState.connection = radio;
        vi.restoreAllMocks();
    });

    it("applies what it was asked for and nothing else", async () => {
        const result = await EmcommMode.applySettings({
            name: "KJ5HBN-EMCOMM", txPower: 22, radio: EmcommMode.US_PRESET,
        });

        expect(radio.calls.map((c) => c[0])).toEqual(["name", "radio", "txPower"]);
        expect(result.failures).toEqual([]);
    });

    it("leaves out anything not asked for", async () => {
        await EmcommMode.applySettings({ txPower: 22 });
        expect(radio.calls.map((c) => c[0])).toEqual(["txPower"]);
    });

    it("keeps going when one setting fails, and names it", async () => {
        // stopping partway leaves a node that is neither what it was nor what was
        // asked for, and "the clock did not sync" is actionable where silence is not
        radio.setTxPower = async () => { throw new Error("refused"); };

        const result = await EmcommMode.applySettings({
            name: "KJ5HBN-EMCOMM", txPower: 22, radio: EmcommMode.US_PRESET,
        });

        expect(result.failures).toEqual([{ what: "transmit power", reason: "refused" }]);
        expect(result.applied).toEqual(["node name", "radio settings"]);
    });

    it("writes a live GPS fix as the advert position", async () => {
        vi.spyOn(Connection, "getPosition").mockResolvedValue({ latitude: 31.926986, longitude: -106.400129 });

        await EmcommMode.applySettings({ setPositionFromGps: true });

        expect(radio.calls).toEqual([["position", 31926986, -106400129]]);
    });

    it("leaves the position alone when there is no live fix", async () => {
        // writing 0,0 would format perfectly well and point at the Gulf of Guinea
        vi.spyOn(Connection, "getPosition").mockResolvedValue(null);

        const result = await EmcommMode.applySettings({ setPositionFromGps: true });

        expect(radio.calls).toEqual([]);
        expect(result.failures[0].reason).toMatch(/no live GPS fix/);
    });

    it("syncs the clock when asked", async () => {
        const sync = vi.spyOn(Connection, "syncDeviceTime").mockResolvedValue(undefined);
        await EmcommMode.applySettings({ syncClock: true });
        expect(sync).toHaveBeenCalled();
    });

    it("refuses without a radio", async () => {
        GlobalState.connection = null;
        await expect(EmcommMode.applySettings({ txPower: 22 })).rejects.toThrow(Connection.DISCONNECTED);
    });

    it("sends a flood advert by default and a zero hop one on request", async () => {
        await EmcommMode.announce(true);
        await EmcommMode.announce(false);
        expect(radio.calls).toEqual([["advert", "flood"], ["advert", "zerohop"]]);
    });

    it("sets the add contacts mode separately, for after discovery", async () => {
        await EmcommMode.setManualAddContacts(true);
        expect(radio.calls).toEqual([["manualAdd", true]]);
    });

});
