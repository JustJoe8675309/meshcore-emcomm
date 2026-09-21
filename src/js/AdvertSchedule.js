/**
 * Repeating adverts.
 *
 * An advert is how a node tells the mesh it exists. Both kinds are already on the
 * header menu as single presses, which is fine when somebody is watching the app.
 * During a net nobody is, and a station that adverted once at sign-on drifts out
 * of everybody's contact list as paths change around it.
 *
 * The two kinds cost very different amounts of air. A zero hop advert is heard
 * only by stations in direct range and is repeated by nobody, so it is cheap and
 * can run often. A flood routed advert is rebroadcast by every repeater that hears
 * it, so its cost is multiplied by the size of the mesh. Running one every few
 * minutes is how a single station drowns a net, which is why the interval is asked
 * for rather than assumed, and why anything under an hour is called out.
 *
 * Intervals are per node, because they are a property of the station's role: a
 * base running flood adverts hourly and a handheld running zero hop adverts every
 * ten minutes are both reasonable, and they are not the same setting.
 */

import GlobalState from "./GlobalState.js";
import Connection from "./Connection.js";

const STATE_PREFIX = "advert_schedule";

/** Below this, a flood advert is costing the mesh more than it is worth. */
const FLOOD_CAUTION_MINUTES = 60;

/** Nothing sensible is faster than this, and a typo of 0.1 should not transmit. */
const MIN_MINUTES = 1;

/** Guards against a stray large number turning into a timer that never fires. */
const MAX_MINUTES = 24 * 60;

const KINDS = ["zeroHop", "flood"];

class AdvertSchedule {

    static FLOOD_CAUTION_MINUTES = FLOOD_CAUTION_MINUTES;
    static MIN_MINUTES = MIN_MINUTES;
    static MAX_MINUTES = MAX_MINUTES;

    // live timers, by kind. module level so a second page mount cannot start a
    // second set of them and double the transmit rate
    static timers = {};

    // the node the last-sent times belong to; a different radio starts afresh
    static node = null;

    // the screen wake lock held while a schedule runs, if the browser gives one
    static wakeLock = null;

    // how late an advert may be before the ui calls it overdue. Sends land a second
    // or two after the minute on the bench; this is generous so a slow radio does
    // not raise a false alarm
    static OVERDUE_GRACE_MILLIS = 30000;

    /**
     * Reads a minute count the way a text field hands it over.
     *
     * Blank, zero and nonsense all mean off, because that is what an operator who
     * cleared the field meant. A real value is clamped rather than rejected: the
     * field is a number box and the failure it protects against is a slip, not an
     * argument.
     */
    static normaliseMinutes(value) {

        if(value === null || value === undefined || value === ""){
            return 0;
        }

        const minutes = Math.round(Number(value));

        if(!Number.isFinite(minutes) || minutes <= 0){
            return 0;
        }

        return Math.min(Math.max(minutes, MIN_MINUTES), MAX_MINUTES);

    }

    /** True when a flood interval is fast enough to be worth warning about. */
    static isFloodTooFast(minutes) {
        const value = this.normaliseMinutes(minutes);
        return value > 0 && value < FLOOD_CAUTION_MINUTES;
    }

    static storageKey(nodePublicKeyHex) {
        return `${STATE_PREFIX}:${nodePublicKeyHex}`;
    }

    /** The saved intervals for a node, both off if nothing was ever set. */
    static get(nodePublicKeyHex) {

        const off = { zeroHopMinutes: 0, floodMinutes: 0 };

        if(nodePublicKeyHex == null){
            return off;
        }

        try {
            const raw = window.localStorage.getItem(this.storageKey(nodePublicKeyHex));
            if(raw == null){
                return off;
            }
            const saved = JSON.parse(raw);
            return {
                zeroHopMinutes: this.normaliseMinutes(saved?.zeroHopMinutes),
                floodMinutes: this.normaliseMinutes(saved?.floodMinutes),
            };
        } catch(e) {
            // a corrupt entry must not stop the page loading, and off is the safe
            // reading of "we do not know": it transmits nothing
            return off;
        }

    }

    /** Saves both intervals and returns what was actually stored. */
    static set(nodePublicKeyHex, { zeroHopMinutes, floodMinutes }) {

        const saved = {
            zeroHopMinutes: this.normaliseMinutes(zeroHopMinutes),
            floodMinutes: this.normaliseMinutes(floodMinutes),
        };

        if(nodePublicKeyHex == null){
            return saved;
        }

        try {
            window.localStorage.setItem(this.storageKey(nodePublicKeyHex), JSON.stringify(saved));
        } catch(e) {
            console.log("could not save advert schedule", e);
        }

        return saved;

    }

    /** Sends one advert of the given kind, queued behind any other command. */
    static async sendOnce(kind) {

        const connection = GlobalState.connection;

        if(connection == null){
            return false;
        }

        try {
            await Connection.exclusive(() => kind === "flood"
                ? connection.sendFloodAdvert()
                : connection.sendZeroHopAdvert());
            // recorded only on success: this is what the operator reads to know the
            // schedule is really transmitting
            GlobalState.advertLastSent = { ...GlobalState.advertLastSent, [kind]: Date.now() };
            return true;
        } catch(e) {
            // a missed advert is not worth interrupting the operator over: the next
            // one is along shortly, and the radio may simply have been busy
            console.log(`scheduled ${kind} advert failed`, e);
            return false;
        }

    }

