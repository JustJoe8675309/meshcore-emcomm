<template>
    <div class="bg-white divide-y">

        <div v-if="only == null" class="bg-white p-2 font-semibold">Modes</div>

        <div v-if="only == null" class="p-2 text-xs text-gray-500">
            Each mode holds its own radio settings and channels. Switching writes them to the
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

        <!-- No record of home, on a station that is not at home. There is nothing
             to show and nothing that could be saved: a form filled from the radio
             as it stands would be the drill, written down as this station's own. -->
        <div v-else-if="normalUnknown" class="p-2 space-y-2">
            <div class="text-sm font-medium text-gray-900">This computer has no record of this station's normal settings</div>
            <div class="text-xs text-gray-700">
                Normal mode is the radio as its owner has it, and the only way to learn it is to read a
                radio that is in it. This station is in {{ labelFor(current) }}, so there is nothing here
                to show and nothing to save.
            </div>
            <div class="text-xs text-gray-700">
                Take it home from the computer you left it on, or load a backup file under Settings. Once
                it is in normal mode, connecting records it.
            </div>
        </div>

        <div v-else-if="profile == null" class="p-2 text-xs text-gray-500">Reading this mode...</div>

        <template v-else>

            <!-- Each heading folds. A mode is a long form and an operator comes to
                 it for one thing, so it opens as a list of headings rather than a
                 page they have to scroll past. Radio opens by default: it is what
                 the tab is mostly about. -->
            <SettingsSection title="Radio" note="What this mode writes to the radio when it is entered." sub>
                <div class="p-2 space-y-2">

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

                </div>
            </SettingsSection>

            <!-- Who is operating. Not part of a mode either: a drill does not put
                 someone else in the chair, so this reads the same in every tab. -->
            <OperatorSettingsGroup/>

            <!-- Who the radio knows. Not part of a mode: a switch does not write
                 them and coming home does not take them away, so these read the
                 same in every tab and a change here reaches the radio at once.
                 They are here because this is where an operator looks. -->
            <ContactsGroup kind="companion"/>
            <ContactsGroup kind="repeater"/>

            <!-- channels written to the radio in this mode -->
            <SettingsSection title="Channels" note="What this mode can hear. Written to the radio's slots when the mode is entered." sub>
                <div class="p-2 space-y-2">
                    <div class="text-xs text-gray-500">
                        Written in this order when the mode is entered, and any other channel is cleared.
                        A name beginning with # has its key worked out from the name, so a whole net joins
                        by name.
                    </div>

                    <div v-if="profile.channels.length === 0" class="text-xs text-amber-700">
                        No channels: this mode would clear every channel from the radio.
                    </div>

                    <div v-for="(channel, index) of profile.channels" :key="index" class="border border-gray-200 rounded p-2 space-y-1">

                        <!-- renaming a # channel changes its key, since the key comes
                             from the name: said here rather than found out on air -->
                        <template v-if="editingChannel === index">
                            <label class="block text-xs text-gray-700">Channel name
                                <input v-model="editChannelName" type="text" aria-label="Channel name"
                                       class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                            </label>
                            <label class="block text-xs text-gray-700">Key
                                <input v-model="editChannelSecret" type="text" aria-label="Channel key" spellcheck="false"
                                       :disabled="editChannelName.trim().startsWith('#')"
                                       class="mt-0.5 w-full bg-gray-50 border border-gray-300 disabled:bg-gray-100 font-mono text-xs rounded p-2">
                            </label>
                            <div v-if="editChannelName.trim().startsWith('#')" class="text-xs text-gray-500">
                                A # name works its own key out, so the key follows the name.
                            </div>
                            <div class="flex space-x-2">
                                <button @click="saveChannel(index)" :disabled="!canSaveChannel" type="button"
                                        class="text-white bg-blue-700 hover:bg-blue-800 disabled:bg-gray-400 text-xs font-medium rounded-lg px-3 py-2">Save</button>
                                <button @click="editingChannel = null" type="button"
                                        class="bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-xs font-medium rounded-lg px-3 py-2">Cancel</button>
                            </div>
                            <div class="text-xs text-amber-700">
                                Messages are filed under a channel's key, so changing the key starts a new
                                history. The old one is kept, and comes back if the key does.
                            </div>
                        </template>

                        <template v-else>
                            <div class="flex items-center justify-between">
                                <div class="text-sm text-gray-900">{{ channel.name }}</div>
                                <div class="shrink-0 ml-2 space-x-3">
                                    <button @click="startEditChannel(index)" type="button" class="text-xs text-blue-700 underline">Edit</button>
                                    <button @click="removeChannel(index)" type="button" class="text-xs text-red-600 underline">Delete</button>
                                </div>
                            </div>
                            <div class="font-mono text-[10px] text-gray-500 break-all">{{ channel.secret }}</div>
                        </template>

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
            </SettingsSection>

            <ContactsGroup kind="room"/>

            <!-- Every yes or no a mode holds, in one place. The radio's four used
                 to sit among the numbers above, where a tick next to a frequency
                 field reads as part of it. -->
            <SettingsSection title="Also" note="Everything this mode turns on or off." sub>
                <div class="p-2 space-y-2">

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
            </SettingsSection>

            <div class="p-2 space-y-2">
                <div v-if="message" role="status" class="text-xs text-gray-600">{{ message }}</div>
                <!-- the wizard shows this editor in a dialog, so the page's Save
                     is behind it: there, Next is what saves -->
                <div v-if="tab === current" class="text-xs text-gray-500">
                    <span class="font-medium">{{ savedBy }}</span> saves this tab. This station is in this mode,
                    so saving writes these settings to the radio. Channels are written when a mode is entered,
                    from the banner.
                </div>
                <div v-else class="text-xs text-gray-500">
                    <span class="font-medium">{{ savedBy }}</span> saves this tab. Nothing here reaches the
                    radio until this station enters {{ labelFor(tab) }}.
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
import ModeSwitch from "../../js/modes/ModeSwitch.js";
import SettingsSection from "../settings/SettingsSection.vue";
import ContactsGroup from "../settings/ContactsGroup.vue";
import OperatorSettingsGroup from "../settings/OperatorSettingsGroup.vue";

