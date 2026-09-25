// Keeping a phone adverting, and saying when it has stopped.
//
// Measured on the bench: a phone connected to node 2 over Bluetooth sent one
// advert a minute with the screen on, one more after it was locked, and then
// nothing for nine minutes while node 1 went on hearing the rest of the mesh.
// Android suspends the page. The link survived and the schedule picked up again
// on unlocking, but the status line said "Zero hop running" the whole time.
//
// Two answers. The page asks for the screen to stay on while a schedule runs,
// which is all that can keep a phone adverting: the companion firmware has no
// advert timer of its own. And the status line shows what actually went out,
// flagging a schedule that has fallen behind.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import AdvertSchedule from "../../src/js/AdvertSchedule.js";
import GlobalState from "../../src/js/GlobalState.js";
import AdvertProgressGroup from "../../src/components/settings/AdvertProgressGroup.vue";

const NODE = "aa".repeat(32);
const OTHER = "bb".repeat(32);
const PUBLIC_KEY = new Uint8Array(32).fill(0xaa);

function fakeLock() {
    const listeners = [];
    const lock = {
        released: false,
        addEventListener(type, cb) { if(type === "release") listeners.push(cb); },
        release: vi.fn(async () => { lock.released = true; listeners.forEach((cb) => cb()); }),
    };
    return lock;
}

function giveWakeLock(request) {
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
}

function takeWakeLock() {
    delete navigator.wakeLock;
}

function setVisibility(state) {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

function resetState() {
    AdvertSchedule.stop();
    AdvertSchedule.node = null;
    GlobalState.advertLastSent = { zeroHop: null, flood: null };
    GlobalState.advertStartedAt = null;
    GlobalState.advertIntervals = { zeroHop: 0, flood: 0 };
    GlobalState.advertWakeLock = "none";
    window.localStorage.clear();
}

describe("what actually went out", () => {

    beforeEach(() => {
        vi.useFakeTimers();
        resetState();
        takeWakeLock();
        GlobalState.connection = {
            sendZeroHopAdvert: vi.fn().mockResolvedValue(undefined),
            sendFloodAdvert: vi.fn().mockResolvedValue(undefined),
        };
    });

    afterEach(() => {
        resetState();
        GlobalState.connection = null;
        vi.useRealTimers();
    });

    it("records a send once the radio has taken it", async () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);

        await vi.advanceTimersByTimeAsync(60 * 1000);

        expect(GlobalState.advertLastSent.zeroHop).toBe(Date.now());
        expect(GlobalState.advertLastSent.flood).toBe(null);
    });

    it("does not record a send the radio refused", async () => {
        // the whole point is to show what really went out
        GlobalState.connection.sendZeroHopAdvert.mockRejectedValueOnce(new Error("busy"));
        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);

        await vi.advanceTimersByTimeAsync(60 * 1000);

        expect(GlobalState.advertLastSent.zeroHop).toBe(null);
    });

    it("keeps the last send across a re-apply on the same radio", async () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        await vi.advanceTimersByTimeAsync(60 * 1000);
        const sent = GlobalState.advertLastSent.zeroHop;

        AdvertSchedule.start(NODE);

        expect(GlobalState.advertLastSent.zeroHop).toBe(sent);
    });

    it("forgets it when a different radio connects", async () => {
        // a time sent through one radio says nothing about another
        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        await vi.advanceTimersByTimeAsync(60 * 1000);

        AdvertSchedule.start(OTHER);

        expect(GlobalState.advertLastSent.zeroHop).toBe(null);
    });

    it("counts the first one due a full interval from the start", () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);

        expect(AdvertSchedule.nextDue("zeroHop")).toBe(GlobalState.advertStartedAt + 60 * 1000);
        expect(AdvertSchedule.nextDue("flood")).toBe(null);
    });

    it("counts the next one from the last send", async () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        await vi.advanceTimersByTimeAsync(60 * 1000);

        expect(AdvertSchedule.nextDue("zeroHop")).toBe(GlobalState.advertLastSent.zeroHop + 60 * 1000);
    });

    it("is not overdue on time, or within the grace", () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        const due = AdvertSchedule.nextDue("zeroHop");

        expect(AdvertSchedule.isOverdue("zeroHop", due)).toBe(false);
        expect(AdvertSchedule.isOverdue("zeroHop", due + AdvertSchedule.OVERDUE_GRACE_MILLIS)).toBe(false);
    });

    it("is overdue once the grace has passed with nothing sent", () => {
        // the locked phone: the timer never fired, so nothing moved the due time on
        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        const due = AdvertSchedule.nextDue("zeroHop");

        expect(AdvertSchedule.isOverdue("zeroHop", due + AdvertSchedule.OVERDUE_GRACE_MILLIS + 1)).toBe(true);
    });

    it("is never overdue for a kind that is off", () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        expect(AdvertSchedule.isOverdue("flood", Date.now() + 24 * 60 * 60 * 1000)).toBe(false);
    });

});

