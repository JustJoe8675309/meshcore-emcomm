<template>
    <div class="space-y-2">

        <!-- info -->
        <div class="flex flex-col mx-auto my-auto text-gray-700 text-center">
            <div class="mb-2 mx-auto">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" class="w-10">
                    <rect width="256" height="256" fill="none"/>
                    <circle cx="136" cy="64" r="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
                    <line x1="8" y1="128" x2="200" y2="128" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
                    <polygon points="200 96 200 160 248 128 200 96" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
                    <rect x="112" y="168" width="48" height="48" rx="8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
                    <path d="M112,64H72a8,8,0,0,0-8,8V184a8,8,0,0,0,8,8h40" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
                </svg>
            </div>
            <div class="font-semibold">Not Connected</div>
            <div>Connect a MeshCore device to continue</div>
        </div>

        <!-- why the last attempt failed, if it did -->
        <div v-if="GlobalState.connectionError" role="status" class="text-sm text-red-600 text-center px-2">
            {{ GlobalState.connectionError }}
        </div>

        <!-- bluetooth -->
        <button @click="connectViaBluetooth" type="button" class="w-full flex cursor-pointer bg-white rounded shadow px-3 py-2 text-black space-x-2 font-semibold hover:bg-gray-100">
            <span>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" class="w-6">
                    <rect width="256" height="256" fill="none"/>
                    <polygon points="128 32 192 80 128 128 128 32" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
                    <polygon points="128 128 192 176 128 224 128 128" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
                    <line x1="64" y1="80" x2="128" y2="128" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
                    <line x1="64" y1="176" x2="128" y2="128" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
                </svg>
            </span>
            <span>Connect via Bluetooth</span>
        </button>

        <!-- serial -->
        <button @click="connectViaSerial" type="button" class="w-full flex cursor-pointer bg-white rounded shadow px-3 py-2 text-black space-x-2 font-semibold hover:bg-gray-100">
            <span>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" class="w-6">
                    <rect width="256" height="256" fill="none"/>
                    <circle cx="136" cy="64" r="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
                    <line x1="8" y1="128" x2="200" y2="128" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
                    <polygon points="200 96 200 160 248 128 200 96" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
                    <rect x="112" y="168" width="48" height="48" rx="8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
                    <path d="M112,64H72a8,8,0,0,0-8,8V184a8,8,0,0,0,8,8h40" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
                </svg>
            </span>
            <span>Connect via Serial</span>
        </button>

        <!-- The one thing here worth doing with no radio. Printing the notes is a
             desk job the night before, and the operator had to connect a node to
             reach them: the tabs, and so the Reports panel, only exist once a
             radio does. -->
        <div class="text-center pt-2">
            <button @click="cribSheetOpen = true" type="button"
                class="text-sm text-blue-700 hover:text-blue-900 underline">Report crib sheet</button>
            <div class="text-xs text-gray-500 mt-0.5">What goes in each field of every report. Print it before you need it.</div>
        </div>

        <!-- The other desk job. Settings needs a database, and the database is
             opened per node, so with no radio to hand there was no way in to the
             net defaults at all — which is exactly when an operator wants to write
             them: the night before, on a phone, with the radios still in the bag. -->
        <div class="text-center pt-2">
            <button @click="netDefaultsOpen = true" type="button"
                class="text-sm text-blue-700 hover:text-blue-900 underline">Net defaults</button>
            <div class="text-xs text-gray-500 mt-0.5">What your net starts from. Set it up before a radio is to hand.</div>
        </div>

        <ReportCribSheet :open="cribSheetOpen" @close="cribSheetOpen = false"/>

        <div v-if="netDefaultsOpen" class="fixed inset-0 z-50 flex bg-black/40 p-3 overflow-y-auto">
            <div role="dialog" aria-label="Net defaults" class="m-auto w-full max-w-lg bg-white rounded-lg shadow-lg">
                <NetDefaultsGroup open-by-default/>
                <div class="p-3 border-t">
                    <button @click="netDefaultsOpen = false" type="button"
                            class="w-full text-white bg-blue-600 hover:bg-blue-700 font-medium rounded-lg text-sm px-4 py-2.5">Close</button>
                </div>
            </div>
        </div>

    </div>
</template>

<script>
import Connection from "../../js/Connection.js";
import GlobalState from "../../js/GlobalState.js";
import ReportCribSheet from "../reports/ReportCribSheet.vue";
import NetDefaultsGroup from "../settings/NetDefaultsGroup.vue";

export default {
    name: 'ConnectButtons',
    components: {
        ReportCribSheet,
        NetDefaultsGroup,
    },
    data() {
        return {
            cribSheetOpen: false,
            netDefaultsOpen: false,
        };
    },
    computed: {
        GlobalState() {
            return GlobalState;
        },
    },
    methods: {
        async connectViaBluetooth() {
            if(await Connection.connectViaBluetooth()){
                this.$router.push({
                    name: "main",
                });
            }
        },
        async connectViaSerial() {
            if(await Connection.connectViaSerial()){
                this.$router.push({
                    name: "main",
                });
            }
        },
    },
}
</script>
