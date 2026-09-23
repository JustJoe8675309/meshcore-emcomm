<template>
    <div class="bg-white border-b">
    <div class="flex p-2 min-h-16">
        <div class="flex-shrink-0 my-auto mr-2">
            <img src="/icon.png" class="size-12 rounded"/>
        </div>
        <div class="my-auto mr-auto overflow-hidden">
            <div class="font-bold">Mesh-Emcomm</div>
            <div class="text-sm truncate">

                <!-- connected or configured -->
                <span v-if="GlobalState.connection != null">
                    <span v-if="GlobalState.selfInfo">
                        <span v-if="GlobalState.batteryPercentage">Battery {{ GlobalState.batteryPercentage }}% - </span>
                        <span>{{ GlobalState.selfInfo.name }}</span>
                    </span>
                    <span v-else>Connecting...</span>
                </span>

                <!-- disconnected -->
                <span v-else>Not connected</span>

            </div>

        </div>
        <div class="my-auto flex font-semibold">

            <!-- connect button, only when it goes somewhere -->
            <RouterLink v-if="showConnectButton" :to="{ name: 'connect' }">
                <div class="bg-blue-500 text-white px-2 py-1 rounded shadow hover:bg-blue-400">
                    Connect
                </div>
            </RouterLink>

            <!-- action buttons. keyed on the connection, not on the absence of the
                 connect button: with neither a connection nor anything cached,
                 neither belongs, and a v-else here offered Disconnect on an app
                 that plainly said it was not connected -->
            <div v-else-if="GlobalState.connection != null" class="flex space-x-1">
                <DropDownMenu>
                    <template v-slot:button>
                        <button type="button" class="my-auto bg-gray-500 text-white px-2 py-1 p-1 rounded shadow hover:bg-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                            </svg>
                        </button>
                    </template>
                    <template v-slot:items>
                        <DropDownMenuItem @click="sendZeroHopAdvert">Advert (Zero Hop)</DropDownMenuItem>
                        <DropDownMenuItem @click="sendFloodAdvert">Advert (Flood Routed)</DropDownMenuItem>
                    </template>
                </DropDownMenu>
                <button @click="sharingOpen = true" type="button" aria-label="Share a station mode"
                        title="Share a station mode"
                        class="my-auto bg-gray-500 text-white px-2 py-1 p-1 rounded shadow hover:bg-gray-400">
                    <!-- a QR code, which is what this does -->
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
                        <path fill-rule="evenodd" d="M3 4.5A1.5 1.5 0 0 1 4.5 3h4A1.5 1.5 0 0 1 10 4.5v4A1.5 1.5 0 0 1 8.5 10h-4A1.5 1.5 0 0 1 3 8.5v-4Zm2 .5v3h3V5H5Zm-2 10.5A1.5 1.5 0 0 1 4.5 14h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 8.5 21h-4A1.5 1.5 0 0 1 3 19.5v-4Zm2 .5v3h3v-3H5ZM14 4.5A1.5 1.5 0 0 1 15.5 3h4A1.5 1.5 0 0 1 21 4.5v4A1.5 1.5 0 0 1 19.5 10h-4A1.5 1.5 0 0 1 14 8.5v-4Zm2 .5v3h3V5h-3Zm-2 9.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1-.75-.75v-1.5Zm5 0a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1-.75-.75v-1.5ZM14 19.75a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v.5a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1-.75-.75v-.5Zm5 0a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 .75.75v.5a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1-.75-.75v-.5Z" clip-rule="evenodd" />
                    </svg>
                </button>
                <RouterLink :to="{ name: 'settings' }">
                    <button type="button" class="my-auto bg-gray-500 text-white px-2 py-1 p-1 rounded shadow hover:bg-gray-400">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
                            <path fill-rule="evenodd" d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </RouterLink>
                <button @click="disconnect" type="button" class="my-auto bg-gray-500 text-white px-2 py-1 p-1 rounded shadow hover:bg-gray-400">
                    <span class="block sm:hidden">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
                        <path fill-rule="evenodd" d="M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                    </svg>
                    </span>
                    <span class="hidden sm:block">Disconnect</span>
                </button>
            </div>

        </div>
    </div>

    <!-- which mode this station is in: its own row, the full width of the header.
         Inside the name column it was clipped by the row's fixed height and by
         the column's own width, so it read "Normal mode · tap to" and no more.
         The row above is min-h-16 rather than h-16 for the same family of reason:
         4rem scales with the root font, and the two text lines inside it grow
         faster, so on a phone with Android's font size turned up the battery line
         overflowed the row and painted over this banner. Measured at 375px: 14px
         of overlap at an 18px root font, 18px at 24px. -->
    <div class="px-2 pb-1">
        <ModeBanner @open="modeDialogOpen = true"/>
    </div>

    <ModeSwitchDialog :open="modeDialogOpen" @close="modeDialogOpen = false"/>
    <ModeSharing :open="sharingOpen" :incoming-link="incomingLink" @close="closeSharing"/>

    </div>
</template>

<script>
import GlobalState from "../js/GlobalState.js";
import Connection from "../js/Connection.js";
import IconButton from "./IconButton.vue";
import DropDownMenu from "./DropDownMenu.vue";
import DropDownMenuItem from "./DropDownMenuItem.vue";
import ModeBanner from "./modes/ModeBanner.vue";
import ModeSwitchDialog from "./modes/ModeSwitchDialog.vue";
import ModeSharing from "./modes/ModeSharing.vue";
import { SHARE_PATH } from "../js/modes/ModeShare.js";

export default {
    name: 'Header',
    components: {DropDownMenuItem, DropDownMenu, IconButton, ModeBanner, ModeSwitchDialog, ModeSharing},
    data() {
        return {
            modeDialogOpen: false,
            sharingOpen: false,
            // a code scanned with the phone's own camera opens the app at the
            // sharing link, which lands here
            incomingLink: null,
        };
    },
    mounted() {
        this.takeIncomingLink();
        window.addEventListener("hashchange", this.takeIncomingLink);
    },
    beforeUnmount() {
        window.removeEventListener("hashchange", this.takeIncomingLink);
    },
    methods: {
        takeIncomingLink() {
            const hash = window.location.hash ?? "";
            if(!hash.startsWith(SHARE_PATH)){
                return;
            }
            this.incomingLink = window.location.href;
            this.sharingOpen = true;
            // the link is spent: leaving it in the bar would reopen this on every
            // reload, and the operator has the mode saved by then
            window.location.hash = "#/";
        },
        closeSharing() {
            this.sharingOpen = false;
            this.incomingLink = null;
        },
        async sendZeroHopAdvert() {
            await Connection.sendZeroHopAdvert();
            alert("A zero hop advert has been sent.");
        },
        async sendFloodAdvert() {
            await Connection.sendFloodAdvert();
            alert("A flood routed advert has been sent.");
        },
        async disconnect() {
            await Connection.disconnect();
        },
    },
    computed: {
        GlobalState() {
            return GlobalState;
        },

        /**
         * Whether the Connect button is worth showing.
         *
         * A disconnected node with nothing cached already puts the Bluetooth and
         * Serial buttons in the middle of the page, and this button only links to
         * another copy of them. Pressing it looked like it did nothing, because
         * near enough nothing is what it did.
         *
         * With contacts or channels cached the page shows those lists instead, and
         * then this is the only way back to the connect screen. So it appears only
         * in the case where it leads somewhere the operator cannot already see.
         */
        showConnectButton() {
            if(GlobalState.connection != null){
                return false;
            }
            return GlobalState.contacts.length > 0 || GlobalState.channels.length > 0;
        },

    },
}
</script>
