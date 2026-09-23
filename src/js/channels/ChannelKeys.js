import GlobalState from "../GlobalState.js";
import Utils from "../Utils.js";

/**
 * Which channel a slot holds, as the channel's own identity rather than its
 * position.
 *
 * A channel has no public key and no advert; what makes it itself is its shared
 * secret. Two radios agreeing on that secret are on the same channel whatever
 * slot each of them keeps it in, which is exactly how operators talk about them:
 * "#Emcomm-Live", not "slot 3".
 *
 * The app used to file channel traffic under the slot number alone. Converting a
 * station to Emcomm-Training then wrote a new channel into a used slot, and the
 * new channel opened holding every message the old one had — and showed up in the
 * station list as recently active. In a drill that is the confusion DRILL marking
 * exists to prevent, so channel history is keyed by the secret instead.
 */
class ChannelKeys {

    /**
     * The key for a channel object, or null if it does not identify one.
     *
     * An unused slot answers with an empty name and a zero secret; a zero secret
     * is not an identity, so it gets no key rather than one shared by every empty
     * slot on the radio.
     */
    static of(channel) {
        const secret = channel?.secret;
        if(secret == null){
            return null;
        }
        const hex = (typeof secret === "string" ? secret : Utils.bytesToHex(secret)).toLowerCase();
        if(hex.length === 0 || /^0+$/.test(hex)){
            return null;
        }
        return hex;
    }

    /** The key of whatever the radio currently holds in a slot, or null. */
    static forSlot(channelIdx) {
        const channels = GlobalState.channels ?? [];
        return this.of(channels.find((channel) => channel.idx === channelIdx));
    }

}

export default ChannelKeys;
