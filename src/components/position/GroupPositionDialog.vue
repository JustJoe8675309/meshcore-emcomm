<template>
    <!-- a roll call of every station on a channel or in a room, or this station's
         own position sent to all of them unasked -->
    <div v-if="target" class="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/40 p-4 overflow-y-auto">
        <div role="dialog" aria-labelledby="group-position-heading" class="w-full max-w-sm bg-white rounded-lg shadow-lg p-4 space-y-3">

            <div id="group-position-heading" class="text-sm font-semibold text-gray-900">
                {{ isShare ? `Send my position ${where}` : `Position roll call ${where}` }}
            </div>

            <div class="text-xs text-gray-500">
                <template v-if="isRoom">
                    Posted in the room, so everyone in it sees it. Stock apps show it as a line of text
                    with a code after it. Each post takes one of the 32 places the room keeps for
                    members who are away.
                </template>
                <template v-else>
                    Every station on the channel running this app sees it. Stock apps show nothing.
                </template>
            </div>

            <!-- sending this station's position -->
            <template v-if="isShare">
                <div class="bg-gray-50 border border-gray-200 rounded p-2 text-xs text-gray-800 space-y-0.5">
                    <template v-if="own.has">
                        <div>{{ ownDegrees }}</div>
                        <div v-if="ownMgrs">{{ ownMgrs }}</div>
                        <div v-if="checking" class="text-gray-500">Checking whether the GPS fix is current...</div>
                        <div v-else-if="check && check.live" class="text-gray-500">Current GPS fix. Checked again when you send.</div>
                        <div v-else class="text-amber-800">
                            This would go as a <span class="font-semibold">last known position, not a current fix</span>.
                        </div>
                    </template>
                    <div v-else class="text-amber-800">
                        Your radio has no position set, so there is nothing to send. Set one in Settings.
                    </div>
                </div>
            </template>

            <!-- a roll call -->
            <template v-else>
                <fieldset class="space-y-2">
                    <legend class="block text-sm font-medium text-gray-900">How often</legend>

                    <label class="flex items-start space-x-2 text-sm text-gray-800">
                        <input type="radio" value="once" v-model="modeType" class="mt-0.5">
                        <span>Once</span>
                    </label>

                    <label class="flex items-start space-x-2 text-sm text-gray-800">
                        <input type="radio" value="again" v-model="modeType" class="mt-0.5">
                        <span>Up to
                            <input v-model.number="maxCount" :disabled="modeType !== 'again'" type="number" min="1" step="1" aria-label="Most roll calls to send" class="w-14 mx-1 bg-gray-50 border border-gray-300 text-sm rounded p-1">
                            times, every
                            <input v-model.number="intervalMinutes" :disabled="modeType !== 'again'" type="number" :min="minInterval" step="1" aria-label="Minutes between roll calls" class="w-16 mx-1 bg-gray-50 border border-gray-300 text-sm rounded p-1">
                            minutes, for stations not yet heard</span>
                    </label>

                    <label class="flex items-start space-x-2 text-sm text-gray-800">
                        <input type="radio" value="track" v-model="modeType" class="mt-0.5">
                        <span>Track:
                            <input v-model.number="maxCount" :disabled="modeType !== 'track'" type="number" min="1" step="1" aria-label="Most roll calls to send" class="w-14 mx-1 bg-gray-50 border border-gray-300 text-sm rounded p-1">
                            roll calls, every
                            <input v-model.number="intervalMinutes" :disabled="modeType !== 'track'" type="number" :min="minInterval" step="1" aria-label="Minutes between roll calls" class="w-16 mx-1 bg-gray-50 border border-gray-300 text-sm rounded p-1">
                            minutes, everyone each time</span>
                    </label>
                </fieldset>

                <div v-if="intervalTooShort" role="status" class="text-xs text-red-600">
                    The shortest interval for a roll call is {{ minInterval }} minutes.
                </div>
                <div v-else-if="intervalCaution" role="status" class="text-xs text-amber-800">
                    Every roll call brings an answer from every station, and each floods the mesh. Under
                    {{ cautionInterval }} minutes is a lot of traffic on a busy net.
                </div>

                <div class="text-xs text-gray-500">
                    Only stations that have ticked this {{ isRoom ? "room" : "channel" }} for position requests
                    answer. Those answering automatically wait a random moment, up to {{ spreadSeconds }} s, so
                    their answers do not collide. Answers are listed in Positions, and it listens for 5 minutes
                    after the last roll call.
                </div>
            </template>

            <div v-if="notConnected" role="status" class="text-xs text-red-600">No radio connected.</div>
            <div v-if="error" role="status" class="text-xs text-red-600">{{ error }}</div>

            <div class="flex space-x-2 pt-1">
                <button @click="close" :disabled="busy" type="button" class="w-full bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg px-5 py-2.5">
                    Cancel
                </button>
                <button
                    @click="go"
                    :disabled="!canGo"
                    type="button"
                    class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-5 py-2.5">
                    {{ isShare ? "Send" : "Start roll call" }}
                </button>
            </div>

        </div>
    </div>
