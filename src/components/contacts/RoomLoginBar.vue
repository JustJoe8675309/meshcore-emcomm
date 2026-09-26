<template>
    <div v-if="isRoom" class="bg-white border-b border-gray-300 p-3 space-y-2">

        <div class="flex items-center justify-between">
            <div class="text-sm font-medium text-gray-900">Room server</div>
            <div class="text-xs" :class="[ loggedIn ? 'text-green-700' : 'text-gray-500' ]">
                {{ loggedIn ? roleLabel : "Not logged in" }}
            </div>
        </div>

        <div v-if="!loggedIn" class="text-xs text-gray-500">
            A room holds its posts until you log in. The password is sent straight to the radio
            and kept nowhere, so it is typed each time. A room does not reply to a wrong password,
            so a failed login looks the same as one that never arrived.
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

        <!-- A room three hops out answered at 12 seconds on the bench, and this
             waits 45 before giving up. The button reading "..." is not enough to
             stop an operator pressing it again and wondering which attempt took. -->
        <div v-if="isLoggingIn" role="status" class="text-xs text-gray-700">
            Waiting for the room. One three hops away answered in about 12 seconds, and this waits
            up to {{ waitSeconds }} before it gives up — a wrong password is answered with silence,
            so the wait is the same either way. Pressing again does not make it quicker.
        </div>

        <!-- said here rather than filled in above. a prefilled box is a trap: type
             into it without clearing first and the default is silently prepended to
             what you typed, and the room answers a wrong password with silence, so
             there is nothing to tell you that is what happened -->
        <div v-if="!loggedIn" class="text-xs text-gray-500">
            The MeshCore firmware ships with <span class="font-mono">hello</span> as the room
            password, a published default rather than a secret, so try that if you do not know it.
            Leave the box empty to send no password at all, which is how a room with none is
            joined.
        </div>

        <div v-if="notConnected" role="status" class="text-xs text-red-600">
            No radio connected, so nothing can be sent.
        </div>

        <div v-if="errorMessage" role="status" class="text-xs text-red-600">{{ errorMessage }}</div>

        <div v-if="loggedIn && !canPost" role="status" class="text-xs text-amber-700">
            This room granted read access only, so posts will not be accepted. Log in again with a
            password that has posting rights.
        </div>

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
import RoomKeepAlive from "../../js/rooms/RoomKeepAlive.js";
import Utils from "../../js/Utils.js";

// The firmware's stock room password, -D ROOM_PASSWORD='"hello"' in the MeshCore
// variants, is named in the text under the field rather than filled into it.
//
// It was prefilled, and that turned out to be a trap on the bench: typing an
// admin password into the box without clearing it first sends the default joined
// to what was typed, and a room answers a wrong password with silence, so nothing
// says that is what happened. An empty box sends no password, which is a case the
// firmware handles deliberately, so it is a safe and meaningful default.

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
            canPost: false,
        };
    },
    watch: {
        // a different room is a different login
        contactKey(key) {
            this.password = "";
            this.errorMessage = null;
            // a login already made this session still stands
            const existing = key == null ? null : GlobalState.roomLogins[key];
            this.loggedIn = existing != null;
            this.isAdmin = existing?.isAdmin ?? false;
            this.canPost = existing?.canPost ?? false;
        },
    },
    mounted() {
        const existing = this.contactKey == null ? null : GlobalState.roomLogins[this.contactKey];
        if(existing != null){
            this.loggedIn = true;
            this.isAdmin = existing.isAdmin;
            this.canPost = existing.canPost === true;
            // a session logged in before this bar was shown, or before a reload of
            // the view, still needs its keep-alive running
            if(!RoomKeepAlive.isRunning(this.contact.publicKey)){
                RoomKeepAlive.start(this.contact.publicKey);
            }
        }
    },
    methods: {
        async logIn() {

            // pressing again while one is in flight starts a second login and
            // leaves the operator watching two waits at once
            if(this.isLoggingIn){
                return;
            }

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
                this.isAdmin = response?.isAdmin === true;
                this.canPost = response?.canPost === true;
                // the composer reads this, so it can refuse to post into a room
                // that would ignore the post
                // the room's clock offset lets a replayed post be told from a new one
                GlobalState.roomLogins[this.contactKey] = {
                    isAdmin: this.isAdmin,
                    canPost: this.canPost,
                    clockOffsetSeconds: response?.clockOffsetSeconds ?? null,
                };
                // a room stops pushing posts to a client after three failed
                // pushes, and only a request from the client clears that. Logging
                // in again does not, so this has to run for the whole session
                RoomKeepAlive.start(this.contact.publicKey);
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
                    this.errorMessage = "No answer after 45 seconds. A room says nothing to a wrong password, so check "
                        + "the password first. If the password is right, reset the path from the menu above and try again: "
                        + "a stale path to a room several hops out is a common cause.";
                }

            } finally {
                // held only for the call, and never left sitting in the box
                this.password = "";
                this.isLoggingIn = false;
            }

        },
    },
    computed: {

        /** How long this waits, from the one place that decides it. */
        waitSeconds() {
            return Math.round(Connection.ROOM_LOGIN_TIMEOUT_MILLIS / 1000) + " seconds";
        },
        roleLabel() {
            if(this.isAdmin){
                return "Logged in as admin";
            }
            return this.canPost ? "Logged in" : "Logged in, read only";
        },
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
