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
                    <div v-if="checking" class="text-gray-500">Checking whether the GPS fix is current...</div>
                    <div v-else-if="check && check.live" class="text-gray-500">Current GPS fix. Checked again when you send.</div>
                    <div v-else class="text-amber-800">
                        This would go as a <span class="font-semibold">last known position, not a current fix</span>:
                        {{ own.live ? "the GPS position has stopped changing." : "it is set on the radio, with no live GPS." }}
                    </div>
                </template>
                <div v-else class="text-amber-800">
                    Your radio has no position set. Sending says so.
                </div>
            </div>

            <!-- the radio has only a last known position, or none: the operator can say
                 where they are now. It is saved to the radio, becomes the position it
                 holds, and goes out marked as entered by hand -->
            <div v-if="offerEntry" class="space-y-2">
                <button
                    v-if="!entering"
                    @click="startEntry"
                    :disabled="busy"
                    type="button"
                    class="w-full bg-white hover:bg-gray-50 disabled:opacity-60 border border-amber-600 text-amber-800 text-sm font-medium rounded-lg px-5 py-2">
                    Enter current position
                </button>
                <div v-else class="border border-amber-300 rounded p-2 space-y-2">
                    <div class="text-xs text-gray-700">
                        Where you are now, in decimal degrees. Saved to the radio as its position, and sent
                        marked as entered by hand.
                    </div>
                    <div class="flex space-x-2">
                        <label class="w-full text-xs text-gray-700">Latitude
                            <input v-model="entryLatitude" type="number" step="any" inputmode="decimal" placeholder="31.9270" class="mt-0.5 w-full bg-white border border-gray-300 text-sm rounded p-1.5">
                        </label>
                        <label class="w-full text-xs text-gray-700">Longitude
                            <input v-model="entryLongitude" type="number" step="any" inputmode="decimal" placeholder="-106.4001" class="mt-0.5 w-full bg-white border border-gray-300 text-sm rounded p-1.5">
                        </label>
                    </div>
                    <div v-if="entryMgrs" class="text-xs text-gray-600">{{ entryMgrs }}</div>
                    <div v-if="entryInvalid" class="text-xs text-red-600">
                        Not a position: latitude -90 to 90, longitude -180 to 180, south and west negative.
                    </div>
                    <button @click="cancelEntry" :disabled="busy" type="button" class="w-full text-xs text-gray-500 underline">
                        Send the last known position instead
                    </button>
                </div>
            </div>

            <div v-if="error" role="status" class="text-xs text-red-600">{{ error }}</div>

            <div class="grid grid-cols-1 gap-2">
                <button
                    @click="send(false)"
                    :disabled="busy || entryBlocks"
                    type="button"
                    class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-5 py-2.5">
                    {{ entering ? "Save to radio and send" : "Send" }}
                </button>
                <button
                    @click="send(true)"
                    :disabled="busy || entryBlocks"
                    type="button"
                    class="w-full bg-white hover:bg-gray-50 disabled:opacity-60 border border-blue-600 text-blue-700 text-sm font-medium rounded-lg px-5 py-2.5">
                    {{ entering ? "Save to radio and send with message" : "Send with message" }}
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
            // whether the position the radio holds is a current fix, found when the
            // prompt opens so it can say so, and offer an entry, before anything is sent
            checking: false,
            check: null,
            entering: false,
            entryLatitude: "",
            entryLongitude: "",
        };
    },
    watch: {
        // a new requester, not a repeat of the same one, starts afresh
        promptKey: {
            handler(key) {
                this.entering = false;
                this.entryLatitude = "";
                this.entryLongitude = "";
                this.check = null;
                if(key != null){
                    this.runCheck();
                }
            },
            immediate: true,
        },
    },
    methods: {
        async runCheck() {
            const key = this.promptKey;
            this.checking = true;
            try {
                const result = await PositionService.currentPosition();
                if(this.promptKey === key){
                    this.check = result;
                }
            } catch(e) {
                this.check = null;
            } finally {
                if(this.promptKey === key){
                    this.checking = false;
                }
            }
        },
        startEntry() {
            this.entering = true;
            // start from what the radio holds, which is usually close
            if(this.own.has){
                this.entryLatitude = this.own.latitude.toFixed(4);
                this.entryLongitude = this.own.longitude.toFixed(4);
            }
        },
        cancelEntry() {
            this.entering = false;
        },
        async send(withMessage) {
            const request = this.prompt;
            this.busy = true;
            this.error = null;
            try {
                const manualPosition = this.entering
                    ? { latitude: Number(this.entryLatitude), longitude: Number(this.entryLongitude) }
                    : null;
                await PositionService.answer(request, { messageToFollow: withMessage, manualPosition });
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
        promptKey() {
            return this.prompt ? `${this.prompt.fromPrefixHex}` : null;
        },
        // offered once it is known the position would go as last known, or there
        // is none at all
        offerEntry() {
            if(this.checking){
                return false;
            }
            return !this.own.has || !(this.check && this.check.live);
        },
        entryInvalid() {
            return this.entering && (this.entryLatitude !== "" || this.entryLongitude !== "")
                && !PositionService.isValidEntry(this.entryLatitude, this.entryLongitude);
        },
        entryBlocks() {
            return this.entering && !PositionService.isValidEntry(this.entryLatitude, this.entryLongitude);
        },
        entryMgrs() {
            if(!this.entering || !PositionService.isValidEntry(this.entryLatitude, this.entryLongitude)){
                return null;
            }
            return Geo.formatMgrs(Number(this.entryLatitude), Number(this.entryLongitude));
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