</template>

<script>
import GlobalState from "../../js/GlobalState.js";
import Geo from "../../js/position/Geo.js";
import PositionService, { GROUP_MIN_INTERVAL_MINUTES, GROUP_CAUTION_INTERVAL_MINUTES } from "../../js/position/PositionService.js";

export default {
    name: 'GroupPositionDialog',
    data() {
        return {
            modeType: "once",
            intervalMinutes: 15,
            maxCount: 3,
            busy: false,
            error: null,
            checking: false,
            check: null,
        };
    },
    watch: {
        // a fresh form each time it opens
        target: {
            handler(value) {
                this.modeType = "once";
                this.intervalMinutes = 15;
                this.maxCount = 3;
                this.error = null;
                this.check = null;
                if(value?.action === "share"){
                    this.runCheck();
                }
            },
            immediate: true,
        },
    },
    methods: {
        close() {
            PositionService.closeGroup();
        },
        async runCheck() {
            const target = this.target;
            this.checking = true;
            try {
                const result = await PositionService.currentPosition();
                if(this.target === target){
                    this.check = result;
                }
            } catch(e) {
                this.check = null;
            } finally {
                this.checking = false;
            }
        },
        async go() {
            if(!this.canGo){
                return;
            }
            const via = this.target.via;
            if(this.isShare){
                this.busy = true;
                this.error = null;
                try {
                    await PositionService.shareOwn(via);
                    this.close();
                } catch(e) {
                    this.error = `Not sent: ${e?.message ?? e}`;
                } finally {
                    this.busy = false;
                }
                return;
            }
            PositionService.startRollCall(via, {
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
            return PositionService.state.groupTarget;
        },
        isShare() {
            return this.target?.action === "share";
        },
        isRoom() {
            return this.target?.via.kind === "room";
        },
        where() {
            return this.isRoom ? `in ${this.target.via.name}` : `on ${this.target?.via.name}`;
        },
        own() {
            void this.check;
            return PositionService.ownPosition();
        },
        ownDegrees() {
            return Geo.formatDegrees(this.own.latitude, this.own.longitude);
        },
        ownMgrs() {
            return Geo.formatMgrs(this.own.latitude, this.own.longitude);
        },
        notConnected() {
            return GlobalState.connection == null;
        },
        repeats() {
            return this.modeType !== "once";
        },
        minInterval() {
            return GROUP_MIN_INTERVAL_MINUTES;
        },
        cautionInterval() {
            return GROUP_CAUTION_INTERVAL_MINUTES;
        },
        spreadSeconds() {
            return Math.round(PositionService.rollCallSpreadMillis() / 1000);
        },
        intervalTooShort() {
            return this.repeats && !(Number(this.intervalMinutes) >= GROUP_MIN_INTERVAL_MINUTES);
        },
        intervalCaution() {
            return this.repeats && Number(this.intervalMinutes) < GROUP_CAUTION_INTERVAL_MINUTES;
        },
        canGo() {
            if(this.notConnected || this.busy){
                return false;
            }
            if(this.isShare){
                return this.own.has && !this.checking;
            }
            if(this.intervalTooShort){
                return false;
            }
            return !(this.repeats && !(Number(this.maxCount) >= 1));
        },
    },
}
</script>
