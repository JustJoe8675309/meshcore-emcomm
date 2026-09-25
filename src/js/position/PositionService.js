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
 *
 * A roll call asks every station on a channel, or in a room, at once. There is
 * no knowing who is on a channel, so it cannot run until answered. Its modes:
 *   once:  a single roll call.
 *   again: up to X times every Y minutes, naming the stations already heard,
 *          which stay silent, so only those missed answer.
 *   track: X fresh roll calls every Y minutes, everyone answering each time.
 * Every roll call brings an answer from every station, so the interval cannot go
 * under five minutes and the form warns under fifteen. Stations answering
 * automatically wait a random moment first, so their answers do not collide.
 * No radio is asked by telemetry: that goes one contact at a time.
 *
 * A room relays posts rather than datagrams, so there everything goes as a text
 * post that stock apps show as it is, and a room replays missed posts to anyone
 * logging in: requests older than a few minutes are ignored.
 */

import { reactive } from "vue";
import { Constants, CayenneLpp } from "@liamcottle/meshcore.js";
import GlobalState from "../GlobalState.js";
import Connection from "../Connection.js";
import Utils from "../Utils.js";
import OperatorSettings from "../reports/OperatorSettings.js";
import * as Protocol from "./PositionProtocol.js";
import Geo from "./Geo.js";
import Airtime from "../reports/Airtime.js";

const MINUTE = 60 * 1000;

// roll calls bring an answer from every station, so they are spaced further apart
export const GROUP_MIN_INTERVAL_MINUTES = 5;
export const GROUP_CAUTION_INTERVAL_MINUTES = 15;

// how long a roll call keeps listening after its last round, since people answer by hand
const ROLL_CALL_LISTEN_MILLIS = 5 * MINUTE;

// automatic answers to a roll call are spread over this many answer airtimes,
// no less than the floor and no more than the ceiling
const ROLL_CALL_SPREAD_AIRTIMES = 20;
const ROLL_CALL_ANSWER_BYTES = 64;
const ROLL_CALL_SPREAD_FLOOR_MILLIS = 10 * 1000;
const ROLL_CALL_SPREAD_CEILING_MILLIS = 60 * 1000;

// a room replays posts missed while logged out; a request older than this is a replay
export const ROOM_STALE_SECONDS = 10 * 60;

// the shortest interval between repeated requests, and below which the form warns
export const MIN_INTERVAL_MINUTES = 1;
export const CAUTION_INTERVAL_MINUTES = 5;

