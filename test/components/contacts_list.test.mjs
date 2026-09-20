// The contacts tab, which lists people, and the path each one is reachable by.
//
// Two faults here produced a confident wrong answer rather than an error. A path
// length outside the range the firmware can produce was rendered as a hop count,
// so a station the app did not understand read as one that was very far away. And
// a contact list truncated in transit is indistinguishable from a short one,
// because nothing compared what arrived against what the device said it would send.

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { Constants } from "@liamcottle/meshcore.js";
import ContactsList from "../../src/components/contacts/ContactsList.vue";
import PathInfo from "../../src/js/PathInfo.js";
import GlobalState from "../../src/js/GlobalState.js";

function aContact(overrides = {}) {
    return {
        publicKey: new Uint8Array(32).fill(1),
        type: Constants.AdvType.Chat,
        advName: "A User",
        lastAdvert: 1000,
        outPathLen: 0,
        ...overrides,
    };
}

// the list item subscribes to the message database, which this suite is not about
function mountList(contacts) {
    return mount(ContactsList, {
        props: { contacts },
        global: { stubs: { ContactListItem: true, DropDownMenu: true, IconButton: true } },
    });
}

describe("PathInfo", () => {

    // out_path_len is not a hop count. The firmware packs the hop count into the
    // low six bits and the path hash size into the top two (src/Packet.h), so
    // reading it as a number reports a direct contact as being far away.

    it("describes a single byte hash path, the common case", () => {
        expect(PathInfo.describe(-1)).toBe("No Path (Flood)");
        expect(PathInfo.describe(0)).toBe("Direct");
        expect(PathInfo.describe(1)).toBe("1 Hop");
        expect(PathInfo.describe(2)).toBe("2 Hops");
    });

    it("reads a direct contact using wider path hashes as direct", () => {
        // 0x80 is zero hops with three byte hashes, and was reported as 128 hops
        // away. meshcore.js reads the byte signed, so it arrives as -128.
        expect(PathInfo.describe(-128)).toBe("Direct");
        expect(PathInfo.decode(-128)).toMatchObject({ flood: false, hops: 0, hashSize: 3 });

        // and 0x40, the two byte hash equivalent
        expect(PathInfo.describe(64)).toBe("Direct");
        expect(PathInfo.decode(64)).toMatchObject({ hops: 0, hashSize: 2 });
    });

    it("counts hops the same whatever the hash size", () => {
        for(const [value, hashSize] of [[1, 1], [65, 2], [-127, 3]]){
            expect(PathInfo.describe(value)).toBe("1 Hop");
            expect(PathInfo.decode(value).hashSize).toBe(hashSize);
        }
    });

    it("accepts the most hops the field can hold", () => {
        // six bits, so 63 with single byte hashes, which is 63 of the 64 bytes
        expect(PathInfo.describe(63)).toBe("63 Hops");
        expect(PathInfo.hops(63)).toBe(63);
    });

    it("rejects a path that would not fit in MAX_PATH_SIZE", () => {
        // 0x7F is 63 hops of two byte hashes, which needs 126 bytes
        expect(PathInfo.isUnknown(127)).toBe(true);
    });

    it("rejects the reserved hash size", () => {
        // hash size 4 is reserved, which is also what keeps 0xFF unambiguous
        expect(PathInfo.isUnknown(192)).toBe(true);
    });

    it("keeps the no path sentinel distinct from any real path", () => {
        // 0xFF would decode to 63 hops of 4 byte hashes, which is reserved, so it
        // can never collide with a route
        expect(PathInfo.isFlood(-1)).toBe(true);
        expect(PathInfo.isFlood(255)).toBe(true);
        expect(PathInfo.hops(-1)).toBe(null);
    });

    it("keeps the raw value visible when it cannot be read", () => {
        expect(PathInfo.describe(192)).toBe("Unknown path (192)");
    });

    it("treats a missing or fractional length as unknown rather than assuming", () => {
        for(const value of [null, undefined, 1.5, NaN, "3"]){
            expect(PathInfo.isUnknown(value)).toBe(true);
        }
    });

});

