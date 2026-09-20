// Covers composing and reading back date time groups.
// This is the fiddly part of the qualifier feature, so it is kept as pure
// functions and tested here rather than living inside a component.

import Dtg from "../src/js/reports/Dtg.js";

const enc = (s) => new TextEncoder().encode(s).length;

let failures = 0;
function check(name, condition, detail = "") {
    if (condition) console.log(`  PASS  ${name}`);
    else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}

console.log("=== formatting ===");
{
    // 19 Sep, 17:45 local
    const d = new Date(2026, 8, 19, 17, 45, 30);
    check(`local reads ${Dtg.format(d, "local")}`, Dtg.format(d, "local") === "191745L SEP", Dtg.format(d, "local"));

    // a fixed instant, so the zulu conversion is not dependent on the test machine
    const utc = new Date(Date.UTC(2026, 8, 19, 0, 30, 0));
    check(`zulu reads ${Dtg.format(utc, "zulu")}`, Dtg.format(utc, "zulu") === "190030Z SEP", Dtg.format(utc, "zulu"));

    check("shape is recognised", Dtg.isDtgShape("191745L SEP"));
    check("zulu shape is recognised", Dtg.isDtgShape("190030Z SEP"));
    check("free text is not a dtg shape", !Dtg.isDtgShape("about tea time"));
    check("missing month is not a dtg shape", !Dtg.isDtgShape("191745L"));
}

console.log("\n=== composing ===");
{
    check("exact passes the value straight through",
        Dtg.compose("exact", "191745L SEP", "") === "191745L SEP");

    check('approximate prefixes ABT',
        Dtg.compose("approx", "191745L SEP", "") === "ABT 191745L SEP",
        Dtg.compose("approx", "191745L SEP", ""));

    check("approximate of nothing is nothing, not a bare prefix",
        Dtg.compose("approx", "", "") === "");

    const sameDay = Dtg.compose("between", "191700L SEP", "191745L SEP");
    check(`same day range compacts to ${sameDay}`, sameDay === "191700-1745L SEP", sameDay);

    const crossDay = Dtg.compose("between", "192330L SEP", "200015L SEP");
    check(`range over midnight keeps both days: ${crossDay}`, crossDay === "192330-200015L SEP", crossDay);

    // the saving is the whole point of compacting
    const verbose = "191700L SEP-191745L SEP";
    check(`compacting saves ${enc(verbose) - enc(sameDay)} bytes`, enc(sameDay) < enc(verbose),
        `${enc(sameDay)} vs ${enc(verbose)}`);
}

console.log("\n=== composing, awkward input ===");
{
    check("a half typed range degrades to the end that is filled",
        Dtg.compose("between", "191700L SEP", "") === "191700L SEP");

    check("a range with only an end uses that end",
        Dtg.compose("between", "", "191745L SEP") === "191745L SEP");

    // free text must survive rather than be refused or mangled
    const freeform = Dtg.compose("between", "first light", "dusk");
    check(`unrecognised ends join verbatim: ${freeform}`, freeform === "first light-dusk", freeform);

    const mixed = Dtg.compose("between", "191700L SEP", "sometime after");
    check(`one recognised end still joins verbatim: ${mixed}`, mixed === "191700L SEP-sometime after", mixed);

    const differentMonth = Dtg.compose("between", "302330L SEP", "010015L OCT");
    check(`a range across months is not compacted: ${differentMonth}`,
        differentMonth === "302330L SEP-010015L OCT", differentMonth);

    const differentZone = Dtg.compose("between", "191700L SEP", "191745Z SEP");
    check("a range mixing zones is not compacted", differentZone === "191700L SEP-191745Z SEP", differentZone);
}

console.log("\n=== reading back ===");
{
    const roundTrip = (mode, from, to) => {
        const composed = Dtg.compose(mode, from, to);
        const parsed = Dtg.parse(composed);
        return { composed, parsed };
    };

    const exact = roundTrip("exact", "191745L SEP", "");
    check("exact round trips", exact.parsed.mode === "exact" && exact.parsed.from === "191745L SEP",
        JSON.stringify(exact));

    const approx = roundTrip("approx", "191745L SEP", "");
    check("approximate round trips", approx.parsed.mode === "approx" && approx.parsed.from === "191745L SEP",
        JSON.stringify(approx));

    const sameDay = roundTrip("between", "191700L SEP", "191745L SEP");
    check("same day range round trips both ends",
        sameDay.parsed.mode === "between" && sameDay.parsed.from === "191700L SEP" && sameDay.parsed.to === "191745L SEP",
        JSON.stringify(sameDay));

    const crossDay = roundTrip("between", "192330L SEP", "200015L SEP");
    check("range over midnight round trips both ends",
        crossDay.parsed.mode === "between" && crossDay.parsed.from === "192330L SEP" && crossDay.parsed.to === "200015L SEP",
        JSON.stringify(crossDay));

    const freeform = roundTrip("between", "first light", "dusk");
    check("verbatim range round trips",
        freeform.parsed.mode === "between" && freeform.parsed.from === "first light" && freeform.parsed.to === "dusk",
        JSON.stringify(freeform));

    // anything we do not recognise is left alone as an exact value
    const odd = Dtg.parse("BETWEEN 1700 AND 1730 LOCAL");
    check("unparseable text is reported as exact and left intact",
        odd.mode === "exact" && odd.from === "BETWEEN 1700 AND 1730 LOCAL", JSON.stringify(odd));

    const empty = Dtg.parse("");
    check("empty parses as exact and empty", empty.mode === "exact" && empty.from === "");
}

console.log("\n=== byte cost against an exact dtg ===");
{
    const exact = Dtg.compose("exact", "191745L SEP", "");
    const rows = [
        ["exact", exact],
        ["approximate", Dtg.compose("approx", "191745L SEP", "")],
        ["between, same day", Dtg.compose("between", "191700L SEP", "191745L SEP")],
        ["between, over midnight", Dtg.compose("between", "192330L SEP", "200015L SEP")],
    ];
    for (const [label, value] of rows) {
        console.log(`  ${label.padEnd(24)} ${value.padEnd(20)} ${enc(value)} bytes (+${enc(value) - enc(exact)})`);
    }
    check("exact costs nothing extra", enc(exact) === 11, `${enc(exact)}`);
    check("approximate costs 4 more", enc(rows[1][1]) - enc(exact) === 4);
    check("same day range costs 5 more", enc(rows[2][1]) - enc(exact) === 5);
}

console.log("\n=== local unless zulu is explicitly chosen ===");
{
    // a date time group labelled Z when the net runs on local time, or the other way
    // round, is wrong in a way nobody notices until the times fail to line up. so
    // anything that is not exactly "zulu" has to fall back to local rather than
    // guessing, and there must be no way to end up with a third state
    const d = new Date(2026, 8, 19, 17, 45);

    check("the default with no zone given is local", Dtg.format(d).endsWith("L SEP"), Dtg.format(d));
    check('only the exact string "zulu" selects zulu', Dtg.format(d, "zulu").includes("Z "), Dtg.format(d, "zulu"));

    // every one of these is a plausible way for a stored or passed value to go wrong
    for (const zone of ["local", "Zulu", "ZULU", "utc", "UTC", "z", "Z", "", " zulu", "zulu ", null, undefined, 0, 1, true, false, {}, []]) {
        const formatted = Dtg.format(d, zone);
        check(`zone ${JSON.stringify(zone)} formats as local`, formatted.endsWith("L SEP"), formatted);
    }
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
