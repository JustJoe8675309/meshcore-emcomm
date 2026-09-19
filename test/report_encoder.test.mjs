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

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
