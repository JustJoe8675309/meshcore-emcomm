<template>
    <div v-if="open" class="fixed inset-0 z-50 flex bg-black/40 p-3 overflow-y-auto" @click.self="close">
        <div role="dialog" aria-labelledby="crib-sheet-heading" class="m-auto w-full max-w-2xl bg-white rounded-lg shadow-lg">

            <div id="crib-sheet" class="p-4 space-y-4">

                <div class="space-y-1">
                    <div id="crib-sheet-heading" class="text-lg font-semibold text-gray-900">
                        {{ isBooklet ? "Report crib sheet" : form.name }}
                    </div>
                    <div class="text-xs text-gray-600">
                        What goes in each field. Nothing here is transmitted.
                    </div>
                </div>

                <div v-for="sheet of sheets" :key="sheet.id" class="crib-form space-y-3">

                    <div v-if="isBooklet" class="border-b border-gray-300 pb-1">
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
                <button v-if="form" @click="showAll = !showAll" type="button"
                    class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 font-medium rounded-lg text-sm px-4 py-2.5">
                    {{ showAll ? "This form only" : `All ${forms.length} forms` }}
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
 * The field notes on paper.
 *
 * The same words the blue i shows, laid out to be printed and carried. A binder
 * at a muster point is read by people whose phone is in a pocket, flat, or being
 * used as the radio's screen, and a station handed to a volunteer who has never
 * filled in a 9-line is the case this whole thing exists for.
 *
 * One form, or all of them as a booklet with a page each. The printing itself is
 * in style.css: everything is hidden and this sheet alone is shown, because the
 * app is a single scrolling page and printing it as it stands gives you the
 * header and the tabs.
 */
import ReportForms from "../../js/reports/ReportForms.js";

export default {
    name: 'ReportCribSheet',
    props: {
        open: {
            type: Boolean,
            default: false,
        },
        // the form the operator has open, shown first
        form: {
            type: Object,
            default: null,
        },
    },
    emits: ["close"],
    data() {
        return {
            showAll: false,
        };
    },
    watch: {
        open(value) {
            if(value){
                // opens on the form in front of them; the booklet is a choice
                this.showAll = false;
            }
        },
    },
    computed: {
        forms() {
            return ReportForms;
        },
        sheets() {
            if(this.showAll){
                return ReportForms;
            }
            return this.form ? [this.form] : ReportForms;
        },
        /** Reached with no radio, so with no form open: the booklet is all there is. */
        isBooklet() {
            return this.showAll || this.form == null;
        },
    },
    methods: {
        print() {
            window.print();
        },
        close() {
            this.$emit("close");
        },
    },
};
</script>
