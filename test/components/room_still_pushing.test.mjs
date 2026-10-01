// A room still pushing after a reconnect is not "Not logged in".
//
// From the 27-28 Sep audit: after a radio reconnect the room kept pushing posts to
// the station -- it still held the session from before -- while the panel read
// "Not logged in" and the composer said to log in before posting. The instinctive
// remedy is the one that does nothing for a room that has stopped pushing: only a
// client request resets the room's failure count, which is what the two-minute
// keep-alive is, and a login on the ACL path skips that. So now a post from a room
// with no login on this connection marks the room as still pushing, restarts the
// keep-alive, and the panel says what is true. A log out on this connection is
// respected: a late post does not start the keep-alive again.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Constants } from "@liamcottle/meshcore.js";
import RoomLoginBar from "../../src/components/contacts/RoomLoginBar.vue";
import MessageViewer from "../../src/components/messages/MessageViewer.vue";
import GlobalState from "../../src/js/GlobalState.js";
import Connection from "../../src/js/Connection.js";
import Database from "../../src/js/Database.js";
import NotificationUtils from "../../src/js/NotificationUtils.js";
import RoomKeepAlive from "../../src/js/rooms/RoomKeepAlive.js";

const KEY = new Uint8Array(32).fill(0xab);
const KEY_HEX = Array.from(KEY).map((b) => b.toString(16).padStart(2, "0")).join("");
const ME = new Uint8Array(32).fill(0x11);
const room = () => ({ type: Constants.AdvType.Room, advName: "Test Room", publicKey: KEY, flags: 0 });

async function mountBar() {
    const wrapper = mount(RoomLoginBar, { props: { contact: room() } });
    await wrapper.vm.$nextTick();
    return wrapper;
}

const post = () => ({ pubKeyPrefix: KEY.slice(0, 6), txtType: 0, text: "DRILL net traffic", senderTimestamp: Math.floor(Date.now() / 1000), pathLen: 1 });

describe("a room still pushing after a reconnect", () => {

    let start;

    beforeEach(() => {
        GlobalState.connection = { on() {}, off() {}, async close() {} };
        GlobalState.selfInfo = { name: "NOCALL-HT", publicKey: ME };
        GlobalState.contacts = [room()];
        GlobalState.roomLogins = {};
        GlobalState.roomsStillPushing = {};
        GlobalState.roomsLeft = {};
        start = vi.spyOn(RoomKeepAlive, "start").mockReturnValue(undefined);
        vi.spyOn(RoomKeepAlive, "stop").mockReturnValue(undefined);
        vi.spyOn(RoomKeepAlive, "isRunning").mockReturnValue(false);
        vi.spyOn(Database.Message, "insert").mockResolvedValue({});
        vi.spyOn(NotificationUtils, "showNewMessageNotification").mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        GlobalState.contacts = [];
        GlobalState.roomLogins = {};
        GlobalState.roomsStillPushing = {};
        GlobalState.roomsLeft = {};
    });

    it("marks the room and restarts the keep-alive when a post arrives with no login", async () => {
        await Connection.onContactMessageReceived(post());
        expect(GlobalState.roomsStillPushing[KEY_HEX]).toBeTypeOf("number");
        expect(start).toHaveBeenCalledTimes(1);
        expect(Array.from(start.mock.calls[0][0])).toEqual(Array.from(KEY));
    });

    it("leaves a logged-in room alone: its login already runs the keep-alive", async () => {
        GlobalState.roomLogins = { [KEY_HEX]: { isAdmin: false, canPost: true } };
        await Connection.onContactMessageReceived(post());
        expect(GlobalState.roomsStillPushing[KEY_HEX]).toBe(undefined);
        expect(start).not.toHaveBeenCalled();
    });

    it("does not start a second keep-alive when one is already running", async () => {
        RoomKeepAlive.isRunning.mockReturnValue(true);
        await Connection.onContactMessageReceived(post());
        expect(GlobalState.roomsStillPushing[KEY_HEX]).toBeTypeOf("number");
        expect(start).not.toHaveBeenCalled();
    });

    it("says Receiving rather than Not logged in, explains, and still offers the login for posting", async () => {
        GlobalState.roomsStillPushing = { [KEY_HEX]: Date.now() };
        const wrapper = await mountBar();
        expect(wrapper.find("[data-room-status]").text()).toBe("Receiving, login not confirmed");
        expect(wrapper.find("[data-still-pushing]").text()).toContain("still arriving");
        expect(wrapper.find("[data-still-pushing]").text()).toContain("To post, log in again");
        expect(wrapper.text()).not.toContain("A room holds its posts until you log in");
        expect(wrapper.find("input[type='password']").exists()).toBe(true);
        wrapper.unmount();
    });

    it("still says Not logged in when nothing is arriving", async () => {
        const wrapper = await mountBar();
        expect(wrapper.find("[data-room-status]").text()).toBe("Not logged in");
        expect(wrapper.find("[data-still-pushing]").exists()).toBe(false);
        wrapper.unmount();
    });

    it("respects a log out: a late post does not bring the keep-alive back", async () => {
        GlobalState.roomLogins = { [KEY_HEX]: { isAdmin: false, canPost: true } };
        const wrapper = await mountBar();
        await wrapper.findAll("button").find((b) => b.text().includes("Log out")).trigger("click");
        expect(GlobalState.roomsLeft[KEY_HEX]).toBe(true);

        // mounting a logged-in bar starts its keep-alive; only the post matters here
        start.mockClear();
        await Connection.onContactMessageReceived(post());
        expect(start).not.toHaveBeenCalled();
        expect(GlobalState.roomsStillPushing[KEY_HEX]).toBe(undefined);
        wrapper.unmount();
    });

    it("clears the marks when the radio goes away", async () => {
        GlobalState.roomsStillPushing = { [KEY_HEX]: Date.now() };
        GlobalState.roomsLeft = { other: true };
        await Connection.disconnect();
        expect(GlobalState.roomsStillPushing).toEqual({});
        expect(GlobalState.roomsLeft).toEqual({});
    });

    it("tells the composer the truth too: posts are arriving, log in to post", async () => {
        GlobalState.roomsStillPushing = { [KEY_HEX]: Date.now() };
        vi.spyOn(Database.ContactMessagesReadState, "touch").mockResolvedValue(undefined);
        vi.spyOn(Database.Message, "getContactMessages").mockReturnValue({
            $: { subscribe: (cb) => { cb([]); return { unsubscribe() {} }; } },
        });
        const wrapper = mount(MessageViewer, { props: { type: "contact", contact: room() } });
        await flushPromises();
        const gate = wrapper.find("[data-room-gate]");
        expect(gate.text()).toContain("Posts are still arriving from this room");
        expect(gate.text()).not.toContain("Log in to this room before posting");
        wrapper.unmount();

        GlobalState.roomsStillPushing = {};
        const plain = mount(MessageViewer, { props: { type: "contact", contact: room() } });
        await flushPromises();
        expect(plain.find("[data-room-gate]").text()).toContain("Log in to this room before posting");
        plain.unmount();
    });

});
