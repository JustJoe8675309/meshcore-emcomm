<template>
    <div class="flex flex-col h-full w-full overflow-hidden">

        <!-- search -->
        <div class="flex bg-white border-b border-gray-300 divide-x">
            <div v-if="userContacts.length > 0" class="flex p-1 w-full">
                <input v-model="contactsSearchTerm" type="text" :placeholder="`Search ${userContacts.length} ${userContacts.length === 1 ? 'Contact' : 'Contacts'} by name or key...`" class="h-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
            </div>
            <div class="flex text-gray-500 ml-auto">
                <button
                    @click="showImport = !showImport"
                    type="button"
                    :aria-expanded="showImport"
                    aria-label="Add a contact from a link"
                    title="Add a contact from a link"
                    class="px-2 hover:text-gray-900">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
                        <path fill-rule="evenodd" d="M12 3.75a.75.75 0 0 1 .75.75v6.75h6.75a.75.75 0 0 1 0 1.5h-6.75v6.75a.75.75 0 0 1-1.5 0v-6.75H4.5a.75.75 0 0 1 0-1.5h6.75V4.5a.75.75 0 0 1 .75-.75Z" clip-rule="evenodd" />
                    </svg>
                </button>
            </div>
            <div v-if="userContacts.length > 0" class="flex text-gray-500">
                <DropDownMenu class="mx-auto my-auto">
                    <template v-slot:button>
                        <IconButton class="mx-1">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
                                <path d="M18.75 12.75h1.5a.75.75 0 0 0 0-1.5h-1.5a.75.75 0 0 0 0 1.5ZM12 6a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 12 6ZM12 18a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 12 18ZM3.75 6.75h1.5a.75.75 0 1 0 0-1.5h-1.5a.75.75 0 0 0 0 1.5ZM5.25 18.75h-1.5a.75.75 0 0 1 0-1.5h1.5a.75.75 0 0 1 0 1.5ZM3 12a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 3 12ZM9 3.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5ZM12.75 12a2.25 2.25 0 1 1 4.5 0 2.25 2.25 0 0 1-4.5 0ZM9 15.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z" />
                            </svg>
                        </IconButton>
                    </template>
                    <template v-slot:items>
                        <div class="p-2 border-b text-sm font-bold">Order</div>
                        <DropDownMenuItem @click="order = 'a-z'">
                            <input type="radio" :checked="order === 'a-z'"/>
                            <div class="my-auto" :class="{ 'font-bold': order === 'a-z' }">A-Z</div>
                        </DropDownMenuItem>
                        <DropDownMenuItem @click="order = 'heard-recently'">
                            <input type="radio" :checked="order === 'heard-recently'"/>
                            <div class="my-auto" :class="[ order === 'heard-recently' ? 'font-bold' : '' ]">Heard Recently</div>
                        </DropDownMenuItem>
                    </template>
                </DropDownMenu>
            </div>
        </div>

        <!-- adding a contact by hand. the only way to add a room server, because
             discovery cannot find one: the room firmware does not implement the
             control packet, so a room is invisible until it adverts in earshot -->
        <div v-if="showImport" class="bg-white border-b border-gray-300 p-3 space-y-2">

            <div class="text-sm font-medium text-gray-900">Add a contact from a link</div>
            <div class="text-xs text-gray-500">
                Paste a <span class="font-mono">meshcore://</span> link, shared from another client.
                Rooms have to be added this way, since discovery cannot find them.
            </div>

            <form @submit.prevent="importContact" class="flex space-x-2">
                <input
                    v-model="importText"
                    id="import-contact"
                    type="text"
                    autocomplete="off"
                    :disabled="isImporting"
                    placeholder="meshcore://..."
                    aria-label="Contact link"
                    class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                <button
                    type="submit"
                    :disabled="isImporting"
                    class="shrink-0 text-white bg-blue-700 hover:bg-blue-800 disabled:bg-gray-400 font-medium rounded-lg text-sm px-4">{{ isImporting ? "..." : "Add" }}</button>
            </form>

            <div v-if="importError" role="status" class="text-xs text-red-600">{{ importError }}</div>
            <div v-if="importMessage" role="status" class="text-xs text-green-700">{{ importMessage }}</div>

        </div>

        <!-- the device said it would send more than arrived, so somebody is missing -->
        <div v-if="GlobalState.contactsMissing > 0" role="status" class="bg-amber-50 border-b border-amber-300 px-3 py-2 text-xs text-amber-800">
            The radio listed {{ GlobalState.contactsAnnounced }} contacts but only {{ GlobalState.contacts.length }} arrived, so
            {{ GlobalState.contactsMissing }} {{ GlobalState.contactsMissing === 1 ? 'is' : 'are' }} missing from this list.
            Reconnect to load them again.
        </div>

        <!-- contacts -->
        <div v-if="userContacts.length > 0" class="h-full overflow-y-auto">
            <ContactListItem :key="contact.publicKey" v-for="contact of searchedContacts" :contact="contact" @click="onContactClick(contact)"/>
        </div>

        <!-- empty state -->
        <div v-if="userContacts.length === 0" class="mx-auto my-auto">
            <div class="flex flex-col mx-auto my-auto text-gray-700 text-center">
                <div class="mb-2 mx-auto">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-10">
                        <path fill-rule="evenodd" d="M5.636 4.575a.75.75 0 0 1 0 1.061 9 9 0 0 0 0 12.728.75.75 0 1 1-1.06 1.06c-4.101-4.1-4.101-10.748 0-14.849a.75.75 0 0 1 1.06 0Zm12.728 0a.75.75 0 0 1 1.06 0c4.101 4.1 4.101 10.75 0 14.85a.75.75 0 1 1-1.06-1.061 9 9 0 0 0 0-12.728.75.75 0 0 1 0-1.06ZM7.757 6.697a.75.75 0 0 1 0 1.06 6 6 0 0 0 0 8.486.75.75 0 0 1-1.06 1.06 7.5 7.5 0 0 1 0-10.606.75.75 0 0 1 1.06 0Zm8.486 0a.75.75 0 0 1 1.06 0 7.5 7.5 0 0 1 0 10.606.75.75 0 0 1-1.06-1.06 6 6 0 0 0 0-8.486.75.75 0 0 1 0-1.06ZM9.879 8.818a.75.75 0 0 1 0 1.06 3 3 0 0 0 0 4.243.75.75 0 1 1-1.061 1.061 4.5 4.5 0 0 1 0-6.364.75.75 0 0 1 1.06 0Zm4.242 0a.75.75 0 0 1 1.061 0 4.5 4.5 0 0 1 0 6.364.75.75 0 0 1-1.06-1.06 3 3 0 0 0 0-4.243.75.75 0 0 1 0-1.061ZM10.875 12a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Z" clip-rule="evenodd" />
                    </svg>
                </div>
                <div class="font-semibold">No Users or Rooms</div>
                <div>If someone Adverts, they will show up here.</div>
                <div class="mt-1 text-sm">Repeaters are in the Ping tab.</div>
            </div>
        </div>

    </div>
