// The field renderer, which is where an operator actually types a report.
//
// Two things here are more than markup. The date time group builds one string out
// of a mode and two inputs, and the position button talks to the radio and must
// refuse to write a plausible looking wrong answer into a report.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ReportFormFields from "../../src/components/reports/ReportFormFields.vue";
import GlobalState from "../../src/js/GlobalState.js";
import Connection from "../../src/js/Connection.js";
import OperatorSettings from "../../src/js/reports/OperatorSettings.js";

const TEXT = { id: "location", tag: "LOC", label: "Location", type: "text", required: true, offersPosition: true };
const PLAIN = { id: "notes", tag: "NOTE", label: "Notes", type: "text", required: false };
const AREA = { id: "message", tag: "MSG", label: "Message", type: "textarea", required: true };
const PICK = { id: "severity", tag: "SEV", label: "Severity", type: "select", required: true, options: ["MINOR", "MAJOR"] };
const WHEN = { id: "datetime", tag: "DTG", label: "Date / time", type: "dtg", required: true };

function mountFields(fields = [TEXT, PLAIN, AREA, PICK, WHEN], values = {}) {
    return mount(ReportFormFields, { props: { fields, values } });
}

// the last value this field reported, since the panel owns the values, not this
function lastEmitted(wrapper, fieldId) {
    const events = (wrapper.emitted("input") ?? []).filter((e) => e[0] === fieldId);
    return events.length ? events[events.length - 1][1] : null;
}

