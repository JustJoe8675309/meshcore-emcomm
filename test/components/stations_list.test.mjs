// Contacts and channels in one list.
//
// They were two tabs, so the operator had to know which kind of thing they were
// after before they could look for it. One list, a filter by kind, and a choice
// between alphabetical and what has been heard recently.
//
// A channel has no advert, so its "heard" time is the newest message on it. A
// channel that has never carried one has no time at all, which is not the same as
// being old, so it sorts to the end of that order rather than to the top.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Constants } from "@liamcottle/meshcore.js";
import StationsList from "../../src/components/stations/StationsList.vue";
import Database from "../../src/js/Database.js";
import GlobalState from "../../src/js/GlobalState.js";
import ContactFlags from "../../src/js/ContactFlags.js";

// somewhere in 2026, because a lastAdvert below 2020 is read as a clock that was
// never set rather than as an old advert: it is the other station's own stamp
const RECENT = Math.floor(Date.UTC(2026, 8, 23, 12, 0, 0) / 1000);

function aContact(name, { type = Constants.AdvType.Chat, lastAdvert = RECENT - 3600, favourite = false, key = null } = {}) {
    const publicKey = new Uint8Array(32).fill(key ?? name.charCodeAt(0));
    return {
        publicKey, type, advName: name, lastAdvert, outPathLen: 0,
        flags: favourite ? ContactFlags.FAVOURITE_BIT : 0,
    };
}

// the newest message on each channel, by slot, as the database would answer
function channelActivity(byIdx) {
    vi.spyOn(Database.ChannelMessage, "getLatestChannelMessage").mockImplementation((idx) => ({
        exec: async () => (idx in byIdx ? { timestamp: byIdx[idx] } : null),
    }));
}

async function mountList(contacts, channels, { order = "heard-recently", filter = "all" } = {}) {
    window.localStorage.setItem("stations_list_order", order);
    window.localStorage.setItem("stations_list_filter", filter);
    const wrapper = mount(StationsList, {
        props: { contacts, channels },
        global: { stubs: { ContactListItem: true, ChannelListItem: true, DropDownMenu: true, IconButton: true } },
    });
    await flushPromises();
    return wrapper;
}

const names = (wrapper) => wrapper.vm.rows.map((r) => r.name);

