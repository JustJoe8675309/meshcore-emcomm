// Logging in to a room server.
//
// Failure is the interesting part, and it has two shapes.
//
// A station that does refuse sends PUSH_CODE_LOGIN_FAIL (0x86), which meshcore.js
// never listens for: it waits only on the success push, so the refusal is dropped
// and its own timer rejects with "timeout". That refusal is read off the raw
// frames here instead.
//
// A room server does not refuse at all. Its source says so outright — "no
// response. Client will timeout" — so a wrong room password produces silence,
// indistinguishable from a room that is out of range. Tested against a real room
// three hops out: a bad password drew no 0x85 and no 0x86, only an unrelated rx
// log. So the silent branch must not blame the range, because that is exactly
// where a wrong password lands.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
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
        // the app sends the command itself now and does its own waiting, because
        // the library gives up before a room several hops out can answer
        async sendCommandSendLogin(publicKey, password) {
            this.logins.push({ publicKey, password });
            // the radio says it has sent the login, as it does before any room answers
            setTimeout(() => this.emit(Constants.ResponseCodes.Sent, { estTimeout: 8000 }), 0);
        },
    };
}

// PUSH_CODE_LOGIN_SUCCESS, as firmware v7 and later send it:
//   [0x85, is_admin, key prefix x6, tag x4, acl permissions, firmware level]
// The byte after the push code is a legacy is_admin flag. The ACL role is at 12.
function loginSuccessFrame(publicKey, aclPermissions = 0, isAdminFlag = 0) {
    return new Uint8Array([
        0x85, isAdminFlag, ...publicKey.subarray(0, 6), 1, 2, 3, 4, aclPermissions, 1,
    ]);
}

