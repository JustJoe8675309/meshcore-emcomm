<template>
    <div class="bg-white border border-gray-300 rounded-lg p-3 space-y-2">

        <div class="flex items-center justify-between">
            <div class="text-sm font-medium text-gray-900">Transmission preview</div>
            <div class="text-xs" :class="[ parts === null ? 'text-red-600' : 'text-gray-500' ]">
                {{ summary }}
            </div>
        </div>

        <div v-if="parts === null" class="text-xs text-red-600">
            This report cannot be split into sendable packets. Shorten it, or set a shorter device name in Settings.
        </div>

        <div v-else-if="parts.length === 0" class="text-xs text-gray-500">
            Fill in the form to see what will be sent.
        </div>

        <div v-else class="space-y-1">
            <!-- exactly what goes over the air, one block per transmission -->
            <div
                v-for="(part, index) of parts"
                :key="index"
                class="bg-gray-50 border border-gray-200 rounded p-2 text-xs text-gray-800"
                style="white-space:pre-wrap;word-break:break-word;">{{ part }}</div>
            <div v-if="parts.length > 1" class="text-xs text-gray-500">
                <template v-if="isContact">
                    Sent as {{ parts.length }} separate messages, each one after the previous is acknowledged.
                </template>
                <template v-else>
                    Sent as {{ parts.length }} separate messages, about {{ partDelaySeconds }} seconds apart.
                </template>
            </div>
        </div>

    </div>
</template>

<script>
export default {
    name: 'TransmissionPreview',
    props: {
        // the messages that will be transmitted, or null when the report cannot be split
        parts: {
            type: Array,
            default: null,
        },
        // byte count, packet count and estimated airtime
        summary: {
            type: String,
            default: "",
        },
        partDelaySeconds: {
            type: Number,
            default: 0,
        },
        // direct messages are acknowledged one at a time, so the parts are paced by the
        // acknowledgement rather than by a fixed gap
        isContact: {
            type: Boolean,
            default: false,
        },
    },
}
</script>
