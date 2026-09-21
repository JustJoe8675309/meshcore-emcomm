<template>
    <div class="bg-white divide-y">

        <div class="bg-white p-2 font-semibold flex items-center justify-between">
            <span>EMCOMM Settings</span>
            <span class="text-xs font-normal" :class="[ inEmcommMode ? 'text-amber-700' : 'text-gray-500' ]">
                {{ modeLabel }}
            </span>
        </div>

        <div class="p-2 text-xs text-gray-500">
            The settings EMCOMM mode changes, so they can be set or put back one at a time. Each
            takes effect on the radio straight away; the groups above still edit the same values.
        </div>

        <!-- automatic contacts -->
        <div class="w-full p-2 space-y-1">
            <div class="flex items-center justify-between">
                <div class="text-sm font-medium text-gray-900">Add contacts automatically</div>
                <div class="text-xs text-gray-500">{{ current.manualAddContacts === 1 ? "Off" : "On" }}</div>
            </div>
            <button
                @click="toggleManualAdd"
                :disabled="busy || notConnected"
                type="button"
                class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-xs px-3 py-2">
                {{ current.manualAddContacts === 1 ? "Turn on" : "Turn off" }}
            </button>
            <div class="text-xs text-gray-500">
                Off keeps a trimmed list trimmed. On lets the node re-add every station it hears.
            </div>
        </div>

        <!-- transmit power -->
        <div class="w-full p-2 space-y-1">
            <div class="flex items-center justify-between">
                <div class="text-sm font-medium text-gray-900">Transmit power</div>
                <div class="text-xs text-gray-500">{{ current.txPower }} of {{ current.maxTxPower }} dBm</div>
            </div>
            <button
                @click="setMaxPower"
                :disabled="busy || notConnected || current.txPower === current.maxTxPower"
                type="button"
                class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-xs px-3 py-2">
                {{ current.txPower === current.maxTxPower ? "Already at maximum" : `Raise to ${current.maxTxPower} dBm` }}
            </button>
        </div>

        <!-- advert position -->
        <div class="w-full p-2 space-y-1">
            <div class="flex items-center justify-between">
                <div class="text-sm font-medium text-gray-900">Advert position</div>
                <div class="text-xs text-gray-500">{{ positionLabel }}</div>
            </div>
            <button
                @click="setPositionFromGps"
                :disabled="busy || notConnected"
                type="button"
                class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-xs px-3 py-2">Set from live GPS fix</button>
            <div class="text-xs text-gray-500">
                Only written from a fix the radio reports now. A node without a receiver is left alone
                rather than set to 0, 0.
            </div>
        </div>

        <!-- device clock -->
        <div class="w-full p-2 space-y-1">
            <div class="flex items-center justify-between">
                <div class="text-sm font-medium text-gray-900">Device clock</div>
                <div class="text-xs" :class="[ driftSeconds != null && driftSeconds > 60 ? 'text-amber-700' : 'text-gray-500' ]">
                    {{ driftLabel }}
                </div>
            </div>
            <button
                @click="syncClock"
                :disabled="busy || notConnected"
                type="button"
                class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-xs px-3 py-2">Sync to this device</button>
        </div>

        <!-- repeating adverts -->
        <div class="w-full p-2 space-y-2">

            <div class="flex items-center justify-between">
                <div class="text-sm font-medium text-gray-900">Repeating adverts</div>
                <div class="text-xs text-gray-500">{{ advertRunningLabel }}</div>
            </div>

            <div>
                <label for="zero-hop-advert-minutes" class="block mb-1 text-xs font-medium text-gray-900">Zero hop advert, every</label>
                <div class="flex items-center gap-2">
                    <input
                        id="zero-hop-advert-minutes"
                        v-model="zeroHopMinutes"
                        type="number"
                        min="0"
                        inputmode="numeric"
                        placeholder="off"
                        class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                    <span class="text-xs text-gray-500 shrink-0">minutes</span>
                </div>
            </div>

            <div>
                <label for="flood-advert-minutes" class="block mb-1 text-xs font-medium text-gray-900">Flood routed advert, every</label>
                <div class="flex items-center gap-2">
                    <input
                        id="flood-advert-minutes"
                        v-model="floodMinutes"
                        type="number"
                        min="0"
                        inputmode="numeric"
                        placeholder="off"
                        class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                    <span class="text-xs text-gray-500 shrink-0">minutes</span>
                </div>
            </div>

            <div v-if="floodTooFast" role="status" class="text-xs text-amber-700">
                Every repeater that hears a flood advert rebroadcasts it, so this one is paid for by
                the whole mesh. Under {{ floodCautionMinutes }} minutes is worth a second thought.
            </div>

            <button
                @click="saveAdvertSchedule"
                :disabled="busy"
                type="button"
                class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-xs px-3 py-2">Apply advert schedule</button>

            <div class="text-xs text-gray-500">
                Leave blank or set 0 to turn one off. Kept per node and restarted when it reconnects.
                Nothing is sent the moment you apply: the first one goes out after a full interval.
            </div>

        </div>

        <div v-if="notConnected" role="status" class="p-2 text-xs text-red-600">
            No radio connected, so nothing can be changed.
        </div>

        <div v-if="message" role="status" class="p-2 text-xs text-green-700">{{ message }}</div>
        <div v-if="error" role="status" class="p-2 text-xs text-red-600">{{ error }}</div>

    </div>
</template>

<script>
import GlobalState from "../../js/GlobalState.js";
import Connection from "../../js/Connection.js";
import EmcommMode from "../../js/EmcommMode.js";
import AdvertSchedule from "../../js/AdvertSchedule.js";
import Utils from "../../js/Utils.js";

