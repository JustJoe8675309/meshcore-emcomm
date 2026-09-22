<template>
    <!-- a station has asked for this one's position. Asked in front of whatever is
         on screen, since the asker is waiting and may repeat -->
    <div v-if="prompt" class="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/40 p-4">
        <div role="alertdialog" aria-labelledby="position-prompt-heading" class="w-full max-w-sm bg-white rounded-lg shadow-lg p-4 space-y-3">

            <div id="position-prompt-heading" class="text-sm font-semibold text-gray-900">
                <template v-if="prompt.rollCall">{{ prompt.name }} asks everyone for their position</template>
                <template v-else>{{ prompt.name }} asks for your position</template>
            </div>

            <div class="text-xs text-gray-600">
                <template v-if="prompt.via.kind === 'channel'">
                    On {{ prompt.via.name }}. Your answer is seen by every station on the channel running this app.
                </template>
                <template v-else-if="prompt.via.kind === 'room'">
                    In the room {{ prompt.via.name }}. Your answer is posted in the room, so everyone in it sees
                    it, stock apps as a line of text.
                </template>
                <template v-else>
                    Sent to you directly. Your answer goes only to them.
                </template>
                <span v-if="prompt.count > 1"> Asked {{ prompt.count }} times.</span>
            </div>

            <div v-if="waitingAfter > 0" class="text-xs font-semibold text-blue-700">
                {{ waitingAfter }} more {{ waitingAfter === 1 ? "station is" : "stations are" }} waiting, and will be asked after this one:
                {{ waitingNames }}.
            </div>

            <div class="bg-gray-50 border border-gray-200 rounded p-2 text-xs text-gray-800 space-y-0.5">
                <template v-if="own.has">
                    <div><MapLink :latitude="own.latitude" :longitude="own.longitude" :text="ownDegrees" label="Your position"/></div>
                    <div v-if="ownMgrs"><MapLink :latitude="own.latitude" :longitude="own.longitude" :text="ownMgrs" label="Your position"/></div>
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
                        Where you are now. Saved to the radio as its position, and sent marked as entered by hand.
                    </div>

                    <!-- the same position two ways: decimal degrees, or the MGRS reference a
                         map or a SAR team gives -->
                    <div class="flex rounded border border-gray-300 overflow-hidden text-xs" role="group" aria-label="Enter as">
                        <button type="button" @click="setEntryMode('degrees')" :aria-pressed="entryMode === 'degrees'"
                            class="w-full px-2 py-1" :class="entryMode === 'degrees' ? 'bg-amber-100 font-semibold text-amber-900' : 'bg-white text-gray-600'">Degrees</button>
                        <button type="button" @click="setEntryMode('mgrs')" :aria-pressed="entryMode === 'mgrs'"
                            class="w-full px-2 py-1 border-l border-gray-300" :class="entryMode === 'mgrs' ? 'bg-amber-100 font-semibold text-amber-900' : 'bg-white text-gray-600'">MGRS</button>
                    </div>

                    <template v-if="entryMode === 'degrees'">
                        <div class="flex space-x-2">
                            <label class="w-full text-xs text-gray-700">Latitude
                                <input v-model="entryLatitude" type="number" step="any" inputmode="decimal" placeholder="31.9270" class="mt-0.5 w-full bg-white border border-gray-300 text-sm rounded p-1.5">
                            </label>
                            <label class="w-full text-xs text-gray-700">Longitude
                                <input v-model="entryLongitude" type="number" step="any" inputmode="decimal" placeholder="-106.4001" class="mt-0.5 w-full bg-white border border-gray-300 text-sm rounded p-1.5">
                            </label>
                        </div>
                        <div v-if="entryPosition" class="text-xs text-gray-600"><MapLink :latitude="entryPosition.latitude" :longitude="entryPosition.longitude" :text="entryPositionMgrs" label="Position entered"/></div>
                        <div v-if="entryInvalid" class="text-xs text-red-600">
                            Not a position: latitude -90 to 90, longitude -180 to 180, south and west negative.
                        </div>
                    </template>

                    <template v-else>
                        <label class="block text-xs text-gray-700">MGRS reference
                            <input v-model="entryMgrsText" type="text" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="13R CR 67640 33201" class="mt-0.5 w-full bg-white border border-gray-300 text-sm rounded p-1.5 uppercase">
                        </label>
                        <div v-if="entryPosition" class="text-xs text-gray-600">
                            <MapLink :latitude="entryPosition.latitude" :longitude="entryPosition.longitude" :text="entryPositionDegrees" label="Position entered"/><span v-if="entryPrecision > 1">, to within {{ entryPrecision }} m</span>
                        </div>
                        <div v-if="entryInvalid" class="text-xs text-red-600">
                            Not an MGRS reference. For example 13R CR 67640 33201: zone and band, the two
                            square letters, then an even number of digits.
                        </div>
                    </template>
                    <button @click="cancelEntry" :disabled="busy" type="button" class="w-full text-xs text-gray-500 underline">
                        {{ own.has ? "Send the last known position instead" : "Send without a position" }}
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
import Mgrs from "../../js/position/Mgrs.js";
import MapLink from "./MapLink.vue";

