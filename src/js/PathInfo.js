// What a contact's out path length means, in one place.
//
// The firmware stores `out_path_len` as a `uint8_t` with `OUT_PATH_UNKNOWN` of
// `0xFF` for "no path, flood it", and a real path can be at most `MAX_PATH_SIZE`,
// which is 64. `meshcore.js` reads the byte as signed, so `0xFF` arrives as `-1`
// and every legitimate length, being under 128, arrives unchanged.
//
// The views used to render anything that was not -1, 0 or 1 as "<n> Hops"
// verbatim. That is fine until a byte outside the legitimate range turns up, and
// then it states a hop count that cannot exist rather than admitting it does not
// know. A station listed as 128 hops away is not far away; it is not understood.
// Same family as the rest of this app's faults: a confident wrong answer where
// the honest one is "unknown".

// MAX_PATH_SIZE in the firmware
const MAX_PATH_LENGTH = 64;

// OUT_PATH_UNKNOWN (0xFF) once meshcore.js has read it as a signed byte
const NO_PATH = -1;

class PathInfo {

    static get MAX_PATH_LENGTH() {
        return MAX_PATH_LENGTH;
    }

    static get NO_PATH() {
        return NO_PATH;
    }

    // a length the firmware could actually have produced for a known route
    static isKnownPath(outPathLen) {
        return Number.isInteger(outPathLen) && outPathLen >= 0 && outPathLen <= MAX_PATH_LENGTH;
    }

    static isFlood(outPathLen) {
        return outPathLen === NO_PATH;
    }

    // true for a value that is neither a route nor the no-path sentinel, which
    // means the app does not understand it and must not present it as a distance
    static isUnknown(outPathLen) {
        return !this.isFlood(outPathLen) && !this.isKnownPath(outPathLen);
    }

    static describe(outPathLen) {
        if(this.isFlood(outPathLen)){
            return "No Path (Flood)";
        }
        if(outPathLen === 0){
            return "Direct";
        }
        if(outPathLen === 1){
            return "1 Hop";
        }
        if(this.isKnownPath(outPathLen)){
            return `${outPathLen} Hops`;
        }
        // shown rather than hidden: a route the app cannot read is worth knowing
        // about, and the raw value is what makes it reportable
        return `Unknown path (${outPathLen})`;
    }

}

export default PathInfo;
