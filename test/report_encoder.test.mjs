import ReportEncoder from "../src/js/reports/ReportEncoder.js";
import ReportForms from "../src/js/reports/ReportForms.js";

const MAX_TEXT_LEN = 160;
const enc = (s) => new TextEncoder().encode(s).length;

let failures = 0;
function check(name, condition, detail = "") {
    if (condition) {
        console.log(`  PASS  ${name}`);
    } else {
        failures++;
        console.log(`  FAIL  ${name} ${detail}`);
    }
}

// simulates exactly what BaseChatMesh::sendGroupMessage does, to confirm nothing is truncated
function firmwareWouldTruncate(nodeName, text) {
    const prefixLen = enc(`${nodeName}: `);
    return enc(text) + prefixLen > MAX_TEXT_LEN;
}

console.log("=== 1. every form, realistic data, nothing truncated by firmware ===");
const sampleValues = {
    ics213: {
        to: "J. Smith, Ops Chief", from: "R. Jones, Net Control", subject: "Shelter status",
        datetime: "191830L SEP",
        message: "Shelter 3 at capacity 40 of 40. Requesting overflow site activation and additional cots. Power on generator, fuel 6 hours remaining.",
        approved_by: "K7ABC",
    },
    checkin: {
        callsign: "K7ABC", name: "Pat", location: "DM43", station_type: "PORTABLE",
        power: "BATTERY", traffic: "NO", comments: "",
    },
    sitrep: {
        datetime: "191830L SEP", location: "Shelter 3, Main St",
        conditions: "Power out, road passable, 40 evacuees", casualties: "NONE",
        needs: "Water, cots x20", next_report: "2100L",
    },
    ics213rr: {
        item: "Portable generator 5kW", qty: "2", needed_by: "1200L 20 SEP",
        deliver_to: "Staging Area B", priority: "IMMEDIATE", requested_by: "K7ABC",
    },
    checkout: {
        callsign: "K7ABC", datetime: "191830L SEP", location: "Station 12",
        comments: "Returning to service 0600",
    },
    netsummary: {
        net: "DAC ARES Evening Net", datetime: "191830L SEP", control: "K7ABC",
        checkins: "14", traffic: "3", next_net: "1900L tomorrow",
    },
    welfare: {
        type: "REPLY", name: "J. Smith", address: "42 Main St, Las Cruces",
        status: "SAFE", contact: "sister, M. Smith",
        message: "Sheltering with family, no injuries, phone out.",
    },
    shelter: {
        name: "Lincoln Middle School", datetime: "191830L SEP", status: "OPEN",
        population: "40", capacity: "120", needs: "Cots x20, infant formula",
    },
    damage: {
        datetime: "191830L SEP", location: "1400 blk Alameda", type: "STRUCTURE",
        severity: "MAJOR", casualties: "NONE",
        description: "Roof partially collapsed, building evacuated.",
    },
    route: {
        datetime: "191830L SEP", route: "US-70", segment: "MM 12 to MM 18",
        status: "CLOSED", cause: "Debris flow", detour: "North via Ridge St",
    },
    skywarn: {
        spotter: "K7ABC", datetime: "191830L SEP", location: "3 mi NW of Anthony",
        event: "HAIL", measurement: "1.00 in", direction: "NE",
        description: "Quarter sized hail, brief, no wind damage observed.",
    },
    salute: {
        size: "6 people, 2 vehicles", activity: "Clearing debris from roadway",
        location: "1400 blk Alameda", unit: "County road crew",
        datetime: "191830L SEP", equipment: "1 backhoe, 1 dump truck",
    },
    netopen: {
        net: "DAC ARES Emergency Net", datetime: "191830L SEP", control: "K7ABC",
        type: "DIRECTED", purpose: "Flooding, Dona Ana County",
        checkin: "By callsign when called",
    },
    comms: {
        datetime: "191830L SEP", system: "W5XYZ 146.940", type: "REPEATER",
        status: "DOWN", location: "Tortugas Mtn", restore: "Unknown",
        comments: "Mains lost, no generator",
    },
    position: {
        callsign: "K7ABC", datetime: "191830L SEP", location: "DM62nr",
        station_type: "MOBILE", status: "OPERATIONAL", power: "BATTERY",
        destination: "Lincoln MS shelter",
    },
    radiogram: {
        number: "41", precedence: "R", handling: "", station: "K7ABC", check: "12",
        place: "LAS CRUCES NM", datetime: "191830L SEP",
        addressee: "M SMITH, 42 MAIN ST, LAS CRUCES NM 88001",
        text: "ARRIVED SAFELY X ALL WELL HERE X PLEASE ADVISE FAMILY X NO NEED TO WORRY",
        signature: "JOE",
    },
    medevac: {
        line1: "DM62nr, soccer field E of Lincoln MS", line2: "146.520 K7ABC",
        line3: "1 URGENT", line4: "NONE", line5: "1 LITTER",
        line6: "Fall from roof, head injury, conscious", line7: "SMOKE",
        line8: "1 CIVILIAN", line9: "Open field, power lines N side",
    },
    ics213reply: {
        to: "J. Smith, Ops Chief", from: "KJ5HBN", ref: "Shelter status, 221830L",
        datetime: "221845L SEP", reply: "Ridge St shelter is open, 40 of 120, needs 20 cots",
        by: "R. Jones, Shelter Manager",
    },
    aidstation: {
        station: "Aid 4, mile 12", datetime: "221030L SEP", status: "OPEN",
        through: "143", onhand: "6", water: "LOW", medical: "MINOR",
        needs: "Ice, 10 cases water",
    },
    participant: {
        bib: "1423", datetime: "221042L SEP", status: "TRANSPORTED",
        location: "Aid 4, mile 12", name: "R. Jones", destination: "Finish by SAG 2",
        comments: "Heat, declined ambulance",
    },
    sag: {
        datetime: "221050L SEP", location: "Mile 14, west side", count: "2",
        need: "RIDE + BIKE", priority: "PRIORITY", bib: "1423",
        comments: "In shade at the bridge",
    },
    sweep: {
        datetime: "221130L SEP", point: "Mile 12, Aid 4", status: "COURSE CLEAR BEHIND ME",
        bib: "1512", comments: "Two walkers ahead of sweep",
    },
    winterwx: {
        spotter: "K7ABC/1234", datetime: "221500L DEC", location: "3 mi NW of Cloudcroft",
        newsnow: "3.0 in since 1200L", total: "7.5 in", ice: "0.25 in on branches",
        visibility: "1/4 mi, blowing snow", comments: "Measured on a board, drifting to 2 ft",
    },
    flood: {
        spotter: "K7ABC/1234", datetime: "221615L SEP", location: "Ridge Rd at Salt Creek",
        what: "WATER OVER ROAD", depth: "18 in over the roadway", trend: "RISING",
        closed: "NO", comments: "No barricades up, two cars turned around",
    },
    fivews: {
        from: "KJ5HBN Net Control", datetime: "221830L SEP", who: "Team 2 (KJ5ABC, KF5XYZ)",
        what: "Check the shelter at Ridge Street school, report capacity and needs",
        when: "221900L-222100L SEP", where: "31.92702, -106.40012 (13R CR 67640 33201)",
        why: "EOC needs shelter status before the 2200 briefing", ack: "yes",
    },
    opord: {
        number: "01-26", datetime: "221800L SEP",
        hazards: "Flash flooding along the Rio Grande, Doniphan Dr closed",
        mission: "ARES teams provide shelter and road status comms in the north sector from 221900L SEP until relieved, so the EOC can route evacuees",
        tasks: "Team 1 shelter comms at Ridge St. Team 2 road status N sector",
        signal: "Emcomm Testing channel, check in on the hour",
    },
};

