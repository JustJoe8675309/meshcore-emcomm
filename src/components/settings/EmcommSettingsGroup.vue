<template>
    <div class="bg-white divide-y">

        <div v-if="!bare" class="bg-white p-2 font-semibold flex items-center justify-between">
            <span>EMCOMM Settings</span>
            <span class="text-xs font-normal" :class="[ inEmcommMode ? 'text-amber-700' : 'text-gray-500' ]">
                {{ modeLabel }}
            </span>
        </div>

        <div class="p-2 text-xs text-gray-500">
            Each of these takes effect on the radio straight away, one at a time, rather than
            waiting for Save.
        </div>

        <!-- automatic contacts -->
        <div class="w-full p-2 space-y-1">
            <div class="flex items-center justify-between">
                <div class="text-sm font-medium text-gray-900">Add contacts automatically</div>
                <div class="text-xs text-gray-500">{{ current.manualAddContacts === 1 ? "Off" : "On" }}</div>
            </div>
            <button
                @click="toggleManualAdd"
                :disabled="busy || notConnected"
                type="button"
                class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-xs px-3 py-2">
                {{ current.manualAddContacts === 1 ? "Turn on" : "Turn off" }}
            </button>
            <div class="text-xs text-gray-500">
                Off keeps a trimmed list trimmed. On lets the node re-add every station it hears.
            </div>
        </div>

        <!-- location sharing, which is the radio's telemetry permission -->
        <div class="w-full p-2 space-y-1">
            <div class="flex items-center justify-between">
                <div class="text-sm font-medium text-gray-900">Location sharing</div>
                <div class="text-xs text-gray-500">{{ sharingLabel }}</div>
            </div>
            <button
                @click="toggleLocationSharing"
                :disabled="busy || notConnected"
                type="button"
                class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-xs px-3 py-2">
                {{ sharing === "all" ? "Turn off" : "Turn on" }}
            </button>
            <div class="text-xs text-gray-500">
                On, the radio answers any contact's position request itself, even with this app closed,
                if it has a working GPS. Also shares battery voltage.
            </div>
        </div>

        <!-- transmit power -->
        <div class="w-full p-2 space-y-1">
            <div class="flex items-center justify-between">
                <div class="text-sm font-medium text-gray-900">Transmit power</div>
                <div class="text-xs text-gray-500">{{ current.txPower }} of {{ current.maxTxPower }} dBm</div>
            </div>
            <button
                @click="setMaxPower"
                :disabled="busy || notConnected || current.txPower === current.maxTxPower"
                type="button"
                class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-xs px-3 py-2">
                {{ current.txPower === current.maxTxPower ? "Already at maximum" : `Raise to ${current.maxTxPower} dBm` }}
            </button>
        </div>

        <!-- advert position -->
        <div class="w-full p-2 space-y-1">
            <div class="flex items-center justify-between">
                <div class="text-sm font-medium text-gray-900">Advert position</div>
                <div class="text-xs text-gray-500">{{ positionLabel }}</div>
            </div>
            <button
                @click="setPositionFromGps"
                :disabled="busy || notConnected"
                type="button"
                class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-xs px-3 py-2">Set from live GPS fix</button>
            <div class="text-xs text-gray-500">
                Only written from a fix the radio reports now. A node without a receiver is left alone
                rather than set to 0, 0.
            </div>
        </div>

        <!-- device clock -->
        <div class="w-full p-2 space-y-1">
            <div class="flex items-center justify-between">
                <div class="text-sm font-medium text-gray-900">Device clock</div>
                <div class="text-xs" :class="[ driftSeconds != null && driftSeconds > 60 ? 'text-amber-700' : 'text-gray-500' ]">
                    {{ driftLabel }}
                </div>
            </div>
            <button
                @click="syncClock"
                :disabled="busy || notConnected"
                type="button"
                class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-xs px-3 py-2">Sync to this device</button>
        </div>

        <!-- repeating adverts -->
        <div class="w-full p-2 space-y-2">

            <div class="flex items-center justify-between">
                <div class="text-sm font-medium text-gray-900">Repeating adverts</div>
                <div class="text-xs text-gray-500">{{ advertRunningLabel }}</div>
            </div>

            <!-- what has actually gone out, not only what is set: a locked phone
                 stopped sending and this line alone went on saying running -->
            <div v-for="line of advertProgress" :key="line.kind" class="text-xs" :class="[ line.overdue ? 'text-amber-700' : 'text-gray-500' ]" :role="line.overdue ? 'status' : null">
                {{ line.text }}
            </div>

            <div v-if="wakeLockNote" class="text-xs" :class="[ wakeLockNote.warn ? 'text-amber-700' : 'text-gray-500' ]">
                {{ wakeLockNote.text }}
            </div>

            <div>
                <label for="zero-hop-advert-minutes" class="block mb-1 text-xs font-medium text-gray-900">Zero hop advert, every</label>
                <div class="flex items-center gap-2">
                    <input
                        id="zero-hop-advert-minutes"
                        v-model="zeroHopMinutes"
                        type="number"
                        min="0"
                        inputmode="numeric"
                        placeholder="off"
                        class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                    <span class="text-xs text-gray-500 shrink-0">minutes</span>
                </div>
            </div>

            <div>
                <label for="flood-advert-minutes" class="block mb-1 text-xs font-medium text-gray-900">Flood routed advert, every</label>
                <div class="flex items-center gap-2">
                    <input
                        id="flood-advert-minutes"
                        v-model="floodMinutes"
                        type="number"
                        min="0"
                        inputmode="numeric"
                        placeholder="off"
                        class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">
                    <span class="text-xs text-gray-500 shrink-0">minutes</span>
                </div>
            </div>

            <div v-if="floodTooFast" role="status" class="text-xs text-amber-700">
                Every repeater that hears a flood advert rebroadcasts it, so this one is paid for by
                the whole mesh. Under {{ floodCautionMinutes }} minutes is worth a second thought.
            </div>

            <button
                @click="saveAdvertSchedule"
                :disabled="busy"
                type="button"
                class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 font-medium rounded-lg text-xs px-3 py-2">Apply advert schedule</button>

            <div class="text-xs text-gray-500">
                Leave blank or set 0 to turn one off. Kept per node and restarted when it reconnects.
                Nothing is sent the moment you apply: the first one goes out after a full interval.
            </div>

        </div>

        <div v-if="notConnected" role="status" class="p-2 text-xs text-red-600">
            No radio connected, so nothing can be changed.
        </div>

        <div v-if="message" role="status" class="p-2 text-xs text-green-700">{{ message }}</div>
        <div v-if="error" role="status" class="p-2 text-xs text-red-600">{{ error }}</div>

    </div>
