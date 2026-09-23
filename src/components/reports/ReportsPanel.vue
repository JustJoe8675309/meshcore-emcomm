<template>
    <div class="relative w-full overflow-y-auto">
        <div class="p-3 space-y-3">

            <!-- where the report is sent -->
            <fieldset :disabled="isSending" class="bg-white border border-gray-300 rounded-lg p-3 space-y-3 disabled:opacity-60">

                <div class="space-y-1">
                    <label for="report-destination-type" class="block text-sm font-medium text-gray-900">Send to</label>
                    <select id="report-destination-type" v-model="destinationType" class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                        <option value="channel">Channel</option>
                        <option value="contact">Contact</option>
                    </select>
                </div>

                <!-- broadcast to everyone holding the channel secret -->
                <div v-if="destinationType === 'channel'" class="space-y-1">
                    <label for="report-channel" class="block text-sm font-medium text-gray-900">Channel</label>
                    <SearchableSelect
                        input-id="report-channel"
                        v-model="selectedChannelIdx"
                        :options="channelOptions"
                        placeholder="Select a channel, or type to filter..."/>
                    <div v-if="channels.length === 0" class="text-xs text-red-600">
                        No channels available. Connect to your device first.
                    </div>
                </div>

                <!-- direct to a single station -->
                <div v-else class="space-y-1">
                    <label for="report-contact" class="block text-sm font-medium text-gray-900">Contact</label>
                    <SearchableSelect
                        input-id="report-contact"
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
                <label for="report-form" class="block text-sm font-medium text-gray-900">Report form</label>
                <SearchableSelect
                    input-id="report-form"
                    v-model="selectedFormId"
                    :options="formOptions"
                    placeholder="Select a report, or type to filter..."/>
                <div v-if="selectedForm" class="text-xs text-gray-500">{{ selectedForm.description }}</div>
            </fieldset>

            <!-- form fields -->
            <ReportFormFields
                v-if="selectedForm"
                :fields="selectedForm.fields"
                :values="values"
                :disabled="isSending"
                @input="onFieldInput"/>

            <!-- what will actually be transmitted -->
            <TransmissionPreview
                v-if="selectedForm && prepared"
                :parts="prepared.parts"
                :summary="sizeSummary"
                :part-delay-seconds="partDelaySeconds"
                :is-contact="destinationType === 'contact'"/>

            <!-- outside the send section, which needs a form selected: after the tab
                 was left mid send the form is gone, and this notice with it.
                 a failure part way through a multi part report leaves the earlier
                 messages already transmitted, so offer to finish rather than repeat -->
            <div v-if="sendFailure" role="alert" class="bg-red-50 border border-red-300 rounded-lg p-3 space-y-2">

                <div class="text-sm font-semibold text-red-800">{{ sendFailure.interrupted ? "Report interrupted" : "Transmission failed" }}</div>

                <div v-if="sendFailure.interrupted" class="text-sm text-red-900">
                    The Reports tab was left while <span class="font-semibold">{{ sendFailure.formName }}</span> was sending, so it stopped.
                </div>

                <div class="text-sm text-red-900">
                    <template v-if="sendFailure.totalParts > 1">
                        {{ sendFailure.sentCount }} of {{ sendFailure.totalParts }} messages were sent to
                        <span class="font-semibold">{{ sendFailure.destination.name }}</span>.
                        Message {{ sendFailure.sentCount + 1 }} did not go out.
                    </template>
                    <template v-else>
                        Nothing was sent to <span class="font-semibold">{{ sendFailure.destination.name }}</span>.
                    </template>
                </div>

                <div v-if="!canResume" class="text-xs text-red-900">
                    {{ resumeBlockedReason }}
                </div>

                <div class="flex space-x-2 pt-1">
                    <button
                        @click="dismissFailure"
                        :disabled="isSending"
                        type="button"
                        class="w-full bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg px-5 py-2.5">
                        Dismiss
                    </button>
                    <button
                        v-if="canResume"
                        @click="resumeSend"
                        :disabled="isSending"
                        type="button"
                        class="w-full bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg px-5 py-2.5">
                        {{ resumeButtonLabel }}
                    </button>
                </div>

            </div>

            <!-- channel messages are never acknowledged, so a part can be lost with
                 the sending radio none the wiser. the operator hears about it from the
                 station that is missing it, and needs to send that part, not the lot -->
            <div v-if="lastSent" class="bg-white border border-gray-300 rounded-lg p-3 space-y-2">

                <div class="text-sm font-semibold text-gray-900">Last report sent</div>

                <div class="text-sm text-gray-800">
                    <span class="font-semibold">{{ lastSent.formName }}</span> to
                    <span class="font-semibold">{{ lastSent.destination.name }}</span>
                    at {{ lastSentTime }}, {{ lastSent.allParts.length }} {{ lastSent.allParts.length === 1 ? "message" : "messages" }}.
                </div>

                <div class="text-xs text-gray-600">
                    Channel messages are not acknowledged, so one can be lost without this radio knowing.
                    If a station says a part is missing, resend just that part.
                </div>

                <div v-if="!canResendLast" class="text-xs text-red-900">
                    {{ resendBlockedReason }}
                </div>

                <div class="space-y-1">
                    <div v-for="(part, index) of lastSent.allParts" :key="index" class="flex items-center space-x-2">
                        <div class="flex-1 min-w-0 truncate text-xs text-gray-700">{{ part }}</div>
                        <button
                            @click="resendPart(index)"
                            :disabled="isSending || !canResendLast"
                            type="button"
                            class="shrink-0 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-lg px-3 py-1.5"
                            :class="[ isSending || !canResendLast ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer' ]">
                            {{ resendingPart === index ? "Resending..." : (lastSent.allParts.length === 1 ? "Resend" : `Resend ${index + 1}`) }}
                        </button>
                    </div>
                </div>

                <div v-if="resendNotice" role="status" class="text-xs text-gray-700">{{ resendNotice }}</div>

                <button
                    @click="dismissLastSent"
                    :disabled="isSending"
                    type="button"
                    class="w-full bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg px-5 py-2.5">
                    Done
                </button>

            </div>

            <!-- send -->
            <div v-if="selectedForm" class="space-y-2 pb-3">

                <div v-if="validationMessage" role="status" class="text-xs text-red-600">{{ validationMessage }}</div>

                <div v-if="copyMessage" role="status" class="text-xs text-gray-600">{{ copyMessage }}</div>

                <!-- a long report can hold the channel for minutes, so it takes a second
                     deliberate press. cancel returns to the form with everything intact. -->
                <div v-if="isConfirming && prepared && prepared.parts" role="alertdialog" aria-labelledby="report-confirm-heading" class="bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-2">

                    <div id="report-confirm-heading" class="text-sm font-semibold text-gray-900">Confirm transmission</div>

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
import ContactFlags from "../../js/ContactFlags.js";
import ReportForms from "../../js/reports/ReportForms.js";
import ReportEncoder from "../../js/reports/ReportEncoder.js";
import Airtime from "../../js/reports/Airtime.js";
import TimeUtils from "../../js/TimeUtils.js";
import LastHeard from "../../js/contacts/LastHeard.js";
import OperatorSettings from "../../js/reports/OperatorSettings.js";
import SearchableSelect from "./SearchableSelect.vue";
import ReportFormFields from "./ReportFormFields.vue";
import TransmissionPreview from "./TransmissionPreview.vue";
import ModeProfiles from "../../js/modes/ModeProfiles.js";

