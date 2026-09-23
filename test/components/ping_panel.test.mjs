// The ping panel's behaviour, which is where the wiring bugs have been.
//
// The logic suites cover encoding and arithmetic well. What they cannot see is a
// guard that is never consulted, a loop that keeps running after its panel is gone,
// or an error being recorded as a measurement. All three of those were real.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import PingPanel from "../../src/components/ping/PingPanel.vue";
import GlobalState from "../../src/js/GlobalState.js";
import Connection from "../../src/js/Connection.js";

const REPEATER_KEY = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));

function mountPanel() {
    // the picker is exercised by its own behaviour, not this suite, and it needs a
    // directive that is registered globally by the app rather than by a test
    return mount(PingPanel, { global: { stubs: { SearchableSelect: true } } });
}

function aRepeater() {
    return { type: 2, advName: "Test Repeater", publicKey: REPEATER_KEY, lastAdvert: 1000, outPathLen: 0 };
}

describe("PingPanel", () => {

    beforeEach(() => {
        GlobalState.connection = { on() {}, off() {}, async sendToRadioFrame() {} };
        GlobalState.contacts = [aRepeater()];
        vi.restoreAllMocks();
    });

    it("offers repeaters, not companions", () => {
        GlobalState.contacts = [aRepeater(), { type: 1, advName: "A Companion", publicKey: new Uint8Array(32), lastAdvert: 5000 }];
        const wrapper = mountPanel();
        const names = wrapper.vm.pingableContacts.map((c) => c.name);
        expect(names).toEqual(["Test Repeater"]);
    });

    it("puts the most recently heard repeater first", () => {
        // real epoch seconds: a lastAdvert below 2020 is read as a clock that was
        // never set, so 100 and 900 would both rank as never heard
        const now = Math.floor(Date.now() / 1000);
        const older = { ...aRepeater(), advName: "Older", publicKey: new Uint8Array(32).fill(9), lastAdvert: now - 9000 };
        const newer = { ...aRepeater(), advName: "Newer", publicKey: new Uint8Array(32).fill(7), lastAdvert: now - 60 };
        GlobalState.contacts = [older, newer];
        const wrapper = mountPanel();
        expect(wrapper.vm.pingableContacts.map((c) => c.name)).toEqual(["Newer", "Older"]);
    });

    it("will not start a ping while discovery is still listening", async () => {
        const wrapper = mountPanel();
        wrapper.vm.selectedContactKey = wrapper.vm.pingableContacts[0].publicKeyHex;
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.canStart).toBe(true);

        // both transmit, and discovery is holding the rx stream
        wrapper.vm.isDiscovering = true;
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.canStart).toBe(false);
    });

    it("records a lost link as a stopped run, not as packet loss", async () => {

        vi.spyOn(Connection, "pingContact").mockImplementation(async () => {
            throw new Error(Connection.DISCONNECTED);
        });

        const wrapper = mountPanel();
        wrapper.vm.selectedContactKey = wrapper.vm.pingableContacts[0].publicKeyHex;
        wrapper.vm.requestCount = 5;
        wrapper.vm.delayMillis = 0;
        await wrapper.vm.start();

        // the bug this replaces reported 5 sent and 100% lost, describing a mesh
        // that was never measured
        expect(wrapper.vm.results).toHaveLength(0);
        expect(wrapper.vm.stats).toBe(null);
        expect(wrapper.vm.errorMessage).toMatch(/disconnected/i);

    });

    it("keeps real replies collected before the link dropped", async () => {

        let call = 0;
        vi.spyOn(Connection, "pingContact").mockImplementation(async () => {
            call++;
            if(call <= 2){
                return { snrThere: 11.75, snrBack: 12.25, timeMillis: 400 };
            }
            throw new Error(Connection.DISCONNECTED);
        });

        const wrapper = mountPanel();
        wrapper.vm.selectedContactKey = wrapper.vm.pingableContacts[0].publicKeyHex;
        wrapper.vm.requestCount = 6;
        wrapper.vm.delayMillis = 0;
        await wrapper.vm.start();

        expect(wrapper.vm.results).toHaveLength(2);
        expect(wrapper.vm.results.every((r) => r.success)).toBe(true);
        // statistics describe what was actually sent, not what was intended
        expect(wrapper.vm.stats.total).toBe(2);
        expect(wrapper.vm.stats.lossPercent).toBe(0);

    });

    it("counts a timeout as packet loss, because that is what it is", async () => {

        vi.spyOn(Connection, "pingContact").mockImplementation(async () => {
            throw new Error("timeout");
        });

        const wrapper = mountPanel();
        wrapper.vm.selectedContactKey = wrapper.vm.pingableContacts[0].publicKeyHex;
        wrapper.vm.requestCount = 3;
        wrapper.vm.delayMillis = 0;
        await wrapper.vm.start();

        expect(wrapper.vm.results).toHaveLength(3);
        expect(wrapper.vm.stats.lossPercent).toBe(100);
        expect(wrapper.vm.errorMessage).toBe(null);

    });

    it("hides the averages when nothing came back", async () => {

        vi.spyOn(Connection, "pingContact").mockImplementation(async () => { throw new Error("timeout"); });

        const wrapper = mountPanel();
        wrapper.vm.selectedContactKey = wrapper.vm.pingableContacts[0].publicKeyHex;
        wrapper.vm.requestCount = 2;
        wrapper.vm.delayMillis = 0;
        await wrapper.vm.start();
        await wrapper.vm.$nextTick();

        // avg snr 0dB would read as a measurement of a dead link rather than the
        // absence of one
        expect(wrapper.vm.stats.received).toBe(0);
        expect(wrapper.text()).not.toMatch(/avg snr_there/);
        expect(wrapper.text()).toMatch(/100% lost/);

    });

    it("stops transmitting when the panel goes away", async () => {

        let calls = 0;
        vi.spyOn(Connection, "pingContact").mockImplementation(async () => {
            calls++;
            return { snrThere: 1, snrBack: 1, timeMillis: 10 };
        });

        const wrapper = mountPanel();
        wrapper.vm.selectedContactKey = wrapper.vm.pingableContacts[0].publicKeyHex;
        wrapper.vm.requestCount = 20;
        wrapper.vm.delayMillis = 0;

        const running = wrapper.vm.start();
        // switching tabs unmounts the panel mid run
        wrapper.unmount();
        await running;

        // the loop stopped rather than transmitting the remaining requests with no
        // display and no way to cancel
        expect(calls).toBeLessThan(20);

    });

    it("estimates a run only for the case where the station answers", () => {
        const wrapper = mountPanel();
        wrapper.vm.requestCount = 5;
        wrapper.vm.delayMillis = 1000;
        // four gaps of a second, plus roughly half a second per reply
        expect(wrapper.vm.estimatedDurationLabel).toBe("6.5 s");
        // and the panel says out loud that a timeout takes longer than this
        expect(wrapper.text()).toMatch(/if the station answers/);
    });

    it("explains a repeater that answered discovery and then would not ping", async () => {

        vi.spyOn(Connection, "pingContact").mockImplementation(async () => { throw new Error("timeout"); });

        const wrapper = mountPanel();
        const key = wrapper.vm.pingableContacts[0].publicKeyHex;
        wrapper.vm.selectedContactKey = key;
        wrapper.vm.discoverResults = [{ publicKeyHex: key, name: "Test Repeater", isNew: false, snrThere: 11, snrBack: 11, rssi: -70 }];
        wrapper.vm.requestCount = 2;
        wrapper.vm.delayMillis = 0;
        await wrapper.vm.start();
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.answeredDiscoveryButNotPing).toBe(true);
        expect(wrapper.text()).toMatch(/does not\s+answer trace requests/);

    });

    // A dropped USB cable greyed both buttons out and said nothing. Disabled states
    // the control cannot be used and nothing about why, which on a radio that went
    // away mid session is the one thing worth telling the operator.
    describe("with no radio connected", () => {

        beforeEach(() => {
            GlobalState.connection = null;
        });

        it("says why, rather than only grey buttons", () => {
            const wrapper = mountPanel();
            expect(wrapper.text()).toMatch(/No radio connected/);
        });

        it("will not start a run", () => {
            const wrapper = mountPanel();
            wrapper.vm.selectedContactKey = wrapper.vm.pingableContacts[0].publicKeyHex;
            expect(wrapper.vm.canStart).toBe(false);
        });

        it("says nothing was sent if a run is started anyway", async () => {
            // the connection can drop between the render and the press, and returning
            // silently there looks exactly like a run that finished instantly
            const ping = vi.spyOn(Connection, "pingContact");
            const wrapper = mountPanel();
            wrapper.vm.selectedContactKey = wrapper.vm.pingableContacts[0].publicKeyHex;
            // the watcher on the selection clears the message, and it flushes on the
            // first await inside start(), so let it run before there is one to clear
            await wrapper.vm.$nextTick();
            await wrapper.vm.start();
            expect(ping).not.toHaveBeenCalled();
            expect(wrapper.vm.errorMessage).toMatch(/nothing was sent/i);
        });

        it("will not discover either", async () => {
            const discover = vi.spyOn(Connection, "discoverRepeaters");
            const wrapper = mountPanel();
            await wrapper.vm.discover();
            expect(discover).not.toHaveBeenCalled();
            expect(wrapper.vm.discoverError).toMatch(/nothing was sent/i);
        });

    });

    it("blames the disconnect for a failed discovery when that is the cause", async () => {
        // it used to offer the firmware version as an equally likely explanation,
        // which is a guess in a case where the app already knows the answer
        vi.spyOn(Connection, "discoverRepeaters").mockImplementation(async () => {
            throw new Error(Connection.DISCONNECTED);
        });
        const wrapper = mountPanel();
        await wrapper.vm.discover();
        expect(wrapper.vm.discoverError).toMatch(/radio disconnected/i);
        expect(wrapper.vm.discoverError).not.toMatch(/firmware/i);
    });

    it("still hedges about a discovery failure it cannot explain", async () => {
        vi.spyOn(Connection, "discoverRepeaters").mockImplementation(async () => {
            throw new Error("something else entirely");
        });
        const wrapper = mountPanel();
        await wrapper.vm.discover();
        expect(wrapper.vm.discoverError).toMatch(/firmware/i);
    });

});
