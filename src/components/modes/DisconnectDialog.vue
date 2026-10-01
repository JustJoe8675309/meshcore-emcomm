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

                <p v-else-if="describeFailed" class="text-xs text-yellow-800">
                    The radio could not be read, so what coming home would change is not known. Taking it home
                    will still try.
                </p>
            </div>

            <!-- the switch takes 40 to 90 seconds, so the disconnect waits for it -->
            <!-- the wait after the switch, which is not the switch -->
            <div v-if="busy && settling > 0" class="p-3 space-y-2 text-sm text-gray-700">
                <p>
                    <span class="font-semibold">It is home.</span> Holding the link open for
                    {{ settling }}s while the radio saves, then disconnecting.
                </p>
                <p class="text-xs text-gray-600">
                    Contacts written just before the link closes can be lost: closing the port resets the radio,
                    and what it has not saved yet goes with it. This is the wait that stops that.
                </p>
                <button @click="disconnectNow" type="button"
                        class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 font-medium rounded-lg text-sm px-4 py-2">
                    Disconnect now instead
                </button>
                <p class="text-xs text-yellow-800">
                    Disconnecting now risks losing contacts that were just put back. Right if you have to go.
                </p>
            </div>

            <div v-else-if="busy" class="p-3 space-y-2 text-sm text-gray-700">
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

/**
 * How long the link is held open after the switch, before it is closed. See settle().
 * 0 s loses contact writes and ~70 s keeps them; the threshold between was never
 * measured, so this sits on the safe side of the only two data points there are.
 */
const SETTLE_SECONDS = 60;

export default {
    name: "DisconnectDialog",
    SETTLE_SECONDS,
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
            // seconds still to wait before closing the link; see settle()
            settling: 0,
            skipSettle: false,
            settleTimer: null,
            endWait: null,
        };
    },
    watch: {
        open(isOpen) {
            if(isOpen){
                this.changes = [];
                this.failures = [];
                this.describeFailed = false;
                this.progress = null;
                this.settling = 0;
                this.skipSettle = false;
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
                await this.settle();
                await this.finish();
            } catch(e) {
                this.failures = [`Not switched: ${e?.message ?? e}`];
            } finally {
                this.busy = false;
                this.progress = null;
                this.settling = 0;
            }
        },

        /**
         * Hold the link open after the switch, before closing it.
         *
         * **Contact writes do not survive a serial close that follows them
         * immediately.** Proven on node 1 on 29 Sep, as a paired test: one contact
         * deleted, then put back by a restore of the same backup, twice.
         *
         *     gap before the close    the contact, on a fresh read
         *     ~70 s                   present, 211 contacts
         *     0 s                     gone, 210 contacts
         *
         * The radio acknowledged every write in both runs. That is how 42 contacts
         * went missing from this operator's node earlier the same evening: the trip
         * home restored them, the link closed in the same second, and a fresh connect
         * found them gone. Closing a Web Serial port toggles DTR/RTS, which resets
         * these boards, and the firmware had not flushed.
         *
         * 60 s because it is the only length anything is known about: 0 loses and ~70
         * keeps. The threshold in between was not measured, so this is the safe side
         * of the only two data points there are, not a tuned value. If it is ever
         * measured, this can come down.
         *
         * The operator can cut it short. The warning is honest about what that risks,
         * and someone handing a radio on mid incident has to be allowed to go.
         */
        async settle() {
            this.settling = SETTLE_SECONDS;
            while(this.settling > 0 && !this.skipSettle){
                // the resolver is kept so disconnectNow can end the wait at once.
                // Clearing the timeout alone left this promise unresolved and hung
                // the dialog for good -- the escape hatch never escaped
                await new Promise((resolve) => {
                    this.endWait = resolve;
                    this.settleTimer = setTimeout(resolve, 1000);
                });
                this.settling -= 1;
            }
            this.settling = 0;
            this.endWait = null;
        },

        /** Stop waiting and close the link now, with the risk already stated. */
        disconnectNow() {
            this.skipSettle = true;
            clearTimeout(this.settleTimer);
            this.endWait?.();
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
