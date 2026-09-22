// The reports panel's send orchestration.
//
// The encoder underneath is thoroughly covered and the orchestration was not, which
// is the wrong way round: the splitting is arithmetic that either works or does
// not, while the sending has ordering, acknowledgement, retry and resume, and those
// are where a mistake quietly loses somebody's traffic.
//
// The direct message case is the one that bit us on the air. The device tracks a
// single outstanding message, so a part sent before the previous is acknowledged is
// simply lost, and the operator sees a report delivered with a hole in it.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ReportsPanel from "../../src/components/reports/ReportsPanel.vue";
import GlobalState from "../../src/js/GlobalState.js";
import Connection from "../../src/js/Connection.js";
import ReportForms from "../../src/js/reports/ReportForms.js";
import Utils from "../../src/js/Utils.js";

const CONTACT_KEY = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));

// records where the panel navigated, since a completed send takes the operator to
// the conversation the report landed in
let routedTo = null;

function mountPanel() {
    routedTo = null;
    return mount(ReportsPanel, {
        global: {
            stubs: { SearchableSelect: true, ReportFormFields: true, TransmissionPreview: true },
            mocks: { $router: { push: (to) => { routedTo = to; } } },
        },
    });
}

// enough of a device for the panel to consider itself usable
function connect() {
    GlobalState.connection = { on() {}, off() {} };
    GlobalState.selfInfo = { name: "Joe-KJ5HBN-HTv3", radioFreq: 910525, radioBw: 62500, radioSf: 7, radioCr: 5 };
    GlobalState.channels = [{ idx: 7, name: "Emcomm Testing" }];
    GlobalState.contacts = [{ type: 1, advName: "KJ5HBN-EMCOMM", publicKey: CONTACT_KEY, lastAdvert: 1000 }];
}

// a long free text value, so the report is forced to split
const LONG_MESSAGE = "All stations be advised the primary route via Canyon Road is now impassable "
    + "due to debris flow at mile marker 14. Use the northern bypass through Ridge Street. "
    + "Estimated additional transit time is 25 minutes.";

// selecting a form resets the field values, on a watcher, so the values have to be
// set after that has run rather than in the same tick
async function fillIcs213(wrapper, message = LONG_MESSAGE) {
    wrapper.vm.selectedFormId = "ics213";
    await wrapper.vm.$nextTick();
    wrapper.vm.values = {
        to: "J. Smith, Ops Chief",
        from: "R. Jones, Net Control",
        subject: "Route status",
        datetime: "191830L SEP",
        message,
    };
}

