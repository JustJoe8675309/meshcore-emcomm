<template>
    <div class="bg-white divide-y">

        <div class="bg-white p-2 font-semibold">Position requests</div>

        <div class="p-2 text-xs text-gray-500">
            Other stations running this app can ask where this one is. Every channel this radio
            holds is answered, every room it is in, and any station asking directly. The only
            choice is whether you are asked first.
        </div>

        <!-- auto or manual, the whole of it -->
        <div class="w-full p-2 space-y-2">

            <div class="flex space-x-1">
                <button v-for="choice of choices" :key="choice.value" @click="setAutoAnswer(choice.value)"
                        :disabled="notConnected" type="button"
                        :class="autoAnswer === choice.value ? 'bg-gray-800 text-white font-semibold' : 'bg-gray-100 text-gray-600'"
                        class="w-full text-sm rounded px-2 py-2 disabled:opacity-60">{{ choice.label }}</button>
            </div>

            <div class="text-xs text-gray-500">
                <template v-if="autoAnswer">
                    <span class="font-medium text-amber-800">Auto reply:</span>
                    the position goes out as soon as it is asked for, with no prompt — on any channel,
                    in any room, to any station. Repeated requests from one station are answered once.
                </template>
                <template v-else>
                    <span class="font-medium text-gray-900">Manual reply:</span>
                    each request asks you first — send, send with a message to follow, or decline.
                    Nothing goes out until you say so.
                </template>
            </div>

            <div class="text-xs text-gray-500">
                This is part of the mode in use, so each mode can differ: manual for everyday, auto
                for a net where nobody is watching the screen. A position sent on a channel is seen
                by every station on it running this app; in a room it is a post everyone there sees,
                stock apps included.
            </div>

        </div>

        <div v-if="notConnected" class="p-2 text-xs text-red-600">
            No radio connected, so there is nothing to set this against.
        </div>

    </div>
</template>

<script>
/**
 * Whether this station is asked before its position goes out.
 *
 * It used to be a list of channels and rooms to answer on, and that list was a
 * running sore: a tick was kept against a slot number, a slot is not a channel,
 * and so the ticks had to be dragged from slot to slot on every mode switch.
 * Three separate faults in one evening came from that. The operator's real
 * question was never "which channels" but "am I asked first".
 */
import GlobalState from "../../js/GlobalState.js";
import PositionService from "../../js/position/PositionService.js";
import ModeProfiles from "../../js/modes/ModeProfiles.js";

export default {
    name: 'PositionSettingsGroup',
    data() {
        return {
            choices: [
                { value: false, label: "Manual reply" },
                { value: true, label: "Auto reply" },
            ],
        };
    },
    methods: {
        setAutoAnswer(on) {
            PositionService.saveSettings({ autoAnswer: on });
            // and into the mode in use, or the next switch writes the mode's own
            // choice over the top of this one without saying so
            ModeProfiles.noteAnswerChoices({ autoAnswer: on });
        },
    },
    computed: {
        notConnected() {
            return GlobalState.connection == null || GlobalState.selfInfo == null;
        },
        settings() {
            // the node key is read here so a different radio shows its own settings
            void GlobalState.selfInfo?.publicKey;
            return PositionService.settings();
        },
        autoAnswer() {
            return this.settings.autoAnswer;
        },
    },
}
</script>
