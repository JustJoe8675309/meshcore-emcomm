<template>
    <DropDownMenu>
        <template v-slot:button>
            <IconButton v-if="channel" class="bg-transparent text-gray-500">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
                </svg>
            </IconButton>
        </template>
        <template v-slot:items>

            <!-- positions: a roll call of everyone on the channel, or this station's own -->
            <template v-if="connected">
                <DropDownMenuItem @click="openGroup('rollcall')">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-5">
                        <path fill-rule="evenodd" d="m11.54 22.351.07.04.028.016a.76.76 0 0 0 .723 0l.028-.015.071-.041a16.975 16.975 0 0 0 1.144-.742 19.58 19.58 0 0 0 2.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 0 0-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 0 0 2.682 2.282 16.975 16.975 0 0 0 1.145.742ZM12 13.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clip-rule="evenodd" />
                    </svg>
                    <span>Request Positions (Roll Call)</span>
                </DropDownMenuItem>
                <DropDownMenuItem @click="openGroup('share')">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-5">
                        <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                    </svg>
                    <span>Send My Position</span>
                </DropDownMenuItem>
            </template>

            <!-- delete message history button -->
            <DropDownMenuItem @click="onDeleteMessageHistory">
                <svg class="size-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clip-rule="evenodd" />
                </svg>
                <span class="text-red-500">Delete Message History</span>
            </DropDownMenuItem>

        </template>
    </DropDownMenu>
</template>

<script>
import IconButton from "../IconButton.vue";
import DropDownMenu from "../DropDownMenu.vue";
import DropDownMenuItem from "../DropDownMenuItem.vue";
import Database from "../../js/Database.js";
import GlobalState from "../../js/GlobalState.js";
import PositionService from "../../js/position/PositionService.js";

export default {
    name: 'ChannelDropDownMenu',
    components: {
        DropDownMenuItem,
        DropDownMenu,
        IconButton,
    },
    props: {
        channel: Object,
    },
    computed: {
        connected() {
            return GlobalState.connection != null;
        },
    },
    methods: {
        openGroup(action) {
            PositionService.openGroup(action, { kind: "channel", idx: this.channel.idx, name: this.channel.name });
        },
        async onDeleteMessageHistory() {

            // confirm user wants to delete message history
            if(!confirm("Are you sure you want to delete all message history for this channel?")){
                return;
            }

            // delete message history
            await Database.ChannelMessage.deleteChannelMessages(this.channel.idx);

        },
    },
}
</script>
