// 0, 0 is refused for the right reason and used to be told the wrong one.
//
// From the 28 Sep audit. `Geo.isPosition` refuses 0, 0 because it is what a radio
// reports when it has no fix, and treating it as a place would put a station in the
// Gulf of Guinea. The refusal is correct. The message said "latitude -90 to 90,
// longitude -180 to 180" -- a range 0, 0 is comfortably inside, so an operator who
// typed it was told something that could not be acted on.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PositionEntry from "../../src/components/position/PositionEntry.vue";
import Geo from "../../src/js/position/Geo.js";

const entry = (latitude, longitude) => mount(PositionEntry, {
    props: { mode: "degrees", latitude, longitude, position: null, invalid: true },
    global: { stubs: { MapLink: true } },
});

describe("what a refused position is told", () => {

    it("still refuses 0, 0 -- the behaviour is not what was wrong", () => {
        expect(Geo.isPosition(0, 0)).toBe(false);
    });

    it("tells 0, 0 what is actually wrong with it", () => {
        const text = entry("0", "0").text();
        expect(text).toContain("0, 0 is how a radio says it has no fix");
        expect(text).not.toContain("latitude -90 to 90");
    });

    it("still cites the range when the range is the problem", () => {
        const text = entry("91", "0").text();
        expect(text).toContain("latitude -90 to 90");
        expect(text).not.toContain("no fix");
    });

    // a real position that happens to have one zero is not null island
    it("does not mistake a zero in one field for it", () => {
        expect(entry("0", "-106.4850").text()).toContain("latitude -90 to 90");
        expect(entry("31.7619", "0").text()).toContain("latitude -90 to 90");
    });

    // an empty form is not a claim to be at 0, 0
    it("does not treat empty fields as 0, 0", () => {
        expect(entry("", "").text()).toContain("latitude -90 to 90");
    });

    // the owner of this component decides what counts as refused; the message is a
    // reason for a refusal, not a running commentary on the fields
    it("says nothing about 0, 0 unless the entry is actually being refused", () => {
        const wrapper = mount(PositionEntry, {
            props: { mode: "degrees", latitude: "0", longitude: "0", position: null, invalid: false },
            global: { stubs: { MapLink: true } },
        });
        expect(wrapper.text()).not.toContain("no fix");
    });

    it("says nothing at all when the position is fine", () => {
        const wrapper = mount(PositionEntry, {
            props: { mode: "degrees", latitude: "31.7619", longitude: "-106.4850", position: null, invalid: false },
            global: { stubs: { MapLink: true } },
        });
        expect(wrapper.text()).not.toContain("latitude -90 to 90");
        expect(wrapper.text()).not.toContain("no fix");
    });

});
