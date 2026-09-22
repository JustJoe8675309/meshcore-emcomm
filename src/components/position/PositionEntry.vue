<template>
    <!-- a position typed by the operator, in either form. The same fields are used
         when answering a request and when updating this station's own position, so
         one of them cannot quietly accept what the other refuses -->
    <div class="space-y-2">

        <!-- the same position two ways: decimal degrees, or the MGRS reference a
             map or a SAR team gives -->
        <div class="flex rounded border border-gray-300 overflow-hidden text-xs" role="group" aria-label="Enter as">
            <button type="button" @click="$emit('mode', 'degrees')" :aria-pressed="mode === 'degrees'"
                class="w-full px-2 py-1" :class="mode === 'degrees' ? 'bg-amber-100 font-semibold text-amber-900' : 'bg-white text-gray-600'">Degrees</button>
            <button type="button" @click="$emit('mode', 'mgrs')" :aria-pressed="mode === 'mgrs'"
                class="w-full px-2 py-1 border-l border-gray-300" :class="mode === 'mgrs' ? 'bg-amber-100 font-semibold text-amber-900' : 'bg-white text-gray-600'">MGRS</button>
        </div>

        <template v-if="mode === 'degrees'">
            <div class="flex space-x-2">
                <label class="w-full text-xs text-gray-700">Latitude
                    <input :value="latitude" @input="$emit('latitude', $event.target.value)" type="number" step="any" inputmode="decimal" placeholder="31.9270" class="mt-0.5 w-full bg-white border border-gray-300 text-sm rounded p-1.5">
                </label>
                <label class="w-full text-xs text-gray-700">Longitude
                    <input :value="longitude" @input="$emit('longitude', $event.target.value)" type="number" step="any" inputmode="decimal" placeholder="-106.4001" class="mt-0.5 w-full bg-white border border-gray-300 text-sm rounded p-1.5">
                </label>
            </div>
            <div v-if="position" class="text-xs text-gray-600"><MapLink :latitude="position.latitude" :longitude="position.longitude" :text="positionMgrs" label="Position entered"/></div>
            <div v-if="invalid" class="text-xs text-red-600">
                Not a position: latitude -90 to 90, longitude -180 to 180, south and west negative.
            </div>
        </template>

        <template v-else>
            <label class="block text-xs text-gray-700">MGRS reference
                <input :value="mgrsText" @input="$emit('mgrsText', $event.target.value)" type="text" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="13R CR 67640 33201" class="mt-0.5 w-full bg-white border border-gray-300 text-sm rounded p-1.5 uppercase">
            </label>
            <div v-if="position" class="text-xs text-gray-600">
                <MapLink :latitude="position.latitude" :longitude="position.longitude" :text="positionDegrees" label="Position entered"/><span v-if="precision > 1">, to within {{ precision }} m</span>
            </div>
            <div v-if="invalid" class="text-xs text-red-600">
                Not an MGRS reference. For example 13R CR 67640 33201: zone and band, the two
                square letters, then an even number of digits.
            </div>
        </template>

    </div>
</template>

<script>
import Geo from "../../js/position/Geo.js";
import MapLink from "./MapLink.vue";

export default {
    name: 'PositionEntry',
    components: {
        MapLink,
    },
    props: {
        mode: String,
        latitude: [String, Number],
        longitude: [String, Number],
        mgrsText: String,
        // what the fields parse to, or null: the owner decides what counts
        position: Object,
        invalid: Boolean,
    },
    emits: ["mode", "latitude", "longitude", "mgrsText"],
    computed: {
        positionMgrs() {
            return this.position ? Geo.formatMgrs(this.position.latitude, this.position.longitude) : null;
        },
        positionDegrees() {
            return this.position ? Geo.formatDegrees(this.position.latitude, this.position.longitude) : null;
        },
        precision() {
            return this.position?.precision ?? 1;
        },
    },
}
</script>
