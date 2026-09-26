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
                    <!-- what the radio is at now, beside what this mode would set it
                         to. There was a button elsewhere that raised it to maximum;
                         it is this field and Save -->
                    <div v-if="radioNow" class="text-xs text-gray-500">
                        The radio is at {{ radioNow.txPower }} of {{ radioNow.maxTxPower }} dBm now.
                    </div>

                </div>
            </SettingsSection>

            <!-- Who is operating. Not part of a mode either: a drill does not put
                 someone else in the chair, so this reads the same in every tab. -->
            <OperatorSettingsGroup/>

            <!-- where the station is, and its clock: the radio now, held by no
                 mode, acting when pressed rather than waiting for Save -->
            <RadioNowGroup/>

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

                    <!-- a permission in the radio's own firmware, and the one
                         tick here with a consequence when the app is shut -->
                    <label class="flex items-start space-x-2 text-xs text-gray-700">
                        <input v-model="profile.radio.shareLocation" type="checkbox" class="mt-0.5">
                        <span>Answer from the radio itself</span>
                    </label>
                    <div class="pl-6 text-xs text-gray-500 space-y-1">
                        <p>
                            On, the radio answers any station asking for its position and battery voltage
                            <span class="font-medium">by itself, with this app closed</span>, from a live GPS fix.
                            It answers immediately and with no record, so it is the tick to think about if you
                            would rather not be found.
                        </p>
                        <p>
                            It is also how this app reaches a station whose own app is shut — it falls back to
                            asking the radio after 30 seconds — and the only way a station running the stock app
                            can ever get your position, since the datagrams this app sends are invisible to it.
                        </p>
                    </div>
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
                    <div class="pl-6 text-xs text-gray-500">
                        Off, each request asks you first — send, send with a message to follow, or decline, and
                        nothing goes out until you say so. On, the position goes with no prompt. Every channel
                        this radio holds is answered, every room it is in, and any station asking directly: the
                        only choice is whether you are asked. Each mode has its own, so a drill can answer by
                        itself while everyday operating asks first.
                    </div>

                    <!-- not offered in normal mode. DRILL marks an exercise, and
                         a station's everyday operating is not one: a tick that puts
                         DRILL on real traffic is a way to be disbelieved when it
                         matters. -->
                    <label v-if="tab !== 'normal'" class="flex items-start space-x-2 text-xs text-gray-700">
                        <input v-model="profile.markDrill" type="checkbox" class="mt-0.5">
                        <span>Mark everything sent DRILL</span>
                    </label>

                    <label class="flex items-start space-x-2 text-xs text-gray-700">
                        <input v-model="profile.trimContacts" type="checkbox" class="mt-0.5">
                        <span>Drop contacts not heard in 90 days when entering this mode. Favourites are kept, and the backup keeps everything</span>
                    </label>


                    <!-- What entering the mode does, as against what it writes.
                         These were in every profile and ran on every switch with
                         no screen offering them: an operator could not see that
                         entering a mode would move their position or announce
                         them to the whole mesh, let alone stop it. -->
                    <div class="pt-1 text-xs font-medium text-gray-900">On entering this mode</div>

                    <label class="block text-xs text-gray-700">Announce the station
                        <select v-model="profile.announce" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                            <option value="none">Say nothing</option>
                            <option value="zerohop">Zero hop, heard by neighbours</option>
                            <option value="flood">Flood, carried by every repeater</option>
                        </select>
                    </label>

                    <label class="flex items-start space-x-2 text-xs text-gray-700">
                        <input v-model="profile.syncClock" type="checkbox" class="mt-0.5">
                        <span>Set the radio's clock from this device. Message times come from the radio, so a
                            clock that has drifted makes a log that disagrees with everyone else's</span>
                    </label>

                    <label class="flex items-start space-x-2 text-xs text-gray-700">
                        <input v-model="profile.positionFromGps" type="checkbox" class="mt-0.5">
                        <span>Take the position from a live GPS fix. A radio without one is left alone rather
                            than moved to 0, 0</span>
                    </label>

                    <label class="flex items-start space-x-2 text-xs text-gray-700">
                        <input v-model="profile.discoverRepeaters" type="checkbox" class="mt-0.5">
                        <span>Search for repeaters in direct range, and say what answered</span>
                    </label>

                    <div class="pt-1 text-xs text-gray-700">Repeating adverts, in minutes. 0 turns one off.</div>
                    <div class="grid grid-cols-2 gap-2">
                        <label class="block text-xs text-gray-700">Zero hop
                            <input v-model.number="profile.adverts.zeroHopMinutes" type="number" min="0" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                        </label>
                        <label class="block text-xs text-gray-700">Flood
                            <input v-model.number="profile.adverts.floodMinutes" type="number" min="0" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                        </label>
                    </div>

                    <!-- and what they have actually done, which is the half a
                         setting cannot tell you -->
                    <AdvertProgressGroup v-if="tab === current"/>

                </div>
            </SettingsSection>

            <div class="p-2 space-y-2">

                <!-- Only the emcomm modes have a default to go back to. Normal is
                     the radio as its owner has it, which no app can invent.
                     Editing the net defaults is in Settings, not here: this tab is
                     about one station, and they are about the net. -->
                <button v-if="hasNetDefault" @click="loadNetDefault" :disabled="busy" type="button"
                        class="w-full bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 text-gray-700 text-xs font-medium rounded-lg px-3 py-2">
                    Load the net default for {{ labelFor(tab) }}
                </button>

                <button v-if="tab !== 'normal'" @click="resetToDefault" :disabled="busy" type="button"
                        class="w-full bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 text-gray-700 text-xs font-medium rounded-lg px-3 py-2">
                    Start {{ labelFor(tab) }} again from the app's defaults
                </button>

                <div v-if="unsaved" role="status" class="text-xs text-amber-800">
                    Not saved yet. This tab keeps what you typed while the app is open, including if you look
                    at another mode, but a reload starts again from what is written down.
                </div>
                <div v-if="message" role="status" class="text-xs text-gray-600">{{ message }}</div>
                <!-- the wizard shows this editor in a dialog, so the page's Save
                     is behind it: there, Next is what saves -->
                <div v-if="savesToRadio" class="text-xs text-gray-500">
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
import NetDefaults from "../../js/modes/NetDefaults.js";
import SettingsSection from "../settings/SettingsSection.vue";
import ContactsGroup from "../settings/ContactsGroup.vue";
import OperatorSettingsGroup from "../settings/OperatorSettingsGroup.vue";
import RadioNowGroup from "../settings/RadioNowGroup.vue";
import AdvertProgressGroup from "../settings/AdvertProgressGroup.vue";

