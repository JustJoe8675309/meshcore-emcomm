// The way home from EMCOMM mode, whatever has been backed up since.
//
// Found in the final audit. Load last backup restores the newest slot, so one
// routine backup taken while converted, which is exactly what an operator does
// during an incident, left the pre-EMCOMM backup intact in storage but
// unreachable from any button. The node could not be put back.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SettingsPage from "../../src/components/pages/SettingsPage.vue";
import Connection from "../../src/js/Connection.js";
import GlobalState from "../../src/js/GlobalState.js";
import NodeBackup from "../../src/js/NodeBackup.js";
import EmcommMode from "../../src/js/EmcommMode.js";

const KEY = new Uint8Array(32).fill(0x39);
const NODE = Array.from(KEY).map((b) => b.toString(16).padStart(2, "0")).join("");

const SELF_INFO = {
    name: "KJ5HBN-EMCOMM", publicKey: KEY, radioFreq: 910525, radioBw: 62.5, radioSf: 7, radioCr: 5,
    txPower: 22, maxTxPower: 22, advLat: 0, advLon: 0, manualAddContacts: 1,
};

function backup(capturedAt, contactCount, name) {
    return {
        nodePublicKey: NODE,
        nodeName: name,
        capturedAt,
        settings: { name },
        channels: [],
        contacts: Array.from({ length: contactCount }, (_, i) => ({ publicKey: i.toString(16).padStart(64, "0"), type: 2 })),
        warnings: [],
    };
}

function mountPage() {
    return mount(SettingsPage, {
        global: {
            stubs: {
                Page: { template: "<div><slot/></div>" },
                AppBar: { template: "<div><slot name='trailing'/></div>" },
                EmcommConvertDialog: true,
                EmcommSettingsGroup: true,
                RouterLink: true,
            },
        },
    });
}

const button = (wrapper, text) => wrapper.findAll("button").find((b) => b.text().includes(text));

describe("leaving EMCOMM mode", () => {

    let restore;

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = SELF_INFO;
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => { GlobalState.selfInfo = SELF_INFO; });
        vi.spyOn(Connection, "deviceQuery").mockResolvedValue(null);
        restore = vi.spyOn(NodeBackup, "restore").mockResolvedValue({ failures: [], notInBackup: [] });

        // the bench sequence: converted at 6:18, then a routine backup at 6:20
        NodeBackup.save(backup(Date.UTC(2026, 8, 21, 0, 18), 180, "before"), NodeBackup.SLOT_PRE_EMCOMM);
        NodeBackup.save(backup(Date.UTC(2026, 8, 21, 0, 20), 127, "during"), NodeBackup.SLOT_LATEST);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete window.confirm;
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    it("offers the pre-EMCOMM backup while the node is in EMCOMM mode, though a newer one exists", async () => {
        EmcommMode.markEntered(NODE);
        const wrapper = mountPage();
        await flushPromises();

        // Load last backup still means the newest, which is the converted state
        expect(button(wrapper, "Load last backup").text()).not.toContain("before EMCOMM mode");
        expect(button(wrapper, "Leave EMCOMM mode")).toBeTruthy();
    });

    it("restores the pre-EMCOMM backup, not the newest, and leaves the mode", async () => {
        EmcommMode.markEntered(NODE);
        window.confirm = vi.fn(() => true);
        const wrapper = mountPage();
        await flushPromises();

        await button(wrapper, "Leave EMCOMM mode").trigger("click");
        await flushPromises();

        expect(restore).toHaveBeenCalledTimes(1);
        const restored = restore.mock.calls[0][0];
        expect(restored.contacts).toHaveLength(180);
        expect(restored.nodeName).toBe("before");
        expect(EmcommMode.enteredAt(NODE)).toBe(null);
        expect(button(wrapper, "Leave EMCOMM mode")).toBeFalsy();
    });

    it("offers to remove what was added in the mode, so the node is exactly as it was", async () => {
        EmcommMode.markEntered(NODE);
        const extras = {
            contacts: [{ publicKey: new Uint8Array(32).fill(9), advName: "Met Since" }],
            channels: [{ idx: 4, name: "Incident Tac 1" }],
        };
        vi.spyOn(NodeBackup, "extras").mockResolvedValue(extras);
        window.confirm = vi.fn(() => true);
        const wrapper = mountPage();
        await flushPromises();

        await button(wrapper, "Leave EMCOMM mode").trigger("click");
        await flushPromises();

        expect(window.confirm.mock.calls[1][0]).toContain("Met Since");
        expect(window.confirm.mock.calls[1][0]).toContain("Incident Tac 1");
        expect(restore.mock.calls[0][2]).toEqual({ remove: extras });
        expect(wrapper.text()).toContain("Removed 1 contact(s) and 1 channel(s) added since");
    });

    it("keeps what was added when the operator says so, and still leaves the mode", async () => {
        EmcommMode.markEntered(NODE);
        vi.spyOn(NodeBackup, "extras").mockResolvedValue({ contacts: [{ publicKey: new Uint8Array(32).fill(9), advName: "Met Since" }], channels: [] });
        window.confirm = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
        const wrapper = mountPage();
        await flushPromises();

        await button(wrapper, "Leave EMCOMM mode").trigger("click");
        await flushPromises();

        expect(restore.mock.calls[0][2]).toEqual({ remove: null });
        expect(EmcommMode.enteredAt(NODE)).toBe(null);
    });

    it("converting again while in the mode keeps the way home from before it", async () => {
        EmcommMode.markEntered(NODE);
        vi.spyOn(NodeBackup, "capture").mockResolvedValue({ ...backup(Date.UTC(2026, 8, 21, 1, 0), 90, "second convert"), formatVersion: 1 });
        const wrapper = mountPage();
        await flushPromises();

        await button(wrapper, "Convert to EMCOMM mode").trigger("click");
        await flushPromises();

        expect(NodeBackup.load(NODE, NodeBackup.SLOT_PRE_EMCOMM).nodeName).toBe("before");
        expect(NodeBackup.load(NODE, NodeBackup.SLOT_LATEST).nodeName).toBe("second convert");
        expect(wrapper.text()).toContain("the backup from before it was kept as the way home");
    });

    it("does nothing if the operator cancels", async () => {
        EmcommMode.markEntered(NODE);
        window.confirm = vi.fn(() => false);
        const wrapper = mountPage();
        await flushPromises();

        await button(wrapper, "Leave EMCOMM mode").trigger("click");
        await flushPromises();

        expect(restore).not.toHaveBeenCalled();
        expect(EmcommMode.enteredAt(NODE)).not.toBe(null);
    });

    it("is not offered to a node that is not in EMCOMM mode", async () => {
        const wrapper = mountPage();
        await flushPromises();
        expect(button(wrapper, "Leave EMCOMM mode")).toBeFalsy();
    });

    it("is not offered when there is no pre-EMCOMM backup to go back to", async () => {
        window.localStorage.removeItem(NodeBackup.storageKey(NODE, NodeBackup.SLOT_PRE_EMCOMM));
        EmcommMode.markEntered(NODE);
        const wrapper = mountPage();
        await flushPromises();
        expect(button(wrapper, "Leave EMCOMM mode")).toBeFalsy();
    });

});

