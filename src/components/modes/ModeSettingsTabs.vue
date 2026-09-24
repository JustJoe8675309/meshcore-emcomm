<template>
    <div class="bg-white divide-y">

        <div v-if="only == null" class="bg-white p-2 font-semibold">Modes</div>

        <div v-if="only == null" class="p-2 text-xs text-gray-500">
            Each mode holds its own radio settings, channels and rooms. Switching writes them to the
            radio, from the banner at the top of the app. The layout here is the same for every mode:
            only what is in it differs.
        </div>

        <!-- one tab per mode, coloured as the banner is. The first run wizard asks
             for one mode at a time and passes `only`, which hides the strip rather
             than growing a second copy of the form to drift from this one -->
        <div v-if="only == null" class="p-2 flex space-x-1">
            <button
                v-for="mode of modes"
                :key="mode"
                @click="select(mode)"
                type="button"
                :class="[ tab === mode ? classesFor(mode) + ' font-bold' : 'bg-gray-100 text-gray-600' ]"
                class="w-full text-xs rounded px-2 py-1">
                {{ labelFor(mode) }}
                <span v-if="mode === current" class="block font-normal">in use</span>
            </button>
        </div>

        <div v-if="notConnected" class="p-2 text-xs text-red-600">No radio connected.</div>
        <div v-else-if="profile == null" class="p-2 text-xs text-gray-500">Reading this mode...</div>

        <template v-else>

            <!-- the radio's own settings -->
            <div v-if="!channelsOnly" class="p-2 space-y-2">
                <div class="text-sm font-medium text-gray-900">Radio</div>

                <label class="block text-xs text-gray-700">Node name
                    <input v-model="profile.radio.name" type="text" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                </label>

                <div class="grid grid-cols-2 gap-2">
                    <label class="block text-xs text-gray-700">Frequency (kHz)
                        <input v-model.number="profile.radio.radioFreq" type="number" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                    </label>
                    <label class="block text-xs text-gray-700">Bandwidth (Hz)
                        <input v-model.number="profile.radio.radioBw" type="number" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                    </label>
                    <label class="block text-xs text-gray-700">Spreading factor
                        <input v-model.number="profile.radio.radioSf" type="number" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                    </label>
                    <label class="block text-xs text-gray-700">Coding rate
                        <input v-model.number="profile.radio.radioCr" type="number" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                    </label>
                </div>

                <label class="block text-xs text-gray-700">Transmit power (dBm)
                    <input v-model.number="profile.radio.txPower" type="number" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                </label>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="profile.radio.shareLocation" type="checkbox" class="mt-0.5">
                    <span>Share location with stations that ask</span>
                </label>
                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="profile.radio.advertPosition" type="checkbox" class="mt-0.5">
                    <span>Put this station's position in every advert</span>
                </label>
                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="profile.radio.multiAcks" type="checkbox" class="mt-0.5">
                    <span>Send each delivery acknowledgement more than once</span>
                </label>
                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="profile.radio.autoAddContacts" type="checkbox" class="mt-0.5">
                    <span>Add contacts automatically</span>
                </label>
            </div>

            <!-- channels written to the radio in this mode -->
            <div class="p-2 space-y-2">
                <div class="text-sm font-medium text-gray-900">{{ channelsOnly ? "Channels normal mode writes" : "Channels" }}</div>
                <div class="text-xs text-gray-500">
                    Written to the radio's slots in this order when the mode is entered. Any other
                    channel is cleared. A name beginning with # has its key worked out from the name,
                    so a whole net joins by name.
                </div>

                <!-- the settings above this are the radio's live ones, so in an
                     emcomm mode they belong to that mode while this list belongs to
                     normal. Saying so beats letting the two read as one thing. -->
                <div v-if="channelsOnly && current !== 'normal'" class="text-xs text-amber-800">
                    This station is in {{ labelFor(current) }}, so the radio is holding that mode's
                    channels at the moment, not these. These are what it comes home to.
                </div>

                <div v-if="profile.channels.length === 0" class="text-xs text-amber-700">
                    No channels: this mode would clear every channel from the radio.
                </div>

                <div v-for="(channel, index) of profile.channels" :key="index" class="border border-gray-200 rounded p-2 space-y-1">
                    <div class="flex items-center justify-between">
                        <div class="text-sm text-gray-900">{{ channel.name }}</div>
                        <button @click="removeChannel(index)" type="button" class="text-xs text-red-600 underline">Remove</button>
                    </div>
                    <div class="font-mono text-[10px] text-gray-500 break-all">{{ channel.secret }}</div>
                </div>

                <div class="flex space-x-2">
                    <input v-model="newChannelName" type="text" placeholder="#Emcomm, or a channel name" aria-label="New channel name"
                           class="w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                    <button @click="addChannel" :disabled="!canAddChannel" type="button"
                            class="bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 text-gray-700 text-xs font-medium rounded-lg px-3 py-2">Add</button>
                </div>
                <div v-if="newChannelName && !newChannelName.trim().startsWith('#')" class="text-xs text-gray-500">
                    Not a # channel, so it gets a random key. Share it with the net by exporting the
                    channel from the stock app, or use a # name instead.
                </div>
            </div>

            <!-- rooms this mode uses -->
            <div class="p-2 space-y-2">
                <div class="text-sm font-medium text-gray-900">Rooms</div>
                <div v-if="rooms.length === 0" class="text-xs text-gray-500">This radio has no room servers among its contacts.</div>
                <div v-for="room of rooms" :key="room.keyHex" class="flex items-center justify-between text-xs text-gray-700">
                    <label class="flex items-center space-x-2">
                        <input type="checkbox" :checked="usesRoom(room.keyHex)" @change="toggleRoom(room, $event.target.checked)">
                        <span>{{ room.name }}</span>
                    </label>
                </div>
                <div class="text-xs text-gray-500">
                    Rooms are contacts, so they are not removed when the mode changes. This says which
                    of them this mode uses for position roll calls.
                </div>
            </div>

            <!-- the rest of what belongs to a mode -->
            <div v-if="!channelsOnly" class="p-2 space-y-2">
                <div class="text-sm font-medium text-gray-900">Also</div>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="profile.autoAnswerPositions" type="checkbox" class="mt-0.5">
                    <span>Answer position requests automatically, without asking each time</span>
                </label>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="profile.markDrill" type="checkbox" class="mt-0.5">
                    <span>Mark everything sent DRILL</span>
                </label>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="profile.trimContacts" type="checkbox" class="mt-0.5">
                    <span>Drop contacts not heard in 90 days when entering this mode. Favourites are kept, and the backup keeps everything</span>
                </label>

                <div class="text-xs text-gray-700">Repeating adverts, in minutes. 0 turns one off.</div>
                <div class="grid grid-cols-2 gap-2">
                    <label class="block text-xs text-gray-700">Zero hop
                        <input v-model.number="profile.adverts.zeroHopMinutes" type="number" min="0" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                    </label>
                    <label class="block text-xs text-gray-700">Flood
                        <input v-model.number="profile.adverts.floodMinutes" type="number" min="0" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                    </label>
                </div>
            </div>

            <div class="p-2 space-y-2">
                <button @click="save" type="button"
                        class="w-full text-white bg-blue-700 hover:bg-blue-800 font-medium rounded-lg text-sm px-5 py-2.5">Save {{ labelFor(tab) }}</button>

                <button v-if="tab === 'normal'" @click="recapture" :disabled="busy" type="button"
                        class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-xs px-3 py-2">
                    Take the radio's settings and channels as they are now
                </button>

                <div v-if="message" role="status" class="text-xs text-gray-600">{{ message }}</div>
                <div v-if="tab === current" class="text-xs text-amber-700">
                    This station is in this mode. Saving here does not change the radio: switch into the
                    mode again from the banner to write it.
                </div>
            </div>

        </template>

    </div>
