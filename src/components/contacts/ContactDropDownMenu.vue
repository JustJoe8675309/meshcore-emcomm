<template>
    <DropDownMenu>
        <template v-slot:button>
            <IconButton v-if="contact" class="bg-transparent text-gray-500">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
                </svg>
            </IconButton>
        </template>
        <template v-slot:items>

            <!-- contact details -->
            <div class="p-2 border-b">
                <div class="text-sm text-gray-500 font-semibold">
                    <span>{{ contact.advName }}</span>
                </div>
                <div class="text-sm text-gray-500">
                    <!-- hops away -->
                    <span class="flex my-auto text-sm text-gray-500">
                        <span :class="{ 'text-amber-700': pathIsUnknown }">{{ pathDescription }}</span>
                    </span>
                </div>
            </div>

            <!-- ask a companion for its position. only people carry positions worth
                 asking for; a repeater's is fixed and in its advert already -->
            <DropDownMenuItem v-if="canRequestPosition" @click="requestPosition(contact)">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-5">
                    <path fill-rule="evenodd" d="m11.54 22.351.07.04.028.016a.76.76 0 0 0 .723 0l.028-.015.071-.041a16.975 16.975 0 0 0 1.144-.742 19.58 19.58 0 0 0 2.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 0 0-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 0 0 2.682 2.282 16.975 16.975 0 0 0 1.145.742ZM12 13.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clip-rule="evenodd" />
                </svg>
                <span>Request Position</span>
            </DropDownMenuItem>

            <!-- copy public key button -->
            <DropDownMenuItem @click="copyPublicKey(contact)">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-5">
                    <path fill-rule="evenodd" d="M15.75 1.5a6.75 6.75 0 0 0-6.651 7.906c.067.39-.032.717-.221.906l-6.5 6.499a3 3 0 0 0-.878 2.121v2.818c0 .414.336.75.75.75H6a.75.75 0 0 0 .75-.75v-1.5h1.5A.75.75 0 0 0 9 19.5V18h1.5a.75.75 0 0 0 .53-.22l2.658-2.658c.19-.189.517-.288.906-.22A6.75 6.75 0 1 0 15.75 1.5Zm0 3a.75.75 0 0 0 0 1.5A2.25 2.25 0 0 1 18 8.25a.75.75 0 0 0 1.5 0 3.75 3.75 0 0 0-3.75-3.75Z" clip-rule="evenodd" />
                </svg>
                <span>Copy Public Key</span>
            </DropDownMenuItem>

            <!-- favourite toggle. bit 0 of the contact's flags is the firmware's own
                 favourite mark, so this is the same star the official app shows -->
            <DropDownMenuItem @click="toggleFavourite(contact)">
                <svg v-if="isFavourite" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-5 text-amber-500">
                    <path d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" />
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="size-5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006Z" />
                </svg>
                <span>{{ isFavourite ? "Remove Favourite" : "Add Favourite" }}</span>
            </DropDownMenuItem>

            <!-- share contact button -->
            <DropDownMenuItem @click="shareContact(contact)">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-5">
                    <path fill-rule="evenodd" d="M5.636 4.575a.75.75 0 0 1 0 1.061 9 9 0 0 0 0 12.728.75.75 0 1 1-1.06 1.06c-4.101-4.1-4.101-10.748 0-14.849a.75.75 0 0 1 1.06 0Zm12.728 0a.75.75 0 0 1 1.06 0c4.101 4.1 4.101 10.75 0 14.85a.75.75 0 1 1-1.06-1.061 9 9 0 0 0 0-12.728.75.75 0 0 1 0-1.06ZM7.757 6.697a.75.75 0 0 1 0 1.06 6 6 0 0 0 0 8.486.75.75 0 0 1-1.06 1.06 7.5 7.5 0 0 1 0-10.606.75.75 0 0 1 1.06 0Zm8.486 0a.75.75 0 0 1 1.06 0 7.5 7.5 0 0 1 0 10.606.75.75 0 0 1-1.06-1.06 6 6 0 0 0 0-8.486.75.75 0 0 1 0-1.06ZM9.879 8.818a.75.75 0 0 1 0 1.06 3 3 0 0 0 0 4.243.75.75 0 1 1-1.061 1.061 4.5 4.5 0 0 1 0-6.364.75.75 0 0 1 1.06 0Zm4.242 0a.75.75 0 0 1 1.061 0 4.5 4.5 0 0 1 0 6.364.75.75 0 0 1-1.06-1.06 3 3 0 0 0 0-4.243.75.75 0 0 1 0-1.061ZM10.875 12a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Z" clip-rule="evenodd" />
                </svg>
                <span>Share (Zero Hop Advert)</span>
            </DropDownMenuItem>

            <!-- export contact button -->
            <DropDownMenuItem @click="exportContact(contact)">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-5">
                    <path fill-rule="evenodd" d="M15.75 4.5a3 3 0 1 1 .825 2.066l-8.421 4.679a3.002 3.002 0 0 1 0 1.51l8.421 4.679a3 3 0 1 1-.729 1.31l-8.421-4.678a3 3 0 1 1 0-4.132l8.421-4.679a3 3 0 0 1-.096-.755Z" clip-rule="evenodd" />
                </svg>
                <span>Export to Clipboard</span>
            </DropDownMenuItem>

            <!-- reset path button -->
            <DropDownMenuItem @click="onResetPath(contact)">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
                <span>Reset Path</span>
            </DropDownMenuItem>

            <!-- delete message history button -->
            <DropDownMenuItem v-if="showDeleteMessageHistoryButton" @click="onDeleteMessageHistory">
                <svg class="size-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clip-rule="evenodd" />
                </svg>
                <span class="text-red-500">Delete Message History</span>
            </DropDownMenuItem>

            <!-- delete contact button -->
            <DropDownMenuItem @click="onDeleteContact(contact)">
                <svg class="size-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clip-rule="evenodd" />
                </svg>
                <span class="text-red-500">Forget Contact</span>
            </DropDownMenuItem>

        </template>
    </DropDownMenu>
