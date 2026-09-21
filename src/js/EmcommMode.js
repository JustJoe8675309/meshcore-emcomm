// Trimming a node's contact list for an incident.
//
// The rules and the reasoning behind them are in docs/EMCOMM-MODE.md. The short
// version: companions come back on their own as soon as they advert, so they all
// go. Repeaters and rooms do not come back so easily — discovery finds repeaters
// only at zero hops, and cannot find a room at all — so they are kept unless
// they have been quiet for 90 days.
//
// Anything whose age cannot be read is kept. `lastAdvert` is the advertising
// node's own clock rather than when this node heard it, and on the bench one
// contact claimed an advert about four years in the future. The two mistakes are
// not equal: deleting a working repeater over a wrong clock costs routing during
// an incident, while keeping a dead one costs a line in a list.

import { Constants } from "@liamcottle/meshcore.js";
import GlobalState from "./GlobalState.js";
import Connection from "./Connection.js";
import Utils from "./Utils.js";

const DAY_SECONDS = 24 * 60 * 60;
const QUIET_DAYS = 90;

// A timestamp before this is treated as unreadable rather than as very old.
// MeshCore did not exist, so it means a clock that was never set, and a node
// with an unset clock may be perfectly alive.
const EARLIEST_PLAUSIBLE = Date.UTC(2020, 0, 1) / 1000;

// Clocks drift, and a station whose clock runs slightly fast would otherwise
// look like it adverted in the future. A day is far more than real drift and far
// less than the four years seen on the bench.
const FUTURE_TOLERANCE_SECONDS = DAY_SECONDS;

// how many times to go back for contacts the device did not remove
const MAX_REMOVE_PASSES = 3;

// mode state lives per node, keyed on its public key
const MODE_STATE_PREFIX = "emcomm_mode";

class EmcommMode {

    static get QUIET_DAYS() {
        return QUIET_DAYS;
    }

    /**
     * The only radio preset MeshCore publishes: "USA/Canada (Recommended)".
     *
     * From the MeshCore FAQ, which notes that as of October 2025 many regions
     * moved to BW 62.5 and a lower spreading factor in place of the original
     * SF11. Frequency is in kHz and bandwidth in Hz, matching what the device
     * reports, so these round trip without conversion.
     *
     * No other region is listed. The FAQ says the rest live in the phone client
     * and the web flasher, and a guessed frequency is both an off mesh problem
     * and a licensing one, so the dialog offers this or free entry and nothing
     * in between.
     */
    static get US_PRESET() {
        return { radioFreq: 910525, radioBw: 62500, radioSf: 7, radioCr: 5 };
    }

    /** True when the radio is already on the given settings, so nothing need change. */
    static radioMatches(selfInfo, radio) {
        return selfInfo?.radioFreq === radio.radioFreq
            && selfInfo?.radioBw === radio.radioBw
            && selfInfo?.radioSf === radio.radioSf
            && selfInfo?.radioCr === radio.radioCr;
    }

    /**
     * Applies the settings EMCOMM mode changes, one at a time.
     *
     * Each is attempted on its own and a failure is recorded rather than thrown:
     * stopping partway would leave the node in a state that is neither what it
     * was nor what was asked for, and the operator can act on "the clock did not
     * sync" far better than on nothing at all.
     */
    static async applySettings(options, onProgress = () => {}) {

        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(Connection.DISCONNECTED);
        }

        const applied = [];
        const failures = [];

        const attempt = async (what, action) => {
            onProgress({ what: what });
            try {
                await action();
                applied.push(what);
            } catch(e) {
                failures.push({ what: what, reason: String(e?.message ?? e) });
            }
        };

        if(options.name != null && options.name !== ""){
            await attempt("node name", () => connection.setAdvertName(options.name));
        }

        if(options.radio != null){
            await attempt("radio settings", () => connection.setRadioParams(
                options.radio.radioFreq, options.radio.radioBw, options.radio.radioSf, options.radio.radioCr,
            ));
        }

        if(options.txPower != null){
            await attempt("transmit power", () => connection.setTxPower(options.txPower));
        }

        if(options.syncClock){
            await attempt("device clock", () => Connection.syncDeviceTime());
        }

        if(options.setPositionFromGps){
            await attempt("position", async () => {

                // a fix that was true at connect time is not a position now, and
                // 0,0 formats perfectly well while pointing at the Gulf of Guinea
                const position = await Connection.getPosition();
                if(position == null){
                    throw new Error("the radio has no live GPS fix, so the position was left alone");
                }

                await connection.setAdvertLatLong(
                    Math.round(position.latitude * 1000000),
                    Math.round(position.longitude * 1000000),
                );

            });
        }

