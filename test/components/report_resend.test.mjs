// Resending one part of a channel report, and the gap between parts.
//
// Found on the bench: a three part report reached node 2 as [1/3] and [3/3].
// Node 1's radio had answered Ok to [2/3] and it was in node 1's own history, so
// it was lost on air. Channel messages are never acknowledged, so the sending
// radio cannot tell. The gap was 2 s; it is now long enough for the repeats of a
// part to clear, and the station that is missing a part can be sent just that one.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ReportsPanel from "../../src/components/reports/ReportsPanel.vue";
import GlobalState from "../../src/js/GlobalState.js";
import Connection from "../../src/js/Connection.js";
import Utils from "../../src/js/Utils.js";
import Airtime from "../../src/js/reports/Airtime.js";
import ReportEncoder from "../../src/js/reports/ReportEncoder.js";

const NODE_KEY = new Uint8Array(32).fill(0xa7);
const OTHER_KEY = new Uint8Array(32).fill(0x39);
const NAME = "Joe-KJ5HBN-HTv3";

function mountPanel() {
    return mount(ReportsPanel, {
        global: {
            stubs: { SearchableSelect: true, ReportFormFields: true, TransmissionPreview: true },
            mocks: { $router: { push: () => {} } },
        },
    });
}

function connect(key = NODE_KEY, radio = { radioSf: 7, radioBw: 62500, radioCr: 5 }) {
    GlobalState.connection = { on() {}, off() {} };
    GlobalState.selfInfo = { name: NAME, publicKey: key, radioFreq: 910525, ...radio };
    GlobalState.channels = [{ idx: 7, name: "Emcomm Testing" }];
    GlobalState.contacts = [];
}

const LONG = ("All stations be advised the primary route via Canyon Road is now impassable "
    + "due to debris flow at mile marker 14. Use the northern bypass through Ridge Street. ").repeat(3);

async function sendReport() {
    const sent = [];
    vi.spyOn(Connection, "sendChannelMessage").mockImplementation(async (idx, text) => { sent.push({ idx, text }); });

    const wrapper = mountPanel();
    wrapper.vm.selectedChannelIdx = 7;
    wrapper.vm.selectedFormId = "ics213";
    await wrapper.vm.$nextTick();
    wrapper.vm.values = { to: "Net Control", from: "KJ5HBN", subject: "DRILL route", datetime: "191830L SEP", message: LONG };
    await wrapper.vm.$nextTick();
    const parts = wrapper.vm.prepared.parts;
    await wrapper.vm.confirmSend();
    await wrapper.vm.$nextTick();

    return { wrapper, sent, parts };
}

function resendButtons(wrapper) {
    return wrapper.findAll("button").filter((b) => /^Resend/.test(b.text()));
}

describe("the gap between channel parts", () => {

    const part = "x".repeat(140);

    it("is never under five seconds", () => {
        expect(ReportEncoder.PART_SEND_DELAY_MILLIS).toBe(5000);
        const fast = { radioSf: 7, radioBw: 62500, radioCr: 5 };
        expect(Airtime.channelPartGapMillis(["[1/2] short"], NAME, fast, 5000)).toBe(5000);
    });

    it("grows with the airtime of the longest part, so slow settings get room for the repeats", () => {
        const slow = { radioSf: 12, radioBw: 125000, radioCr: 5 };
        const radio = Airtime.getRadioFromSelfInfo(slow);
        const air = Airtime.getTimeOnAirMillis(Airtime.getPacketBytes(140, "channel", NAME), radio);
        const gap = Airtime.channelPartGapMillis(["short", part], NAME, slow, 5000);
        expect(gap).toBeGreaterThanOrEqual(air * Airtime.FLOOD_GAP_AIRTIMES);
        expect(gap).toBeLessThan(air * Airtime.FLOOD_GAP_AIRTIMES + 1000);
        expect(gap % 1000).toBe(0);
    });

    it("falls back to the floor when the radio settings are not known", () => {
        expect(Airtime.channelPartGapMillis([part], NAME, { radioSf: null }, 5000)).toBe(5000);
    });

    it("is what the send loop waits between parts, and not after the last", async () => {
        GlobalState.lastSentReport = null;
        connect(NODE_KEY, { radioSf: 12, radioBw: 125000, radioCr: 5 });
        const sleep = vi.spyOn(Utils, "sleep").mockResolvedValue(undefined);

        const { wrapper, parts } = await sendReport();

        const gap = wrapper.vm.channelGapFor(parts);
        expect(gap).toBeGreaterThan(5000);
        expect(sleep.mock.calls.map((c) => c[0])).toEqual(Array(parts.length - 1).fill(gap));
        // and the preview says the same
        expect(wrapper.vm.partDelaySeconds).toBe(gap / 1000);
    });

});

