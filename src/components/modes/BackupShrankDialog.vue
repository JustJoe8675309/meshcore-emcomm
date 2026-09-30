<!--
    Asked at connect: this radio holds less than the way home records.

    The way home is refreshed on every normal-mode connect, deliberately -- it is how a
    channel added with another app becomes part of it, and node 3 lost a channel to a
    record three days old. But the refresh had no guard. On 29 Sep a round trip lost 42
    of the operator's contacts, the next connect wrote the diminished radio straight
    over the good record, and the evidence of the loss went with it. A later connect
    wrote over that too.

    So the refresh stays and the silent shrink goes. Nothing is written until this is
    answered, and the older record is what survives an operator who closes the tab.

    Keeping the record is the safe answer, not the right one: a radio genuinely handed
    on with fewer contacts should be recorded as it is, or the way home would put back
    contacts its owner deleted on purpose. The dialog says what each answer costs and
    lets the operator decide, because only they know which happened.
-->
<template>

    <div v-if="asking" class="fixed inset-0 z-50 flex bg-black/40 p-3 overflow-y-auto">
        <div role="dialog" aria-labelledby="backup-shrank-heading"
             class="m-auto w-full max-w-lg bg-white rounded-lg shadow-lg divide-y">

            <div class="p-3">
                <div id="backup-shrank-heading" class="font-semibold text-gray-900">
                    This radio holds less than the way home records
                </div>
            </div>

            <div class="p-3 space-y-2 text-sm text-gray-700">
                <p>
                    The record of this station's normal setup is
                    <span v-if="when">from {{ when }}</span><span v-else>older than this connection</span>, and the
                    radio has less on it now:
                </p>

                <ul class="list-disc pl-5 text-xs text-gray-700 space-y-0.5">
                    <li v-if="shrinkage.channelsLost > 0" class="text-red-700">
                        <span class="font-semibold">{{ shrinkage.channelsLost }}
                            {{ shrinkage.channelsLost === 1 ? "channel is" : "channels are" }} missing</span>
                        — {{ shrinkage.storedChannels }} recorded, {{ shrinkage.freshChannels }} on the radio.
                        A channel's key cannot be heard again: if this record is replaced, it is gone.
                    </li>
                    <li v-if="shrinkage.contactsLost > 0">
                        <span class="font-semibold">{{ shrinkage.contactsLost }} contacts missing</span>
                        — {{ shrinkage.storedContacts }} recorded, {{ shrinkage.freshContacts }} on the radio.
                    </li>
                </ul>

                <p class="text-xs text-gray-600">
                    Nothing has been written yet. This happens if a trip home did not put everything back — and
                    also if you deliberately cleared the radio down, in which case the radio is right and the
                    record is stale.
                </p>
            </div>

            <div class="p-3 space-y-2">

                <button @click="keepRecord" type="button"
                        class="w-full text-white bg-blue-600 hover:bg-blue-700 font-medium rounded-lg text-sm px-4 py-2.5">
                    Keep the older record
                </button>

                <button @click="takeRadio" type="button"
                        class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 font-medium rounded-lg text-sm px-4 py-2.5">
                    The radio is right, update the record
                </button>

                <div class="text-xs text-gray-500">
                    Keeping it means the way home can still put those back, and this asks again next time you
                    connect. Updating it means this radio, as it is now, becomes what coming home restores.
                </div>

            </div>

        </div>
    </div>

</template>

<script>
import GlobalState from "../../js/GlobalState.js";
import NodeBackup from "../../js/NodeBackup.js";
import ModeProfiles from "../../js/modes/ModeProfiles.js";

export default {
    name: "BackupShrankDialog",
    computed: {
        asking() {
            return GlobalState.backupShrank;
        },
        shrinkage() {
            return this.asking?.shrinkage ?? {};
        },
        when() {
            const at = this.shrinkage?.capturedAt;
            return at == null ? null : new Date(at).toLocaleString();
        },
    },
    methods: {

        /**
         * Write nothing. The stored record stays the way home, and this asks again on
         * the next connect -- which is right: an unanswered question about the way
         * home should not go away by itself.
         */
        keepRecord() {
            GlobalState.backupShrank = null;
        },

        /** The radio as it stands is this station's normal setup after all. */
        async takeRadio() {
            const { backup, nodeKeyHex } = this.asking;
            GlobalState.backupShrank = null;
            try {
                await ModeProfiles.captureNormal(nodeKeyHex, { channels: backup.channels });
                NodeBackup.save(backup, NodeBackup.SLOT_PRE_EMCOMM);
            } catch(e) {
                console.log("could not record the radio's normal mode", e);
            }
        },

    },
};
</script>