export default {
    name: 'ModeSettingsTabs',
    components: {
        SettingsSection,
        ContactsGroup,
        OperatorSettingsGroup,
        RadioNowGroup,
        AdvertProgressGroup,
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
            // edits on tabs that were left without saving, by mode
            drafts: {},
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
            // Keep what was typed into the tab being left.
            //
            // Reading a mode reads the radio, so every tab switch used to throw
            // away the edits on the tab you left, silently. An operator setting up
            // a mode who taps another tab to check something loses their work and
            // is not told. Held in memory only: a reload starts from what is
            // written down, which is the truth about the radio.
            if(this.profile != null){
                this.drafts[this.tab] = JSON.parse(JSON.stringify(this.profile));
            }
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
            // what was typed into this tab before, if it was left without saving
            if(this.drafts[this.tab] != null){
                this.profile = JSON.parse(JSON.stringify(this.drafts[this.tab]));
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
        /**
         * Saves the tab. `{ toRadio: false }` writes the profile down and stops
         * there, whatever mode the station is in.
         *
         * The wizard needs that. Its first screen promises "nothing here is
         * written to the radio", and it walks all three modes whether or not this
         * browser has ever seen them — so on a fresh browser every step holds
         * values invented from defaults seconds earlier. Writing those to a
         * station that is sitting in that mode replaces its real settings with
         * ones nobody has looked at. It happened on the bench: a station left in
         * Emcomm-Training came back from another computer transmitting at the
         * default maximum instead of the 14 dBm it had been set to.
         */
        async save({ toRadio = true } = {}) {

            if(this.profile == null){
                return;
            }

            // normal mode does not offer the DRILL tick, so it cannot be left
            // set from an older profile where it would be invisible and still true
            if(this.tab === "normal"){
                this.profile.markDrill = false;
            }

            ModeProfiles.saveProfile(this.tab, JSON.parse(JSON.stringify(this.profile)));
            delete this.drafts[this.tab];

            if(!toRadio){
                this.message = `${this.labelFor(this.tab)} saved. Entering the mode is what writes it to the radio.`;
                return;
            }

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
        /**
         * Fills the tab from the net's own default, keeping what is this station's.
         *
         * The station's name stays its own — two stations answering to one name is
         * the fault mode sharing already refuses — and the power becomes as high as
         * this radio goes, because a net cannot know what each radio manages.
         *
         * Filled and not saved, like every other load here: the operator sees what
         * they are about to accept before it is written down, and the radio is
         * reached by entering the mode.
         */
        async loadNetDefault() {
            this.busy = true;
            this.message = null;
            try {
                const filled = await NetDefaults.forStation(this.tab, {
                    name: this.profile?.radio?.name ?? GlobalState.selfInfo?.name ?? "",
                    maxTxPower: GlobalState.selfInfo?.maxTxPower ?? this.profile?.radio?.txPower ?? null,
                });
                if(filled == null){
                    this.message = "There is no net default for this mode yet. Settings has the place to write one.";
                    return;
                }
                this.profile = filled;
                this.message = `${this.labelFor(this.tab)} filled from the net default, keeping this station's name `
                    + "and its own maximum power. Nothing is written down or sent to the radio until you press Save.";
            } finally {
                this.busy = false;
            }
        },

        /**
         * Puts the tab back to what this mode starts out as, ready to look at.
         *
         * Not saved and not written: the operator sees what they are about to
         * accept and presses Save themselves, so a mistyped mode can be undone
         * without a second mistake. The channels come back too, which is the part
         * worth the warning — anything added to this mode goes with them.
         */
        async resetToDefault() {
            if(this.tab === "normal"){
                return;
            }
            this.busy = true;
            this.message = null;
            try {
                this.profile = await ModeProfiles.defaultEmcommProfile(this.tab);
                this.message = `${this.labelFor(this.tab)} is back to its defaults, including its channels. `
                    + "Nothing is written down or sent to the radio until you press Save.";
            } catch(e) {
                this.message = `Could not read the radio: ${e?.message ?? e}`;
            } finally {
                this.busy = false;
            }
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
        /** The wizard writes nothing to the radio, and says so on every step. */
        savesToRadio() {
            return this.only == null && this.tab === this.current;
        },
        canAddChannel() {
            return this.profile != null && this.newChannelName.trim() !== "" && this.profile.channels.length < 16;
        },
        /**
         * Emcomm modes always have one: the operator's, or the settings the app
         * ships with. Normal never does.
         */
        hasNetDefault() {
            void NetDefaults.state.revision;
            return NetDefaults.applies(this.tab);
        },
        /** The radio as it stands, for the readouts beside a mode's fields. */
        radioNow() {
            return GlobalState.selfInfo ?? null;
        },
        /** Whether this tab holds edits that are not written down yet. */
        unsaved() {
            void ModeProfiles.state.revision;
            if(this.profile == null){
                return false;
            }
            const stored = ModeProfiles.profile(this.tab);
            return stored == null || JSON.stringify(stored) !== JSON.stringify(this.profile);
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
