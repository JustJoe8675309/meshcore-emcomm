<template>
    <div class="bg-white divide-y">

        <div class="bg-white p-2 font-semibold">Position requests</div>

        <div class="p-2 text-xs text-gray-500">
            Other stations running this app can ask for this station's position. A request sent
            direct is always put to you; on a channel, only the channels ticked here are answered.
            Kept in this browser, for this radio.
        </div>

        <div v-if="notConnected" class="p-2 text-xs text-red-600">
            No radio connected, so there are no channels to choose from.
        </div>

        <!-- channels to answer on -->
        <div v-else class="w-full p-2 space-y-1">
            <div class="text-sm font-medium text-gray-900">Answer on these channels</div>
            <div v-if="channels.length === 0" class="text-xs text-gray-500">This radio has no channels.</div>
            <label v-for="channel of channels" :key="channel.idx" class="flex items-center space-x-2 text-sm text-gray-800">
                <input
                    type="checkbox"
                    :checked="markedChannels.includes(channel.idx)"
                    @change="toggleChannel(channel.idx, $event.target.checked)">
                <span>{{ channel.name }}</span>
            </label>
            <div class="text-xs text-gray-500">
                A position sent on a channel is seen by every station on it running this app.
            </div>
        </div>

        <!-- answering -->
        <div class="w-full p-2 space-y-1">
            <label class="flex items-start space-x-2 text-sm text-gray-800">
                <input type="checkbox" class="mt-0.5" :checked="autoAnswer" :disabled="notConnected" @change="setAutoAnswer($event.target.checked)">
                <span>Answer automatically, without asking each time</span>
            </label>
            <div class="text-xs text-gray-500">
                Off, each request asks you first: send, send with a message to follow, or decline.
                On, the position goes out straight away. Repeated requests from one station ask once.
            </div>
        </div>

    </div>
</template>

<script>
import GlobalState from "../../js/GlobalState.js";
import PositionService from "../../js/position/PositionService.js";

export default {
    name: 'PositionSettingsGroup',
    methods: {
        toggleChannel(idx, on) {
            const settings = PositionService.settings();
            const marked = new Set(settings.markedChannels);
            if(on){
                marked.add(idx);
            } else {
                marked.delete(idx);
            }
            PositionService.saveSettings({ ...settings, markedChannels: [...marked] });
        },
        setAutoAnswer(on) {
            PositionService.saveSettings({ ...PositionService.settings(), autoAnswer: on });
        },
    },
    computed: {
        notConnected() {
            return GlobalState.connection == null || GlobalState.selfInfo == null;
        },
        channels() {
            return GlobalState.channels;
        },
        settings() {
            // the node key is read here so a different radio shows its own settings
            void GlobalState.selfInfo?.publicKey;
            return PositionService.settings();
        },
        markedChannels() {
            return this.settings.markedChannels;
        },
        autoAnswer() {
            return this.settings.autoAnswer;
        },
    },
}
</script>