// the intervals offered as a single press, and the longest a repeat may run.
// A day is already a long time to be flooding the mesh for one station's
// position; past that the operator has forgotten it is on.
export const INTERVAL_CHOICES = [1, 5, 15, 30, 60];
export const MAX_FOR_MINUTES = 24 * 60;

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
    // requests waiting on the operator, oldest first, one per station. Only the
    // first is shown; answering it, declining it or putting it off brings up the
    // next. Before this a second station's request replaced the first on screen
    prompts: [],
    // the request on screen: the first waiting, or null. Setting it replaces the
    // whole queue, which is for tests and for clearing
    get prompt() {
        return this.prompts[0] ?? null;
    },
    set prompt(value) {
        this.prompts = value ? [value] : [];
    },
    // per node, see settings()
    settingsRevision: 0,
    // the contact the request form is open for, or null
    requestTarget: null,
    // the channel or room the roll call or share form is open for:
    // { action: "rollcall" | "share", via }, or null
    groupTarget: null,
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

    /**
     * { autoAnswer } for the connected node.
     *
     * Every channel and every room this station holds is answered. It used to be
     * a list of ticked slots, and that list was a running sore: a slot is not a
     * channel, so the marks had to be dragged from slot to slot on every mode
     * switch, and three separate faults in one evening came from them being
     * dragged wrong — a tick left on the channel that used to be in that slot, a
     * tick lost when a channel came home to a different one, and the backup's own
     * copy quietly overwriting the right answer with an old one.
     *
     * The operator's real question was never "which channels" but "am I asked
     * first", so that is the only choice left: auto reply or manual reply, per
     * mode. Manual is the default, and a request that arrives on a channel the
     * operator does not care about is one press to decline.
     */
    static settings(nodeKeyHex = this.nodeKeyHex()) {
        // read so a caller's computed follows changes
        void state.settingsRevision;
        if(nodeKeyHex == null){
            return { autoAnswer: false };
        }
        try {
            const stored = JSON.parse(window.localStorage.getItem(this.storageKey(nodeKeyHex)) ?? "null");
            return { autoAnswer: stored?.autoAnswer === true };
        } catch(e) {
            return { autoAnswer: false };
        }
    }

    static saveSettings(settings, nodeKeyHex = this.nodeKeyHex()) {
        if(nodeKeyHex == null){
            return false;
        }
        try {
            window.localStorage.setItem(this.storageKey(nodeKeyHex), JSON.stringify({
                autoAnswer: settings.autoAnswer === true,
            }));
            state.settingsRevision++;
            return true;
        } catch(e) {
            console.log("could not save position settings", e);
            return false;
        }
    }

    /**
     * Whether this station answers requests arriving by this route.
     *
     * Everything, now: direct, any channel it holds, any room it is in. What the
     * operator chooses is whether they are asked first, not where.
     */
    static answersOn(via) {
        return true;
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

    /**
     * Sends one message by the route given: { kind: "channel", idx },
     * { kind: "direct", contact } or { kind: "room", contactKeyHex }.
     */
    static async transmit(via, message, readable) {
        if(GlobalState.connection == null){
            throw new Error(Connection.DISCONNECTED);
        }
        if(via.kind === "channel"){
            await Connection.sendChannelDatagram(via.idx, Protocol.DATA_TYPE, Protocol.encode(Protocol.fitRollCall(message, Protocol.MAX_DATAGRAM_BYTES)));
        } else if(via.kind === "room"){
            const room = this.roomByKeyHex(via.contactKeyHex);
            if(room == null){
                throw new Error("that room is no longer a contact");
            }
            await Connection.sendRoomPost(room.publicKey, Protocol.toDirectText(message, readable, Protocol.MAX_ROOM_BYTES));
        } else {
            await Connection.sendCommandData(via.contact.publicKey, Protocol.toDirectText(message, readable));
        }
    }

    static roomByKeyHex(keyHex) {
        return GlobalState.contacts.find((c) => Utils.bytesToHex(c.publicKey) === keyHex) ?? null;
    }

    static viaLabel(via) {
        if(via.kind === "channel"){
            return `on ${via.name}`;
        }
        if(via.kind === "room"){
            return `in the room ${via.name}`;
        }
        return "direct";
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
     * mode: { type: "once" } | { type: "repeat", intervalMinutes, forMinutes }
     *
     * A repeat asks every intervalMinutes for forMinutes, and stops early the
     * moment it is answered. It used to be "until answered" with no end, or a
     * count of attempts; both are gone. Every request floods the whole mesh, so an
     * ask that runs until somebody notices it is still running is a bad thing to
     * leave on a net, and a count is arithmetic the operator has to do in their
     * head to know when it stops. A window says when it stops.
     */
    /**
     * How many requests a mode sends if nobody answers.
     *
     * Asks at 0, then every interval, for as long as the window lasts: "every 5
     * minutes for 30 minutes" asks at 0, 5, 10, 15, 20 and 25, and at 30 the
     * window is spent. The dialog shows this number before anything is sent, and
     * the request counts down from it, so what was promised is what goes out.
     */
    static askCount(mode) {
        const normalised = this.normaliseMode(mode);
        if(normalised.type !== "repeat"){
            return 1;
        }
        return Math.max(1, Math.ceil(normalised.forMinutes / normalised.intervalMinutes));
    }

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
            // How many will go out if nobody answers, worked out once, here.
            //
            // It used to be decided each time by asking whether another interval
            // still fitted inside the window. On the bench that sent 2 of the 3 the
            // dialog had promised: after the second send the clock was a fraction
            // past the one minute mark, so "now + 1 minute" fell outside a two
            // minute window by that fraction. Worse, which way it fell depended on
            // how fast the radio had answered, so the same request did not give the
            // same number of tries twice.
            //
            // Counting down from a number fixed at the start is repeatable, and it
            // is the number the operator was shown before pressing Request.
            remaining: this.askCount(normalised),
            startedAt: Date.now(),
            // when the asking stops, whatever happens. Null for a single request.
            endsAt: normalised.type === "repeat" ? Date.now() + normalised.forMinutes * MINUTE : null,
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
        this.trimRequests();
        this.holdScreen();
        this.sendAttempt(request.tag);
        return state.requests[0];

    }

    static normaliseMode(mode) {
        const type = ["once", "repeat"].includes(mode?.type) ? mode.type : "once";
        if(type === "once"){
            return { type };
        }
        const intervalMinutes = Math.max(MIN_INTERVAL_MINUTES, Math.round(Number(mode?.intervalMinutes) || 0));
        // at least one interval, or the window would close before the second ask
        // and the operator would have chosen a repeat and got a single request
        const forMinutes = Math.min(MAX_FOR_MINUTES, Math.max(intervalMinutes, Math.round(Number(mode?.forMinutes) || 0)));
        return { type, intervalMinutes, forMinutes };
    }

    static find(tag) {
        return state.requests.find((r) => r.tag === tag) ?? null;
    }

    // --- roll calls ----------------------------------------------------------

    static groupKey(via) {
        return via.kind === "channel" ? `channel:${via.idx}` : `room:${via.contactKeyHex}`;
    }

    static normaliseGroupMode(mode) {
        const type = ["once", "again", "track"].includes(mode?.type) ? mode.type : "once";
        if(type === "once"){
            return { type };
        }
        return {
            type,
            intervalMinutes: Math.max(GROUP_MIN_INTERVAL_MINUTES, Math.round(Number(mode?.intervalMinutes) || 0)),
            maxCount: Math.max(1, Math.round(Number(mode?.maxCount) || 1)),
        };
    }

    /**
     * Starts a roll call: every station on a channel, or in a room, asked at once.
     *
     * via: { kind: "channel", idx, name } or { kind: "room", contactKeyHex, name }.
     * mode: { type: "once" } | { type: "again", intervalMinutes, maxCount } |
     *       { type: "track", intervalMinutes, maxCount }
     */
    static startRollCall(via, mode) {

        const route = via.kind === "room"
            ? { kind: "room", contactKeyHex: via.contactKeyHex, name: via.name ?? "room" }
            : { kind: "channel", idx: via.idx, name: via.name ?? `channel ${via.idx}` };
        const tag = Protocol.newTag();
        const request = {
            group: true,
            // the tag of the round being asked; each round keeps its own
            tag,
            target: { everyone: true, prefixHex: "", name: route.kind === "room" ? `Everyone in ${route.name}` : `Everyone on ${route.name}` },
            via: route,
            mode: this.normaliseGroupMode(mode),
            nodeKeyHex: this.nodeKeyHex(),
            sent: 0,
            rounds: [{ tag, startedAt: Date.now(), sent: 0, answers: [] }],
            startedAt: Date.now(),
            lastSentAt: null,
            nextAt: Date.now(),
            status: "running",
            outcome: null,
            error: null,
        };

        // a new roll call on the same channel or room replaces one still running
        for(const other of state.requests){
            if(other.group && other.status === "running" && this.groupKey(other.via) === this.groupKey(route)){
                this.finish(other, "stopped", "Replaced by a new roll call.");
            }
        }

        state.requests.unshift(request);
        this.trimRequests();
        // everything after this works on the list's own copy, which Vue tracks. The
        // object built above is not, and changes made to it went unseen: the card
        // said Listening, with a Stop button, after the roll call had closed
        const live = state.requests[0];
        this.holdScreen();
        this.sendRollCall(live);
        return live;

    }

    /**
     * Keeps the list to twenty, dropping the oldest finished requests. A request
     * still running is never dropped: a roll call dropped while running kept
     * sending, with nothing left on screen to stop it.
     */
    static trimRequests() {
        while(state.requests.length > 20){
            let at = -1;
            for(let i = state.requests.length - 1; i >= 0; i--){
                if(state.requests[i].status !== "running"){
                    at = i;
                    break;
                }
            }
            if(at < 0){
                break;
            }
            state.requests.splice(at, 1);
        }
    }

    // a roll call only carries on while it is running and still in the list
    static isLive(request) {
        return request.status === "running" && state.requests.includes(request);
    }

    static currentRound(request) {
        return request.rounds[request.rounds.length - 1];
    }

    static async sendRollCall(request) {

        if(!this.isLive(request)){
            return;
        }
        timers.delete(request.tag);

        const round = this.currentRound(request);
        const message = {
            kind: Protocol.KIND.ROLL_CALL,
            tag: round.tag,
            to: Protocol.EVERYONE,
            from: GlobalState.selfInfo?.publicKey,
            name: this.ownName(),
            // asked again, the stations already heard stay silent
            heard: round.answers.map((a) => a.fromPrefixHex.slice(0, Protocol.HEARD_PREFIX_BYTES * 2)),
        };
        const readable = `Position roll call from ${this.ownName()} (answering needs Mesh-Emcomm)`;

        try {
            await this.transmit(request.via, message, readable);
            request.sent++;
            round.sent++;
            request.lastSentAt = Date.now();
            request.error = null;
        } catch(e) {
            console.log("roll call not sent", e);
            request.error = e?.message ?? String(e);
            if(GlobalState.connection == null){
                this.finish(request, "stopped", "The radio disconnected.");
                return;
            }
        }

        if(request.status !== "running"){
            return;
        }

        const { mode } = request;
        if(mode.type === "once" || request.sent >= mode.maxCount){
            // the last one: listen a while for answers given by hand, then close
            request.nextAt = null;
            request.listenUntil = Date.now() + ROLL_CALL_LISTEN_MILLIS;
            timers.set(request.tag, setTimeout(() => this.closeRollCall(request), ROLL_CALL_LISTEN_MILLIS));
            return;
        }

        request.nextAt = Date.now() + mode.intervalMinutes * MINUTE;
        timers.set(request.tag, setTimeout(() => {
            if(!this.isLive(request)){
                return;
            }
            timers.delete(request.tag);
            if(mode.type === "track"){
                // a fresh round: everyone answers again, from where they are now
                const tag = Protocol.newTag();
                request.tag = tag;
                request.rounds.push({ tag, startedAt: Date.now(), sent: 0, answers: [] });
                request.rounds.splice(0, Math.max(0, request.rounds.length - 10));
            }
            this.sendRollCall(request);
        }, mode.intervalMinutes * MINUTE));

    }

    static closeRollCall(request) {
        if(request.status !== "running"){
            return;
        }
        this.finish(request, "done", this.rollCallSummary(request));
    }

    static rollCallSummary(request) {
        const answers = this.currentRound(request).answers;
        if(answers.length === 0){
            return "No station answered.";
        }
        const positions = answers.filter((a) => a.kind === "position").length;
        const none = answers.filter((a) => a.kind === "none").length;
        const declined = answers.filter((a) => a.kind === "declined").length;
        const parts = [`${positions} with a position`];
        if(none > 0) parts.push(`${none} with none set`);
        if(declined > 0) parts.push(`${declined} declined`);
        return `${answers.length} ${answers.length === 1 ? "station" : "stations"} answered: ${parts.join(", ")}.`;
    }

    /**
     * Adds an answer to the round of one of this station's roll calls it
     * belongs to. An answer after the roll call closed still counts, marked late.
     */
    static noteRollCallAnswer(message, fromHex, name, nodeName) {
        for(const request of state.requests){
            if(!request.group){
                continue;
            }
            const round = request.rounds.find((r) => r.tag === message.tag);
            if(round == null){
                continue;
            }
            const kind = message.kind === Protocol.KIND.DECLINED ? "declined" : (message.hasPosition ? "position" : "none");
            const answer = { fromPrefixHex: fromHex, name, nodeName, kind, at: Date.now(), late: request.status !== "running" };
            const at = round.answers.findIndex((a) => a.fromPrefixHex === fromHex);
            if(at >= 0){
                round.answers.splice(at, 1, answer);
            } else {
                round.answers.push(answer);
            }
            if(request.status === "done"){
                request.outcome = this.rollCallSummary(request);
            }
            return true;
        }
        return false;
    }

    /** How long an automatic answer to a roll call may wait, at most, so answers do not collide. */
    static rollCallSpreadMillis() {
        const radio = Airtime.getRadioFromSelfInfo(GlobalState.selfInfo);
        if(radio == null){
            return ROLL_CALL_SPREAD_FLOOR_MILLIS;
        }
        const airtime = Airtime.getTimeOnAirMillis(ROLL_CALL_ANSWER_BYTES, radio);
        return Math.min(ROLL_CALL_SPREAD_CEILING_MILLIS, Math.max(ROLL_CALL_SPREAD_FLOOR_MILLIS, Math.round(airtime * ROLL_CALL_SPREAD_AIRTIMES)));
    }

    /**
     * Sends this station's position to everyone on a channel or in a room,
     * unasked. Returns what was sent.
     */
    static async shareOwn(via) {
        const own = await this.currentPosition();
        if(!own.has){
            throw new Error("this radio has no position set");
        }
        let flags = 0;
        if(own.live) flags |= Protocol.FLAG.LIVE_FIX;
        if(own.lastKnown) flags |= Protocol.FLAG.LAST_KNOWN;
        const message = {
            kind: Protocol.KIND.POSITION,
            tag: 0,
            to: Protocol.EVERYONE,
            from: GlobalState.selfInfo?.publicKey,
            name: this.ownName(),
            latitude: own.latitude,
            longitude: own.longitude,
            fixTime: own.fixTime,
            flags,
        };
        const readable = own.lastKnown
            ? `Last known position of ${this.ownName()} (not a current fix): ${Geo.formatDegrees(own.latitude, own.longitude)}`
            : `Position of ${this.ownName()}: ${Geo.formatDegrees(own.latitude, own.longitude)}`;
        await this.transmit(via, message, readable);
        return own;
    }

    static openGroup(action, via) {
        state.groupTarget = { action, via };
    }

    static closeGroup() {
        state.groupTarget = null;
    }

    static async sendAttempt(tag) {

        const request = this.find(tag);
        if(request == null || request.status !== "running"){
            return;
        }
        timers.delete(tag);

        const readable = `Position request from ${this.ownName()} (answering needs Mesh-Emcomm)`;
        const message = {
            kind: Protocol.KIND.REQUEST,
            tag: request.tag,
            to: request.target.publicKey,
            from: GlobalState.selfInfo?.publicKey,
            name: request.via.kind === "direct" ? "" : this.ownName(),
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
        // one more only if the count fixed when the request was made has one left
        request.remaining = Math.max(0, (request.remaining ?? 1) - 1);
        const more = mode.type === "repeat" && request.remaining > 0;
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
            // Said before the radio's note, because it is the likelier answer and
            // the note points somewhere else.
            //
            // On the bench a request went out on a channel the asked station does
            // not hold. It heard nothing, correctly, and showed no prompt. What the
            // asking station read was "it has no working GPS, or its owner does not
            // share location" — every word true of the radio that was asked as a
            // fallback, and every word pointing the operator at the wrong thing to
            // go and check.
            //
            // This app cannot know which channels another station holds, so this
            // names the possibility rather than claiming it.
            request.routeNote = request.via.kind === "channel"
                ? `A station only hears a channel it holds. Check that they are on ${request.via.name}.`
                : null;
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
        state.prompts = [];
        for(const timer of this.autoPending.values()){
            clearTimeout(timer);
        }
        this.autoPending.clear();
        // a form left open would send by the next radio's channel numbers
        state.requestTarget = null;
        state.groupTarget = null;
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

    /**
     * A post relayed by a room server, with its author's four byte key prefix
     * when it could be recovered, and the room's time for it. Returns true when
     * it was one of ours, so the caller keeps it out of the room's conversation.
     */
    static onRoomText(room, authorPrefix, text, postedAtSeconds) {
        const message = Protocol.fromDirectText(text);
        if(message == null){
            return false;
        }
        // the room says who wrote it. A payload claiming another author is not believed
        if(authorPrefix != null && authorPrefix.length > 0
            && Protocol.prefixHex(authorPrefix) !== Protocol.prefixHex(message.from).slice(0, authorPrefix.length * 2)){
            // shown as an ordinary post rather than hidden: it may be someone
            // passing on another station's position line, which is still chat
            console.log("room post carries another author's code; left as text");
            return false;
        }
        const via = { kind: "room", contactKeyHex: Utils.bytesToHex(room.publicKey), name: this.contactName(room) };
        // a room replays what was missed to anyone logging in, and an old request
        // must not be answered as if it were new. The post carries the room's time,
        // and a room's clock can be well out, so the age is taken against the room's
        // clock as read at login. Without that, a room running ten minutes slow would
        // make every live request look like a replay
        const offset = GlobalState.roomLogins?.[via.contactKeyHex]?.clockOffsetSeconds ?? 0;
        const ageSeconds = Math.floor(Date.now() / 1000) + offset - (postedAtSeconds ?? 0);
        const isRequest = message.kind === Protocol.KIND.REQUEST || message.kind === Protocol.KIND.ROLL_CALL;
        if(isRequest && postedAtSeconds && ageSeconds > ROOM_STALE_SECONDS){
            console.log(`room request ${ageSeconds}s old, a replay; ignored`);
            return true;
        }
        // a position is kept at the time it was posted, by this clock, so one the
        // room replays from hours ago does not take the place of a newer one
        const heardAt = postedAtSeconds && ageSeconds > 0 && ageSeconds < 7 * 24 * 3600
            ? Date.now() - ageSeconds * 1000
            : null;
        this.receive(message, via, heardAt);
        return true;
    }

    static isForMe(prefix) {
        const own = GlobalState.selfInfo?.publicKey;
        return own != null && Protocol.prefixHex(prefix) === Protocol.prefixHex(own);
    }

    // automatic answers to roll calls waiting their random moment, by station and
    // tag, so a repeat heard meanwhile is not answered twice, and a disconnect
    // cancels them: a different radio connected within the minute must not
    // answer for this one
    static autoPending = new Map();

    // heardAt: when it was sent, for a post a room replays; otherwise now
    static receive(message, via, heardAt = null) {

        const fromHex = Protocol.prefixHex(message.from);
        const known = this.contactByPrefix(message.from);
        const name = message.name || this.contactName(known) || fromHex;
        // the radio's own name, when the sender is a contact. On a channel the
        // name carried is the operator's callsign, which on the bench was the same
        // for both radios, so the list could not tell them apart without this
        const nodeName = this.contactName(known);

        if(message.kind === Protocol.KIND.REQUEST || message.kind === Protocol.KIND.ROLL_CALL){
            const rollCall = message.kind === Protocol.KIND.ROLL_CALL;
            if(rollCall ? !Protocol.isEveryone(message.to) : !this.isForMe(message.to)){
                return;
            }
            // this station's own roll call, heard back through a repeater
            if(this.isForMe(message.from)){
                return;
            }
            // on a channel or in a room, only where the operator has said to answer
            if(!this.answersOn(via)){
                return;
            }
            // asked again, a station already heard stays silent
            if(rollCall && Protocol.isHeard(message.heard, GlobalState.selfInfo?.publicKey)){
                return;
            }
            const request = {
                tag: message.tag,
                rollCall,
                fromPrefix: new Uint8Array(message.from),
                fromPrefixHex: fromHex,
                name,
                via,
                receivedAt: Date.now(),
                count: 1,
            };
            if(this.settings().autoAnswer){
                if(rollCall){
                    // every station on the channel answers at once otherwise, and
                    // their answers collide. A person answering by hand is spread
                    // out already, so only the automatic answer waits
                    const key = `${fromHex}:${message.tag}`;
                    if(this.autoPending.has(key)){
                        return;
                    }
                    const delay = Math.floor(Math.random() * this.rollCallSpreadMillis());
                    this.autoPending.set(key, setTimeout(() => {
                        this.autoPending.delete(key);
                        if(GlobalState.connection == null){
                            return;
                        }
                        this.answer(request, { messageToFollow: false }).catch((e) => console.log("automatic roll call answer failed", e));
                    }, delay));
                    return;
                }
                this.answer(request, { messageToFollow: false }).catch((e) => console.log("automatic position answer failed", e));
                return;
            }
            // one place in the queue per station: a repeat refreshes its entry,
            // keeping its place, rather than adding another
            const waiting = state.prompts.findIndex((p) => p.fromPrefixHex === fromHex);
            if(waiting >= 0){
                const earlier = state.prompts[waiting];
                state.prompts.splice(waiting, 1, { ...request, count: earlier.count + 1 });
            } else {
                state.prompts.push(request);
            }
            return;
        }

        const answersMine = this.isForMe(message.to);
        // a position sent to everyone, unasked
        const shared = Protocol.isEveryone(message.to);

        if(message.kind === Protocol.KIND.POSITION){
            this.record({
                heardAt,
                shared,
                source: "app",
                fromPrefixHex: fromHex,
                name,
                nodeName,
                latitude: message.latitude,
                longitude: message.longitude,
                hasPosition: message.hasPosition,
                liveFix: message.liveFix,
                lastKnown: message.lastKnown,
                manual: message.manual,
                fixTime: message.fixTime,
                messageToFollow: message.messageToFollow,
                via,
                requestedByUs: answersMine,
            });
        } else if(message.kind === Protocol.KIND.DECLINED){
            this.record({
                heardAt,
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

        // an answer to one of this station's roll calls joins its list; the roll
        // call runs on, since others are still answering
        // it may also be the station a single request of ours is waiting on: its
        // answer to the roll call answers that too
        this.noteRollCallAnswer(message, fromHex, name, nodeName);

        // an answer to one of ours ends it, matched on the tag, or failing that
        // on the station, since an answer to an earlier round still counts. A
        // request that gave up is still closed by an answer carrying its own tag:
        // a person answers a prompt, and on the bench one answered a single
        // request a minute after it had been marked "No answer"
        const request = state.requests.find((r) => !r.group && r.status === "running" && r.tag === message.tag)
            ?? state.requests.find((r) => !r.group && r.status === "running" && r.target.prefixHex === fromHex)
            ?? state.requests.find((r) => !r.group && r.status === "gave up" && r.tag === message.tag && r.target.prefixHex === fromHex);
        if(request == null){
            return;
        }
        const late = request.status === "gave up" ? " The answer came after this app had stopped asking." : "";
        request.radioNote = null;
        request.routeNote = null;
        if(message.kind === Protocol.KIND.DECLINED){
            this.finish(request, "declined", `Declined by ${name}.${late}`);
        } else if(!message.hasPosition){
            this.finish(request, "answered", `${name} answered, but has no position set.${late}`);
        } else {
            this.finish(request, "answered", (message.messageToFollow ? `${name} answered, with a message to follow.` : `${name} answered.`) + late);
        }

    }

    /**
     * Keeps a report, newest first by when it was heard. Nearly always that is
     * now; a post a room replays at login carries its own, earlier time, and goes
     * in behind anything newer rather than on top of it.
     */
    static record(report) {
        const { heardAt, ...rest } = report;
        const receivedAt = heardAt ?? Date.now();
        const entry = { ...rest, receivedAt, id: `${report.fromPrefixHex}-${receivedAt}-${Math.random()}` };
        const at = state.reports.findIndex((r) => r.receivedAt <= receivedAt);
        state.reports.splice(at < 0 ? state.reports.length : at, 0, entry);
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

    /** Whether a position the operator typed in is one the radio can hold. */
    static isValidEntry(latitude, longitude) {
        const lat = Number(latitude);
        const lon = Number(longitude);
        return latitude !== "" && longitude !== "" && latitude != null && longitude != null
            && Geo.isPosition(lat, lon);
    }

    /**
     * Writes a position the operator has typed in to the radio, where it becomes
     * the position it holds and adverts, and so the last known one for any later
     * answer. Read back afterwards rather than assumed.
     */
    static async saveManualPosition(latitude, longitude) {
        if(!this.isValidEntry(latitude, longitude)){
            throw new Error("that is not a position: latitude -90 to 90, longitude -180 to 180, and not 0, 0");
        }
        await Connection.setAdvertLatLong(Math.round(Number(latitude) * 1e6), Math.round(Number(longitude) * 1e6));
        await Connection.loadSelfInfo(Connection.READ_TIMEOUT_MILLIS);
    }

    /**
     * Brings this station's own position up to date from the GPS.
     *
     * The radio is asked again rather than trusted: a receiver that had no fix at
     * connect time may have one now, and one that had a fix may have lost it. A
     * live fix is written back as the advert position, so what this station sends
     * and adverts is where it is now. Returns { updated, position, reason }, and
     * the caller offers an entry by hand when it could not be done.
     */
    static async updateFromGps() {

        if(GlobalState.connection == null){
            throw new Error(Connection.DISCONNECTED);
        }

        await Connection.probeForLiveGps();
        if(GlobalState.gpsStatus !== "live"){
            return { updated: false, reason: "no live GPS fix" };
        }

        const position = await Connection.getPosition();
        if(position == null){
            return { updated: false, reason: "the GPS gave no position" };
        }

        await Connection.setAdvertLatLong(
            Math.round(position.latitude * 1e6),
            Math.round(position.longitude * 1e6),
        );
        await Connection.loadSelfInfo(Connection.READ_TIMEOUT_MILLIS);
        return { updated: true, position: position };

    }

    /**
     * Sends this station's position in answer to a request.
     *
     * manualPosition, when given, is one the operator has just typed in because
     * the radio held only a last known one. It is saved to the radio first, then
     * sent marked as entered by hand just now: current by their word, not a GPS.
     */
    static async answer(request, { messageToFollow = false, manualPosition = null } = {}) {
        let own;
        if(manualPosition){
            await this.saveManualPosition(manualPosition.latitude, manualPosition.longitude);
            const held = this.ownPosition();
            own = { ...held, live: false, lastKnown: false, manual: true, fixTime: Math.floor(Date.now() / 1000) };
        } else {
            own = await this.currentPosition();
        }
        let flags = 0;
        if(messageToFollow) flags |= Protocol.FLAG.MESSAGE_TO_FOLLOW;
        if(own.live) flags |= Protocol.FLAG.LIVE_FIX;
        if(own.lastKnown) flags |= Protocol.FLAG.LAST_KNOWN;
        if(own.manual) flags |= Protocol.FLAG.MANUAL;
        if(!own.has) flags |= Protocol.FLAG.NO_POSITION;
        const message = {
            kind: Protocol.KIND.POSITION,
            tag: request.tag,
            to: request.fromPrefix,
            from: GlobalState.selfInfo?.publicKey,
            name: request.via.kind === "direct" ? "" : this.ownName(),
            latitude: own.latitude,
            longitude: own.longitude,
            fixTime: own.fixTime,
            flags,
        };
        // stock clients see this line, so it says what kind of position it is too
        const readable = !own.has
            ? `${this.ownName()} has no position set`
            : own.manual
                ? `Position of ${this.ownName()} (entered by hand): ${Geo.formatDegrees(own.latitude, own.longitude)}`
            : own.lastKnown
                ? `Last known position of ${this.ownName()} (not a current fix): ${Geo.formatDegrees(own.latitude, own.longitude)}`
                : `Position of ${this.ownName()}: ${Geo.formatDegrees(own.latitude, own.longitude)}`;
        await this.transmit(this.answerRoute(request), message, readable);
        this.removePrompt(request);
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
        this.removePrompt(request);
    }

    /** A request is answered the way it came: on its channel, in its room, or direct. */
    static answerRoute(request) {
        if(request.via.kind === "channel" || request.via.kind === "room"){
            return request.via;
        }
        const contact = GlobalState.contacts.find((c) => Utils.bytesToHex(c.publicKey) === request.via.contactKeyHex);
        return { kind: "direct", contact };
    }

    /** Takes a station's request out of the queue, once answered or put off. */
    static removePrompt(request) {
        const at = state.prompts.findIndex((p) => p.fromPrefixHex === request?.fromPrefixHex);
        if(at >= 0){
            state.prompts.splice(at, 1);
        }
    }

    /**
     * Puts off the request on screen, and brings up the next. A station that
     * asks again comes back to the end of the queue.
     */
    static dismissPrompt() {
        state.prompts.shift();
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
