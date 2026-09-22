// The loading screen: first connecting to a radio, and backing up or restoring it.
//
// Connecting took seconds on the bench, most of it reading two hundred contacts,
// and the tabs meanwhile showed a node with nothing on it. A backup or a restore
// is a string of commands to the radio, and until now said so only in a line of
// small text under the buttons, with the rest of the page free to press.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Constants } from "@liamcottle/meshcore.js";
import App from "../../src/components/App.vue";
import BusyOverlay from "../../src/components/BusyOverlay.vue";
import SettingsPage from "../../src/components/pages/SettingsPage.vue";
import Connection from "../../src/js/Connection.js";
import Database from "../../src/js/Database.js";
import GlobalState from "../../src/js/GlobalState.js";
import NodeBackup from "../../src/js/NodeBackup.js";
import ModeProfiles from "../../src/js/modes/ModeProfiles.js";

const KEY = new Uint8Array(32).fill(0x39);
const NODE = Array.from(KEY).map((b) => b.toString(16).padStart(2, "0")).join("");

const SELF_INFO = {
    name: "Joe-KJ5HBN-HTv3", publicKey: KEY, radioFreq: 910525, radioBw: 62.5, radioSf: 7, radioCr: 5,
    txPower: 22, maxTxPower: 22, advLat: 0, advLon: 0, manualAddContacts: 1,
};

function deferred() {
    let resolve;
    const promise = new Promise((r) => resolve = r);
    return { promise, resolve };
}

// enough of a meshcore.js connection for the connect sequence to run against
function fakeRadio() {
    const handlers = {};
    return {
        handlers,
        on(code, fn) { (handlers[code] ??= []).push(fn); },
        once(code, fn) { (handlers[code] ??= []).push(fn); },
        off() {},
        close() {},
        emit(code, value) { for(const fn of handlers[code] ?? []) fn(value); },
    };
}

const mountApp = () => mount(App, { global: { stubs: { RouterView: true } } });

describe("the loading screen component", () => {

    it("names what is under way, with a count when there is one", () => {
        const wrapper = mount(BusyOverlay, { props: { title: "Connecting to the radio", step: "Reading contacts...", done: 50, total: 200 } });
        expect(wrapper.text()).toContain("Connecting to the radio");
        expect(wrapper.text()).toContain("Reading contacts...");
        expect(wrapper.text()).toContain("50 of 200");
        expect(wrapper.find("[role=status]").exists()).toBe(true);
    });

    it("shows no count when the step has none, and a way out only when given one", async () => {
        const wrapper = mount(BusyOverlay, { props: { title: "Backing up the node", step: "Reading the node..." } });
        expect(wrapper.text()).not.toMatch(/\d+ of \d+/);
        expect(wrapper.find("button").exists()).toBe(false);

        await wrapper.setProps({ cancelLabel: "Disconnect" });
        await wrapper.find("button").trigger("click");
        expect(wrapper.emitted("cancel")).toHaveLength(1);
    });

});

