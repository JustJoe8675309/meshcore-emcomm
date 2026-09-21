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

        const schedule = this.get(nodePublicKeyHex);

        for(const kind of KINDS){

            const minutes = kind === "flood" ? schedule.floodMinutes : schedule.zeroHopMinutes;

            if(minutes <= 0){
                continue;
            }

            this.timers[kind] = setInterval(() => {
                this.sendOnce(kind);
            }, minutes * 60 * 1000);

        }

        return schedule;

    }

    /** Stops every timer. Safe to call when none are running. */
    static stop() {
        for(const kind of KINDS){
            clearInterval(this.timers[kind]);
            delete this.timers[kind];
        }
    }

    /** Which kinds are currently running, for the ui to report honestly. */
    static running() {
        return KINDS.filter((kind) => this.timers[kind] != null);
    }

}

export default AdvertSchedule;
