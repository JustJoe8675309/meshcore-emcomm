<template>
    <Page>

        <!-- app bar -->
        <AppBar title="Settings">
            <template v-slot:trailing>
                <SaveButton @click="save" :is-saving="isSaving" :disabled="!canSave"/>
            </template>
        </AppBar>

        <div class="flex h-full w-full overflow-hidden">
            <div class="relative w-full overflow-y-auto">

                <!-- node details -->
                <div class="flex flex-col items-center p-4 leading-tight">
                    <div class="mb-2">
                        <div class="flex rounded-full h-20 w-20 text-white text-xl shadow bg-[#607e8c]">
                            <div class="mx-auto my-auto drop-shadow-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-8">
                                    <path fill-rule="evenodd" d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z" clip-rule="evenodd" />
                                </svg>
                            </div>
                        </div>
                    </div>
                    <div class="font-semibold">{{ GlobalState.selfInfo?.name }}</div>
                    <div v-if="GlobalState.selfInfo?.publicKey" class="text-sm text-gray-500">
                        &lt;{{ bytesToHex(GlobalState.selfInfo.publicKey.slice(0, 4)) }}...{{ bytesToHex(GlobalState.selfInfo.publicKey.slice(-4)) }}&gt;
                    </div>
                    <div v-if="deviceInfo" class="text-sm text-gray-500">
                        <span>Firmware Build Date: {{ deviceInfo.firmware_build_date }}</span>
                    </div>
                </div>

                <!-- setting groups -->
                <div class="space-y-4">

                    <!-- the fields below are empty rather than current, and saving
                         them would write the emptiness to the radio -->
                    <div v-if="loadError" role="status" class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg m-2 p-2">
                        {{ loadError }}
                    </div>

                    <div v-if="saveError" role="status" class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg m-2 p-2">
                        {{ saveError }}
                    </div>
                    <div v-else-if="saveMessage" role="status" class="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg m-2 p-2">
                        {{ saveMessage }}
                    </div>

                    <!-- the read waits its turn behind whatever else the radio is
                         doing, which after an advert can be a few seconds of
                         contact reload. Say so, rather than show empty fields -->
                    <div v-else-if="isLoading" role="status" class="bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg m-2 p-2">
                        Reading settings from the radio. Save is off until they have loaded.
                    </div>

                    <!-- Everything that takes effect the moment it is saved. Public
                         Info, Radio Settings and EMCOMM Settings were three groups
                         editing the same radio, transmit power appearing in all
                         three; they are one group now. -->
                    <!-- One tab per mode, identical in layout: what each will
                         write to the radio when it is entered. Any of them can be
                         edited from any other, so a station in a drill can set up
                         what it comes home to. -->
                    <ModeSettingsTabs ref="modes"/>

                    <SettingsSection title="Backups"
                                     note="Contacts, channels and their keys, and the radio settings.">

                        <!-- node backup. the way home for EMCOMM mode, so it says
                             plainly what it holds and when it was taken -->
                        <div class="w-full p-2 space-y-2">

                            <button
                                @click="backUpNow"
                                :disabled="isBackingUp || isRestoring || notConnected"
                                type="button"
                                class="w-full text-white bg-blue-700 hover:bg-blue-800 disabled:bg-gray-400 font-medium rounded-lg text-sm px-5 py-2.5">{{ isBackingUp ? "Backing up..." : "Back up current info" }}</button>

                            <button
                                @click="restoreLatest"
                                :disabled="isBackingUp || isRestoring || notConnected || backups.length === 0"
                                type="button"
                                class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-sm px-5 py-2.5">
                                <div>{{ isRestoring ? "Restoring..." : "Load last backup" }}</div>
                                <div class="text-xs font-normal text-gray-500">{{ lastBackupLabel }}</div>
                            </button>

                            <!-- the way home, whatever has been backed up since. Load last
                                 backup restores the newest, and a routine backup taken during
                                 the incident is newer than this one: on the bench that left
                                 the pre-EMCOMM slot intact but unreachable -->
                            <button
                                v-if="inEmcommMode && preEmcommBackup"
                                @click="restorePreEmcomm"
                                :disabled="isBackingUp || isRestoring || notConnected"
                                type="button"
                                class="w-full text-white bg-amber-700 hover:bg-amber-800 disabled:bg-gray-400 font-medium rounded-lg text-sm px-5 py-2.5">
                                <div>{{ isRestoring ? "Restoring..." : "Put the radio back as it was" }}</div>
                                <div class="text-xs font-normal">Writes the backup from before this station left normal mode, {{ preEmcommLabel }}</div>
                            </button>

                            <div v-if="backups.length > 0" class="flex space-x-2">
                                <button
                                    @click="exportBackup"
                                    type="button"
                                    class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 font-medium rounded-lg text-xs px-3 py-2">Save to file</button>
                                <button
                                    @click="$refs.backupFile.click()"
                                    type="button"
                                    class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 font-medium rounded-lg text-xs px-3 py-2">Load from file</button>
                            </div>
                            <button
                                v-else
                                @click="$refs.backupFile.click()"
                                type="button"
                                class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 font-medium rounded-lg text-xs px-3 py-2">Load from file</button>

                            <input ref="backupFile" @change="importBackup" type="file" accept="application/json,.json" class="hidden">

                            <div v-if="notConnected" role="status" class="text-xs text-red-600">
                                No radio connected, so there is nothing to back up.
                            </div>

                            <!-- backing up, restoring and converting each take a while and
                                 each is a string of commands to the radio. The page is covered
                                 until they finish: pressing Save or another restore in the
                                 middle queues behind it, and leaving the page leaves nothing
                                 on screen to say whether it worked -->
                            <BusyOverlay
                                v-if="busyTitle"
                                :title="busyTitle"
                                :step="backupProgress"
                                :done="backupSteps?.done ?? null"
                                :total="backupSteps?.total ?? null"
                                note="Keep the radio connected until this finishes."/>
                            <div v-if="backupError" role="status" class="text-xs text-red-600">{{ backupError }}</div>
                            <div v-if="backupMessage" role="status" class="text-xs text-green-700">{{ backupMessage }}</div>

                            <div v-for="warning of backupWarnings" :key="warning" role="status" class="text-xs text-amber-700">{{ warning }}</div>

                            <div class="text-xs text-gray-500">
                                Holds contacts, channels and their secrets, and the radio settings. Restoring
                                adds them back and removes nothing.
                            </div>

                            <div class="text-xs text-gray-500">
                                Switching modes is the banner at the top of the app. It takes its own backup
                                first, kept separately from the one above so routine backups cannot overwrite
                                the way back, and going back to normal writes it.
                            </div>

                        </div>

                    </SettingsSection>

                    <SettingsSection title="Commands">

                    <!-- commands -->
                    <div class="flex flex-col divide-y bg-white">

                        <!-- The first run walkthrough, on demand. It sat as a full
                             width button between the tabs and the live settings,
                             which read as part of the form above it. It is a thing
                             you go and do, like the RX Log, so it is a row here. -->
                        <div @click="firstRunOpen = true" class="flex cursor-pointer px-2 py-3 bg-white hover:bg-gray-50">

                            <!-- leading -->
                            <div class="my-auto ml-2 mr-4 text-gray-500">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.091 3.091ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.455L18 2.25l.259 1.036a3.375 3.375 0 0 0 2.456 2.455L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                                </svg>
                            </div>

                            <!-- title -->
                            <div class="my-auto mr-auto">
                                <div>Setup wizard</div>
                                <div class="text-xs text-gray-500">Walks through the three modes, one at a time</div>
                            </div>

                            <!-- trailing -->
                            <div class="my-auto mr-2 text-gray-500">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                                </svg>
                            </div>

                        </div>

                        <RouterLink :to="{ name: 'rxlog' }">
                            <div class="flex cursor-pointer px-2 py-3 bg-white hover:bg-gray-50">

                                <!-- leading -->
                                <div class="my-auto ml-2 mr-4 text-gray-500">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                                    </svg>
                                </div>

                                <!-- title -->
                                <div class="my-auto mr-auto">RX Log</div>

                                <!-- trailing -->
                                <div class="my-auto mr-2 text-gray-500">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                                    </svg>
                                </div>

                            </div>
                        </RouterLink>

                        <div @click="reboot" class="flex cursor-pointer px-2 py-3 bg-white hover:bg-gray-50">

                            <!-- leading -->
                            <div class="my-auto ml-2 mr-4 text-gray-500">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M5.636 5.636a9 9 0 1 0 12.728 0M12 3v9" />
                                </svg>
                            </div>

                            <!-- title -->
                            <div class="my-auto mr-auto">Reboot</div>

                            <!-- trailing -->
                            <div class="my-auto mr-2 text-gray-500">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                                </svg>
                            </div>

                        </div>

                    </div>

                    </SettingsSection>

                    <FirstRunSetup :open="firstRunOpen" @close="firstRunOpen = false"/>

                </div>

            </div>
        </div>

    </Page>
