<template>
    <SettingsSection :title="title" :note="note" sub>
        <div class="p-2 space-y-2">

            <div v-if="notConnected" class="text-xs text-red-600">No radio connected.</div>

            <template v-else>

                <div v-if="listed.length === 0" class="text-xs text-gray-500">{{ emptyText }}</div>

                <div v-for="contact of listed" :key="hexOf(contact)" class="border border-gray-200 rounded p-2 space-y-1">

                    <!-- editing is the same row, rather than a dialog: the name being
                         changed should stay next to the key that says which station it is -->
                    <template v-if="editing === hexOf(contact)">
                        <label class="block text-xs text-gray-700">Name on this radio
                            <input v-model="editName" type="text" maxlength="31"
                                   class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                        </label>
                        <div class="flex space-x-2">
                            <button @click="saveName(contact)" :disabled="busy || editName.trim() === ''" type="button"
                                    class="text-white bg-blue-700 hover:bg-blue-800 disabled:bg-gray-400 text-xs font-medium rounded-lg px-3 py-2">Save</button>
                            <button @click="editing = null" :disabled="busy" type="button"
                                    class="bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-xs font-medium rounded-lg px-3 py-2">Cancel</button>
                        </div>
                        <div class="text-xs text-gray-500">
                            Changes this radio's copy of the name. If that station adverts again under its
                            own name, the radio may take that name back.
                        </div>
                    </template>

                    <template v-else>
                        <div class="flex items-center justify-between">
                            <div class="text-sm text-gray-900">{{ contact.advName }}</div>
                            <div class="shrink-0 ml-2 space-x-3">
                                <button @click="startEdit(contact)" :disabled="busy" type="button"
                                        class="text-xs text-blue-700 underline disabled:opacity-60">Edit</button>
                                <button @click="forget(contact)" :disabled="busy" type="button"
                                        class="text-xs text-red-600 underline disabled:opacity-60">Delete</button>
                            </div>
                        </div>
                        <div class="font-mono text-[10px] text-gray-500">{{ hexOf(contact).slice(0, 12) }}</div>
                    </template>

                </div>

                <!-- adding. A station is identified by its public key, and only its
                     own advert carries one, so there is nothing to type by hand -->
                <form @submit.prevent="add" class="flex space-x-2">
                    <input v-model="addText" type="text" autocomplete="off" :disabled="busy"
                           placeholder="meshcore://..." :aria-label="`Add ${title.toLowerCase()} by link`"
                           class="w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                    <button type="submit" :disabled="busy || addText.trim() === ''"
                            class="shrink-0 text-white bg-blue-700 hover:bg-blue-800 disabled:bg-gray-400 text-xs font-medium rounded-lg px-3 py-2">Add</button>
                </form>
                <div class="text-xs text-gray-500">{{ addNote }}</div>

                <div v-if="error" role="status" class="text-xs text-red-600">{{ error }}</div>
                <div v-else-if="message" role="status" class="text-xs text-green-700">{{ message }}</div>

            </template>

        </div>
    </SettingsSection>
</template>

<script>
/**
 * One kind of contact on the radio — companions, repeaters or rooms — listed with
 * a way to add, rename and forget them.
 *
 * These sit under the mode tabs and read the same in every mode, because contacts
 * are not part of a mode: they are who the radio has heard, they are kept in the
 * backup rather than written by a switch, and a change here reaches the radio at
 * once rather than waiting for one. The note under each heading says so, since the
 * surrounding tab is otherwise all promises about later.
 *
 * Adding is by `meshcore://` link only. A station is its public key, an advert is
 * the only thing that carries one, and there is nothing sensible to type by hand.
 * Repeaters can also arrive from the Repeater Search tab, and anything heard on air
 * arrives by itself when automatic contacts is on.
 */
import { Constants } from "@liamcottle/meshcore.js";
import SettingsSection from "./SettingsSection.vue";
import GlobalState from "../../js/GlobalState.js";
import Connection from "../../js/Connection.js";
import Utils from "../../js/Utils.js";

