// The EMCOMM settings group.
//
// It sits at the bottom of the settings page and holds the settings EMCOMM mode
// changes, so any of them can be set or put back by hand. It used to end with a
// read-only copy of the radio settings, which the groups above already show in
// editable fields; a second copy of a value is a second thing to disagree.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import EmcommSettingsGroup from "../../src/components/settings/EmcommSettingsGroup.vue";
import GlobalState from "../../src/js/GlobalState.js";
import AdvertSchedule from "../../src/js/AdvertSchedule.js";

const PUBLIC_KEY = new Uint8Array(32).fill(0xab);
const NODE = Array.from(PUBLIC_KEY).map((b) => b.toString(16).padStart(2, "0")).join("");

function mountGroup() {
    GlobalState.selfInfo = {
        name: "KJ5HBN",
        publicKey: PUBLIC_KEY,
        txPower: 20,
        maxTxPower: 22,
        advLat: 31768000,
        advLon: -106371000,
        manualAddContacts: 0,
        radioFreq: 910525,
        radioBw: 62.5,
        radioSf: 7,
        radioCr: 5,
    };
    return mount(EmcommSettingsGroup);
}

describe("EmcommSettingsGroup layout", () => {

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.connection = null;
        AdvertSchedule.stop();
    });

    it("no longer repeats the radio settings shown in the fields above", () => {
        const text = mountGroup().text();
        expect(text).not.toContain("USA / Canada preset");
        expect(text).not.toContain("BW 62.5");
    });

    it("puts automatic contacts above transmit power", () => {
        // it is the setting most often changed on arrival, so it comes first
        const text = mountGroup().text();
        expect(text.indexOf("Add contacts automatically")).toBeLessThan(text.indexOf("Transmit power"));
    });

    it("still offers the settings the mode changes", () => {
        const text = mountGroup().text();
        for(const setting of ["Add contacts automatically", "Transmit power", "Advert position", "Device clock"]){
            expect(text).toContain(setting);
        }
    });

});

describe("EmcommSettingsGroup advert schedule", () => {

    beforeEach(() => {
        window.localStorage.clear();
        GlobalState.connection = null;
        AdvertSchedule.stop();
    });

    it("offers a minutes field for each kind of advert", () => {
        const wrapper = mountGroup();
        expect(wrapper.find("#zero-hop-advert-minutes").exists()).toBe(true);
        expect(wrapper.find("#flood-advert-minutes").exists()).toBe(true);
    });

    it("starts empty on a node that has never had a schedule", () => {
        const wrapper = mountGroup();
        expect(wrapper.find("#zero-hop-advert-minutes").element.value).toBe("");
        expect(wrapper.find("#flood-advert-minutes").element.value).toBe("");
    });

    it("prefills the fields from the node's saved schedule", async () => {
        AdvertSchedule.set(NODE, { zeroHopMinutes: 15, floodMinutes: 120 });
        const wrapper = mountGroup();
        // the fields are filled in mounted(), which lands in the dom a tick later
        await wrapper.vm.$nextTick();
        expect(wrapper.find("#zero-hop-advert-minutes").element.value).toBe("15");
        expect(wrapper.find("#flood-advert-minutes").element.value).toBe("120");
    });

    it("saves what was typed, against this node", async () => {
        const wrapper = mountGroup();
        await wrapper.find("#zero-hop-advert-minutes").setValue("10");
        await wrapper.find("#flood-advert-minutes").setValue("90");
        await wrapper.vm.saveAdvertSchedule();

        expect(AdvertSchedule.get(NODE)).toEqual({ zeroHopMinutes: 10, floodMinutes: 90 });
        expect(wrapper.text()).toContain("zero hop every 10 min");
        expect(wrapper.text()).toContain("flood every 90 min");
    });

    it("says plainly when both are off rather than claiming a schedule", async () => {
        const wrapper = mountGroup();
        await wrapper.vm.saveAdvertSchedule();
        expect(wrapper.text()).toContain("Repeating adverts are off.");
    });

    it("shows the corrected value when a typed one could not stand", async () => {
        const wrapper = mountGroup();
        await wrapper.find("#zero-hop-advert-minutes").setValue("0.4");
        await wrapper.vm.saveAdvertSchedule();
        // rounds to nothing, so the field must not keep showing 0.4
        expect(wrapper.find("#zero-hop-advert-minutes").element.value).toBe("");
    });

    it("cautions about a flood advert fast enough to cost the mesh", async () => {
        const wrapper = mountGroup();
        await wrapper.find("#flood-advert-minutes").setValue("5");
        expect(wrapper.text()).toContain("worth a second thought");
    });

    it("does not caution about an hourly flood advert", async () => {
        const wrapper = mountGroup();
        await wrapper.find("#flood-advert-minutes").setValue("60");
        expect(wrapper.text()).not.toContain("worth a second thought");
    });

    it("does not caution about a zero hop advert, which nobody repeats", async () => {
        const wrapper = mountGroup();
        await wrapper.find("#zero-hop-advert-minutes").setValue("2");
        expect(wrapper.text()).not.toContain("worth a second thought");
    });

});
