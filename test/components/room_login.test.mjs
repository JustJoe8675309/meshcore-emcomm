// Logging in to a room server.
//
// The interesting part is failure. The firmware answers a wrong password with
// PUSH_CODE_LOGIN_FAIL (0x86), but meshcore.js listens only for the success
// push, so the refusal is dropped and its own timer rejects with "timeout".
// A room that answered and said no then looks exactly like a room out of range,
// and the operator's next move is completely different in each case: fix the
// password, or move. So the fail push is read off the raw frames here.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { Constants } from "@liamcottle/meshcore.js";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import RoomLoginBar from "../../src/components/contacts/RoomLoginBar.vue";

const ROOM_KEY = new Uint8Array(32).fill(0x11);
const OTHER_KEY = new Uint8Array(32).fill(0x22);

// a radio that records logins and lets a test push raw frames back
function fakeRadio() {
    const listeners = {};
    return {
        logins: [],
        on(event, cb) { (listeners[event] ??= []).push(cb); },
        off(event, cb) { listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb); },
        emit(event, ...args) { (listeners[event] ?? []).slice().forEach((cb) => cb(...args)); },
        listenerCount(event) { return (listeners[event] ?? []).length; },
        // stands in for the library's login(), which never settles on a refusal
        login(publicKey, password) {
            this.logins.push({ publicKey, password });
            return this.loginResult ?? new Promise(() => {});
        },
    };
}

// PUSH_CODE_LOGIN_FAIL: [0x86, reserved, ...public key prefix]
function loginFailFrame(publicKey) {
    return new Uint8Array([0x86, 0, ...publicKey.subarray(0, 6)]);
}

function aRoom() {
    return { publicKey: ROOM_KEY, type: Constants.AdvType.Room, advName: "A Room", flags: 0 };
}

describe("Connection.loginToRoom", () => {

    let radio;
    beforeEach(() => {
        radio = fakeRadio();
        GlobalState.connection = radio;
    });

    it("sends the password straight through to the radio", async () => {
        radio.loginResult = Promise.resolve({ reserved: 0 });
        await Connection.loginToRoom(ROOM_KEY, "hunter2");
        expect(radio.logins).toEqual([{ publicKey: ROOM_KEY, password: "hunter2" }]);
    });

    it("tells a refusal apart from silence", async () => {
        // the library would hang here and eventually call it a timeout
        const login = Connection.loginToRoom(ROOM_KEY, "wrong");
        radio.emit("rx", loginFailFrame(ROOM_KEY));
        await expect(login).rejects.toThrow(Connection.LOGIN_FAILED);
    });

    it("ignores a refusal meant for a different room", async () => {
        let settled = false;
        const login = Connection.loginToRoom(ROOM_KEY, "pw").then(() => settled = true, () => settled = true);
        radio.emit("rx", loginFailFrame(OTHER_KEY));
        await Promise.resolve();
        expect(settled).toBe(false);
    });

    it("ignores frames that are not a login refusal", async () => {
        let settled = false;
        const login = Connection.loginToRoom(ROOM_KEY, "pw").then(() => settled = true, () => settled = true);
        // a discovery reply, which shares the raw frame stream
        radio.emit("rx", new Uint8Array([0x8E, 0, 0, 0, 0x90, 0, 1, 2, 3, 4, 5]));
        radio.emit("rx", new Uint8Array([0x86]));   // too short to be a refusal
        await Promise.resolve();
        expect(settled).toBe(false);
    });

    it("succeeds and reports admin rights when the room grants them", async () => {
        radio.loginResult = Promise.resolve({ reserved: 1 });
        const response = await Connection.loginToRoom(ROOM_KEY, "adminpw");
        expect(response.reserved).toBe(1);
    });

    it("stops listening once the login settles", async () => {
        radio.loginResult = Promise.resolve({ reserved: 0 });
        await Connection.loginToRoom(ROOM_KEY, "pw");
        // a listener left behind would reject a promise nobody awaits
        expect(radio.listenerCount("rx")).toBe(0);
    });

    it("stops listening after a refusal too", async () => {
        const login = Connection.loginToRoom(ROOM_KEY, "wrong");
        radio.emit("rx", loginFailFrame(ROOM_KEY));
        await expect(login).rejects.toThrow();
        expect(radio.listenerCount("rx")).toBe(0);
    });

    it("refuses before transmitting when there is no radio", async () => {
        GlobalState.connection = null;
        await expect(Connection.loginToRoom(ROOM_KEY, "pw")).rejects.toThrow(Connection.DISCONNECTED);
    });

});

