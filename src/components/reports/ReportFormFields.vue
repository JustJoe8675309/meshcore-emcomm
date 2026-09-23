<template>
    <fieldset :disabled="disabled" class="bg-white border border-gray-300 rounded-lg p-3 space-y-3 disabled:opacity-60">

        <div v-for="field of fields" :key="field.id" class="space-y-1">

            <label v-if="field.type !== 'check'" :for="fieldId(field)" class="block text-sm font-medium text-gray-900">
                {{ field.label }}
                <span v-if="field.required" class="text-red-600" aria-hidden="true">*</span>
                <span v-if="field.required" class="sr-only">required</span>
                <button v-if="field.help" @click.prevent="toggleHelp(field)" type="button"
                    :aria-expanded="isHelpOpen(field) ? 'true' : 'false'"
                    :aria-controls="helpId(field)"
                    :aria-label="`What to put in ${field.label}`"
                    :title="`What to put in ${field.label}`"
                    class="ml-1 align-middle w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold leading-none hover:bg-blue-200">i</button>
            </label>

            <!-- What the field is for, between its label and the box, so it is read
                 in that order and nothing floats over anything. Opened by tapping:
                 a hover tooltip does not exist on the phone this is most often
                 filled in on, and never reaches an operator in gloves. -->
            <p v-if="field.help && isHelpOpen(field)" :id="helpId(field)"
               class="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded p-2">{{ field.help }}</p>

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

            <!-- tick box: sends its tag alone when ticked -->
            <label v-else-if="field.type === 'check'" :for="fieldId(field)" class="flex items-center space-x-2 text-sm font-medium text-gray-900">
                <input
                    :id="fieldId(field)"
                    type="checkbox"
                    :checked="(values[field.id] ?? '') !== ''"
                    @change="onInput(field, $event.target.checked ? 'yes' : '')"
                    class="rounded border-gray-300">
                <span>{{ field.label }}</span>
            </label>

            <div v-if="field.type === 'check' && field.help" class="space-y-1">
                <button @click.prevent="toggleHelp(field)" type="button"
                    :aria-expanded="isHelpOpen(field) ? 'true' : 'false'"
                    :aria-controls="helpId(field)"
                    :aria-label="`What ${field.label} does`"
                    :title="`What ${field.label} does`"
                    class="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold leading-none hover:bg-blue-200">i</button>
                <p v-if="isHelpOpen(field)" :id="helpId(field)"
                   class="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded p-2">{{ field.help }}</p>
            </div>

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
                        :disabled="positionBusyField === field.id || gpsStatus === 'checking' || gpsStatus === 'unknown'"
                        :title="positionButtonHint"
                        :aria-label="`Fill ${field.label} from the radio's GPS`"
                        class="shrink-0 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-900 text-sm rounded-lg px-3 disabled:opacity-60">{{ positionButtonLabel(field) }}</button>
                </div>

                <!-- a disabled control with no reason given is worse than no control -->
                <p v-if="field.offersPosition && gpsStatus === 'checking'" class="text-xs text-gray-500">Checking whether the radio has a live GPS fix...</p>
                <p v-else-if="field.offersPosition && gpsStatus === 'unconfirmed' && !positionErrors[field.id]" class="text-xs text-gray-500">No live GPS fix yet. Press Check GPS to look again, or type the location.</p>

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
import Geo from "../../js/position/Geo.js";
import Connection from "../../js/Connection.js";
import GlobalState from "../../js/GlobalState.js";

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
            // which field notes are open, by field id. Open one at a time is
            // tempting and wrong: an operator comparing line 3 with line 5 wants
            // both, and closing one to read the other loses their place.
            openHelp: {},
        };
    },
    computed: {

        // the probe runs on the connection, so every field sees the same verdict
        gpsStatus() {
            return GlobalState.gpsStatus;
        },

        positionButtonHint() {
            if(this.gpsStatus === "checking"){
                return "Checking whether this radio is serving a live GPS fix";
            }
            if(this.gpsStatus === "live"){
                return "Fill from the radio's live GPS fix";
            }
            return "Check again for a live GPS fix. A receiver that had none when this radio connected may have one now";
        },

    },
    watch: {
        fields() {
            this.chosenModes = {};
            this.positionErrors = {};
            this.openHelp = {};
        },
    },
    methods: {

        helpId(field) {
            return `${this.fieldId(field)}-help`;
        },

        isHelpOpen(field) {
            return this.openHelp[field.id] === true;
        },

        toggleHelp(field) {
            this.openHelp = { ...this.openHelp, [field.id]: !this.isHelpOpen(field) };
        },

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

        positionButtonLabel(field) {
            if(this.positionBusyField === field.id){
                return "...";
            }
            if(this.gpsStatus === "checking"){
                return "GPS?";
            }
            // an unconfirmed radio is worth asking again rather than written off: a
            // receiver that had no fix when we probed may well have one by now
            return this.gpsStatus === "unconfirmed" ? "Check GPS" : "GPS";
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

                // a radio that could not show us a live fix when it connected may have
                // acquired one since, which is the normal case for a receiver still
                // getting its first lock. ask again rather than making the operator
                // reconnect to escape a verdict reached seconds after power on
                if(GlobalState.gpsStatus !== "live"){

                    await Connection.probeForLiveGps();

                    // a tasking can go to a stored position, as long as it says so
                    if(GlobalState.gpsStatus !== "live" && field.positionWithMgrs){
                        const stored = await Connection.getPosition();
                        if(stored !== null){
                            this.onInput(field, this.positionText(stored, true));
                            return;
                        }
                        this.positionErrors = {
                            ...this.positionErrors,
                            [field.id]: "No live GPS fix, and the radio has no position set. Type the location, or describe it.",
                        };
                        return;
                    }

                    if(GlobalState.gpsStatus !== "live"){
                        this.positionErrors = {
                            ...this.positionErrors,
                            [field.id]: "Still no live GPS fix. Give the receiver time to lock, or type the location.",
                        };
                        return;
                    }

                }

                const position = await Connection.getPosition();

                if(position === null){
                    this.positionErrors = {
                        ...this.positionErrors,
                        [field.id]: "The radio has no position set. Set one in Settings, or type the location.",
                    };
                    return;
                }

                this.onInput(field, field.positionWithMgrs
                    ? this.positionText(position, false)
                    : Position.format(position.latitude, position.longitude));

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


        // "31.92702, -106.40012 (13R CR 67640 33201)", with "last known" when it is
        // a stored position rather than a live fix. The operator can edit it or
        // add a description after it
        positionText(position, lastKnown) {
            const degrees = Position.format(position.latitude, position.longitude);
            const mgrs = Geo.formatMgrs(position.latitude, position.longitude);
            const grid = mgrs ? ` (${mgrs})` : "";
            return `${degrees}${grid}${lastKnown ? " last known" : ""}`;
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
