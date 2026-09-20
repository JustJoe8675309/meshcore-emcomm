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
    // how many the device said it would send, and how many never arrived
    contactsAnnounced: null,
    contactsMissing: 0,
    // rooms logged in to this session, by public key hex. in memory only: the
    // session belongs to the radio, so reconnecting means logging in again
    roomLogins: {},
    channels: [],
    // whether the device is serving a live GPS fix: "unknown" before a device is
    // connected, "checking" while the probe runs, then "live" or "unconfirmed"
    gpsStatus: "unknown",
    // why the last connection attempt failed, shown on the connect screen. a modal
    // would block the whole app, which is the wrong trade on a phone during a net
    connectionError: null,
});

export default globalState;
