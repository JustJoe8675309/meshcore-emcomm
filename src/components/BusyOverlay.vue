<template>
    <!-- covers the page while the radio is being set up or rewritten. Pressing
         things underneath does no good then: a half connected radio has no
         contacts to show yet, and a second command sent in the middle of a restore
         queues behind it and makes the wait longer -->
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4">
        <div role="status" aria-live="polite" class="w-full max-w-sm bg-white rounded-lg shadow-lg p-4 space-y-3">

            <div class="flex items-center space-x-3">
                <svg class="size-6 shrink-0 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"/>
                </svg>
                <div class="text-sm font-semibold text-gray-900">{{ title }}</div>
            </div>

            <div v-if="step" class="text-sm text-gray-700 break-words">{{ step }}</div>

            <div v-if="hasProgress" class="space-y-1">
                <div class="h-2 w-full rounded bg-gray-200 overflow-hidden">
                    <div class="h-2 bg-blue-600 transition-all" :style="{ width: percent + '%' }"></div>
                </div>
                <div class="text-xs text-gray-500">{{ done }} of {{ total }}</div>
            </div>

            <div v-if="note" class="text-xs text-gray-500">{{ note }}</div>

            <button
                v-if="cancelLabel"
                @click="$emit('cancel')"
                type="button"
                class="w-full bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg px-5 py-2">
                {{ cancelLabel }}
            </button>

        </div>
    </div>
</template>

<script>
export default {
    name: 'BusyOverlay',
    emits: ['cancel'],
    props: {
        title: {
            type: String,
            required: true,
        },
        // what is happening right now, in words
        step: {
            type: String,
            default: null,
        },
        // a count, when the step has one to give
        done: {
            type: Number,
            default: null,
        },
        total: {
            type: Number,
            default: null,
        },
        note: {
            type: String,
            default: null,
        },
        // a way out, for waits the operator may reasonably give up on
        cancelLabel: {
            type: String,
            default: null,
        },
    },
    computed: {
        hasProgress() {
            return this.done != null && this.total != null && this.total > 0;
        },
        percent() {
            return Math.min(100, Math.round((this.done / this.total) * 100));
        },
    },
}
</script>
