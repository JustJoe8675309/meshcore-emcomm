<template>
    <div v-if="open" class="fixed inset-0 z-50 flex bg-black/40 p-3 overflow-y-auto" @click.self="skip">
        <div role="dialog" aria-label="Setup wizard" class="m-auto w-full max-w-lg bg-white rounded-lg shadow divide-y">

            <div class="p-3">
                <div class="font-semibold">Setup wizard</div>
                <div class="text-xs text-gray-500">
                    Step {{ stepNumber }} of {{ steps.length }}<span v-if="stepMode"> · {{ labelFor(stepMode) }}</span>
                </div>
            </div>

            <!-- what this is and what it will not do -->
            <div v-if="step === 'intro'" class="p-3 space-y-2 text-sm text-gray-700">
                <p>
                    This station has three modes, and each one holds its own node name, radio
                    settings and channels. This walks through them once so they are ready
                    before an incident, rather than being set up during one.
                </p>
                <ul class="list-disc pl-5 space-y-1 text-xs">
                    <li><span class="font-semibold">Normal mode</span> is the radio as it was when this app first read it. Change it only if what was read is wrong.</li>
                    <li><span class="font-semibold">Emcomm-Training</span> is for drills. Everything it sends is marked DRILL.</li>
                    <li><span class="font-semibold">Emcomm-Live</span> is for a real incident.</li>
                </ul>
                <p class="text-xs text-amber-800">
                    Nothing here is written to the radio. A mode is written when you enter it, from
                    the banner at the top of the app, which says what it will change before it does.
                </p>
            </div>

            <!-- one mode at a time, in the same editor the settings page uses, so
                 there is no second copy of these fields to drift from the first -->
            <template v-else-if="stepMode">
                <div class="p-3 text-xs text-gray-600">{{ noteFor(stepMode) }}</div>
                <ModeSettingsTabs :only="stepMode" ref="tab"/>
            </template>

            <div v-else class="p-3 space-y-2 text-sm text-gray-700">
                <p>Set up. Each mode holds its own settings, and you can come back to them from Settings at any time.</p>
                <p v-if="radioName" class="text-xs text-gray-600">
                    The radio is still named <span class="font-semibold">{{ radioName }}</span>. Entering a mode
                    writes that mode's name. To rename it now, save the mode this station is already in: saving
                    the mode in use writes it to the radio.
                </p>
            </div>

            <!-- pinned: each mode's step is a whole settings form, so Next would
                 otherwise be a screen or three below the fold on a phone -->
            <div class="sticky bottom-0 bg-white rounded-b-lg p-3 flex space-x-2">
                <button v-if="step !== 'done'" @click="skip" type="button"
                        class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 font-medium rounded-lg text-sm px-4 py-2.5">
                    Not now
                </button>
                <button v-if="stepNumber > 1 && step !== 'done'" @click="back" type="button"
                        class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 font-medium rounded-lg text-sm px-4 py-2.5">
                    Back
                </button>
                <button @click="next" type="button"
                        class="w-full text-white bg-blue-600 hover:bg-blue-700 font-medium rounded-lg text-sm px-4 py-2.5">
                    {{ step === "done" ? "Close" : (step === "intro" ? "Start" : "Next") }}
                </button>
            </div>

        </div>
    </div>
</template>

<script>
/**
 * The walk through a station's three modes, once.
 *
 * An operator setting up at a muster point has no time to discover that a mode
 * holds its own node name, and one who has never opened the settings tabs will
 * enter Emcomm-Live with whatever the defaults happened to be. This asks the
 * questions once, in the order the modes matter, and can be reopened from
 * Settings.
 *
 * Next saves the step it is leaving. The editor's own Save is the one at the top
 * of the settings page, which is behind this dialog, so without that an operator
 * walks through all three modes and keeps none of it.
 *
 * What a step writes is a mode profile. Only the mode the station is already in
 * reaches the radio, which is true of saving a mode anywhere. Entering a mode is
 * what writes the rest, with its own confirmation of what will change. Saying so
 * plainly is part of the point, because "set the name" reads like "rename my
 * radio" otherwise.
 */
import GlobalState from "../../js/GlobalState.js";
import ModeProfiles, { MODES } from "../../js/modes/ModeProfiles.js";
import ModeSettingsTabs from "./ModeSettingsTabs.vue";

