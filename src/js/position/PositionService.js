/**
 * Asking stations for their position, answering when asked, and keeping what
 * came back.
 *
 * A request goes on a channel as a datagram, which every station on the channel
 * running this app sees, answer included: the position is shared with the net,
 * which is the point. Or it goes direct to one contact, and only the two of them
 * see it. See PositionProtocol for the bytes.
 *
 * Requests repeat, in three modes:
 *   once:  a single request.
 *   until: every N minutes until an answer comes back.
 *   count: up to X times every Y minutes, or until an answer.
 * An answer of any kind ends them: a position, a decline, or a radio's own
 * telemetry. Each request floods the mesh like a flood advert, so the interval
 * cannot go under a minute, and the form warns under five.
 *
 * Answering asks the operator each time unless they have turned on answering
 * automatically, and only on channels they have marked for it. A direct request
 * is addressed to them personally, so it is always put to them.
 *
 * If a station's app does not answer, its radio is asked directly with the
 * firmware's telemetry request. The radio answers that with the app closed, but
 * only includes a position if it has a working GPS and its owner allows sharing
 * location. That answer goes only to whoever asked.
 */

import { reactive } from "vue";
import { Constants, CayenneLpp } from "@liamcottle/meshcore.js";
import GlobalState from "../GlobalState.js";
import Connection from "../Connection.js";
import Utils from "../Utils.js";
import OperatorSettings from "../reports/OperatorSettings.js";
import * as Protocol from "./PositionProtocol.js";
import Geo from "./Geo.js";

const MINUTE = 60 * 1000;

// the shortest interval between repeated requests, and below which the form warns
export const MIN_INTERVAL_MINUTES = 1;
export const CAUTION_INTERVAL_MINUTES = 5;

// how long to wait for a station's app before asking its radio instead
const APP_ANSWER_WAIT_MILLIS = 30 * 1000;

// how many decoded positions and declines to keep
const MAX_REPORTS = 100;

const state = reactive({
    // requests this station is making: see start()
    requests: [],
    // what has come back, newest first: positions and declines, from anyone this
    // station heard, not only answers to its own requests
    reports: [],
    // a request waiting on the operator, or null
    prompt: null,
    // per node, see settings()
    settingsRevision: 0,
    // the contact the request form is open for, or null
    requestTarget: null,
});

const timers = new Map();
const fallbackTimers = new Map();
let wakeLock = null;

class PositionService {

    static get state() {
        return state;
    }

    // --- settings, per node, in this browser ---------------------------------

    static storageKey(nodeKeyHex) {
        return `position_settings:${nodeKeyHex}`;
    }

    static nodeKeyHex() {
        const key = GlobalState.selfInfo?.publicKey;
        return key ? Utils.bytesToHex(key) : null;
    }

    /** { markedChannels: [slot indices], autoAnswer } for the connected node. */
    static settings(nodeKeyHex = this.nodeKeyHex()) {
        // read so a caller's computed follows changes
        void state.settingsRevision;
        const fallback = { markedChannels: [], autoAnswer: false };
        if(nodeKeyHex == null){
            return fallback;
        }
        try {
            const stored = JSON.parse(window.localStorage.getItem(this.storageKey(nodeKeyHex)) ?? "null");
            return {
                markedChannels: Array.isArray(stored?.markedChannels) ? stored.markedChannels.filter(Number.isInteger) : [],
                autoAnswer: stored?.autoAnswer === true,
            };
        } catch(e) {
            return fallback;
        }
    }

    static saveSettings(settings, nodeKeyHex = this.nodeKeyHex()) {
        if(nodeKeyHex == null){
            return false;
        }
        try {
            window.localStorage.setItem(this.storageKey(nodeKeyHex), JSON.stringify({
                markedChannels: [...new Set(settings.markedChannels ?? [])].sort((a, b) => a - b),
                autoAnswer: settings.autoAnswer === true,
            }));
            state.settingsRevision++;
            return true;
        } catch(e) {
            console.log("could not save position settings", e);
            return false;
        }
    }

