// The contact flags byte.
//
// Bit 0 is the favourite mark, and the firmware says so itself in
// examples/companion_radio/MyMesh.cpp:
//
//     uint8_t cp = contact.flags >> 1; // LSB used as 'favourite' bit (so only use upper bits)
//
// Keeping favourites here rather than in browser storage means the radio owns
// them: they are the same favourites the official MeshCore app shows, they
// survive clearing site data, and they travel with the node to another machine.
//
// The upper bits are contact permissions, which the firmware consults when
// deciding whether to answer a telemetry or location request. Writing the whole
// byte back would quietly change who may query this node, so a favourite is set
// by changing bit 0 and nothing else. That is the reason this is a module rather
// than an `& 1` written out wherever it happens to be needed.

const FAVOURITE_BIT = 0x01;

class ContactFlags {

    static get FAVOURITE_BIT() {
        return FAVOURITE_BIT;
    }

    static isFavourite(contact) {
        return ((contact?.flags ?? 0) & FAVOURITE_BIT) !== 0;
    }

    /**
     * The flags byte with the favourite bit set or cleared, and every other bit
     * left exactly as it was.
     */
    static withFavourite(flags, favourite) {
        const current = Number.isInteger(flags) ? flags & 0xFF : 0;
        return favourite ? (current | FAVOURITE_BIT) : (current & ~FAVOURITE_BIT & 0xFF);
    }

    // the permission bits, which are not ours to touch
    static permissions(flags) {
        return (Number.isInteger(flags) ? flags & 0xFF : 0) >> 1;
    }

    /**
     * Sorts favourites above everything else, leaving the order within each group
     * to whatever comparison the caller already wanted.
     */
    static compare(a, b) {
        return (this.isFavourite(b) ? 1 : 0) - (this.isFavourite(a) ? 1 : 0);
    }

}

export default ContactFlags;
