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
    // which kinds of repeating advert have a timer armed, so the ui can say so.
    // kept here because it has to be reactive: read straight off the schedule it
    // is plain module state, and a computed with no reactive dependency caches
    // its first answer for ever. That one said "Off" while the radio adverted
    // every minute
    advertScheduleRunning: [],
    // when each kind last actually went out, from this app, to the radio now
    // connected. The running flag alone said "running" for ten minutes on a locked
    // phone that sent nothing, so the ui shows this too
    advertLastSent: { zeroHop: null, flood: null },
    // when the current schedule was started, which is when the first one falls due
    // from, and the minutes it was started with
    advertStartedAt: null,
    advertIntervals: { zeroHop: 0, flood: 0 },
    // whether the screen is being kept on for the schedule: "none", "held",
    // "waiting" (hidden, taken again on return), "unsupported" or "failed"
    advertWakeLock: "none",
});

export default globalState;
