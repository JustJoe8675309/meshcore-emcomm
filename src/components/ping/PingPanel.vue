<template>
    <div class="w-full overflow-y-auto">
        <div class="p-3 space-y-3">

            <div class="text-xs text-gray-600 bg-white border border-gray-300 rounded-lg p-3">
                <div class="text-sm font-medium text-gray-900 mb-1">Repeater zero hop ping test</div>
                Sends trace requests directly to a repeater, with no relaying in between, and reports how
                well each end heard the other. A reply proves you can work that repeater yourself rather
                than only reaching it through another one, and the two signal readings show whether the
                link is as good in both directions.
            </div>

            <!-- find repeaters in direct range, including ones not in contacts -->
            <div class="bg-white border border-gray-300 rounded-lg p-3 space-y-2">

                <div class="flex items-center justify-between">
                    <div class="text-sm font-medium text-gray-900">Discover repeaters</div>
                    <div v-if="discoverSecondsLeft > 0" class="text-xs text-gray-500">listening, {{ discoverSecondsLeft }}s</div>
                </div>

                <div class="text-xs text-gray-500">
                    Asks every repeater in direct range to identify itself. Finds repeaters that have not
                    adverted since you came into range, so are not in your contacts at all.
                </div>

                <button
                    @click="discover"
                    :disabled="isRunning || isDiscovering"
                    type="button"
                    class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-sm px-5 py-2.5">{{ isDiscovering ? "Listening..." : "Discover repeaters" }}</button>

                <div v-if="discoverResults !== null" class="space-y-1">
                    <div v-if="discoverResults.length === 0" class="text-xs text-gray-600">
                        No repeater answered. Nothing is in direct range, which is a real answer rather than a fault.
                    </div>
                    <div v-else class="space-y-1">

                        <!-- a repeater already in contacts can be picked straight from here,
                             which saves finding it again in the list below -->
                        <button
                            v-for="found of discoverResults"
                            :key="found.publicKeyHex"
                            @click="selectDiscovered(found)"
                            :disabled="found.isNew"
                            type="button"
                            :aria-label="found.isNew ? `${found.name}, not in contacts` : `Select ${found.name} to ping`"
                            class="block w-full text-left text-xs rounded p-1 -m-1"
                            :class="[ found.isNew ? 'cursor-default' : 'hover:bg-gray-100 cursor-pointer',
                                      selectedContactKey === found.publicKeyHex ? 'bg-blue-50' : '' ]">
                            <span class="font-medium text-gray-900">{{ found.name }}</span>
                            <span v-if="found.isNew" class="ml-1 text-blue-700">new</span>
                            <span v-else-if="selectedContactKey === found.publicKeyHex" class="ml-1 text-blue-700">selected below</span>
                            <div class="font-mono text-gray-700">
                                snr_there={{ found.snrThere.toFixed(2) }}dB snr_back={{ found.snrBack.toFixed(2) }}dB rssi={{ found.rssi }}
                            </div>
                        </button>

                        <!-- a repeater that answered but is not a contact cannot be pinged
                             until it is one, and discovery carries no name to save it under -->
                        <div v-for="found of newlyDiscovered" :key="`add-${found.publicKeyHex}`" class="pl-1">
                            <button
                                @click="addAsContact(found)"
                                :disabled="addingKey !== null"
                                type="button"
                                class="text-xs text-blue-700 hover:underline disabled:opacity-60">
                                {{ addingKey === found.publicKeyHex ? "Adding..." : `Add ${found.name} as a contact` }}
                            </button>
                        </div>

                        <div v-if="addMessage" role="status" class="text-xs text-gray-600">{{ addMessage }}</div>

                    </div>
                </div>

                <div v-if="discoverError" role="status" class="text-xs text-red-600">{{ discoverError }}</div>

            </div>

            <!-- who to ping -->
            <fieldset :disabled="isRunning" class="bg-white border border-gray-300 rounded-lg p-3 space-y-3 disabled:opacity-60">

                <div class="space-y-1">
                    <label for="ping-contact" class="block text-sm font-medium text-gray-900">Repeater</label>
                    <SearchableSelect
                        input-id="ping-contact"
                        v-model="selectedContactKey"
                        :options="contactOptions"
                        placeholder="Select a repeater, or type to filter..."/>
                    <div v-if="pingableContacts.length === 0" class="text-xs text-red-600">
                        No repeaters known yet.
                    </div>
                    <div v-else class="text-xs text-gray-500">
                        Most recently heard first. A repeater listed as flood routed or several hops away is
                        known to the mesh but may not be reachable directly, and will simply time out. Some
                        repeaters answer discovery but not ping, so one found above can still time out here:
                        discovery proves it hears you, ping additionally needs it to answer trace requests.
                    </div>
                </div>

                <div class="flex space-x-3">
                    <div class="space-y-1 w-full">
                        <label for="ping-count" class="block text-sm font-medium text-gray-900">Requests</label>
                        <input
                            id="ping-count"
                            v-model.number="requestCount"
                            type="number" min="1" max="100"
                            class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                    </div>
                    <div class="space-y-1 w-full">
                        <label for="ping-delay" class="block text-sm font-medium text-gray-900">Delay (ms)</label>
                        <input
                            id="ping-delay"
                            v-model.number="delayMillis"
                            type="number" min="0" max="60000" step="100"
                            class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                    </div>
                </div>

                <!-- every request is a transmission, and this app is careful about that elsewhere -->
                <div class="text-xs text-gray-500">
                    {{ requestCount }} transmissions on the air, about {{ estimatedDurationLabel }} if the station answers.
                    A station that does not answer takes several seconds per request to give up, so a run that times
                    out takes considerably longer.
                </div>

            </fieldset>

            <!-- results -->
            <div v-if="results.length > 0" class="bg-white border border-gray-300 rounded-lg p-3 space-y-2">

                <div class="flex items-center justify-between">
                    <div class="text-sm font-medium text-gray-900">Replies</div>
                    <div class="text-xs text-gray-500">{{ results.length }} of {{ requestCount }}</div>
                </div>

                <div ref="log" class="space-y-1 max-h-64 overflow-y-auto">
                    <div
                        v-for="result of results"
                        :key="result.seq"
                        class="text-xs font-mono"
                        :class="[ result.success ? 'text-gray-800' : 'text-red-600' ]">
                        <template v-if="result.success">
                            {{ result.seq }}. snr_there={{ result.snrThere.toFixed(2) }}dB snr_back={{ result.snrBack.toFixed(2) }}dB time={{ result.timeMillis }}ms
                        </template>
                        <template v-else>
                            {{ result.seq }}. timeout
                        </template>
                    </div>
                </div>

                <!-- only once the run has finished, so a partial average is not mistaken for the result -->
                <div v-if="stats" class="border-t border-gray-200 pt-2 space-y-1 text-xs text-gray-700">
                    <div>{{ stats.total }} sent, {{ stats.lossPercent }}% lost</div>
                    <template v-if="stats.received > 0">
                        <div>avg snr_there={{ stats.avgSnrThere }}dB, snr_back={{ stats.avgSnrBack }}dB, time={{ stats.avgTime }}ms</div>
                        <div>min snr_there={{ stats.minSnrThere }}dB, snr_back={{ stats.minSnrBack }}dB</div>
                        <div>max snr_there={{ stats.maxSnrThere }}dB, snr_back={{ stats.maxSnrBack }}dB</div>
                    </template>
                </div>

            </div>

            <!-- controls -->
            <div class="space-y-2 pb-3">

                <div v-if="errorMessage" role="status" class="text-xs text-red-600">{{ errorMessage }}</div>

                <button
                    v-if="!isRunning"
                    @click="start"
                    :disabled="!canStart"
                    type="button"
                    class="w-full text-white bg-blue-700 hover:bg-blue-800 disabled:bg-gray-400 font-medium rounded-lg text-sm px-5 py-2.5">Start ping</button>

                <button
                    v-else
                    @click="cancel"
                    type="button"
                    class="w-full text-white bg-red-700 hover:bg-red-800 font-medium rounded-lg text-sm px-5 py-2.5">Cancel ({{ results.length }} of {{ requestCount }})</button>

                <button
                    v-if="stats"
                    @click="copyResults"
                    :disabled="isRunning"
                    type="button"
                    class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-sm px-5 py-2.5">Copy results</button>

            </div>

        </div>
    </div>
