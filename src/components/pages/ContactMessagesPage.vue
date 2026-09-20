<template>
    <Page>

        <!-- app bar -->
        <AppBar :title="title" :subtitle="subtitle">
            <template v-slot:trailing>
                <ContactDropDownMenu
                    v-if="contact"
                    :contact="contact"
                    :show-delete-message-history-button="true"
                    @contact-deleted="onContactDeleted"/>
            </template>
        </AppBar>

        <!-- a room holds its posts until you log in, so this sits above them -->
        <RoomLoginBar v-if="contact" :contact="contact"/>

        <!-- list -->
        <div class="flex h-full w-full overflow-hidden">
            <MessageViewer v-if="contact != null" :type="'contact'" :contact="contact"/>
        </div>

    </Page>
</template>

<script>
import { Constants } from "@liamcottle/meshcore.js";
import Page from "./Page.vue";
import AppBar from "../AppBar.vue";
import MessageViewer from "../messages/MessageViewer.vue";
import GlobalState from "../../js/GlobalState.js";
import Utils from "../../js/Utils.js";
import ContactDropDownMenu from "../contacts/ContactDropDownMenu.vue";
import RoomLoginBar from "../contacts/RoomLoginBar.vue";

export default {
    name: 'ContactMessagesPage',
    components: {
        RoomLoginBar,ContactDropDownMenu, MessageViewer, AppBar, Page},
    props: {
        publicKey: String,
    },
    mounted() {

        // redirect to main page if contact not found
        if(!this.contact){
            this.$router.push({
                name: "main",
            });
            return;
        }

    },
    methods: {
        onContactDeleted() {

            // go back to main page
            this.$router.push({
                name: "main",
            });

        },
    },
    computed: {
        GlobalState() {
            return GlobalState;
        },
        title() {
            return this.contact?.type === Constants.AdvType.Room ? "Room" : "Direct Messages";
        },
        contact() {
            return GlobalState.contacts.find((contact) => Utils.bytesToHex(contact.publicKey) === this.publicKey);
        },
        subtitle() {
            return this.contact ? this.contact.advName : "Unknown Contact";
        },
    },
}
</script>
