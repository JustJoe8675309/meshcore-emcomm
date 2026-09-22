<template>
    <div class="w-full">
        <RouterView/>

        <!-- the first connection to a radio takes seconds, most of it reading the
             contact list, and until it is done the tabs show a node with nothing
             on it. Shown on every page, since connecting can start from any -->
        <BusyOverlay
            v-if="GlobalState.connecting"
            title="Connecting to the radio"
            :step="GlobalState.connecting.step"
            :done="GlobalState.connecting.done"
            :total="GlobalState.connecting.total"
            cancel-label="Disconnect"
            @cancel="disconnect"/>

        <!-- asked for this station's position, and asking another for theirs -->
        <PositionPrompt/>
        <PositionRequestDialog/>
    </div>
</template>

<script>
import GlobalState from "../js/GlobalState.js";
import Connection from "../js/Connection.js";
import BusyOverlay from "./BusyOverlay.vue";
import PositionPrompt from "./position/PositionPrompt.vue";
import PositionRequestDialog from "./position/PositionRequestDialog.vue";

export default {
    name: 'App',
    components: {
        BusyOverlay,
        PositionPrompt,
        PositionRequestDialog,
    },
    data() {
        return {
            GlobalState,
        };
    },
    methods: {
        async disconnect() {
            await Connection.disconnect();
        },
    },
}
</script>
