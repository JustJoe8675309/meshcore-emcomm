<template>
    <div class="flex flex-col h-full w-full overflow-hidden">

        <!-- search, add, and the filter and order menu -->
        <div class="flex bg-white border-b border-gray-300 divide-x">
            <div v-if="listed.length > 0" class="flex p-1 w-full">
                <input
                    v-model="searchTerm"
                    type="text"
                    :placeholder="searchPlaceholder"
                    class="h-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
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
            <div v-if="listed.length > 0" class="flex text-gray-500">
                <DropDownMenu class="mx-auto my-auto">
                    <template v-slot:button>
                        <IconButton class="mx-1">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
                                <path d="M18.75 12.75h1.5a.75.75 0 0 0 0-1.5h-1.5a.75.75 0 0 0 0 1.5ZM12 6a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 12 6ZM12 18a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 12 18ZM3.75 6.75h1.5a.75.75 0 1 0 0-1.5h-1.5a.75.75 0 0 0 0 1.5ZM5.25 18.75h-1.5a.75.75 0 0 1 0-1.5h1.5a.75.75 0 0 1 0 1.5ZM3 12a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 3 12ZM9 3.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5ZM12.75 12a2.25 2.25 0 1 1 4.5 0 2.25 2.25 0 0 1-4.5 0ZM9 15.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z" />
                            </svg>
                        </IconButton>
                    </template>
                    <template v-slot:items>
                        <div class="p-2 border-b text-sm font-bold">Show</div>
                        <DropDownMenuItem v-for="option of filters" :key="option.value" @click="filter = option.value">
                            <input type="radio" :checked="filter === option.value"/>
                            <div class="my-auto" :class="{ 'font-bold': filter === option.value }">{{ option.label }}</div>
                        </DropDownMenuItem>
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

        <!-- the read produced nothing at all, so anything listed was not read here -->
        <div v-if="GlobalState.channelsReadFailed" role="status" class="bg-amber-50 border-b border-amber-300 px-3 py-2 text-xs text-amber-800">
            The radio's channels could not be read, so any channel listed here was assumed rather
            than read from it. Reconnect the radio before relying on this list or switching mode.
        </div>

        <!-- a slot that would not answer is a channel the operator cannot see, and
             a channel a captured mode would not write back -->
        <div v-if="GlobalState.channelsMissing > 0" role="status" class="bg-amber-50 border-b border-amber-300 px-3 py-2 text-xs text-amber-800">
            {{ GlobalState.channelsMissing }} of the radio's
            {{ GlobalState.channelSlots ?? (GlobalState.channelsMissing + listedChannelCount) }} channel slots
            would not read, so a channel may be missing from this list. Reconnect to read them again.
        </div>

        <!-- one list: contacts and channels together, in the chosen order -->
        <div v-if="listed.length > 0" class="h-full overflow-y-auto">
            <template v-for="row of rows" :key="row.key">
                <ContactListItem v-if="row.kind === 'contact'" :contact="row.contact" @click="onContactClick(row.contact)"/>
                <ChannelListItem v-else :channel="row.channel" @click="onChannelClick(row.channel)"/>
            </template>
            <div v-if="rows.length === 0" class="p-4 text-center text-sm text-gray-500">
                Nothing matches that.
            </div>
        </div>

        <!-- empty state -->
        <div v-if="listed.length === 0" class="mx-auto my-auto">
            <div class="flex flex-col mx-auto my-auto text-gray-700 text-center">
                <div class="mb-2 mx-auto">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-10">
                        <path fill-rule="evenodd" d="M5.636 4.575a.75.75 0 0 1 0 1.061 9 9 0 0 0 0 12.728.75.75 0 1 1-1.06 1.06c-4.101-4.1-4.101-10.748 0-14.849a.75.75 0 0 1 1.06 0Zm12.728 0a.75.75 0 0 1 1.06 0c4.101 4.1 4.101 10.75 0 14.85a.75.75 0 1 1-1.06-1.061 9 9 0 0 0 0-12.728.75.75 0 0 1 0-1.06ZM7.757 6.697a.75.75 0 0 1 0 1.06 6 6 0 0 0 0 8.486.75.75 0 0 1-1.06 1.06 7.5 7.5 0 0 1 0-10.606.75.75 0 0 1 1.06 0Zm8.486 0a.75.75 0 0 1 1.06 0 7.5 7.5 0 0 1 0 10.606.75.75 0 0 1-1.06-1.06 6 6 0 0 0 0-8.486.75.75 0 0 1 0-1.06ZM9.879 8.818a.75.75 0 0 1 0 1.06 3 3 0 0 0 0 4.243.75.75 0 1 1-1.061 1.061 4.5 4.5 0 0 1 0-6.364.75.75 0 0 1 1.06 0Zm4.242 0a.75.75 0 0 1 1.061 0 4.5 4.5 0 0 1 0 6.364.75.75 0 0 1-1.06-1.06 3 3 0 0 0 0-4.243.75.75 0 0 1 0-1.061ZM10.875 12a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Z" clip-rule="evenodd" />
                    </svg>
                </div>
                <div class="font-semibold">Nothing here yet</div>
                <div>Contacts appear when a station adverts. Channels are set up in Settings.</div>
            </div>
        </div>

    </div>
