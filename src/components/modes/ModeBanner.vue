<template>
    <!-- what mode this station is in, across the width of the header, where it
         cannot be missed. Colour and words both, since colour alone is no use to
         an operator who cannot tell red from green -->
    <button
        v-if="connected"
        @click="open"
        type="button"
        :class="classes"
        class="block w-full text-center text-xs font-bold tracking-wide px-2 py-1 rounded">
        {{ label }}<span class="font-normal"> · tap to change</span>
    </button>
</template>

<script>
import GlobalState from "../../js/GlobalState.js";
import ModeProfiles, { MODE_CLASSES } from "../../js/modes/ModeProfiles.js";

export default {
    name: 'ModeBanner',
    emits: ["open"],
    methods: {
        open() {
            this.$emit("open");
        },
    },
    computed: {
        connected() {
            return GlobalState.connection != null && GlobalState.selfInfo != null;
        },
        mode() {
            // both of these make this follow a change: the stored mode is not
            // reactive by itself
            void ModeProfiles.state.revision;
            void GlobalState.emcommModeRevision;
            return ModeProfiles.current();
        },
        label() {
            return ModeProfiles.label(this.mode);
        },
        classes() {
            return MODE_CLASSES[this.mode] ?? MODE_CLASSES.normal;
        },
    },
}
</script>