export default {
    name: 'ModeSettingsTabs',
    components: {
        SettingsSection,
        ContactsGroup,
        OperatorSettingsGroup,
    },
    props: {
        /** One mode only, with no tab strip: what the first run wizard asks for. */
        only: {
            type: String,
            default: null,
        },
    },
    data() {
        return {
            tab: "normal",
            profile: null,
            newChannelName: "",
            // counts the reads, so a slow one cannot land on a later tab
            loadToken: 0,
            // index of the channel being edited, or null
            editingChannel: null,
            editChannelName: "",
            editChannelSecret: "",
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
        /**
         * Reads the tab's mode, and only shows it if it is still the tab on show.
         *
         * Reading a mode reads the radio's channel slots, which takes seconds. An
         * operator who taps another tab while that is running used to get the
         * first mode's profile written onto the second tab when the slow read
         * finally came back — and then Save would save it under the wrong mode.
         * Caught by a test for something else: the Normal tab of a station with no
         * record of home showed the drill's profile.
         */
        async load() {
            const token = ++this.loadToken;
            if(this.notConnected){
                return;
            }
            this.profile = null;
            if(this.tab === "normal" && ModeProfiles.normalUnknown()){
                return;
            }
            try {
                const profile = await ModeProfiles.profileOrDefault(this.tab);
                if(token === this.loadToken){
                    this.profile = profile;
                }
            } catch(e) {
                if(token === this.loadToken){
                    this.message = `Could not read this mode: ${e?.message ?? e}`;
                }
            }
        },
        async save() {

            if(this.profile == null){
                return;
            }

            ModeProfiles.saveProfile(this.tab, JSON.parse(JSON.stringify(this.profile)));

            // Another mode is a promise about later. The mode the station is in is
            // the radio, so saving it writes it: an operator who changes the power
            // and presses Save means now, not after a round trip through another
            // mode and back.
            if(this.tab !== this.current){
                this.message = `${this.labelFor(this.tab)} saved. It reaches the radio when this station enters that mode.`;
                return;
            }

            this.busy = true;
            this.message = `Writing ${this.labelFor(this.tab)} to the radio...`;
            try {
                const { failures } = await ModeSwitch.applySettings(this.tab);
                this.message = failures.length === 0
                    ? `${this.labelFor(this.tab)} saved, and written to the radio.`
                    : `${this.labelFor(this.tab)} saved, but the radio did not take ${failures.map((f) => f.what).join(", ")}.`;
            } catch(e) {
                // saved either way: the profile is written before any of this, so
                // a radio that would not answer has not lost the operator's work
                this.message = `${this.labelFor(this.tab)} saved, but it could not be written to the radio: ${e?.message ?? e}`;
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
            this.editingChannel = null;
        },
        startEditChannel(index) {
            const channel = this.profile.channels[index];
            this.editingChannel = index;
            this.editChannelName = channel.name;
            this.editChannelSecret = channel.secret;
        },
        async saveChannel(index) {
            const name = this.editChannelName.trim();
            if(name === ""){
                return;
            }
            // a # channel's key is its name, so renaming one to another # name has
            // to work the new key out: leaving the old key would put this station
            // on a channel called one thing and keyed as another
            const secret = name.startsWith("#")
                ? Utils.bytesToHex(await EmcommMode.hashtagChannelKey(name))
                : this.editChannelSecret.trim().toLowerCase();
            this.profile.channels[index] = { name: name, secret: secret };
            this.editingChannel = null;
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
        /** What the operator should press, which is not the same in the wizard. */
        savedBy() {
            return this.only == null ? "Save, at the top of the page," : "Next, below,";
        },
        canAddChannel() {
            return this.profile != null && this.newChannelName.trim() !== "" && this.profile.channels.length < 16;
        },
        /** Normal, on a station away from home, with nothing written down. */
        normalUnknown() {
            void ModeProfiles.state.revision;
            void GlobalState.emcommModeRevision;
            return this.tab === "normal" && !this.notConnected && ModeProfiles.normalUnknown();
        },
        canSaveChannel() {
            const name = this.editChannelName.trim();
            if(name === ""){
                return false;
            }
            if(name.startsWith("#")){
                return true;
            }
            // a channel key is 16 bytes. A short or mistyped one is not refused by
            // the radio, it simply hears nothing, which is the worst way to find out
            return /^[0-9a-f]{32}$/i.test(this.editChannelSecret.trim());
        },
    },
}
</script>
