// What each field means, for the operator who has never filled this form in.
//
// The forms are the standard ones, and the standard ones are full of words that
// mean something exact to the agency receiving them and nothing to a ham filling
// one in for the first time: LITTER and AMBULATORY, precedence, check, HX,
// accretion. A placeholder shows an example and a label gives a name; neither
// says what the field is for.
//
// So every field carries a note, opened by a small blue i beside its label. It is
// never transmitted, which these tests hold to, since anything that reaches the
// encoder costs airtime and confuses the receiving station.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ReportForms from "../../src/js/reports/ReportForms.js";
import ReportFieldHelp from "../../src/js/reports/ReportFieldHelp.js";
import ReportEncoder from "../../src/js/reports/ReportEncoder.js";
import ReportFormFields from "../../src/components/reports/ReportFormFields.vue";
import ReportCribSheet from "../../src/components/reports/ReportCribSheet.vue";
import ConnectButtons from "../../src/components/connect/ConnectButtons.vue";
import GlobalState from "../../src/js/GlobalState.js";

const formById = (id) => ReportForms.find((form) => form.id === id);
const fieldById = (formId, fieldId) => formById(formId).fields.find((field) => field.id === fieldId);

describe("every field has a note", () => {

    it("covers all of them, so no form is half explained", () => {
        const missing = [];
        for(const form of ReportForms){
            for(const field of form.fields){
                if(!field.help){
                    missing.push(`${form.id}.${field.id}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it("writes notes only for fields that exist", () => {
        // a field renamed or dropped leaves its note behind, where it is never
        // shown and quietly rots
        const orphans = [];
        for(const formId of ReportFieldHelp.formIds){
            const form = formById(formId);
            if(form == null){
                orphans.push(formId);
                continue;
            }
            for(const fieldId of Object.keys(ReportFieldHelp.forForm(formId))){
                if(!form.fields.some((field) => field.id === fieldId)){
                    orphans.push(`${formId}.${fieldId}`);
                }
            }
        }
        expect(orphans).toEqual([]);
    });

    it("explains every option of every dropdown", () => {
        // the options are bare codes on screen: HOIST, PANELS, HXC. If the note
        // does not name one, nothing in the app does
        const unexplained = [];
        for(const form of ReportForms){
            for(const field of form.fields){
                if(field.type !== "select"){
                    continue;
                }
                for(const option of field.options){
                    if(!(field.help ?? "").includes(option)){
                        unexplained.push(`${form.id}.${field.id}: ${option}`);
                    }
                }
            }
        }
        expect(unexplained).toEqual([]);
    });

    it("says more than the label already said", () => {
        const useless = [];
        for(const form of ReportForms){
            for(const field of form.fields){
                const help = field.help ?? "";
                if(help.length < 40 || help.trim() === field.label.trim()){
                    useless.push(`${form.id}.${field.id}`);
                }
            }
        }
        expect(useless).toEqual([]);
    });

    it("stays short enough to be read on a phone", () => {
        // a note longer than a screen is one an operator scrolls past mid incident
        const tooLong = ReportForms.flatMap((form) => form.fields
            .filter((field) => (field.help ?? "").length > 900)
            .map((field) => `${form.id}.${field.id} (${field.help.length})`));
        expect(tooLong).toEqual([]);
    });

    it("explains the one that started this", () => {
        const line5 = fieldById("medevac", "line5");
        expect(line5.help).toContain("LITTER");
        expect(line5.help).toContain("AMBULATORY");
        // and says why it is not the same question as line 3
        expect(line5.help).toContain("line 3");
    });

    it("gives a standard's own threshold, and says whose it is", () => {
        expect(fieldById("skywarn", "measurement").help).toContain("National Weather Service");
        // and hands the decision to the agency that owns it rather than to us
        expect(fieldById("medevac", "line3").help).toMatch(/requesting agency|agency's own/);
        expect(fieldById("ics213rr", "priority").help).toMatch(/receiving agency/);
    });

});

describe("the note beside a field", () => {

    const fields = formById("medevac").fields;

    function mountFields(formFields = fields) {
        return mount(ReportFormFields, {
            props: { fields: formFields, values: {} },
            global: { stubs: { IconButton: true } },
        });
    }

    const infoButtons = (wrapper) => wrapper.findAll("button").filter((b) => b.text().trim() === "i");

    beforeEach(() => {
        GlobalState.gpsStatus = "unconfirmed";
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("is closed until it is asked for", () => {
        const wrapper = mountFields();
        expect(wrapper.text()).not.toContain("must be carried");
        expect(infoButtons(wrapper).length).toBe(fields.length);
    });

    it("opens on a click, and closes again", async () => {
        const wrapper = mountFields();
        const button = infoButtons(wrapper)[4];

        await button.trigger("click");
        expect(wrapper.text()).toContain("must be carried");

        await button.trigger("click");
        expect(wrapper.text()).not.toContain("must be carried");
    });

    it("opens more than one at a time, for the operator comparing two lines", async () => {
        const wrapper = mountFields();
        await infoButtons(wrapper)[2].trigger("click");
        await infoButtons(wrapper)[4].trigger("click");

        expect(wrapper.text()).toContain("URGENT");
        expect(wrapper.text()).toContain("must be carried");
    });

    it("tells a screen reader what it is and whether it is open", async () => {
        const wrapper = mountFields();
        const button = infoButtons(wrapper)[4];

        expect(button.attributes("aria-label")).toContain("5. Patients by type");
        expect(button.attributes("aria-expanded")).toBe("false");

        await button.trigger("click");
        expect(button.attributes("aria-expanded")).toBe("true");
        // and the note it opened is the one it points at
        const note = wrapper.find(`#${button.attributes("aria-controls")}`);
        expect(note.exists()).toBe(true);
        expect(note.text()).toContain("AMBULATORY");
    });

    it("is read between the label and the box, not over the top of anything", () => {
        // a floating tooltip would be clipped by the panel's own scroll, and the
        // reports panel has already been the one place where absolutely positioned
        // things stretched the whole page
        const source = readFileSync(resolve("src/components/reports/ReportFormFields.vue"), "utf8");
        const label = source.indexOf("{{ field.label }}");
        const note = source.indexOf("{{ field.help }}");
        const input = source.indexOf("field.type === 'select'");

        expect(label).toBeLessThan(note);
        expect(note).toBeLessThan(input);
        expect(source).not.toMatch(/field\.help[\s\S]{0,200}absolute/);
    });

    it("closes the open notes when the form changes", async () => {
        const wrapper = mountFields();
        await infoButtons(wrapper)[4].trigger("click");
        expect(wrapper.text()).toContain("must be carried");

        await wrapper.setProps({ fields: formById("salute").fields });
        expect(wrapper.text()).not.toContain("must be carried");
    });

    it("never reaches the air", () => {
        // the fields carry help now; the encoder must still send tags and values
        const form = formById("medevac");
        const encoded = ReportEncoder.renderReport(form, {
            line1: "DM62nr", line2: "146.520 K7ABC", line3: "1 URGENT", line4: "HOIST",
            line5: "1 LITTER", line6: "Fall", line7: "SMOKE", line8: "", line9: "",
        });
        const text = JSON.stringify(encoded);

        expect(text).toContain("LITTER");
        expect(text).not.toContain("must be carried");
        expect(text).not.toContain("AMBULATORY");
    });

});

describe("finding a report in the crib sheet", () => {

    const mountSheet = (props = {}) => mount(ReportCribSheet, { props: { open: true, form: null, ...props } });

    const entries = (wrapper) => wrapper.findAll(".crib-form button").map((b) => b.text());
    const groupHeadings = (wrapper) => wrapper.findAll(".crib-form > div:first-child").map((d) => d.text());
    const buttonSaying = (wrapper, text) => wrapper.findAll("button").find((b) => b.text().trim() === text);

    it("opens as a list when no form is already in front of the operator", () => {
        const wrapper = mountSheet();
        // not the whole booklet: nobody looking for the 9-line wants 26 forms of
        // field notes handed to them
        expect(wrapper.text()).not.toContain("must be carried");
        expect(entries(wrapper).length).toBe(ReportForms.length);
    });

    it("groups by where a form comes from, and says which are nobody's forms", () => {
        const wrapper = mountSheet();
        const headings = groupHeadings(wrapper).join("\n");

        expect(headings).toContain("ICS");
        expect(headings).toContain("ARRL");
        expect(headings).toContain("National Weather Service");
        expect(headings).toContain("Military formats");
        // the honest one: these are formats this app defines, not published forms
        expect(headings).toContain("Common practice");
        expect(headings).toContain("Not published forms");
    });

    it("lists every form exactly once, whichever way it is grouped", async () => {
        const wrapper = mountSheet();
        for(const grouping of ["By organization", "By type"]){
            await buttonSaying(wrapper, grouping).trigger("click");

            const listed = entries(wrapper);
            expect(listed.length).toBe(ReportForms.length);
            for(const form of ReportForms){
                expect(listed.filter((text) => text.includes(form.name)).length,
                    `${form.name} grouped ${grouping}`).toBe(1);
            }
        }
    });

    it("groups by what kind of thing it is, for the operator who arrives that way", async () => {
        const wrapper = mountSheet();
        await buttonSaying(wrapper, "By type").trigger("click");
        const headings = groupHeadings(wrapper).join("\n");

        expect(headings).toContain("Weather");
        expect(headings).toContain("Message traffic");
        expect(headings).toContain("Tasking");
        // and the organization becomes the tag instead
        const weather = entries(wrapper).find((text) => text.includes("SKYWARN"));
        expect(weather).toContain("National Weather Service");
    });

    it("shows nothing but the form that was pressed", async () => {
        const wrapper = mountSheet();
        await wrapper.findAll(".crib-form button")
            .find((b) => b.text().includes("9-Line MEDEVAC Request"))
            .trigger("click");

        expect(wrapper.text()).toContain("5. Patients by type");
        expect(wrapper.text()).toContain("must be carried");
        // not the next form down, which is what the booklet gave them
        expect(wrapper.text()).not.toContain("Spotter ID");
        expect(wrapper.findAll(".crib-form").length).toBe(1);
    });

    it("goes back to the list without closing", async () => {
        const wrapper = mountSheet();
        await wrapper.findAll(".crib-form button").find((b) => b.text().includes("SALUTE")).trigger("click");
        expect(wrapper.text()).toContain("Size");

        await buttonSaying(wrapper, "The list").trigger("click");
        expect(entries(wrapper).length).toBe(ReportForms.length);
        expect(wrapper.emitted("close")).toBeFalsy();
    });

    it("opens straight on the form the operator was filling in", () => {
        const wrapper = mountSheet({ form: formById("medevac") });

        expect(wrapper.text()).toContain("9-Line MEDEVAC Request");
        expect(wrapper.text()).toContain("must be carried");
        // and the list is still one press away, since they may want a different one
        expect(buttonSaying(wrapper, "The list")).toBeTruthy();
    });

    it("comes back to the form in front of them each time it is opened", async () => {
        const wrapper = mountSheet({ form: formById("medevac") });
        await buttonSaying(wrapper, "The list").trigger("click");
        expect(entries(wrapper).length).toBe(ReportForms.length);

        await wrapper.setProps({ open: false });
        await wrapper.setProps({ open: true });
        expect(wrapper.text()).toContain("9-Line MEDEVAC Request");
        expect(wrapper.text()).toContain("must be carried");
    });

});

describe("the crib sheet itself", () => {

    const mountSheet = (props = {}) => mount(ReportCribSheet, { props: { open: true, form: formById("medevac"), ...props } });
    const buttonSaying = (wrapper, text) => wrapper.findAll("button").find((b) => b.text().trim() === text);

    it("lists the form's fields with what goes in each", () => {
        const wrapper = mountSheet();
        expect(wrapper.text()).toContain("9-Line MEDEVAC Request");
        expect(wrapper.text()).toContain("5. Patients by type");
        expect(wrapper.text()).toContain("must be carried");
    });

    it("spells out a dropdown's options, which are bare codes on the form", () => {
        const wrapper = mountSheet();
        expect(wrapper.text()).toContain("NONE · HOIST · EXTRACTION · VENTILATOR");
    });

    it("marks which fields are required", () => {
        const wrapper = mountSheet();
        // line 8 is optional and line 5 is not
        expect(wrapper.text()).toContain("5. Patients by type *");
        expect(wrapper.text()).not.toContain("8. Patient status *");
    });

    it("prints the whole booklet when asked, a page per form", async () => {
        const wrapper = mountSheet({ form: null });

        await buttonSaying(wrapper, `All ${ReportForms.length} forms`).trigger("click");
        expect(wrapper.findAll(".crib-form").length).toBe(ReportForms.length);
        for(const form of ReportForms){
            expect(wrapper.text()).toContain(form.name);
        }
    });

    it("prints itself and nothing else", () => {
        const printed = vi.fn();
        vi.stubGlobal("print", printed);

        const wrapper = mountSheet();
        buttonSaying(wrapper, "Print").trigger("click");
        expect(printed).toHaveBeenCalled();
        vi.unstubAllGlobals();

        // the page hides everything but this sheet, by id, and keeps a field and
        // its note on one page. happy-dom applies no stylesheet, so the rules are
        // checked where they are written
        const css = readFileSync(resolve("src/style.css"), "utf8");
        expect(css).toContain("@media print");
        expect(css).toMatch(/#crib-sheet,\s*#crib-sheet \*/);
        expect(css).toMatch(/\.crib-field[\s\S]{0,120}break-inside: avoid/);
        // visibility, not display: hiding the ancestors with display would take
        // the sheet inside them with it
        expect(css).toMatch(/body \*\s*\{\s*visibility: hidden/);
    });

    it("keeps its own buttons and the grouping switch off the paper", () => {
        const wrapper = mountSheet({ form: null });
        const hidden = wrapper.findAll(".print-hide").map((el) => el.text()).join("\n");

        expect(hidden).toContain("Print");
        expect(hidden).toContain("Close");
        // the index prints as a contents page, so its group switch has to go
        expect(hidden).toContain("By organization");
    });

});

// The binder is printed with nothing plugged in.
//
// Reported by the operator: they had to connect a node before they could reach
// the crib sheet. The tabs, and so the Reports panel, only exist once a radio
// does — which is the opposite of when a binder gets printed. So the connect
// screen offers it too, where there is no form open and the booklet is all there
// is to show.
describe("the crib sheet with no radio", () => {

    function mountConnect() {
        return mount(ConnectButtons, {
            global: { mocks: { $router: { push() {} } } },
        });
    }

    it("is offered on the connect screen", () => {
        const wrapper = mountConnect();
        const link = wrapper.findAll("button").find((b) => b.text().trim() === "Report crib sheet");

        expect(link).toBeTruthy();
        expect(wrapper.text()).toContain("Print it before you need it");
    });

    it("opens the list, since no form is open to start from", async () => {
        const wrapper = mountConnect();
        await wrapper.findAll("button").find((b) => b.text().trim() === "Report crib sheet").trigger("click");

        // every form, as an index rather than as 26 forms of field notes
        expect(wrapper.findAll(".crib-form button").length).toBe(ReportForms.length);
        expect(wrapper.text()).toContain("9-Line MEDEVAC Request");
        expect(wrapper.text()).not.toContain("must be carried");
    });

    it("reaches one form's details in two presses from a cold start", async () => {
        const wrapper = mountConnect();
        await wrapper.findAll("button").find((b) => b.text().trim() === "Report crib sheet").trigger("click");
        await wrapper.findAll(".crib-form button")
            .find((b) => b.text().includes("9-Line MEDEVAC Request"))
            .trigger("click");

        expect(wrapper.text()).toContain("must be carried");
        expect(wrapper.findAll(".crib-form").length).toBe(1);
    });

    it("still connects a radio, which is what that screen is for", () => {
        const wrapper = mountConnect();
        const labels = wrapper.findAll("button").map((b) => b.text().trim());
        expect(labels).toContain("Connect via Bluetooth");
        expect(labels).toContain("Connect via Serial");
    });

});