</template>

<script>
import { Constants } from "@liamcottle/meshcore.js";
import GlobalState from "../../js/GlobalState.js";
import Utils from "../../js/Utils.js";
import EmcommMode from "../../js/EmcommMode.js";
import ModeProfiles, { MODES, MODE_CLASSES } from "../../js/modes/ModeProfiles.js";
import PositionService from "../../js/position/PositionService.js";

export default {
    name: 'ModeSettingsTabs',
    props: {
        /** One mode only, with no tab strip: what the first run wizard asks for. */
        only: {
            type: String,
            default: null,
        },
        // channels and rooms alone. Normal mode's radio settings are the live ones
        // shown above it on the settings page, so repeating them here would put
        // the same value on the screen twice — which is the fault this page was
        // rearranged to fix.
        channelsOnly: {
            type: Boolean,
            default: false,
        },
    },
    data() {
        return {
            tab: "normal",
            profile: null,
            newChannelName: "",
            message: null,
            busy: false,
        };
    },
    mounted() {
        this.tab = this.only ?? this.current;
        this.load();
    },
    watch: {
        only(mode) {
            if(mode != null){
                this.tab = mode;
                this.message = null;
                this.load();
            }
        },
    },
    methods: {
        labelFor(mode) {
            return ModeProfiles.label(mode);
        },
        classesFor(mode) {
            return MODE_CLASSES[mode] ?? MODE_CLASSES.normal;
        },
        select(mode) {
            this.tab = mode;
            this.message = null;
            this.load();
        },
        async load() {
            if(this.notConnected){
                return;
            }
            this.profile = null;
            try {
                this.profile = await ModeProfiles.profileOrDefault(this.tab);
            } catch(e) {
                this.message = `Could not read this mode: ${e?.message ?? e}`;
            }
        },
        save() {
            ModeProfiles.saveProfile(this.tab, JSON.parse(JSON.stringify(this.profile)));
            // the mode in use keeps its app side settings in step at once; the
            // radio side waits for a switch, which is said on screen
            if(this.tab === this.current){
                // every channel and room is answered, so the only live value this
                // tab owns is whether the operator is asked first
                PositionService.saveSettings({ autoAnswer: this.profile.autoAnswerPositions === true });
            }
            this.message = `${this.labelFor(this.tab)} saved.`;
        },
        async recapture() {
            this.busy = true;
            this.message = null;
            try {
                this.profile = await ModeProfiles.captureNormal();
                this.message = "Normal mode now holds the radio's settings and channels as they are now.";
            } catch(e) {
                this.message = `Could not read the radio: ${e?.message ?? e}`;
            } finally {
                this.busy = false;
            }
        },
        async addChannel() {
            const name = this.newChannelName.trim();
            if(name === "" || this.profile == null){
                return;
            }
            const secret = name.startsWith("#")
                ? Utils.bytesToHex(await EmcommMode.hashtagChannelKey(name))
                : Utils.bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
            this.profile.channels.push({ name: name, secret: secret });
            this.newChannelName = "";
        },
        removeChannel(index) {
            this.profile.channels.splice(index, 1);
        },
        usesRoom(keyHex) {
            return (this.profile?.rooms ?? []).some((r) => r.keyHex === keyHex);
        },
        toggleRoom(room, on) {
            if(on){
                this.profile.rooms.push({ keyHex: room.keyHex, name: room.name });
            } else {
                this.profile.rooms = this.profile.rooms.filter((r) => r.keyHex !== room.keyHex);
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
        notConnected() {
            return GlobalState.connection == null || GlobalState.selfInfo == null;
        },
        rooms() {
            return GlobalState.contacts
                .filter((c) => c.type === Constants.AdvType.Room)
                .map((c) => ({ keyHex: Utils.bytesToHex(c.publicKey), name: PositionService.contactName(c) }));
        },
        canAddChannel() {
            return this.profile != null && this.newChannelName.trim() !== "" && this.profile.channels.length < 16;
        },
    },
}
</script>