const NOTES = {
    normal: "The radio as this app first read it: its name, its settings and its channels. "
        + "Coming home from a mode writes this back, so it is worth a look even if you change nothing.",
    training: "A drill. Its own channels, and everything sent from this mode is marked DRILL "
        + "so nobody mistakes an exercise for the real thing.",
    live: "A real incident. The net's channels, the settings an incident wants, and the "
        + "name other stations will see while you are in it.",
};

export default {
    name: 'FirstRunSetup',
    components: { ModeSettingsTabs },
    props: {
        open: {
            type: Boolean,
            default: false,
        },
    },
    emits: ["close"],
    data() {
        return {
            // intro, then a step per mode in the order they matter, then done
            steps: ["intro", ...MODES, "done"],
            index: 0,
        };
    },
    watch: {
        open(value) {
            if(value){
                this.index = 0;
            }
        },
    },
    methods: {
        labelFor(mode) {
            return ModeProfiles.label(mode);
        },
        noteFor(mode) {
            return NOTES[mode] ?? "";
        },
        async next() {
            await this.saveStep();
            if(this.step === "done"){
                this.finish();
                return;
            }
            this.index = Math.min(this.steps.length - 1, this.index + 1);
        },
        async back() {
            await this.saveStep();
            this.index = Math.max(0, this.index - 1);
        },
        /** Marked done either way: an operator who skipped it was asked. */
        skip() {
            this.finish();
        },
        finish() {
            FirstRunSetup.markDone();
            this.$emit("close");
        },

        /**
         * Saves the mode this step is about, on the way out of it.
         *
         * Each step is the settings page's own mode editor, and that editor's Save
         * is the one at the top of the settings page — which is behind this
         * dialog. So Next is this wizard's Save. Without it an operator walks
         * through all three modes at a muster point and keeps none of it, which is
         * exactly the situation the wizard exists to prevent.
         *
         * Leaving a step saves it rather than a Save of its own, because a step
         * has nothing else to press: Next is the only way on.
         */
        async saveStep() {
            if(this.stepMode == null){
                return;
            }
            try {
                await this.$refs.tab?.save();
            } catch(e) {
                // the profile is written before the radio is touched, so what was
                // typed is kept even here
                console.log("could not save this step", e);
            }
        },
    },
    computed: {
        GlobalState() {
            return GlobalState;
        },
        step() {
            return this.steps[this.index];
        },
        stepNumber() {
            return this.index + 1;
        },
        /** The mode this step is about, or null for the intro and the last step. */
        stepMode() {
            return MODES.includes(this.step) ? this.step : null;
        },
        radioName() {
            return GlobalState.selfInfo?.name ?? null;
        },
    },
};

/**
 * Whether this station has been through the walkthrough, per node.
 *
 * Kept per node key rather than per browser: one laptop can drive several
 * radios, and each of them is a station that has or has not been set up.
 */
export class FirstRunSetup {

    static storageKey(nodeKeyHex = ModeProfiles.nodeKeyHex()) {
        return `first_run:${nodeKeyHex}`;
    }

    static isDone(nodeKeyHex = ModeProfiles.nodeKeyHex()) {
        if(nodeKeyHex == null){
            // no radio read yet, so nothing to ask about
            return true;
        }
        try {
            return window.localStorage.getItem(this.storageKey(nodeKeyHex)) != null;
        } catch(e) {
            // a browser that refuses storage would ask on every connect, which is
            // worse than never asking
            return true;
        }
    }

    static markDone(nodeKeyHex = ModeProfiles.nodeKeyHex()) {
        if(nodeKeyHex == null){
            return false;
        }
        try {
            window.localStorage.setItem(this.storageKey(nodeKeyHex), new Date().toISOString());
            return true;
        } catch(e) {
            console.log("could not record that this station was set up", e);
            return false;
        }
    }

    /** So the operator can walk it again from Settings. */
    static forget(nodeKeyHex = ModeProfiles.nodeKeyHex()) {
        try {
            window.localStorage.removeItem(this.storageKey(nodeKeyHex));
        } catch(e) {
            console.log("could not clear the setup mark", e);
        }
    }

}
</script>
