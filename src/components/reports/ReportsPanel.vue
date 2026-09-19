<template>
    <div class="w-full overflow-y-auto bg-gray-50">
        <div class="p-3 space-y-3">

            <!-- channel to transmit on -->
            <div class="bg-white border border-gray-300 rounded-lg p-3 space-y-1">
                <label class="block text-sm font-medium text-gray-900">Send on channel</label>
                <select v-model="selectedChannelIdx" class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                    <option v-for="channel of channels" :key="channel.idx" :value="channel.idx">{{ channel.name }}</option>
                </select>
                <div v-if="channels.length === 0" class="text-xs text-red-600">
                    No channels available. Connect to your device first.
                </div>
            </div>

            <!-- report type -->
            <div class="bg-white border border-gray-300 rounded-lg p-3 space-y-1">
                <label class="block text-sm font-medium text-gray-900">Report form</label>
                <select v-model="selectedFormId" class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                    <option :value="null" disabled>Select a report...</option>
                    <option v-for="form of forms" :key="form.id" :value="form.id">{{ form.name }}</option>
                </select>
                <div v-if="selectedForm" class="text-xs text-gray-500">{{ selectedForm.description }}</div>
            </div>

            <!-- form fields -->
            <div v-if="selectedForm" class="bg-white border border-gray-300 rounded-lg p-3 space-y-3">

                <div v-for="field of selectedForm.fields" :key="field.id" class="space-y-1">

                    <label class="block text-sm font-medium text-gray-900">
                        {{ field.label }}
                        <span v-if="field.required" class="text-red-600">*</span>
                    </label>

                    <!-- dropdown field -->
                    <select
                        v-if="field.type === 'select'"
                        v-model="values[field.id]"
                        class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                        <option value="" disabled>Select...</option>
                        <option v-for="option of field.options" :key="option" :value="option">{{ option }}</option>
                    </select>

                    <!-- multi line field -->
                    <textarea
                        v-else-if="field.type === 'textarea'"
                        v-model="values[field.id]"
                        rows="3"
                        :placeholder="field.placeholder"
                        class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"></textarea>

                    <!-- date time group field, with a shortcut to fill in the current time -->
                    <div v-else-if="field.type === 'dtg'" class="flex space-x-2">
                        <input
                            v-model="values[field.id]"
                            type="text"
                            :placeholder="field.placeholder"
                            class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                        <button
                            @click="values[field.id] = formatDtg()"
                            type="button"
                            class="shrink-0 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-900 text-sm rounded-lg px-3">Now</button>
                    </div>

                    <!-- single line field -->
                    <input
                        v-else
                        v-model="values[field.id]"
                        type="text"
                        :placeholder="field.placeholder"
                        class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">

                </div>

            </div>

            <!-- what will actually be transmitted -->
            <div v-if="selectedForm && prepared" class="bg-white border border-gray-300 rounded-lg p-3 space-y-2">

                <div class="flex items-center justify-between">
                    <label class="block text-sm font-medium text-gray-900">Transmission preview</label>
                    <div class="text-xs" :class="[ prepared.parts === null ? 'text-red-600' : 'text-gray-500' ]">
                        {{ sizeSummary }}
                    </div>
                </div>

                <div v-if="prepared.parts === null" class="text-xs text-red-600">
                    This report cannot be split into sendable packets. Shorten it, or set a shorter device name in Settings.
                </div>

                <div v-else-if="prepared.parts.length === 0" class="text-xs text-gray-500">
                    Fill in the form to see what will be sent.
                </div>

                <div v-else class="space-y-1">
                    <div
                        v-for="(part, index) of prepared.parts"
                        :key="index"
                        class="bg-gray-50 border border-gray-200 rounded p-2 text-xs text-gray-800"
                        style="white-space:pre-wrap;word-break:break-word;">{{ part }}</div>
                    <div v-if="prepared.parts.length > 1" class="text-xs text-gray-500">
                        Sent as {{ prepared.parts.length }} separate messages, about {{ partDelaySeconds }} seconds apart.
                    </div>
                </div>

            </div>

            <!-- send -->
            <div v-if="selectedForm" class="space-y-2 pb-3">

                <div v-if="validationMessage" class="text-xs text-red-600">{{ validationMessage }}</div>

                <button
                    @click="onSendClick"
                    :disabled="!canSend"
                    type="button"
                    class="w-full text-white text-sm font-medium rounded-lg px-5 py-2.5"
                    :class="[ canSend ? 'bg-blue-500 hover:bg-blue-600 cursor-pointer' : 'bg-gray-300 cursor-not-allowed' ]">
                    {{ sendButtonLabel }}
                </button>

                <button
                    @click="resetForm"
                    :disabled="isSending"
                    type="button"
                    class="w-full bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg px-5 py-2.5">
                    Clear form
                </button>

            </div>

        </div>
    </div>
</template>

<script>
import GlobalState from "../../js/GlobalState.js";
import Connection from "../../js/Connection.js";
import Utils from "../../js/Utils.js";
import ReportForms from "../../js/reports/ReportForms.js";
import ReportEncoder from "../../js/reports/ReportEncoder.js";

