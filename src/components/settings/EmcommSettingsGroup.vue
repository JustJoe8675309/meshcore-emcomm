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

        <!-- radio, shown but not edited here -->
        <div class="w-full p-2 space-y-1">
            <div class="text-sm font-medium text-gray-900">Radio</div>
            <div class="text-xs text-gray-700 font-mono">
                {{ current.radioFreq }} kHz &middot; BW {{ current.radioBw }} &middot; SF {{ current.radioSf }} &middot; CR {{ current.radioCr }}
            </div>
            <div class="text-xs" :class="[ onUsPreset ? 'text-gray-500' : 'text-amber-700' ]">
                {{ onUsPreset ? "Matches the USA / Canada preset." : "Does not match the USA / Canada preset." }}
            </div>
            <div class="text-xs text-gray-500">
                Changed in Radio Settings above, deliberately not here. This is the one setting that can
                leave the node unable to hear anybody, and it should not sit beside the emergency controls.
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
import Utils from "../../js/Utils.js";

export default {
    name: 'EmcommSettingsGroup',
    data() {
        return {
            busy: false,
            message: null,
            error: null,
            driftSeconds: null,
        };
    },
    mounted() {
        this.readDrift();
    },
    methods: {

        async readDrift() {
            try {
                const time = await GlobalState.connection?.getDeviceTime();
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

        inEmcommMode() {
            const key = GlobalState.selfInfo?.publicKey;
            return key != null && EmcommMode.enteredAt(Utils.bytesToHex(key)) != null;
        },

        modeLabel() {
            const key = GlobalState.selfInfo?.publicKey;
            const at = key == null ? null : EmcommMode.enteredAt(Utils.bytesToHex(key));
            return at == null ? "Not in EMCOMM mode" : `In EMCOMM mode since ${new Date(at).toLocaleString()}`;
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

        onUsPreset() {
            return EmcommMode.radioMatches(this.current, EmcommMode.US_PRESET);
        },

    },
}
</script>