</template>

<script>
import Connection from "../../js/Connection.js";
import GlobalState from "../../js/GlobalState.js";
import AppBar from "../AppBar.vue";
import SaveButton from "../SaveButton.vue";
import Page from "./Page.vue";
import Utils from "../../js/Utils.js";
import AdvertSchedule from "../../js/AdvertSchedule.js";
import PositionService from "../../js/position/PositionService.js";
import NodeBackup from "../../js/NodeBackup.js";
import EmcommMode from "../../js/EmcommMode.js";
import SettingsSection from "../settings/SettingsSection.vue";
import ModeSettingsTabs from "../modes/ModeSettingsTabs.vue";
import FirstRunSetup from "../modes/FirstRunSetup.vue";
import ModeProfiles from "../../js/modes/ModeProfiles.js";
import BusyOverlay from "../BusyOverlay.vue";

export default {
    name: 'SettingsPage',
    components: {Page, SaveButton, AppBar, BusyOverlay, ModeSettingsTabs, FirstRunSetup, SettingsSection},
    data() {
        return {
            firstRunOpen: false,
            isSaving: false,
            // what the last Save did, said on the page. It was an alert(), which
            // stops the whole tab until it is dismissed: on the bench that meant
            // an operator could not tell a slow radio from a finished save, and
            // nothing else on the page could be read while it was up
            saveMessage: null,
            saveError: null,
            deviceInfo: null,
            loadError: null,
            // a read of the radio's settings is in flight
            isLoading: false,
            // the fields hold values the radio gave us, rather than blanks
            hasLoaded: false,
            isBackingUp: false,
            isRestoring: false,
            backupProgress: null,
            // a count for the loading screen, when the step has one
            backupSteps: null,
            // what the restore under way is for, as the loading screen names it
            restoreTitle: null,
            backupError: null,
            backupMessage: null,
            backupWarnings: [],
            backups: [],
        };
    },
    mounted() {
        this.load();
        this.refreshBackups();
    },
    methods: {

        refreshBackups() {
            const key = this.nodePublicKey;
            this.backups = key == null ? [] : NodeBackup.list(key);
        },

        async backUpNow() {

            this.isBackingUp = true;
            this.backupError = null;
            this.backupMessage = null;
            this.backupWarnings = [];
            this.backupProgress = "Reading the node...";

            try {

                const backup = await NodeBackup.capture();

                // the latest slot only. the pre-EMCOMM slot is written when
                // converting and never by this button, so routine use cannot
                // replace the way home with whatever the node looks like now
                if(!NodeBackup.save(backup, NodeBackup.SLOT_LATEST)){
                    this.backupError = "The backup could not be saved in this browser. Save it to a file instead.";
                } else {
                    this.backupMessage = `Backed up ${backup.contacts.length} contacts and ${backup.channels.length} channels.`;
                }

                this.backupWarnings = backup.warnings;
                this.refreshBackups();

            } catch(e) {
                this.backupError = this.describeBackupError(e);
            } finally {
                this.backupProgress = null;
                this.isBackingUp = false;
            }

        },

        async restoreLatest() {

            const entry = this.backups[0];
            if(entry == null){
                return;
            }

            const when = new Date(entry.backup.capturedAt).toLocaleString();
            if(!confirm(`Write the backup from ${when} back to this node?

Settings, channels and ${entry.backup.contacts.length} contacts will be restored. Nothing will be removed.`)){
                return;
            }

            await this.runRestore({ ...entry.backup, slot: entry.slot }, "Restoring the backup");

        },

        async restorePreEmcomm() {

            const entry = this.preEmcommBackup;
            if(entry == null){
                return;
            }

            const when = new Date(entry.backup.capturedAt).toLocaleString();
            if(!confirm(`Put the radio back as it was, writing the backup from ${when}, taken before this station left normal mode?

Settings, channels, ${entry.backup.contacts.length} contacts, and this app's advert schedule and position settings for the node will be restored.`)){
                return;
            }

            // leaving is meant to put the node back as it was, so what was added
            // while in the mode is offered for removal, named, rather than left
            // behind as an ordinary restore would. The operator may want to keep
            // stations met during the incident, so it is their choice
            let remove = null;
            try {
                const extras = await NodeBackup.extras(entry.backup);
                const total = extras.contacts.length + extras.channels.length;
                if(total > 0){
                    const names = (list, name) => list.slice(0, 5).map(name).join(", ") + (list.length > 5 ? ", ..." : "");
                    const parts = [];
                    if(extras.contacts.length > 0){
                        parts.push(`${extras.contacts.length} contact(s): ${names(extras.contacts, (c) => c.advName || Utils.bytesToHex(c.publicKey).slice(0, 8))}`);
                    }
                    if(extras.channels.length > 0){
                        parts.push(`${extras.channels.length} channel(s): ${names(extras.channels, (c) => c.name)}`);
                    }
                    if(confirm(`These were added while in EMCOMM mode and are not in the backup:

${parts.join(". ")}.

OK removes them, so the node is exactly as it was before. Cancel keeps them.`)){
                        remove = extras;
                    }
                }
            } catch(e) {
                this.backupWarnings = [`Could not check what was added while in EMCOMM mode, so nothing extra will be removed: ${e?.message ?? e}`];
            }

            await this.runRestore({ ...entry.backup, slot: NodeBackup.SLOT_PRE_EMCOMM }, "Putting the radio back as it was", remove);

        },

        async runRestore(backup, title = "Restoring the backup", remove = null) {

            this.isRestoring = true;
            this.restoreTitle = title;
            this.backupProgress = "Starting...";
            this.backupError = null;
            this.backupMessage = null;
            this.backupWarnings = [];

            // what other stations currently know this node as, to tell whether the
            // restore changes it
            const nameBefore = GlobalState.selfInfo?.name ?? null;

            try {

                const result = await NodeBackup.restore(backup, (p) => {
                    this.backupProgress = `Restoring ${p.what}`;
                    this.backupSteps = { done: p.done, total: p.total };
                }, { remove });
                this.backupSteps = null;

                this.backupMessage = `Restored ${backup.contacts.length} contacts and ${backup.channels.length} channels.`;
                if(remove){
                    this.backupMessage += ` Removed ${remove.contacts.length} contact(s) and ${remove.channels.length} channel(s) added since.`;
                }

                if(result.failures.length > 0){
                    // named rather than counted: which one failed decides what to do
                    this.backupWarnings = result.failures.map((f) => `${f.what} could not be restored: ${f.reason}`);
                }

                if(result.notInBackup.length > 0){
                    this.backupWarnings.push(
                        `${result.notInBackup.length} contact(s) on the node are not in this backup and were left alone: ${result.notInBackup.slice(0, 5).join(", ")}${result.notInBackup.length > 5 ? "..." : ""}`,
                    );
                }

                this.backupProgress = "Reading the node back...";
                await this.load();

                // A restore writes the name back but announces nothing, so every station
                // that heard the EMCOMM name went on showing it: on the bench node 2
                // listed node 1 as KJ5HBN-AUDIT until an advert went out by hand. One
                // zero hop advert, only when the name changed, tells the stations in
                // direct range. Stations further out learn it at the next flood advert.
                const nameAfter = backup.settings?.name ?? null;
                if(nameAfter != null && nameAfter !== nameBefore){
                    this.backupProgress = "Announcing the name to stations in range...";
                    try {
                        await Connection.sendZeroHopAdvert();
                        this.backupMessage += ` A zero hop advert went out, so stations in direct range see it as ${nameAfter} again.`;
                    } catch(e) {
                        this.backupWarnings.push(`The name is back to ${nameAfter}, but the advert telling stations in range did not go out. Send one from the header menu.`);
                    }
                }

                // writing that backup is what puts the station back in normal
                // mode. Only the pre-normal backup means that: restoring an
                // ordinary one is just a restore, and may well have been taken
                // while in an emcomm mode
                if(this.nodePublicKey != null && backup.slot === NodeBackup.SLOT_PRE_EMCOMM){
                    ModeProfiles.setCurrent("normal", this.nodePublicKey);
                    EmcommMode.markLeft(this.nodePublicKey);
                }

            } catch(e) {
                this.backupError = this.describeBackupError(e);
            } finally {
                this.backupProgress = null;
                this.backupSteps = null;
                this.isRestoring = false;
                this.restoreTitle = null;
            }

        },

        exportBackup() {
            const entry = this.backups[0];
            if(entry == null){
                return;
            }
            const file = NodeBackup.toFile(entry.backup);
            const url = URL.createObjectURL(new Blob([file.contents], { type: "application/json" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = file.filename;
            link.click();
            URL.revokeObjectURL(url);
        },

        async importBackup(event) {

            const file = event.target.files?.[0];
            event.target.value = "";
            if(file == null){
                return;
            }

            this.backupError = null;
            this.backupMessage = null;
            this.backupWarnings = [];

            try {

                // checked against this node before it can be offered: writing
                // another node's contacts and channels over this one would be both
                // wrong and tedious to undo
                const backup = NodeBackup.fromFile(await file.text(), this.nodePublicKey);
                const when = new Date(backup.capturedAt).toLocaleString();

                if(!confirm(`Restore the backup from ${when}?

Settings, channels and ${backup.contacts.length} contacts will be written to this node. Nothing will be removed.`)){
                    return;
                }

                await this.runRestore(backup);

            } catch(e) {
                this.backupError = String(e?.message ?? e);
            }

        },

        describeBackupError(e) {
            const reason = String(e?.message ?? e);
            return reason === Connection.DISCONNECTED
                ? "The radio disconnected, so nothing was read or written."
                : reason;
        },








        async load() {

            this.loadError = null;
            this.isLoading = true;

            try {
                await Connection.loadSelfInfo(Connection.READ_TIMEOUT_MILLIS);
            } catch(e) {
                // every field below is filled from self info, so a failure here used
                // to leave the whole page blank with nothing said. An empty Name box
                // looks like a node with no name, and saving it would write one.
                this.loadError = this.hasLoaded
                    ? "Could not re-read the settings from the radio. The fields show what was last read, which may no longer be current, so Save is off."
                    : "Could not read the current settings from the radio, so the fields below are empty. Save is off until they have loaded.";
                this.hasLoaded = false;
                this.isLoading = false;
                console.log(e);
                return;
            }

            this.hasLoaded = true;
            this.isLoading = false;

            // after the fields, not before: the firmware details are one more turn
            // in the queue, and nothing above waits on them
            await this.loadDeviceInfo();

        },
        async loadDeviceInfo() {
            try {
                this.deviceInfo = await Connection.deviceQuery();
            } catch(e) {
                console.log(e);
            }
        },
        async save() {

            // the button is disabled too; this covers anything that reaches save
            // another way. Blank fields would be written to the radio as blanks
            if(!this.canSave){
                return;
            }

            this.isSaving = true;
            this.saveMessage = null;
            this.saveError = null;

            try {

                // The one Save on the page, and it saves the mode tab on show.
                //
                // Everything else here acts when it is pressed: the operator's
                // details as they are typed, the contacts, the position and the
                // clock. Those are not promises about a mode, so there is nothing
                // for a Save to hold back.
                await this.$refs.modes?.save();

                this.saveMessage = "Saved.";
                this.saveError = null;

            } catch(e) {
                console.log(e);
                this.saveMessage = null;
                this.saveError = `Could not save: ${e?.message ?? e}`;
            } finally {

                // show loading
                this.isSaving = false;

            }

        },
        async reboot() {

            // ask user to confirm action
            if(!confirm("Are you sure you want to reboot this device?")){
                return;
            }

            // tell radio to reboot
            try {
                await Connection.reboot();
            } catch(e) {
                alert("Failed to reboot device!");
                console.log(e);
                return;
            }

            // tell user device is rebooting
            alert("Device is rebooting. You will need to reconnect!");

            // go back to main page
            this.$router.push({
                name: "main",
            });

        },
        bytesToHex(uint8Array) {
            return Utils.bytesToHex(uint8Array);
        },
    },
    computed: {

        // what the loading screen says is under way, or null for no screen. A
        // conversion waiting on its confirmation dialog has no step and is not
        // covered, since the operator has a decision to make
        busyTitle() {
            if(this.isRestoring){
                return this.restoreTitle ?? "Restoring the backup";
            }
            if(this.isBackingUp){
                return "Backing up the node";
            }
            return null;
        },
        canSave() {
            return this.hasLoaded && !this.isLoading && !this.isSaving;
        },

        notConnected() {
            return GlobalState.connection == null;
        },

        nodePublicKey() {
            const key = GlobalState.selfInfo?.publicKey;
            return key == null ? null : Utils.bytesToHex(key);
        },

        // whether this station is away from normal mode, and so has a way home
        inEmcommMode() {
            // read so this recomputes when the mode changes; the mode itself is
            // kept in browser storage, which the page cannot watch
            GlobalState.emcommModeRevision;
            void ModeProfiles.state.revision;
            return this.nodePublicKey != null && ModeProfiles.current(this.nodePublicKey) !== "normal";
        },

        preEmcommBackup() {
            return this.backups.find((entry) => entry.slot === NodeBackup.SLOT_PRE_EMCOMM) ?? null;
        },

        preEmcommLabel() {
            const entry = this.preEmcommBackup;
            return entry == null ? "" : new Date(entry.backup.capturedAt).toLocaleString();
        },

        lastBackupLabel() {
            const entry = this.backups[0];
            if(entry == null){
                return "No backup yet";
            }
            const when = new Date(entry.backup.capturedAt).toLocaleString();
            return entry.slot === NodeBackup.SLOT_PRE_EMCOMM ? `${when} (before EMCOMM mode)` : when;
        },








        GlobalState() {
            return GlobalState;
        },
    },
}
</script>
