<template>
    <div class="relative w-full overflow-y-auto">
        <div class="p-3 space-y-3">

            <!-- this station, which distance and bearing are measured from -->
            <div class="bg-white border border-gray-300 rounded-lg p-3 space-y-1">
                <div class="text-sm font-medium text-gray-900">This station</div>
                <template v-if="own.has">
                    <div class="text-xs text-gray-800"><MapLink :latitude="own.latitude" :longitude="own.longitude" :text="formatDegrees(own.latitude, own.longitude)" label="This station"/></div>
                    <div v-if="formatMgrs(own.latitude, own.longitude)" class="text-xs text-gray-800"><MapLink :latitude="own.latitude" :longitude="own.longitude" :text="formatMgrs(own.latitude, own.longitude)" label="This station"/></div>
                    <div class="text-xs text-gray-500">{{ own.live ? "Live GPS fix" : "Position set on the radio, not a live fix" }}</div>
                </template>
                <div v-else class="text-xs text-amber-800">
                    Your radio has no position set, so distances and bearings cannot be worked out.
                </div>
                <div v-if="!modelCurrent" class="text-xs text-red-700">
                    The magnetic model ({{ modelName }}) has passed its end date, so bearings may be a degree
                    or more out. The app needs updating with the next model.
                </div>

                <!-- bring the position up to date: the GPS first, and where there is
                     no fix, whatever the operator can say themselves -->
                <button
                    v-if="!updating"
                    @click="updatePosition"
                    :disabled="busy || notConnected"
                    type="button"
                    class="w-full bg-white hover:bg-gray-50 disabled:opacity-60 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg px-3 py-2">
                    {{ busy ? "Checking the GPS..." : "Update position" }}
                </button>

                <div v-else class="border border-amber-300 rounded p-2 space-y-2">
                    <div class="text-xs text-gray-700">
                        <span class="font-semibold">{{ gpsNote }}</span>
                        Where you are now, saved to the radio as its position and used until it changes.
                    </div>

                    <PositionEntry
                        :mode="entryMode"
                        :latitude="entryLatitude"
                        :longitude="entryLongitude"
                        :mgrs-text="entryMgrsText"
                        :position="entryPosition"
                        :invalid="entryInvalid"
                        @mode="setEntryMode"
                        @latitude="entryLatitude = $event"
                        @longitude="entryLongitude = $event"
                        @mgrs-text="entryMgrsText = $event"/>

                    <div class="flex space-x-2">
                        <button @click="cancelUpdate" :disabled="busy" type="button"
                            class="w-full bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg px-3 py-2">Cancel</button>
                        <button @click="saveUpdate" :disabled="busy || entryPosition == null" type="button"
                            class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium rounded-lg px-3 py-2">Save to radio</button>
                    </div>
                </div>

                <div v-if="updateMessage" role="status" class="text-xs text-gray-600">{{ updateMessage }}</div>
                <div v-if="updateError" role="status" class="text-xs text-red-600">{{ updateError }}</div>
            </div>

            <!-- requests this station is making -->
            <div v-if="requests.length > 0" class="bg-white border border-gray-300 rounded-lg divide-y">
                <div class="p-3 text-sm font-medium text-gray-900">Requests</div>
                <div v-for="request of requests" :key="request.tag" class="p-3 space-y-1">
                    <div class="flex items-center justify-between">
                        <div class="text-sm font-semibold text-gray-900">{{ request.target.name }}</div>
                        <div class="text-xs" :class="statusClass(request)">{{ statusLabel(request) }}</div>
                    </div>
                    <div class="text-xs text-gray-600">
                        {{ capitalise(viaLabel(request.via)) }},
                        {{ modeLabel(request) }}. {{ request.sent }} sent<span v-if="request.lastSentAt">, last at {{ time(request.lastSentAt) }}</span>.
                    </div>
                    <div v-if="request.status === 'running' && request.nextAt" class="text-xs text-gray-600">
                        Next at {{ time(request.nextAt) }}.
                    </div>
                    <div v-else-if="request.group && request.status === 'running' && request.listenUntil" class="text-xs text-gray-600">
                        Listening for answers until {{ time(request.listenUntil) }}.
                    </div>

                    <!-- a roll call's answers, in the round being asked -->
                    <template v-if="request.group">
                        <div class="text-xs text-gray-600">
                            <template v-if="request.rounds.length > 1">Round {{ request.rounds.length }}: </template>
                            {{ roundAnswers(request).length }} answered<template v-if="roundAnswers(request).length > 0">:</template>
                        </div>
                        <div v-for="answer of roundAnswers(request)" :key="answer.fromPrefixHex" class="pl-2 border-l-2 border-gray-200 text-xs">
                            <span class="font-semibold text-gray-900">{{ answer.name }}</span>
                            <span v-if="answer.nodeName && answer.nodeName !== answer.name" class="ml-1 text-gray-500">· {{ answer.nodeName }}</span>
                            <span class="ml-1 text-gray-800">{{ answerSummary(answer) }}</span>
                            <span v-if="answer.late" class="ml-1 text-gray-500">(after it closed)</span>
                        </div>
                    </template>

                    <div v-if="request.outcome" class="text-xs text-gray-800">{{ request.outcome }}</div>
                    <div v-if="request.radioNote && request.status !== 'answered'" class="text-xs text-gray-600">{{ request.radioNote }}</div>
                    <div v-if="request.error" class="text-xs text-red-600">Last request not sent: {{ request.error }}</div>
                    <div class="pt-1">
                        <button
                            v-if="request.status === 'running'"
                            @click="stop(request.tag)"
                            type="button"
                            class="w-full bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg px-3 py-2">
                            Stop
                        </button>
                        <button
                            v-else
                            @click="dismiss(request.tag)"
                            type="button"
                            class="w-full bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg px-3 py-2">
                            Dismiss
                        </button>
                    </div>
                </div>
            </div>

            <!-- what has come back, newest per station -->
            <div class="bg-white border border-gray-300 rounded-lg divide-y">
                <div class="p-3 text-sm font-medium text-gray-900">Positions</div>
                <div v-if="reports.length === 0" class="p-3 text-xs text-gray-500">
                    None yet. Ask a station for its position from the menu beside it in Contacts, or everyone
                    on a channel or in a room from its menu. Positions other stations send on your channels
                    appear here too.
                </div>
                <div v-for="report of reports" :key="report.id" class="p-3 space-y-1">
                    <div class="flex items-center justify-between">
                        <div class="text-sm font-semibold text-gray-900">
                            {{ report.name }}
                            <span v-if="report.nodeName && report.nodeName !== report.name" class="font-normal text-gray-500">· {{ report.nodeName }}</span>
                        </div>
                        <div class="text-xs text-gray-500">{{ time(report.receivedAt) }}</div>
                    </div>

                    <div v-if="report.source === 'declined'" class="text-sm text-amber-800">
                        Declined by {{ report.name }}
                    </div>

                    <template v-else-if="report.hasPosition">
                        <div class="text-xs text-gray-800"><MapLink :latitude="report.latitude" :longitude="report.longitude" :text="formatDegrees(report.latitude, report.longitude)" :label="report.name"/></div>
                        <div v-if="formatMgrs(report.latitude, report.longitude)" class="text-xs text-gray-800"><MapLink :latitude="report.latitude" :longitude="report.longitude" :text="formatMgrs(report.latitude, report.longitude)" :label="report.name"/></div>
                        <template v-if="relation(report)">
                            <!-- a bearing between two points a few metres apart means nothing -->
                            <div v-if="relation(report).sameLocation" class="text-sm text-gray-900">Same location as this station</div>
                            <template v-else>
                                <div class="text-sm text-gray-900">
                                    {{ formatDistance(relation(report).metres) }}, <span class="font-semibold">{{ formatBearing(relation(report).magneticBearing) }}</span>
                                </div>
                                <div class="text-xs text-gray-500">{{ formatDeclination(relation(report).declination) }}</div>
                            </template>
                        </template>
                        <div v-else class="text-xs text-gray-500">No distance or bearing: this station has no position.</div>
                        <div class="text-xs" :class="report.lastKnown ? 'font-semibold text-amber-800' : 'text-gray-500'">{{ fixLabel(report) }}</div>
                    </template>

                    <div v-else class="text-xs text-amber-800">Answered, but has no position set.</div>

                    <!-- the newest word was a decline or no position: keep where it last reported being -->
                    <div v-if="previous(report)" class="border-l-2 border-gray-200 pl-2 space-y-0.5">
                        <div class="text-xs text-gray-600">Last position received, {{ time(previous(report).receivedAt) }}</div>
                        <div class="text-xs text-gray-800"><MapLink :latitude="previous(report).latitude" :longitude="previous(report).longitude" :text="formatDegrees(previous(report).latitude, previous(report).longitude)" :label="report.name"/></div>
                        <div v-if="formatMgrs(previous(report).latitude, previous(report).longitude)" class="text-xs text-gray-800"><MapLink :latitude="previous(report).latitude" :longitude="previous(report).longitude" :text="formatMgrs(previous(report).latitude, previous(report).longitude)" :label="report.name"/></div>
                        <div v-if="relation(previous(report))" class="text-xs text-gray-900">
                            <template v-if="relation(previous(report)).sameLocation">Same location as this station</template>
                            <template v-else>{{ formatDistance(relation(previous(report)).metres) }}, {{ formatBearing(relation(previous(report)).magneticBearing) }}</template>
                        </div>
                        <div class="text-xs text-gray-500">{{ fixLabel(previous(report)) }}</div>
                    </div>

                    <div v-if="report.messageToFollow" class="text-xs font-semibold text-blue-700">Message to follow</div>
                    <div class="text-xs text-gray-500">{{ sourceLabel(report) }}</div>
                </div>
            </div>

        </div>
    </div>
