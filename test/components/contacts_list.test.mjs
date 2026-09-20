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

    it("describes the lengths the firmware can actually produce", () => {
        expect(PathInfo.describe(-1)).toBe("No Path (Flood)");
        expect(PathInfo.describe(0)).toBe("Direct");
        expect(PathInfo.describe(1)).toBe("1 Hop");
        expect(PathInfo.describe(2)).toBe("2 Hops");
    });

    it("accepts the longest path the firmware allows", () => {
        // MAX_PATH_SIZE is 64, and out_path is a 64 byte array
        expect(PathInfo.describe(64)).toBe("64 Hops");
        expect(PathInfo.isKnownPath(64)).toBe(true);
    });

    it("refuses to call an impossible value a distance", () => {
        // a 128 hop station is not far away, it is not understood
        for(const value of [65, 128, -128, 255]){
            expect(PathInfo.isUnknown(value)).toBe(true);
            expect(PathInfo.describe(value)).toMatch(/^Unknown path/);
            expect(PathInfo.describe(value)).not.toMatch(/Hop/);
        }
    });

    it("keeps the raw value visible, so it can be reported", () => {
        expect(PathInfo.describe(128)).toContain("128");
    });

    it("treats a missing or fractional length as unknown rather than assuming", () => {
        for(const value of [null, undefined, 1.5, NaN]){
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

    it("leaves repeaters out, since the ping tab owns them", () => {
        const wrapper = mountList([
            aContact({ advName: "A User" }),
            aContact({ advName: "A Repeater", type: Constants.AdvType.Repeater }),
        ]);
        expect(wrapper.vm.searchedContacts.map((c) => c.advName)).toEqual(["A User"]);
    });

    it("leaves room servers out too, because they are not supported yet", () => {
        const wrapper = mountList([
            aContact({ advName: "A User" }),
            aContact({ advName: "A Room", type: Constants.AdvType.Room }),
        ]);
        expect(wrapper.vm.searchedContacts.map((c) => c.advName)).toEqual(["A User"]);
    });

    it("counts users rather than every contact, so the count matches the list", () => {
        const wrapper = mountList([
            aContact({ advName: "A User" }),
            aContact({ advName: "A Repeater", type: Constants.AdvType.Repeater }),
        ]);
        expect(wrapper.find("input").attributes("placeholder")).toMatch(/Search 1 User/);
    });

    it("says the tab is empty when every contact is a repeater", () => {
        const wrapper = mountList([aContact({ type: Constants.AdvType.Repeater })]);
        expect(wrapper.text()).toMatch(/No Users/);
        // and points at where they went, rather than implying none were heard
        expect(wrapper.text()).toMatch(/Ping tab/);
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
