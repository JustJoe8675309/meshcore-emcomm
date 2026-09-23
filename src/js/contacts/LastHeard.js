const DAY_SECONDS = 24 * 60 * 60;

/**
 * When a station was last heard, as far as it can be trusted.
 *
 * `lastAdvert` is not when this radio heard the advert: it is the timestamp the
 * *other* station put in it, from its own clock. A node with no GPS and no app to
 * set its clock can be years out, and on node 1 one contact carried an advert
 * dated four years in the future.
 *
 * That matters because the one list sorts by Heard Recently by default, so a
 * station with a broken clock sits permanently at the top — the row an operator
 * would most want to trust during a net. The rule here is the operator's: a time
 * too far ahead to be real is read as now, which puts the station at the top only
 * until something is genuinely heard after it.
 *
 * The same thresholds decide which contacts EMCOMM mode may trim, so they live
 * here and both use them. A day of tolerance covers ordinary clock drift between
 * two radios without treating it as a fault.
 */
class LastHeard {

    /** Before this, a timestamp is not a clock being wrong, it is a clock unset. */
    static EARLIEST_PLAUSIBLE = Date.UTC(2020, 0, 1) / 1000;

    /** How far ahead of us a station's clock may be before it is not believed. */
    static FUTURE_TOLERANCE_SECONDS = DAY_SECONDS;

    /** True when a timestamp cannot be trusted, whichever way it is wrong. */
    static isUnreadable(lastAdvert, nowSeconds = Math.floor(Date.now() / 1000)) {
        if(!Number.isInteger(lastAdvert)){
            return true;
        }
        if(lastAdvert < this.EARLIEST_PLAUSIBLE){
            return true;
        }
        return lastAdvert > nowSeconds + this.FUTURE_TOLERANCE_SECONDS;
    }

    /**
     * The time to sort and show, or null when there is nothing to believe.
     *
     * A time from the future is read as now rather than dropped: the station was
     * heard, that much is certain, and only its clock is wrong. A time from before
     * the epoch of plausibility is dropped, because that is a radio that has never
     * had its clock set and its adverts say nothing about when.
     */
    static at(lastAdvert, nowSeconds = Math.floor(Date.now() / 1000)) {

        if(!Number.isInteger(lastAdvert) || lastAdvert < this.EARLIEST_PLAUSIBLE){
            return null;
        }

        return lastAdvert > nowSeconds + this.FUTURE_TOLERANCE_SECONDS ? nowSeconds : lastAdvert;

    }

}

export default LastHeard;
