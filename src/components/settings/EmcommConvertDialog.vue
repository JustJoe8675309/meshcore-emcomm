<template>
    <div class="fixed inset-0 z-50 flex bg-black/40 p-3 overflow-y-auto">
        <div class="m-auto w-full max-w-lg bg-white rounded-lg shadow-lg divide-y">

            <div class="p-3">
                <div class="font-semibold text-gray-900">Convert to EMCOMM mode</div>
                <div class="text-xs text-gray-500 mt-1">
                    A backup was taken before this dialog opened, so everything here can be undone.
                </div>
            </div>

            <!-- what will be removed. shown first because it is the part that cannot
                 be half done: the operator should see the damage before the details -->
            <div class="p-3 space-y-1">
                <div class="text-sm font-medium text-gray-900">Contacts</div>
                <div class="text-xs text-gray-700">
                    Removing <span class="font-semibold">{{ plan.remove.length }}</span> of
                    {{ plan.remove.length + plan.keep.length }}:
                    {{ plan.counts.companions }} companions (all),
                    {{ plan.counts.repeaters }} repeaters and
                    {{ plan.counts.rooms }} rooms quiet over {{ quietDays }} days.
                </div>
                <div v-if="plan.keptFavourites > 0" class="text-xs text-gray-700">
                    {{ plan.keptFavourites }} kept because they are favourites, whatever their type or age.
                </div>
                <div v-if="plan.keptForUnreadableAge > 0" class="text-xs text-amber-700">
                    {{ plan.keptForUnreadableAge }} kept because their last heard time could not be read.
                    That time comes from the other node's clock, so it is not always trustworthy.
                </div>
            </div>

            <!-- node name -->
            <div class="p-3 space-y-1">
                <label for="emcomm-name" class="block text-sm font-medium text-gray-900">Node name</label>
                <input
                    id="emcomm-name"
                    v-model="name"
                    type="text"
                    class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                <div class="text-xs text-gray-500">Currently <span class="font-mono">{{ current.name }}</span>. This is what other operators see.</div>
            </div>

            <!-- radio. the one change here that can leave a station unable to hear
                 anybody, so it states that plainly and shows both sides -->
            <div class="p-3 space-y-2">

                <div class="flex items-center justify-between">
                    <label for="emcomm-preset" class="text-sm font-medium text-gray-900">Radio</label>
                    <span class="text-xs" :class="[ radioUnchanged ? 'text-gray-500' : 'text-amber-700' ]">
                        {{ radioUnchanged ? "No change" : "Will change" }}
                    </span>
                </div>

                <select
                    id="emcomm-preset"
                    v-model="preset"
                    class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                    <option value="us">USA / Canada (Recommended)</option>
                    <option value="custom">Custom</option>
                </select>

                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <div class="text-xs text-gray-500 mb-1">Frequency (kHz)</div>
                        <input v-model.number="radio.radioFreq" @input="preset = 'custom'" type="number" aria-label="Frequency in kHz"
                               class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg block w-full p-2">
                    </div>
                    <div>
                        <div class="text-xs text-gray-500 mb-1">Bandwidth (Hz)</div>
                        <input v-model.number="radio.radioBw" @input="preset = 'custom'" type="number" aria-label="Bandwidth in Hz"
                               class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg block w-full p-2">
                    </div>
                    <div>
                        <div class="text-xs text-gray-500 mb-1">Spreading factor</div>
                        <input v-model.number="radio.radioSf" @input="preset = 'custom'" type="number" aria-label="Spreading factor"
                               class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg block w-full p-2">
                    </div>
                    <div>
                        <div class="text-xs text-gray-500 mb-1">Coding rate</div>
                        <input v-model.number="radio.radioCr" @input="preset = 'custom'" type="number" aria-label="Coding rate"
                               class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg block w-full p-2">
                    </div>
                </div>

                <div class="text-xs text-gray-500">
                    Now: {{ current.radioFreq }} kHz, BW {{ current.radioBw }}, SF {{ current.radioSf }}, CR {{ current.radioCr }}.
                </div>

                <div v-if="!radioUnchanged" role="status" class="text-xs text-red-600">
                    Changing these takes this node off the mesh of anyone still using the old settings.
                    Only move as a group, by prior arrangement.
                </div>

            </div>

            <!-- the rest, each one reversible and each stated -->
            <div class="p-3 space-y-2">
                <div class="text-sm font-medium text-gray-900">Also</div>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="maxTxPower" type="checkbox" class="mt-0.5">
                    <span>Raise transmit power to the radio's maximum ({{ current.maxTxPower }} dBm, now {{ current.txPower }}). The EMCOMM default</span>
                </label>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="shareLocation" type="checkbox" class="mt-0.5">
                    <span>Share location with stations that ask. Its radio answers a position request itself, even with this app closed, if it has a working GPS. Also shares battery voltage</span>
                </label>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="setPositionFromGps" type="checkbox" class="mt-0.5">
                    <span>Set the advert position from a live GPS fix, if the radio has one</span>
                </label>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="syncClock" type="checkbox" class="mt-0.5">
                    <span>Sync the device clock. Date time groups and message ordering depend on it</span>
                </label>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="advertPosition" type="checkbox" class="mt-0.5">
                    <span>Put this station's position in every advert, so other stations plot it without asking. Anyone in range sees where you are</span>
                </label>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="multiAcks" type="checkbox" class="mt-0.5">
                    <span>Send each delivery acknowledgement more than once, so fewer messages that arrived are reported as failed. Costs a little airtime</span>
                </label>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="autoAddContacts" type="checkbox" class="mt-0.5">
                    <span>Add contacts automatically, so every station heard can be messaged and can ask for a position. The list refills after the trim</span>
                </label>
            </div>

            <!-- the net's channel, and answering on it -->
            <div class="p-3 space-y-2">
                <div class="text-sm font-medium text-gray-900">Net channel</div>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="addChannel" type="checkbox" class="mt-0.5">
                    <span>Add this channel, if the radio does not have it already</span>
                </label>

                <input
                    v-model="channelName"
                    :disabled="!addChannel"
                    type="text"
                    aria-label="Net channel name"
                    class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg block w-full p-2 disabled:opacity-60">

                <div class="text-xs text-gray-500">
                    A channel beginning with # has a key worked out from its name, so every station
                    joins it by name alone with nothing to pass around. The spelling and capitals
                    must match exactly. It is not private: anyone who guesses the name can read it.
                </div>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="answerPositionsOnChannel" :disabled="!addChannel" type="checkbox" class="mt-0.5">
                    <span>Answer position requests on this channel, so net control's roll calls reach you</span>
                </label>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="autoAnswerPositions" type="checkbox" class="mt-0.5">
                    <span>Answer them automatically, without asking each time</span>
                </label>
            </div>

            <!-- repeating adverts, so the net keeps seeing this station -->
            <div class="p-3 space-y-2">
                <div class="text-sm font-medium text-gray-900">Keep announcing while in the mode</div>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="repeatAdverts" type="checkbox" class="mt-0.5">
                    <span>Repeat adverts: zero hop every
                        <input v-model.number="zeroHopMinutes" :disabled="!repeatAdverts" type="number" min="0" step="1" aria-label="Minutes between zero hop adverts"
                               class="w-16 mx-1 bg-gray-50 border border-gray-300 text-sm rounded p-1">
                        minutes, flood every
                        <input v-model.number="floodMinutes" :disabled="!repeatAdverts" type="number" min="0" step="1" aria-label="Minutes between flood adverts"
                               class="w-16 mx-1 bg-gray-50 border border-gray-300 text-sm rounded p-1">
                        minutes. 0 turns one off</span>
                </label>

                <div class="text-xs text-gray-500">
                    These run in this app, so they need it open, and the screen is kept on while they
                    run. A flood advert reaches the whole mesh, so it is the one to keep rare.
                </div>
            </div>

            <!-- who is operating: the report forms fill FM and DTG from these -->
            <div class="p-3 space-y-2">
                <div class="text-sm font-medium text-gray-900">Operator</div>

                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <div class="text-xs text-gray-500 mb-1">Callsign</div>
                        <input v-model="callsign" type="text" aria-label="Operator callsign" placeholder="KJ5HBN"
                               class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg block w-full p-2">
                    </div>
                    <div>
                        <div class="text-xs text-gray-500 mb-1">Report times</div>
                        <select v-model="dtgZone" aria-label="Report time zone"
                                class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg block w-full p-2">
                            <option value="local">Local (L)</option>
                            <option value="zulu">Zulu (Z)</option>
                        </select>
                    </div>
                </div>

                <div v-if="callsign.trim() === ''" role="status" class="text-xs text-amber-700">
                    Report forms fill FM from the callsign, and it names you on a position answer.
                    With none, they use the radio's name.
                </div>
                <div class="text-xs text-gray-500">Match the time zone the net runs on.</div>
            </div>

            <!-- announcing -->
            <div class="p-3 space-y-2">
                <div class="text-sm font-medium text-gray-900">Then announce the station</div>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="advert" type="radio" value="flood" class="mt-0.5">
                    <span>Flood advert. Every operator and repeater on the mesh learns this station is up</span>
                </label>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="advert" type="radio" value="zerohop" class="mt-0.5">
                    <span>Zero hop advert. Only stations in direct range hear it</span>
                </label>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="advert" type="radio" value="none" class="mt-0.5">
                    <span>Do not advert</span>
                </label>

                <label class="flex items-start space-x-2 text-xs text-gray-700">
                    <input v-model="discover" type="checkbox" class="mt-0.5">
                    <span>Then look for repeaters in direct range</span>
                </label>
            </div>

            <div class="p-3 flex space-x-2">
                <button @click="$emit('cancel')" type="button"
                        class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 font-medium rounded-lg text-sm px-5 py-2.5">Cancel</button>
                <button @click="confirm" type="button"
                        class="w-full text-white bg-amber-700 hover:bg-amber-800 font-medium rounded-lg text-sm px-5 py-2.5">Convert</button>
            </div>

        </div>
    </div>
