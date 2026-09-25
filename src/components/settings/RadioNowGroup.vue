<template>
    <div>

        <SettingsSection title="Position" note="Where this station is. Not part of a mode: it stays as it is through every switch." sub>
            <div class="p-2 space-y-2">

                <div v-if="notConnected" class="text-xs text-red-600">No radio connected.</div>

                <template v-else>

                    <div class="flex items-center justify-between">
                        <div class="text-xs font-medium text-gray-900">On the radio now</div>
                        <div class="text-xs text-gray-500">{{ positionLabel }}</div>
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                        <label class="block text-xs text-gray-700">Latitude
                            <input v-model="latitude" type="number" placeholder="e.g: -38.664646"
                                   class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                        </label>
                        <label class="block text-xs text-gray-700">Longitude
                            <input v-model="longitude" type="number" placeholder="e.g: 178.023507"
                                   class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                        </label>
                    </div>

                    <div class="flex space-x-2">
                        <button @click="savePosition" :disabled="busy" type="button"
                                class="w-full text-white bg-blue-700 hover:bg-blue-800 disabled:bg-gray-400 text-xs font-medium rounded-lg px-3 py-2">Write to the radio</button>
                        <button @click="setPositionFromGps" :disabled="busy" type="button"
                                class="w-full bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 text-gray-700 text-xs font-medium rounded-lg px-3 py-2">Set from live GPS fix</button>
                    </div>

                    <div class="text-xs text-gray-500">
                        Written when you press, not when the page is saved. A live fix is only taken from one
                        the radio reports now: a node without a receiver is left alone rather than set to 0, 0.
                    </div>

                </template>

            </div>
        </SettingsSection>

        <SettingsSection title="Clock" note="The radio's own clock. Not part of a mode." sub>
            <div class="p-2 space-y-2">

                <div v-if="notConnected" class="text-xs text-red-600">No radio connected.</div>

                <template v-else>
                    <div class="flex items-center justify-between">
                        <div class="text-xs font-medium text-gray-900">Device clock</div>
                        <div class="text-xs" :class="[ driftSeconds != null && driftSeconds > 60 ? 'text-amber-700' : 'text-gray-500' ]">
                            {{ driftLabel }}
                        </div>
                    </div>
                    <button @click="syncClock" :disabled="busy" type="button"
                            class="w-full bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 text-gray-700 text-xs font-medium rounded-lg px-3 py-2">Sync to this device</button>
                    <div class="text-xs text-gray-500">
                        Message times come from the radio, so a clock that has drifted makes a log that
                        disagrees with everyone else's.
                    </div>
                </template>

            </div>
        </SettingsSection>

        <div v-if="error" role="status" class="p-2 text-xs text-red-600">{{ error }}</div>
        <div v-else-if="message" role="status" class="p-2 text-xs text-green-700">{{ message }}</div>

    </div>
</template>

<script>
/**
 * The two things about this radio that no mode holds: where the station is, and
 * what its clock says.
 *
 * They sit in the mode tabs with the operator and the contacts, read the same in
 * every tab, and act when pressed rather than waiting for Save — because neither
 * is a promise about a mode, they are the radio now.
 *
 * There used to be a whole section below the tabs for "the radio right now", and
 * most of it was the mode's settings over again: transmit power, location
 * sharing, automatic contacts, the advert intervals, position answering. Those
 * existed because saving a mode did not reach the radio. Saving the mode in use
 * does now, so the duplicates went and these two are what was left.
 */
import SettingsSection from "./SettingsSection.vue";
import GlobalState from "../../js/GlobalState.js";
import Connection from "../../js/Connection.js";
import EmcommMode from "../../js/EmcommMode.js";

export default {
    name: 'RadioNowGroup',
    components: {
        SettingsSection,
    },
    data() {
        return {
            latitude: null,
            longitude: null,
            driftSeconds: null,
            busy: false,
            message: null,
            error: null,
        };
    },
    mounted() {
        this.fillFromRadio();
        this.readDrift();
    },
    watch: {
        // a reconnect, or a position written from a GPS fix
        "GlobalState.selfInfo"() {
            this.fillFromRadio();
        },
    },
    methods: {

        fillFromRadio() {
            const info = GlobalState.selfInfo;
            if(info == null){
                return;
            }
            // 0, 0 is how a node with no position reports, and it is a real place
            // in the Gulf of Guinea: show it as empty rather than as a location
            const lat = info.advLat ?? 0;
            const lon = info.advLon ?? 0;
            this.latitude = lat === 0 && lon === 0 ? "" : lat / 1000000;
            this.longitude = lat === 0 && lon === 0 ? "" : lon / 1000000;
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
                await Connection.loadSelfInfo(Connection.READ_TIMEOUT_MILLIS);
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

        savePosition() {
            // a cleared number box holds "", not null, so both count as no position
            const lat = this.latitude == null || this.latitude === "" ? 0 : this.latitude;
            const lon = this.longitude == null || this.longitude === "" ? 0 : this.longitude;
            return this.run(
                "Position",
                () => Connection.setAdvertLatLong(Math.floor(lat * 1000000), Math.floor(lon * 1000000)),
                "Position written to the radio.",
            );
        },

        setPositionFromGps() {
            return this.run("Position", () => EmcommMode.applySettings({ setPositionFromGps: true })
                .then((r) => { if(r.failures.length) throw new Error(r.failures[0].reason); }));
        },

        async syncClock() {
            await this.run("Clock sync", () => Connection.syncDeviceTime());
            await this.readDrift();
        },

    },
    computed: {

        GlobalState() {
            return GlobalState;
        },

        notConnected() {
            return GlobalState.connection == null;
        },

        positionLabel() {
            const lat = GlobalState.selfInfo?.advLat ?? 0;
            const lon = GlobalState.selfInfo?.advLon ?? 0;
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
};
</script>
