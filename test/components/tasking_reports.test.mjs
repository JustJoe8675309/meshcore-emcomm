// The two tasking forms: the 5Ws Briefing and the five paragraph OPORD.
//
// What is new about them rather than the forms before: a blank field is sent as
// "TAG: -" so the receiver sees it was left empty on purpose, a tick box sends
// ACK REQ alone on its line, and the WHERE button fills in degrees and MGRS,
// using a stored position marked last known when there is no live GPS fix.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ReportForms from "../../src/js/reports/ReportForms.js";
import ReportEncoder from "../../src/js/reports/ReportEncoder.js";
import ReportFormFields from "../../src/components/reports/ReportFormFields.vue";
import GlobalState from "../../src/js/GlobalState.js";
import Connection from "../../src/js/Connection.js";

const fiveWs = ReportForms.find((f) => f.id === "fivews");
const opord = ReportForms.find((f) => f.id === "opord");

function lastEmitted(wrapper, fieldId) {
    const events = (wrapper.emitted("input") ?? []).filter((e) => e[0] === fieldId);
    return events.length ? events[events.length - 1][1] : null;
}

describe("the 5Ws Briefing", () => {

    const filled = {
        from: "KJ5HBN Net Control", datetime: "221830L SEP", who: "Team 2",
        what: "Check the shelter", when: "221900L SEP", where: "North gate, Ridge Street school", why: "EOC needs status",
    };

    it("numbers the five W's, 1 to 5, under FM and DTG", () => {
        const text = ReportEncoder.renderReport(fiveWs, filled);
        expect(text.split("\n")).toEqual([
            "5WS BRIEFING",
            "FM: KJ5HBN Net Control",
            "DTG: 221830L SEP",
            "1 WHO: Team 2",
            "2 WHAT: Check the shelter",
            "3 WHEN: 221900L SEP",
            "4 WHERE: North gate, Ridge Street school",
            "5 WHY: EOC needs status",
        ]);
    });

    it("ends with ACK REQ, alone on its line, only when the box is ticked", () => {
        expect(ReportEncoder.renderReport(fiveWs, { ...filled, ack: "yes" }).endsWith("\n5 WHY: EOC needs status\nACK REQ")).toBe(true);
        expect(ReportEncoder.renderReport(fiveWs, { ...filled, ack: "" })).not.toContain("ACK");
    });

    it("needs every W, and FM and DTG, but not the acknowledgement", () => {
        const missing = ReportEncoder.getMissingRequiredFields(fiveWs, {});
        expect(missing).toEqual(["from", "datetime", "who", "what", "when", "where", "why"]);
    });

    it("fills FM from the operator's callsign", () => {
        expect(fiveWs.fields.find((f) => f.id === "from").prefillFromCallsign).toBe(true);
    });

});

describe("the OPORD", () => {

    it("keeps the Army paragraph numbering, with Hazards for enemy forces", () => {
        expect(opord.fields.map((f) => f.tag)).toEqual([
            "NR", "DTG", "REF",
            "1A HAZARDS", "1B FRIENDLY", "1C ATTACHED",
            "2 MISSION",
            "3A INTENT", "3B CONCEPT", "3C TASKS", "3D COORD",
            "4A SUPPLY", "4B TRANS", "4C MEDICAL",
            "5A COMMAND", "5B SIGNAL",
        ]);
    });

    it("needs only the mission", () => {
        expect(ReportEncoder.getMissingRequiredFields(opord, {})).toEqual(["mission"]);
        expect(ReportEncoder.getMissingRequiredFields(opord, { mission: "Provide shelter comms" })).toEqual([]);
    });

    it("sends every paragraph left blank as a hyphen, so none looks lost", () => {
        const text = ReportEncoder.renderReport(opord, { mission: "Provide shelter comms", signal: "Emcomm Testing" });
        const lines = text.split("\n");
        expect(lines).toHaveLength(1 + opord.fields.length);
        expect(lines).toContain("1A HAZARDS: -");
        expect(lines).toContain("2 MISSION: Provide shelter comms");
        expect(lines).toContain("4C MEDICAL: -");
        expect(lines[lines.length - 1]).toBe("5B SIGNAL: Emcomm Testing");
    });

    it("treats a field of spaces as blank too", () => {
        expect(ReportEncoder.renderReport(opord, { mission: "x", hazards: "   " })).toContain("1A HAZARDS: -");
    });

});

