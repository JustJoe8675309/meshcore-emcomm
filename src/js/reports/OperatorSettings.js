import { reactive } from "vue";

/**
 * Operator preferences for report traffic, stored in this browser.
 *
 * These are deliberately separate from the device settings. They describe the
 * person operating, not the radio, and they stay put when the device is changed
 * or reflashed.
 */

const STORAGE_KEY = "emcomm_operator_settings";

function readStored() {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch(e) {
        console.log("failed to read operator settings", e);
        return {};
    }
}

const stored = readStored();

const state = reactive({

    // The operator's callsign. This is not the same thing as the device advert
    // name: that names the radio, and usually carries a suffix or the owner's
    // name, so it does not belong in a formal CALL field.
    callsign: typeof stored.callsign === "string" ? stored.callsign : "",

    // "local" or "zulu". Plenty of nets run on zulu, and a date time group
    // labelled L when the net expects Z is wrong in a way nobody notices until
    // the times do not line up.
    dtgZone: stored.dtgZone === "zulu" ? "zulu" : "local",

    // NWS SKYWARN spotter number, if the operator has one. Optional: plenty of
    // spotters report by callsign alone, and an invented number would be worse
    // than none at all to whoever relays the report to the weather service.
    skywarnNumber: typeof stored.skywarnNumber === "string" ? stored.skywarnNumber : "",

});

class OperatorSettings {

    static get state() {
        return state;
    }

    static get callsign() {
        return state.callsign.trim();
    }

    static setCallsign(callsign) {
        state.callsign = callsign ?? "";
        this.persist();
    }

    static get skywarnNumber() {
        return state.skywarnNumber.trim();
    }

    /**
     * How this station identifies itself on a SKYWARN report: callsign and spotter
     * number together when a number is set, callsign alone when it is not.
     */
    static get spotterId() {

        const callsign = this.callsign;
        const number = this.skywarnNumber;

        if(callsign !== "" && number !== ""){
            return `${callsign}/${number}`;
        }

        return callsign !== "" ? callsign : number;

    }

    static setSkywarnNumber(number) {
        state.skywarnNumber = number ?? "";
        this.persist();
    }

    static setDtgZone(zone) {
        state.dtgZone = zone === "zulu" ? "zulu" : "local";
        this.persist();
    }

    static persist() {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
                callsign: state.callsign,
                dtgZone: state.dtgZone,
                skywarnNumber: state.skywarnNumber,
            }));
        } catch(e) {
            // private browsing, or storage full. not worth interrupting the operator over.
            console.log("failed to save operator settings", e);
        }
    }

    /**
     * Date time group in the operator's chosen zone, e.g "191830L SEP" or "190030Z SEP".
     * Day of month, hour, minute, zone letter, then the month, which is short enough
     * to be worth the bytes and removes the ambiguity a bare day would leave.
     */
    static formatDtg(date = new Date()) {

        const isZulu = state.dtgZone === "zulu";
        const pad = (value) => value.toString().padStart(2, "0");
        const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

        const day = isZulu ? date.getUTCDate() : date.getDate();
        const hours = isZulu ? date.getUTCHours() : date.getHours();
        const minutes = isZulu ? date.getUTCMinutes() : date.getMinutes();
        const month = months[isZulu ? date.getUTCMonth() : date.getMonth()];

        return `${pad(day)}${pad(hours)}${pad(minutes)}${isZulu ? "Z" : "L"} ${month}`;

    }

}

export default OperatorSettings;