const nodeName = "K7ABC";
for (const form of ReportForms) {
    const result = ReportEncoder.prepare(form, sampleValues[form.id], nodeName);
    const parts = result.parts;
    const allFit = parts !== null && parts.every((p) => !firmwareWouldTruncate(nodeName, p));
    const maxPart = parts === null ? -1 : Math.max(...parts.map((p) => enc(p) + enc(`${nodeName}: `)));
    check(`${form.id}: ${parts?.length} part(s), max on-air ${maxPart}/${MAX_TEXT_LEN} bytes`, allFit);
    check(`${form.id}: no missing required fields`, result.missingRequiredFields.length === 0,
        JSON.stringify(result.missingRequiredFields));
}

console.log("\n=== 2. long ICS-213 splits correctly and reassembles ===");
const longMessage = "All stations be advised the primary route via Canyon Road is now impassable due to debris flow at mile marker 14. Use the northern bypass through Ridge Street. Estimated additional transit time is 25 minutes. Heavy equipment has been requested and is expected on scene within 2 hours. Do not attempt the crossing on foot under any circumstances.";
const longValues = { ...sampleValues.ics213, message: longMessage };
const ics213 = ReportForms.find((f) => f.id === "ics213");
const longResult = ReportEncoder.prepare(ics213, longValues, nodeName);

