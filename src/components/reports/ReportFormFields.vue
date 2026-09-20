<template>
    <fieldset :disabled="disabled" class="bg-white border border-gray-300 rounded-lg p-3 space-y-3 disabled:opacity-60">

        <div v-for="field of fields" :key="field.id" class="space-y-1">

            <label :for="fieldId(field)" class="block text-sm font-medium text-gray-900">
                {{ field.label }}
                <span v-if="field.required" class="text-red-600" aria-hidden="true">*</span>
                <span v-if="field.required" class="sr-only">required</span>
            </label>

            <!-- dropdown field -->
            <select
                v-if="field.type === 'select'"
                :id="fieldId(field)"
                :required="field.required"
                :value="values[field.id]"
                @change="onInput(field, $event.target.value)"
                class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                <option value="" disabled>Select...</option>
                <option v-for="option of field.options" :key="option" :value="option">{{ option }}</option>
            </select>

            <!-- multi line field -->
            <textarea
                v-else-if="field.type === 'textarea'"
                :id="fieldId(field)"
                :required="field.required"
                :value="values[field.id]"
                @input="onInput(field, $event.target.value)"
                rows="3"
                :placeholder="field.placeholder"
                class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"></textarea>

            <!-- date time group, which can be exact, approximate or a range -->
            <div v-else-if="field.type === 'dtg'" class="space-y-2">

                <select
                    :value="dtgMode(field)"
                    @change="onDtgModeChange(field, $event.target.value)"
                    :aria-label="`${field.label} precision`"
                    class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                    <option value="exact">Exact time</option>
                    <option value="approx">Approximate time</option>
                    <option value="between">Between two times</option>
                </select>

                <div class="flex space-x-2">
                    <input
                        :id="fieldId(field)"
                        :required="field.required"
                        :value="dtgParts(field).from"
                        @input="onDtgPartInput(field, 'from', $event.target.value)"
                        type="text"
                        :placeholder="field.placeholder"
                        :aria-label="dtgMode(field) === 'between' ? `${field.label} from` : field.label"
                        class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                    <button
                        @click="onDtgNow(field, 'from')"
                        type="button"
                        :aria-label="dtgMode(field) === 'between' ? `Set ${field.label} from to now` : `Set ${field.label} to now`"
                        class="shrink-0 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-900 text-sm rounded-lg px-3">Now</button>
                </div>

                <div v-if="dtgMode(field) === 'between'" class="flex space-x-2">
                    <input
                        :value="dtgParts(field).to"
                        @input="onDtgPartInput(field, 'to', $event.target.value)"
                        type="text"
                        placeholder="e.g: 191745L SEP"
                        :aria-label="`${field.label} to`"
                        class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                    <button
                        @click="onDtgNow(field, 'to')"
                        type="button"
                        :aria-label="`Set ${field.label} to, to now`"
                        class="shrink-0 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-900 text-sm rounded-lg px-3">Now</button>
                </div>

            </div>

            <!-- single line field, with a position button on the location fields -->
            <div v-else class="space-y-1">

                <div class="flex space-x-2">
                    <input
                        :id="fieldId(field)"
                        :required="field.required"
                        :value="values[field.id]"
                        @input="onInput(field, $event.target.value)"
                        type="text"
                        :placeholder="field.placeholder"
                        class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                    <button
                        v-if="field.offersPosition"
                        @click="onUsePosition(field)"
                        type="button"
                        :disabled="positionBusyField === field.id"
                        :aria-label="`Fill ${field.label} from the radio's position`"
                        class="shrink-0 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-900 text-sm rounded-lg px-3 disabled:opacity-60">{{ positionBusyField === field.id ? "..." : "Position" }}</button>
                </div>

                <!-- only ever shown after the operator pressed the button, so it explains
                     a specific failure rather than warning about one that may not happen -->
                <p v-if="positionErrors[field.id]" class="text-xs text-red-600">{{ positionErrors[field.id] }}</p>

            </div>

        </div>

    </fieldset>
</template>

<script>
import Dtg from "../../js/reports/Dtg.js";
import OperatorSettings from "../../js/reports/OperatorSettings.js";
import Position from "../../js/reports/Position.js";
import Connection from "../../js/Connection.js";

export default {
    name: 'ReportFormFields',
    props: {
        // field definitions from ReportForms.js
        fields: {
            type: Array,
            default: () => [],
        },
        // current value per field id
        values: {
            type: Object,
            default: () => ({}),
        },
        disabled: {
            type: Boolean,
            default: false,
        },
    },
    emits: [
        "input",
    ],
    data() {
        return {
            // The mode the operator picked, per field id. Deriving it from the value
            // alone almost works, but a range that is half typed has no separator yet,
            // which would snap the selector back to exact while they were still filling
            // it in. Cleared when the form changes, since the fields are then different.
            chosenModes: {},
            // which field is currently waiting on the radio, so its button can say so
            positionBusyField: null,
            // why the position could not be used, per field id
            positionErrors: {},
        };
    },
    watch: {
        fields() {
            this.chosenModes = {};
            this.positionErrors = {};
        },
    },
    methods: {

        dtgMode(field) {
            return this.chosenModes[field.id] ?? Dtg.parse(this.values[field.id]).mode;
        },

        dtgParts(field) {
            return Dtg.parse(this.values[field.id]);
        },

        onDtgModeChange(field, mode) {
            this.chosenModes[field.id] = mode;
            const parts = Dtg.parse(this.values[field.id]);
            this.onInput(field, Dtg.compose(mode, parts.from, parts.to));
        },

        onDtgPartInput(field, part, value) {
            const parts = Dtg.parse(this.values[field.id]);
            parts[part] = value;
            this.onInput(field, Dtg.compose(this.dtgMode(field), parts.from, parts.to));
        },

        onDtgNow(field, part) {
            this.onDtgPartInput(field, part, OperatorSettings.formatDtg());
        },

        /**
         * Fills a location field from the radio's own position.
         *
         * Asks the device fresh rather than using the position it reported when it
         * connected, because a mobile station that has moved since would otherwise
         * put where it used to be into a report.
         *
         * A radio with no GPS reports whatever position was set in Settings, and one
         * that has neither reports nothing. That last case is told plainly rather than
         * filled with zeros: a position of 0, 0 is a real place in the Gulf of Guinea
         * and would be far worse than an empty field.
         */
        async onUsePosition(field) {

            this.positionBusyField = field.id;
            this.positionErrors = { ...this.positionErrors, [field.id]: null };

            try {

                const position = await Connection.getPosition();

                if(position === null){
                    this.positionErrors = {
                        ...this.positionErrors,
                        [field.id]: "The radio has no position set. Set one in Settings, or type the location.",
                    };
                    return;
                }

                this.onInput(field, Position.format(position.latitude, position.longitude));

            } catch(e) {
                console.log("failed to read position from device", e);
                this.positionErrors = {
                    ...this.positionErrors,
                    [field.id]: "The radio did not answer. Check it is still connected.",
                };
            } finally {
                this.positionBusyField = null;
            }

        },


        fieldId(field) {
            return `report-field-${field.id}`;
        },

        // values are owned by the panel, so changes are reported rather than applied here
        onInput(field, value) {
            this.$emit("input", field.id, value);
        },

    },
}
</script>
