// The forms a public service event and a weather net actually use.
//
// A race net is mostly four messages: how an aid station is doing, what became
// of a participant, send a vehicle, and the course behind me is clear. The two
// weather ones carry the measurements the NWS asks for and that the general
// spotter report has nowhere to put: snow and ice depths, and whether water is
// rising or falling.

import { describe, it, expect } from "vitest";
import ReportForms from "../../src/js/reports/ReportForms.js";
import ReportEncoder from "../../src/js/reports/ReportEncoder.js";

const form = (id) => ReportForms.find((f) => f.id === id);
const render = (id, values) => ReportEncoder.renderReport(form(id), values);
const missing = (id, values) => ReportEncoder.getMissingRequiredFields(form(id), values);

describe("a race net's four messages", () => {

    it("reports an aid station's participants, supplies and medical", () => {
        const text = render("aidstation", {
            station: "Aid 4, mile 12", datetime: "221030L SEP", status: "OPEN",
            through: "143", onhand: "6", water: "LOW", medical: "MINOR", needs: "Ice, 10 cases water",
        });
        expect(text.split("\n")).toEqual([
            "AID STN",
            "STN: Aid 4, mile 12",
            "DTG: 221030L SEP",
            "STAT: OPEN",
            "THRU: 143",
            "ONSITE: 6",
            "WATER: LOW",
            "MED: MINOR",
            "NEEDS: Ice, 10 cases water",
        ]);
        expect(missing("aidstation", {})).toEqual(["station", "datetime", "status"]);
    });

    it("tracks one participant by number, and where they went", () => {
        const text = render("participant", {
            bib: "1423", datetime: "221042L SEP", status: "TRANSPORTED",
            location: "Aid 4, mile 12", destination: "Finish by SAG 2",
        });
        expect(text).toContain("BIB: 1423");
        expect(text).toContain("STAT: TRANSPORTED");
        expect(text).toContain("DEST: Finish by SAG 2");
        // the number, the time, what happened and where: the rest can wait
        expect(missing("participant", {})).toEqual(["bib", "datetime", "status", "location"]);
    });

    it("asks for a vehicle with a priority, since not every pickup is the same", () => {
        const priorities = form("sag").fields.find((f) => f.id === "priority");
        expect(priorities.options).toEqual(["ROUTINE", "PRIORITY", "URGENT"]);
        const text = render("sag", {
            datetime: "221050L SEP", location: "Mile 14, west side", count: "2",
            need: "RIDE + BIKE", priority: "PRIORITY",
        });
        expect(text).toContain("NUM: 2");
        expect(text).toContain("NEED: RIDE + BIKE");
        expect(text).toContain("PRI: PRIORITY");
    });

    it("says the course behind a station is clear, which is how it closes", () => {
        const statuses = form("sweep").fields.find((f) => f.id === "status");
        expect(statuses.options).toContain("LAST PARTICIPANT PASSED");
        expect(statuses.options).toContain("COURSE CLEAR BEHIND ME");
        const text = render("sweep", { datetime: "221130L SEP", point: "Mile 12, Aid 4", status: "COURSE CLEAR BEHIND ME" });
        expect(text.startsWith("SWEEP")).toBe(true);
        expect(text).toContain("PT: Mile 12, Aid 4");
    });

    it("fits every one of them in a single packet, which is the point", () => {
        const values = {
            aidstation: { station: "Aid 4, mile 12", datetime: "221030L SEP", status: "OPEN", through: "143", onhand: "6", water: "LOW", medical: "MINOR" },
            participant: { bib: "1423", datetime: "221042L SEP", status: "TRANSPORTED", location: "Aid 4, mile 12", destination: "Finish by SAG 2" },
            sag: { datetime: "221050L SEP", location: "Mile 14, west side", count: "2", need: "RIDE", priority: "URGENT" },
            sweep: { datetime: "221130L SEP", point: "Mile 12, Aid 4", status: "LAST PARTICIPANT PASSED", bib: "1512" },
        };
        for(const [id, filled] of Object.entries(values)){
            expect(ReportEncoder.prepare(form(id), filled, "K7ABC", "channel").parts).toHaveLength(1);
        }
    });

});

describe("the two weather reports", () => {

    it("takes the snow and ice measurements the NWS asks for", () => {
        const text = render("winterwx", {
            spotter: "K7ABC/1234", datetime: "221500L DEC", location: "3 mi NW of Cloudcroft",
            newsnow: "3.0 in since 1200L", total: "7.5 in", ice: "0.25 in on branches", visibility: "1/4 mi",
        });
        expect(text).toContain("NEW: 3.0 in since 1200L");
        expect(text).toContain("TOTAL: 7.5 in");
        expect(text).toContain("ICE: 0.25 in on branches");
        expect(text).toContain("VIS: 1/4 mi");
        // the spotter number is filled in from settings, as on the spotter report
        expect(form("winterwx").fields.find((f) => f.id === "spotter").prefillFromSpotterId).toBe(true);
    });

    it("says whether the water is rising, which is the part that is acted on", () => {
        const trend = form("flood").fields.find((f) => f.id === "trend");
        expect(trend.required).toBe(true);
        expect(trend.options).toEqual(["RISING", "STEADY", "FALLING", "UNKNOWN"]);
        const text = render("flood", {
            spotter: "K7ABC/1234", datetime: "221615L SEP", location: "Ridge Rd at Salt Creek",
            what: "WATER OVER ROAD", depth: "18 in over the roadway", trend: "RISING", closed: "NO",
        });
        expect(text).toContain("WHAT: WATER OVER ROAD");
        expect(text).toContain("DEPTH: 18 in over the roadway");
        expect(text).toContain("TREND: RISING");
        expect(text).toContain("CLSD: NO");
    });

    it("keeps the position button on both, since where is half the report", () => {
        for(const id of ["winterwx", "flood"]){
            expect(form(id).fields.find((f) => f.id === "location").offersPosition).toBe(true);
        }
    });

});

describe("answering an ICS-213", () => {

    it("quotes what it is answering, so a reply is not read on its own", () => {
        const text = render("ics213reply", {
            to: "J. Smith, Ops Chief", from: "KJ5HBN", ref: "Shelter status, 221830L",
            datetime: "221845L SEP", reply: "Ridge St shelter is open, 40 of 120", by: "R. Jones",
        });
        expect(text.split("\n")[0]).toBe("ICS-213 REPLY");
        expect(text).toContain("REF: Shelter status, 221830L");
        expect(text).toContain("REPLY: Ridge St shelter is open, 40 of 120");
        expect(missing("ics213reply", {})).toEqual(["to", "from", "ref", "datetime", "reply"]);
    });

    it("fills who it is from with the operator's callsign", () => {
        expect(form("ics213reply").fields.find((f) => f.id === "from").prefillFromCallsign).toBe(true);
    });

});

describe("the picker", () => {

    it("lists all twenty six forms, each with a name and a header", () => {
        expect(ReportForms).toHaveLength(26);
        for(const f of ReportForms){
            expect(f.name.length).toBeGreaterThan(0);
            expect(f.header.length).toBeGreaterThan(0);
        }
        // and the new ones are there under names an operator would look for
        const names = ReportForms.map((f) => f.name);
        expect(names).toContain("Aid Station / Checkpoint Status");
        expect(names).toContain("Participant Status");
        expect(names).toContain("SAG / Transport Request");
        expect(names).toContain("Course Sweep / Last Participant");
        expect(names).toContain("Winter Weather Report");
        expect(names).toContain("Flood / River Stage Report");
        expect(names).toContain("ICS-213 Reply");
    });

});