    static isChannelMarked(channelIdx) {
        return this.settings().markedChannels.includes(channelIdx);
    }

    /** How this station names itself on a decline: the operator's callsign, or the node's name. */
    static ownName() {
        return OperatorSettings.callsign || GlobalState.selfInfo?.name || "";
    }

    // --- this station's own position -----------------------------------------

    /**
     * What this station would send: its radio's position, whether that is a live
     * GPS fix, and whether there is one at all. A radio with no position reports
     * 0, 0, which is a real place, so it is sent as "no position".
     */
    static ownPosition() {
        const self = GlobalState.selfInfo;
        const latitude = self ? self.advLat / 1e6 : null;
        const longitude = self ? self.advLon / 1e6 : null;
        const has = Geo.isPosition(latitude, longitude);
        const live = has && GlobalState.gpsStatus === "live";
        return {
            has,
            latitude: has ? latitude : 0,
            longitude: has ? longitude : 0,
            live,
            fixTime: live ? Math.floor(Date.now() / 1000) : 0,
        };
    }

    // re-reads of the radio's position when answering, to tell a current fix from
    // a stale one, and how far apart
    static FRESHNESS_READS = 3;
    static FRESHNESS_INTERVAL_MILLIS = 1500;

    /**
     * This station's position as it is now, for an answer, and whether it is a
     * current fix or only the last one the radio held.
     *
     * Whether GPS is live is decided once, at connect, and the position held
     * since is the one read then. Answering with that and calling it current
     * would be wrong the moment the fix was lost or the station moved. So the
     * radio is read again: a live receiver wanders in its last digits even
     * standing still, so any change means the fix is current. No change over a
     * few seconds means it is sent as a last known position. A radio without a
     * confirmed GPS always sends its position as last known.
     */
    static async currentPosition() {

        const reading = (self) => `${self?.advLat},${self?.advLon}`;
        const before = reading(GlobalState.selfInfo);
        let current = false;

        if(GlobalState.gpsStatus === "live"){
            for(let i = 0; i < this.FRESHNESS_READS && !current; i++){
                if(i > 0){
                    await Utils.sleep(this.FRESHNESS_INTERVAL_MILLIS);
                }
                try {
                    await Connection.loadSelfInfo(Connection.READ_TIMEOUT_MILLIS);
                } catch(e) {
                    console.log("could not re-read the position", e);
                    break;
                }
                current = reading(GlobalState.selfInfo) !== before;
            }
        }

        const own = this.ownPosition();
        return {
            ...own,
            live: own.has && current,
            lastKnown: own.has && !current,
            fixTime: own.has && current ? Math.floor(Date.now() / 1000) : 0,
        };

    }

    // --- sending ---------------------------------------------------------------

    /** Sends one message by the route given: { kind: "channel", idx } or { kind: "direct", contact }. */
    static async transmit(via, message, readable) {
        if(GlobalState.connection == null){
            throw new Error(Connection.DISCONNECTED);
        }
        if(via.kind === "channel"){
            await Connection.sendChannelDatagram(via.idx, Protocol.DATA_TYPE, Protocol.encode(message));
        } else {
            await Connection.sendCommandData(via.contact.publicKey, Protocol.toDirectText(message, readable));
        }
    }

    static contactByPrefix(prefixBytes) {
        const hex = Protocol.prefixHex(prefixBytes);
        return GlobalState.contacts.find((c) => Utils.bytesToHex(c.publicKey).startsWith(hex)) ?? null;
    }

    static contactName(contact) {
        return contact?.advName?.trim() || (contact ? `(unnamed ${Utils.bytesToHex(contact.publicKey).slice(0, 8)})` : null);
    }

