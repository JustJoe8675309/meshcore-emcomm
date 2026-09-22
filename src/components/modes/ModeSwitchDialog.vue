<template>
    <div v-if="open" class="fixed inset-0 z-50 flex bg-black/40 p-3 overflow-y-auto">
        <div role="dialog" aria-labelledby="mode-switch-heading" class="m-auto w-full max-w-md bg-white rounded-lg shadow-lg divide-y">

            <div class="p-3">
                <div id="mode-switch-heading" class="font-semibold text-gray-900">Station mode</div>
                <div class="text-xs text-gray-500 mt-1">
                    A mode is written to the radio: its settings and its channels really change, so what
                    it can hear changes with them. Everything is kept in the backup and undone by going
                    back to normal.
                </div>
            </div>

            <!-- the three modes, the one it is in marked -->
            <div class="p-3 space-y-2">
                <label v-for="option of modes" :key="option" class="flex items-start space-x-2 text-sm text-gray-800">
                    <input type="radio" :value="option" v-model="chosen" :disabled="busy" class="mt-1">
                    <span class="w-full">
                        <span :class="classesFor(option)" class="inline-block text-xs font-bold px-2 py-0.5 rounded">{{ labelFor(option) }}</span>
                        <span v-if="option === current" class="ml-2 text-xs text-gray-500">this station is in this mode</span>
                        <span class="block text-xs text-gray-600 mt-0.5">{{ descriptions[option] }}</span>
                    </span>
                </label>
            </div>

            <!-- what it would do to the radio, read before anything is written -->
            <div v-if="chosen !== current" class="p-3 space-y-1">
                <div class="text-sm font-medium text-gray-900">Switching to {{ labelFor(chosen) }} will</div>
                <div v-if="loading" class="text-xs text-gray-500">Reading the radio...</div>
                <ul v-else class="list-disc pl-5 text-xs text-gray-700 space-y-0.5">
                    <li v-for="(change, i) of changes" :key="i">{{ change }}</li>
                </ul>
            </div>

            <div v-if="progress" class="p-3 text-xs text-gray-700">
                {{ progress.what }}<span v-if="progress.total"> ({{ progress.done }} of {{ progress.total }})</span>...
            </div>

            <div v-if="warnings.length > 0" class="p-3 space-y-1">
                <div v-for="(warning, i) of warnings" :key="i" class="text-xs text-amber-800">{{ warning }}</div>
            </div>

            <div v-if="failures.length > 0" class="p-3 space-y-1">
                <div v-for="(failure, i) of failures" :key="i" class="text-xs text-red-600">{{ failure }}</div>
            </div>

            <div v-if="done" class="p-3 text-xs text-gray-800">{{ done }}</div>

            <div class="p-3 flex space-x-2">
                <button @click="close" :disabled="busy" type="button"
                        class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-sm px-5 py-2.5">
                    {{ done ? "Close" : "Cancel" }}
                </button>
                <button
                    @click="switchMode"
                    :disabled="busy || chosen === current"
                    type="button"
                    class="w-full text-white bg-amber-700 hover:bg-amber-800 disabled:bg-gray-400 font-medium rounded-lg text-sm px-5 py-2.5">
                    {{ busy ? "Switching..." : `Switch to ${labelFor(chosen)}` }}
                </button>
            </div>

        </div>
    </div>
</template>

<script>
import ModeProfiles, { MODES, MODE_CLASSES } from "../../js/modes/ModeProfiles.js";
import ModeSwitch from "../../js/modes/ModeSwitch.js";
import GlobalState from "../../js/GlobalState.js";

export default {
    name: 'ModeSwitchDialog',
    props: {
        open: Boolean,
    },
    emits: ["close"],
    data() {
        return {
            chosen: "normal",
            changes: [],
            loading: false,
            busy: false,
            progress: null,
            warnings: [],
            failures: [],
            done: null,
            descriptions: {
                normal: "The radio as it was when this app first saw it: its own settings, channels and contacts.",
                live: "A real incident: the net's channels and rooms, and the settings an incident wants.",
                training: "A drill: its own channels and rooms, and everything sent marked DRILL.",
            },
        };
    },
    watch: {
        open: {
            handler(value) {
                if(value){
                    this.chosen = this.current;
                    this.changes = [];
                    this.warnings = [];
                    this.failures = [];
                    this.done = null;
                    this.progress = null;
                }
            },
            immediate: true,
        },
        chosen: {
            handler() {
                this.describe();
            },
        },
    },
    methods: {
        labelFor(mode) {
            return ModeProfiles.label(mode);
        },
        classesFor(mode) {
            return MODE_CLASSES[mode] ?? MODE_CLASSES.normal;
        },
        close() {
            if(!this.busy){
                this.$emit("close");
            }
        },
        async describe() {
            if(this.chosen === this.current || !this.open){
                this.changes = [];
                return;
            }
            this.loading = true;
            try {
                const description = await ModeSwitch.describe(this.chosen);
                this.changes = description.changes;
            } catch(e) {
                this.changes = [`The radio could not be read: ${e?.message ?? e}`];
            } finally {
                this.loading = false;
            }
        },
        async switchMode() {
            const mode = this.chosen;
            this.busy = true;
            this.warnings = [];
            this.failures = [];
            this.done = null;
            try {
                const result = await ModeSwitch.apply(mode, (p) => { this.progress = p; });
                this.warnings = result.warnings;
                this.failures = result.failures.map((f) => `${f.what} was not set: ${f.reason}`);
                this.done = `This station is now in ${this.labelFor(mode)}.`;
            } catch(e) {
                this.failures = [`Not switched: ${e?.message ?? e}`];
            } finally {
                this.busy = false;
                this.progress = null;
            }
        },
    },
    computed: {
        modes() {
            return MODES;
        },
        current() {
            void ModeProfiles.state.revision;
            void GlobalState.emcommModeRevision;
            return ModeProfiles.current();
        },
    },
}
</script>