describe("the backup list during a conversion", () => {

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.selfInfo = SELF_INFO;
        GlobalState.contacts = [];
        GlobalState.connection = { on() {}, off() {}, getSelfInfo: async () => SELF_INFO };
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => { GlobalState.selfInfo = SELF_INFO; });
        vi.spyOn(Connection, "deviceQuery").mockResolvedValue(null);
        NodeBackup.save(backup(Date.UTC(2026, 8, 21, 0, 17), 180, "earlier"), NodeBackup.SLOT_LATEST);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    it("names the pre-convert backup as soon as it is taken", async () => {
        // on the bench, Save to file mid conversion exported the backup before it
        vi.spyOn(NodeBackup, "capture").mockResolvedValue(backup(Date.UTC(2026, 8, 21, 0, 18), 180, "pre-convert"));
        const wrapper = mountPage();
        await flushPromises();

        await wrapper.vm.convertToEmcomm();
        await flushPromises();

        expect(wrapper.vm.backups[0].slot).toBe(NodeBackup.SLOT_PRE_EMCOMM);
        expect(wrapper.vm.backups[0].backup.nodeName).toBe("pre-convert");
    });

});

describe("telling the stations in range after a restore", () => {

    let restore;
    let advert;

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.connection = { on() {}, off() {} };
        GlobalState.selfInfo = SELF_INFO;
        vi.spyOn(Connection, "loadSelfInfo").mockImplementation(async () => { GlobalState.selfInfo = SELF_INFO; });
        vi.spyOn(Connection, "deviceQuery").mockResolvedValue(null);
        restore = vi.spyOn(NodeBackup, "restore").mockResolvedValue({ failures: [], notInBackup: [] });
        advert = vi.spyOn(Connection, "sendZeroHopAdvert").mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        window.localStorage.clear();
    });

    it("adverts once when the restore changes the name", async () => {
        // on the bench node 2 listed node 1 as KJ5HBN-AUDIT until an advert went out by hand
        const wrapper = mountPage();
        await flushPromises();

        await wrapper.vm.runRestore(backup(Date.UTC(2026, 8, 21, 0, 18), 3, "Joe-KJ5HBN-HTv3"));
        await flushPromises();

        expect(advert).toHaveBeenCalledTimes(1);
        expect(wrapper.text()).toContain("A zero hop advert went out");
        expect(wrapper.text()).toContain("Joe-KJ5HBN-HTv3");
    });

    it("stays quiet when the name is unchanged, since there is nothing to tell anyone", async () => {
        const wrapper = mountPage();
        await flushPromises();

        await wrapper.vm.runRestore(backup(Date.UTC(2026, 8, 21, 0, 18), 3, SELF_INFO.name));
        await flushPromises();

        expect(advert).not.toHaveBeenCalled();
    });

    it("says so when the advert does not go out, rather than implying it did", async () => {
        advert.mockRejectedValue(new Error("busy"));
        const wrapper = mountPage();
        await flushPromises();

        await wrapper.vm.runRestore(backup(Date.UTC(2026, 8, 21, 0, 18), 3, "Joe-KJ5HBN-HTv3"));
        await flushPromises();

        expect(wrapper.text()).toContain("did not go out");
        expect(wrapper.text()).not.toContain("A zero hop advert went out");
    });

});
