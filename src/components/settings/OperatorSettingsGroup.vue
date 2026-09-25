<template>
    <SettingsSection title="Operator" note="You, rather than the radio. The same in every mode, and kept in this browser." sub>
        <div class="bg-white divide-y">

            <div class="w-full p-2">
                <div class="block mb-2 text-sm font-medium text-gray-900">Operator callsign</div>
                <input
                    :value="callsign"
                    @input="onCallsignInput"
                    type="text"
                    placeholder="e.g: KJ5HBN"
                    class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                <div class="mt-1 text-xs text-gray-500">
                    Used to prefill callsign fields on report forms. Separate from the node name
                    above, which names the radio and belongs to the mode.
                </div>
            </div>

            <div class="w-full p-2">
                <div class="block mb-2 text-sm font-medium text-gray-900">SKYWARN spotter number</div>
                <input
                    :value="skywarnNumber"
                    @input="onSkywarnNumberInput"
                    type="text"
                    placeholder="Optional"
                    class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                <div class="mt-1 text-xs text-gray-500">
                    If set, SKYWARN reports identify you as callsign/number. Left blank, they
                    use your callsign alone.
                </div>
            </div>

            <div class="w-full p-2">
                <div class="block mb-2 text-sm font-medium text-gray-900">Date time group</div>
                <select
                    :value="dtgZone"
                    @change="onDtgZoneChange"
                    class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                    <option value="local">Local time (191830L SEP)</option>
                    <option value="zulu">Zulu / UTC (190030Z SEP)</option>
                </select>
                <div class="mt-1 text-xs text-gray-500">
                    Applies to the DTG fields on report forms. Match whatever your net runs on.
                </div>
            </div>

            <div class="w-full p-2 text-xs text-gray-500">
                Saved as they are typed, so there is nothing here to Save. The operator is the
                person, not the station: switching modes does not change who is at the radio.
            </div>

        </div>
    </SettingsSection>
</template>

<script>
/**
 * Who is operating: callsign, SKYWARN number, and which time the report forms
 * write.
 *
 * It sits under Radio inside each mode tab, where the operator looks, and reads
 * the same in every one of them — like the contact groups, and for the same
 * reason. A mode is a configuration of the radio; the person holding it is not
 * part of that, and a drill does not put someone else in the chair.
 *
 * Each field writes as it is typed rather than waiting for Save. These are kept
 * in this browser and never go to the radio, so there is nothing that could half
 * happen and nothing to report.
 */
import SettingsSection from "./SettingsSection.vue";
import OperatorSettings from "../../js/reports/OperatorSettings.js";

export default {
    name: 'OperatorSettingsGroup',
    components: {
        SettingsSection,
    },
    methods: {
        onCallsignInput(event) {
            OperatorSettings.setCallsign(event.target.value);
        },
        onSkywarnNumberInput(event) {
            OperatorSettings.setSkywarnNumber(event.target.value);
        },
        onDtgZoneChange(event) {
            OperatorSettings.setDtgZone(event.target.value);
        },
    },
    computed: {
        callsign() {
            return OperatorSettings.state.callsign;
        },
        skywarnNumber() {
            return OperatorSettings.state.skywarnNumber;
        },
        dtgZone() {
            return OperatorSettings.state.dtgZone;
        },
    },
};
</script>