</template>

<script>
import GlobalState from "../../js/GlobalState.js";
import Connection from "../../js/Connection.js";
import EmcommMode from "../../js/EmcommMode.js";
import AdvertSchedule from "../../js/AdvertSchedule.js";
import ModeProfiles from "../../js/modes/ModeProfiles.js";
import Utils from "../../js/Utils.js";

export default {
    name: 'EmcommSettingsGroup',
    props: {
        // inside a settings section, which supplies the heading
        bare: {
            type: Boolean,
            default: false,
        },
    },
    data() {
        return {
            busy: false,
            message: null,
            error: null,
            driftSeconds: null,
            zeroHopMinutes: "",
            floodMinutes: "",
            // ticks so last-sent and overdue stay current while the page is open
            now: Date.now(),
            ticker: null,
        };
    },
    mounted() {
        this.loadAdvertSchedule();
        this.readDrift();
        this.ticker = setInterval(() => { this.now = Date.now(); }, 5000);
    },
    beforeUnmount() {
        clearInterval(this.ticker);
    },
    methods: {

        loadAdvertSchedule() {
            const schedule = AdvertSchedule.get(this.nodePublicKey);
            // zero means off, and an off field should read as empty rather than as
            // a zero somebody might take for a real interval
            this.zeroHopMinutes = schedule.zeroHopMinutes === 0 ? "" : String(schedule.zeroHopMinutes);
            this.floodMinutes = schedule.floodMinutes === 0 ? "" : String(schedule.floodMinutes);
        },

        saveAdvertSchedule() {

            this.message = null;
            this.error = null;

            const saved = AdvertSchedule.set(this.nodePublicKey, {
                zeroHopMinutes: this.zeroHopMinutes,
                floodMinutes: this.floodMinutes,
            });

            // read back what was stored, so a clamped or rejected value shows in the
            // field rather than leaving the operator believing the number they typed
            this.zeroHopMinutes = saved.zeroHopMinutes === 0 ? "" : String(saved.zeroHopMinutes);
            this.floodMinutes = saved.floodMinutes === 0 ? "" : String(saved.floodMinutes);

            AdvertSchedule.start(this.nodePublicKey);

            const parts = [];
            if(saved.zeroHopMinutes > 0){
                parts.push(`zero hop every ${saved.zeroHopMinutes} min`);
            }
            if(saved.floodMinutes > 0){
                parts.push(`flood every ${saved.floodMinutes} min`);
            }

            this.message = parts.length === 0
                ? "Repeating adverts are off."
                : `Adverts scheduled: ${parts.join(", ")}.`;

        },

        async readDrift() {
            try {
                const time = await Connection.getDeviceTime();
                this.driftSeconds = time == null ? null : Math.abs(Math.floor(Date.now() / 1000) - time.epochSecs);
            } catch(e) {
                this.driftSeconds = null;
            }
        },

        async run(what, action, doneMessage = null) {

            this.busy = true;
            this.message = null;
            this.error = null;

            try {
                await action();
                // read back rather than assume: the device owns these values
                await Connection.loadSelfInfo(Connection.READ_TIMEOUT_MILLIS);
                this.message = doneMessage ?? `${what} done.`;
            } catch(e) {
                const reason = String(e?.message ?? e);
                this.error = reason === Connection.DISCONNECTED
                    ? "The radio disconnected, so nothing was changed."
                    : `${what} failed: ${reason}`;
            } finally {
                this.busy = false;
            }

        },

        setMaxPower() {
            const power = this.current.maxTxPower;
            return this.run("Transmit power", () => EmcommMode.applySettings({ txPower: power })
                .then((r) => {
                    if(r.failures.length) throw new Error(r.failures[0].reason);
                    // into the mode in use, or coming home puts the old power back
                    ModeProfiles.noteRadioSettings({ txPower: power });
                }));
        },

        setPositionFromGps() {
            return this.run("Position", () => EmcommMode.applySettings({ setPositionFromGps: true })
                .then((r) => { if(r.failures.length) throw new Error(r.failures[0].reason); }));
        },

        async syncClock() {
            await this.run("Clock sync", () => Connection.syncDeviceTime());
            await this.readDrift();
        },

        toggleLocationSharing() {
            const turningOn = this.sharing !== "all";
            return this.run(
                "Location sharing",
                () => EmcommMode.setLocationSharing(turningOn)
                    .then(() => ModeProfiles.noteRadioSettings({ shareLocation: turningOn })),
                turningOn ? "Location is shared with any station that asks." : "Location is no longer shared.",
            );
        },

        toggleManualAdd() {
            const turningOff = this.current.manualAddContacts !== 1;
            return this.run(
                "Automatic contacts",
                () => EmcommMode.setManualAddContacts(turningOff)
                    .then(() => ModeProfiles.noteRadioSettings({ autoAddContacts: !turningOff })),
                turningOff ? "Contacts are no longer added automatically." : "Contacts are added automatically again.",
            );
        },

    },
    computed: {

        current() {
            return GlobalState.selfInfo ?? {};
        },

        sharing() {
            return EmcommMode.locationSharing(GlobalState.selfInfo);
        },

        sharingLabel() {
            return { all: "On, anyone", flagged: "Flagged contacts only", off: "Off" }[this.sharing];
        },

        notConnected() {
            return GlobalState.connection == null;
        },

        nodePublicKey() {
            const key = GlobalState.selfInfo?.publicKey;
            return key == null ? null : Utils.bytesToHex(key);
        },

        inEmcommMode() {
            // read so this recomputes when the mode changes: the mode is kept in
            // browser storage, which the page cannot watch
            GlobalState.emcommModeRevision;
            void ModeProfiles.state.revision;
            return this.nodePublicKey != null && ModeProfiles.current(this.nodePublicKey) !== "normal";
        },

        modeLabel() {
            GlobalState.emcommModeRevision;
            void ModeProfiles.state.revision;
            return ModeProfiles.label(this.nodePublicKey == null ? "normal" : ModeProfiles.current(this.nodePublicKey));
        },

        floodCautionMinutes() {
            return AdvertSchedule.FLOOD_CAUTION_MINUTES;
        },

        floodTooFast() {
            return AdvertSchedule.isFloodTooFast(this.floodMinutes);
        },

        advertRunningLabel() {
            // read from reactive state rather than from the timers themselves: a
            // computed with no reactive dependency never recomputes, and this one
            // sat on "Off" while the radio adverted every minute
            const running = GlobalState.advertScheduleRunning;
            if(running.length === 0){
                return "Off";
            }
            return running.map((kind) => kind === "flood" ? "Flood" : "Zero hop").join(" and ") + " running";
        },

        advertProgress() {

            const lines = [];
            const time = (t) => new Date(t).toLocaleTimeString();

            for(const kind of GlobalState.advertScheduleRunning){

                const label = kind === "flood" ? "Flood" : "Zero hop";
                const last = GlobalState.advertLastSent?.[kind] ?? null;
                const due = AdvertSchedule.nextDue(kind);

                if(AdvertSchedule.isOverdue(kind, this.now)){
                    lines.push({
                        kind,
                        overdue: true,
                        text: last == null
                            ? `${label}: overdue, none sent since ${time(GlobalState.advertStartedAt)}. A locked screen or a backgrounded app stops adverts until it is back on screen.`
                            : `${label}: overdue, last sent ${time(last)}. A locked screen or a backgrounded app stops adverts until it is back on screen.`,
                    });
                    continue;
                }

                lines.push({
                    kind,
                    overdue: false,
                    text: last == null
                        ? `${label}: first due ${due == null ? "soon" : time(due)}`
                        : `${label}: last sent ${time(last)}`,
                });

            }

            return lines;

        },

        wakeLockNote() {
            switch(GlobalState.advertWakeLock){
                case "held":
                    return { warn: false, text: "The screen is kept on while adverts are scheduled. Pressing the power button still stops them." };
                case "waiting":
                    return { warn: false, text: "The screen will be kept on again when the app is back in view." };
                case "unsupported":
                    return { warn: true, text: "This browser cannot keep the screen on. On a phone, adverts stop when the screen locks." };
                case "failed":
                    return { warn: true, text: "The browser refused to keep the screen on. On a phone, adverts stop when the screen locks." };
                default:
                    return null;
            }
        },

        positionLabel() {
            const lat = this.current.advLat ?? 0;
            const lon = this.current.advLon ?? 0;
            // zero is how a node with no position reports, and it is a real place
            // in the Gulf of Guinea, so it is named as unset rather than shown
            if(lat === 0 && lon === 0){
                return "Not set";
            }
            return `${(lat / 1000000).toFixed(4)}, ${(lon / 1000000).toFixed(4)}`;
        },

        driftLabel() {
            if(this.driftSeconds == null){
                return "Unknown";
            }
            return this.driftSeconds < 2 ? "In step" : `${this.driftSeconds}s out`;
        },

    },
}
</script>
