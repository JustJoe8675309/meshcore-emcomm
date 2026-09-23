// Structural checks on the form catalogue.
// Forms are data, so the things that go wrong are data mistakes: a duplicated tag,
// a select with no options, a field type the renderer does not handle. None of that
// is a syntax error, so nothing else would catch it.

import ReportForms from "../src/js/reports/ReportForms.js";
import ReportEncoder from "../src/js/reports/ReportEncoder.js";

const FIELD_TYPES = ["text", "textarea", "select", "dtg", "check"];
const PREFILL_FLAGS = ["prefillFromCallsign", "prefillFromSpotterId"];
// every key a field is allowed to carry. a flag nothing reads does nothing, silently,
// so an unknown key is treated as a mistake rather than ignored
// help is attached by ReportForms from ReportFieldHelp rather than written here,
// and is as much part of a field as its label
const FIELD_KEYS = ["id", "tag", "label", "type", "placeholder", "required", "options",
    "offersPosition", "positionWithMgrs", "help", ...PREFILL_FLAGS];

let failures = 0;
function check(name, condition, detail = "") {
    if (condition) console.log(`  PASS  ${name}`);
    else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}

console.log("=== catalogue ===");
check(`${ReportForms.length} forms defined`, ReportForms.length === 26, `got ${ReportForms.length}`);

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
        // a field with no note is a field an operator has to guess at, which is
        // the whole reason the notes exist
        if (typeof field.help !== "string" || field.help.trim() === "") problems.push(`${field.id}: no help`);
        if (!FIELD_TYPES.includes(field.type)) problems.push(`${field.id}: unknown type ${field.type}`);
        if (field.type === "select" && !(field.options ?? []).length) problems.push(`${field.id}: select with no options`);
        if (field.type !== "select" && field.options) problems.push(`${field.id}: options on a non select`);
        if (field.positionWithMgrs && !field.offersPosition) problems.push(`${field.id}: positionWithMgrs without offersPosition`);
        if (field.type === "check" && field.required) problems.push(`${field.id}: a required tick box can never be left unticked`);
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
        // empty, which is the state a form is in the moment it is selected. A form
        // that keeps blank fields shows every one of them as a hyphen
        const empty = ReportEncoder.prepare(form, {}, "Joe-KJ5HBN-HTv3", "channel");
        const expectedEmpty = form.keepBlankFields
            ? [form.header, ...form.fields.filter((f) => f.type !== "check").map((f) => `${f.tag}: -`)].join("\n")
            : form.header;
        if (empty.text !== expectedEmpty) { ok = false; detail = `empty form rendered ${JSON.stringify(empty.text)}`; }
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
            const expected = field.type === "check" ? `\n${field.tag}` : `${field.tag}: `;
            if (!filled.text.includes(expected)) { ok = false; detail += ` missing tag ${field.tag}`; }
        }
    } catch (e) {
        ok = false; detail = e.message;
    }
    check(`${form.id} renders empty and full`, ok, detail);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
