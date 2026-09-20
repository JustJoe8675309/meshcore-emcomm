<template>
    <div class="flex cursor-pointer p-2 bg-white hover:bg-gray-50">

        <!-- icon -->
        <ContactIcon :contact="contact" class="my-auto mr-2"/>

        <!-- name and info -->
        <div class="mr-auto">
            <div class="flex items-center space-x-1">
                <svg v-if="isFavourite" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
                     class="size-4 shrink-0 text-amber-500" role="img" aria-label="Favourite">
                    <path d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" />
                </svg>
                <span>{{ contact.advName }}</span>
            </div>
            <div class="text-sm text-gray-500">&lt;{{ formatBytesToHex(contact.publicKey.slice(0, 4)) }}...{{ formatBytesToHex(contact.publicKey.slice(-4)) }}&gt;</div>
            <div class="flex space-x-1 text-sm text-gray-500">

               <span class="my-auto">
                   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="size-4">
                       <path d="M9 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
                       <path fill-rule="evenodd" d="M9.68 5.26a.75.75 0 0 1 1.06 0 3.875 3.875 0 0 1 0 5.48.75.75 0 1 1-1.06-1.06 2.375 2.375 0 0 0 0-3.36.75.75 0 0 1 0-1.06Zm-3.36 0a.75.75 0 0 1 0 1.06 2.375 2.375 0 0 0 0 3.36.75.75 0 1 1-1.06 1.06 3.875 3.875 0 0 1 0-5.48.75.75 0 0 1 1.06 0Z" clip-rule="evenodd" />
                       <path fill-rule="evenodd" d="M11.89 3.05a.75.75 0 0 1 1.06 0 7 7 0 0 1 0 9.9.75.75 0 1 1-1.06-1.06 5.5 5.5 0 0 0 0-7.78.75.75 0 0 1 0-1.06Zm-7.78 0a.75.75 0 0 1 0 1.06 5.5 5.5 0 0 0 0 7.78.75.75 0 1 1-1.06 1.06 7 7 0 0 1 0-9.9.75.75 0 0 1 1.06 0Z" clip-rule="evenodd" />
                   </svg>
               </span>

                <!-- last heard -->
                <span class="flex my-auto text-sm text-gray-500 space-x-1">
                    {{ formatUnixSecondsAgo(contact.lastAdvert) }}
                </span>

                <!-- hops away -->
                <span class="flex my-auto text-sm text-gray-500 space-x-1">
                    <span :class="{ 'text-amber-700': pathIsUnknown }">• {{ pathDescription }}</span>
                </span>

            </div>
        </div>

        <!-- unread messages count -->
        <div v-if="unreadMessagesCount > 0" class="my-auto">
            <div class="inline-flex items-center justify-center w-6 h-6 text-xs font-bold text-white bg-red-500 rounded-full shadow">
                <span v-if="unreadMessagesCount >= 100">99</span>
                <span>{{ unreadMessagesCount }}</span>
            </div>
        </div>

        <!-- contact dropdown menu -->
        <div class="my-auto">
            <ContactDropDownMenu :contact="contact"/>
        </div>

    </div>
</template>

<script>
import GlobalState from "../../js/GlobalState.js";
import IconButton from "../IconButton.vue";
import TimeUtils from "../../js/TimeUtils.js";
import ContactDropDownMenu from "./ContactDropDownMenu.vue";
import Database from "../../js/Database.js";
import ContactIcon from "./ContactIcon.vue";
import PathInfo from "../../js/PathInfo.js";
import ContactFlags from "../../js/ContactFlags.js";

export default {
    name: 'ContactListItem',
    components: {
        ContactIcon,
        ContactDropDownMenu,
        IconButton,
    },
    props: {
        contact: Object,
    },
    data() {
        return {
            unreadMessagesCount: 0,
            contactMessagesSubscription: null,
            contactMessagesReadStateSubscription: null,
        };
    },
    mounted() {

        // listen for new messages so we can update read state
        this.contactMessagesSubscription = Database.Message.getAllMessages().$.subscribe(async () => {
            await this.onMessagesUpdated();
        });

        // listen for read state changes
        this.contactMessagesReadStateSubscription = Database.ContactMessagesReadState.get(this.contact.publicKey).$.subscribe(async (contactMessagesReadState) => {
            await this.onContactMessagesReadStateChange(contactMessagesReadState);
        });

    },
    unmounted() {
        this.contactMessagesSubscription?.unsubscribe();
        this.contactMessagesReadStateSubscription?.unsubscribe();
    },
    methods: {
        async onMessagesUpdated() {
            const contactMessagesReadState = await Database.ContactMessagesReadState.get(this.contact.publicKey).exec();
            await this.onContactMessagesReadStateChange(contactMessagesReadState);
        },
        async updateUnreadMessagesCount(lastReadTimestamp) {
            this.unreadMessagesCount = await Database.Message.getContactMessagesUnreadCount(this.contact.publicKey, lastReadTimestamp).exec();
        },
        async onContactMessagesReadStateChange(contactMessagesReadState) {
            const messagesLastReadTimestamp = contactMessagesReadState?.timestamp ?? 0;
            await this.updateUnreadMessagesCount(messagesLastReadTimestamp);
        },
        formatUnixSecondsAgo(unixSeconds) {
            return TimeUtils.formatUnixSecondsAgo(unixSeconds);
        },
        formatBytesToHex(uint8Array) {
            return Array.from(uint8Array).map(byte => byte.toString(16).padStart(2, '0')).join('');
        },
    },
    computed: {
        GlobalState() {
            return GlobalState;
        },
        isFavourite() {
            return ContactFlags.isFavourite(this.contact);
        },
        pathDescription() {
            return PathInfo.describe(this.contact.outPathLen);
        },
        // a path length the app cannot read is worth flagging rather than
        // rendering as though it were an ordinary distance
        pathIsUnknown() {
            return PathInfo.isUnknown(this.contact.outPathLen);
        },
    },
}
</script>
