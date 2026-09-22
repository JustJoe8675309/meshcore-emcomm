// A report cut short by leaving the Reports tab.
//
// Found in the final audit. Switching tabs mid send stops the send, which is
// right: nothing should keep transmitting with no display. But the panel's own
// record of how far it got went with the panel, and coming back showed an empty
// form. Two of three parts had gone out and nothing said so. The receiving
// stations had a report with its end missing and the sender had no idea.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ReportsPanel from "../../src/components/reports/ReportsPanel.vue";
import GlobalState from "../../src/js/GlobalState.js";
import Connection from "../../src/js/Connection.js";
import Utils from "../../src/js/Utils.js";

const NODE_KEY = new Uint8Array(32).fill(0xa7);
const OTHER_KEY = new Uint8Array(32).fill(0x39);

function mountPanel() {
    return mount(ReportsPanel, {
        global: {
            stubs: { SearchableSelect: true, ReportFormFields: true, TransmissionPreview: true },
            mocks: { $router: { push: () => {} } },
        },
    });
}

function connect(key = NODE_KEY) {
    GlobalState.connection = { on() {}, off() {} };
    GlobalState.selfInfo = { name: "Joe-KJ5HBN-HTv3", publicKey: key, radioFreq: 910525, radioBw: 62500, radioSf: 7, radioCr: 5 };
    GlobalState.channels = [{ idx: 7, name: "Emcomm Testing" }];
    GlobalState.contacts = [];
}

const LONG = ("All stations be advised the primary route via Canyon Road is now impassable "
    + "due to debris flow at mile marker 14. Use the northern bypass through Ridge Street. ").repeat(4);

async function startAndLeave() {
    const sent = [];
    vi.spyOn(Connection, "sendChannelMessage").mockImplementation(async (idx, text) => { sent.push({ idx, text }); });

    const wrapper = mountPanel();
    wrapper.vm.selectedChannelIdx = 7;
    wrapper.vm.selectedFormId = "ics213";
    await wrapper.vm.$nextTick();
    wrapper.vm.values = { to: "Net Control", from: "KJ5HBN", subject: "DRILL route", datetime: "191830L SEP", message: LONG };
    await wrapper.vm.$nextTick();
    const parts = wrapper.vm.prepared.parts;

    const running = wrapper.vm.confirmSend();
    // leave the tab as the first part goes out
    wrapper.unmount();
    await running;

    return { sent, parts };
}

describe("a report interrupted by leaving the tab", () => {

    beforeEach(() => {
        vi.restoreAllMocks();
        GlobalState.interruptedReport = null;
        // the gap between channel parts. the tab is left synchronously, before the
        // first part is even out, so skipping the wait changes nothing but speed
        vi.spyOn(Utils, "sleep").mockResolvedValue(undefined);
        connect();
    });

    it("is remembered after the tab goes away", async () => {
        const { sent, parts } = await startAndLeave();

        const record = GlobalState.interruptedReport;
        expect(record).not.toBe(null);
        expect(record.sentCount).toBe(sent.length);
        expect(record.totalParts).toBe(parts.length);
        expect(record.sentCount).toBeLessThan(record.totalParts);
        expect(record.destination.name).toContain("Emcomm Testing");
        expect(record.formName).toMatch(/ICS-213/);
    });

    it("says so when the tab opens again, naming what went out and what did not", async () => {
        const { sent, parts } = await startAndLeave();

        const wrapper = mountPanel();
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain("Report interrupted");
        expect(wrapper.text()).toContain(`${sent.length} of ${parts.length} messages were sent to`);
        expect(wrapper.text()).toContain("Emcomm Testing");
        expect(wrapper.text()).toContain(`Message ${sent.length + 1} did not go out`);
        // taken up by the panel, so it is not offered twice
        expect(GlobalState.interruptedReport).toBe(null);
    });

    it("sends only the parts that never went out, to the same channel", async () => {
        const { sent, parts } = await startAndLeave();
        const before = sent.length;

        const wrapper = mountPanel();
        await wrapper.vm.$nextTick();
        await wrapper.vm.resumeSend();

        expect(sent.length).toBe(parts.length);
        expect(sent.slice(before).map((s) => s.text)).toEqual(parts.slice(before));
        expect(sent.every((s) => s.idx === 7)).toBe(true);
    });

    it("will not finish it through a different radio", async () => {
        // a channel is a slot number on the radio, so the rest could land somewhere else
        const { sent } = await startAndLeave();
        const before = sent.length;
        connect(OTHER_KEY);

        const wrapper = mountPanel();
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain("A different radio is connected now");
        expect(wrapper.findAll("button").some((b) => /Send remaining/.test(b.text()))).toBe(false);

        await wrapper.vm.resumeSend();
        expect(sent.length).toBe(before);
    });

    it("says why it cannot be finished with no radio connected", async () => {
        await startAndLeave();
        GlobalState.connection = null;

        const wrapper = mountPanel();
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain("Report interrupted");
        expect(wrapper.text()).toContain("No radio is connected");
    });

    it("goes away when dismissed", async () => {
        await startAndLeave();

        const wrapper = mountPanel();
        await wrapper.vm.$nextTick();
        wrapper.vm.dismissFailure();
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).not.toContain("Report interrupted");
    });

    it("still says Transmission failed for a send that failed rather than being left", async () => {
        vi.spyOn(Connection, "sendChannelMessage").mockRejectedValue(new Error("radio refused"));
        vi.spyOn(console, "log").mockImplementation(() => {});

        const wrapper = mountPanel();
        wrapper.vm.selectedChannelIdx = 7;
        wrapper.vm.selectedFormId = "ics213";
        await wrapper.vm.$nextTick();
        wrapper.vm.values = { to: "Net Control", from: "KJ5HBN", subject: "DRILL route", datetime: "191830L SEP", message: LONG };
        await wrapper.vm.$nextTick();
        await wrapper.vm.confirmSend();
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain("Transmission failed");
        expect(wrapper.text()).not.toContain("Report interrupted");
    });

});
