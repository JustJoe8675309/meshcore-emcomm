<!--
    The whole connect, on one screen, in the order it happens.

    Asked for on 29 Sep, after watching node 2 come up over Bluetooth. It used to be a
    single line that replaced itself, which says what is happening now and nothing about
    how far through it is or what is still to come. "Checking for dropped contacts" sat
    there a long while with no way to tell whether that was most of the work or a
    fraction of it.

    **Where a step has no count, it gets no percentage.** A bar that has to move invites
    a made-up number, and a made-up number on this screen is the kind of thing an
    operator would later use to judge whether a radio is slow or broken. Those steps get
    a moving stripe that says "working" and claims nothing. Only a step the radio gives
    a count for shows one.

    A step that did not run is greyed and says so rather than turning green: the way
    home is only recorded for a station in normal mode, and a green "complete" against
    something that never happened would be a lie an operator could act on.
-->
<template>

    <div class="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4">
        <div role="status" aria-live="polite"
             class="w-full max-w-md bg-white rounded-lg shadow-lg p-4 space-y-3 max-h-full overflow-y-auto">

            <div class="flex items-center space-x-3">
                <svg class="size-6 shrink-0 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"/>
                </svg>
                <div class="text-sm font-semibold text-gray-900">Connecting to the radio</div>
                <div class="ml-auto text-xs text-gray-500">{{ doneCount }} of {{ steps.length }}</div>
            </div>

            <ol class="space-y-2">
                <li v-for="item of steps" :key="item.key" class="space-y-1">

                    <div class="flex items-baseline justify-between space-x-2">
                        <span class="text-xs" :class="labelClass(item)">{{ item.detail ?? item.label }}</span>
                        <span v-if="item.total" class="text-[11px] text-gray-500 shrink-0 tabular-nums">
                            {{ item.done }} of {{ item.total }}
                        </span>
                    </div>

                    <!-- the bar. Blue while it works, green when it is done, with the
                         word in the middle of it rather than beside it -->
                    <div class="relative h-4 w-full rounded bg-gray-200 overflow-hidden">
                        <div class="absolute inset-y-0 left-0 transition-all duration-300"
                             :class="barClass(item)"
                             :style="{ width: width(item) }"></div>

                        <div class="absolute inset-0 flex items-center justify-center">
                            <span class="text-[10px] font-semibold tracking-wide"
                                  :class="item.status === 'done' ? 'text-white' : 'text-gray-700'">
                                {{ middle(item) }}
                            </span>
                        </div>
                    </div>

                </li>
            </ol>

            <button @click="$emit('cancel')" type="button"
                    class="w-full bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg px-5 py-2">
                Disconnect
            </button>

        </div>
    </div>

</template>

<script>
export default {
    name: "ConnectSteps",
    emits: ["cancel"],
    props: {
        steps: {
            type: Array,
            required: true,
        },
    },
    computed: {
        doneCount() {
            return this.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
        },
    },
    methods: {

        /** A percentage, but only when the radio gave a count to work it out from. */
        percent(item) {
            if(!item.total || item.done == null){
                return null;
            }
            return Math.min(100, Math.max(0, Math.round((item.done / item.total) * 100)));
        },

        width(item) {
            if(item.status === "done"){
                return "100%";
            }
            if(item.status === "pending" || item.status === "skipped"){
                return "0%";
            }
            const percent = this.percent(item);
            // no count: a stripe that shows it is alive without claiming a position
            return percent == null ? "100%" : `${percent}%`;
        },

        barClass(item) {
            if(item.status === "done"){
                return "bg-green-600";
            }
            if(item.status !== "running"){
                return "bg-transparent";
            }
            return this.percent(item) == null
                ? "bg-blue-300 animate-pulse"
                : "bg-blue-600";
        },

        middle(item) {
            if(item.status === "done"){
                return "Complete";
            }
            if(item.status === "skipped"){
                return "Not needed";
            }
            if(item.status !== "running"){
                return "";
            }
            const percent = this.percent(item);
            return percent == null ? "Working" : `${percent}%`;
        },

        labelClass(item) {
            if(item.status === "done"){
                return "text-gray-500";
            }
            if(item.status === "skipped"){
                return "text-gray-400 line-through";
            }
            if(item.status === "running"){
                return "text-gray-900 font-medium";
            }
            return "text-gray-400";
        },

    },
};
</script>