</template>

<script>
import { Constants } from "@liamcottle/meshcore.js";
import GlobalState from "../../js/GlobalState.js";
import Connection from "../../js/Connection.js";
import Utils from "../../js/Utils.js";
import TimeUtils from "../../js/TimeUtils.js";
import SearchableSelect from "../reports/SearchableSelect.vue";

// repeaters answer with a randomised widened delay, since many may reply at once,
// so this listens for a while rather than waiting on a single response
const DISCOVER_LISTEN_MILLIS = 30000;

export default {
    name: 'PingPanel',
    components: {
        SearchableSelect,
    },
    data() {
        return {
            selectedContactKey: null,
            isDiscovering: false,
            discoverResults: null,
            discoverError: null,
            discoverSecondsLeft: 0,
            addingKey: null,
            addMessage: null,
            requestCount: 5,
            delayMillis: 1000,
            results: [],
            stats: null,
            errorMessage: null,
            // the timestamp of the run in flight, which cancelling clears. comparing
            // against it lets a reply that arrives after cancelling be discarded
            runToken: null,
        };
    },
    computed: {

        /**
         * The repeaters worth offering, most recently heard first.
         *
         * Repeaters only. The link to a repeater is the one worth testing, because it
         * is the infrastructure everything else leans on, and unlike a companion it is
         * somewhere fixed whose coverage is worth knowing. Ordering by when each was
         * last heard puts the plausible ones first: a repeater silent for weeks is
         * unlikely to answer.
         */
        pingableContacts() {
            return GlobalState.contacts
                .filter((contact) => contact.type === Constants.AdvType.Repeater)
                .slice()
                .sort((a, b) => (b.lastAdvert ?? 0) - (a.lastAdvert ?? 0))
                .map((contact) => {
                    return {
                        name: contact.advName?.trim() || `(unnamed ${Utils.bytesToHex(contact.publicKey).slice(0, 8)})`,
                        publicKey: contact.publicKey,
                        publicKeyHex: Utils.bytesToHex(contact.publicKey),
                        lastAdvert: contact.lastAdvert,
                    };
                });
        },

        contactOptions() {
            return this.pingableContacts.map((contact) => {
                return {
                    value: contact.publicKeyHex,
                    label: contact.name,
                    // when they were last heard, which is the best hint at whether a
                    // ping is worth sending at all
                    hint: TimeUtils.formatUnixSecondsAgo(contact.lastAdvert),
                };
            });
        },

        // the ones that answered but have nowhere to be saved yet
        newlyDiscovered() {
            return (this.discoverResults ?? []).filter((found) => found.isNew);
        },

        selectedContact() {
            return this.pingableContacts.find((contact) => contact.publicKeyHex === this.selectedContactKey) ?? null;
        },

        isRunning() {
            return this.runToken !== null;
        },

        canStart() {
            return this.selectedContact !== null
                && GlobalState.connection != null
                && this.requestCount >= 1
                && this.delayMillis >= 0;
        },

        /**
         * Roughly how long a run takes when every request is answered.
         *
         * Deliberately the best case. A reply comes back in a few hundred
         * milliseconds, but an unanswered request waits on the device's own timeout,
         * measured at around four seconds, so a run that times out throughout takes
         * several times longer than this. Rather than present one number that is
         * wrong for half the cases, the label beside it says so.
         */
        estimatedDurationLabel() {
            // the delay sits between requests, not after the last one
            const gaps = Math.max(0, this.requestCount - 1) * this.delayMillis;
            const seconds = Math.round((gaps + this.requestCount * 500) / 100) / 10;
            return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 6) / 10} min`;
        },

    },
    watch: {
        // a new station means the previous station's numbers are not about this one
        selectedContactKey() {
            this.results = [];
            this.stats = null;
            this.errorMessage = null;
        },
    },
    methods: {

        async start() {

            const contact = this.selectedContact;
            if(contact == null){
                return;
            }

            this.results = [];
            this.stats = null;
            this.errorMessage = null;

            const token = Date.now();
            this.runToken = token;

            for(let i = 0; i < this.requestCount; i++){

                try {
                    const reply = await Connection.pingContact(contact.publicKey);

                    // cancelled while this one was in flight
                    if(this.runToken !== token){
                        return;
                    }

                    this.results.push({ seq: i + 1, success: true, ...reply });

                } catch(e) {
                    if(this.runToken !== token){
                        return;
                    }
                    // a timeout is a result, not an error: it is the packet loss being measured
                    this.results.push({ seq: i + 1, success: false });
                }

                await this.$nextTick();
                this.scrollLogToBottom();

                if(i < this.requestCount - 1){
                    await Utils.sleep(this.delayMillis);
                    if(this.runToken !== token){
                        return;
                    }
                }

            }

            this.runToken = null;
            this.computeStats();

        },

        /**
         * One zero hop control packet out, replies collected for the listening window.
         *
         * Names are resolved against the contact list where possible, and anything not
         * in it is marked new, which is the whole point: a repeater that has not
         * adverted since we arrived is reachable but invisible until it answers this.
         */
        async discover() {

            this.isDiscovering = true;
            this.discoverError = null;
            this.discoverResults = null;
            this.discoverSecondsLeft = Math.round(DISCOVER_LISTEN_MILLIS / 1000);

            const ticker = setInterval(() => {
                this.discoverSecondsLeft = Math.max(0, this.discoverSecondsLeft - 1);
            }, 1000);

            try {

                const found = await Connection.discoverRepeaters(DISCOVER_LISTEN_MILLIS);

                const known = new Map(GlobalState.contacts.map((c) => [Utils.bytesToHex(c.publicKey), c.advName]));

                this.discoverResults = found
                    .map((f) => ({
                        ...f,
                        name: known.get(f.publicKeyHex) || `(unknown ${f.publicKeyHex.slice(0, 8)})`,
                        isNew: !known.has(f.publicKeyHex),
                    }))
                    .sort((a, b) => b.snrBack - a.snrBack);

            } catch(e) {
                console.log("discovery failed", e);
                this.discoverError = "Discovery failed. The radio may be disconnected, or its firmware may predate this feature.";
            } finally {
                clearInterval(ticker);
                this.discoverSecondsLeft = 0;
                this.isDiscovering = false;
            }

        },

        /**
         * Picks a discovered repeater in the list below, as if it had been searched for
         * and clicked there.
         *
         * Only for one already in contacts. A newly discovered repeater has answered us
         * but is not a contact yet, so there is nothing in the picker to select, and
         * offering a dead click would be worse than showing it cannot be chosen.
         */
        /**
         * Saves a newly discovered repeater so it can be pinged.
         *
         * The name is invented from the public key, because discovery does not carry
         * one, and the device replaces it when the repeater first adverts. Saying so
         * matters: a contact appearing under a name nobody recognises looks like a
         * bug rather than a placeholder.
         */
        async addAsContact(found) {

            this.addingKey = found.publicKeyHex;
            this.addMessage = null;

            try {

                const name = await Connection.addDiscoveredRepeater(found);

                // it is a contact now, so the row above becomes selectable
                this.discoverResults = this.discoverResults.map((r) => r.publicKeyHex === found.publicKeyHex
                    ? { ...r, name: name, isNew: false }
                    : r);

                this.addMessage = `Saved as "${name}". The repeater's real name will replace that when it next adverts.`;

            } catch(e) {
                console.log("could not add contact", e);
                this.addMessage = "Could not save the contact. The device may be out of contact storage.";
            } finally {
                this.addingKey = null;
            }

        },

        selectDiscovered(found) {

            if(found.isNew){
                return;
            }

            this.selectedContactKey = found.publicKeyHex;

            // the picker is below the fold on a phone, so move to it rather than
            // silently changing something off screen
            this.$nextTick(() => {
                document.querySelector("#ping-contact")?.scrollIntoView({ block: "center", behavior: "smooth" });
            });

        },

        cancel() {
            // clearing the token abandons the loop and discards anything still in flight
            this.runToken = null;
            this.computeStats();
        },

        computeStats() {

            if(this.results.length === 0){
                this.stats = null;
                return;
            }

            const received = this.results.filter((r) => r.success);
            const round = (value) => Math.round(value * 100) / 100;
            const average = (key) => received.length === 0 ? 0 : round(received.reduce((sum, r) => sum + r[key], 0) / received.length);
            const lowest = (key) => received.length === 0 ? 0 : round(Math.min(...received.map((r) => r[key])));
            const highest = (key) => received.length === 0 ? 0 : round(Math.max(...received.map((r) => r[key])));

            this.stats = {
                total: this.results.length,
                received: received.length,
                lossPercent: round((1 - received.length / this.results.length) * 100),
                avgSnrThere: average("snrThere"),
                avgSnrBack: average("snrBack"),
                avgTime: Math.round(average("timeMillis")),
                minSnrThere: lowest("snrThere"),
                minSnrBack: lowest("snrBack"),
                maxSnrThere: highest("snrThere"),
                maxSnrBack: highest("snrBack"),
            };

        },

        scrollLogToBottom() {
            const log = this.$refs.log;
            if(log){
                log.scrollTop = log.scrollHeight;
            }
        },

        async copyResults() {

            const name = this.selectedContact?.advName ?? "";
            const lines = [`PING ${name}`];

            for(const result of this.results){
                lines.push(result.success
                    ? `${result.seq}. snr_there=${result.snrThere.toFixed(2)}dB snr_back=${result.snrBack.toFixed(2)}dB time=${result.timeMillis}ms`
                    : `${result.seq}. timeout`);
            }

            if(this.stats){
                lines.push(`${this.stats.total} sent, ${this.stats.lossPercent}% lost`);
                if(this.stats.received > 0){
                    lines.push(`avg snr_there=${this.stats.avgSnrThere}dB snr_back=${this.stats.avgSnrBack}dB time=${this.stats.avgTime}ms`);
                }
            }

            await Utils.copyToClipboard(lines.join("\n"));

        },

    },
}
</script>