</template>

<script>
import EmcommMode from "../../js/EmcommMode.js";
import OperatorSettings from "../../js/reports/OperatorSettings.js";

export default {
    name: 'EmcommConvertDialog',
    props: {
        // what the trim would do, worked out before this opened
        plan: Object,
        // the node as it is now
        current: Object,
    },
    emits: ["cancel", "confirm"],
    data() {
        const callsign = (OperatorSettings.callsign ?? "").trim();
        return {
            // prefilled, not imposed: the name is the operator's to choose, and it
            // is what every other station sees
            name: callsign ? `${callsign}-EMCOMM` : (this.current?.name ?? ""),
            preset: "us",
            radio: { ...EmcommMode.US_PRESET },
            maxTxPower: true,
            setPositionFromGps: true,
            syncClock: true,
            // on by default: during an incident the stations that matter are the
            // ones being heard, and the radio only answers position requests from
            // stations in its contacts
            autoAddContacts: true,
            shareLocation: true,
            // every advert carries the position during an incident: other stations
            // plot the net without asking. Off is one tick away for anyone who
            // would rather not broadcast where they are
            advertPosition: true,
            // fewer messages that arrived reported as failed, for a little airtime
            multiAcks: true,
            advert: "flood",
            discover: true,
            addChannel: true,
            channelName: EmcommMode.EMCOMM_CHANNEL_NAME,
            answerPositionsOnChannel: true,
            // off: the operator stays in the loop unless they choose otherwise
            autoAnswerPositions: false,
            repeatAdverts: true,
            zeroHopMinutes: EmcommMode.ADVERT_SCHEDULE.zeroHopMinutes,
            floodMinutes: EmcommMode.ADVERT_SCHEDULE.floodMinutes,
            callsign: callsign,
            dtgZone: OperatorSettings.state.dtgZone,
        };
    },
    watch: {
        preset(value) {
            if(value === "us"){
                this.radio = { ...EmcommMode.US_PRESET };
            }
        },
    },
    computed: {
        quietDays() {
            return EmcommMode.QUIET_DAYS;
        },
        radioUnchanged() {
            return EmcommMode.radioMatches(this.current, this.radio);
        },
    },
    methods: {
        confirm() {
            this.$emit("confirm", {
                name: this.name?.trim() || null,
                // nothing is sent when it would not change anything: a write that
                // changes nothing is still a write that can fail
                radio: this.radioUnchanged ? null : { ...this.radio },
                txPower: this.maxTxPower ? this.current.maxTxPower : null,
                setPositionFromGps: this.setPositionFromGps,
                syncClock: this.syncClock,
                autoAddContacts: this.autoAddContacts,
                shareLocation: this.shareLocation,
                advertPosition: this.advertPosition,
                multiAcks: this.multiAcks,
                advert: this.advert,
                discover: this.discover,
                channelName: this.addChannel ? (this.channelName ?? "").trim() : null,
                answerPositionsOnChannel: this.addChannel && this.answerPositionsOnChannel,
                autoAnswerPositions: this.autoAnswerPositions,
                advertSchedule: this.repeatAdverts
                    ? { zeroHopMinutes: this.zeroHopMinutes, floodMinutes: this.floodMinutes }
                    : null,
                callsign: (this.callsign ?? "").trim(),
                dtgZone: this.dtgZone,
            });
        },
    },
}
</script>
