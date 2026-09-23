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

        <!-- rooms to answer in. Off unless ticked: an answer there is a post everyone
             in the room sees, stock apps included, and it takes a place in the room's store -->
        <div v-if="!notConnected" class="w-full p-2 space-y-1">
            <div class="text-sm font-medium text-gray-900">Answer in these rooms</div>
            <div v-if="rooms.length === 0" class="text-xs text-gray-500">This radio has no room servers among its contacts.</div>
            <label v-for="room of rooms" :key="room.keyHex" class="flex items-center space-x-2 text-sm text-gray-800">
                <input
                    type="checkbox"
                    :checked="markedRooms.includes(room.keyHex)"
                    @change="toggleRoom(room.keyHex, $event.target.checked)">
                <span>{{ room.name }}</span>
            </label>
            <div class="text-xs text-gray-500">
                In a room your answer is a post: everyone in the room sees it, and stock apps show it as a
                line of text with a code after it. The room keeps only 32 posts for members who are away,
                so position posts can push older messages out.
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
import { Constants } from "@liamcottle/meshcore.js";
import GlobalState from "../../js/GlobalState.js";
import Utils from "../../js/Utils.js";
import PositionService from "../../js/position/PositionService.js";
import ModeProfiles from "../../js/modes/ModeProfiles.js";

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
            // and into the mode in use, or the next switch writes the mode's own
            // choice over the top of this one without saying so
            ModeProfiles.noteAnswerChoices({ markedChannels: [...marked] });
        },
        toggleRoom(keyHex, on) {
            const settings = PositionService.settings();
            const marked = new Set(settings.markedRooms);
            if(on){
                marked.add(keyHex);
            } else {
                marked.delete(keyHex);
            }
            PositionService.saveSettings({ ...settings, markedRooms: [...marked] });
            ModeProfiles.noteAnswerChoices({ markedRooms: [...marked] });
        },
        setAutoAnswer(on) {
            PositionService.saveSettings({ ...PositionService.settings(), autoAnswer: on });
            ModeProfiles.noteAnswerChoices({ autoAnswer: on });
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
        markedRooms() {
            return this.settings.markedRooms;
        },
        rooms() {
            return GlobalState.contacts
                .filter((c) => c.type === Constants.AdvType.Room)
                .map((c) => ({ keyHex: Utils.bytesToHex(c.publicKey), name: PositionService.contactName(c) }));
        },
        autoAnswer() {
            return this.settings.autoAnswer;
        },
    },
}
</script>
