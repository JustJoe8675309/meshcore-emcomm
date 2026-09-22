// Decoding and formatting the position the radio reports.
//
// The dangerous case here is not a wrong format, it is a plausible looking wrong
// position. A device with nothing set reports 0, 0, which formats perfectly well
// and points at the Gulf of Guinea, so it has to be rejected rather than written
// into a report.

import Position from "../src/js/reports/Position.js";
import ReportForms from "../src/js/reports/ReportForms.js";

let failures = 0;
function check(name, condition, detail = "") {
    if (condition) console.log(`  PASS  ${name}`);
    else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}

console.log("=== decoding what the device sends ===");
{
    // Las Cruces, as the device would hold it: millionths of a degree
    const p = Position.fromDevice(32312345, -106765432);
    check("a real position decodes to degrees",
        p !== null && Math.abs(p.latitude - 32.312345) < 1e-9 && Math.abs(p.longitude - -106.765432) < 1e-9,
        JSON.stringify(p));

    check("southern and eastern hemispheres decode",
        (() => { const q = Position.fromDevice(-33868800, 151209300);
                 return q !== null && q.latitude < 0 && q.longitude > 0; })());
}

console.log("\n=== positions that must be refused ===");
{
    check("unset, both exactly zero, is refused", Position.fromDevice(0, 0) === null);

    // these are genuine positions and must survive, even though one axis is zero
    check("a real position on the equator is kept", Position.fromDevice(0, -106765432) !== null);
    check("a real position on the prime meridian is kept", Position.fromDevice(32312345, 0) !== null);

    check("latitude past the pole is refused", Position.fromDevice(91000000, 0) === null);
    check("longitude past the antimeridian is refused", Position.fromDevice(0, 181000000) === null);

    for (const bad of [null, undefined, NaN, Infinity, "32.3", {}]) {
        check(`${JSON.stringify(bad) ?? String(bad)} is refused`, Position.fromDevice(bad, bad) === null);
    }
}

console.log("\n=== formatting ===");
{
    check("formats to four decimal places",
        Position.format(32.312345, -106.765432) === "32.3123, -106.7654",
        Position.format(32.312345, -106.765432));

    check("rounds rather than truncates",
        Position.format(32.31239, -106.76546) === "32.3124, -106.7655",
        Position.format(32.31239, -106.76546));

    check("keeps trailing zeros so the precision is not misread",
        Position.format(32.1, -106.5) === "32.1000, -106.5000",
        Position.format(32.1, -106.5));

    // the whole point is that it costs little enough to put in a report
    const bytes = new TextEncoder().encode(Position.format(-33.868800, 151.209300)).length;
    check(`a southern hemisphere position costs ${bytes} bytes`, bytes <= 21, `got ${bytes}`);

    check("formatFromDevice refuses an unset position", Position.formatFromDevice(0, 0) === null);
    check("formatFromDevice formats a real one",
        Position.formatFromDevice(32312345, -106765432) === "32.3123, -106.7654");
}

console.log("\n=== the fields that offer the button ===");
{
    const offering = [];
    for (const form of ReportForms) {
        for (const field of form.fields) {
            if (!field.offersPosition) continue;
            offering.push(`${form.id}.${field.id}`);
            // the button writes plain text into the field, so anything else would not take it
            check(`${form.id}.${field.id} is a text field`, field.type === "text", `is ${field.type}`);
        }
    }
    check(`${offering.length} fields offer a position`, offering.length === 10, offering.join(", "));

    // a form that reports an observation somewhere needs to be able to say where
    for (const id of ["medevac", "damage", "skywarn", "salute", "position", "checkin", "sitrep", "fivews"]) {
        const form = ReportForms.find((f) => f.id === id);
        check(`${id} offers a position somewhere`, form.fields.some((f) => f.offersPosition));
    }
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
