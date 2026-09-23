<template>
    <div v-if="open" class="fixed inset-0 z-50 flex bg-black/40 p-3 overflow-y-auto">
        <div role="dialog" aria-labelledby="mode-sharing-heading" class="m-auto w-full max-w-md bg-white rounded-lg shadow-lg divide-y">

            <div class="p-3">
                <div id="mode-sharing-heading" class="font-semibold text-gray-900">Share a station mode</div>
                <div class="text-xs text-gray-500 mt-1">
                    Set one station up, then hand its mode to the others. Their radios are not touched:
                    the mode is saved on their app, and each operator switches into it from the banner.
                </div>
            </div>

            <!-- showing a code, or taking one in -->
            <div class="p-3 flex space-x-1">
                <button @click="view = 'show'" type="button"
                    :class="view === 'show' ? 'bg-gray-800 text-white font-semibold' : 'bg-gray-100 text-gray-600'"
                    class="w-full text-xs rounded px-2 py-1">Show a code</button>
                <button @click="view = 'take'" type="button"
                    :class="view === 'take' ? 'bg-gray-800 text-white font-semibold' : 'bg-gray-100 text-gray-600'"
                    class="w-full text-xs rounded px-2 py-1">Take one in</button>
            </div>

            <!-- show: one code per mode, chosen deliberately -->
            <template v-if="view === 'show'">

                <div class="p-3 space-y-2">
                    <div class="flex space-x-1">
                        <button v-for="mode of shareable" :key="mode" @click="chooseMode(mode)" type="button"
                            :class="shareMode === mode ? classesFor(mode) + ' font-bold' : 'bg-gray-100 text-gray-600'"
                            class="w-full text-xs rounded px-2 py-1">{{ labelFor(mode) }}</button>
                    </div>
                    <div class="text-xs text-gray-500">
                        One code for each mode, so the wrong one cannot be scanned by mistake at a drill.
                    </div>
                </div>

                <div v-if="notConnected" class="p-3 text-xs text-red-600">No radio connected, so there is no mode to share.</div>

                <template v-else>
                    <div class="p-3 space-y-2">
                        <div v-if="qrCells" class="flex justify-center">
                            <!-- drawn as squares rather than an image, so it prints and
                                 scales without a canvas or a data URL -->
                            <svg :viewBox="`0 0 ${qrCells.length} ${qrCells.length}`" role="img"
                                 :aria-label="`${labelFor(shareMode)} code`"
                                 class="w-64 h-64 bg-white" shape-rendering="crispEdges">
                                <rect :width="qrCells.length" :height="qrCells.length" fill="#fff"/>
                                <template v-for="(row, y) of qrCells" :key="y">
                                    <rect v-for="(on, x) of row" v-show="on" :key="x" :x="x" :y="y" width="1" height="1" fill="#000"/>
                                </template>
                            </svg>
                        </div>
                        <div v-else class="text-xs text-red-600">{{ qrError }}</div>

                        <div class="text-xs text-gray-500 break-all font-mono">{{ link }}</div>

                        <div class="flex space-x-2">
                            <button @click="copyLink" type="button"
                                class="w-full bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-xs font-medium rounded-lg px-3 py-2">Copy the link</button>
                            <button @click="saveFile" type="button"
                                class="w-full bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-xs font-medium rounded-lg px-3 py-2">Save to a file</button>
                        </div>
                        <div v-if="message" role="status" class="text-xs text-green-700">{{ message }}</div>
                    </div>

                    <div class="p-3 space-y-2">
                        <label class="flex items-start space-x-2 text-xs text-gray-700">
                            <input v-model="includePrivateKeys" type="checkbox" class="mt-0.5">
                            <span>Include the keys of private channels</span>
                        </label>
                        <div v-if="privateKeys > 0 && includePrivateKeys" role="status" class="text-xs text-amber-800">
                            This code carries the key to {{ privateKeys }} private channel{{ privateKeys === 1 ? "" : "s" }}.
                            Anyone who photographs it can read that channel's traffic afterwards.
                        </div>
                        <div v-else-if="privateKeys > 0" class="text-xs text-gray-500">
                            {{ privateKeys }} private channel{{ privateKeys === 1 ? "" : "s" }} will be named without
                            {{ privateKeys === 1 ? "its key" : "their keys" }}, for the operator to add by hand.
                        </div>
                        <div v-else class="text-xs text-gray-500">
                            Every channel in this mode is a # channel, so its key comes from its name and nothing
                            private is in the code.
                        </div>
                        <div class="text-xs text-gray-500">
                            The node name, the contacts and Normal mode are never shared.
                        </div>
                    </div>
                </template>

            </template>

            <!-- take: scan, or paste what was scanned elsewhere -->
            <template v-else>

                <div v-if="!incoming" class="p-3 space-y-2">
                    <div class="text-xs text-gray-500">
                        Scan the other station's code with this phone's camera and it opens here. Or paste
                        the link below.
                    </div>
                    <button v-if="canScan" @click="scan" :disabled="scanning" type="button"
                        class="w-full bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-60 text-gray-700 text-sm font-medium rounded-lg px-3 py-2">
                        {{ scanning ? "Point the camera at the code..." : "Scan with the camera" }}
                    </button>
                    <video v-show="scanning" ref="video" class="w-full rounded bg-black" muted playsinline></video>
                    <textarea v-model="pasted" rows="3" placeholder="https://..."
                        aria-label="Shared mode link"
                        class="w-full bg-gray-50 border border-gray-300 text-xs rounded p-2 font-mono"></textarea>
                    <button @click="readPasted" type="button"
                        class="w-full bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg px-3 py-2">Read it</button>
                    <div v-if="error" role="status" class="text-xs text-red-600">{{ error }}</div>
                </div>

                <!-- what it would change, before anything is saved -->
                <div v-else class="p-3 space-y-2">
                    <div class="text-sm font-medium text-gray-900">
                        {{ labelFor(incoming.mode) }}<span v-if="incoming.from" class="font-normal text-gray-600"> from {{ incoming.from }}</span>
                    </div>
                    <div v-if="incoming.stale" role="status" class="text-xs text-amber-800">
                        This code was made {{ ageInDays }}. Check it is this incident's, not the last one's.
                    </div>
                    <ul class="list-disc pl-5 text-xs text-gray-700 space-y-0.5">
                        <li v-for="(line, i) of describe" :key="i">{{ line }}</li>
                    </ul>
                    <div v-if="incoming.missingKeys.length > 0" role="status" class="text-xs text-amber-800">
                        Shared without {{ incoming.missingKeys.length === 1 ? "the key" : "keys" }} for
                        {{ incoming.missingKeys.join(", ") }}. Add {{ incoming.missingKeys.length === 1 ? "it" : "them" }}
                        in Settings, or ask for a code that includes {{ incoming.missingKeys.length === 1 ? "it" : "them" }}.
                    </div>

                    <label class="block text-xs text-gray-700">Save it as
                        <select v-model="saveAs" class="mt-0.5 w-full bg-gray-50 border border-gray-300 text-sm rounded p-2">
                            <option v-for="mode of shareable" :key="mode" :value="mode">{{ labelFor(mode) }}</option>
                        </select>
                    </label>

                    <div v-if="saved" role="status" class="text-xs text-green-700">
                        Saved as {{ labelFor(saveAs) }}. Nothing on the radio has changed: switch into the mode
                        from the banner when you are ready.
                    </div>

                    <div class="flex space-x-2">
                        <button @click="incoming = null" type="button"
                            class="w-full bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-sm font-medium rounded-lg px-3 py-2">Back</button>
                        <button @click="saveIncoming" :disabled="notConnected || saved" type="button"
                            class="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-gray-400 text-white text-sm font-medium rounded-lg px-3 py-2">Save the mode</button>
                    </div>
                    <div v-if="notConnected" class="text-xs text-red-600">
                        No radio connected, so there is nothing to save it against.
                    </div>
                </div>

            </template>

            <!-- pinned to the bottom of the scroll, because this dialog is taller
                 than a phone: measured at 1370px with a 22px root font, where the
                 QR code, the link, the key warning and the mode buttons all want
                 to be on screen at once. The way out of a dialog should not be
                 something to scroll for. -->
            <div class="sticky bottom-0 bg-white rounded-b-lg p-3">
                <button @click="close" type="button"
                    class="w-full bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-sm font-medium rounded-lg px-5 py-2.5">Close</button>
            </div>

        </div>
    </div>