check(`splits into ${longResult.parts.length} parts`, longResult.parts.length > 1);
check("every part fits on air", longResult.parts.every((p) => !firmwareWouldTruncate(nodeName, p)),
    longResult.parts.map((p) => enc(p) + enc(`${nodeName}: `)).join(","));
check("parts are numbered [n/m]", longResult.parts.every((p, i) =>
    p.startsWith(`[${i + 1}/${longResult.parts.length}] `)));

const reassembled = longResult.parts.map((p) => p.replace(/^\[\d+\/\d+\] /, "")).join(" ");
const normalise = (s) => s.replace(/\s+/g, " ").trim();
check("reassembles to the original text (whitespace normalised)",
    normalise(reassembled) === normalise(longResult.text));

console.log("\n  --- what actually goes over the air ---");
longResult.parts.forEach((p) => console.log(`  [${String(enc(p) + enc(`${nodeName}: `)).padStart(3)}b] ${nodeName}: ${p.replace(/\n/g, "\\n")}`));

console.log("\n=== 3. edge cases ===");

// exact boundary
const budget = ReportEncoder.getChannelTextBudget(nodeName);
check(`budget for "${nodeName}" is ${budget} bytes (160 - 7)`, budget === 153);
const exact = "x".repeat(budget);
const exactParts = ReportEncoder.splitIntoParts(exact, budget);
check("text exactly at budget stays one part, no marker", exactParts.length === 1 && exactParts[0] === exact);

const overByOne = "x".repeat(budget + 1);
const overParts = ReportEncoder.splitIntoParts(overByOne, budget);
check("one byte over budget splits into 2 parts", overParts.length === 2,
    `got ${overParts.length}`);
check("both parts fit", overParts.every((p) => enc(p) <= budget));

// multi byte characters must never be cut in half
const multibyte = "é".repeat(200);
const mbParts = ReportEncoder.splitIntoParts(multibyte, budget);
const stripMarkers = (parts) => parts.map((p) => p.replace(/^\[\d+\/\d+\] /, "")).join("");
check("multi byte text splits without corruption",
    mbParts.every((p) => enc(p) <= budget) && stripMarkers(mbParts) === multibyte,
    `${mbParts.length} parts, rejoined ${stripMarkers(mbParts).length} of ${multibyte.length} chars`);

// emoji (surrogate pairs) must stay intact
const emoji = "🚨".repeat(100);
const emojiParts = ReportEncoder.splitIntoParts(emoji, budget);
check("surrogate pairs stay intact",
    emojiParts.every((p) => enc(p) <= budget) && stripMarkers(emojiParts) === emoji,
    `${emojiParts.length} parts, rejoined ${stripMarkers(emojiParts).length} of ${emoji.length} chars`);

// a very long node name shrinks the budget
const longNode = "VERY-LONG-STATION-NAME-FOR-TESTING";
const longNodeBudget = ReportEncoder.getChannelTextBudget(longNode);
const longNodeParts = ReportEncoder.splitIntoParts(longMessage, longNodeBudget);
check(`long node name (budget ${longNodeBudget}) still fits on air`,
    longNodeParts.every((p) => !firmwareWouldTruncate(longNode, p)),
    longNodeParts.map((p) => enc(p) + enc(`${longNode}: `)).join(","));

// crossing into 2 digit part counts, where the marker gets wider
const huge = "word ".repeat(700);
const hugeParts = ReportEncoder.splitIntoParts(huge, budget);
check(`10+ part message: ${hugeParts.length} parts, wider markers still fit`,
    hugeParts.every((p) => enc(p) <= budget),
    `max ${Math.max(...hugeParts.map((p) => enc(p)))}`);

// empty and degenerate input
check("empty text returns no parts", ReportEncoder.splitIntoParts("", budget).length === 0);
// a budget too small to hold even a part marker is unsendable, the UI reports this
check("unsendably small budget returns null rather than hanging", ReportEncoder.splitIntoParts("hello world", 1) === null);

