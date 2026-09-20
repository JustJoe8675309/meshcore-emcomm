// What a contact's out path length means.
//
// It is not a hop count, which is the trap. The firmware packs two things into
// that one byte (src/Packet.h):
//
//     hash_count = path_len & 63          // the actual number of hops
//     hash_size  = (path_len >> 6) + 1    // bytes per path hash, 4 is reserved
//
// and treats it as valid when the hash size is under 4 and the path fits in
// MAX_PATH_SIZE, which is 64 bytes. `OUT_PATH_UNKNOWN` is 0xFF, which decodes to
// 63 hops of 4 byte hashes and so can never collide with a real path.
//
// This app read the byte as a plain count, so a direct contact using 3 byte
// hashes (0x80: zero hops, hash size 3) was reported as being 128 hops away. The
// first attempt at a fix assumed 0 to 64 were all hop counts and called anything
// else unknown, which replaced a wrong distance with a wrong error: the contact
// was reachable directly the whole time. Both mistakes came from reading a packed
// field as a number.
//
// `meshcore.js` reads the byte with readInt8, so anything with the top bit set
// arrives negative and has to be put back before decoding.

const OUT_PATH_UNKNOWN = 0xFF;
const MAX_PATH_SIZE = 64;
const HOP_MASK = 63;

class PathInfo {

    static get MAX_PATH_SIZE() {
        return MAX_PATH_SIZE;
    }

    /**
     * Unpacks the byte into { flood, hops, hashSize }, or null when it decodes to
     * nothing the firmware could have produced.
     */
    static decode(outPathLen) {

        if(!Number.isInteger(outPathLen)){
            return null;
        }

        // signed on the way in, unsigned in the firmware
        const raw = outPathLen < 0 ? outPathLen + 256 : outPathLen;
        if(raw < 0 || raw > 0xFF){
            return null;
        }

        if(raw === OUT_PATH_UNKNOWN){
            return { flood: true, hops: null, hashSize: null };
        }

        const hops = raw & HOP_MASK;
        const hashSize = (raw >> 6) + 1;

        // the firmware's own validity test
        if(hashSize === 4 || hops * hashSize > MAX_PATH_SIZE){
            return null;
        }

        return { flood: false, hops: hops, hashSize: hashSize };

    }

    static isFlood(outPathLen) {
        return this.decode(outPathLen)?.flood === true;
    }

    static isUnknown(outPathLen) {
        return this.decode(outPathLen) === null;
    }

    // the hop count alone, for anything that needs to compare distances
    static hops(outPathLen) {
        const path = this.decode(outPathLen);
        return path == null || path.flood ? null : path.hops;
    }

    static describe(outPathLen) {

        const path = this.decode(outPathLen);

        if(path == null){
            // kept visible rather than hidden: a byte the app cannot read is worth
            // knowing about, and the raw value is what makes it reportable
            return `Unknown path (${outPathLen})`;
        }

        if(path.flood){
            return "No Path (Flood)";
        }

        if(path.hops === 0){
            return "Direct";
        }

        return path.hops === 1 ? "1 Hop" : `${path.hops} Hops`;

    }

}

export default PathInfo;
