<template>
    <Page>

        <!-- app bar -->
        <AppBar title="RX Log">
            <template v-slot:trailing>
                <IconButton @click="clearLog" class="bg-transparent text-gray-500">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                        <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                </IconButton>
            </template>
        </AppBar>

        <!-- search -->
        <div v-if="logs.length > 0" class="flex bg-white border-b border-gray-300 divide-x">
            <div class="flex p-1 w-full">
                <input v-model="search" type="text" :placeholder="`Search ${logs.length} ${logs.length === 1 ? 'Log' : 'Logs'}...`" class="h-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
            </div>
        </div>

        <!-- list -->
        <div class="flex h-full w-full overflow-hidden">
            <div class="overflow-y-auto divide-y w-full">
                <div v-for="log of searchedLogs" class="bg-white">
                    <div v-if="log.packet" class="p-1">
                        <div class="font-semibold">{{ log.packet.getRouteTypeString() }} {{ log.packet.getPayloadTypeString() }}</div>
                        <div v-if="formatPacketPayload(log.packet)" class="text-sm text-gray-500">
                            <div v-for="line of formatPacketPayload(log.packet)">{{ line }}</div>
                        </div>
                        <div @click="showPath(log.packet)" class="text-sm text-gray-500 cursor-pointer">
                            <span v-if="hopCount(log.packet) > 0">Path: {{ formatPath(log.packet) }}</span>
                            <span v-else>Path: (direct)</span>
                        </div>
                        <div class="text-sm text-gray-500 space-x-1">
                            <span>Hops: {{ hopCount(log.packet) }}</span>
                            <span>•</span>
                            <span>SNR: {{ log.snr }}</span>
                        </div>
                        <div class="text-sm text-gray-500">Hash: {{ log.packet_hash.substring(0, 8).toUpperCase() }}</div>
                    </div>
                    <div v-else>Failed to decode packet</div>
                </div>
            </div>
        </div>

    </Page>
</template>

<script>
import Page from "./Page.vue";
import AppBar from "../AppBar.vue";
import GlobalState from "../../js/GlobalState.js";
import {Advert, Constants, Packet, BufferUtils} from "@liamcottle/meshcore.js";
import ChannelDropDownMenu from "../channels/ChannelDropDownMenu.vue";
import IconButton from "../IconButton.vue";
import { MeshCorePath } from "@liamcottle/meshcore.js";

