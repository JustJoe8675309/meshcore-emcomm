<template>
    <div v-if="asking" class="fixed inset-0 z-50 flex bg-black/40 p-3 overflow-y-auto">
        <div role="dialog" aria-labelledby="left-in-mode-heading" class="m-auto w-full max-w-lg bg-white rounded-lg shadow-lg divide-y">

            <div class="p-3">
                <div id="left-in-mode-heading" class="font-semibold text-gray-900">Is this station in a mode?</div>
            </div>

            <div class="p-3 space-y-2 text-sm text-gray-700">
                <p>
                    This radio is holding <span class="font-semibold">{{ asking.channelName }}</span>, which is the
                    channel {{ modeLabel }} writes. It was probably left in that mode — on another computer, where
                    the record of it stayed.
                </p>
                <p class="text-xs text-amber-800">
                    Recording it as normal mode would make a drill setup this station's home, and coming back from a
                    future drill would take it there. Nothing has been recorded yet.
                </p>
            </div>

            <div class="p-3 space-y-2">

                <button @click="inMode" type="button"
                        class="w-full text-white bg-blue-600 hover:bg-blue-700 font-medium rounded-lg text-sm px-4 py-2.5">
                    It is in {{ modeLabel }}
                </button>

                <button @click="isNormal" type="button"
                        class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 font-medium rounded-lg text-sm px-4 py-2.5">
                    This is its normal setup
                </button>

                <div class="text-xs text-gray-500">
                    Choosing {{ modeLabel }} sets the banner to it and records nothing. Choosing normal records these
                    settings and channels as the station's own, and does not ask again for this radio.
                </div>

            </div>

        </div>
    </div>

    <!-- said after the choice, because it is the part an operator needs to act on -->
    <div v-else-if="warnNoRecord" class="fixed inset-0 z-50 flex bg-black/40 p-3 overflow-y-auto">
        <div role="dialog" aria-label="No record of normal mode" class="m-auto w-full max-w-lg bg-white rounded-lg shadow-lg divide-y">
            <div class="p-3 font-semibold text-gray-900">This computer has no record of its normal settings</div>
            <div class="p-3 space-y-2 text-sm text-gray-700">
                <p>
                    The station is in {{ warnNoRecord }} and this app has never seen it in normal mode, so it does not
                    know what to put back. The radio is not holding those settings either.
                </p>
                <p>
                    Take it home from the computer you left it on, or load a backup file under Settings, before
                    switching modes here.
                </p>
            </div>
            <div class="p-3">
                <button @click="warnNoRecord = null" type="button"
                        class="w-full text-white bg-blue-600 hover:bg-blue-700 font-medium rounded-lg text-sm px-4 py-2.5">
                    Understood
                </button>
            </div>
        </div>
    </div>
</template>

<script>
/**
 * "Is this station in a mode?", asked when a radio turns up holding an emcomm
 * mode's own channel and this browser has no record of it being in one.
 *
 * Connecting to a station in normal mode is what decides what normal mode is. On
 * a fresh browser — a second machine, or cleared site data — there is no record,
 * so the app would take the radio as it finds it. A radio left in Emcomm-Training
 * would then have a drill written down as its home, and the operator's real
 * settings would be gone from everywhere: the app never knew them and the radio
 * is not holding them any more.
 *
 * Guessing the mode from the channel and setting it quietly was the other option.
 * It is right most of the time, and when it is wrong it puts a station into DRILL
 * marking without anyone choosing that, which is worse than a question.
 */
import GlobalState from "../../js/GlobalState.js";
import ModeProfiles from "../../js/modes/ModeProfiles.js";
import NodeBackup from "../../js/NodeBackup.js";

export default {
    name: 'LeftInModeDialog',
    data() {
        return {
            // the mode named in the follow-up warning, or null
            warnNoRecord: null,
        };
    },
    computed: {
        asking() {
            return GlobalState.leftInMode;
        },
        modeLabel() {
            return ModeProfiles.label(this.asking?.mode);
        },
    },
    methods: {

        /** It is in that mode: believe the operator, and record nothing. */
        inMode() {
            const { mode, nodeKeyHex } = this.asking;
            ModeProfiles.setCurrent(mode, nodeKeyHex);
            GlobalState.leftInMode = null;
            this.warnNoRecord = ModeProfiles.profile("normal", nodeKeyHex) == null
                ? ModeProfiles.label(mode)
                : null;
        },

        /** The channel is simply part of how this station is set up. */
        async isNormal() {
            const { backup, nodeKeyHex } = this.asking;
            GlobalState.leftInMode = null;
            try {
                await ModeProfiles.captureNormal(nodeKeyHex, { channels: backup.channels });
                NodeBackup.save(backup, NodeBackup.SLOT_PRE_EMCOMM);
                ModeProfiles.confirmNormal(nodeKeyHex);
            } catch(e) {
                console.log("could not record the radio's normal mode", e);
            }
        },

    },
};
</script>
