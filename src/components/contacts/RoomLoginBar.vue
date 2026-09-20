<template>
    <div v-if="isRoom" class="bg-white border-b border-gray-300 p-3 space-y-2">

        <div class="flex items-center justify-between">
            <div class="text-sm font-medium text-gray-900">Room server</div>
            <div class="text-xs" :class="[ loggedIn ? 'text-green-700' : 'text-gray-500' ]">
                {{ loggedIn ? (isAdmin ? "Logged in as admin" : "Logged in") : "Not logged in" }}
            </div>
        </div>

        <div v-if="!loggedIn" class="text-xs text-gray-500">
            A room holds its posts until you log in. The password is sent straight to the radio
            and kept nowhere, so it is typed each time.
        </div>

        <form v-if="!loggedIn" @submit.prevent="logIn" class="flex space-x-2">
            <input
                ref="password"
                v-model="password"
                :id="passwordFieldId"
                type="password"
                autocomplete="off"
                :disabled="isLoggingIn || notConnected"
                placeholder="Room password"
                aria-label="Room password"
                class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
            <button
                type="submit"
                :disabled="isLoggingIn || notConnected"
                class="shrink-0 text-white bg-blue-700 hover:bg-blue-800 disabled:bg-gray-400 font-medium rounded-lg text-sm px-4">{{ isLoggingIn ? "..." : "Log in" }}</button>
        </form>

        <div v-if="notConnected" role="status" class="text-xs text-red-600">
            No radio connected, so nothing can be sent.
        </div>

        <div v-if="errorMessage" role="status" class="text-xs text-red-600">{{ errorMessage }}</div>

        <div v-if="loggedIn" class="text-xs text-gray-500">
            Posts made while you were away arrive once the server has sent them. A room keeps only
            a limited backlog, so a long absence can leave a gap rather than an error.
        </div>

    </div>
</template>

<script>
import { Constants } from "@liamcottle/meshcore.js";
import GlobalState from "../../js/GlobalState.js";
import Connection from "../../js/Connection.js";
import Utils from "../../js/Utils.js";

export default {
    name: 'RoomLoginBar',
    props: {
        contact: Object,
    },
    data() {
        return {
            password: "",
            isLoggingIn: false,
            errorMessage: null,
            // a login lasts as long as the radio holds the session, so this is not
            // persisted anywhere: reconnecting means logging in again
            loggedIn: false,
            isAdmin: false,
        };
    },
    watch: {
        // a different room is a different login
        contactKey() {
            this.password = "";
            this.errorMessage = null;
            this.loggedIn = false;
            this.isAdmin = false;
        },
    },
    methods: {
        async logIn() {

            if(this.password === ""){
                this.errorMessage = "Enter the room password.";
                return;
            }

            this.isLoggingIn = true;
            this.errorMessage = null;

            try {

                const response = await Connection.loginToRoom(this.contact.publicKey, this.password);
                this.loggedIn = true;
                this.isAdmin = (response?.reserved ?? 0) !== 0;
                this.$emit("logged-in");

            } catch(e) {

                // the three outcomes are genuinely different and the operator's next
                // move differs with them: fix the password, move closer, reconnect
                const reason = String(e?.message ?? e);
                if(reason === Connection.LOGIN_FAILED){
                    this.errorMessage = "The room refused that password. It answered, so it is in range.";
                } else if(reason === Connection.DISCONNECTED || GlobalState.connection == null){
                    this.errorMessage = "The radio disconnected, so nothing was sent.";
                } else {
                    this.errorMessage = "No answer from the room. It may be out of range, or too busy to reply.";
                }

            } finally {
                // held only for the call
                this.password = "";
                this.isLoggingIn = false;
            }

        },
    },
    computed: {
        isRoom() {
            return this.contact?.type === Constants.AdvType.Room;
        },
        notConnected() {
            return GlobalState.connection == null;
        },
        contactKey() {
            return this.contact?.publicKey ? Utils.bytesToHex(this.contact.publicKey) : null;
        },
        passwordFieldId() {
            return `room-password-${this.contactKey ?? "none"}`;
        },
    },
    emits: [
        "logged-in",
    ],
}
</script>
