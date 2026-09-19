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

            <!-- date time group field, with a shortcut to fill in the current time -->
            <div v-else-if="field.type === 'dtg'" class="flex space-x-2">
                <input
                    :id="fieldId(field)"
                    :required="field.required"
                    :value="values[field.id]"
                    @input="onInput(field, $event.target.value)"
                    type="text"
                    :placeholder="field.placeholder"
                    class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                <button
                    @click="$emit('set-now', field.id)"
                    type="button"
                    :aria-label="`Set ${field.label} to now`"
                    class="shrink-0 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-900 text-sm rounded-lg px-3">Now</button>
            </div>

            <!-- single line field -->
            <input
                v-else
                :id="fieldId(field)"
                :required="field.required"
                :value="values[field.id]"
                @input="onInput(field, $event.target.value)"
                type="text"
                :placeholder="field.placeholder"
                class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">

        </div>

    </fieldset>
</template>

<script>
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
        "set-now",
    ],
    methods: {

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