console.log("\n=== 4. destination budgets ===");
{
    // channel messages carry a "<sender name>: " prefix inside the 160 byte limit
    const channelBudget = ReportEncoder.getTextBudget("channel", "Joe-KJ5HBN-HTv3");
    check("channel budget is 143 for a 15 char node name", channelBudget === 143, `got ${channelBudget}`);

    // direct messages carry no prefix, so the whole limit is available
    const contactBudget = ReportEncoder.getTextBudget("contact", "Joe-KJ5HBN-HTv3");
    check("contact budget is the full 160, independent of node name", contactBudget === 160, `got ${contactBudget}`);
    check("contact budget ignores a very long node name",
        ReportEncoder.getTextBudget("contact", "A".repeat(60)) === 160);
}

console.log("\n=== 5. a large body splits into as many parts as needed ===");
{
    const node = "Joe-KJ5HBN-HTv3";

    for (const destination of ["channel", "contact"]) {

        const budget = ReportEncoder.getTextBudget(destination, node);
        const overhead = destination === "channel" ? enc(`${node}: `) : 0;
        let previousPartCount = 0;
        const observed = [];

        for (const bodyLength of [100, 500, 1000, 2000, 5000, 10000]) {

            // a realistic body of words, so it splits on whitespace like real traffic
            const body = "situation ".repeat(Math.ceil(bodyLength / 10)).slice(0, bodyLength).trim();
            const values = { ...sampleValues.ics213, message: body };
            const result = ReportEncoder.prepare(ics213, values, node, destination);
            const parts = result.parts;

            const allFit = parts !== null && parts.every((p) => enc(p) <= budget);
            const onAirOk = parts !== null && parts.every((p) => enc(p) + overhead <= MAX_TEXT_LEN);
            const grew = parts !== null && parts.length >= previousPartCount;
            const numbered = parts !== null && (parts.length === 1 || parts.every((p, i) => p.startsWith(`[${i + 1}/${parts.length}] `)));

            // strip markers and rejoin, whitespace normalised, to confirm nothing was dropped
            const rejoined = parts === null ? "" : parts.map((p) => p.replace(/^\[\d+\/\d+\] /, "")).join(" ");
            const norm = (x) => x.replace(/\s+/g, " ").trim();
            const intact = norm(rejoined) === norm(result.text);

            const maxOnAir = parts === null ? -1 : Math.max(...parts.map((p) => enc(p) + overhead));
            check(`${destination}: ${String(bodyLength).padStart(5)} char body -> ${String(parts?.length).padStart(3)} part(s), max ${maxOnAir}b on air`,
                allFit && onAirOk && grew && numbered && intact,
                `fit=${allFit} onAir=${onAirOk} grew=${grew} numbered=${numbered} intact=${intact}`);

            observed.push(parts === null ? 0 : parts.length);
            previousPartCount = parts === null ? 0 : parts.length;

        }

        check(`${destination}: part count scales with body size (${observed.join(" -> ")})`,
            observed[observed.length - 1] > observed[0] * 10);

    }
}

console.log("\n=== 6. very large bodies ===");
{
    const budget = ReportEncoder.getTextBudget("contact", "n");

    const big = "word ".repeat(2000);
    const parts = ReportEncoder.splitIntoParts(big, budget);
    check(`10000 byte body splits into ${parts?.length} parts, all within budget`,
        parts !== null && parts.every((p) => enc(p) <= budget),
        parts === null ? "returned null" : `max ${Math.max(...parts.map(enc))}`);

    // splitIntoParts tries part counts up to 99, beyond that it reports failure
    const enormous = "word ".repeat(20000);
    const tooBig = ReportEncoder.splitIntoParts(enormous, budget);
    check("a body too large for 99 parts returns null rather than dropping content",
        tooBig === null, tooBig === null ? "" : `got ${tooBig.length} parts`);
}

