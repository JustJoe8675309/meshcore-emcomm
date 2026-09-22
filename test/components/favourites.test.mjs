// Favourites, which live on the radio rather than in this browser.
//
// Bit 0 of a contact's flags is the firmware's own favourite mark. The rest of
// the byte is contact permissions, consulted when the node decides whether to
// answer a telemetry or location request, and the device command replaces the
// whole contact record rather than patching it. So the dangerous mistake here is
// not failing to set the bit; it is writing the byte back and quietly changing
// who may query the node.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { Constants } from "@liamcottle/meshcore.js";
import vClickOutside from "click-outside-vue3";
import ContactFlags from "../../src/js/ContactFlags.js";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import StationsList from "../../src/components/stations/StationsList.vue";
import SearchableSelect from "../../src/components/reports/SearchableSelect.vue";

const KEY_A = new Uint8Array(32).fill(0xaa);
const KEY_B = new Uint8Array(32).fill(0xbb);

function aContact(overrides = {}) {
    return {
        publicKey: KEY_A,
        type: Constants.AdvType.Chat,
        advName: "A User",
        lastAdvert: 1000,
        outPathLen: 0,
        outPath: new Uint8Array(64),
        flags: 0,
        advLat: 0,
        advLon: 0,
        ...overrides,
    };
}

function mountSelect(options) {
    return mount(SearchableSelect, { props: { options }, global: { plugins: [vClickOutside] } });
}

const labels = (wrapper) => wrapper.vm.filteredOptions.map((option) => option.label);

describe("ContactFlags", () => {

    it("reads the favourite bit", () => {
        expect(ContactFlags.isFavourite({ flags: 1 })).toBe(true);
        expect(ContactFlags.isFavourite({ flags: 0 })).toBe(false);
    });

    it("leaves the permission bits alone when favouriting", () => {
        const flags = 0b10101010;
        const on = ContactFlags.withFavourite(flags, true);
        expect(ContactFlags.isFavourite({ flags: on })).toBe(true);
        expect(ContactFlags.permissions(on)).toBe(ContactFlags.permissions(flags));
    });

    it("leaves the permission bits alone when unfavouriting", () => {
        const flags = 0b10101011;
        const off = ContactFlags.withFavourite(flags, false);
        expect(ContactFlags.isFavourite({ flags: off })).toBe(false);
        expect(ContactFlags.permissions(off)).toBe(ContactFlags.permissions(flags));
    });

    it("changes nothing when the bit already says what was asked for", () => {
        expect(ContactFlags.withFavourite(0b11111111, true)).toBe(0b11111111);
        expect(ContactFlags.withFavourite(0b11111110, false)).toBe(0b11111110);
    });

    it("copes with a contact whose flags never arrived", () => {
        expect(ContactFlags.isFavourite({})).toBe(false);
        expect(ContactFlags.isFavourite(null)).toBe(false);
        expect(ContactFlags.withFavourite(undefined, true)).toBe(1);
    });

});

