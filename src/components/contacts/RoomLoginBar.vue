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
            and kept nowhere, so it is typed each time. This starts at
            <span class="font-mono">hello</span>, the stock room password the MeshCore firmware
            ships with, which is a published default rather than a secret. A room does not reply
            to a wrong password, so a failed login looks the same as one that never arrived.
            Clear the box to send no password at all, which is how a room with none is joined.
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

// The stock room password the firmware ships with, set as a build flag in the
// MeshCore variants: -D ROOM_PASSWORD='"hello"'. A published default, not a
// secret, so starting here saves typing on most rooms and is shown rather than
// applied invisibly: an operator should be able to see what is being sent.
const DEFAULT_ROOM_PASSWORD = "hello";

export default {
    name: 'RoomLoginBar',
    props: {
        contact: Object,
    },
    data() {
        return {
            password: DEFAULT_ROOM_PASSWORD,
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
        contactKey(key) {
            this.password = DEFAULT_ROOM_PASSWORD;
            this.errorMessage = null;
            // a login already made this session still stands
            const existing = key == null ? null : GlobalState.roomLogins[key];
            this.loggedIn = existing != null;
            this.isAdmin = existing?.isAdmin ?? false;
        },
    },
    mounted() {
        const existing = this.contactKey == null ? null : GlobalState.roomLogins[this.contactKey];
        if(existing != null){
            this.loggedIn = true;
            this.isAdmin = existing.isAdmin;
        }
    },
    methods: {
        async logIn() {

            this.isLoggingIn = true;
            this.errorMessage = null;

            try {

                // Sent exactly as it stands, including empty. A blank password is
                // not the absence of one: the firmware reads it as "check whether
                // this sender is in the ACL", which is how a room with no password
                // is joined. Substituting the default here would make that room
                // impossible to log in to from this app.
                const response = await Connection.loginToRoom(this.contact.publicKey, this.password);
                this.loggedIn = true;
                this.isAdmin = (response?.reserved ?? 0) !== 0;
                // the composer reads this, so it can refuse to post into a room
                // that would ignore the post
                GlobalState.roomLogins[this.contactKey] = { isAdmin: this.isAdmin };
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
                    // A room server answers a wrong password with silence. Its own
                    // source says so: "no response. Client will timeout". So this
                    // is the case a bad password actually lands in, and blaming
                    // the range would send the operator to check an antenna when
                    // the likeliest fault is the password they just typed. The app
                    // cannot tell the two apart, so it says both rather than
                    // picking one and sounding sure.
                    this.errorMessage = "No answer. A room says nothing to a wrong password, so check the password first, "
                        + "then whether the room is reachable at all.";
                }

            } finally {
                // held only for the call, then back to the default
                this.password = DEFAULT_ROOM_PASSWORD;
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