describe("forms that do not keep blank fields", () => {

    it("still drop them, as every form always did", () => {
        const ics213 = ReportForms.find((f) => f.id === "ics213");
        expect(ReportEncoder.renderReport(ics213, { to: "Ops" })).toBe("ICS-213\nTO: Ops");
    });

});

describe("the ACK REQ tick box", () => {

    it("is a tick box with its label beside it, reporting yes or nothing", async () => {
        const ack = fiveWs.fields.find((f) => f.id === "ack");
        const wrapper = mount(ReportFormFields, { props: { fields: [ack], values: {} } });
        const box = wrapper.find("input[type=checkbox]");
        expect(wrapper.text()).toContain("Ask them to acknowledge");
        await box.setValue(true);
        expect(lastEmitted(wrapper, "ack")).toBe("yes");
        await box.setValue(false);
        expect(lastEmitted(wrapper, "ack")).toBe("");
    });

});

describe("the WHERE button", () => {

    const where = fiveWs.fields.find((f) => f.id === "where");

    beforeEach(() => {
        vi.restoreAllMocks();
        GlobalState.connection = { on() {}, off() {} };
    });

    const positionButton = (wrapper) => wrapper.findAll("button").find((b) => /GPS/.test(b.text()));

    it("fills in degrees with the MGRS reference from a live fix, for editing", async () => {
        GlobalState.gpsStatus = "live";
        vi.spyOn(Connection, "getPosition").mockResolvedValue({ latitude: 31.92702, longitude: -106.40012 });
        const wrapper = mount(ReportFormFields, { props: { fields: [where], values: {} } });
        await positionButton(wrapper).trigger("click");
        await flushPromises();
        expect(lastEmitted(wrapper, "where")).toBe("31.9270, -106.4001 (13R CR 67640 33201)");
    });

    it("uses a stored position when there is no live fix, and says it is last known", async () => {
        GlobalState.gpsStatus = "unconfirmed";
        vi.spyOn(Connection, "probeForLiveGps").mockImplementation(async () => { GlobalState.gpsStatus = "unconfirmed"; });
        vi.spyOn(Connection, "getPosition").mockResolvedValue({ latitude: 31.92702, longitude: -106.40012 });
        const wrapper = mount(ReportFormFields, { props: { fields: [where], values: {} } });
        await positionButton(wrapper).trigger("click");
        await flushPromises();
        expect(lastEmitted(wrapper, "where")).toBe("31.9270, -106.4001 (13R CR 67640 33201) last known");
    });

    it("says so when the radio has no position at all, leaving the field for a description", async () => {
        GlobalState.gpsStatus = "unconfirmed";
        vi.spyOn(Connection, "probeForLiveGps").mockImplementation(async () => { GlobalState.gpsStatus = "unconfirmed"; });
        vi.spyOn(Connection, "getPosition").mockResolvedValue(null);
        const wrapper = mount(ReportFormFields, { props: { fields: [where], values: {} } });
        await positionButton(wrapper).trigger("click");
        await flushPromises();
        expect(lastEmitted(wrapper, "where")).toBe(null);
        // on the bench node 1 had no position: the reason is given once, not beside a hint
        expect(wrapper.text()).toContain("No live GPS fix, and the radio has no position set. Type the location, or describe it.");
        expect(wrapper.text()).not.toContain("No live GPS fix yet");
    });

    it("leaves other forms' position buttons as they were: live fixes only, degrees only", async () => {
        const location = { id: "location", tag: "LOC", label: "Location", type: "text", required: true, offersPosition: true };
        GlobalState.gpsStatus = "unconfirmed";
        vi.spyOn(Connection, "probeForLiveGps").mockImplementation(async () => { GlobalState.gpsStatus = "unconfirmed"; });
        const get = vi.spyOn(Connection, "getPosition").mockResolvedValue({ latitude: 31.92702, longitude: -106.40012 });
        const wrapper = mount(ReportFormFields, { props: { fields: [location], values: {} } });
        await positionButton(wrapper).trigger("click");
        await flushPromises();
        expect(get).not.toHaveBeenCalled();
        expect(lastEmitted(wrapper, "location")).toBe(null);
    });

});