</template>

<script>
import { Constants } from "@liamcottle/meshcore.js";
import GlobalState from "../../js/GlobalState.js";
import ContactFlags from "../../js/ContactFlags.js";
import Connection from "../../js/Connection.js";
import Utils from "../../js/Utils.js";
import IconButton from "../IconButton.vue";
import DropDownMenu from "../DropDownMenu.vue";
import DropDownMenuItem from "../DropDownMenuItem.vue";
import ContactListItem from "./ContactListItem.vue";
import ConnectButtons from "../connect/ConnectButtons.vue";

export default {
    name: 'ContactsList',
    components: {
        ConnectButtons,
        ContactListItem,
        DropDownMenuItem,
        DropDownMenu,
        IconButton,
    },
    emits: [
        "contact-click",
    ],
    props: {
        contacts: Array,
    },
    data() {
        return {
            order: window.localStorage.getItem("contacts_list_order") ?? "heard-recently",
            contactsSearchTerm: "",
            showImport: false,
            importText: "",
            importError: null,
            importMessage: null,
            isImporting: false,
        };
    },
    methods: {
        async importContact() {

            this.isImporting = true;
            this.importError = null;
            this.importMessage = null;

            try {

                const { contact, alreadyKnown } = await Connection.importContact(this.importText);
                const name = contact.advName?.trim() || "that contact";
                this.importMessage = alreadyKnown
                    ? `${name} was already in the list, and has been updated.`
                    : `Added ${name}.`;
                this.importText = "";

            } catch(e) {
                // the message is written for the operator where the cause is known,
                // so pass it through rather than replacing it with something vaguer
                this.importError = String(e?.message ?? e) === Connection.DISCONNECTED
                    ? "No radio connected, so nothing was added."
                    : String(e?.message ?? e);
            } finally {
                this.isImporting = false;
            }

        },
        onContactClick(contact) {
            this.$emit("contact-click", contact);
        },
        getContactsOrderedByName(contacts) {
            // sort contacts by name asc (using a shallow copy to ensure it updates automatically)
            return contacts.sort((contactA, contactB) => {
                const contactAName = contactA.advName ?? "";
                const contactBName = contactB.advName ?? "";
                return contactAName.localeCompare(contactBName);
            });
        },
        getContactsOrderedByRecentlyHeard(contacts) {
            // sort contacts by latest advert desc (using a shallow copy to ensure it updates automatically)
            return contacts.sort((contactA, contactB) => {
                const contactALastHeard = contactA.lastAdvert;
                const contactBLastHeard = contactB.lastAdvert;
                return contactBLastHeard - contactALastHeard;
            });
        },
        getOrderedContacts(contacts) {

            // get ordered contacts
            var orderedContacts = [];
            switch(this.order){
                case "a-z": {
                    orderedContacts = this.getContactsOrderedByName(contacts);
                    break;
                }
                case "heard-recently": {
                    orderedContacts = this.getContactsOrderedByRecentlyHeard(contacts);
                    break;
                }
            }

            return orderedContacts;

        },

    },
    computed: {
        GlobalState() {
            return GlobalState;
        },
        // This tab lists the contacts you can send text to: people, and the room
        // servers that relay text between them. Repeaters belong to the Ping tab,
        // which discovers them, shows both signal readings and can add them.
        userContacts() {
            return this.contacts.filter((contact) => {
                return contact.type === Constants.AdvType.Chat
                    || contact.type === Constants.AdvType.Room;
            });
        },
        searchedContacts() {

            // sort, then search
            var contacts = [...this.userContacts];
            contacts = this.getOrderedContacts(contacts);
            // favourites first, keeping the chosen order within each group. sort is
            // stable, so this lifts them without disturbing anything else
            contacts = contacts.sort((a, b) => ContactFlags.compare(a, b));
            contacts = contacts.filter((contact) => contact != null);

            // search contacts by name or public key
            contacts = contacts.filter((contact) => {

                const search = this.contactsSearchTerm.trim().toLowerCase();
                if(search === ""){
                    return true;
                }

                const matchesName = (contact.advName ?? "").toLowerCase().includes(search);

                // names can be ambiguous or duplicated on a busy mesh, so a public key
                // prefix pasted from elsewhere identifies a station unambiguously
                const matchesPublicKey = Utils.bytesToHex(contact.publicKey).includes(search);

                return matchesName || matchesPublicKey;

            });

            return contacts;

        },
    },
    watch: {
        order() {
            window.localStorage.setItem("contacts_list_order", this.order);
        },
    }
}
</script>