    /**
     * Starts the timers for the connected node.
     *
     * Nothing is sent as the timer starts. An advert on every page load would put
     * a burst on the air every time the app is reopened, which during testing is
     * often, and the station has just adverted at connect anyway.
     */
    static start(nodePublicKeyHex) {

        this.stop();

        // the times belong to the radio they were sent through
        if(this.node !== nodePublicKeyHex){
            this.node = nodePublicKeyHex;
            GlobalState.advertLastSent = { zeroHop: null, flood: null };
        }

        const schedule = this.get(nodePublicKeyHex);
        GlobalState.advertStartedAt = Date.now();
        GlobalState.advertIntervals = { zeroHop: schedule.zeroHopMinutes, flood: schedule.floodMinutes };

        for(const kind of KINDS){

            const minutes = kind === "flood" ? schedule.floodMinutes : schedule.zeroHopMinutes;

            if(minutes <= 0){
                continue;
            }

            this.timers[kind] = setInterval(() => {
                this.sendOnce(kind);
            }, minutes * 60 * 1000);

        }

        this.publishRunning();

        if(this.running().length > 0){
            this.holdScreen();
        }

        return schedule;

    }

    /** Stops every timer. Safe to call when none are running. */
    static stop() {
        for(const kind of KINDS){
            clearInterval(this.timers[kind]);
            delete this.timers[kind];
        }
        this.publishRunning();
        this.releaseScreen();
    }

    /**
     * When the next advert of a kind is due, or null if that kind is off.
     *
     * Counted from whichever is later, the last send or the start: applying a
     * schedule restarts the timer, so the first one after that is a full interval
     * from the press.
     */
    static nextDue(kind) {
        const minutes = GlobalState.advertIntervals?.[kind] ?? 0;
        if(minutes <= 0 || !this.running().includes(kind)){
            return null;
        }
        const from = Math.max(GlobalState.advertLastSent?.[kind] ?? 0, GlobalState.advertStartedAt ?? 0);
        return from + minutes * 60 * 1000;
    }

    /**
     * True when a running kind has missed its time by more than the grace.
     *
     * On the bench a locked phone stopped sending a minute after locking and the
     * status line went on saying the schedule was running. This is the part that
     * says it is not.
     */
    static isOverdue(kind, now = Date.now()) {
        const due = this.nextDue(kind);
        return due != null && now > due + this.OVERDUE_GRACE_MILLIS;
    }

    /**
     * Asks the browser to keep the screen on while a schedule runs.
     *
     * A phone that locks suspends the page, and with it the timer: measured, it
     * stopped sending a minute after locking and missed nine in a row. The
     * companion firmware has no advert timer of its own to fall back on, so the
     * page staying awake is the only thing that keeps a phone adverting. This
     * stops the screen timing out; it cannot stop somebody pressing the power
     * button, which the status line then reports as overdue.
     *
     * Browsers drop the lock whenever the page is hidden, so it is taken again
     * when the page comes back.
     */
    static async holdScreen() {

        this.listenForReturn();

        if(this.wakeLock != null){
            return;
        }

        if(typeof navigator === "undefined" || !navigator.wakeLock){
            GlobalState.advertWakeLock = "unsupported";
            return;
        }

        if(document.visibilityState !== "visible"){
            GlobalState.advertWakeLock = "waiting";
            return;
        }

        try {
            const lock = await navigator.wakeLock.request("screen");
            // the schedule may have been stopped while the request was out
            if(this.running().length === 0){
                await lock.release();
                return;
            }
            this.wakeLock = lock;
            GlobalState.advertWakeLock = "held";
            lock.addEventListener("release", () => {
                if(this.wakeLock === lock){
                    this.wakeLock = null;
                    GlobalState.advertWakeLock = this.running().length > 0 ? "waiting" : "none";
                }
            });
        } catch(e) {
            // refused, which a browser may do on low battery or by policy
            console.log("could not keep the screen on", e);
            GlobalState.advertWakeLock = "failed";
        }

    }

    static releaseScreen() {
        const lock = this.wakeLock;
        this.wakeLock = null;
        GlobalState.advertWakeLock = "none";
        if(lock != null){
            lock.release().catch(() => {});
        }
    }

    // takes the lock again when the page comes back into view. Registered once
    static listenForReturn() {
        if(this.listening || typeof document === "undefined"){
            return;
        }
        this.listening = true;
        document.addEventListener("visibilitychange", () => {
            if(document.visibilityState === "visible" && this.running().length > 0){
                this.holdScreen();
            }
        });
    }

    /** Mirrors the live timers into reactive state, for the ui to read. */
    static publishRunning() {
        GlobalState.advertScheduleRunning = KINDS.filter((kind) => this.timers[kind] != null);
    }

    /** Which kinds are currently running, for the ui to report honestly. */
    static running() {
        return KINDS.filter((kind) => this.timers[kind] != null);
    }

}

export default AdvertSchedule;
