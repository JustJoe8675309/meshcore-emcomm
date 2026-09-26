<template>
    <SettingsSection title="Net defaults"
                     note="What your net starts from. Kept in this browser, editable with no radio connected, and loaded into a station from its mode tab.">
        <div class="bg-white divide-y">

            <div class="p-2 text-xs text-gray-500">
                A station's modes belong to that station. These belong to the net: write them once and
                load them into any radio that turns up. Nothing here reaches a radio — loading fills a
                mode tab, and entering the mode from the banner is what writes it.
            </div>

            <!-- one at a time, named as the banner names them -->
            <div class="p-2 flex space-x-1">
                <button
                    v-for="mode of modes"
                    :key="mode"
                    @click="select(mode)"
                    type="button"
                    :class="[ mode === tab ? classesFor(mode) + ' font-bold' : 'bg-gray-100 text-gray-600' ]"
                    class="w-full text-xs rounded px-2 py-1">
                    {{ labelFor(mode) }}
                    <span v-if="saved[mode]" class="block font-normal">set</span>
                </button>
            </div>

            <div v-if="draft == null" class="p-2 text-xs text-gray-500">Reading...</div>

            <template v-else>

                <div class="p-2 space-y-2">
                    <div class="text-sm font-medium text-gray-900">Radio</div>
                    <div class="text-xs text-gray-500">
                        Every station on a net must agree on these four or they cannot hear each other.
                        The node name is not here: each station keeps its own, or two would answer to one.
                        Transmit power is not here either — a station loads this as high as its own radio
                        goes.
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                        <label class="block text-xs text-gray-700">Frequency (kHz)
                            <input v-model.number="draft.radio.radioFreq" type="number" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                        </label>
                        <label class="block text-xs text-gray-700">Bandwidth (Hz)
                            <input v-model.number="draft.radio.radioBw" type="number" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                        </label>
                        <label class="block text-xs text-gray-700">Spreading factor
                            <input v-model.number="draft.radio.radioSf" type="number" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                        </label>
                        <label class="block text-xs text-gray-700">Coding rate
                            <input v-model.number="draft.radio.radioCr" type="number" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                        </label>
                    </div>
                </div>

                <div class="p-2 space-y-2">
                    <div class="text-sm font-medium text-gray-900">Channels</div>
                    <div class="text-xs text-gray-500">
                        Written to a station's slots in this order when it enters the mode, clearing any
                        other. A name beginning with # works its own key out, so a whole net joins by name.
                    </div>

                    <div v-if="draft.channels.length === 0" class="text-xs text-amber-700">
                        No channels: a station loading this would have every channel cleared.
                    </div>

                    <div v-for="(channel, index) of draft.channels" :key="index" class="border border-gray-200 rounded p-2 space-y-1">
                        <div class="flex items-center justify-between">
                            <div class="text-sm text-gray-900">{{ channel.name }}</div>
                            <button @click="removeChannel(index)" type="button" class="text-xs text-red-600 underline">Delete</button>
                        </div>
                        <div class="font-mono text-[10px] text-gray-500 break-all">{{ channel.secret }}</div>
                    </div>

                    <div class="flex space-x-2">
                        <input v-model="newChannelName" type="text" placeholder="#Emcomm, or a channel name" aria-label="New net channel name"
                               class="w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                        <button @click="addChannel" :disabled="newChannelName.trim() === ''" type="button"
                                class="bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 text-gray-700 text-xs font-medium rounded-lg px-3 py-2">Add</button>
                    </div>
                </div>

                <div class="p-2 space-y-2">
                    <div class="text-sm font-medium text-gray-900">Also</div>

                    <label class="flex items-start space-x-2 text-xs text-gray-700">
                        <input v-model="draft.radio.shareLocation" type="checkbox" class="mt-0.5">
                        <span>Answer from the radio itself</span>
                    </label>
                    <label class="flex items-start space-x-2 text-xs text-gray-700">
                        <input v-model="draft.radio.advertPosition" type="checkbox" class="mt-0.5">
                        <span>Put the station's position in every advert</span>
                    </label>
                    <label class="flex items-start space-x-2 text-xs text-gray-700">
                        <input v-model="draft.radio.multiAcks" type="checkbox" class="mt-0.5">
                        <span>Send each delivery acknowledgement more than once</span>
                    </label>
                    <label class="flex items-start space-x-2 text-xs text-gray-700">
                        <input v-model="draft.radio.autoAddContacts" type="checkbox" class="mt-0.5">
                        <span>Add contacts automatically</span>
                    </label>
                    <label class="flex items-start space-x-2 text-xs text-gray-700">
                        <input v-model="draft.autoAnswerPositions" type="checkbox" class="mt-0.5">
                        <span>Answer position requests automatically, without asking each time</span>
                    </label>
                    <label v-if="tab === 'training'" class="flex items-start space-x-2 text-xs text-gray-700">
                        <input v-model="draft.markDrill" type="checkbox" class="mt-0.5">
                        <span>Mark everything sent DRILL</span>
                    </label>
                    <label class="flex items-start space-x-2 text-xs text-gray-700">
                        <input v-model="draft.trimContacts" type="checkbox" class="mt-0.5">
                        <span>Drop contacts not heard in 90 days on entering</span>
                    </label>

                    <div class="text-xs text-gray-700">Repeating adverts, in minutes. 0 turns one off.</div>
                    <div class="grid grid-cols-2 gap-2">
                        <label class="block text-xs text-gray-700">Zero hop
                            <input v-model.number="draft.adverts.zeroHopMinutes" type="number" min="0" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                        </label>
                        <label class="block text-xs text-gray-700">Flood
                            <input v-model.number="draft.adverts.floodMinutes" type="number" min="0" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                        </label>
                    </div>

                    <label class="block text-xs text-gray-700">Announce on entering
                        <select v-model="draft.announce" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                            <option value="none">Nothing</option>
                            <option value="zerohop">Zero hop, heard by neighbours</option>
                            <option value="flood">Flood, carried by every repeater</option>
                        </select>
                    </label>
                </div>

                <div class="p-2 space-y-2">
                    <button @click="save" type="button"
                            class="w-full text-white bg-blue-700 hover:bg-blue-800 font-medium rounded-lg text-sm px-5 py-2.5">Save as the net default for {{ labelFor(tab) }}</button>

                    <button v-if="saved[tab]" @click="forget" type="button"
                            class="w-full bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-xs font-medium rounded-lg px-3 py-2">
                        Forget this net default
                    </button>

                    <div v-if="message" role="status" class="text-xs text-green-700">{{ message }}</div>
                </div>

            </template>

        </div>
    </SettingsSection>