describe("RoomLoginBar", () => {

    beforeEach(() => {
        GlobalState.connection = { on() {}, off() {} };
        vi.restoreAllMocks();
    });

    const mountBar = (contact = aRoom()) => mount(RoomLoginBar, { props: { contact } });

    it("shows nothing for a contact that is not a room", () => {
        const wrapper = mountBar({ publicKey: ROOM_KEY, type: Constants.AdvType.Chat, advName: "A User" });
        expect(wrapper.text()).toBe("");
    });

    it("says a password is needed before posts arrive", () => {
        expect(mountBar().text()).toMatch(/holds its posts until you log in/);
    });

    it("says plainly that the password is kept nowhere", () => {
        // the operator should know why they are typing it again
        expect(mountBar().text()).toMatch(/kept nowhere/);
    });

    it("blames the password when the room refused it", async () => {
        vi.spyOn(Connection, "loginToRoom").mockRejectedValue(new Error(Connection.LOGIN_FAILED));
        const wrapper = mountBar();
        wrapper.vm.password = "wrong";
        await wrapper.vm.logIn();
        expect(wrapper.vm.errorMessage).toMatch(/refused that password/);
        // and says the room is reachable, so nobody goes looking for a range problem
        expect(wrapper.vm.errorMessage).toMatch(/in range/);
    });

    it("blames the range when nothing answered", async () => {
        vi.spyOn(Connection, "loginToRoom").mockRejectedValue(new Error("timeout"));
        const wrapper = mountBar();
        wrapper.vm.password = "pw";
        await wrapper.vm.logIn();
        expect(wrapper.vm.errorMessage).toMatch(/No answer/);
        expect(wrapper.vm.errorMessage).not.toMatch(/password/);
    });

    it("blames the radio when the link dropped", async () => {
        vi.spyOn(Connection, "loginToRoom").mockRejectedValue(new Error(Connection.DISCONNECTED));
        const wrapper = mountBar();
        wrapper.vm.password = "pw";
        await wrapper.vm.logIn();
        expect(wrapper.vm.errorMessage).toMatch(/radio disconnected/);
    });

    it("forgets the password as soon as the login call is done", async () => {
        vi.spyOn(Connection, "loginToRoom").mockResolvedValue({ reserved: 0 });
        const wrapper = mountBar();
        wrapper.vm.password = "hunter2";
        await wrapper.vm.logIn();
        expect(wrapper.vm.password).toBe("");
    });

    it("forgets it after a failure as well", async () => {
        vi.spyOn(Connection, "loginToRoom").mockRejectedValue(new Error(Connection.LOGIN_FAILED));
        const wrapper = mountBar();
        wrapper.vm.password = "hunter2";
        await wrapper.vm.logIn();
        expect(wrapper.vm.password).toBe("");
    });

    it("will not send an empty password", async () => {
        const login = vi.spyOn(Connection, "loginToRoom");
        const wrapper = mountBar();
        await wrapper.vm.logIn();
        expect(login).not.toHaveBeenCalled();
        expect(wrapper.vm.errorMessage).toMatch(/Enter the room password/);
    });

    it("reports being logged in, and as admin when the room says so", async () => {
        vi.spyOn(Connection, "loginToRoom").mockResolvedValue({ reserved: 1 });
        const wrapper = mountBar();
        wrapper.vm.password = "adminpw";
        await wrapper.vm.logIn();
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.loggedIn).toBe(true);
        expect(wrapper.text()).toMatch(/Logged in as admin/);
    });

    it("warns that a long absence leaves a gap rather than an error", async () => {
        // the server keeps a bounded backlog, so posts can be missed silently
        vi.spyOn(Connection, "loginToRoom").mockResolvedValue({ reserved: 0 });
        const wrapper = mountBar();
        wrapper.vm.password = "pw";
        await wrapper.vm.logIn();
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toMatch(/limited backlog/);
    });

    it("drops the login when the room changes", async () => {
        vi.spyOn(Connection, "loginToRoom").mockResolvedValue({ reserved: 0 });
        const wrapper = mountBar();
        wrapper.vm.password = "pw";
        await wrapper.vm.logIn();
        expect(wrapper.vm.loggedIn).toBe(true);

        await wrapper.setProps({ contact: { ...aRoom(), publicKey: OTHER_KEY, advName: "Another Room" } });
        // a different room is a different login
        expect(wrapper.vm.loggedIn).toBe(false);
    });

    it("says so when there is no radio", () => {
        GlobalState.connection = null;
        const wrapper = mountBar();
        expect(wrapper.text()).toMatch(/No radio connected/);
    });

});