export default {
    name: 'EmcommSettingsGroup',
    data() {
        return {
            busy: false,
            message: null,
            error: null,
            driftSeconds: null,
            zeroHopMinutes: "",
            floodMinutes: "",
        };
    },
    mounted() {
        this.loadAdvertSchedule();
        this.readDrift();
    },
    methods: {

        loadAdvertSchedule() {
            const schedule = AdvertSchedule.get(this.nodePublicKey);
            // zero means off, and an off field should read as empty rather than as
            // a zero somebody might take for a real interval
            this.zeroHopMinutes = schedule.zeroHopMinutes === 0 ? "" : String(schedule.zeroHopMinutes);
            this.floodMinutes = schedule.floodMinutes === 0 ? "" : String(schedule.floodMinutes);
        },

        saveAdvertSchedule() {

            this.message = null;
            this.error = null;

            const saved = AdvertSchedule.set(this.nodePublicKey, {
                zeroHopMinutes: this.zeroHopMinutes,
                floodMinutes: this.floodMinutes,
            });

            // read back what was stored, so a clamped or rejected value shows in the
            // field rather than leaving the operator believing the number they typed
            this.zeroHopMinutes = saved.zeroHopMinutes === 0 ? "" : String(saved.zeroHopMinutes);
            this.floodMinutes = saved.floodMinutes === 0 ? "" : String(saved.floodMinutes);

            AdvertSchedule.start(this.nodePublicKey);

            const parts = [];
            if(saved.zeroHopMinutes > 0){
                parts.push(`zero hop every ${saved.zeroHopMinutes} min`);
            }
            if(saved.floodMinutes > 0){
                parts.push(`flood every ${saved.floodMinutes} min`);
            }

            this.message = parts.length === 0
                ? "Repeating adverts are off."
                : `Adverts scheduled: ${parts.join(", ")}.`;

        },

        async readDrift() {
            try {
                const time = await Connection.getDeviceTime();
                this.driftSeconds = time == null ? null : Math.abs(Math.floor(Date.now() / 1000) - time.epochSecs);
            } catch(e) {
                this.driftSeconds = null;
            }
        },

        async run(what, action, doneMessage = null) {

            this.busy = true;
            this.message = null;
            this.error = null;

            try {
                await action();
                // read back rather than assume: the device owns these values
                await Connection.loadSelfInfo();
                this.message = doneMessage ?? `${what} done.`;
            } catch(e) {
                const reason = String(e?.message ?? e);
                this.error = reason === Connection.DISCONNECTED
                    ? "The radio disconnected, so nothing was changed."
                    : `${what} failed: ${reason}`;
            } finally {
                this.busy = false;
            }

        },

        setMaxPower() {
            return this.run("Transmit power", () => EmcommMode.applySettings({ txPower: this.current.maxTxPower })
                .then((r) => { if(r.failures.length) throw new Error(r.failures[0].reason); }));
        },

        setPositionFromGps() {
            return this.run("Position", () => EmcommMode.applySettings({ setPositionFromGps: true })
                .then((r) => { if(r.failures.length) throw new Error(r.failures[0].reason); }));
        },

        async syncClock() {
            await this.run("Clock sync", () => Connection.syncDeviceTime());
            await this.readDrift();
        },

        toggleManualAdd() {
            const turningOff = this.current.manualAddContacts !== 1;
            return this.run(
                "Automatic contacts",
                () => EmcommMode.setManualAddContacts(turningOff),
                turningOff ? "Contacts are no longer added automatically." : "Contacts are added automatically again.",
            );
        },

    },
    computed: {

        current() {
            return GlobalState.selfInfo ?? {};
        },

        notConnected() {
            return GlobalState.connection == null;
        },

        nodePublicKey() {
            const key = GlobalState.selfInfo?.publicKey;
            return key == null ? null : Utils.bytesToHex(key);
        },

        inEmcommMode() {
            return this.nodePublicKey != null && EmcommMode.enteredAt(this.nodePublicKey) != null;
        },

        modeLabel() {
            const at = this.nodePublicKey == null ? null : EmcommMode.enteredAt(this.nodePublicKey);
            return at == null ? "Not in EMCOMM mode" : `In EMCOMM mode since ${new Date(at).toLocaleString()}`;
        },

        floodCautionMinutes() {
            return AdvertSchedule.FLOOD_CAUTION_MINUTES;
        },

        floodTooFast() {
            return AdvertSchedule.isFloodTooFast(this.floodMinutes);
        },

        advertRunningLabel() {
            // read from reactive state rather than from the timers themselves: a
            // computed with no reactive dependency never recomputes, and this one
            // sat on "Off" while the radio adverted every minute
            const running = GlobalState.advertScheduleRunning;
            if(running.length === 0){
                return "Off";
            }
            return running.map((kind) => kind === "flood" ? "Flood" : "Zero hop").join(" and ") + " running";
        },

        positionLabel() {
            const lat = this.current.advLat ?? 0;
            const lon = this.current.advLon ?? 0;
            // zero is how a node with no position reports, and it is a real place
            // in the Gulf of Guinea, so it is named as unset rather than shown
            if(lat === 0 && lon === 0){
                return "Not set";
            }
            return `${(lat / 1000000).toFixed(4)}, ${(lon / 1000000).toFixed(4)}`;
        },

        driftLabel() {
            if(this.driftSeconds == null){
                return "Unknown";
            }
            return this.driftSeconds < 2 ? "In step" : `${this.driftSeconds}s out`;
        },

    },
}
</script>
