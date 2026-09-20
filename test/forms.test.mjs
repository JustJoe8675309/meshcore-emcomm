// Structural checks on the form catalogue.
// Forms are data, so the things that go wrong are data mistakes: a duplicated tag,
// a select with no options, a field type the renderer does not handle. None of that
// is a syntax error, so nothing else would catch it.

import ReportForms from "../src/js/reports/ReportForms.js";
import ReportEncoder from "../src/js/reports/ReportEncoder.js";

const FIELD_TYPES = ["text", "textarea", "select", "dtg"];
const PREFILL_FLAGS = ["prefillFromCallsign", "prefillFromSpotterId"];
// every key a field is allowed to carry. a flag nothing reads does nothing, silently,
// so an unknown key is treated as a mistake rather than ignored
const FIELD_KEYS = ["id", "tag", "label", "type", "placeholder", "required", "options",
    "offersPosition", ...PREFILL_FLAGS];

let failures = 0;
function check(name, condition, detail = "") {
    if (condition) console.log(`  PASS  ${name}`);
    else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}

console.log("=== catalogue ===");
check(`${ReportForms.length} forms defined`, ReportForms.length === 17, `got ${ReportForms.length}`);

const dupes = (values) => values.filter((v, i) => values.indexOf(v) !== i);
check("form ids are unique", dupes(ReportForms.map((f) => f.id)).length === 0, dupes(ReportForms.map((f) => f.id)).join(","));
check("form names are unique", dupes(ReportForms.map((f) => f.name)).length === 0, dupes(ReportForms.map((f) => f.name)).join(","));
check("on air headers are unique", dupes(ReportForms.map((f) => f.header)).length === 0, dupes(ReportForms.map((f) => f.header)).join(","));

console.log("\n=== each form ===");
for (const form of ReportForms) {

    const problems = [];

    if (!form.id) problems.push("no id");
    if (!form.name) problems.push("no name");
    if (!form.description) problems.push("no description");
    if (!form.header) problems.push("no header");
    if (!Array.isArray(form.fields) || form.fields.length === 0) problems.push("no fields");

    const ids = (form.fields ?? []).map((f) => f.id);
    const tags = (form.fields ?? []).map((f) => f.tag);
    if (dupes(ids).length) problems.push("duplicate field ids: " + dupes(ids).join(","));
    if (dupes(tags).length) problems.push("duplicate tags: " + dupes(tags).join(","));

    for (const field of form.fields ?? []) {
        if (!field.id) problems.push("a field has no id");
        if (!field.tag) problems.push(`${field.id}: no tag`);
        if (!field.label) problems.push(`${field.id}: no label`);
        if (!FIELD_TYPES.includes(field.type)) problems.push(`${field.id}: unknown type ${field.type}`);
        if (field.type === "select" && !(field.options ?? []).length) problems.push(`${field.id}: select with no options`);
        if (field.type !== "select" && field.options) problems.push(`${field.id}: options on a non select`);
        // a flag the panel does not know about would silently do nothing
        for (const key of Object.keys(field)) {
            if (!FIELD_KEYS.includes(key)) problems.push(`${field.id}: unknown key ${key}`);
        }
    }

    // an operator has to be able to tell when a form is incomplete
    if (!(form.fields ?? []).some((f) => f.required)) problems.push("no required fields");

    check(`${form.id.padEnd(11)} ${String((form.fields ?? []).length).padStart(2)} fields, header ${form.header}`,
        problems.length === 0, problems.join(" | "));

}

console.log("\n=== every form renders and encodes ===");
for (const form of ReportForms) {
    let ok = true, detail = "";
    try {
        // empty, which is the state a form is in the moment it is selected
        const empty = ReportEncoder.prepare(form, {}, "Joe-KJ5HBN-HTv3", "channel");
        if (empty.text !== form.header) { ok = false; detail = `empty form should render just the header, got ${JSON.stringify(empty.text)}`; }
        if (empty.missingRequiredFields.length === 0) { ok = false; detail += " empty form reports nothing missing"; }

        // fully populated, so every field renders
        const full = {};
        for (const field of form.fields) {
            full[field.id] = field.type === "select" ? field.options[0] : `x`;
        }
        const filled = ReportEncoder.prepare(form, full, "Joe-KJ5HBN-HTv3", "channel");
        if (filled.missingRequiredFields.length !== 0) { ok = false; detail += " filled form still reports missing fields"; }
        if (filled.parts === null) { ok = false; detail += " filled form could not be split"; }
        for (const field of form.fields) {
            if (!filled.text.includes(`${field.tag}: `)) { ok = false; detail += ` missing tag ${field.tag}`; }
        }
    } catch (e) {
        ok = false; detail = e.message;
    }
    check(`${form.id} renders empty and full`, ok, detail);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
