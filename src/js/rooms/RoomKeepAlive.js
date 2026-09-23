import GlobalState from "../GlobalState.js";
import Utils from "../Utils.js";

/**
 * Keeps a room session alive, so the room keeps pushing its posts.
 *
 * Found on the bench, 22 September 2026. Two nodes were logged into the same
 * room as admins, both able to post. A position roll call posted from node 1 was
 * acknowledged by the room in 794 ms and never reached node 2: no prompt, and
 * nothing in node 2's frames for minutes. Node 2 was logged in the whole time.
 *
 * The room's own source says why. It pushes posts from a round robin in `loop()`,
 * and skips a client unless
 *
 *     client->extra.room.pending_ack == 0 && client->last_activity != 0
 *         && client->extra.room.push_failures < 3
 *
 * A push that goes unacknowledged counts a failure, and **three of them stop that
 * client's posts for good**. Nothing in the message path clears the count:
 * posting refreshes `last_activity` and leaves `push_failures` where it is. The
 * only thing that resets it is a `PAYLOAD_TYPE_REQ` from the client, which does
 *
 *     client->last_activity = now;
 *     client->extra.room.push_failures = 0;   // reset so push can resume
 *
 * Logging in again does not do it either, and this is the trap: the app sends the
 * password field as it stands, and a blank field is the ACL check path. For a
 * client the room already knows, that path finds the client and skips the whole
 * block that resets `push_failures`, `sync_since` and `last_activity`. So the
 * operator's obvious remedy — log out, log back in — changes nothing at all. On
 * the bench one keep-alive fixed it instantly: the roll call arrived within
 * seconds and the prompt came up correctly.
 *
 * A radio on a bad path, or an app whose tab was asleep while three pushes went
 * out, is enough to land in this state. In an incident it presents as a station
 * that is logged into net control's room, can post to it, and silently never
 * hears anything: the worst failure this app can have, because everyone
 * involved believes the link is good.
 *
 * So while the radio holds a room session, this sends a keep-alive request every
 * two minutes. It is a nine byte direct packet and its own acknowledgement,
 * which is nothing against a room's posts, and it also carries the time of the
 * newest post actually received, telling the room to re-push anything missed
 * rather than only what comes next.
 */
class RoomKeepAlive {

    /**
     * `REQ_TYPE_KEEP_ALIVE` from the firmware's `BaseChatMesh.h`. Sent through
     * the binary request command, which puts the radio's own timestamp in front,
     * so the room reads nine bytes: timestamp, type, then the since stamp.
     */
    static REQ_TYPE_KEEP_ALIVE = 0x02;

    /**
     * Two minutes. The room evicts nobody on a timer — eviction is still a TODO
     * in its source — so this interval is not a deadline to beat. It is how long
     * a station can stay cut off after three failed pushes before it recovers by
     * itself, and two minutes of silence is about as much as a net can carry
     * without someone asking for a radio check anyway.
     */
    static INTERVAL_MILLIS = 120 * 1000;

    static timers = new Map();
    static newestPost = new Map();

    /**
     * Starts keeping this room's session alive, and sends one straight away.
     *
     * The immediate one is the point as much as the repeat: an operator who has
     * just logged in is the operator whose count needs clearing, and waiting two
     * minutes to do it would leave the first posts of a net on the floor.
     */
    static start(publicKey) {

        const key = Utils.bytesToHex(publicKey);
        this.stop(publicKey);

        const timer = setInterval(() => {
            this.send(publicKey).catch(() => {});
        }, this.INTERVAL_MILLIS);
        this.timers.set(key, timer);

        // not awaited: a login should not be held up by this, and a keep-alive
        // that fails is retried by the timer soon enough
        this.send(publicKey).catch(() => {});

    }

    static stop(publicKey) {
        const key = Utils.bytesToHex(publicKey);
        const timer = this.timers.get(key);
        if(timer != null){
            clearInterval(timer);
            this.timers.delete(key);
        }
    }

    /**
     * Forgets every session. Room sessions live on the radio, so a radio that has
     * gone away has taken them with it.
     */
    static stopAll() {
        for(const timer of this.timers.values()){
            clearInterval(timer);
        }
        this.timers.clear();
        this.newestPost.clear();
    }

    static isRunning(publicKey) {
        return this.timers.has(Utils.bytesToHex(publicKey));
    }

    /**
     * Notes the time of a post received from a room, by the room's own clock.
     *
     * Only posts the room sent are recorded. Our own posts are stamped with this
     * radio's clock, and a radio running ahead of the room would push the since
     * stamp past posts that have not arrived yet, which is the one way this
     * could lose traffic rather than recover it.
     */
    static notePost(publicKey, roomTimestamp) {
        if(!Number.isFinite(roomTimestamp) || roomTimestamp <= 0){
            return;
        }
        const key = Utils.bytesToHex(publicKey);
        const previous = this.newestPost.get(key) ?? 0;
        if(roomTimestamp > previous){
            this.newestPost.set(key, roomTimestamp);
        }
    }

    /**
     * Sends one keep-alive. Quiet about failure by design: this runs on a timer
     * behind whatever the operator is doing, and a radio that is busy or out of
     * range is not something to interrupt them with.
     */
    static async send(publicKey) {

        const connection = GlobalState.connection;
        if(connection == null){
            return false;
        }

        const key = Utils.bytesToHex(publicKey);
        // 0 leaves the room's own idea of where we are up to, which is right when
        // nothing has been received to know better from
        const since = this.newestPost.get(key) ?? 0;

        const params = new Uint8Array(5);
        params[0] = this.REQ_TYPE_KEEP_ALIVE;
        params[1] = since & 0xff;
        params[2] = (since >> 8) & 0xff;
        params[3] = (since >> 16) & 0xff;
        params[4] = (since >> 24) & 0xff;

        await connection.sendCommandSendBinaryReq(publicKey, params);
        return true;

    }

}

export default RoomKeepAlive;