describe("resending one part of the last report", () => {

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(Utils, "sleep").mockResolvedValue(undefined);
        GlobalState.lastSentReport = null;
        GlobalState.interruptedReport = null;
        connect();
    });

    it("offers every part of a channel report once it has gone out", async () => {
        const { wrapper, parts } = await sendReport();
        expect(parts.length).toBeGreaterThan(1);

        expect(wrapper.text()).toContain("Last report sent");
        expect(wrapper.text()).toContain("Emcomm Testing");
        expect(resendButtons(wrapper).map((b) => b.text())).toEqual(parts.map((_, i) => `Resend ${i + 1}`));
    });

    it("sends only that part, word for word, to the same channel", async () => {
        const { wrapper, sent, parts } = await sendReport();
        const before = sent.length;

        await resendButtons(wrapper)[1].trigger("click");
        await vi.waitFor(() => expect(sent.length).toBe(before + 1));

        expect(sent[before]).toEqual({ idx: 7, text: parts[1] });
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain(`Part 2 of ${parts.length} went out again`);
    });

    it("is still there when the Reports tab is opened again", async () => {
        const { wrapper, parts } = await sendReport();
        wrapper.unmount();

        const again = mountPanel();
        await again.vm.$nextTick();
        expect(resendButtons(again)).toHaveLength(parts.length);
    });

    it("says so when the resend does not go out", async () => {
        const { wrapper } = await sendReport();
        vi.spyOn(Connection, "sendChannelMessage").mockRejectedValue(new Error("radio refused"));
        vi.spyOn(console, "log").mockImplementation(() => {});

        await wrapper.vm.resendPart(0);
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain("did not go out: radio refused");
    });

    it("will not resend through a different radio", async () => {
        // a channel is a slot number on the radio, so it could land somewhere else
        const { sent } = await sendReport();
        const before = sent.length;
        connect(OTHER_KEY);

        const wrapper = mountPanel();
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain("A different radio is connected now");
        expect(resendButtons(wrapper).every((b) => b.attributes("disabled") !== undefined)).toBe(true);

        await wrapper.vm.resendPart(0);
        expect(sent.length).toBe(before);
    });

    it("goes away when done", async () => {
        const { wrapper } = await sendReport();
        wrapper.vm.dismissLastSent();
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).not.toContain("Last report sent");
    });

    it("is not offered for a report sent to a contact, which is acknowledged part by part", async () => {
        GlobalState.contacts = [{ type: 1, advName: "Net Control", publicKey: OTHER_KEY, lastAdvert: 0, flags: 0 }];
        vi.spyOn(Connection, "sendMessage").mockResolvedValue({ id: 1, estTimeout: 1000 });
        vi.spyOn(Connection, "waitForDelivery").mockResolvedValue("delivered");

        const wrapper = mountPanel();
        wrapper.vm.destinationType = "contact";
        wrapper.vm.selectedContactPublicKey = wrapper.vm.chatContacts[0].publicKeyHex;
        wrapper.vm.selectedFormId = "ics213";
        await wrapper.vm.$nextTick();
        wrapper.vm.values = { to: "Net Control", from: "KJ5HBN", subject: "DRILL route", datetime: "191830L SEP", message: LONG };
        await wrapper.vm.$nextTick();
        await wrapper.vm.confirmSend();

        expect(GlobalState.lastSentReport).toBe(null);
    });

});
