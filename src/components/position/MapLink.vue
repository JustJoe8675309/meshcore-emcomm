<template>
    <!-- a position, as text that opens the device's own map app on it. The same
         point whether it is written in degrees or as an MGRS reference -->
    <a
        v-if="href"
        :href="href"
        :target="opensInBrowser ? '_blank' : null"
        :rel="opensInBrowser ? 'noopener noreferrer' : null"
        :title="`Open in maps${label ? `: ${label}` : ''}`"
        class="underline decoration-dotted underline-offset-2 text-blue-700 hover:text-blue-900">{{ text }}</a>
    <span v-else>{{ text }}</span>
</template>

<script>
import Geo from "../../js/position/Geo.js";

export default {
    name: 'MapLink',
    props: {
        latitude: Number,
        longitude: Number,
        // what is shown: the degrees or the MGRS reference
        text: String,
        // the pin's label in the map app, usually the station's name
        label: {
            type: String,
            default: "",
        },
    },
    computed: {
        href() {
            return Geo.mapLink(this.latitude, this.longitude, this.label);
        },
        // a geo: link is handed to an app; a web map opens in a new tab so the
        // app is still here to come back to
        opensInBrowser() {
            return this.href?.startsWith("https:") ?? false;
        },
    },
}
</script>