console.log("\n=== 7. parts break between fields, not mid field ===");
{
    // a receiving operator copying part 2 onto a paper form should see whole fields,
    // so a part may only start mid line when a single field is too long to fit alone
    const budget = ReportEncoder.getTextBudget("channel", "Joe-KJ5HBN-HTv3");

    for (const id of ["radiogram", "medevac", "netopen", "welfare", "salute", "skywarn"]) {
        const form = ReportForms.find((f) => f.id === id);
        const result = ReportEncoder.prepare(form, sampleValues[id], "Joe-KJ5HBN-HTv3");
        const parts = result.parts.map((part) => part.replace(/^\[\d+\/\d+\] /, ""));
        if (parts.length === 1) continue;

        // every line of every part, except where a long field forced a mid line break,
        // should be a whole "TAG: value" line or the form header
        const startsCleanly = parts.every((part, i) => {
            if (i === 0) return part.startsWith(form.header);
            const firstLine = part.split("\n")[0];
            return form.fields.some((f) => firstLine.startsWith(`${f.tag}: `));
        });
        check(`${id}: every part starts on a field boundary`, startsCleanly,
            JSON.stringify(parts.map((p) => p.split("\n")[0])));
    }

    // a field too long for one part still has to break mid line, and must stay word safe
    const ics213 = ReportForms.find((f) => f.id === "ics213");
    const long = ReportEncoder.prepare(ics213, {
        ...sampleValues.ics213,
        message: "All stations be advised the primary route via Canyon Road is now impassable due to debris flow at mile marker 14. Use the northern bypass through Ridge Street. Estimated additional transit time is 25 minutes.",
    }, "Joe-KJ5HBN-HTv3");
    const longParts = long.parts.map((part) => part.replace(/^\[\d+\/\d+\] /, ""));
    check("a field too long for one part still breaks mid line", longParts.length >= 3);
    check("the preamble fields are not broken up", longParts[0].split("\n").length === 5,
        JSON.stringify(longParts[0]));
    check("the long field starts its own part", longParts[1].startsWith("MSG: "),
        JSON.stringify(longParts[1].slice(0, 30)));
    check("no part exceeds the budget", longParts.every((_, i) => enc(long.parts[i]) <= budget));
    // nothing lost and no word cut in half
    const rejoined = longParts.join(" ").replace(/\s+/g, " ").trim();
    check("mid line break keeps every word intact",
        rejoined === long.text.replace(/\s+/g, " ").trim());
}

console.log("\n=== 8. a single field too large for one message still splits ===");
{
    // packing whole lines is only the preference. a field bigger than a part has to
    // break mid line however long it is, and must still reach the air complete
    const node = "Joe-KJ5HBN-HTv3";
    const budget = ReportEncoder.getTextBudget("channel", node);
    const ics213 = ReportForms.find((f) => f.id === "ics213");

    // the sequence of non whitespace characters is the invariant. comparing whitespace
    // normalised would fail wherever a break fell mid word, since rejoining the parts
    // inserts a space that was never in the original
    const strip = (x) => Array.from(x).filter((c) => !/\s/.test(c)).join("");

    const cases = [
        ["ordinary words, 400 chars", "word ".repeat(80).trim()],
        ["ordinary words, 2000 chars", "situation report detail ".repeat(84).slice(0, 2000).trim()],
        ["no whitespace at all, 600 chars", "A".repeat(600)],
        ["one 500 char word among normal text", "start " + "B".repeat(500) + " end"],
        ["300 emoji, 4 bytes each", "\u{1F525}".repeat(300)],
        ["800 accented characters", "\u00e9".repeat(800)],
    ];

    for (const [name, message] of cases) {
        const result = ReportEncoder.prepare(ics213, {
            to: "Ops", from: "KJ5HBN", subject: "Test", datetime: "191930L SEP", message,
        }, node, "channel");
        const parts = result.parts;

        const problems = [];
        if (parts === null) problems.push("refused to split");
        else {
            if (parts.length < 2) problems.push("did not split at all");
            const tooBig = parts.filter((part) => enc(part) > budget);
            if (tooBig.length) problems.push(`${tooBig.length} part(s) over the ${budget} byte budget`);
            if (!parts.every((p, i) => p.startsWith(`[${i + 1}/${parts.length}] `))) problems.push("parts not numbered");
            const rejoined = parts.map((part) => part.replace(/^\[\d+\/\d+\] /, "")).join("");
            if (strip(rejoined) !== strip(result.text)) problems.push("content lost or reordered");
        }

        check(`${name}: ${result.textBytes} b -> ${parts === null ? "null" : parts.length + " parts"}, nothing lost`,
            problems.length === 0, problems.join(" | "));
    }

    // and it refuses rather than silently dropping content once 99 parts is not enough
    const enormous = ReportEncoder.prepare(ics213, {
        to: "Ops", from: "KJ5HBN", subject: "Test", datetime: "191930L SEP",
        message: "detail ".repeat(3000),
    }, node, "channel");
    check("a field too large even for 99 parts is refused, not truncated", enormous.parts === null,
        enormous.parts === null ? "" : `got ${enormous.parts.length} parts`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
