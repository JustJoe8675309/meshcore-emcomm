<template>
    <div class="w-full overflow-y-auto bg-gray-50">
        <div class="p-3 space-y-3">

            <!-- where the report is sent -->
            <fieldset :disabled="isSending" class="bg-white border border-gray-300 rounded-lg p-3 space-y-3 disabled:opacity-60">

                <div class="space-y-1">
                    <label class="block text-sm font-medium text-gray-900">Send to</label>
                    <select v-model="destinationType" class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                        <option value="channel">Channel</option>
                        <option value="contact">Contact</option>
                    </select>
                </div>

                <!-- broadcast to everyone holding the channel secret -->
                <div v-if="destinationType === 'channel'" class="space-y-1">
                    <label class="block text-sm font-medium text-gray-900">Channel</label>
                    <SearchableSelect
                        v-model="selectedChannelIdx"
                        :options="channelOptions"
                        placeholder="Select a channel, or type to filter..."/>
                    <div v-if="channels.length === 0" class="text-xs text-red-600">
                        No channels available. Connect to your device first.
                    </div>
                </div>

                <!-- direct to a single station -->
                <div v-else class="space-y-1">
                    <label class="block text-sm font-medium text-gray-900">Contact</label>
                    <SearchableSelect
                        v-model="selectedContactPublicKey"
                        :options="contactOptions"
                        placeholder="Select a contact, or type to filter..."/>
                    <div v-if="chatContacts.length === 0" class="text-xs text-red-600">
                        No messageable contacts. Only chat contacts can receive a report.
                    </div>
                    <div v-else class="text-xs text-gray-500">
                        Sent directly to one station, with delivery confirmation.
                    </div>
                </div>

            </fieldset>

            <!-- report type -->
            <fieldset :disabled="isSending" class="bg-white border border-gray-300 rounded-lg p-3 space-y-1 disabled:opacity-60">
                <label class="block text-sm font-medium text-gray-900">Report form</label>
                <SearchableSelect
                    v-model="selectedFormId"
                    :options="formOptions"
                    placeholder="Select a report, or type to filter..."/>
                <div v-if="selectedForm" class="text-xs text-gray-500">{{ selectedForm.description }}</div>
            </fieldset>

            <!-- form fields -->
            <fieldset v-if="selectedForm" :disabled="isSending" class="bg-white border border-gray-300 rounded-lg p-3 space-y-3 disabled:opacity-60">

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

            </fieldset>

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

                <!-- a long report can hold the channel for minutes, so it takes a second
                     deliberate press. cancel returns to the form with everything intact. -->
                <div v-if="isConfirming && prepared && prepared.parts" class="bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-2">

                    <div class="text-sm font-semibold text-gray-900">Confirm transmission</div>

                    <div class="text-sm text-gray-800 space-y-0.5">
                        <div>To <span class="font-semibold">{{ destinationName }}</span></div>
                        <div>
                            <span class="font-semibold">{{ prepared.parts.length }}</span>
                            {{ prepared.parts.length === 1 ? "transmission" : "transmissions" }}<span v-if="airtimeLabel">, about <span class="font-semibold">{{ airtimeLabel }}</span> on the air</span>
                        </div>
                    </div>

                    <div v-if="isLongTransmission" class="text-xs text-amber-900">
                        This will occupy the channel for a while. On a busy net, consider shortening the
                        report or sending it to a single station instead.
                    </div>

                    <div class="flex space-x-2 pt-1">
                        <button
                            @click="cancelSend"
                            type="button"
                            class="w-full bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg px-5 py-2.5">
                            Cancel
                        </button>
                        <button
                            @click="confirmSend"
                            type="button"
                            class="w-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg px-5 py-2.5">
                            Send now
                        </button>
                    </div>

                </div>

                <div class="flex space-x-2">

                    <button
                        v-if="!isConfirming"
                        @click="onSendClick"
                        :disabled="!canSend"
                        type="button"
                        class="w-full text-white text-sm font-medium rounded-lg px-5 py-2.5"
                        :class="[ canSend ? 'bg-blue-500 hover:bg-blue-600 cursor-pointer' : 'bg-gray-300 cursor-not-allowed' ]">
                        {{ sendButtonLabel }}
                    </button>

                    <button
                        @click="copyReport"
                        :disabled="!canCopy"
                        type="button"
                        class="shrink-0 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg px-5 py-2.5"
                        :class="[
                            canCopy ? 'hover:bg-gray-50 cursor-pointer' : 'opacity-50 cursor-not-allowed',
                            isConfirming ? 'w-full' : '',
                        ]">
                        Copy
                    </button>

                </div>

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
import { Constants } from "@liamcottle/meshcore.js";
import GlobalState from "../../js/GlobalState.js";
import Connection from "../../js/Connection.js";
import Utils from "../../js/Utils.js";
import ReportForms from "../../js/reports/ReportForms.js";
import ReportEncoder from "../../js/reports/ReportEncoder.js";
import Airtime from "../../js/reports/Airtime.js";
import TimeUtils from "../../js/TimeUtils.js";
import SearchableSelect from "./SearchableSelect.vue";

