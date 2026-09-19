<template>
    <div v-click-outside="{ handler: close, capture: true }" class="relative">

        <input
            ref="input"
            :id="inputId"
            type="text"
            role="combobox"
            autocomplete="off"
            aria-autocomplete="list"
            :aria-expanded="isOpen"
            :aria-controls="listboxId"
            :aria-activedescendant="isOpen ? optionId(highlightedIndex) : null"
            :value="isOpen ? query : selectedLabel"
            :placeholder="isOpen ? (selectedLabel || placeholder) : placeholder"
            @focus="open"
            @input="onInput"
            @keydown.down.prevent="moveHighlight(1)"
            @keydown.up.prevent="moveHighlight(-1)"
            @keydown.enter.prevent="selectHighlighted"
            @keydown.esc="close"
            class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">

        <!-- filtered options -->
        <div
            v-if="isOpen"
            :id="listboxId"
            role="listbox"
            class="absolute z-20 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-y-auto">

            <div v-if="filteredOptions.length === 0" role="status" class="px-3 py-2 text-sm text-gray-500">
                Nothing matches "{{ query }}"
            </div>

            <div
                v-for="(option, index) of filteredOptions"
                :key="option.value"
                :id="optionId(index)"
                :data-option-index="index"
                role="option"
                :aria-selected="option.value === modelValue"
                @mousedown.prevent="select(option)"
                @mouseenter="highlightedIndex = index"
                class="flex items-center justify-between space-x-2 px-3 py-2 text-sm cursor-pointer"
                :class="[
                    index === highlightedIndex ? 'bg-blue-500 text-white' : 'text-gray-900 hover:bg-gray-100',
                    option.value === modelValue ? 'font-semibold' : '',
                ]">
                <span class="truncate">{{ option.label }}</span>
                <span
                    v-if="option.hint"
                    class="shrink-0 text-xs font-normal"
                    :class="[ index === highlightedIndex ? 'text-blue-100' : 'text-gray-500' ]">{{ option.hint }}</span>
            </div>

        </div>

    </div>
</template>

<script>
// only needs to be unique within the page
let instanceCounter = 0;

export default {
    name: 'SearchableSelect',
    props: {
        modelValue: {
            default: null,
        },
        // [{ value, label, hint }] where hint is shown but not searched
        options: {
            type: Array,
            default: () => [],
        },
        placeholder: {
            type: String,
            default: "Select...",
        },
        // lets a <label for="..."> outside this component point at the real input
        inputId: {
            type: String,
            default: null,
        },
    },
    emits: [
        "update:modelValue",
    ],
    data() {
        return {
            isOpen: false,
            query: "",
            highlightedIndex: 0,
            // ids have to be stable for aria-controls and aria-activedescendant to
            // keep pointing at the same elements across re-renders
            instanceId: `searchable-select-${++instanceCounter}`,
        };
    },
    watch: {
        highlightedIndex() {
            this.scrollHighlightedIntoView();
        },
    },
    methods: {

        optionId(index) {
            return `${this.instanceId}-option-${index}`;
        },

        scrollHighlightedIntoView() {
            this.$nextTick(() => {
                const row = this.$el?.querySelector(`[data-option-index="${this.highlightedIndex}"]`);
                // "nearest" scrolls only far enough to reveal the row, so the list
                // does not jump around while stepping through it
                row?.scrollIntoView({ block: "nearest" });
            });
        },

        open() {
            this.isOpen = true;
            // start from an empty filter so every option is reachable, with the
            // current selection shown as the placeholder
            this.query = "";
            this.highlightedIndex = Math.max(this.filteredOptions.findIndex((option) => option.value === this.modelValue), 0);
            this.scrollHighlightedIntoView();
        },

        close() {
            this.isOpen = false;
            this.query = "";
        },

        onInput(event) {
            this.query = event.target.value;
            this.isOpen = true;
            // the previously highlighted row may have been filtered out
            this.highlightedIndex = 0;
        },

        select(option) {
            this.$emit("update:modelValue", option.value);
            this.close();
            this.$refs.input?.blur();
        },

        selectHighlighted() {
            const option = this.filteredOptions[this.highlightedIndex];
            if(option){
                this.select(option);
            }
        },

        moveHighlight(delta) {

            if(!this.isOpen){
                this.open();
                return;
            }

            const count = this.filteredOptions.length;
            if(count === 0){
                return;
            }

            this.highlightedIndex = (this.highlightedIndex + delta + count) % count;

        },

    },
    computed: {

        listboxId() {
            return `${this.instanceId}-listbox`;
        },

        selectedLabel() {
            return this.options.find((option) => option.value === this.modelValue)?.label ?? "";
        },

        // plain "contains" match, case insensitive, so typing "213" finds both
        // ICS-213 forms and typing "check" finds the check in.
        // only the label is searched: a hint like "2 minutes ago" is context for
        // the operator, and matching on it would produce baffling results
        filteredOptions() {

            const query = this.query.trim().toLowerCase();
            if(query === ""){
                return this.options;
            }

            return this.options.filter((option) => option.label.toLowerCase().includes(query));

        },

    },
}
</script>
