<template>
    <!-- a station has asked for this one's position. Asked in front of whatever is
         on screen, since the asker is waiting and may repeat -->
    <div v-if="prompt" class="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/40 p-4">
        <div role="alertdialog" aria-labelledby="position-prompt-heading" class="w-full max-w-sm bg-white rounded-lg shadow-lg p-4 space-y-3">

            <div id="position-prompt-heading" class="text-sm font-semibold text-gray-900">
                {{ prompt.name }} asks for your position
            </div>

            <div class="text-xs text-gray-600">
                <template v-if="prompt.via.kind === 'channel'">
                    On {{ prompt.via.name }}. Your answer is seen by every station on the channel running this app.
                </template>
                <template v-else>
                    Sent to you directly. Your answer goes only to them.
                </template>
                <span v-if="prompt.count > 1"> Asked {{ prompt.count }} times.</span>
            </div>

            <div class="bg-gray-50 border border-gray-200 rounded p-2 text-xs text-gray-800 space-y-0.5">
                <template v-if="own.has">
                    <div>{{ ownDegrees }}</div>
                    <div v-if="ownMgrs">{{ ownMgrs }}</div>
                    <div class="text-gray-500">{{ own.live ? "Live GPS fix" : "Position set on the radio, not a live fix" }}</div>
                </template>
                <div v-else class="text-amber-800">
                    Your radio has no position set. Sending says so.
                </div>
            </div>

            <div v-if="error" role="status" class="text-xs text-red-600">{{ error }}</div>

            <div class="grid grid-cols-1 gap-2">
                <button
                    @click="send(false)"
                    :disabled="busy"
                    type="button"
                    class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-5 py-2.5">
                    Send
                </button>
                <button
                    @click="send(true)"
                    :disabled="busy"
                    type="button"
                    class="w-full bg-white hover:bg-gray-50 disabled:opacity-60 border border-blue-600 text-blue-700 text-sm font-medium rounded-lg px-5 py-2.5">
                    Send with message
                </button>
                <button
                    @click="decline"
                    :disabled="busy"
                    type="button"
                    class="w-full bg-white hover:bg-gray-50 disabled:opacity-60 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg px-5 py-2.5">
                    Decline
                </button>
            </div>

            <button @click="later" :disabled="busy" type="button" class="w-full text-xs text-gray-500 underline">
                Not now
            </button>

        </div>
    </div>
</template>

<script>
import PositionService from "../../js/position/PositionService.js";
import Geo from "../../js/position/Geo.js";

export default {
    name: 'PositionPrompt',
    data() {
        return {
            busy: false,
            error: null,
        };
    },
    methods: {
        async send(withMessage) {
            const request = this.prompt;
            this.busy = true;
            this.error = null;
            try {
                await PositionService.answer(request, { messageToFollow: withMessage });
                if(withMessage){
                    this.openConversation(request);
                }
            } catch(e) {
                this.error = `Not sent: ${e?.message ?? e}`;
            } finally {
                this.busy = false;
            }
        },
        async decline() {
            this.busy = true;
            this.error = null;
            try {
                await PositionService.decline(this.prompt);
            } catch(e) {
                this.error = `Not sent: ${e?.message ?? e}`;
            } finally {
                this.busy = false;
            }
        },
        later() {
            this.error = null;
            PositionService.dismissPrompt();
        },
        // the message goes where the request came from: its channel, or the
        // conversation with the station that asked
        openConversation(request) {
            if(request.via.kind === "channel"){
                this.$router.push({ name: "channel.messages", params: { channelIdx: String(request.via.idx) } });
            } else {
                this.$router.push({ name: "contact.messages", params: { publicKey: request.via.contactKeyHex } });
            }
        },
    },
    computed: {
        prompt() {
            return PositionService.state.prompt;
        },
        own() {
            // read with the prompt, so it is current when it opens
            void this.prompt;
            return PositionService.ownPosition();
        },
        ownDegrees() {
            return Geo.formatDegrees(this.own.latitude, this.own.longitude);
        },
        ownMgrs() {
            return Geo.formatMgrs(this.own.latitude, this.own.longitude);
        },
    },
}
</script>