describe("setting a favourite on the radio", () => {

    let sent;

    beforeEach(() => {
        sent = [];
        GlobalState.contacts = [aContact({ flags: 0b10101010 })];
        GlobalState.connection = {
            on() {},
            off() {},
            async addOrUpdateContact(...args) {
                sent.push(args);
            },
        };
        vi.spyOn(Connection, "loadContacts").mockResolvedValue(undefined);
    });

    it("sends the whole record back with only the favourite bit changed", async () => {
        await Connection.setContactFavourite(KEY_A, true);

        expect(sent).toHaveLength(1);
        const [publicKey, type, flags, outPathLen, outPath, advName, lastAdvert, advLat, advLon] = sent[0];
        expect(publicKey).toBe(KEY_A);
        expect(type).toBe(Constants.AdvType.Chat);
        expect(flags).toBe(0b10101011);

        // the command replaces the record, so everything else has to go back
        // exactly as it came or it is lost
        expect(outPathLen).toBe(0);
        expect(outPath).toHaveLength(64);
        expect(advName).toBe("A User");
        expect(lastAdvert).toBe(1000);
        expect([advLat, advLon]).toEqual([0, 0]);
    });

    it("clears the bit without disturbing the permissions", async () => {
        GlobalState.contacts = [aContact({ flags: 0b11111111 })];
        await Connection.setContactFavourite(KEY_A, false);
        expect(sent[0][2]).toBe(0b11111110);
    });

    it("keeps a path and position that the contact already had", async () => {
        const outPath = new Uint8Array(64);
        outPath.set([1, 2, 3], 0);
        GlobalState.contacts = [aContact({ outPathLen: 3, outPath, advLat: 31926942, advLon: -106400044 })];

        await Connection.setContactFavourite(KEY_A, true);

        const [, , , sentPathLen, sentPath, , , lat, lon] = sent[0];
        expect(sentPathLen).toBe(3);
        expect(Array.from(sentPath.slice(0, 3))).toEqual([1, 2, 3]);
        expect([lat, lon]).toEqual([31926942, -106400044]);
    });

    it("reads the contacts back rather than assuming the write took", async () => {
        await Connection.setContactFavourite(KEY_A, true);
        expect(Connection.loadContacts).toHaveBeenCalled();
    });

    it("refuses when there is no radio", async () => {
        GlobalState.connection = null;
        await expect(Connection.setContactFavourite(KEY_A, true)).rejects.toThrow(Connection.DISCONNECTED);
    });

    it("refuses for a contact it does not know", async () => {
        await expect(Connection.setContactFavourite(KEY_B, true)).rejects.toThrow(/no such contact/);
    });

});

describe("favourites in the lists", () => {

    it("lifts favourites to the top of the contacts tab", () => {
        GlobalState.contactsMissing = 0;
        const contacts = [
            aContact({ advName: "Heard Last", lastAdvert: 3000 }),
            aContact({ advName: "A Favourite", lastAdvert: 1000, flags: 1, publicKey: KEY_B }),
        ];

        const wrapper = mount(StationsList, {
            props: { contacts, channels: [] },
            global: { stubs: { ContactListItem: true, ChannelListItem: true, DropDownMenu: true, IconButton: true } },
        });

        // even though the other station was heard more recently
        expect(wrapper.vm.rows.map((r) => r.name)).toEqual(["A Favourite", "Heard Last"]);
    });

    it("lifts favourites to the top of any picker", () => {
        const wrapper = mountSelect([
            { value: "a", label: "Ordinary One" },
            { value: "b", label: "Starred", favorite: true },
            { value: "c", label: "Ordinary Two" },
        ]);
        expect(labels(wrapper)).toEqual(["Starred", "Ordinary One", "Ordinary Two"]);
    });

    it("keeps the caller's order within each group", () => {
        const wrapper = mountSelect([
            { value: "a", label: "First Plain" },
            { value: "b", label: "First Star", favorite: true },
            { value: "c", label: "Second Plain" },
            { value: "d", label: "Second Star", favorite: true },
        ]);
        expect(labels(wrapper)).toEqual(["First Star", "Second Star", "First Plain", "Second Plain"]);
    });

    it("still lifts favourites while filtering", () => {
        const wrapper = mountSelect([
            { value: "a", label: "Net Alpha" },
            { value: "b", label: "Net Bravo", favorite: true },
            { value: "c", label: "Other" },
        ]);
        wrapper.vm.query = "net";
        expect(labels(wrapper)).toEqual(["Net Bravo", "Net Alpha"]);
    });

    it("draws no divider when nothing is favourited", () => {
        const wrapper = mountSelect([{ value: "a", label: "One" }, { value: "b", label: "Two" }]);
        // a rule above the very first row would be noise
        expect(wrapper.vm.firstNonFavouriteIndex).toBe(null);
    });

    it("draws no divider when everything is favourited", () => {
        const wrapper = mountSelect([
            { value: "a", label: "One", favorite: true },
            { value: "b", label: "Two", favorite: true },
        ]);
        expect(wrapper.vm.firstNonFavouriteIndex).toBe(null);
    });

    it("marks where the favourites stop", () => {
        const wrapper = mountSelect([
            { value: "a", label: "Plain" },
            { value: "b", label: "Star", favorite: true },
        ]);
        expect(wrapper.vm.firstNonFavouriteIndex).toBe(1);
    });

});
