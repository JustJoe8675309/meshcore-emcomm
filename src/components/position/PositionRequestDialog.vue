<template>
    <div v-if="target" class="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/40 p-4 overflow-y-auto">
        <div role="dialog" aria-labelledby="position-request-heading" class="w-full max-w-sm bg-white rounded-lg shadow-lg p-4 space-y-3">

            <div id="position-request-heading" class="text-sm font-semibold text-gray-900">
                Request position from {{ targetName }}
            </div>

            <!-- route -->
            <div class="space-y-1">
                <label for="position-request-via" class="block text-sm font-medium text-gray-900">Send it</label>
                <select id="position-request-via" v-model="viaKey" class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg block w-full p-2.5">
                    <option value="direct">Direct to {{ targetName }}</option>
                    <option v-for="channel of channels" :key="channel.idx" :value="`channel:${channel.idx}`">On {{ channel.name }}</option>
                </select>
                <div class="text-xs text-gray-500">
                    <template v-if="viaKey === 'direct'">
                        Only the two of you see the answer. Without this app, they see the request as a line of text.
                    </template>
                    <template v-else>
                        Every station on the channel running this app sees the answer. They answer only if
                        they have ticked this channel for position requests. Stock apps show nothing.
                    </template>
                </div>
            </div>

            <!-- how often -->
            <fieldset class="space-y-2">
                <legend class="block text-sm font-medium text-gray-900">How often</legend>

                <label class="flex items-start space-x-2 text-sm text-gray-800">
                    <input type="radio" value="once" v-model="modeType" class="mt-0.5">
                    <span>Once</span>
                </label>

                <label class="flex items-start space-x-2 text-sm text-gray-800">
                    <input type="radio" value="until" v-model="modeType" class="mt-0.5">
                    <span>Every
                        <input v-model.number="intervalMinutes" :disabled="modeType !== 'until'" type="number" min="1" step="1" aria-label="Minutes between requests" class="w-16 mx-1 bg-gray-50 border border-gray-300 text-sm rounded p-1">
                        minutes until it is answered</span>
                </label>

                <label class="flex items-start space-x-2 text-sm text-gray-800">
                    <input type="radio" value="count" v-model="modeType" class="mt-0.5">
                    <span>Up to
                        <input v-model.number="maxCount" :disabled="modeType !== 'count'" type="number" min="1" step="1" aria-label="Most requests to send" class="w-14 mx-1 bg-gray-50 border border-gray-300 text-sm rounded p-1">
                        times, every
                        <input v-model.number="intervalMinutes" :disabled="modeType !== 'count'" type="number" min="1" step="1" aria-label="Minutes between requests" class="w-16 mx-1 bg-gray-50 border border-gray-300 text-sm rounded p-1">
                        minutes, or until it is answered</span>
                </label>
            </fieldset>

            <div v-if="intervalTooShort" role="status" class="text-xs text-red-600">
                The shortest interval is {{ minInterval }} minute.
            </div>
            <div v-else-if="intervalCaution" role="status" class="text-xs text-amber-800">
                Every request floods the whole mesh, like a flood advert. Under {{ cautionInterval }} minutes
                is a lot of traffic on a busy net.
            </div>

            <div v-if="repeats" class="text-xs text-gray-500">
                Repeats need this app on screen, so the screen is kept on while they run. If its app
                does not answer within 30 seconds, the station's radio is asked instead, which only
                works if it has a GPS and shares its location.
            </div>

            <div v-if="notConnected" role="status" class="text-xs text-red-600">No radio connected.</div>

            <div class="flex space-x-2 pt-1">
                <button @click="close" type="button" class="w-full bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg px-5 py-2.5">
                    Cancel
                </button>
                <button
                    @click="send"
                    :disabled="!canSend"
                    type="button"
                    class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-5 py-2.5">
                    Request
                </button>
            </div>

        </div>
    </div>
</template>

<script>
import GlobalState from "../../js/GlobalState.js";
import PositionService, { MIN_INTERVAL_MINUTES, CAUTION_INTERVAL_MINUTES } from "../../js/position/PositionService.js";

export default {
    name: 'PositionRequestDialog',
    data() {
        return {
            viaKey: "direct",
            modeType: "once",
            intervalMinutes: 10,
            maxCount: 3,
        };
    },
    watch: {
        // a fresh form for each station
        target(value) {
            if(value){
                this.viaKey = "direct";
                this.modeType = "once";
                this.intervalMinutes = 10;
                this.maxCount = 3;
            }
        },
    },
    methods: {
        close() {
            PositionService.closeRequest();
        },
        send() {
            if(!this.canSend){
                return;
            }
            const via = this.viaKey === "direct"
                ? { kind: "direct" }
                : (() => {
                    const idx = Number(this.viaKey.split(":")[1]);
                    const channel = this.channels.find((c) => c.idx === idx);
                    return { kind: "channel", idx, name: channel?.name };
                })();
            PositionService.start(this.target, via, {
                type: this.modeType,
                intervalMinutes: this.intervalMinutes,
                maxCount: this.maxCount,
            });
            this.close();
            this.$router.push({ name: "main", query: { tab: "positions" } });
        },
    },
    computed: {
        target() {
            return PositionService.state.requestTarget;
        },
        targetName() {
            return PositionService.contactName(this.target);
        },
        channels() {
            return GlobalState.channels;
        },
        notConnected() {
            return GlobalState.connection == null;
        },
        repeats() {
            return this.modeType !== "once";
        },
        minInterval() {
            return MIN_INTERVAL_MINUTES;
        },
        cautionInterval() {
            return CAUTION_INTERVAL_MINUTES;
        },
        intervalTooShort() {
            return this.repeats && !(Number(this.intervalMinutes) >= MIN_INTERVAL_MINUTES);
        },
        intervalCaution() {
            return this.repeats && Number(this.intervalMinutes) < CAUTION_INTERVAL_MINUTES;
        },
        canSend() {
            if(this.notConnected || this.intervalTooShort){
                return false;
            }
            if(this.modeType === "count" && !(Number(this.maxCount) >= 1)){
                return false;
            }
            return true;
        },
    },
}
</script>
