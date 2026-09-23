<template>
    <div v-if="open" class="fixed inset-0 z-50 flex bg-black/40 p-3 overflow-y-auto" @click.self="close">
        <div role="dialog" aria-labelledby="crib-sheet-heading" class="m-auto w-full max-w-2xl bg-white rounded-lg shadow-lg">

            <div id="crib-sheet" class="p-4 space-y-4">

                <div class="space-y-1">
                    <div id="crib-sheet-heading" class="text-lg font-semibold text-gray-900">{{ heading }}</div>
                    <div class="text-xs text-gray-600">
                        What goes in each field. Nothing here is transmitted.
                    </div>
                </div>

                <!-- The index. Twenty six forms is no way to find one, so this is
                     what the sheet opens as when no form is already in front of
                     the operator: grouped, with the details a press away. -->
                <template v-if="view === 'index'">

                    <div class="print-hide flex space-x-1">
                        <button v-for="group of groupings" :key="group.id" @click="grouping = group.id" type="button"
                            :class="grouping === group.id ? 'bg-gray-800 text-white font-semibold' : 'bg-gray-100 text-gray-600'"
                            class="w-full text-xs rounded px-2 py-1">{{ group.label }}</button>
                    </div>

                    <div v-for="group of groups" :key="group.id" class="crib-form space-y-1">
                        <div class="border-b border-gray-300 pb-1">
                            <div class="font-semibold text-gray-900">{{ group.label }}</div>
                            <div v-if="group.note" class="text-xs text-gray-600">{{ group.note }}</div>
                        </div>
                        <button v-for="entry of group.forms" :key="entry.id" @click="show(entry)" type="button"
                            class="w-full text-left rounded px-2 py-2 hover:bg-gray-100 flex flex-col sm:flex-row sm:items-baseline sm:justify-between sm:space-x-2">
                            <span>
                                <span class="text-sm font-medium text-gray-900">{{ entry.name }}</span>
                                <span class="block text-xs text-gray-600">{{ entry.description }}</span>
                            </span>
                            <span class="shrink-0 text-[10px] font-mono text-gray-500">{{ tagFor(entry) }}</span>
                        </button>
                    </div>

                </template>

                <!-- one form, or the whole booklet -->
                <div v-else v-for="sheet of sheets" :key="sheet.id" class="crib-form space-y-3">

                    <div v-if="view === 'booklet'" class="border-b border-gray-300 pb-1">
                        <div class="font-semibold text-gray-900">{{ sheet.name }}</div>
                        <div class="text-xs text-gray-600">{{ sheet.description }}</div>
                    </div>
                    <div v-else class="text-xs text-gray-600">{{ sheet.description }}</div>

                    <div v-for="field of sheet.fields" :key="field.id" class="crib-field space-y-0.5">
                        <div class="text-sm font-medium text-gray-900">
                            {{ field.label }}<span v-if="field.required" class="text-red-600"> *</span>
                        </div>
                        <div v-if="field.options" class="text-xs font-mono text-gray-600">{{ field.options.join(" · ") }}</div>
                        <div v-if="field.help" class="text-xs text-gray-700">{{ field.help }}</div>
                        <div v-else class="text-xs italic text-gray-500">No note written for this field yet.</div>
                    </div>

                </div>

                <div class="text-[10px] text-gray-500 border-t border-gray-300 pt-2">
                    A field marked * is required. Mesh-Emcomm.
                </div>

            </div>

            <div class="print-hide sticky bottom-0 bg-white rounded-b-lg border-t border-gray-200 p-3 flex space-x-2">
                <button v-if="view !== 'index'" @click="view = 'index'" type="button"
                    class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 font-medium rounded-lg text-sm px-4 py-2.5">
                    The list
                </button>
                <button v-else @click="view = 'booklet'" type="button"
                    class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 font-medium rounded-lg text-sm px-4 py-2.5">
                    All {{ forms.length }} forms
                </button>
                <button @click="print" type="button"
                    class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 font-medium rounded-lg text-sm px-4 py-2.5">
                    Print
                </button>
                <button @click="close" type="button"
                    class="w-full text-white bg-blue-600 hover:bg-blue-700 font-medium rounded-lg text-sm px-4 py-2.5">
                    Close
                </button>
            </div>

        </div>
    </div>
</template>

<script>
/**
 * The field notes on paper, and the way to find the one you want.
 *
 * The same words the blue i shows, laid out to be printed and carried. A binder
 * at a muster point is read by people whose phone is in a pocket, flat, or being
 * used as the radio's screen, and a station handed to a volunteer who has never
 * filled in a 9-line is the case this whole thing exists for.
 *
 * Opened from the reports panel it shows the form already in front of the
 * operator. Opened from the connect screen, where nothing is chosen, it shows an
 * index instead: twenty six forms is no way to find one, and dropping the whole
 * booklet on somebody looking for the MEDEVAC is worse than useless. The index
 * groups by where a form comes from, or by what kind of thing it is, because
 * operators arrive from both directions — "the ICS one" and "the one for a road".
 *
 * The printing is in style.css: everything is hidden and this sheet alone is
 * shown, because the app is a single scrolling page and printing it as it stands
 * gives you the header and the tabs. The index prints too, as a contents page.
 */
import ReportForms, { SOURCES, KINDS } from "../../js/reports/ReportForms.js";

export default {
    name: 'ReportCribSheet',
    props: {
        open: {
            type: Boolean,
            default: false,
        },
        // the form the operator has open, if any
        form: {
            type: Object,
            default: null,
        },
    },
    emits: ["close"],
    data() {
        return {
            // index, form or booklet
            view: this.form ? "form" : "index",
            // which form the details are showing, when the view is "form"
            chosen: this.form,
            grouping: "source",
            groupings: [
                { id: "source", label: "By organization" },
                { id: "kind", label: "By type" },
            ],
        };
    },
    watch: {
        open(value) {
            if(!value){
                return;
            }
            // straight to the form they were filling in; the list is for the
            // operator who has not chosen one yet
            this.chosen = this.form;
            this.view = this.form ? "form" : "index";
            this.grouping = "source";
        },
    },
    computed: {
        forms() {
            return ReportForms;
        },
        heading() {
            if(this.view === "form" && this.chosen){
                return this.chosen.name;
            }
            return "Report crib sheet";
        },
        sheets() {
            if(this.view === "booklet"){
                return ReportForms;
            }
            return this.chosen ? [this.chosen] : ReportForms;
        },
        /** The index, grouped the way the operator asked for it. */
        groups() {
            const by = this.grouping === "kind" ? KINDS : SOURCES;
            const field = this.grouping === "kind" ? "kind" : "source";
            return by
                .map((group) => ({
                    ...group,
                    forms: ReportForms.filter((form) => form[field] === group.id),
                }))
                // a group with nothing in it is noise, and the lists outlive any
                // one form
                .filter((group) => group.forms.length > 0);
        },
    },
    methods: {
        /** The other facet, as a tag: whichever one the list is not grouped by. */
        tagFor(form) {
            const other = this.grouping === "kind" ? SOURCES : KINDS;
            const field = this.grouping === "kind" ? "source" : "kind";
            return other.find((group) => group.id === form[field])?.label ?? "";
        },
        show(form) {
            this.chosen = form;
            this.view = "form";
        },
        print() {
            window.print();
        },
        close() {
            this.$emit("close");
        },
    },
};
</script>
