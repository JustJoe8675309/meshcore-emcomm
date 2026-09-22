<template>
    <Page>

        <!-- header -->
        <Header/>

        <!-- tabs -->
        <div v-if="GlobalState.connection || (contacts.length > 0 || channels.length > 0)" class="bg-white border-b border-gray-200">
            <div class="-mb-px flex">
                <div @click="tab = 'contacts'" class="w-full border-b-2 py-3 px-1 text-center text-sm font-medium cursor-pointer" :class="[ tab === 'contacts' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700']"><div>Contacts</div><div>&amp; Channels</div></div>
                <div @click="tab = 'reports'" class="w-full border-b-2 py-3 px-1 text-center text-sm font-medium cursor-pointer" :class="[ tab === 'reports' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700']"><div>Reports</div><div class="invisible" aria-hidden="true">&nbsp;</div></div>
                <div @click="tab = 'ping'" class="w-full border-b-2 py-3 px-1 text-center text-sm font-medium cursor-pointer" :class="[ tab === 'ping' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700']"><div>Repeater</div><div>Search</div></div>
                <div @click="tab = 'positions'" class="w-full border-b-2 py-3 px-1 text-center text-sm font-medium cursor-pointer" :class="[ tab === 'positions' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700']"><div>Positions</div><div class="invisible" aria-hidden="true">&nbsp;</div></div>
            </div>
        </div>

        <!-- tab content -->
        <div v-if="GlobalState.connection || (contacts.length > 0 || channels.length > 0)" class="flex h-full w-full overflow-hidden">
            <StationsList v-if="tab === 'contacts'" :contacts="contacts" :channels="channels" @contact-click="onContactClick" @channel-click="onChannelClick"/>
            <ReportsPanel v-if="tab === 'reports'"/>
            <PingPanel v-if="tab === 'ping'"/>
            <PositionsPanel v-if="tab === 'positions'"/>
        </div>

        <!-- not connected and no content -->
        <div v-if="!GlobalState.connection && contacts.length === 0 && channels.length === 0" class="mx-auto my-auto">
            <ConnectButtons/>
        </div>

    </Page>
</template>

<script>
import { Constants } from "@liamcottle/meshcore.js";
import Header from "../Header.vue";
import Page from "./Page.vue";
import GlobalState from "../../js/GlobalState.js";
import ConnectButtons from "../connect/ConnectButtons.vue";
import StationsList from "../stations/StationsList.vue";
import Utils from "../../js/Utils.js";
import ReportsPanel from "../reports/ReportsPanel.vue";
import PingPanel from "../ping/PingPanel.vue";
import PositionsPanel from "../position/PositionsPanel.vue";

export default {
    name: 'MainPage',
    components: {
        ReportsPanel,
        PingPanel,
        PositionsPanel,
        StationsList,
        ConnectButtons,
        Page,
        Header,
    },
    methods: {
        async onContactClick(contact) {

            // a room server's posts arrive addressed from its own public key, so
            // the same conversation view serves both
            if(contact.type === Constants.AdvType.Chat || contact.type === Constants.AdvType.Room){
                this.$router.push({
                    name: "contact.messages",
                    params: {
                        publicKey: Utils.bytesToHex(contact.publicKey),
                    },
                });
                return;
            }

            // A repeater has no conversation: it relays for others rather than
            // holding messages of its own. It is listed here so its path, telemetry
            // and favourite can be reached from the menu, so say where its own tab
            // is rather than only saying no.
            if(contact.type === Constants.AdvType.Repeater){
                alert("Repeaters cannot be messaged. Use the Repeater Search tab to ping one, or the menu on the right for its path and other options.");
                return;
            }

            alert("Messaging this contact type is not supported.");

        },
        async onChannelClick(channel) {
            this.$router.push({
                name: "channel.messages",
                params: {
                    channelIdx: channel.idx.toString(),
                },
            });
        },
    },
    computed: {
        GlobalState() {
            return GlobalState;
        },
        contacts() {
            return GlobalState.contacts;
        },
        channels() {
            return GlobalState.channels;
        },
        tab: {
            get(){
                // contacts and channels were two tabs once, and a bookmark or a
                // reload can still carry the old name
                const tab = this.$route.query.tab ?? 'contacts';
                return tab === 'channels' ? 'contacts' : tab;
            },
            set(value){
                this.$router.replace({
                    query: {
                        ...this.$route.query,
                        tab: value,
                    },
                });
            },
        },
    },
}
</script>
