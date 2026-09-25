<template>
    <div class="space-y-1">

        <div class="flex items-center justify-between">
            <div class="text-xs font-medium text-gray-900">Repeating adverts</div>
            <div class="text-xs text-gray-500">{{ advertRunningLabel }}</div>
        </div>

        <!-- what has actually gone out, not only what is set: a locked phone
             stopped sending and the running label alone went on saying running -->
        <div v-for="line of advertProgress" :key="line.kind" class="text-xs" :class="[ line.overdue ? 'text-amber-700' : 'text-gray-500' ]" :role="line.overdue ? 'status' : null">
            {{ line.text }}
        </div>

        <div v-if="wakeLockNote" class="text-xs" :class="[ wakeLockNote.warn ? 'text-amber-700' : 'text-gray-500' ]">
            {{ wakeLockNote.text }}
        </div>

    </div>
</template>

<script>
/**
 * What the repeating adverts have actually done, beside the fields that set them.
 *
 * The intervals belong to the mode, and saving the mode in use applies them. This
 * is the other half and cannot be a setting: whether anything is really going
 * out. A phone with a locked screen stops sending and says nothing about it, so
 * "Zero hop running" was true and useless at the same time. These lines are read
 * from the state the scheduler writes, not from the timers, because a computed
 * with no reactive dependency never recomputes — this one sat on "Off" while the
 * radio adverted every minute.
 */
import GlobalState from "../../js/GlobalState.js";
import AdvertSchedule from "../../js/AdvertSchedule.js";

export default {
    name: 'AdvertProgressGroup',
    data() {
        return {
            // ticks so last-sent and overdue stay current while the page is open
            now: Date.now(),
            ticker: null,
        };
    },
    mounted() {
        this.ticker = setInterval(() => { this.now = Date.now(); }, 5000);
    },
    beforeUnmount() {
        clearInterval(this.ticker);
    },
    computed: {

        advertRunningLabel() {
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

    },
};
</script>