    /**
     * Starts asking a contact for its position.
     *
     * target: the contact. via: { kind: "channel", idx, name } or { kind: "direct" }.
     * mode: { type: "once" } | { type: "until", intervalMinutes } |
     *       { type: "count", intervalMinutes, maxCount }
     */
    static start(target, via, mode) {

        const normalised = this.normaliseMode(mode);
        const request = {
            tag: Protocol.newTag(),
            target: {
                publicKey: new Uint8Array(target.publicKey),
                prefixHex: Protocol.prefixHex(target.publicKey),
                name: this.contactName(target),
            },
            via: via.kind === "channel"
                ? { kind: "channel", idx: via.idx, name: via.name ?? `channel ${via.idx}` }
                : { kind: "direct" },
            mode: normalised,
            nodeKeyHex: this.nodeKeyHex(),
            sent: 0,
            startedAt: Date.now(),
            lastSentAt: null,
            nextAt: Date.now(),
            status: "running",
            outcome: null,
            error: null,
        };

        // a new request to the same station replaces an older one still running
        for(const other of state.requests){
            if(other.status === "running" && other.target.prefixHex === request.target.prefixHex){
                this.finish(other, "stopped", "Replaced by a new request.");
            }
        }

        state.requests.unshift(request);
        state.requests.splice(20);
        this.holdScreen();
        this.sendAttempt(request.tag);
        return request;

    }

    static normaliseMode(mode) {
        const type = ["once", "until", "count"].includes(mode?.type) ? mode.type : "once";
        const interval = Math.max(MIN_INTERVAL_MINUTES, Math.round(Number(mode?.intervalMinutes) || 0));
        const maxCount = Math.max(1, Math.round(Number(mode?.maxCount) || 1));
        if(type === "once"){
            return { type };
        }
        if(type === "until"){
            return { type, intervalMinutes: interval };
        }
        return { type, intervalMinutes: interval, maxCount };
    }

    static find(tag) {
        return state.requests.find((r) => r.tag === tag) ?? null;
    }

    static async sendAttempt(tag) {

        const request = this.find(tag);
        if(request == null || request.status !== "running"){
            return;
        }
        timers.delete(tag);

        const readable = `Position request from ${this.ownName()} (answering needs MeshCore-Emcomm)`;
        const message = {
            kind: Protocol.KIND.REQUEST,
            tag: request.tag,
            to: request.target.publicKey,
            from: GlobalState.selfInfo?.publicKey,
            name: request.via.kind === "channel" ? this.ownName() : "",
        };

        try {
            await this.transmit(this.routeFor(request), message, readable);
            request.sent++;
            request.lastSentAt = Date.now();
            request.error = null;
        } catch(e) {
            console.log("position request not sent", e);
            request.error = e?.message ?? String(e);
            if(GlobalState.connection == null){
                this.finish(request, "stopped", "The radio disconnected.");
                return;
            }
        }

        // an answer may already have come back while this was sending
        if(request.status !== "running"){
            return;
        }

        this.scheduleFallback(request);

        const { mode } = request;
        const more = mode.type === "until" || (mode.type === "count" && request.sent < mode.maxCount);
        if(!more){
            // the last one: wait for the station's app, then its radio, then give up
            request.nextAt = null;
            return;
        }

        request.nextAt = Date.now() + mode.intervalMinutes * MINUTE;
        timers.set(tag, setTimeout(() => this.sendAttempt(tag), mode.intervalMinutes * MINUTE));

    }

    static routeFor(request) {
        if(request.via.kind === "channel"){
            return request.via;
        }
        const contact = GlobalState.contacts.find((c) => Utils.isUint8ArrayEqual(new Uint8Array(c.publicKey), request.target.publicKey))
            ?? { publicKey: request.target.publicKey };
        return { kind: "direct", contact };
    }

    /**
     * After each request, give the station's app a while to answer, then ask its
     * radio. After the last request that is the final chance, and the request
     * gives up if the radio has nothing either.
     */
    static scheduleFallback(request) {
        clearTimeout(fallbackTimers.get(request.tag));
        fallbackTimers.set(request.tag, setTimeout(() => this.askRadio(request.tag), APP_ANSWER_WAIT_MILLIS));
    }