</template>

<script>
/**
 * The net's own starting point, edited here and loaded from a mode tab.
 *
 * The operator asked for the editing to live in Settings and for the mode tabs to
 * only offer to load, which is the right split: a mode tab is about one station,
 * and this is about the net. It is also why this works with no radio connected —
 * nothing here belongs to a particular radio.
 *
 * Deliberately not the same component as the mode tabs. They share a shape but not
 * a job: that one edits a station's mode and can write it to the radio, this one
 * edits an agreement and can never write anything. Fewer fields here, and the two
 * missing ones — the node name and a power number — are missing on purpose.
 */
import SettingsSection from "./SettingsSection.vue";
import NetDefaults from "../../js/modes/NetDefaults.js";
import ModeProfiles, { MODE_CLASSES } from "../../js/modes/ModeProfiles.js";
import EmcommMode from "../../js/EmcommMode.js";
import Utils from "../../js/Utils.js";

export default {
    name: 'NetDefaultsGroup',
    components: {
        SettingsSection,
    },
    data() {
        return {
            tab: "live",
            draft: null,
            newChannelName: "",
            message: null,
        };
    },
    mounted() {
        this.load();
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
            this.draft = null;
            const stored = NetDefaults.get(this.tab);
            if(stored != null){
                const { savedAt, ...profile } = JSON.parse(JSON.stringify(stored));
                this.draft = { ...ModeProfiles.blank(), ...profile };
                return;
            }
            // nothing written yet: start from what the app would have done
            this.draft = await NetDefaults.startingPoint(this.tab);
        },

        async addChannel() {
            const name = this.newChannelName.trim();
            if(name === ""){
                return;
            }
            const secret = name.startsWith("#")
                ? Utils.bytesToHex(await EmcommMode.hashtagChannelKey(name))
                : Utils.bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
            this.draft.channels.push({ name: name, secret: secret });
            this.newChannelName = "";
        },

        removeChannel(index) {
            this.draft.channels.splice(index, 1);
        },

        save() {
            NetDefaults.save(this.tab, this.draft);
            this.message = `Saved as the net default for ${this.labelFor(this.tab)}. `
                + "Load it into a station from that mode's tab.";
        },

        async forget() {
            NetDefaults.clear(this.tab);
            this.message = `The net default for ${this.labelFor(this.tab)} is gone. Stations already set up keep what they have.`;
            await this.load();
        },

    },
    computed: {

        modes() {
            return NetDefaults.MODES;
        },

        /** Which modes have something written down, for the strip. */
        saved() {
            void NetDefaults.state.revision;
            return Object.fromEntries(NetDefaults.MODES.map((mode) => [mode, NetDefaults.has(mode)]));
        },

    },
};
</script>