describe("one list for contacts and channels", () => {

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.contactsMissing = 0;
        GlobalState.contactsAnnounced = null;
        GlobalState.contacts = [];
        channelActivity({});
    });

    it("lists both kinds together", async () => {
        const wrapper = await mountList(
            [aContact("A User"), aContact("A Repeater", { type: Constants.AdvType.Repeater })],
            [{ idx: 0, name: "Public" }, { idx: 3, name: "Emcomm Testing" }],
        );
        expect(names(wrapper).sort()).toEqual(["A Repeater", "A User", "Emcomm Testing", "Public"]);
    });

    it("sorts everything alphabetically, both kinds mixed", async () => {
        const wrapper = await mountList(
            [aContact("Zulu"), aContact("Alpha")],
            [{ idx: 0, name: "Bravo" }, { idx: 1, name: "Yankee" }],
            { order: "a-z" },
        );
        expect(names(wrapper)).toEqual(["Alpha", "Bravo", "Yankee", "Zulu"]);
    });

    it("sorts by what was heard most recently, a channel by its newest message", async () => {
        // a channel is ranked by its newest message, in our own clock: busy 30
        // seconds ago, quiet a day ago, so the two contacts fall between them
        channelActivity({ 0: (RECENT - 30) * 1000, 1: (RECENT - 90000) * 1000 });
        const wrapper = await mountList(
            [aContact("Heard later", { lastAdvert: RECENT - 60 }), aContact("Heard earlier", { lastAdvert: RECENT - 600 })],
            [{ idx: 0, name: "Busy channel" }, { idx: 1, name: "Quiet channel" }],
        );
        expect(names(wrapper)).toEqual(["Busy channel", "Heard later", "Heard earlier", "Quiet channel"]);
    });

    it("puts a channel nothing was ever said on last, not first", async () => {
        channelActivity({});
        const wrapper = await mountList(
            [aContact("A User", { lastAdvert: RECENT - 10 })],
            [{ idx: 0, name: "Never used" }],
        );
        expect(names(wrapper)).toEqual(["A User", "Never used"]);
    });

    it("keeps favourites at the top of whatever order is chosen", async () => {
        const wrapper = await mountList(
            [aContact("Heard last", { lastAdvert: RECENT - 30 }), aContact("A Favourite", { lastAdvert: RECENT - 90000, favourite: true })],
            [{ idx: 0, name: "A Channel" }],
            { order: "a-z" },
        );
        expect(names(wrapper)[0]).toBe("A Favourite");
    });

    it("filters to channels alone", async () => {
        const wrapper = await mountList(
            [aContact("A User"), aContact("A Room", { type: Constants.AdvType.Room })],
            [{ idx: 0, name: "Public" }],
            { filter: "channel" },
        );
        expect(names(wrapper)).toEqual(["Public"]);
        expect(wrapper.find("input").attributes("placeholder")).toMatch(/Search 1 Channels/);
    });

    it("filters to one kind of contact, leaving channels out", async () => {
        const wrapper = await mountList(
            [aContact("A User"), aContact("A Room", { type: Constants.AdvType.Room })],
            [{ idx: 0, name: "Public" }],
            { filter: "room" },
        );
        expect(names(wrapper)).toEqual(["A Room"]);
    });

    it("searches both kinds by name, and contacts by key", async () => {
        const wrapper = await mountList(
            [aContact("One", { key: 0xab }), aContact("Two", { key: 0xcd })],
            [{ idx: 0, name: "Net control" }],
        );
        wrapper.vm.searchTerm = "net";
        expect(names(wrapper)).toEqual(["Net control"]);
        wrapper.vm.searchTerm = "abab";
        expect(names(wrapper)).toEqual(["One"]);
    });

    it("says when a search matches nothing, rather than showing an empty tab", async () => {
        const wrapper = await mountList([aContact("A User")], [{ idx: 0, name: "Public" }]);
        wrapper.vm.searchTerm = "nothing like this";
        await flushPromises();
        expect(wrapper.text()).toContain("Nothing matches that");
    });

    it("keeps the chosen filter and order for next time", async () => {
        const wrapper = await mountList([aContact("A User")], []);
        wrapper.vm.filter = "repeater";
        wrapper.vm.order = "a-z";
        await flushPromises();
        expect(window.localStorage.getItem("stations_list_filter")).toBe("repeater");
        expect(window.localStorage.getItem("stations_list_order")).toBe("a-z");
    });

    it("carries on when a channel's messages cannot be read", async () => {
        vi.spyOn(Database.ChannelMessage, "getLatestChannelMessage").mockImplementation(() => ({
            exec: async () => { throw new Error("the database is not open"); },
        }));
        const wrapper = await mountList([aContact("A User")], [{ idx: 0, name: "Public" }]);
        expect(names(wrapper)).toEqual(["A User", "Public"]);
    });

    it("says nothing is here only when both lists are empty", async () => {
        const wrapper = await mountList([], []);
        expect(wrapper.text()).toContain("Nothing here yet");
        const withChannel = await mountList([], [{ idx: 0, name: "Public" }]);
        expect(withChannel.text()).not.toContain("Nothing here yet");
    });

});

describe("the one tab", () => {

    it("opens for an old link that still says the channels tab", async () => {
        const { default: MainPage } = await import("../../src/components/pages/MainPage.vue");
        const tab = MainPage.computed.tab.get.call({ $route: { query: { tab: "channels" } } });
        expect(tab).toBe("contacts");
    });


    it("opens on everything, most recently heard first, for a browser that used the old separate tabs", async () => {
        // the old tabs kept their choices under contacts_list_*, and reading those
        // brought an A-Z, companions-only view across and the default never applied
        window.localStorage.clear();
        channelActivity({});
        window.localStorage.setItem("contacts_list_order", "a-z");
        window.localStorage.setItem("contacts_list_filter", "contact");
        GlobalState.contacts = [];
        GlobalState.contactsMissing = 0;

        const wrapper = mount(StationsList, {
            props: { contacts: [], channels: [] },
            global: { stubs: { ContactListItem: true, ChannelListItem: true, DropDownMenu: true, IconButton: true } },
        });
        await flushPromises();

        expect(wrapper.vm.order).toBe("heard-recently");
        expect(wrapper.vm.filter).toBe("all");
    });
});