</template>

<script>
import IconButton from "../IconButton.vue";
import DropDownMenu from "../DropDownMenu.vue";
import DropDownMenuItem from "../DropDownMenuItem.vue";
import Connection from "../../js/Connection.js";
import Database from "../../js/Database.js";
import Utils from "../../js/Utils.js";
import PathInfo from "../../js/PathInfo.js";
import ContactFlags from "../../js/ContactFlags.js";
import PositionService from "../../js/position/PositionService.js";
import GlobalState from "../../js/GlobalState.js";
import { Constants } from "@liamcottle/meshcore.js";

export default {
    name: 'ContactDropDownMenu',
    components: {
        DropDownMenuItem,
        DropDownMenu,
        IconButton,
    },
    props: {
        contact: Object,
        showDeleteMessageHistoryButton: Boolean,
    },
    emits: [
        "contact-deleted",
    ],
    computed: {
        isFavourite() {
            return ContactFlags.isFavourite(this.contact);
        },
        pathDescription() {
            return PathInfo.describe(this.contact.outPathLen);
        },
        pathIsUnknown() {
            return PathInfo.isUnknown(this.contact.outPathLen);
        },
        canRequestPosition() {
            return this.contact?.type === Constants.AdvType.Chat && GlobalState.connection != null;
        },
    },
    methods: {
        requestPosition(contact) {
            PositionService.openRequest(contact);
        },
        async toggleFavourite(contact) {
            try {
                await Connection.setContactFavourite(contact.publicKey, !this.isFavourite);
            } catch(e) {
                console.log("failed to change favourite", e);
                alert("The radio did not accept that change.");
            }
        },
        copyPublicKey(contact) {
            Utils.copyToClipboard(Utils.bytesToHex(contact.publicKey));
        },
        async shareContact(contact) {
            try {
                await Connection.shareContact(contact.publicKey);
                alert("Contact has been adverted!");
            } catch(e) {
                console.log(e);
                alert("Failed to share this contact!");
            }
        },
        async exportContact(contact) {
            try {
                const exportedContact = await Connection.exportContact(contact.publicKey);
                const advertPacketAsHex = Utils.bytesToHex(exportedContact.advertPacketBytes);
                const meshCoreContactUrl = `meshcore://${advertPacketAsHex}`;
                await Utils.copyToClipboard(meshCoreContactUrl);
            } catch(e) {
                console.log(e);
                alert("Failed to export this contact!");
            }
        },
        async onResetPath(contact) {

            // confirm user wants to reset path
            if(!confirm("Are you sure you want to reset the path to this contact?")){
                return;
            }

            // reset path
            await Connection.resetContactPath(contact.publicKey);
            await Connection.loadContacts();

        },
        async onDeleteMessageHistory() {

            // confirm user wants to delete message history
            if(!confirm("Are you sure you want to delete all message history with this contact?")){
                return;
            }

            // delete message history
            await Database.Message.deleteContactMessages(this.contact.publicKey);

        },
        async onDeleteContact(contact) {

            // confirm user wants to remove this contact
            if(!confirm("Are you sure you want to forget this contact?")){
                return;
            }

            // remove contact
            await Connection.removeContact(contact.publicKey);
            await Connection.loadContacts();

        },
    },
}
</script>