</template>

<script>
/**
 * Contacts and channels in one list.
 *
 * They were two tabs, which meant the operator had to know which kind of thing
 * they were looking for before they could look for it. A net is a mix of people,
 * repeaters, rooms and channels, so it is one list with a filter by kind and a
 * choice of order.
 *
 * A channel has no advert, so "heard recently" uses the newest message on it,
 * which is what an operator means by a channel having been busy. A channel that
 * has never carried a message has no time at all and sorts to the end of that
 * order rather than pretending to be old or new.
 */
import { Constants } from "@liamcottle/meshcore.js";
import GlobalState from "../../js/GlobalState.js";
import LastHeard from "../../js/contacts/LastHeard.js";
import ContactFlags from "../../js/ContactFlags.js";
import Connection from "../../js/Connection.js";
import Database from "../../js/Database.js";
import Utils from "../../js/Utils.js";
import ChannelKeys from "../../js/channels/ChannelKeys.js";
import IconButton from "../IconButton.vue";
import DropDownMenu from "../DropDownMenu.vue";
import DropDownMenuItem from "../DropDownMenuItem.vue";
import ContactListItem from "../contacts/ContactListItem.vue";
import ChannelListItem from "../channels/ChannelListItem.vue";

export default {
    name: 'StationsList',
    components: {
        ContactListItem,
        ChannelListItem,
        DropDownMenuItem,
        DropDownMenu,
        IconButton,
    },
    emits: [
        "contact-click",
        "channel-click",
    ],
    props: {
        contacts: Array,
        channels: Array,
    },
    data() {
        return {
            // Its own keys, not the old contacts tab's. The merged list defaults
            // to everything, most recently heard first, which is what an operator
            // wants on opening a net: who is out there and who has just spoken.
            // Read from the old keys and a browser that used the separate tabs
            // brings an A-Z or a companions-only choice across and the default
            // never applies, which is how the bench node came up sorted A-Z.
            order: window.localStorage.getItem("stations_list_order") ?? "heard-recently",
            filter: window.localStorage.getItem("stations_list_filter") ?? "all",
            searchTerm: "",
            showImport: false,
            importText: "",
            importError: null,
            importMessage: null,
            isImporting: false,
            // when anything was last said on each channel, by slot
            channelActivity: {},
        };
    },
    mounted() {
        this.readChannelActivity();
    },
    watch: {
        filter() {
            window.localStorage.setItem("stations_list_filter", this.filter);
        },
        order() {
            window.localStorage.setItem("stations_list_order", this.order);
        },
        channels: {
            handler() {
                this.readChannelActivity();
            },
            deep: false,
        },
    },
    methods: {
        async readChannelActivity() {
            const activity = {};
            for(const channel of this.channels ?? []){
                try {
                    const latest = await Database.ChannelMessage.getLatestChannelMessage(channel.idx, ChannelKeys.of(channel)).exec();
                    if(latest != null){
                        activity[channel.idx] = latest.timestamp;
                    }
                } catch(e) {
                    // no message history for it, or the database is not open yet.
                    // The row still shows; it just has no time to sort by
                }
            }
            this.channelActivity = activity;
        },
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
        onChannelClick(channel) {
            this.$emit("channel-click", channel);
        },
        matchesFilter(row) {
            if(this.filter === "all"){
                return true;
            }
            if(this.filter === "channel"){
                return row.kind === "channel";
            }
            if(row.kind !== "contact"){
                return false;
            }
            const types = {
                companion: Constants.AdvType.Chat,
                room: Constants.AdvType.Room,
                repeater: Constants.AdvType.Repeater,
            };
            return row.contact.type === types[this.filter];
        },
        matchesSearch(row) {
            const search = this.searchTerm.trim().toLowerCase();
            if(search === ""){
                return true;
            }
            if(row.name.toLowerCase().includes(search)){
                return true;
            }
            // names can be ambiguous or duplicated on a busy mesh, so a public key
            // prefix pasted from elsewhere identifies a station unambiguously
            return row.kind === "contact" && Utils.bytesToHex(row.contact.publicKey).includes(search);
        },
    },
    computed: {
        // channels actually in the list, so the warning can say "2 of 16"
        listedChannelCount() {
            return (this.channels ?? []).length;
        },
        GlobalState() {
            return GlobalState;
        },
        filters() {
            return [
                { value: "all", label: "All" },
                { value: "companion", label: "Companions" },
                { value: "room", label: "Rooms" },
                { value: "repeater", label: "Repeaters" },
                { value: "channel", label: "Channels" },
            ];
        },
        // one row per thing, whichever kind it is
        allRows() {
            const contacts = (this.contacts ?? []).map((contact) => ({
                kind: "contact",
                key: `contact:${Utils.bytesToHex(contact.publicKey)}`,
                name: contact.advName ?? "",
                // the advert time, which is the other node's clock: see PathInfo
                // clamped: lastAdvert is the other station's clock, and one four
                // years ahead would otherwise sit at the top of Heard Recently
                // for ever
                lastHeard: LastHeard.at(contact.lastAdvert),
                favourite: ContactFlags.isFavourite(contact),
                contact: contact,
            }));
            const channels = (this.channels ?? []).map((channel) => ({
                kind: "channel",
                key: `channel:${channel.idx}`,
                name: channel.name ?? "",
                // in seconds, as a contact's advert time is, so they sort together
                lastHeard: this.channelActivity[channel.idx] != null
                    ? Math.floor(this.channelActivity[channel.idx] / 1000)
                    : null,
                favourite: false,
                channel: channel,
            }));
            return [...contacts, ...channels];
        },
        // what the filter leaves, which is what the count and the search cover
        listed() {
            return this.allRows.filter((row) => this.matchesFilter(row));
        },
        rows() {

            const rows = this.listed.filter((row) => this.matchesSearch(row));

            const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

            rows.sort((a, b) => {
                if(this.order === "heard-recently"){
                    // never heard sorts last: it is not the same as long ago
                    if(a.lastHeard == null || b.lastHeard == null){
                        if(a.lastHeard != null){
                            return -1;
                        }
                        if(b.lastHeard != null){
                            return 1;
                        }
                        return byName(a, b);
                    }
                    if(a.lastHeard !== b.lastHeard){
                        return b.lastHeard - a.lastHeard;
                    }
                }
                return byName(a, b);
            });

            // favourites first, keeping the chosen order within each group. sort is
            // stable, so this lifts them without disturbing anything else
            return rows.sort((a, b) => (b.favourite ? 1 : 0) - (a.favourite ? 1 : 0));

        },
        searchPlaceholder() {
            const kinds = { channel: "Channels", companion: "Companions", room: "Rooms", repeater: "Repeaters" };
            const what = kinds[this.filter] ?? (this.listed.length === 1 ? "Contact or Channel" : "Contacts and Channels");
            return `Search ${this.listed.length} ${what} by name or key...`;
        },
    },
}
</script>