        return { applied: applied, failures: failures };

    }

    /**
     * Whether a node is in EMCOMM mode, and since when.
     *
     * Kept per node, keyed on its public key: connecting a different radio must
     * not show the state of the last one. Held in this browser rather than on the
     * device, because the device has nowhere to put it, so a node converted from
     * another machine will read as not in the mode here. That is worth knowing
     * but not worth lying about, so the state says when it was set and nothing
     * more.
     */
    static markEntered(nodePublicKeyHex, at = Date.now()) {
        try {
            window.localStorage.setItem(`${MODE_STATE_PREFIX}:${nodePublicKeyHex}`, String(at));
        } catch(e) {
            console.log("could not record emcomm mode state", e);
        }
    }

    static markLeft(nodePublicKeyHex) {
        try {
            window.localStorage.removeItem(`${MODE_STATE_PREFIX}:${nodePublicKeyHex}`);
        } catch(e) {
            console.log("could not clear emcomm mode state", e);
        }
    }

    /** When the node entered EMCOMM mode, or null if it is not in it. */
    static enteredAt(nodePublicKeyHex) {
        try {
            const raw = window.localStorage.getItem(`${MODE_STATE_PREFIX}:${nodePublicKeyHex}`);
            const at = raw == null ? NaN : Number(raw);
            return Number.isFinite(at) ? at : null;
        } catch(e) {
            return null;
        }
    }

    /** Sets whether the node adds contacts by itself. Done last, after discovery. */
    static async setManualAddContacts(manual) {
        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(Connection.DISCONNECTED);
        }
        await connection.setOtherParams(manual);
    }

    /**
     * Announces the station.
     *
     * Flood is the default for an incident: every operator and repeater learns
     * the station is up, for one packet. Zero hop reaches only direct neighbours
     * and is the quieter choice for a drill or a busy band.
     */
    static async announce(flood = true) {
        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(Connection.DISCONNECTED);
        }
        return flood ? await connection.sendFloodAdvert() : await connection.sendZeroHopAdvert();
    }

    /** True when a contact's age cannot be trusted, whichever way it is wrong. */
    static hasUnreadableAge(contact, nowSeconds) {
        const heard = contact?.lastAdvert;
        if(!Number.isInteger(heard)){
            return true;
        }
        if(heard < EARLIEST_PLAUSIBLE){
            return true;
        }
        return heard > nowSeconds + FUTURE_TOLERANCE_SECONDS;
    }

    /**
     * Decides what would be removed, without removing anything.
     *
     * Separate from doing it so the operator can be shown the damage before
     * agreeing to it, and so the rules can be tested without a radio.
     */
    static planTrim(contacts, nowSeconds = Math.floor(Date.now() / 1000)) {

        const remove = [];
        const keep = [];
        let keptForUnreadableAge = 0;

        for(const contact of contacts ?? []){

            const type = contact.type;

            // companions go regardless of age: a person's node re-adds itself the
            // moment it adverts, so they are the cheapest thing to clear
            if(type === Constants.AdvType.Chat){
                remove.push(contact);
                continue;
            }

            const isRoomOrRepeater = type === Constants.AdvType.Room || type === Constants.AdvType.Repeater;
            if(!isRoomOrRepeater){
                // sensors and anything a later firmware introduces. not ours to
                // judge, so left alone
                keep.push(contact);
                continue;
            }

            if(this.hasUnreadableAge(contact, nowSeconds)){
                keptForUnreadableAge++;
                keep.push(contact);
                continue;
            }

            const quietFor = nowSeconds - contact.lastAdvert;
            if(quietFor > QUIET_DAYS * DAY_SECONDS){
                remove.push(contact);
            } else {
                keep.push(contact);
            }

        }

        return {
            remove: remove,
            keep: keep,
            keptForUnreadableAge: keptForUnreadableAge,
            counts: {
                companions: remove.filter((c) => c.type === Constants.AdvType.Chat).length,
                rooms: remove.filter((c) => c.type === Constants.AdvType.Room).length,
                repeaters: remove.filter((c) => c.type === Constants.AdvType.Repeater).length,
            },
        };

    }

    /**
     * Removes the contacts a plan names, then checks the device agrees.
     *
     * There is no bulk delete, so this is one command per contact over a link
     * that has been measured dropping frames. A removal that silently did not
     * happen would leave the node in a state that is neither what it was nor what
     * was asked for, so the list is read back and anything still present is tried
     * again.
     */
    static async trim(plan, onProgress = () => {}) {

        const connection = GlobalState.connection;
        if(connection == null){
            throw new Error(Connection.DISCONNECTED);
        }

        const wanted = new Map(plan.remove.map((c) => [Utils.bytesToHex(c.publicKey), c]));
        let removed = 0;

        for(let pass = 1; pass <= MAX_REMOVE_PASSES; pass++){

            const remaining = [...wanted.values()];
            if(remaining.length === 0){
                break;
            }

            let index = 0;
            for(const contact of remaining){
                index++;
                onProgress({
                    done: index,
                    total: remaining.length,
                    pass: pass,
                    what: contact.advName || Utils.bytesToHex(contact.publicKey).slice(0, 8),
                });
                try {
                    await connection.removeContact(contact.publicKey);
                } catch(e) {
                    // left in the map, so the next pass tries again
                    continue;
                }
            }

            // the device is the authority on what it still holds
            await Connection.loadContacts();
            const stillThere = new Set(GlobalState.contacts.map((c) => Utils.bytesToHex(c.publicKey)));

            for(const key of [...wanted.keys()]){
                if(!stillThere.has(key)){
                    wanted.delete(key);
                    removed++;
                }
            }

        }

        return {
            removed: removed,
            // named, not just counted: which ones survived decides what to do next
            notRemoved: [...wanted.values()].map((c) => c.advName || Utils.bytesToHex(c.publicKey).slice(0, 8)),
        };

    }

}

export default EmcommMode;
