<template>
    <button :disabled="isSaving || disabled" type="button" class="text-white font-semibold px-2 py-1 rounded shadow" :class="[ isSaving || disabled ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700' ]">
        <span v-if="isSaving">Saving...</span>
        <span v-else>Save</span>
    </button>
</template>

<script>
export default {
    name: 'SaveButton',
    props: {
        isSaving: Boolean,
        // not saving, but there is nothing safe to save yet
        disabled: Boolean,
    },
}
</script>