    static async askRadio(tag) {

        fallbackTimers.delete(tag);
        const request = this.find(tag);
        if(request == null || request.status !== "running"){
            return;
        }

        const isLast = request.nextAt == null;
        request.radioAsked = true;

        let telemetry = null;
        try {
            telemetry = await Connection.requestTelemetry(request.target.publicKey);
        } catch(e) {
            console.log("telemetry request got no answer", e);
        }

        if(request.status !== "running"){
            return;
        }

        const gps = telemetry ? this.gpsFromTelemetry(telemetry.lppSensorData) : null;
        if(gps){
            this.record({
                source: "radio",
                fromPrefixHex: request.target.prefixHex,
                name: request.target.name,
                latitude: gps.latitude,
                longitude: gps.longitude,
                hasPosition: true,
                // the firmware adds its GPS position but does not say how current
                // it is, so it is not claimed as a current fix
                liveFix: false,
                lastKnown: false,
                fixTime: 0,
                messageToFollow: false,
                via: request.via,
                requestedByUs: true,
            });
            this.finish(request, "answered", "Its radio answered with a GPS position; its app did not reply.");
            return;
        }

        request.radioNote = telemetry
            ? "Its radio answered, but without a position: it has no working GPS, or its owner does not share location."
            // a radio whose owner does not share says nothing at all, which is
            // the same as being out of range: on the bench node 2 stayed silent
            // with sharing off and answered in under a second with it on
            : "Its radio did not answer either: it may not share location, or may be out of range.";

        if(isLast){
            this.finish(request, "gave up", `No answer after ${request.sent} ${request.sent === 1 ? "request" : "requests"}.`);
        }

    }

    static gpsFromTelemetry(lpp) {
        try {
            const entries = CayenneLpp.parse(new Uint8Array(lpp ?? []));
            const gps = entries.find((e) => e.type === CayenneLpp.LPP_GPS);
            if(gps && Geo.isPosition(gps.value.latitude, gps.value.longitude)){
                return gps.value;
            }
        } catch(e) {
            console.log("could not read telemetry", e);
        }
        return null;
    }

    static openRequest(contact) {
        state.requestTarget = contact;
    }

    static closeRequest() {
        state.requestTarget = null;
    }

    static stop(tag) {
        const request = this.find(tag);
        if(request && request.status === "running"){
            this.finish(request, "stopped", "Stopped.");
        }
    }

    static finish(request, status, outcome) {
        request.status = status;
        request.outcome = outcome;
        request.nextAt = null;
        request.finishedAt = Date.now();
        clearTimeout(timers.get(request.tag));
        timers.delete(request.tag);
        clearTimeout(fallbackTimers.get(request.tag));
        fallbackTimers.delete(request.tag);
        if(!state.requests.some((r) => r.status === "running")){
            this.releaseScreen();
        }
    }

    /** Stops everything tied to the radio that was connected. Called on disconnect. */
    static onDisconnected() {
        for(const request of state.requests){
            if(request.status === "running"){
                this.finish(request, "stopped", "The radio disconnected.");
            }
        }
        state.prompt = null;
    }

    static dismiss(tag) {
        const at = state.requests.findIndex((r) => r.tag === tag);
        if(at >= 0 && state.requests[at].status !== "running"){
            state.requests.splice(at, 1);
        }
    }

    // --- receiving -------------------------------------------------------------

    /** A channel datagram, from message sync. Anything not ours is ignored. */
    static onChannelData(channelData) {
        if(channelData?.dataType !== Protocol.DATA_TYPE){
            return false;
        }
        const message = Protocol.decode(new Uint8Array(channelData.data ?? []));
        if(message == null){
            return false;
        }
        const channel = GlobalState.channels.find((c) => c.idx === channelData.channelIdx);
        this.receive(message, { kind: "channel", idx: channelData.channelIdx, name: channel?.name ?? `channel ${channelData.channelIdx}` });
        return true;
    }