export default {
    name: 'ReportsPanel',
    components: {
        SearchableSelect,
    },
    data() {
        return {
            destinationType: "channel",
            selectedChannelIdx: null,
            selectedContactPublicKey: null,
            selectedFormId: null,
            values: {},
            isConfirming: false,
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
        // any change to the report or its destination invalidates a pending
        // confirmation, so what was approved on screen is always what gets sent
        "prepared.text"() {
            this.isConfirming = false;
        },
        destinationType() {
            this.isConfirming = false;
        },
        selectedChannelIdx() {
            this.isConfirming = false;
        },
        selectedContactPublicKey() {
            this.isConfirming = false;
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

            this.isConfirming = false;

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

        // copies the report as one block, without the [n/m] markers, since this is
        // for use off the air: pasting into a log, an email, or another app
        async copyReport() {

            if(!this.canCopy){
                return;
            }

            await Utils.copyToClipboard(this.prepared.text);

        },

        // first press only opens the confirmation, nothing is transmitted yet
        onSendClick() {

            if(!this.canSend){
                return;
            }

            this.isConfirming = true;

        },

        // operator changed their mind, back to the form with everything still filled in
        cancelSend() {
            this.isConfirming = false;
        },

        async confirmSend() {

            if(!this.canSend){
                this.isConfirming = false;
                return;
            }

            const parts = this.prepared.parts;
            const isContact = this.destinationType === "contact";
            const contact = this.selectedContact;
            const channel = this.selectedChannel;

            this.isConfirming = false;
            this.isSending = true;

            var sentEverything = false;

            try {

                for(let i = 0; i < parts.length; i++){

                    this.sendingPartIndex = i;

                    if(isContact){
                        await Connection.sendMessage(contact.publicKey, parts[i]);
                    } else {
                        await Connection.sendChannelMessage(channel.idx, parts[i]);
                    }

                    // space the parts out so we don't flood the channel
                    if(i < parts.length - 1){
                        await Utils.sleep(ReportEncoder.PART_SEND_DELAY_MILLIS);
                    }

                }

                sentEverything = true;

            } catch(e) {
                console.log(e);
                alert(`Failed to send report. ${parts.length > 1 ? `Part ${this.sendingPartIndex + 1} of ${parts.length} did not send.` : ""}`);
            }

            this.isSending = false;
            this.sendingPartIndex = 0;

            // show the operator the report landing in the conversation.
            // deliberately outside the try: navigating is not part of transmitting, and
            // a routing failure must never be reported as a failed send.
            if(sentEverything){
                if(isContact){
                    await this.$router.push({
                        name: "contact.messages",
                        params: {
                            publicKey: contact.publicKeyHex,
                        },
                    });
                } else {
                    await this.$router.push({
                        name: "channel.messages",
                        params: {
                            channelIdx: channel.idx.toString(),
                        },
                    });
                }
            }

        },

    },
    computed: {

        // names start with the form number, so this orders 209, 211, 213, 213RR
        forms() {
            return [...ReportForms].sort((a, b) => a.name.localeCompare(b.name));
        },

        formOptions() {
            return this.forms.map((form) => {
                return {
                    value: form.id,
                    label: form.name,
                };
            });
        },

        contactOptions() {
            return this.chatContacts.map((contact) => {
                return {
                    value: contact.publicKeyHex,
                    label: contact.name,
                    // shown beside the name, not searched
                    hint: TimeUtils.formatUnixSecondsAgo(contact.lastAdvert),
                };
            });
        },

        // the value stays a number here, unlike the string ids elsewhere, because
        // selectedChannel matches on idx with strict equality
        channelOptions() {
            return this.channels.map((channel) => {
                return {
                    value: channel.idx,
                    label: channel.name,
                };
            });
        },

        channels() {
            return GlobalState.channels;
        },

        selectedChannel() {
            return this.channels.find((channel) => channel.idx === this.selectedChannelIdx) ?? null;
        },

        // only chat contacts can receive a message, repeaters and rooms cannot
        chatContacts() {
            return GlobalState.contacts
                .filter((contact) => contact.type === Constants.AdvType.Chat)
                .map((contact) => {
                    return {
                        name: contact.advName?.trim() || `(unnamed ${Utils.bytesToHex(contact.publicKey).slice(0, 8)})`,
                        publicKey: contact.publicKey,
                        publicKeyHex: Utils.bytesToHex(contact.publicKey),
                        lastAdvert: contact.lastAdvert,
                    };
                })
                // most recently heard first. a station that adverted minutes ago is far
                // more likely to still be reachable than one last heard weeks back, and
                // the picker is searchable now so alphabetical order buys little
                .sort((a, b) => (b.lastAdvert ?? 0) - (a.lastAdvert ?? 0));
        },

        selectedContact() {
            return this.chatContacts.find((contact) => contact.publicKeyHex === this.selectedContactPublicKey) ?? null;
        },

        // name of whichever destination is currently selected
        destinationName() {
            return this.destinationType === "contact"
                ? this.selectedContact?.name ?? null
                : this.selectedChannel?.name ?? null;
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

            return ReportEncoder.prepare(this.selectedForm, this.values, this.nodeName, this.destinationType);

        },

        sizeSummary() {

            if(!this.prepared){
                return "";
            }

            if(this.prepared.parts === null){
                return "Too long to send";
            }

            const packetLabel = this.prepared.parts.length === 1 ? "packet" : "packets";
            const size = `${this.prepared.textBytes} bytes, ${this.prepared.parts.length} ${packetLabel}`;

            return this.airtimeLabel ? `${size}, ~${this.airtimeLabel} on air` : size;

        },

        partDelaySeconds() {
            return Math.round(ReportEncoder.PART_SEND_DELAY_MILLIS / 1000);
        },

        // estimated time this report will occupy the channel, using the radio
        // settings the device reported. null if those are not known yet.
        airtime() {

            if(!this.prepared || !this.prepared.parts || this.prepared.parts.length === 0){
                return null;
            }

            return Airtime.estimate(
                this.prepared.parts,
                this.destinationType,
                this.nodeName,
                GlobalState.selfInfo,
                ReportEncoder.PART_SEND_DELAY_MILLIS,
            );

        },

        airtimeLabel() {
            return this.airtime ? Airtime.formatDuration(this.airtime.totalMillis) : null;
        },

        // worth calling out before the operator ties up a shared channel
        isLongTransmission() {
            return this.airtime != null && this.airtime.totalMillis > 30000;
        },

        validationMessage() {

            if(!GlobalState.connection){
                return "Not connected to a device.";
            }

            if(this.destinationType === "contact" && !this.selectedContact){
                return "Select a contact to send to.";
            }

            if(this.destinationType === "channel" && !this.selectedChannel){
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

        // deliberately not gated on being connected or having a destination: copying
        // is an offline action. it is gated on the report being complete, so an
        // incomplete form cannot hand over a stub that reads like a finished report.
        canCopy() {
            return this.prepared != null
                && this.prepared.text !== ""
                && this.prepared.missingRequiredFields.length === 0;
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