export default {
    name: 'ReportsPanel',
    components: {
        SearchableSelect,
        ReportFormFields,
        TransmissionPreview,
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
            sendFailure: null,
            sendingPartIndex: 0,
            // which retry of the current part is in flight, 0 while on the first attempt
            sendingAttempt: 0,
            // cleared when the panel goes away, so a send in progress stops rather
            // than transmitting the rest of the report with nothing on screen
            sendAborted: false,
            // which part of the last report is being sent again, and how that went
            resendingPart: null,
            resendNotice: null,
            copyMessage: null,
            copyMessageTimeout: null,
        };
    },
    /**
     * Switching tabs unmounts this panel. A multi part send left running would keep
     * transmitting with no display and no way to stop it, which is the last thing an
     * app this careful about airtime should do.
     */
    beforeUnmount() {
        this.sendAborted = true;
        clearTimeout(this.copyMessageTimeout);
    },
    mounted() {
        this.clearChannelIfMissing();
        if(GlobalState.interruptedReport != null){
            this.sendFailure = { ...GlobalState.interruptedReport, interrupted: true };
            GlobalState.interruptedReport = null;
        }
    },
    watch: {
        selectedFormId() {
            this.resetForm();
        },
        channels() {
            this.clearChannelIfMissing();
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
        operatorIdentity() {
            // only fill fields the operator has not already typed into
            for(const field of this.selectedForm?.fields ?? []){
                const prefill = this.prefillValueFor(field);
                if(prefill !== null && prefill !== "" && (this.values[field.id] ?? "") === ""){
                    this.values[field.id] = prefill;
                }
            }
        },
    },
    methods: {

        // a channel that disappeared, for example after connecting to a different
        // device, must not stay selected. nothing is auto selected in its place.
        clearChannelIfMissing() {

            if(this.selectedChannelIdx === null){
                return;
            }

            const isSelectionStillValid = this.channels.some((channel) => channel.idx === this.selectedChannelIdx);
            if(!isSelectionStillValid){
                this.selectedChannelIdx = null;
            }

        },

        onFieldInput(fieldId, value) {
            this.values[fieldId] = value;
        },

        // current date time group in the operator's chosen zone
        formatDtg() {
            return OperatorSettings.formatDtg();
        },

        // what a field should be prefilled with, or null if it is not a prefilled field
        prefillValueFor(field) {

            if(field.prefillFromSpotterId){
                return OperatorSettings.spotterId;
            }

            if(field.prefillFromCallsign){
                return OperatorSettings.callsign;
            }

            return null;

        },

        resetForm() {

            this.isConfirming = false;
            this.sendFailure = null;

            const values = {};

            for(const field of this.selectedForm?.fields ?? []){

                // prefill the current time into date time group fields
                if(field.type === "dtg"){
                    values[field.id] = this.formatDtg();
                    continue;
                }

                // prefill identity fields from the operator settings, never from the
                // device advert name. that names the radio, not the operator, and putting
                // something like "Joe-KJ5HBN-HTv3" in a formal CALL field is wrong. left
                // blank when nothing is set, since blank is better than wrong.
                const prefill = this.prefillValueFor(field);
                if(prefill !== null){
                    values[field.id] = prefill;
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

            const result = await Utils.copyToClipboard(this.prepared.text);
            this.copyMessage = result.message;

            // clears itself, since a stale "copied" beside a form edited since would
            // claim something no longer true
            clearTimeout(this.copyMessageTimeout);
            this.copyMessageTimeout = setTimeout(() => {
                this.copyMessage = null;
            }, 4000);

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

            // the destination is captured with the parts. a resume must go to the same
            // place as the messages that already went out, whatever the panel shows by then.
            const destination = {
                isContact: this.destinationType === "contact",
                contact: this.selectedContact,
                channel: this.selectedChannel,
                name: this.destinationName,
            };

            this.isConfirming = false;

            await this.transmit(this.prepared.parts, destination, 0, this.selectedForm.name);

        },

        // picks up where a partial send stopped, retransmitting only what never went out
        async resumeSend() {

            const failure = this.sendFailure;
            // the button is hidden when this is false; checked here as well so no
            // other way in can send the rest through the wrong radio
            if(!failure || !this.canResume){
                return;
            }

            await this.transmit(failure.allParts, failure.destination, failure.sentCount, failure.formName);

        },

        dismissFailure() {
            this.sendFailure = null;
        },

        dismissLastSent() {
            GlobalState.lastSentReport = null;
            this.resendNotice = null;
        },

        // one part of the last report again, exactly as it first went out, to the same
        // channel through the same radio
        async resendPart(index) {

            const report = this.lastSent;
            if(!report || !this.canResendLast || this.isSending){
                return;
            }

            const label = report.allParts.length === 1 ? "The report" : `Part ${index + 1} of ${report.allParts.length}`;

            this.isSending = true;
            this.resendingPart = index;
            this.resendNotice = null;

            try {
                await Connection.sendChannelMessage(report.destination.channel.idx, report.allParts[index]);
                this.resendNotice = `${label} went out again at ${this.formatTime(Date.now())}.`;
            } catch(e) {
                console.log(e);
                this.resendNotice = `${label} did not go out: ${e?.message ?? e}`;
            } finally {
                this.isSending = false;
                this.resendingPart = null;
            }

        },

        channelGapFor(parts) {
            return Airtime.channelPartGapMillis(parts, this.nodeName, GlobalState.selfInfo, ReportEncoder.PART_SEND_DELAY_MILLIS);
        },

        formatTime(millis) {
            return new Date(millis).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        },

        // sends parts from startIndex onwards, recording exactly how many made it so a
        // failure half way through a multi part report can be finished rather than
        // repeated. resending parts that already arrived is not harmless: the receiving
        // operator sees the same numbered fragment twice.
        async transmit(parts, destination, startIndex, formName) {

            this.sendFailure = null;
            this.isSending = true;

            var sentCount = startIndex;

            try {

                for(let i = startIndex; i < parts.length; i++){

                    // the panel went away mid send. stop, and keep the record somewhere
                    // that outlives the panel: this component's own copy goes with it,
                    // and the operator came back to an empty form with nothing to say
                    // the report had gone out incomplete. resuming is their call
                    if(this.sendAborted){
                        GlobalState.interruptedReport = {
                            allParts: parts,
                            destination: destination,
                            sentCount: sentCount,
                            totalParts: parts.length,
                            formName: formName ?? "A report",
                            nodePublicKey: this.connectedNodeKey,
                        };
                        return;
                    }

                    this.sendingPartIndex = i;

                    const isLastPart = i === parts.length - 1;

                    if(destination.isContact){

                        // the device tracks one outstanding direct message, so sending the
                        // next part before this one is acknowledged loses it. wait for the
                        // acknowledgement rather than guessing at a delay, and retransmit a
                        // part that does not arrive rather than building on top of it
                        let status = null;

                        for(let attempt = 0; attempt <= Connection.MAX_PART_RETRIES; attempt++){

                            if(attempt > 0){
                                this.sendingAttempt = attempt;
                                await Utils.sleep(Connection.retryBackoffMillis(attempt));
                            }

                            const sent = await Connection.sendMessage(destination.contact.publicKey, parts[i]);

                            // nothing follows the last part, so there is nothing for it to
                            // collide with and no reason to hold the operator through a
                            // round trip. it reports its own delivery in the conversation
                            if(isLastPart){
                                status = "delivered";
                                break;
                            }

                            status = await Connection.waitForDelivery(
                                sent.id,
                                sent.estTimeout + Connection.DELIVERY_GRACE_MILLIS,
                            );

                            if(status === "delivered"){
                                break;
                            }

                        }

                        this.sendingAttempt = 0;

                        // out of attempts. stop rather than transmitting on top of it, and
                        // leave sentCount at i so resuming retransmits this part, which is
                        // right: it went out but never arrived
                        if(status !== "delivered"){
                            throw new Error(`part ${i + 1} of ${parts.length} was not acknowledged after ${Connection.MAX_PART_RETRIES + 1} attempts (${status})`);
                        }

                    } else {
                        await Connection.sendChannelMessage(destination.channel.idx, parts[i]);
                    }

                    sentCount = i + 1;

                    // channel messages are never acknowledged, so the only thing available
                    // to stop them treading on each other is a gap. direct messages already
                    // waited for the acknowledgement above, which spaces them out for free
                    if(!isLastPart && !destination.isContact){
                        await Utils.sleep(this.channelGapFor(parts));
                    }

                }

            } catch(e) {
                console.log(e);
                this.sendFailure = {
                    allParts: parts,
                    destination: destination,
                    sentCount: sentCount,
                    totalParts: parts.length,
                    formName: formName ?? "A report",
                    nodePublicKey: this.connectedNodeKey,
                };
            }

            this.isSending = false;
            this.sendingPartIndex = 0;
            this.sendingAttempt = 0;

            if(this.sendFailure){
                return;
            }

            // kept so a part a station never got can be sent again. direct messages
            // are acknowledged part by part and retransmitted, so only channels need it
            if(!destination.isContact){
                GlobalState.lastSentReport = {
                    allParts: parts,
                    destination: destination,
                    formName: formName ?? "A report",
                    nodePublicKey: this.connectedNodeKey,
                    sentAt: Date.now(),
                };
                this.resendNotice = null;
            }

            // show the operator the report landing in the conversation.
            // deliberately outside the try: navigating is not part of transmitting, and
            // a routing failure must never be reported as a failed send.
            if(destination.isContact){
                await this.$router.push({
                    name: "contact.messages",
                    params: {
                        publicKey: destination.contact.publicKeyHex,
                    },
                });
            } else {
                await this.$router.push({
                    name: "channel.messages",
                    params: {
                        channelIdx: destination.channel.idx.toString(),
                    },
                });
            }

        },

    },
    computed: {
        // in a training mode every part says DRILL, budgeted for in the split
        marksDrill() {
            void ModeProfiles.state.revision;
            return ModeProfiles.marksDrill();
        },

        // ICS forms first in number order, then everything else alphabetically.
        // Sorting purely by name would bury ICS-209 between Damage Assessment and
        // Net Check-Out, which reads as though the numbering means nothing.
        forms() {
            const isIcs = (form) => form.name.startsWith("ICS-");
            return [...ReportForms].sort((a, b) => {
                if(isIcs(a) !== isIcs(b)){
                    return isIcs(a) ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });
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
                    favorite: contact.favorite,
                    // shown beside the name, not searched
                    hint: TimeUtils.formatUnixSecondsAgo(LastHeard.at(contact.lastAdvert) ?? 0),
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
                        favorite: ContactFlags.isFavourite(contact),
                    };
                })
                // most recently heard first. a station that adverted minutes ago is far
                // more likely to still be reachable than one last heard weeks back, and
                // the picker is searchable now so alphabetical order buys little
                .sort((a, b) => (LastHeard.at(b.lastAdvert) ?? 0) - (LastHeard.at(a.lastAdvert) ?? 0));
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

        // one value so a change to either the callsign or the spotter number
        // re-runs the prefill
        operatorIdentity() {
            return `${OperatorSettings.state.callsign}|${OperatorSettings.state.skywarnNumber}`;
        },

        // the device advert name, which the firmware prepends to every channel message
        nodeName() {
            return GlobalState.selfInfo?.name ?? "";
        },

        prepared() {

            if(!this.selectedForm){
                return null;
            }

            return ReportEncoder.prepare(this.selectedForm, this.values, this.nodeName, this.destinationType, { markDrill: this.marksDrill });

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
            return Math.round(this.partGapMillis / 1000);
        },

        // the gap between parts of this report. Only channel parts use it: direct
        // parts wait for their acknowledgement instead
        partGapMillis() {
            return this.channelGapFor(this.prepared?.parts ?? []);
        },

        lastSent() {
            return GlobalState.lastSentReport;
        },

        lastSentTime() {
            return this.lastSent ? this.formatTime(this.lastSent.sentAt) : "";
        },

        // a channel is a slot number on the radio, so a resent part must go through
        // the radio the report went through, or it could land on another channel
        canResendLast() {
            const report = this.lastSent;
            if(report == null || GlobalState.connection == null){
                return false;
            }
            return report.nodePublicKey == null || report.nodePublicKey === this.connectedNodeKey;
        },

        resendBlockedReason() {
            if(GlobalState.connection == null){
                return "No radio is connected, so nothing can be resent yet.";
            }
            return "A different radio is connected now. Reconnect the radio the report went out on to resend a part.";
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
                this.partGapMillis,
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

        connectedNodeKey() {
            const key = GlobalState.selfInfo?.publicKey;
            return key == null ? null : Utils.bytesToHex(key);
        },

        // a channel is a slot number on the radio, so the rest of a report must go
        // out through the radio the start went through, or it could land on
        // another channel entirely
        canResume() {
            const failure = this.sendFailure;
            if(failure == null || GlobalState.connection == null){
                return false;
            }
            if(failure.nodePublicKey != null && failure.nodePublicKey !== this.connectedNodeKey){
                return false;
            }
            return true;
        },

        resumeBlockedReason() {
            if(GlobalState.connection == null){
                return "No radio is connected, so the rest cannot be sent yet.";
            }
            return "A different radio is connected now, so the rest cannot be sent from here. Reconnect the radio it started on to finish it.";
        },

        resumeButtonLabel() {

            if(!this.sendFailure){
                return "";
            }

            const remaining = this.sendFailure.totalParts - this.sendFailure.sentCount;
            if(this.sendFailure.sentCount > 0){
                return `Send remaining ${remaining}`;
            }

            return "Try again";

        },

        sendButtonLabel() {

            if(this.isSending){

                const parts = this.prepared?.parts ?? [];

                // say so when a part is being retransmitted, so a send that looks stalled
                // is visibly still working rather than apparently hung
                if(this.sendingAttempt > 0){
                    return `Retrying ${this.sendingPartIndex + 1} of ${parts.length}, attempt ${this.sendingAttempt + 1}...`;
                }

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
