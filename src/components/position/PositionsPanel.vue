<template>
    <div class="relative w-full overflow-y-auto">
        <div class="p-3 space-y-3">

            <!-- this station, which distance and bearing are measured from -->
            <div class="bg-white border border-gray-300 rounded-lg p-3 space-y-1">
                <div class="text-sm font-medium text-gray-900">This station</div>
                <template v-if="own.has">
                    <div class="text-xs text-gray-800">{{ formatDegrees(own.latitude, own.longitude) }}</div>
                    <div v-if="formatMgrs(own.latitude, own.longitude)" class="text-xs text-gray-800">{{ formatMgrs(own.latitude, own.longitude) }}</div>
                    <div class="text-xs text-gray-500">{{ own.live ? "Live GPS fix" : "Position set on the radio, not a live fix" }}</div>
                </template>
                <div v-else class="text-xs text-amber-800">
                    Your radio has no position set, so distances and bearings cannot be worked out.
                </div>
                <div v-if="!modelCurrent" class="text-xs text-red-700">
                    The magnetic model ({{ modelName }}) has passed its end date, so bearings may be a degree
                    or more out. The app needs updating with the next model.
                </div>
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
                        {{ request.via.kind === "channel" ? `On ${request.via.name}` : "Direct" }},
                        {{ modeLabel(request.mode) }}. {{ request.sent }} sent<span v-if="request.lastSentAt">, last at {{ time(request.lastSentAt) }}</span>.
                    </div>
                    <div v-if="request.status === 'running' && request.nextAt" class="text-xs text-gray-600">
                        Next at {{ time(request.nextAt) }}.
                    </div>
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
                    None yet. Ask a station for its position from the menu beside it in Contacts. Positions
                    other stations send on your channels appear here too.
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
                        <div class="text-xs text-gray-800">{{ formatDegrees(report.latitude, report.longitude) }}</div>
                        <div v-if="formatMgrs(report.latitude, report.longitude)" class="text-xs text-gray-800">{{ formatMgrs(report.latitude, report.longitude) }}</div>
                        <template v-if="relation(report)">
                            <div class="text-sm text-gray-900">
                                {{ formatDistance(relation(report).metres) }}, <span class="font-semibold">{{ formatBearing(relation(report).magneticBearing) }}</span>
                            </div>
                            <div class="text-xs text-gray-500">{{ formatDeclination(relation(report).declination) }}</div>
                        </template>
                        <div v-else class="text-xs text-gray-500">No distance or bearing: this station has no position.</div>
                        <div class="text-xs text-gray-500">{{ fixLabel(report) }}</div>
                    </template>

                    <div v-else class="text-xs text-amber-800">Answered, but has no position set.</div>

                    <!-- the newest word was a decline or no position: keep where it was last known to be -->
                    <div v-if="lastKnown(report)" class="border-l-2 border-gray-200 pl-2 space-y-0.5">
                        <div class="text-xs text-gray-600">Last known position, {{ time(lastKnown(report).receivedAt) }}</div>
                        <div class="text-xs text-gray-800">{{ formatDegrees(lastKnown(report).latitude, lastKnown(report).longitude) }}</div>
                        <div v-if="formatMgrs(lastKnown(report).latitude, lastKnown(report).longitude)" class="text-xs text-gray-800">{{ formatMgrs(lastKnown(report).latitude, lastKnown(report).longitude) }}</div>
                        <div v-if="relation(lastKnown(report))" class="text-xs text-gray-900">
                            {{ formatDistance(relation(lastKnown(report)).metres) }}, {{ formatBearing(relation(lastKnown(report)).magneticBearing) }}
                        </div>
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

export default {
    name: 'PositionsPanel',
    data() {
        return {
            // distances follow this station's position; a tick keeps fix ages current
            now: Date.now(),
            ticker: null,
        };
    },
    mounted() {
        this.ticker = setInterval(() => { this.now = Date.now(); }, 15000);
    },
    beforeUnmount() {
        clearInterval(this.ticker);
    },
    methods: {
        stop(tag) {
            PositionService.stop(tag);
        },
        dismiss(tag) {
            PositionService.dismiss(tag);
        },
        time(millis) {
            return new Date(millis).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        },
        lastKnown(report) {
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
            if(!report.liveFix || !report.fixTime){
                return "Position set on its radio, not a live fix";
            }
            const minutes = Math.max(0, Math.round((this.now / 1000 - report.fixTime) / 60));
            return minutes < 1 ? "Live GPS fix, just now" : `Live GPS fix, ${minutes} min old`;
        },
        sourceLabel(report) {
            const where = report.via.kind === "channel" ? `on ${report.via.name}` : "direct";
            if(report.source === "radio"){
                return `From its radio's telemetry, ${where}. Its app did not answer.`;
            }
            return report.requestedByUs ? `Answer to your request, ${where}` : `Heard ${where}`;
        },
        modeLabel(mode) {
            if(mode.type === "until"){
                return `every ${mode.intervalMinutes} min until answered`;
            }
            if(mode.type === "count"){
                return `up to ${mode.maxCount} times every ${mode.intervalMinutes} min`;
            }
            return "once";
        },
        statusLabel(request) {
            return {
                running: "Waiting",
                answered: "Answered",
                declined: "Declined",
                "gave up": "No answer",
                stopped: "Stopped",
            }[request.status] ?? request.status;
        },
        statusClass(request) {
            return {
                running: "text-blue-700",
                answered: "text-green-700",
                declined: "text-amber-800",
                "gave up": "text-red-700",
                stopped: "text-gray-500",
            }[request.status] ?? "text-gray-500";
        },
    },
    computed: {
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
