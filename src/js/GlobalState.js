import {reactive} from "vue";

// global state
const globalState = reactive({
    connection: null,
    isDatabaseReady: false,
    selfInfo: null,
    batteryPercentage: null,
    batteryPercentageInterval: null,
    connectionWatchdog: null,
    connectionTransport: null,
    contacts: [],
    channels: [],
    // whether the device is serving a live GPS fix: "unknown" before a device is
    // connected, "checking" while the probe runs, then "live" or "unconfirmed"
    gpsStatus: "unknown",
});

export default globalState;