export default {
    name: 'PositionPrompt',
    components: {
        MapLink,
    },
    data() {
        return {
            busy: false,
            error: null,
            // whether the position the radio holds is a current fix, found when the
            // prompt opens so it can say so, and offer an entry, before anything is sent
            checking: false,
            check: null,
            entering: false,
            entryMode: "degrees",
            entryLatitude: "",
            entryLongitude: "",
            entryMgrsText: "",
        };
    },
    watch: {
        // a new requester, not a repeat of the same one, starts afresh
        promptKey: {
            handler(key) {
                this.entering = false;
                this.entryMode = "degrees";
                this.entryLatitude = "";
                this.entryLongitude = "";
                this.entryMgrsText = "";
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
                this.entryMgrsText = Geo.formatMgrs(this.own.latitude, this.own.longitude) ?? "";
            }
        },
        setEntryMode(mode) {
            // carry the position across, so switching does not lose what was typed
            const position = this.entryPosition;
            if(position){
                if(mode === "mgrs"){
                    this.entryMgrsText = Geo.formatMgrs(position.latitude, position.longitude) ?? "";
                } else {
                    this.entryLatitude = position.latitude.toFixed(5);
                    this.entryLongitude = position.longitude.toFixed(5);
                }
            }
            this.entryMode = mode;
        },
        cancelEntry() {
            this.entering = false;
        },
        async send(withMessage) {
            const request = this.prompt;
            this.busy = true;
            this.error = null;
            try {
                const manualPosition = this.entering ? this.entryPosition : null;
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
        // the message goes where the request came from: its channel, its room, or
        // the conversation with the station that asked. A room's conversation is
        // opened by its key, as a contact's is
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
        waitingAfter() {
            return Math.max(0, PositionService.state.prompts.length - 1);
        },
        waitingNames() {
            return PositionService.state.prompts.slice(1).map((p) => p.name).join(", ");
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
        // what the operator has typed, as a position, in either form, or null
        entryPosition() {
            if(!this.entering){
                return null;
            }
            if(this.entryMode === "mgrs"){
                const parsed = Mgrs.toLatLon(this.entryMgrsText);
                return parsed && PositionService.isValidEntry(parsed.latitude, parsed.longitude)
                    ? { latitude: parsed.latitude, longitude: parsed.longitude, precision: parsed.precisionMetres }
                    : null;
            }
            return PositionService.isValidEntry(this.entryLatitude, this.entryLongitude)
                ? { latitude: Number(this.entryLatitude), longitude: Number(this.entryLongitude), precision: null }
                : null;
        },
        entryTyped() {
            return this.entryMode === "mgrs"
                ? this.entryMgrsText.trim() !== ""
                : this.entryLatitude !== "" || this.entryLongitude !== "";
        },
        entryInvalid() {
            return this.entering && this.entryTyped && this.entryPosition == null;
        },
        entryBlocks() {
            return this.entering && this.entryPosition == null;
        },
        entryPositionMgrs() {
            return this.entryPosition ? Geo.formatMgrs(this.entryPosition.latitude, this.entryPosition.longitude) : null;
        },
        entryPositionDegrees() {
            return this.entryPosition ? Geo.formatDegrees(this.entryPosition.latitude, this.entryPosition.longitude) : null;
        },
        entryPrecision() {
            return this.entryPosition?.precision ?? 1;
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