    /**
     * A direct message of text type 1. Returns true when it was one of ours, so
     * the caller keeps it out of the conversation.
     */
    static onDirectText(contact, text) {
        const message = Protocol.fromDirectText(text);
        if(message == null){
            return false;
        }
        // the sender of a direct message is certain; the payload's claim is not needed
        message.from = new Uint8Array(contact.publicKey).slice(0, 6);
        if(!message.name){
            message.name = this.contactName(contact);
        }
        this.receive(message, { kind: "direct", contactKeyHex: Utils.bytesToHex(contact.publicKey), name: this.contactName(contact) });
        return true;
    }

    static isForMe(prefix) {
        const own = GlobalState.selfInfo?.publicKey;
        return own != null && Protocol.prefixHex(prefix) === Protocol.prefixHex(own);
    }

    static receive(message, via) {

        const fromHex = Protocol.prefixHex(message.from);
        const known = this.contactByPrefix(message.from);
        const name = message.name || this.contactName(known) || fromHex;
        // the radio's own name, when the sender is a contact. On a channel the
        // name carried is the operator's callsign, which on the bench was the same
        // for both radios, so the list could not tell them apart without this
        const nodeName = this.contactName(known);

        if(message.kind === Protocol.KIND.REQUEST){
            if(!this.isForMe(message.to)){
                return;
            }
            // on a channel, only where the operator has said to answer
            if(via.kind === "channel" && !this.isChannelMarked(via.idx)){
                return;
            }
            const request = {
                tag: message.tag,
                fromPrefix: new Uint8Array(message.from),
                fromPrefixHex: fromHex,
                name,
                via,
                receivedAt: Date.now(),
                count: (state.prompt?.fromPrefixHex === fromHex ? state.prompt.count : 0) + 1,
            };
            if(this.settings().autoAnswer){
                this.answer(request, { messageToFollow: false }).catch((e) => console.log("automatic position answer failed", e));
                return;
            }
            // one prompt per requester: a repeat refreshes it rather than stacking
            state.prompt = request;
            return;
        }

        const answersMine = this.isForMe(message.to);

        if(message.kind === Protocol.KIND.POSITION){
            this.record({
                source: "app",
                fromPrefixHex: fromHex,
                name,
                nodeName,
                latitude: message.latitude,
                longitude: message.longitude,
                hasPosition: message.hasPosition,
                liveFix: message.liveFix,
                lastKnown: message.lastKnown,
                fixTime: message.fixTime,
                messageToFollow: message.messageToFollow,
                via,
                requestedByUs: answersMine,
            });
        } else if(message.kind === Protocol.KIND.DECLINED){
            this.record({
                source: "declined",
                fromPrefixHex: fromHex,
                name,
                nodeName,
                via,
                requestedByUs: answersMine,
            });
        }

        if(!answersMine){
            return;
        }

        // an answer to one of ours ends it, matched on the tag, or failing that
        // on the station, since an answer to an earlier round still counts
        const request = state.requests.find((r) => r.status === "running" && r.tag === message.tag)
            ?? state.requests.find((r) => r.status === "running" && r.target.prefixHex === fromHex);
        if(request == null){
            return;
        }
        if(message.kind === Protocol.KIND.DECLINED){
            this.finish(request, "declined", `Declined by ${name}.`);
        } else if(!message.hasPosition){
            this.finish(request, "answered", `${name} answered, but has no position set.`);
        } else {
            this.finish(request, "answered", message.messageToFollow ? `${name} answered, with a message to follow.` : `${name} answered.`);
        }

    }

    static record(report) {
        state.reports.unshift({ ...report, receivedAt: Date.now(), id: `${report.fromPrefixHex}-${Date.now()}-${Math.random()}` });
        state.reports.splice(MAX_REPORTS);
    }

