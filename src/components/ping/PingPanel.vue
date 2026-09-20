<template>
    <div class="w-full overflow-y-auto">
        <div class="p-3 space-y-3">

            <!-- who to ping -->
            <fieldset :disabled="isRunning" class="bg-white border border-gray-300 rounded-lg p-3 space-y-3 disabled:opacity-60">

                <div class="space-y-1">
                    <label for="ping-type" class="block text-sm font-medium text-gray-900">Station type</label>
                    <select
                        id="ping-type"
                        v-model="contactType"
                        class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                        <option value="companion">Companion</option>
                        <option value="repeater">Repeater</option>
                    </select>
                </div>

                <div class="space-y-1">
                    <label for="ping-contact" class="block text-sm font-medium text-gray-900">Station</label>
                    <SearchableSelect
                        input-id="ping-contact"
                        v-model="selectedContactKey"
                        :options="contactOptions"
                        placeholder="Select a station, or type to filter..."/>
                    <div v-if="pingableContacts.length === 0" class="text-xs text-red-600">
                        No {{ contactType }}s known yet. Try Discover, or wait for one to advert.
                    </div>
                    <div v-else class="text-xs text-gray-500">
                        Most recently heard first. Tests the direct path to this station, not whatever route the mesh would find.
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

                <!-- one transmission announcing ourselves. it cannot make another station
                     advert on demand, because the protocol has no such request -->
                <button
                    @click="discover"
                    :disabled="isRunning || isDiscovering"
                    type="button"
                    class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-sm px-5 py-2.5">{{ isDiscovering ? "Discovering..." : "Discover stations" }}</button>

                <div v-if="discoveryMessage" role="status" class="text-xs text-gray-600">{{ discoveryMessage }}</div>

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

// how long to listen for answers after adverting, before counting what changed.
// a custom component option would not reach `this` in vue 3, so it lives here
const DISCOVERY_LISTEN_MILLIS = 8000;

export default {
    name: 'PingPanel',
    components: {
        SearchableSelect,
    },
    data() {
        return {
            selectedContactKey: null,
            contactType: "companion",
            isDiscovering: false,
            discoveryMessage: null,
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
         * The stations worth offering, newest first.
         *
         * Repeaters are included, unlike the reports tab. That restriction is about
         * text messages, which a repeater cannot receive; a trace is answered by any
         * node, and the link to a repeater is often the one an operator most needs to
         * check, since it is the infrastructure everything else depends on.
         *
         * Ordered by when each was last heard, because that is the best available
         * guess at which are worth pinging at all.
         */
        pingableContacts() {
            const wanted = this.contactType === "repeater" ? Constants.AdvType.Repeater : Constants.AdvType.Chat;
            return GlobalState.contacts
                .filter((contact) => contact.type === wanted)
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
        // the previously selected station is not in the new list
        contactType() {
            this.selectedContactKey = null;
        },
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
         * Announces this station and reloads the contact list.
         *
         * Not a discovery request, because the protocol has no such thing: there is a
         * command to advertise ourselves and none to ask anyone else to. What this
         * relies on is that a station hearing our advert may advert back, which would
         * refresh when it was last heard. That behaviour was observed once and is not
         * guaranteed, so the result reports what actually changed rather than claiming
         * to have found anything.
         *
         * Zero hop rather than flood: it asks the neighbours we could actually reach
         * directly, which is what the ping tab is about, and does not push an advert
         * across the whole region.
         */
        async discover() {

            this.isDiscovering = true;
            this.discoveryMessage = null;

            const before = new Map(GlobalState.contacts.map((c) => [Utils.bytesToHex(c.publicKey), c.lastAdvert ?? 0]));

            try {

                await GlobalState.connection.sendZeroHopAdvert();

                // give neighbours a moment to answer before looking
                await Utils.sleep(DISCOVERY_LISTEN_MILLIS);
                await Connection.loadContacts();

                var added = 0;
                var refreshed = 0;
                for(const contact of GlobalState.contacts){
                    const key = Utils.bytesToHex(contact.publicKey);
                    if(!before.has(key)){
                        added++;
                    } else if((contact.lastAdvert ?? 0) > before.get(key)){
                        refreshed++;
                    }
                }

                this.discoveryMessage = added === 0 && refreshed === 0
                    ? "Advert sent. No station answered within the listening window."
                    : `Advert sent. ${added} new, ${refreshed} heard again.`;

            } catch(e) {
                console.log("discovery failed", e);
                this.discoveryMessage = "Could not send the advert. Check the radio is still connected.";
            } finally {
                this.isDiscovering = false;
            }

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
