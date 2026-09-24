<template>
    <div class="bg-white">

        <button @click="open = !open" type="button"
                :aria-expanded="open ? 'true' : 'false'"
                class="w-full flex items-center justify-between p-2 text-left hover:bg-gray-50">
            <span>
                <span class="font-semibold text-gray-900">{{ title }}</span>
                <span v-if="note" class="block text-xs text-gray-500">{{ note }}</span>
            </span>
            <span class="shrink-0 ml-2 text-gray-500" aria-hidden="true">
                <svg v-if="open" viewBox="0 0 20 20" fill="currentColor" class="size-5">
                    <path fill-rule="evenodd" d="M14.77 12.79a.75.75 0 0 1-1.06-.02L10 8.832 6.29 12.77a.75.75 0 1 1-1.08-1.04l4.25-4.5a.75.75 0 0 1 1.08 0l4.25 4.5a.75.75 0 0 1-.02 1.06Z" clip-rule="evenodd"/>
                </svg>
                <svg v-else viewBox="0 0 20 20" fill="currentColor" class="size-5">
                    <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd"/>
                </svg>
            </span>
        </button>

        <div v-show="open" class="divide-y border-t">
            <slot/>
        </div>

    </div>
</template>

<script>
/**
 * One foldable group of settings.
 *
 * The settings page had grown to nine groups stacked end to end, several of them
 * editing the same value under different headings, and two called "Emcomm" and
 * "EMCOMM Settings" a few inches apart. Folding them does not fix the
 * duplication — that was fixed by merging the groups — but it does let the page
 * open as a list of names rather than a wall, which is what an operator wants
 * when they are looking for one thing.
 *
 * Open by default where the answer is usually wanted, shut where it is not, and
 * the choice is not remembered: the operator's last visit is a worse guide than
 * the reason they came back.
 */
export default {
    name: 'SettingsSection',
    props: {
        title: {
            type: String,
            required: true,
        },
        // one line under the title, for saying what the group is for
        note: {
            type: String,
            default: null,
        },
        openByDefault: {
            type: Boolean,
            default: false,
        },
    },
    data() {
        return {
            open: this.openByDefault,
        };
    },
};
</script>