export default {
    name: 'ReportsPanel',
    data() {
        return {
            selectedChannelIdx: null,
            selectedFormId: null,
            values: {},
            isSending: false,
            sendingPartIndex: 0,
        };
    },
    mounted() {
        this.selectDefaultChannel();
    },
    watch: {
        selectedFormId() {
            this.resetForm();
        },
        channels() {
            this.selectDefaultChannel();
        },
    },
    methods: {

        selectDefaultChannel() {

            // keep the operator selection if it still exists
            const isSelectionStillValid = this.channels.some((channel) => channel.idx === this.selectedChannelIdx);
            if(isSelectionStillValid){
                return;
            }

            this.selectedChannelIdx = this.channels.length > 0 ? this.channels[0].idx : null;

        },

        // current date time group, e.g "191830L SEP"
        formatDtg() {

            const now = new Date();
            const pad = (value) => value.toString().padStart(2, "0");
            const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

            return `${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}L ${months[now.getMonth()]}`;

        },

        resetForm() {

            const values = {};

            for(const field of this.selectedForm?.fields ?? []){

                // prefill the current time into date time group fields
                if(field.type === "dtg"){
                    values[field.id] = this.formatDtg();
                    continue;
                }

                // prefill callsign style fields from the device advert name
                if(field.prefillFromNodeName){
                    values[field.id] = GlobalState.selfInfo?.name ?? "";
                    continue;
                }

                values[field.id] = "";

            }

            this.values = values;

        },

        async onSendClick() {

            if(!this.canSend){
                return;
            }

            const parts = this.prepared.parts;
            const channel = this.selectedChannel;

            // sending several messages costs real airtime, so make the operator confirm
            if(parts.length > 1){
                const confirmed = confirm(`This report will be sent as ${parts.length} separate messages on "${channel.name}". Send it?`);
                if(!confirmed){
                    return;
                }
            }

            this.isSending = true;

            try {

                for(let i = 0; i < parts.length; i++){

                    this.sendingPartIndex = i;

                    await Connection.sendChannelMessage(channel.idx, parts[i]);

                    // space the parts out so we don't flood the channel
                    if(i < parts.length - 1){
                        await Utils.sleep(ReportEncoder.PART_SEND_DELAY_MILLIS);
                    }

                }

                // show the operator the report landing on the channel
                await this.$router.push({
                    name: "channel.messages",
                    params: {
                        channelIdx: channel.idx.toString(),
                    },
                });

            } catch(e) {
                console.log(e);
                alert(`Failed to send report. ${parts.length > 1 ? `Part ${this.sendingPartIndex + 1} of ${parts.length} did not send.` : ""}`);
            }

            this.isSending = false;
            this.sendingPartIndex = 0;

        },

    },
    computed: {

        forms() {
            return ReportForms;
        },

        channels() {
            return GlobalState.channels;
        },

        selectedChannel() {
            return this.channels.find((channel) => channel.idx === this.selectedChannelIdx) ?? null;
        },

        selectedForm() {
            return this.forms.find((form) => form.id === this.selectedFormId) ?? null;
        },

        // the device advert name, which the firmware prepends to every channel message
        nodeName() {
            return GlobalState.selfInfo?.name ?? "";
        },

        prepared() {

            if(!this.selectedForm){
                return null;
            }

            return ReportEncoder.prepare(this.selectedForm, this.values, this.nodeName);

        },

        sizeSummary() {

            if(!this.prepared){
                return "";
            }

            if(this.prepared.parts === null){
                return "Too long to send";
            }

            const packetLabel = this.prepared.parts.length === 1 ? "packet" : "packets";

            return `${this.prepared.textBytes} bytes, ${this.prepared.parts.length} ${packetLabel}`;

        },

        partDelaySeconds() {
            return Math.round(ReportEncoder.PART_SEND_DELAY_MILLIS / 1000);
        },

        validationMessage() {

            if(!GlobalState.connection){
                return "Not connected to a device.";
            }

            if(!this.selectedChannel){
                return "Select a channel to send on.";
            }

            if(this.prepared?.missingRequiredFields.length > 0){
                const missingLabels = this.selectedForm.fields
                    .filter((field) => this.prepared.missingRequiredFields.includes(field.id))
                    .map((field) => field.label);
                return `Required: ${missingLabels.join(", ")}`;
            }

            if(this.prepared?.parts === null){
                return "This report is too long to send.";
            }

            return null;

        },

        canSend() {
            return !this.isSending
                && this.validationMessage === null
                && this.prepared?.parts?.length > 0;
        },

        sendButtonLabel() {

            if(this.isSending){
                const parts = this.prepared?.parts ?? [];
                if(parts.length > 1){
                    return `Sending ${this.sendingPartIndex + 1} of ${parts.length}...`;
                }
                return "Sending...";
            }

            const partCount = this.prepared?.parts?.length ?? 0;
            if(partCount > 1){
                return `Send report (${partCount} messages)`;
            }

            return "Send report";

        },

    },
}
</script>
