/**
 * Whether the station is on a charger.
 *
 * The radio does not say. The companion protocol reports battery millivolts and
 * nothing else about the cell -- no charging flag, no current -- so this is
 * inferred from the voltage, and only claimed when the voltage has done something
 * a draining battery cannot.
 *
 * What the drains on the bench established, at one reading a minute over
 * Utils.getBatteryPercentage's 8 mV per point:
 *   - a draining radio falls 3-5 points an hour, under 1 mV a minute;
 *   - the reading bounces up to 2 points (16 mV) between consecutive samples,
 *     in both directions, at every level (24/26, 22/24, 11/13, 7/9 on node 2);
 *   - a charger lifts the terminal voltage at once: node 2 went 5% to 24% between
 *     one reading and the next the moment it was plugged in -- but the climb after
 *     that slows as the cell fills: a point a minute through the twenties, then
 *     2% in four minutes in the thirties, and less again above.
 * So a rise of 30 mV or more across the last half hour is a charger, with a margin
 * over the bounce, and nothing a drain can do: thirty minutes of drain is a fall of
 * 15 mV. The window was five minutes at first, and a reconnect in the middle of a
 * slow charge never latched -- 16 mV in five minutes is a charger and a bounce
 * both. A plug-in while connected still shows at once, from the jump. Once seen
 * it is held, since a cell near full stops rising, and let go when the voltage
 * drops 24 mV below the highest seen -- the lift leaving as the plug comes out,
 * which again the bounce alone cannot reach.
 */
export default class Battery {

    /** the smallest rise over the window that is read as a charger */
    static RISE_MILLIVOLTS = 30;

    /** how far below the peak the reading must fall before the charger is gone */
    static FALL_MILLIVOLTS = 24;

    /** readings compared across; one a minute, so half an hour */
    static WINDOW = 31;

    static readings = [];
    static charging = false;
    static peak = null;

    /**
     * Takes the latest reading and says whether the station is charging now.
     * The first reading after a connect says nothing on its own.
     */
    static observe(millivolts) {
        if(!Number.isFinite(millivolts)){
            return this.charging;
        }

        this.readings.push(millivolts);
        if(this.readings.length > this.WINDOW){
            this.readings.shift();
        }

        if(this.charging){
            this.peak = Math.max(this.peak, millivolts);
            if(this.peak - millivolts >= this.FALL_MILLIVOLTS){
                this.charging = false;
                this.peak = null;
                // the readings so far were on the charger; a fresh window so
                // that the next rise is judged against post-unplug values
                this.readings = [millivolts];
            }
            return this.charging;
        }

        const lowest = Math.min(...this.readings);
        if(millivolts - lowest >= this.RISE_MILLIVOLTS){
            this.charging = true;
            this.peak = millivolts;
        }
        return this.charging;
    }

    /** Forget everything: the readings belonged to a link that has closed. */
    static reset() {
        this.readings = [];
        this.charging = false;
        this.peak = null;
    }

}