describe("connecting to a radio", () => {

    let steps;

    beforeEach(() => {
        window.localStorage.clear();
        steps = {
            selfInfo: deferred(),
            contacts: deferred(),
        };
        vi.spyOn(Database, "initDatabase").mockResolvedValue(undefined);
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => {
            await steps.selfInfo.promise;
            GlobalState.selfInfo = SELF_INFO;
            Connection.clearConnectionWatchdog();
        });
        vi.spyOn(Connection, "syncDeviceTime").mockResolvedValue(undefined);
        vi.spyOn(Connection, "loadContacts").mockImplementation(async (onProgress) => {
            onProgress?.(0, 213);
            onProgress?.(120, 213);
            await steps.contacts.promise;
        });
        vi.spyOn(Connection, "loadChannels").mockResolvedValue(undefined);
        vi.spyOn(Connection, "syncMessages").mockResolvedValue(undefined);
        vi.spyOn(Connection, "updateBatteryPercentage").mockResolvedValue(undefined);
        vi.spyOn(Connection, "probeForLiveGps").mockResolvedValue(undefined);
    });

    afterEach(async () => {
        await Connection.disconnect();
        vi.restoreAllMocks();
        GlobalState.selfInfo = null;
    });

    it("is shown from the moment the link opens until the node is read, step by step", async () => {
        const wrapper = mountApp();
        const radio = fakeRadio();

        await Connection.connect(radio, "serial");
        await flushPromises();
        expect(wrapper.text()).toContain("Connecting to the radio");
        expect(wrapper.text()).toContain("Opening the link...");

        const finished = Connection.onConnected();
        await flushPromises();
        expect(wrapper.text()).toContain("Waiting for the radio to answer...");

        steps.selfInfo.resolve();
        radio.emit(Constants.ResponseCodes.SelfInfo, SELF_INFO);
        await flushPromises();
        expect(wrapper.text()).toContain("Reading contacts...");
        expect(wrapper.text()).toContain("120 of 213");

        steps.contacts.resolve();
        await finished;
        await flushPromises();
        expect(GlobalState.connecting).toBe(null);
        expect(wrapper.text()).not.toContain("Connecting to the radio");
    });

    it("offers Disconnect, which ends the attempt and takes the screen away", async () => {
        const wrapper = mountApp();
        const radio = fakeRadio();
        await Connection.connect(radio, "bluetooth");
        const finished = Connection.onConnected();
        await flushPromises();

        await wrapper.find("button").trigger("click");
        await flushPromises();
        expect(GlobalState.connection).toBe(null);
        expect(wrapper.text()).not.toContain("Connecting to the radio");

        // the steps still under way when it was cancelled must not bring it back
        steps.selfInfo.resolve();
        radio.emit(Constants.ResponseCodes.SelfInfo, SELF_INFO);
        steps.contacts.resolve();
        await finished.catch(() => {});
        await flushPromises();
        expect(GlobalState.connecting).toBe(null);
    });

    it("goes away when the connection fails part way, rather than staying up over nothing", async () => {
        Connection.loadSelfInfo.mockRejectedValue(new Error("timed out"));
        await Connection.connect(fakeRadio(), "serial");
        await expect(Connection.onConnected()).rejects.toThrow("timed out");
        expect(GlobalState.connecting).toBe(null);
    });

});

describe("backing up and restoring", () => {

    function mountPage() {
        return mount(SettingsPage, {
            global: {
                stubs: {
                    Page: { template: "<div><slot/></div>" },
                    AppBar: { template: "<div><slot name='trailing'/></div>" },
                    EmcommSettingsGroup: true,
                    RouterLink: true,
                },
            },
        });
    }

    const button = (wrapper, text) => wrapper.findAll("button").find((b) => b.text().includes(text));
    const backup = (name) => ({
        nodePublicKey: NODE, nodeName: name, capturedAt: Date.UTC(2026, 8, 21, 0, 18),
        settings: { name }, channels: [], contacts: [], warnings: [],
    });

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = SELF_INFO;
        GlobalState.contacts = [];
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => { GlobalState.selfInfo = SELF_INFO; });
        vi.spyOn(Connection, "deviceQuery").mockResolvedValue(null);
        window.confirm = vi.fn(() => true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete window.confirm;
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    it("covers the page while a backup is read, and not after", async () => {
        const read = deferred();
        vi.spyOn(NodeBackup, "capture").mockImplementation(async () => { await read.promise; return backup(SELF_INFO.name); });
        const wrapper = mountPage();
        await flushPromises();

        await button(wrapper, "Back up current info").trigger("click");
        await flushPromises();
        expect(wrapper.text()).toContain("Backing up the node");
        expect(wrapper.text()).toContain("Keep the radio connected");

        read.resolve();
        await flushPromises();
        expect(wrapper.findComponent(BusyOverlay).exists()).toBe(false);
    });

    it("says it is putting the radio back, and counts the restore steps", async () => {
        NodeBackup.save(backup(SELF_INFO.name), NodeBackup.SLOT_PRE_EMCOMM);
        ModeProfiles.setCurrent("live", NODE);
        const written = deferred();
        vi.spyOn(NodeBackup, "restore").mockImplementation(async (b, onProgress) => {
            onProgress({ done: 3, total: 9, what: "channel 2" });
            await written.promise;
            return { failures: [], notInBackup: [] };
        });
        const wrapper = mountPage();
        await flushPromises();

        await button(wrapper, "Put the radio back as it was").trigger("click");
        await flushPromises();
        const overlay = wrapper.findComponent(BusyOverlay);
        expect(overlay.text()).toContain("Putting the radio back as it was");
        expect(overlay.text()).toContain("Restoring channel 2");
        expect(overlay.text()).toContain("3 of 9");

        written.resolve();
        await flushPromises();
        expect(wrapper.findComponent(BusyOverlay).exists()).toBe(false);
    });

    it("goes away when a restore fails, and the error is left to read", async () => {
        NodeBackup.save(backup(SELF_INFO.name), NodeBackup.SLOT_LATEST);
        vi.spyOn(NodeBackup, "restore").mockRejectedValue(new Error("radio refused"));
        const wrapper = mountPage();
        await flushPromises();

        await button(wrapper, "Load last backup").trigger("click");
        await flushPromises();
        expect(wrapper.findComponent(BusyOverlay).exists()).toBe(false);
        expect(wrapper.vm.backupError).not.toBe(null);
    });

});