describe("keeping the screen on", () => {

    beforeEach(() => {
        resetState();
        setVisibility("visible");
        GlobalState.connection = { sendZeroHopAdvert: vi.fn(), sendFloodAdvert: vi.fn() };
    });

    afterEach(() => {
        resetState();
        takeWakeLock();
        setVisibility("visible");
        GlobalState.connection = null;
    });

    it("asks for it while a schedule runs, and lets it go when it stops", async () => {
        const lock = fakeLock();
        const request = vi.fn().mockResolvedValue(lock);
        giveWakeLock(request);

        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        await vi.waitFor(() => expect(GlobalState.advertWakeLock).toBe("held"));
        expect(request).toHaveBeenCalledWith("screen");

        AdvertSchedule.stop();
        expect(lock.release).toHaveBeenCalled();
        expect(GlobalState.advertWakeLock).toBe("none");
    });

    it("does not ask for it with nothing scheduled", async () => {
        const request = vi.fn().mockResolvedValue(fakeLock());
        giveWakeLock(request);

        AdvertSchedule.start(NODE);
        await Promise.resolve();

        expect(request).not.toHaveBeenCalled();
    });

    it("says so on a browser that cannot keep the screen on", () => {
        takeWakeLock();
        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        expect(GlobalState.advertWakeLock).toBe("unsupported");
    });

    it("says so when the browser refuses", async () => {
        giveWakeLock(vi.fn().mockRejectedValue(new Error("low battery")));
        vi.spyOn(console, "log").mockImplementation(() => {});

        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);

        await vi.waitFor(() => expect(GlobalState.advertWakeLock).toBe("failed"));
        vi.restoreAllMocks();
    });

    it("takes it again when the page comes back into view", async () => {
        // browsers drop the lock whenever the page is hidden
        const first = fakeLock();
        const second = fakeLock();
        const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
        giveWakeLock(request);

        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        await vi.waitFor(() => expect(GlobalState.advertWakeLock).toBe("held"));

        // hidden: the browser releases it
        setVisibility("hidden");
        await first.release();
        expect(GlobalState.advertWakeLock).toBe("waiting");

        setVisibility("visible");
        document.dispatchEvent(new Event("visibilitychange"));

        await vi.waitFor(() => expect(GlobalState.advertWakeLock).toBe("held"));
        expect(request).toHaveBeenCalledTimes(2);
    });

    it("waits rather than asking while the page is hidden", () => {
        giveWakeLock(vi.fn().mockResolvedValue(fakeLock()));
        setVisibility("hidden");

        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);

        expect(GlobalState.advertWakeLock).toBe("waiting");
        expect(navigator.wakeLock.request).not.toHaveBeenCalled();
    });

    it("does not keep the screen on for a schedule stopped while the request was out", async () => {
        const lock = fakeLock();
        let grant;
        giveWakeLock(vi.fn(() => new Promise((r) => { grant = r; })));

        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        AdvertSchedule.stop();
        grant(lock);

        await vi.waitFor(() => expect(lock.release).toHaveBeenCalled());
        expect(GlobalState.advertWakeLock).toBe("none");
    });

});

describe("the settings group reports it", () => {

    beforeEach(() => {
        resetState();
        takeWakeLock();
        GlobalState.connection = null;
        GlobalState.selfInfo = { name: "KJ5HBN-EMCOMM", publicKey: PUBLIC_KEY, txPower: 20, maxTxPower: 22, advLat: 0, advLon: 0, manualAddContacts: 0 };
    });

    afterEach(() => {
        resetState();
        GlobalState.selfInfo = null;
    });

    it("says when the first one is due before any has gone", async () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        const wrapper = mount(AdvertProgressGroup);
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain("Zero hop: first due");
    });

    it("says when the last one went", async () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        GlobalState.advertLastSent = { zeroHop: Date.now(), flood: null };
        const wrapper = mount(AdvertProgressGroup);
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain("Zero hop: last sent");
        expect(wrapper.text()).not.toContain("overdue");
    });

    it("flags a schedule that has fallen behind, and says why it happens", async () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        const sent = Date.now();
        GlobalState.advertLastSent = { zeroHop: sent, flood: null };
        const wrapper = mount(AdvertProgressGroup);

        // ten minutes on: what the bench saw with the phone locked
        wrapper.vm.now = sent + 10 * 60 * 1000;
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain("Zero hop: overdue, last sent");
        expect(wrapper.text()).toContain("locked screen");
        // still honest that it is set, alongside saying it is not getting out
        expect(wrapper.text()).toContain("Zero hop running");
    });

    it("warns when the screen cannot be kept on", async () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: 1, floodMinutes: 0 });
        AdvertSchedule.start(NODE);
        const wrapper = mount(AdvertProgressGroup);
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain("This browser cannot keep the screen on");
    });

    it("says nothing about the screen when nothing is scheduled", async () => {
        const wrapper = mount(AdvertProgressGroup);
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).not.toContain("screen");
    });

});
