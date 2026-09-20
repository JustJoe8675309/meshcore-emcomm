class Utils {

    static async sleep(millis) {
        return await new Promise((resolve, reject) => setTimeout(resolve, millis));
    }

    // rejects if the provided promise doesn't settle in time
    // used to guard against firmware that never replies to a command
    static async withTimeout(promise, millis) {
        return await Promise.race([
            promise,
            new Promise((resolve, reject) => {
                setTimeout(() => reject(new Error("timed out")), millis);
            }),
        ]);
    }

    static bytesToHex(uint8Array) {
        return Array.from(uint8Array).map(byte => byte.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Copies text, and returns what happened rather than announcing it.
     *
     * A modal for a routine confirmation is a poor trade anywhere, and a bad one in
     * an app used one handed on a phone during a net: it blocks the whole page until
     * dismissed. Callers show the outcome inline where the operator is already
     * looking.
     */
    static async copyToClipboard(text) {

        // make sure copy to clipboard is supported
        if(!navigator.clipboard || !navigator.clipboard.writeText){
            return { ok: false, message: "Clipboard not available. The page must be served over https." };
        }

        // copy value to clipboard.
        // the browser refuses this when the page is not focused, or when clipboard
        // permission was denied. without a catch that failure is completely silent,
        // which is worse than useless: you believe you have the text and do not.
        try {
            await navigator.clipboard.writeText(text);
        } catch(e) {
            console.log("failed to copy to clipboard", e);
            return { ok: false, message: "Could not copy. The browser blocked it, usually because the page lost focus." };
        }

        return { ok: true, message: "Copied to clipboard." };

    }

    static isUint8ArrayEqual(a, b) {

        // ensure they are the same length
        if(a.length !== b.length){
            return false;
        }

        // ensure each item is the same
        for(let i = 0; i < a.length; i++){
            if(a[i] !== b[i]){
                return false;
            }
        }

        // arrays are equal
        return true;

    }

    static getBatteryPercentage(millivolts) {

        const minVoltage = 3400; // show battery as 0% at or below this value
        const maxVoltage = 4200; // show battery as 100% at or above this value

        // 0% if at or below min voltage
        if(millivolts <= minVoltage){
            return 0;
        }

        // 100% if at or above max voltage
        if(millivolts >= maxVoltage){
            return 100;
        }

        // linear calculation
        // todo implement curve based voltage to percentage calculations
        return Math.floor(((millivolts - minVoltage) / (maxVoltage - minVoltage)) * 100);

    }

}

export default Utils;