describe("ReportFormFields", () => {

    beforeEach(() => {
        GlobalState.gpsStatus = "live";
        GlobalState.connection = { on() {}, off() {} };
        vi.restoreAllMocks();
    });

    describe("rendering each kind of field", () => {

        it("renders the right control for each type", () => {
            const wrapper = mountFields();
            expect(wrapper.find("#report-field-notes").element.tagName).toBe("INPUT");
            expect(wrapper.find("#report-field-message").element.tagName).toBe("TEXTAREA");
            expect(wrapper.find("#report-field-severity").element.tagName).toBe("SELECT");
        });

        it("offers every option a select declares", () => {
            const wrapper = mountFields([PICK]);
            const options = wrapper.findAll("#report-field-severity option").map((o) => o.text());
            // the placeholder, then the real ones
            expect(options).toContain("MINOR");
            expect(options).toContain("MAJOR");
        });

        it("marks required fields for sighted and unsighted readers alike", () => {
            const wrapper = mountFields([TEXT, PLAIN]);
            expect(wrapper.text()).toMatch(/required/);
            // the asterisk alone would be silent to a screen reader
            expect(wrapper.html()).toMatch(/sr-only/);
        });

        it("reports a change rather than applying it, since the panel owns the values", async () => {
            const wrapper = mountFields([PLAIN]);
            await wrapper.find("#report-field-notes").setValue("debris on the roadway");
            expect(lastEmitted(wrapper, "notes")).toBe("debris on the roadway");
        });

    });

    describe("date time group", () => {

        it("starts on an exact time", () => {
            const wrapper = mountFields([WHEN], { datetime: "191830L SEP" });
            expect(wrapper.find("select").element.value).toBe("exact");
        });

        it("fills the current time from the Now button", async () => {
            const wrapper = mountFields([WHEN]);
            await wrapper.findAll("button").find((b) => b.text() === "Now").trigger("click");
            // matches the shape the encoder and the net both expect
            expect(lastEmitted(wrapper, "datetime")).toMatch(/^\d{6}[LZ] [A-Z]{3}$/);
        });

        it("marks a time approximate rather than pretending to precision", async () => {
            const wrapper = mountFields([WHEN], { datetime: "191830L SEP" });
            await wrapper.find("select").setValue("approx");
            expect(lastEmitted(wrapper, "datetime")).toMatch(/^ABT /);
        });

        it("offers a second box only for a range", async () => {
            const wrapper = mountFields([WHEN], { datetime: "191830L SEP" });
            expect(wrapper.findAll('input[type="text"]')).toHaveLength(1);
            await wrapper.find("select").setValue("between");
            expect(wrapper.findAll('input[type="text"]')).toHaveLength(2);
        });

        it("keeps the chosen mode while a range is half typed", async () => {
            // deriving the mode from the value alone would snap back to exact here,
            // because a range with one end filled has no separator yet
            const wrapper = mountFields([WHEN], { datetime: "191830L SEP" });
            await wrapper.find("select").setValue("between");
            await wrapper.setProps({ values: { datetime: "191830L SEP" } });
            expect(wrapper.find("select").element.value).toBe("between");
        });

        it("forgets the chosen mode when the form changes, since the fields are different", async () => {
            const wrapper = mountFields([WHEN], { datetime: "191830L SEP" });
            await wrapper.find("select").setValue("approx");
            await wrapper.setProps({ fields: [{ ...WHEN, id: "other" }] });
            expect(wrapper.find("select").element.value).toBe("exact");
        });

        it("honours the operator's zone", async () => {
            OperatorSettings.setDtgZone("zulu");
            const wrapper = mountFields([WHEN]);
            await wrapper.findAll("button").find((b) => b.text() === "Now").trigger("click");
            expect(lastEmitted(wrapper, "datetime")).toMatch(/Z [A-Z]{3}$/);
            OperatorSettings.setDtgZone("local");
        });

    });

    describe("the position button", () => {

        const positionButton = (wrapper) => wrapper.findAll("button").find((b) => /GPS/.test(b.text()));

        it("only appears on fields that ask for one", () => {
            const wrapper = mountFields([TEXT, PLAIN]);
            // one button, for the location field, not for the free text one
            expect(wrapper.findAll("button").filter((b) => /GPS/.test(b.text()))).toHaveLength(1);
        });

        it("is offered once the fix is known to be live", () => {
            const wrapper = mountFields([TEXT]);
            expect(positionButton(wrapper).attributes("disabled")).toBeUndefined();
            expect(positionButton(wrapper).text()).toBe("GPS");
        });

        it("is not offered while the radio is still being checked", () => {
            GlobalState.gpsStatus = "checking";
            const wrapper = mountFields([TEXT]);
            expect(positionButton(wrapper).attributes("disabled")).toBeDefined();
            expect(wrapper.text()).toMatch(/Checking whether the radio has a live GPS fix/);
        });

        it("invites another try when no live fix was confirmed", () => {
            GlobalState.gpsStatus = "unconfirmed";
            const wrapper = mountFields([TEXT]);
            // a receiver that had no fix on connect may well have one now, so this
            // must not be a dead control for the rest of the session
            expect(positionButton(wrapper).attributes("disabled")).toBeUndefined();
            expect(positionButton(wrapper).text()).toBe("Check GPS");
        });

        it("writes the position into the field", async () => {
            vi.spyOn(Connection, "getPosition").mockResolvedValue({ latitude: 31.926942, longitude: -106.400044 });
            const wrapper = mountFields([TEXT]);
            await positionButton(wrapper).trigger("click");
            await wrapper.vm.$nextTick();
            expect(lastEmitted(wrapper, "location")).toBe("31.9269, -106.4000");
        });

        it("asks the radio again rather than reusing what it said on connect", async () => {
            const get = vi.spyOn(Connection, "getPosition").mockResolvedValue({ latitude: 1, longitude: 2 });
            const wrapper = mountFields([TEXT]);
            await positionButton(wrapper).trigger("click");
            await wrapper.vm.$nextTick();
            // a station that has moved must not report where it started
            expect(get).toHaveBeenCalled();
        });

        it("writes nothing when the radio has no position", async () => {
            vi.spyOn(Connection, "getPosition").mockResolvedValue(null);
            const wrapper = mountFields([TEXT]);
            await positionButton(wrapper).trigger("click");
            await wrapper.vm.$nextTick();
            // zero, zero formats perfectly well and points at the Gulf of Guinea
            expect(lastEmitted(wrapper, "location")).toBe(null);
            expect(wrapper.text()).toMatch(/no position set/i);
        });

        it("says so when the radio does not answer", async () => {
            vi.spyOn(Connection, "getPosition").mockRejectedValue(new Error("nope"));
            const wrapper = mountFields([TEXT]);
            await positionButton(wrapper).trigger("click");
            await wrapper.vm.$nextTick();
            expect(lastEmitted(wrapper, "location")).toBe(null);
            expect(wrapper.text()).toMatch(/did not answer/i);
        });

        it("probes again before filling when the fix was unconfirmed", async () => {
            GlobalState.gpsStatus = "unconfirmed";
            const probe = vi.spyOn(Connection, "probeForLiveGps").mockImplementation(async () => {
                GlobalState.gpsStatus = "live";
            });
            vi.spyOn(Connection, "getPosition").mockResolvedValue({ latitude: 31.9, longitude: -106.4 });

            const wrapper = mountFields([TEXT]);
            await positionButton(wrapper).trigger("click");
            await wrapper.vm.$nextTick();

            expect(probe).toHaveBeenCalled();
            expect(lastEmitted(wrapper, "location")).toBe("31.9000, -106.4000");
        });

        it("fills nothing if the second probe still cannot confirm a fix", async () => {
            GlobalState.gpsStatus = "unconfirmed";
            vi.spyOn(Connection, "probeForLiveGps").mockResolvedValue(undefined);
            const get = vi.spyOn(Connection, "getPosition");

            const wrapper = mountFields([TEXT]);
            await positionButton(wrapper).trigger("click");
            await wrapper.vm.$nextTick();

            expect(get).not.toHaveBeenCalled();
            expect(lastEmitted(wrapper, "location")).toBe(null);
            expect(wrapper.text()).toMatch(/Still no live GPS fix/);
        });

    });

});
