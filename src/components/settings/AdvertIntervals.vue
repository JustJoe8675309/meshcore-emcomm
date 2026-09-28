<template>
    <div class="space-y-2">

        <div class="pt-1 text-xs text-gray-700">Repeating adverts, in minutes. 0 turns one off.</div>

        <div class="grid grid-cols-2 gap-2">
            <label class="block text-xs text-gray-700">Zero hop
                <input v-model.number="adverts.zeroHopMinutes" type="number" min="0" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
            </label>
            <label class="block text-xs text-gray-700">Flood
                <input v-model.number="adverts.floodMinutes" type="number" min="0" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
            </label>
        </div>

        <!-- A zero hop advert is heard by whoever is in earshot and goes no further.
             A flood advert is rebroadcast by every repeater that hears it, so a short
             interval is not this station spending its own airtime, it is this station
             spending the whole mesh's. The operator setting it cannot see that cost
             from here, which is why it is said rather than left to be learned.

             The warning existed in the old emcomm settings panel and was lost when
             that panel was dismantled into the mode tabs at 71f1d52. The check and
             its tests survived; only the screen that showed it went. Found on the
             bench on 27 Sep by setting a flood interval of 30 minutes and getting
             nothing back. -->
        <div v-if="floodTooFast" role="status" class="text-xs text-amber-700">
            Every repeater that hears a flood advert rebroadcasts it, so this one is paid for by
            the whole mesh. Under {{ cautionMinutes }} minutes is worth a second thought.
        </div>

    </div>
</template>

<script>
import AdvertSchedule from "../../js/AdvertSchedule.js";

export default {
    name: 'AdvertIntervals',
    props: {
        // the mode profile's or net default's { zeroHopMinutes, floodMinutes }, edited
        // in place: both callers own the object and save it themselves
        adverts: {
            type: Object,
            required: true,
        },
    },
    computed: {
        cautionMinutes() {
            return AdvertSchedule.FLOOD_CAUTION_MINUTES;
        },
        floodTooFast() {
            return AdvertSchedule.isFloodTooFast(this.adverts?.floodMinutes);
        },
    },
}
</script>