describe("ReportsPanel", () => {

    beforeEach(() => {
        connect();
        vi.restoreAllMocks();
        // the gap between channel parts is at least five seconds on air, which is
        // what it is for; here it only makes the suite slow
        vi.spyOn(Utils, "sleep").mockResolvedValue(undefined);
    });

    describe("before anything is transmitted", () => {

        it("will not send without a destination", async () => {
            const wrapper = mountPanel();
            await fillIcs213(wrapper);
            await wrapper.vm.$nextTick();
            expect(wrapper.vm.validationMessage).toMatch(/select a channel/i);
            expect(wrapper.vm.canSend).toBe(false);
        });

        it("names the fields still missing rather than just refusing", async () => {
            const wrapper = mountPanel();
            wrapper.vm.selectedChannelIdx = 7;
            wrapper.vm.selectedFormId = "ics213";
            await wrapper.vm.$nextTick();
            wrapper.vm.values = { to: "Ops" };
            await wrapper.vm.$nextTick();
            expect(wrapper.vm.validationMessage).toMatch(/^Required: /);
            expect(wrapper.vm.validationMessage).toMatch(/Message/);
        });

        it("refuses when the device is gone", async () => {
            GlobalState.connection = null;
            const wrapper = mountPanel();
            wrapper.vm.selectedChannelIdx = 7;
            await fillIcs213(wrapper);
            await wrapper.vm.$nextTick();
            expect(wrapper.vm.validationMessage).toMatch(/not connected/i);
        });

        it("the first press only opens the confirmation, and transmits nothing", async () => {
            const send = vi.spyOn(Connection, "sendChannelMessage").mockResolvedValue(undefined);
            const wrapper = mountPanel();
            wrapper.vm.selectedChannelIdx = 7;
            await fillIcs213(wrapper);
            await wrapper.vm.$nextTick();

            wrapper.vm.onSendClick();
            expect(wrapper.vm.isConfirming).toBe(true);
            expect(send).not.toHaveBeenCalled();
        });

    });

    describe("sending to a channel", () => {

        it("sends every part, in order", async () => {
            const sent = [];
            vi.spyOn(Connection, "sendChannelMessage").mockImplementation(async (idx, text) => { sent.push({ idx, text }); });

            const wrapper = mountPanel();
            wrapper.vm.selectedChannelIdx = 7;
            await fillIcs213(wrapper);
            await wrapper.vm.$nextTick();

            const expected = wrapper.vm.prepared.parts;
            expect(expected.length).toBeGreaterThan(1);

            await wrapper.vm.confirmSend();

            expect(sent.map((s) => s.text)).toEqual(expected);
            expect(sent.every((s) => s.idx === 7)).toBe(true);
            // and the operator is shown the conversation it landed in
            expect(routedTo?.name).toBe("channel.messages");
        });

        it("does not wait for an acknowledgement, because a channel never sends one", async () => {
            vi.spyOn(Connection, "sendChannelMessage").mockResolvedValue(undefined);
            const wait = vi.spyOn(Connection, "waitForDelivery");

            const wrapper = mountPanel();
            wrapper.vm.selectedChannelIdx = 7;
            await fillIcs213(wrapper);
            await wrapper.vm.$nextTick();
            await wrapper.vm.confirmSend();

            expect(wait).not.toHaveBeenCalled();
        });

    });

    describe("sending to a contact", () => {

        function selectContact(wrapper) {
            wrapper.vm.destinationType = "contact";
            wrapper.vm.selectedContactPublicKey = wrapper.vm.chatContacts[0].publicKeyHex;
        }

        it("waits for each part to be acknowledged before sending the next", async () => {

            const order = [];
            vi.spyOn(Connection, "sendMessage").mockImplementation(async () => {
                order.push("send");
                return { id: order.length, estTimeout: 1000 };
            });
            // the acknowledgement must resolve later than the call, or this cannot tell
            // an awaited wait from a fire and forget one: both record the same order
            vi.spyOn(Connection, "waitForDelivery").mockImplementation(async () => {
                await new Promise((r) => setTimeout(r, 5));
                order.push("ack");
                return "delivered";
            });

            const wrapper = mountPanel();
            selectContact(wrapper);
            await fillIcs213(wrapper);
            await wrapper.vm.$nextTick();
            const parts = wrapper.vm.prepared.parts;
            expect(parts.length).toBeGreaterThan(1);

            await wrapper.vm.confirmSend();

            // strictly alternating, and never two sends in a row. the bug this replaces
            // sent part two while part one was still being acknowledged, and lost it
            const upToLast = order.slice(0, -1);
            expect(upToLast).toEqual(Array.from({ length: parts.length - 1 }, () => ["send", "ack"]).flat());
            expect(order[order.length - 1]).toBe("send");
        });

        it("does not wait on the last part, since nothing follows it", async () => {
            vi.spyOn(Connection, "sendMessage").mockResolvedValue({ id: 1, estTimeout: 1000 });
            const wait = vi.spyOn(Connection, "waitForDelivery").mockResolvedValue("delivered");

            const wrapper = mountPanel();
            selectContact(wrapper);
            await fillIcs213(wrapper);
            await wrapper.vm.$nextTick();
            const parts = wrapper.vm.prepared.parts;

            await wrapper.vm.confirmSend();
            expect(wait).toHaveBeenCalledTimes(parts.length - 1);
        });

        it("retransmits a part that is not acknowledged", async () => {
            vi.spyOn(Connection, "sendMessage").mockResolvedValue({ id: 1, estTimeout: 1 });
            vi.spyOn(Connection, "retryBackoffMillis").mockReturnValue(0);

            let attempt = 0;
            vi.spyOn(Connection, "waitForDelivery").mockImplementation(async () => {
                attempt++;
                return attempt === 1 ? "timeout" : "delivered";
            });

            const wrapper = mountPanel();
            selectContact(wrapper);
            await fillIcs213(wrapper);
            await wrapper.vm.$nextTick();
            await wrapper.vm.confirmSend();

            // the first part failed once and then went through, so the report completed
            expect(attempt).toBeGreaterThan(1);
            expect(wrapper.vm.sendFailure).toBe(null);
        });

        it("gives up after the retries and offers to resume, rather than sending on top", async () => {
            const sends = [];
            vi.spyOn(Connection, "sendMessage").mockImplementation(async () => { sends.push(1); return { id: 1, estTimeout: 1 }; });
            vi.spyOn(Connection, "retryBackoffMillis").mockReturnValue(0);
            vi.spyOn(Connection, "waitForDelivery").mockResolvedValue("timeout");

            const wrapper = mountPanel();
            selectContact(wrapper);
            await fillIcs213(wrapper);
            await wrapper.vm.$nextTick();
            await wrapper.vm.confirmSend();

            expect(wrapper.vm.sendFailure).not.toBe(null);
            // it stopped on the first part rather than carrying on over the top of it
            expect(wrapper.vm.sendFailure.sentCount).toBe(0);
            expect(sends).toHaveLength(Connection.MAX_PART_RETRIES + 1);
        });

        it("resumes from the part that failed, not from the beginning", async () => {

            vi.spyOn(Connection, "retryBackoffMillis").mockReturnValue(0);
            const sent = [];
            vi.spyOn(Connection, "sendMessage").mockImplementation(async (key, text) => {
                sent.push(text);
                return { id: sent.length, estTimeout: 1 };
            });

            // first part acknowledged, then nothing, until the resume
            let fail = true;
            vi.spyOn(Connection, "waitForDelivery").mockImplementation(async () => {
                if(sent.length === 1) return "delivered";
                return fail ? "timeout" : "delivered";
            });

            const wrapper = mountPanel();
            selectContact(wrapper);
            await fillIcs213(wrapper);
            await wrapper.vm.$nextTick();
            const parts = wrapper.vm.prepared.parts;

            await wrapper.vm.confirmSend();
            expect(wrapper.vm.sendFailure.sentCount).toBe(1);

            fail = false;
            sent.length = 0;
            await wrapper.vm.resumeSend();

            // the part already delivered is not sent twice: the receiving operator
            // would see the same numbered fragment arrive again
            expect(sent[0]).toBe(parts[1]);
            expect(sent).not.toContain(parts[0]);
        });

        it("keeps the original destination on a resume", async () => {
            vi.spyOn(Connection, "retryBackoffMillis").mockReturnValue(0);
            const keys = [];
            vi.spyOn(Connection, "sendMessage").mockImplementation(async (key) => { keys.push(key); return { id: 1, estTimeout: 1 }; });
            vi.spyOn(Connection, "waitForDelivery").mockResolvedValue("timeout");

            const wrapper = mountPanel();
            selectContact(wrapper);
            await fillIcs213(wrapper);
            await wrapper.vm.$nextTick();
            await wrapper.vm.confirmSend();

            // the operator fiddles with the form before resuming
            wrapper.vm.destinationType = "channel";
            wrapper.vm.selectedChannelIdx = 7;
            await wrapper.vm.$nextTick();

            const channelSend = vi.spyOn(Connection, "sendChannelMessage").mockResolvedValue(undefined);
            await wrapper.vm.resumeSend();

            // the rest of the report must follow the parts already sent, not go
            // somewhere else half way through
            expect(channelSend).not.toHaveBeenCalled();
            expect(keys.length).toBeGreaterThan(0);
        });

    });

    it("stops transmitting when the panel goes away", async () => {
        let sends = 0;
        vi.spyOn(Connection, "sendChannelMessage").mockImplementation(async () => { sends++; });

        const wrapper = mountPanel();
        wrapper.vm.selectedChannelIdx = 7;
        // long enough to split into several parts
        await fillIcs213(wrapper, LONG_MESSAGE.repeat(4));
        await wrapper.vm.$nextTick();
        const parts = wrapper.vm.prepared.parts;
        expect(parts.length).toBeGreaterThan(3);

        const running = wrapper.vm.confirmSend();
        wrapper.unmount();
        await running;

        expect(sends).toBeLessThan(parts.length);
    });

    it("has a form catalogue the panel can actually render", () => {
        const wrapper = mountPanel();
        // every form is offered, and the ICS ones lead
        expect(wrapper.vm.forms).toHaveLength(ReportForms.length);
        expect(wrapper.vm.forms[0].name.startsWith("ICS-")).toBe(true);
    });

});