export default {
    name: 'RxLogPage',
    components: {
        IconButton,
        ChannelDropDownMenu,
        AppBar,
        Page,
    },
    data() {
        return {
            search: "",
            logs: [],
        };
    },
    mounted() {
        GlobalState.connection.on(Constants.PushCodes.LogRxData, this.onLogRxData);
    },
    beforeUnmount() {
        GlobalState.connection.off(Constants.PushCodes.LogRxData, this.onLogRxData);
    },
    methods: {
        clearLog() {
            this.logs = [];
        },
        byteToHex(byte) {
            return ('0' + (byte & 0xFF).toString(16)).slice(-2);
        },
        /**
         * The hops in a packet's path, each one a hash of one, two or three bytes.
         *
         * A packet's pathLen is not a length in bytes and not a hop count: the top
         * two bits are the hash size and the bottom six the number of hops. This
         * page used to read path.length, the byte count, which is the same number
         * only while hashes are one byte wide. Against a station using three byte
         * hashes it reported three times the real hops and split every hop into
         * three, naming each third after whichever contact happened to start with
         * that byte.
         *
         * meshcore.js already unpacks this, so use its decoder rather than a
         * second copy of the rules here.
         */
        pathItems(packet) {
            return MeshCorePath.fromPathAndLength(packet.path, packet.pathLen)?.pathItems ?? [];
        },
        hopCount(packet) {
            return this.pathItems(packet).length;
        },
        formatHash(hash) {
            return Array.from(hash, (byte) => this.byteToHex(byte)).join('');
        },
        formatPath(packet) {
            // hops separated by commas, the bytes within a hop kept together
            return this.pathItems(packet).map((hash) => this.formatHash(hash)).join(',');
        },
        showPath(packet) {

            const items = this.pathItems(packet);
            const pathList = [`${items.length} ${items.length === 1 ? "Hop" : "Hops"}`];
            for(var i = 0; i < items.length; i++){
                // match on the whole hash: a one byte prefix of a three byte hash
                // picks whichever contact happens to share that first byte
                const contact = this.findContactByPublicKeyPrefix(items[i]);
                const contactName = contact?.advName ?? "?";
                pathList.push(`[${i + 1}] ${this.formatHash(items[i])}: ${contactName}`);
            }

            alert(pathList.join("\n"));

        },
        formatPacketPayload(packet) {

            const payloadType = packet.payload_type_string;
            if(payloadType === "PATH"
                || payloadType === "REQ"
                || payloadType === "RESPONSE"
                || payloadType === "TXT_MSG"){
                const parsed = packet.parsePayload();
                const source = this.byteToHex(parsed.src);
                const destination = this.byteToHex(parsed.dest);
                const sourceContactName = this.getContactNameByPublicKeyPrefix([parsed.src]);
                const destinationContactName = this.getContactNameByPublicKeyPrefix([parsed.dest]);
                return [
                    `[${source} -> ${destination}]`,
                    `Source: ${sourceContactName}`,
                    `Dest: ${destinationContactName}`,
                ];
            } else if(payloadType === "ADVERT"){
                try {
                    const advert = Advert.fromBytes(packet.payload);
                    const publicKeyHex = BufferUtils.bytesToHex(advert.publicKey);
                    const parsedAppData = advert.parseAppData();
                    return [
                        `[${parsedAppData.type}] ${parsedAppData.name}`,
                        `Public Key: <${publicKeyHex.slice(0, 8)}...${publicKeyHex.slice(publicKeyHex.length - 8)}>`,
                    ];
                } catch(e) {
                    return "Failed to parse Advert";
                }
            } else if(payloadType === "ANON_REQ"){
                const parsed = packet.parsePayload();
                const source = this.byteToHex(parsed.src.subarray(0, 1));
                const destination = this.byteToHex(parsed.dest);
                const sourceContactName = this.getContactNameByPublicKeyPrefix(parsed.src);
                const destinationContactName = this.getContactNameByPublicKeyPrefix([parsed.dest]);
                return [
                    `[${source} -> ${destination}]`,
                    `Source: ${sourceContactName}`,
                    `Dest: ${destinationContactName}`,
                ];
            }

            return null;

        },
        getContactNameByPublicKeyPrefix(publicKeyPrefix) {

            // check if self
            const selfPublicKeyPrefix = GlobalState.selfInfo?.publicKey.slice(0, publicKeyPrefix.length);
            if(BufferUtils.areBuffersEqual(publicKeyPrefix, selfPublicKeyPrefix)){
                return GlobalState?.selfInfo?.name ?? "(this device)";
            }

            // check if we found a matching contact
            const contact = this.findContactByPublicKeyPrefix(publicKeyPrefix);
            if(contact != null){
                return contact.advName;
            }

            // nothing found
            return "Unknown Contact";

        },
        async getPacketHash(packet) {
            return await this.sha256(new Uint8Array([
                packet.payload_type,
                ...packet.payload,
            ]));
        },
        async onLogRxData(data) {
            try {

                const packet = Packet.fromBytes(data.raw);
                const packetHash = await this.getPacketHash(packet);

                this.logs.push({
                    snr: data.lastSnr,
                    rssi: data.lastRssi,
                    packet: packet,
                    packet_hash: packetHash.substring(0, 8).toUpperCase(),
                });

            } catch(e) {
                console.log(e);
            }
        },
        async sha256(data) {
            const msgBuffer = new TextEncoder().encode(data);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        },
        findContactByPublicKeyPrefix(publicKeyPrefix) {
            // find first contact that matches this public key prefix
            return GlobalState.contacts.find((contact) => {
                const contactPublicKeyPrefix = contact.publicKey.slice(0, publicKeyPrefix.length);
                return BufferUtils.areBuffersEqual(publicKeyPrefix, contactPublicKeyPrefix);
            });
        },
    },
    computed: {
        searchedLogs() {
            return this.logs.filter((log) => {
                const search = this.search.toLowerCase();
                const matchesPacketHash = log.packet_hash.toLowerCase().includes(search);
                const matchesPayloadType = log.packet.getPayloadTypeString()?.toLowerCase()?.includes(search) === true;
                const matchesRouteType = log.packet.getRouteTypeString()?.toLowerCase()?.includes(search) === true;
                return matchesPacketHash || matchesPayloadType || matchesRouteType;
            });
        },
    },
}
</script>
