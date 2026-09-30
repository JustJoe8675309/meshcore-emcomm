<!--
    A menu option.

    It was a `div` with `cursor-pointer`: no role, no tabindex, no accessible name, so
    every menu in the app was mouse-only and a screen reader announced nothing at all.
    Found in the 28 Sep audit against the contacts filter and order menu, but this
    component is behind all five of them.

    A plain `button` rather than `role="menuitem"` on purpose. The ARIA menu roles come
    with a contract -- arrow-key navigation, focus management, Home and End -- and
    claiming the role without honouring it leaves a screen reader user pressing arrows
    that do nothing. Buttons in a container are what this actually is: reachable by Tab,
    activated by Enter or Space, announced with their own words.

    `w-full text-left` keeps it looking exactly as it did, since a button centres its
    content and shrinks to fit by default.
-->
<template>
    <button type="button" class="w-full text-left cursor-pointer flex p-3 space-x-2 text-sm text-gray-500 hover:bg-gray-100">
        <slot/>
    </button>
</template>

<script>
export default {
    name: 'DropDownMenuItem',
}
</script>