</template>

<script>
import qrcode from "qrcode-generator";
import GlobalState from "../../js/GlobalState.js";
import Utils from "../../js/Utils.js";
import OperatorSettings from "../../js/reports/OperatorSettings.js";
import ModeProfiles, { MODE_CLASSES } from "../../js/modes/ModeProfiles.js";
import ModeShare from "../../js/modes/ModeShare.js";

export default {
    name: 'ModeSharing',
    props: {
        open: Boolean,
        // a link the app was opened with, so a scanned code lands here
        incomingLink: String,
    },
    emits: ["close"],
    data() {
        return {
            view: "show",
            shareMode: "live",
            includePrivateKeys: true,
            profile: null,
            link: "",
            qrCells: null,
            qrError: null,
            message: null,
            pasted: "",
            error: null,
            incoming: null,
            saveAs: "live",
            saved: false,
            scanning: false,
            stopScan: null,
        };
    },
    watch: {
        open: {
            handler(value) {
                if(!value){
                    this.endScan();
                    return;
                }
                this.message = null;
                this.error = null;
                this.saved = false;
                if(this.incomingLink){
                    this.view = "take";
                    this.read(this.incomingLink);
                } else {
                    this.view = "show";
                    this.chooseMode(this.shareMode);
                }
            },
            immediate: true,
        },
        includePrivateKeys() {
            this.chooseMode(this.shareMode);
        },
    },
    beforeUnmount() {
        this.endScan();
    },
    methods: {
        labelFor(mode) {
            return ModeProfiles.label(mode);
        },
        classesFor(mode) {
            return MODE_CLASSES[mode] ?? MODE_CLASSES.normal;
        },
        close() {
            this.endScan();
            this.$emit("close");
        },
        async chooseMode(mode) {

            this.shareMode = mode;
            this.message = null;
            this.qrCells = null;
            this.qrError = null;

            if(this.notConnected){
                return;
            }

            try {
                this.profile = await ModeProfiles.profileOrDefault(mode);
                this.link = ModeShare.link(this.profile, mode, {
                    includePrivateKeys: this.includePrivateKeys,
                    from: OperatorSettings.callsign || GlobalState.selfInfo?.name || "",
                });
                this.draw();
            } catch(e) {
                this.qrError = `That mode could not be read: ${e?.message ?? e}`;
            }

        },
        draw() {
            try {
                // 0 picks the smallest version the data fits in; M is the error
                // correction a phone screen wants, and what most readers expect
                const qr = qrcode(0, "M");
                qr.addData(this.link);
                qr.make();
                const count = qr.getModuleCount();
                const cells = [];
                for(let y = 0; y < count; y++){
                    const row = [];
                    for(let x = 0; x < count; x++){
                        row.push(qr.isDark(y, x));
                    }
                    cells.push(row);
                }
                this.qrCells = cells;
            } catch(e) {
                // too much data for any QR version: say so rather than showing a
                // code nobody can scan
                this.qrCells = null;
                this.qrError = "This mode holds too much to fit in a code. Copy the link or save it to a file instead.";
            }
        },
        async copyLink() {
            try {
                await Utils.copyToClipboard(this.link);
                this.message = "Link copied.";
            } catch(e) {
                this.message = null;
            }
        },
        saveFile() {
            const name = `mesh-emcomm-${this.shareMode}-mode.txt`;
            const url = URL.createObjectURL(new Blob([this.link], { type: "text/plain" }));
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = name;
            anchor.click();
            URL.revokeObjectURL(url);
            this.message = `Saved as ${name}.`;
        },
        async readPasted() {
            await this.read(this.pasted);
        },
        async read(text) {
            this.error = null;
            this.saved = false;
            try {
                this.incoming = await ModeShare.read(text);
                this.saveAs = this.incoming.mode;
            } catch(e) {
                this.incoming = null;
                this.error = String(e?.message ?? e);
            }
        },
        saveIncoming() {
            ModeShare.save(this.incoming, this.saveAs);
            this.saved = true;
        },
        async scan() {

            this.error = null;
            this.scanning = true;

            try {

                const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
                const video = this.$refs.video;
                video.srcObject = stream;
                await video.play();

                this.stopScan = () => {
                    for(const track of stream.getTracks()){
                        track.stop();
                    }
                    video.srcObject = null;
                };

                while(this.scanning){
                    const codes = await detector.detect(video);
                    if(codes.length > 0){
                        this.endScan();
                        await this.read(codes[0].rawValue);
                        return;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 200));
                }

            } catch(e) {
                this.error = `The camera could not be used: ${e?.message ?? e}. Paste the link instead.`;
                this.endScan();
            }

        },
        endScan() {
            this.scanning = false;
            if(this.stopScan){
                this.stopScan();
                this.stopScan = null;
            }
        },
    },
    computed: {
        shareable() {
            // normal is the radio as its owner had it, so it is never handed over
            return ["training", "live"];
        },
        notConnected() {
            return GlobalState.connection == null || GlobalState.selfInfo == null;
        },
        privateKeys() {
            return this.profile ? ModeShare.privateKeyCount(this.profile) : 0;
        },
        describe() {
            return this.incoming ? ModeShare.describe(this.incoming, this.saveAs) : [];
        },
        ageInDays() {
            if(!this.incoming?.at){
                return "some time ago";
            }
            const days = Math.floor((Date.now() - this.incoming.at) / (24 * 60 * 60 * 1000));
            return days <= 1 ? "more than a day ago" : `${days} days ago`;
        },
        canScan() {
            return typeof window !== "undefined" && "BarcodeDetector" in window;
        },
    },
}
</script>
