<!--
    Asked on disconnect: take the station home first, or leave it as it stands.

    This is a trap rather than a convenience. **The way home lives on the computer
    that holds the backup.** A node disconnected while still in an emcomm mode is left
    on drill channels and drill settings, and the operator who picks it up on another
    machine gets the "Is this station in a mode?" question and no way to put it back --
    the radio does not know it is in a mode, only this browser does.

    So both answers have to stay easy. Disconnecting as it stands is the right answer
    when the radio is being handed on mid incident, or swapped to another device, which
    is why this is a question and never an automatic switch.

    A station already in normal mode is not asked. There is nothing to come home from,
    and a question with only one real answer teaches an operator to dismiss the dialog
    without reading it -- which is exactly the habit that would make this one useless
    on the day it matters.
-->
<template>

    <div v-if="open" class="fixed inset-0 z-50 flex bg-black/40 p-3 overflow-y-auto">
        <div role="dialog" aria-labelledby="disconnect-heading"
             class="m-auto w-full max-w-lg bg-white rounded-lg shadow-lg divide-y">

            <div class="p-3">
                <div id="disconnect-heading" class="font-semibold text-gray-900">
                    This station is in {{ modeLabel }}
                </div>
            </div>

            <!-- what leaving it would mean, said before the buttons -->
            <div v-if="!busy && !failures.length" class="p-3 space-y-2 text-sm text-gray-700">
                <p>
                    Disconnecting now leaves the radio on {{ modeLabel }}'s channels and settings. It will still
                    work, but <span class="font-semibold">the way back is recorded on this computer</span> — on
                    another machine the app cannot tell this is a drill setup, and cannot put it back.
                </p>

                <div v-if="loading" class="text-xs text-gray-500">Reading the radio…</div>

                <div v-else-if="changes.length" class="text-xs text-gray-600">
                    <div class="font-semibold text-gray-700">Coming home would change:</div>
                    <ul class="list-disc pl-5 mt-1 space-y-0.5">
                        <li v-for="(change, i) in changes" :key="i">{{ change }}</li>
                    </ul>
                </div>

                <p v-else-if="describeFailed" class="text-xs text-amber-800">
                    The radio could not be read, so what coming home would change is not known. Taking it home
                    will still try.
                </p>
            </div>

            <!-- the switch takes 40 to 90 seconds, so the disconnect waits for it -->
            <div v-if="busy" class="p-3 space-y-2 text-sm text-gray-700">
                <p>Taking the station home, then disconnecting. This takes up to a minute and a half.</p>
                <!-- onProgress gives { what, done, total }, the same shape the mode
                     switch dialog renders -->
                <p v-if="progress" class="text-xs text-gray-600">
                    {{ progress.what }}<span v-if="progress.total"> ({{ progress.done }} of {{ progress.total }})</span>…
                </p>
                <p class="text-xs text-gray-500">Leave the radio on and this tab open until it finishes.</p>
            </div>

            <div v-if="failures.length" class="p-3 space-y-2 text-sm">
                <div class="font-semibold text-red-700">It did not come home, and is still connected</div>
                <ul class="list-disc pl-5 text-xs text-red-700 space-y-0.5">
                    <li v-for="(failure, i) in failures" :key="i">{{ failure }}</li>
                </ul>
                <p class="text-xs text-gray-600">
                    Nothing was disconnected, so you can try again. Disconnecting now would leave it in
                    {{ modeLabel }}.
                </p>
            </div>

            <div class="p-3 space-y-2">

                <button @click="homeThenDisconnect" type="button" :disabled="busy"
                        class="w-full text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 font-medium rounded-lg text-sm px-4 py-2.5">
                    {{ failures.length ? "Try again, then disconnect" : "Put it back to normal mode, then disconnect" }}
                </button>

                <button @click="justDisconnect" type="button" :disabled="busy"
                        class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-sm px-4 py-2.5">
                    Disconnect, leave it in {{ modeLabel }}
                </button>

                <button @click="close" type="button" :disabled="busy"
                        class="w-full text-gray-700 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-sm px-4 py-2.5">
                    Stay connected
                </button>

                <div class="text-xs text-gray-500">
                    Leaving it in {{ modeLabel }} is the right answer if you are handing this radio on, or moving it
                    to another device that knows the mode.
                </div>

            </div>

        </div>
    </div>

</template>

<script>
import Connection from "../../js/Connection.js";
import ModeProfiles from "../../js/modes/ModeProfiles.js";
import ModeSwitch from "../../js/modes/ModeSwitch.js";

export default {
    name: "DisconnectDialog",
    props: {
        open: Boolean,
    },
    emits: ["close"],
    data() {
        return {
            changes: [],
            loading: false,
            describeFailed: false,
            busy: false,
            progress: null,
            failures: [],
        };
    },
    watch: {
        open(isOpen) {
            if(isOpen){
                this.changes = [];
                this.failures = [];
                this.describeFailed = false;
                this.progress = null;
                this.describe();
            }
        },
    },
    computed: {
        modeLabel() {
            return ModeProfiles.label(ModeProfiles.current());
        },
    },
    methods: {

        close() {
            if(!this.busy){
                this.$emit("close");
            }
        },

        /** The same description the mode switch dialog shows, for the trip home. */
        async describe() {
            this.loading = true;
            try {
                const description = await ModeSwitch.describe("normal");
                this.changes = description.changes;
            } catch(e) {
                // not fatal: an operator can still choose to take it home, and the
                // switch itself will report what happened
                this.describeFailed = true;
                this.changes = [];
            } finally {
                this.loading = false;
            }
        },

        /**
         * The switch takes 40 to 90 seconds and the disconnect waits for it. Racing
         * the two would drop the link part way through writing channels, which is
         * worse than either answer the operator was offered.
         *
         * A failed switch does not disconnect. Being told "it did not come home" while
         * the radio is still on the air is recoverable; being disconnected and told the
         * same thing is not.
         */
        async homeThenDisconnect() {
            this.busy = true;
            this.failures = [];
            try {
                const result = await ModeSwitch.apply("normal", (p) => { this.progress = p; });
                if(result.failures.length){
                    // "the channels was not set" -- `what` is sometimes plural, so the verb
                    // cannot agree with it. Fronting the failure sidesteps it entirely.
                    // ModeSwitchDialog still has the original phrasing
                    this.failures = result.failures.map((f) => `Could not set ${f.what}: ${f.reason}`);
                    return;
                }
                await this.finish();
            } catch(e) {
                this.failures = [`Not switched: ${e?.message ?? e}`];
            } finally {
                this.busy = false;
                this.progress = null;
            }
        },

        async justDisconnect() {
            await this.finish();
        },

        async finish() {
            this.$emit("close");
            await Connection.disconnect();
        },

    },
}
</script>