// the shorter frame an older repeater answers with, carrying no ACL role
function legacyLoginSuccessFrame(publicKey, isAdminFlag = 0) {
    return new Uint8Array([0x85, isAdminFlag, ...publicKey.subarray(0, 6)]);
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
        Connection.commandQueue = Promise.resolve();
    });

    it("sends the password straight through to the radio", async () => {
        const login = Connection.loginToRoom(ROOM_KEY, "hunter2");
        await Promise.resolve();
        radio.emit("rx", loginSuccessFrame(ROOM_KEY));
        await login;
        expect(radio.logins).toEqual([{ publicKey: ROOM_KEY, password: "hunter2" }]);
    });

    it("accepts a success that arrives after the library would have given up", async () => {
        // measured against a real room three hops out: meshcore.js rejects at
        // about 8.8 seconds and the success push arrived at 12, so the operator
        // was told nobody answered while they were in fact logged in
        expect(Connection.ROOM_LOGIN_TIMEOUT_MILLIS).toBeGreaterThan(12000);

        const login = Connection.loginToRoom(ROOM_KEY, "");
        await Promise.resolve();
        radio.emit("rx", loginSuccessFrame(ROOM_KEY));
        await expect(login).resolves.toMatchObject({ isAdmin: false });
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

    // PERM_ACL_ROLE_MASK is the low two bits: guest 0, read only 1, read write 2,
    // admin 3. Reading the byte as "nonzero means admin" called a read only login
    // an admin one, and let the operator post into a room that drops it.
    // Read from the wrong byte, this reported a room that granted admin as read
    // only, and the app then refused to post into a room that had given it full
    // rights. On the bench the frame was [133, 1, ...] with the ACL byte at index
    // 12 holding 3: the legacy is_admin flag was 1, which masked to "role 1".
    it("reads the role from the ACL byte, not the legacy admin flag", async () => {
        const login = Connection.loginToRoom(ROOM_KEY, "");
        await Promise.resolve();
        radio.emit("rx", loginSuccessFrame(ROOM_KEY, 3, 1));
        await expect(login).resolves.toMatchObject({ role: 3, isAdmin: true, canPost: true });
    });

    it("lets a room grant posting even when the legacy flag is zero", async () => {
        const login = Connection.loginToRoom(ROOM_KEY, "pw");
        await Promise.resolve();
        radio.emit("rx", loginSuccessFrame(ROOM_KEY, 2, 0));
        await expect(login).resolves.toMatchObject({ role: 2, isAdmin: false, canPost: true });
    });

    it("allows posting when the frame is too old to carry a role", async () => {
        // refusing on a guess is the same fault in the other direction, and the
        // station will say no for itself by dropping the post
        const login = Connection.loginToRoom(ROOM_KEY, "pw");
        await Promise.resolve();
        radio.emit("rx", legacyLoginSuccessFrame(ROOM_KEY, 0));
        await expect(login).resolves.toMatchObject({ role: null, canPost: true });
    });

    it("reads the role from the low two bits", async () => {
        const cases = [
            [0, { role: 0, isAdmin: false, canPost: false }],   // guest
            [1, { role: 1, isAdmin: false, canPost: false }],   // read only
            [2, { role: 2, isAdmin: false, canPost: true }],    // read write
            [3, { role: 3, isAdmin: true, canPost: true }],     // admin
        ];
        for(const [granted, expected] of cases){
            const login = Connection.loginToRoom(ROOM_KEY, "pw");
            await Promise.resolve();
            radio.emit("rx", loginSuccessFrame(ROOM_KEY, granted));
            await expect(login).resolves.toMatchObject(expected);
        }
    });

    it("ignores bits above the role", async () => {
        // the byte carries more than the role, so masking matters
        const login = Connection.loginToRoom(ROOM_KEY, "pw");
        await Promise.resolve();
        radio.emit("rx", loginSuccessFrame(ROOM_KEY, 0b11111110));
        await expect(login).resolves.toMatchObject({ role: 2, isAdmin: false, canPost: true });
    });

    it("ignores a success meant for a different room", async () => {
        let settled = false;
        Connection.loginToRoom(ROOM_KEY, "pw").then(() => settled = true, () => settled = true);
        await Promise.resolve();
        radio.emit("rx", loginSuccessFrame(OTHER_KEY));
        await Promise.resolve();
        expect(settled).toBe(false);
    });

    it("stops listening once the login settles", async () => {
        const login = Connection.loginToRoom(ROOM_KEY, "pw");
        await Promise.resolve();
        radio.emit("rx", loginSuccessFrame(ROOM_KEY));
        await login;
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

    // "..." on the button is all there was while a room took its time. One three
    // hops out answered at 12 seconds on the bench, and this waits 45.
    it("says it is waiting, and how long it will wait", async () => {
        let release;
        vi.spyOn(Connection, "loginToRoom").mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        const wrapper = mountBar();

        expect(wrapper.text()).not.toMatch(/Waiting for the room/);
        wrapper.vm.logIn();
        await flushPromises();

        expect(wrapper.text()).toMatch(/Waiting for the room/);
        expect(wrapper.text()).toMatch(/45 seconds/);
        // and says a wrong password waits just as long, because a room answers one
        // with silence
        expect(wrapper.text()).toMatch(/answered with silence/);

        release({ isAdmin: false, canPost: true });
        await flushPromises();
        expect(wrapper.text()).not.toMatch(/Waiting for the room/);
    });

    it("ignores a second press while one login is in flight", async () => {
        const login = vi.spyOn(Connection, "loginToRoom").mockImplementation(() => new Promise(() => {}));
        const wrapper = mountBar();

        wrapper.vm.logIn();
        wrapper.vm.logIn();
        await flushPromises();

        expect(login).toHaveBeenCalledTimes(1);
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

    it("does not blame the range when a room falls silent", async () => {
        // A room server answers a wrong password with silence, by design: its
        // source says "no response. Client will timeout". So this branch is where
        // a bad password actually lands, and sending the operator to check the
        // antenna would be a confident wrong answer.
        vi.spyOn(Connection, "loginToRoom").mockRejectedValue(new Error("timeout"));
        const wrapper = mountBar();
        wrapper.vm.password = "pw";
        await wrapper.vm.logIn();
        expect(wrapper.vm.errorMessage).toMatch(/check the password first/);
        // and points at the remedy that actually worked on the bench
        expect(wrapper.vm.errorMessage).toMatch(/reset the path/);
    });

    it("warns up front that a wrong password looks like silence", () => {
        expect(mountBar().text()).toMatch(/does not reply to a wrong password/);
    });

    it("blames the radio when the link dropped", async () => {
        vi.spyOn(Connection, "loginToRoom").mockRejectedValue(new Error(Connection.DISCONNECTED));
        const wrapper = mountBar();
        wrapper.vm.password = "pw";
        await wrapper.vm.logIn();
        expect(wrapper.vm.errorMessage).toMatch(/radio disconnected/);
    });

    it("forgets the password as soon as the login call is done", async () => {
        vi.spyOn(Connection, "loginToRoom").mockResolvedValue({ isAdmin: false, canPost: true });
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

    it("puts nothing in the password box", () => {
        // it used to prefill "hello", and typing an admin password in without
        // clearing first sent the two joined together. A room answers a wrong
        // password with silence, so nothing said that was what had happened.
        expect(mountBar().vm.password).toBe("");
        expect(mountBar().find('input[type="password"]').element.value).toBe("");
    });

    it("names the default in the text instead", () => {
        const text = mountBar().text();
        expect(text).toMatch(/hello/);
        expect(text).toMatch(/ships with/);
    });

    it("sends nothing when the box is left alone", async () => {
        // an empty box is a case the firmware handles deliberately: it checks the
        // ACL, which is how a room with no password is joined
        const login = vi.spyOn(Connection, "loginToRoom").mockResolvedValue({ isAdmin: false, canPost: true });
        const wrapper = mountBar();
        await wrapper.vm.logIn();
        expect(login).toHaveBeenCalledWith(ROOM_KEY, "");
    });

    it("still sends no password when the box is explicitly cleared", async () => {
        // A blank password is not the absence of one. The firmware reads it as
        // "check whether this sender is in the ACL", which is how a room with no
        // password is joined, so substituting the default would make such a room
        // impossible to reach from here.
        const login = vi.spyOn(Connection, "loginToRoom").mockResolvedValue({ isAdmin: false, canPost: true });
        const wrapper = mountBar();
        wrapper.vm.password = "";
        await wrapper.vm.logIn();
        expect(login).toHaveBeenCalledWith(ROOM_KEY, "");
    });

    it("says how to join a room that has no password", () => {
        expect(mountBar().text()).toMatch(/Leave the box empty to send no password/);
    });

    it("prefers a typed password over the default", async () => {
        const login = vi.spyOn(Connection, "loginToRoom").mockResolvedValue({ isAdmin: false, canPost: true });
        const wrapper = mountBar();
        wrapper.vm.password = "something-else";
        await wrapper.vm.logIn();
        expect(login).toHaveBeenCalledWith(ROOM_KEY, "something-else");
    });

    it("empties the box after an attempt, leaving nothing to type over", async () => {
        vi.spyOn(Connection, "loginToRoom").mockRejectedValue(new Error(Connection.LOGIN_FAILED));
        const wrapper = mountBar();
        wrapper.vm.password = "typed-one";
        await wrapper.vm.logIn();
        expect(wrapper.vm.password).toBe("");
    });

    it("says a read only login is read only, not just logged in", async () => {
        // the room the bench tested granted guest, and the app said "Logged in"
        vi.spyOn(Connection, "loginToRoom").mockResolvedValue({ role: 0, isAdmin: false, canPost: false });
        const wrapper = mountBar();
        await wrapper.vm.logIn();
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toMatch(/Logged in, read only/);
        expect(wrapper.text()).toMatch(/posts will not be accepted/);
    });

    it("reports being logged in, and as admin when the room says so", async () => {
        vi.spyOn(Connection, "loginToRoom").mockResolvedValue({ isAdmin: true, canPost: true });
        const wrapper = mountBar();
        wrapper.vm.password = "adminpw";
        await wrapper.vm.logIn();
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.loggedIn).toBe(true);
        expect(wrapper.text()).toMatch(/Logged in as admin/);
    });

    it("warns that a long absence leaves a gap rather than an error", async () => {
        // the server keeps a bounded backlog, so posts can be missed silently
        vi.spyOn(Connection, "loginToRoom").mockResolvedValue({ isAdmin: false, canPost: true });
        const wrapper = mountBar();
        wrapper.vm.password = "pw";
        await wrapper.vm.logIn();
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toMatch(/limited backlog/);
    });

    it("drops the login when the room changes", async () => {
        vi.spyOn(Connection, "loginToRoom").mockResolvedValue({ isAdmin: false, canPost: true });
        const wrapper = mountBar();
        wrapper.vm.password = "pw";
        await wrapper.vm.logIn();
        expect(wrapper.vm.loggedIn).toBe(true);

        await wrapper.setProps({ contact: { ...aRoom(), publicKey: OTHER_KEY, advName: "Another Room" } });
        // a different room is a different login
        expect(wrapper.vm.loggedIn).toBe(false);
    });

    it("records the login so the composer can see it", async () => {
        // a room ignores a post from a client that has not logged in, so the
        // composer needs to know, and it is a different component
        GlobalState.roomLogins = {};
        vi.spyOn(Connection, "loginToRoom").mockResolvedValue({ isAdmin: true, canPost: true, clockOffsetSeconds: -1800 });
        const wrapper = mountBar();
        wrapper.vm.password = "pw";
        await wrapper.vm.logIn();
        const key = Array.from(ROOM_KEY).map((b) => b.toString(16).padStart(2, "0")).join("");
        expect(GlobalState.roomLogins[key]).toEqual({ isAdmin: true, canPost: true, clockOffsetSeconds: -1800 });
    });

    it("records nothing when the login failed", async () => {
        GlobalState.roomLogins = {};
        vi.spyOn(Connection, "loginToRoom").mockRejectedValue(new Error(Connection.LOGIN_FAILED));
        const wrapper = mountBar();
        wrapper.vm.password = "wrong";
        await wrapper.vm.logIn();
        expect(GlobalState.roomLogins).toEqual({});
    });

    it("shows a login already made this session", () => {
        const key = Array.from(ROOM_KEY).map((b) => b.toString(16).padStart(2, "0")).join("");
        GlobalState.roomLogins = { [key]: { isAdmin: false } };
        // coming back to the room should not ask again
        expect(mountBar().vm.loggedIn).toBe(true);
        GlobalState.roomLogins = {};
    });

    it("says so when there is no radio", () => {
        GlobalState.connection = null;
        const wrapper = mountBar();
        expect(wrapper.text()).toMatch(/No radio connected/);
    });

});