    /**
     * The newest real position from a station, or null. A decline, or an answer
     * with no position, is the newest word from a station but must not hide
     * where it was last known to be: on the bench a decline replaced node 2's
     * position in the list.
     */
    static lastPositionFrom(prefixHex) {
        return state.reports.find((r) => r.fromPrefixHex === prefixHex && r.source !== "declined" && r.hasPosition) ?? null;
    }

    /** The newest report from each station, for the list. */
    static latestByStation() {
        const seen = new Set();
        return state.reports.filter((r) => {
            if(seen.has(r.fromPrefixHex)){
                return false;
            }
            seen.add(r.fromPrefixHex);
            return true;
        });
    }

    // --- answering -------------------------------------------------------------

    /** Sends this station's position in answer to a request. */
    static async answer(request, { messageToFollow = false } = {}) {
        const own = await this.currentPosition();
        let flags = 0;
        if(messageToFollow) flags |= Protocol.FLAG.MESSAGE_TO_FOLLOW;
        if(own.live) flags |= Protocol.FLAG.LIVE_FIX;
        if(own.lastKnown) flags |= Protocol.FLAG.LAST_KNOWN;
        if(!own.has) flags |= Protocol.FLAG.NO_POSITION;
        const message = {
            kind: Protocol.KIND.POSITION,
            tag: request.tag,
            to: request.fromPrefix,
            from: GlobalState.selfInfo?.publicKey,
            name: request.via.kind === "channel" ? this.ownName() : "",
            latitude: own.latitude,
            longitude: own.longitude,
            fixTime: own.fixTime,
            flags,
        };
        // stock clients see this line, so it says what kind of position it is too
        const readable = !own.has
            ? `${this.ownName()} has no position set`
            : own.lastKnown
                ? `Last known position of ${this.ownName()} (not a current fix): ${Geo.formatDegrees(own.latitude, own.longitude)}`
                : `Position of ${this.ownName()}: ${Geo.formatDegrees(own.latitude, own.longitude)}`;
        await this.transmit(this.answerRoute(request), message, readable);
        if(state.prompt === request){
            state.prompt = null;
        }
    }

    static async decline(request) {
        const name = this.ownName();
        const message = {
            kind: Protocol.KIND.DECLINED,
            tag: request.tag,
            to: request.fromPrefix,
            from: GlobalState.selfInfo?.publicKey,
            name,
        };
        await this.transmit(this.answerRoute(request), message, `Declined by ${name}`);
        if(state.prompt === request){
            state.prompt = null;
        }
    }

    /** A request is answered the way it came: on its channel, or direct. */
    static answerRoute(request) {
        if(request.via.kind === "channel"){
            return request.via;
        }
        const contact = GlobalState.contacts.find((c) => Utils.bytesToHex(c.publicKey) === request.via.contactKeyHex);
        return { kind: "direct", contact };
    }

    static dismissPrompt() {
        state.prompt = null;
    }

    // --- screen ----------------------------------------------------------------

    // repeats run on a browser timer, which a locked phone stops, as it does
    // repeating adverts. So the screen is kept on while any request repeats
    static async holdScreen() {
        if(wakeLock != null || typeof navigator === "undefined" || !navigator.wakeLock){
            return;
        }
        try {
            wakeLock = await navigator.wakeLock.request("screen");
            wakeLock.addEventListener?.("release", () => { wakeLock = null; });
            if(!state.requests.some((r) => r.status === "running")){
                this.releaseScreen();
            }
        } catch(e) {
            wakeLock = null;
        }
    }

    static releaseScreen() {
        const lock = wakeLock;
        wakeLock = null;
        lock?.release?.().catch?.(() => {});
    }

}

if(typeof document !== "undefined"){
    document.addEventListener("visibilitychange", () => {
        if(document.visibilityState === "visible" && state.requests.some((r) => r.status === "running")){
            PositionService.holdScreen();
        }
    });
}

export default PositionService;