</template>

<script>
import PositionService from "../../js/position/PositionService.js";
import Geo from "../../js/position/Geo.js";
import MagneticModel from "../../js/position/MagneticModel.js";
import MapLink from "./MapLink.vue";
import PositionEntry from "./PositionEntry.vue";
import Mgrs from "../../js/position/Mgrs.js";
import GlobalState from "../../js/GlobalState.js";

export default {
    name: 'PositionsPanel',
    components: {
        MapLink,
        PositionEntry,
    },
    data() {
        return {
            // distances follow this station's position; a tick keeps fix ages current
            now: Date.now(),
            ticker: null,
            // updating this station's own position: the GPS first, then by hand
            busy: false,
            updating: false,
            gpsNote: "",
            updateMessage: null,
            updateError: null,
            entryMode: "degrees",
            entryLatitude: "",
            entryLongitude: "",
            entryMgrsText: "",
        };
    },
    mounted() {
        this.ticker = setInterval(() => { this.now = Date.now(); }, 15000);
    },
    beforeUnmount() {
        clearInterval(this.ticker);
    },
    methods: {
        /**
         * Tries the GPS, and falls back to asking the operator.
         *
         * The GPS is tried every time rather than trusting what was found at
         * connect: a receiver with no fix then may have one now, which is the
         * normal case for one still getting its first lock.
         */
        async updatePosition() {
            this.busy = true;
            this.updateMessage = null;
            this.updateError = null;
            try {
                const result = await PositionService.updateFromGps();
                if(result.updated){
                    this.updateMessage = `Updated from the GPS at ${this.time(Date.now())}.`;
                    this.now = Date.now();
                    return;
                }
                // no fix, so the operator says where they are. Prefilled with what
                // the radio holds, which is usually close
                this.gpsNote = `There is ${result.reason}, so enter the position.`;
                this.entryMode = "degrees";
                this.entryLatitude = this.own.has ? this.own.latitude.toFixed(4) : "";
                this.entryLongitude = this.own.has ? this.own.longitude.toFixed(4) : "";
                this.entryMgrsText = this.own.has ? (Geo.formatMgrs(this.own.latitude, this.own.longitude) ?? "") : "";
                this.updating = true;
            } catch(e) {
                this.updateError = `Not updated: ${e?.message ?? e}`;
            } finally {
                this.busy = false;
            }
        },
        cancelUpdate() {
            this.updating = false;
            this.updateMessage = "The position was left as it was.";
        },
        async saveUpdate() {
            const position = this.entryPosition;
            if(position == null){
                return;
            }
            this.busy = true;
            this.updateError = null;
            try {
                await PositionService.saveManualPosition(position.latitude, position.longitude);
                this.updating = false;
                this.updateMessage = `Saved to the radio at ${this.time(Date.now())}. It is sent as entered by hand until the GPS takes over.`;
                this.now = Date.now();
            } catch(e) {
                this.updateError = `Not saved: ${e?.message ?? e}`;
            } finally {
                this.busy = false;
            }
        },
        setEntryMode(mode) {
            // carry the position across, so switching does not lose what was typed
            const position = this.entryPosition;
            if(position){
                if(mode === "mgrs"){
                    this.entryMgrsText = Geo.formatMgrs(position.latitude, position.longitude) ?? "";
                } else {
                    this.entryLatitude = position.latitude.toFixed(5);
                    this.entryLongitude = position.longitude.toFixed(5);
                }
            }
            this.entryMode = mode;
        },
        stop(tag) {
            PositionService.stop(tag);
        },
        dismiss(tag) {
            PositionService.dismiss(tag);
        },
        time(millis) {
            return new Date(millis).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        },
        previous(report) {
            if(report.source !== "declined" && report.hasPosition){
                return null;
            }
            return PositionService.lastPositionFrom(report.fromPrefixHex);
        },
        relation(report) {
            if(!this.own.has){
                return null;
            }
            return Geo.relation(this.own, report, new Date(this.now));
        },
        formatDegrees: (lat, lon) => Geo.formatDegrees(lat, lon),
        formatMgrs: (lat, lon) => Geo.formatMgrs(lat, lon),
        formatDistance: (metres) => Geo.formatDistance(metres),
        formatBearing: (degrees) => Geo.formatMagneticBearing(degrees),
        formatDeclination: (degrees) => Geo.formatDeclination(degrees),
        fixLabel(report) {
            if(report.manual){
                return report.fixTime
                    ? `Entered by hand at ${this.time(report.fixTime * 1000)}, not GPS`
                    : "Entered by hand, not GPS";
            }
            if(report.lastKnown){
                return "Last known position, not a current fix";
            }
            if(report.source === "radio"){
                return "From its radio's GPS, which does not say how current it is";
            }
            if(!report.liveFix || !report.fixTime){
                return "Position set on its radio, not a live fix";
            }
            const minutes = Math.max(0, Math.round((this.now / 1000 - report.fixTime) / 60));
            return minutes < 1 ? "Live GPS fix, just now" : `Live GPS fix, ${minutes} min old`;
        },
        viaLabel: (via) => PositionService.viaLabel(via),
        capitalise: (text) => text.charAt(0).toUpperCase() + text.slice(1),
        sourceLabel(report) {
            const where = PositionService.viaLabel(report.via);
            if(report.source === "radio"){
                return `From its radio's telemetry, ${where}. Its app did not answer.`;
            }
            if(report.shared){
                return `Sent to everyone ${where}, unasked`;
            }
            return report.requestedByUs ? `Answer to your request, ${where}` : `Heard ${where}`;
        },
        roundAnswers(request) {
            return PositionService.currentRound(request).answers;
        },
        // one line for a roll call answer: where, and how far, or why not
        answerSummary(answer) {
            if(answer.kind === "declined"){
                return "declined";
            }
            if(answer.kind === "none"){
                return "has no position set";
            }
            const report = PositionService.lastPositionFrom(answer.fromPrefixHex);
            if(report == null){
                return "answered";
            }
            const relation = this.relation(report);
            const where = Geo.formatDegrees(report.latitude, report.longitude);
            const fix = report.manual ? ", entered by hand" : report.lastKnown ? ", last known" : "";
            if(relation == null){
                return `${where}${fix}`;
            }
            if(relation.sameLocation){
                return `${where}${fix}, same location`;
            }
            return `${where}${fix}, ${Geo.formatDistance(relation.metres)}, ${Geo.formatMagneticBearing(relation.magneticBearing)}`;
        },
        modeLabel(request) {
            const mode = request.mode;
            if(request.group){
                if(mode.type === "again"){
                    return `up to ${mode.maxCount} times every ${mode.intervalMinutes} min for stations not yet heard`;
                }
                if(mode.type === "track"){
                    return `${mode.maxCount} roll calls every ${mode.intervalMinutes} min`;
                }
                return "once";
            }
            if(mode.type === "until"){
                return `every ${mode.intervalMinutes} min until answered`;
            }
            if(mode.type === "count"){
                return `up to ${mode.maxCount} times every ${mode.intervalMinutes} min`;
            }
            return "once";
        },
        statusLabel(request) {
            if(request.group && request.status === "running"){
                return "Listening";
            }
            return {
                done: "Closed",
                running: "Waiting",
                answered: "Answered",
                declined: "Declined",
                "gave up": "No answer",
                stopped: "Stopped",
            }[request.status] ?? request.status;
        },
        statusClass(request) {
            return {
                done: "text-green-700",
                running: "text-blue-700",
                answered: "text-green-700",
                declined: "text-amber-800",
                "gave up": "text-red-700",
                stopped: "text-gray-500",
            }[request.status] ?? "text-gray-500";
        },
    },
    computed: {
        notConnected() {
            return GlobalState.connection == null;
        },
        // what the fields parse to, in either form, or null
        entryPosition() {
            if(!this.updating){
                return null;
            }
            if(this.entryMode === "mgrs"){
                const parsed = Mgrs.toLatLon(this.entryMgrsText);
                return parsed && PositionService.isValidEntry(parsed.latitude, parsed.longitude)
                    ? { latitude: parsed.latitude, longitude: parsed.longitude, precision: parsed.precisionMetres }
                    : null;
            }
            return PositionService.isValidEntry(this.entryLatitude, this.entryLongitude)
                ? { latitude: Number(this.entryLatitude), longitude: Number(this.entryLongitude), precision: null }
                : null;
        },
        entryTyped() {
            return this.entryMode === "mgrs"
                ? this.entryMgrsText.trim() !== ""
                : this.entryLatitude !== "" || this.entryLongitude !== "";
        },
        entryInvalid() {
            return this.updating && this.entryTyped && this.entryPosition == null;
        },
        own() {
            void this.now;
            return PositionService.ownPosition();
        },
        requests() {
            return PositionService.state.requests;
        },
        reports() {
            void PositionService.state.reports.length;
            return PositionService.latestByStation();
        },
        modelCurrent() {
            return MagneticModel.isValidOn(new Date(this.now));
        },
        modelName() {
            return MagneticModel.NAME;
        },
    },
}
</script>
