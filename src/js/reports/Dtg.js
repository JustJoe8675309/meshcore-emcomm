/**
 * Composing and reading back date time groups.
 *
 * A DTG can be exact, approximate, or a range. The qualifier is carried in the
 * value itself rather than in a separate field, because a separate tag would cost
 * bytes on every report to support the minority of reports that need it. An exact
 * DTG is therefore byte for byte what it always was.
 *
 *   exact                191745L SEP
 *   approximate          ABT 191745L SEP
 *   between, same day    191700-1745L SEP
 *   between, over midnight   191700-201745L SEP
 *
 * A range states the day, zone and month once where it can, which saves seven
 * bytes over repeating the whole group. That compaction only applies when both
 * ends match the expected shape exactly. Anything else is joined verbatim, so
 * unusual input still transmits rather than being mangled or refused.
 */

const APPROX_PREFIX = "ABT ";

// DDHHMM, zone letter, month. e.g "191745L SEP"
const DTG_SHAPE = /^(\d{2})(\d{2})(\d{2})([LZ]) ([A-Z]{3})$/;

// a compacted range sharing a day: "191700-1745L SEP"
const RANGE_SAME_DAY = /^(\d{2})(\d{4})-(\d{4})([LZ]) ([A-Z]{3})$/;

// a compacted range crossing midnight: "191700-201745L SEP"
const RANGE_CROSS_DAY = /^(\d{6})-(\d{6})([LZ]) ([A-Z]{3})$/;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

class Dtg {

    static get MODE_EXACT() { return "exact"; }
    static get MODE_APPROX() { return "approx"; }
    static get MODE_BETWEEN() { return "between"; }

    static get APPROX_PREFIX() { return APPROX_PREFIX; }

    /**
     * Current time as a date time group in the given zone.
     */
    static format(date = new Date(), zone = "local") {

        const isZulu = zone === "zulu";
        const pad = (value) => value.toString().padStart(2, "0");

        const day = isZulu ? date.getUTCDate() : date.getDate();
        const hours = isZulu ? date.getUTCHours() : date.getHours();
        const minutes = isZulu ? date.getUTCMinutes() : date.getMinutes();
        const month = MONTHS[isZulu ? date.getUTCMonth() : date.getMonth()];

        return `${pad(day)}${pad(hours)}${pad(minutes)}${isZulu ? "Z" : "L"} ${month}`;

    }

    /**
     * Whether a value is a plain date time group we can safely take apart.
     */
    static isDtgShape(value) {
        return DTG_SHAPE.test((value ?? "").trim());
    }

    /**
     * Builds the value that will be transmitted.
     *
     * A range with only one end filled in degrades to that single time rather than
     * emitting a dangling separator, since a half typed range is a normal state
     * while the operator is still working.
     */
    static compose(mode, from, to) {

        const start = (from ?? "").trim();
        const end = (to ?? "").trim();

        if(mode === this.MODE_APPROX){
            return start === "" ? "" : APPROX_PREFIX + start;
        }

        if(mode === this.MODE_BETWEEN){

            if(start === "" || end === ""){
                return start !== "" ? start : end;
            }

            const compacted = this.compactRange(start, end);
            return compacted ?? `${start}-${end}`;

        }

        return start;

    }

    /**
     * Collapses a range that shares a zone and month, or null when it cannot be
     * done safely and the two ends should simply be joined.
     */
    static compactRange(from, to) {

        const start = DTG_SHAPE.exec(from);
        const end = DTG_SHAPE.exec(to);

        if(!start || !end){
            return null;
        }

        const [, startDay, startHour, startMinute, startZone, startMonth] = start;
        const [, endDay, endHour, endMinute, endZone, endMonth] = end;

        // a different zone or month cannot be stated once, so do not try
        if(startZone !== endZone || startMonth !== endMonth){
            return null;
        }

        // same day: the second time needs no day at all
        if(startDay === endDay){
            return `${startDay}${startHour}${startMinute}-${endHour}${endMinute}${startZone} ${startMonth}`;
        }

        return `${startDay}${startHour}${startMinute}-${endDay}${endHour}${endMinute}${startZone} ${startMonth}`;

    }

    /**
     * Reads a transmitted value back into the parts that produced it.
     * Anything unrecognised is reported as an exact value, which is the mode that
     * leaves the operator's text alone.
     */
    static parse(value) {

        const text = (value ?? "").trim();

        if(text.startsWith(APPROX_PREFIX)){
            return {
                mode: this.MODE_APPROX,
                from: text.slice(APPROX_PREFIX.length).trim(),
                to: "",
            };
        }

        const crossDay = RANGE_CROSS_DAY.exec(text);
        if(crossDay){
            const [, start, end, zone, month] = crossDay;
            return {
                mode: this.MODE_BETWEEN,
                from: `${start}${zone} ${month}`,
                to: `${end}${zone} ${month}`,
            };
        }

        const sameDay = RANGE_SAME_DAY.exec(text);
        if(sameDay){
            const [, day, startTime, endTime, zone, month] = sameDay;
            return {
                mode: this.MODE_BETWEEN,
                from: `${day}${startTime}${zone} ${month}`,
                to: `${day}${endTime}${zone} ${month}`,
            };
        }

        // an uncompacted range, joined verbatim because one end was not a plain DTG
        const separator = text.indexOf("-");
        if(separator > 0 && separator < text.length - 1){
            return {
                mode: this.MODE_BETWEEN,
                from: text.slice(0, separator).trim(),
                to: text.slice(separator + 1).trim(),
            };
        }

        return {
            mode: this.MODE_EXACT,
            from: text,
            to: "",
        };

    }

}

export default Dtg;