const KINDS = {
    companion: {
        title: "Companions",
        type: Constants.AdvType.Chat,
        note: "People and stations this radio can message. Not part of a mode: changes reach the radio now.",
        empty: "No companions yet. One arrives as soon as a station is heard, or from a link.",
        addNote: "Paste a meshcore:// link shared from another client.",
    },
    repeater: {
        title: "Repeaters",
        type: Constants.AdvType.Repeater,
        note: "Relays this radio knows about. Not part of a mode: changes reach the radio now.",
        empty: "No repeaters yet. The Repeater Search tab finds them on air.",
        addNote: "Paste a meshcore:// link, or find one on air from the Repeater Search tab.",
    },
    room: {
        title: "Rooms",
        type: Constants.AdvType.Room,
        note: "Rooms this radio is in. Every one of them can be used for a roll call, in every mode.",
        empty: "No rooms yet. A room can only be added from a link.",
        addNote: "Paste a meshcore:// link. Rooms have to be added this way: the room firmware does not answer discovery.",
    },
};

export default {
    name: 'ContactsGroup',
    components: {
        SettingsSection,
    },
    props: {
        /** "companion", "repeater" or "room". */
        kind: {
            type: String,
            required: true,
        },
    },
    data() {
        return {
            // public key hex of the contact being renamed, or null
            editing: null,
            editName: "",
            addText: "",
            busy: false,
            message: null,
            error: null,
        };
    },
    methods: {
        hexOf(contact) {
            return Utils.bytesToHex(contact.publicKey);
        },
        startEdit(contact) {
            this.editing = this.hexOf(contact);
            this.editName = contact.advName ?? "";
            this.message = null;
            this.error = null;
        },
        async saveName(contact) {
            const name = this.editName.trim();
            if(name === ""){
                return;
            }
            await this.run(async () => {
                await Connection.renameContact(contact.publicKey, name);
                this.editing = null;
                this.message = `Renamed to ${name}.`;
            });
        },
        async forget(contact) {
            const name = contact.advName?.trim() || "this contact";
            // forgetting a room loses the way back into it, and forgetting a
            // repeater loses the path through it, so it is asked rather than done
            if(!confirm(`Forget ${name}? The radio will not know it until it is heard again.`)){
                return;
            }
            await this.run(async () => {
                await Connection.removeContact(contact.publicKey);
                await Connection.loadContacts();
                this.message = `Forgot ${name}.`;
            });
        },
        async add() {
            await this.run(async () => {
                const { contact, alreadyKnown } = await Connection.importContact(this.addText);
                const name = contact.advName?.trim() || "that contact";
                this.addText = "";
                this.message = alreadyKnown ? `${name} was already here, and has been updated.` : `Added ${name}.`;
            });
        },
        /** Every action reports what happened, rather than leaving the list to imply it. */
        async run(work) {
            this.busy = true;
            this.message = null;
            this.error = null;
            try {
                await work();
            } catch(e) {
                this.error = String(e?.message ?? e) === Connection.DISCONNECTED
                    ? "No radio connected, so nothing changed."
                    : String(e?.message ?? e);
            } finally {
                this.busy = false;
            }
        },
    },
    computed: {
        spec() {
            return KINDS[this.kind] ?? KINDS.companion;
        },
        title() {
            return this.spec.title;
        },
        note() {
            return this.spec.note;
        },
        emptyText() {
            return this.spec.empty;
        },
        addNote() {
            return this.spec.addNote;
        },
        notConnected() {
            return GlobalState.connection == null || GlobalState.selfInfo == null;
        },
        listed() {
            return (GlobalState.contacts ?? [])
                .filter((c) => c.type === this.spec.type)
                .slice()
                .sort((a, b) => String(a.advName ?? "").localeCompare(String(b.advName ?? "")));
        },
    },
};
</script>