describe("ContactsList", () => {

    beforeEach(() => {
        GlobalState.contactsMissing = 0;
        GlobalState.contactsAnnounced = null;
        GlobalState.contacts = [];
        window.localStorage.clear();
    });

    it("lists users", () => {
        const wrapper = mountList([aContact({ advName: "KJ5HBN" })]);
        expect(wrapper.vm.searchedContacts.map((c) => c.advName)).toEqual(["KJ5HBN"]);
    });

    it("lists every kind the radio knows", () => {
        const wrapper = mountList([
            aContact({ advName: "A User" }),
            aContact({ advName: "A Room", type: Constants.AdvType.Room }),
            aContact({ advName: "A Repeater", type: Constants.AdvType.Repeater }),
        ]);
        expect(wrapper.vm.searchedContacts.map((c) => c.advName).sort())
            .toEqual(["A Repeater", "A Room", "A User"]);
    });

    describe("the type filter", () => {

        const mixed = () => mountList([
            aContact({ advName: "A User" }),
            aContact({ advName: "A Room", type: Constants.AdvType.Room }),
            aContact({ advName: "A Repeater", type: Constants.AdvType.Repeater }),
        ]);

        it("narrows to companions", () => {
            const wrapper = mixed();
            wrapper.vm.filter = "companion";
            expect(wrapper.vm.searchedContacts.map((c) => c.advName)).toEqual(["A User"]);
        });

        it("narrows to rooms", () => {
            const wrapper = mixed();
            wrapper.vm.filter = "room";
            expect(wrapper.vm.searchedContacts.map((c) => c.advName)).toEqual(["A Room"]);
        });

        it("narrows to repeaters", () => {
            const wrapper = mixed();
            wrapper.vm.filter = "repeater";
            expect(wrapper.vm.searchedContacts.map((c) => c.advName)).toEqual(["A Repeater"]);
        });

        it("counts what it is showing, not everything", async () => {
            // the number beside Search has to match the rows below it
            const wrapper = mixed();
            wrapper.vm.filter = "repeater";
            await wrapper.vm.$nextTick();
            expect(wrapper.find("input").attributes("placeholder")).toMatch(/Search 1 Contact/);
        });

    });

    it("counts every listed contact", () => {
        const wrapper = mountList([
            aContact({ advName: "A User" }),
            aContact({ advName: "A Room", type: Constants.AdvType.Room }),
            aContact({ advName: "A Repeater", type: Constants.AdvType.Repeater }),
        ]);
        expect(wrapper.find("input").attributes("placeholder")).toMatch(/Search 3 Contacts/);
    });

    it("says the tab is empty only when there is nothing at all", () => {
        const wrapper = mountList([]);
        expect(wrapper.text()).toMatch(/No Contacts/);
    });

    it("searches by public key prefix as well as name", () => {
        const wrapper = mountList([
            aContact({ advName: "One", publicKey: new Uint8Array(32).fill(0xab) }),
            aContact({ advName: "Two", publicKey: new Uint8Array(32).fill(0xcd) }),
        ]);
        wrapper.vm.contactsSearchTerm = "abab";
        expect(wrapper.vm.searchedContacts.map((c) => c.advName)).toEqual(["One"]);
    });

    it("says so when the radio sent fewer contacts than it promised", async () => {
        // a truncated roster otherwise just looks like a shorter one
        GlobalState.contactsAnnounced = 206;
        GlobalState.contacts = new Array(200);
        GlobalState.contactsMissing = 6;
        const wrapper = mountList([aContact()]);
        expect(wrapper.text()).toMatch(/206/);
        expect(wrapper.text()).toMatch(/6 are missing/);
    });

    it("stays quiet when every contact arrived", () => {
        const wrapper = mountList([aContact()]);
        expect(wrapper.text()).not.toMatch(/missing/);
    });

});