describe("a connection cancelled before the radio identifies itself", () => {

    beforeEach(() => {
        window.localStorage.clear();
        vi.spyOn(Database, "initDatabase").mockResolvedValue(undefined);
        vi.spyOn(Connection, "syncDeviceTime").mockResolvedValue(undefined);
        vi.spyOn(Connection, "loadContacts").mockResolvedValue(undefined);
        vi.spyOn(Connection, "loadChannels").mockResolvedValue(undefined);
        vi.spyOn(Connection, "syncMessages").mockResolvedValue(undefined);
        vi.spyOn(Connection, "updateBatteryPercentage").mockResolvedValue(undefined);
        vi.spyOn(Connection, "probeForLiveGps").mockResolvedValue(undefined);
    });

    afterEach(async () => {
        await Connection.disconnect();
        vi.restoreAllMocks();
        GlobalState.selfInfo = null;
    });

    it("lets the setup finish rather than wait for ever on a database that never opens", async () => {
        // the radio answers self info, but its SelfInfo push, which opens the
        // database, never arrives before the operator gives up
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => { GlobalState.selfInfo = SELF_INFO; });
        const radio = fakeRadio();
        await Connection.connect(radio, "bluetooth");
        const setup = Connection.onConnected();
        await flushPromises();

        await Connection.disconnect();

        const outcome = await Promise.race([
            setup.then(() => "finished"),
            new Promise((resolve) => setTimeout(() => resolve("still waiting"), 200)),
        ]);
        expect(outcome).toBe("finished");
        // and it read nothing from a radio that is gone
        expect(Connection.loadContacts).not.toHaveBeenCalled();
    });

    it("releases its listeners without letting them act on the radio connected next", async () => {
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => { GlobalState.selfInfo = SELF_INFO; });
        const refresh = vi.spyOn(Connection, "refreshContact").mockResolvedValue(undefined);
        const first = fakeRadio();
        await Connection.connect(first, "bluetooth");
        const setup = Connection.onConnected();
        await flushPromises();

        // an advert heard just before the cancel waits on the database
        first.emit(Constants.PushCodes.Advert, { publicKey: new Uint8Array(32).fill(7) });
        await Connection.disconnect();
        await setup;

        // another radio is connected by the time that wait ends
        await Connection.connect(fakeRadio(), "serial");
        await flushPromises();

        expect(refresh).not.toHaveBeenCalled();
    });

});
