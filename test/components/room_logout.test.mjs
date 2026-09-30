// A way out of a room.
//
// From the 28 Sep audit: RoomLoginBar only ever logged in. The login is held in memory
// and never persisted, so an operator who wanted out -- handing the radio on, or moving
// to another room -- had nothing to press.
//
// Nothing is sent. A room has no log-out command and the session it holds is keyed to
// the radio rather than to this app, so this is deliberately local: it clears what the
// device remembers and stops the keep-alive. The room stops pushing on its own once the
// keep-alive is gone, which is the behaviour the keep-alive exists to prevent.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import RoomLoginBar from "../../src/components/contacts/RoomLoginBar.vue";
import GlobalState from "../../src/js/GlobalState.js";
import RoomKeepAlive from "../../src/js/rooms/RoomKeepAlive.js";
import { Constants } from "@liamcottle/meshcore.js";

const KEY = new Uint8Array(32).fill(0xab);
const KEY_HEX = Array.from(KEY).map((b) => b.toString(16).padStart(2, "0")).join("");

const aRoom = () => ({ type: Constants.AdvType.Room, advName: "Test Room", publicKey: KEY });

// mounted() reads the session and sets loggedIn, so the first render is the
// logged-out one: without the tick the DOM still shows a password box
async function mountBar() {
    const wrapper = mount(RoomLoginBar, { props: { contact: aRoom() } });
    await wrapper.vm.$nextTick();
    return wrapper;
}

describe("leaving a room", () => {

    beforeEach(() => {
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.roomLogins = { [KEY_HEX]: { isAdmin: false, canPost: true, clockOffsetSeconds: 0 } };
        vi.spyOn(RoomKeepAlive, "start").mockReturnValue(undefined);
        vi.spyOn(RoomKeepAlive, "stop").mockReturnValue(undefined);
        vi.spyOn(RoomKeepAlive, "isRunning").mockReturnValue(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.roomLogins = {};
    });

    it("offers a way out once logged in", async () => {
        const wrapper = await mountBar();
        const button = wrapper.findAll("button").find((b) => b.text().includes("Log out"));
        expect(button).not.toBe(undefined);
    });

    it("offers nothing to press when not logged in", async () => {
        GlobalState.roomLogins = {};
        const wrapper = await mountBar();
        expect(wrapper.findAll("button").some((b) => b.text().includes("Log out"))).toBe(false);
    });

    it("forgets the login and stops the keep-alive", async () => {
        const wrapper = await mountBar();

        await wrapper.findAll("button").find((b) => b.text().includes("Log out")).trigger("click");

        expect(GlobalState.roomLogins[KEY_HEX]).toBe(undefined);
        expect(RoomKeepAlive.stop).toHaveBeenCalledOnce();
        expect(wrapper.vm.loggedIn).toBe(false);
    });

    it("puts the password box back, so the room can be rejoined", async () => {
        const wrapper = await mountBar();

        await wrapper.findAll("button").find((b) => b.text().includes("Log out")).trigger("click");

        expect(wrapper.find('input[type="password"]').exists()).toBe(true);
        expect(wrapper.vm.password).toBe("");
    });

    // the honest part: a room has no log-out command, so this cannot claim to have
    // told the room anything
    it("says it is local, and that posts may still arrive", async () => {
        const wrapper = await mountBar();
        expect(wrapper.text()).toContain("forgets the login on this device");
        expect(wrapper.text()).toContain("may still arrive");
    });

    it("tells its owner, so a view can react", async () => {
        const wrapper = await mountBar();

        await wrapper.findAll("button").find((b) => b.text().includes("Log out")).trigger("click");

        expect(wrapper.emitted("logged-out")).toBeTruthy();
    });

});
