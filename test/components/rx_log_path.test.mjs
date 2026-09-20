// How a received packet's path is read.
//
// A packet's pathLen is not a byte length and not a hop count: the top two bits
// are the path hash size and the bottom six are the number of hops. The rx log
// used path.length, the byte count, which agrees with the hop count only while
// hashes are one byte wide. Against a station using three byte hashes it showed
// three times the hops and split each hop into three, naming every third after
// whichever contact happened to begin with that byte.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { Packet, MeshCorePath } from "@liamcottle/meshcore.js";
import RxLogPage from "../../src/components/pages/RxLogPage.vue";
import GlobalState from "../../src/js/GlobalState.js";

// the firmware's own packing: ((hashSize - 1) << 6) | (hopCount & 63)
function packedPathLen(hashSize, hopCount) {
    return ((hashSize - 1) << 6) | (hopCount & 63);
}

function aPacket(hashSize, hops) {
    const bytes = [];
    for(const hop of hops){
        for(let i = 0; i < hashSize; i++){
            bytes.push(hop[i]);
        }
    }
    return { pathLen: packedPathLen(hashSize, hops.length), path: new Uint8Array(bytes) };
}

// the page attaches a device listener on mount, which this suite is not about
function mountPage() {
    GlobalState.connection = { on() {}, off() {} };
    return mount(RxLogPage, {
        global: { stubs: { AppBar: true, Page: true, IconButton: true, ChannelDropDownMenu: true } },
    });
}

describe("rx log packet paths", () => {

    it("agrees with the library's own packing", () => {
        // guards the test's own helper against the thing it is testing
        expect(Packet.compactPathHashSizeAndCount(3, 0)).toBe(packedPathLen(3, 0));
        expect(packedPathLen(3, 0)).toBe(0x80);
        expect(packedPathLen(1, 2)).toBe(2);
    });

    it("counts single byte hops the way it always did", () => {
        const page = mountPage();
        const packet = aPacket(1, [[0xaa], [0xbb]]);
        expect(page.vm.hopCount(packet)).toBe(2);
        expect(page.vm.formatPath(packet)).toBe("aa,bb");
    });

    it("counts a three byte hash hop as one hop, not three", () => {
        const page = mountPage();
        const packet = aPacket(3, [[0xaa, 0xbb, 0xcc], [0xdd, 0xee, 0xff]]);
        // path.length is 6 bytes; there are 2 hops
        expect(packet.path.length).toBe(6);
        expect(page.vm.hopCount(packet)).toBe(2);
    });

    it("keeps the bytes of a hop together when showing the path", () => {
        const page = mountPage();
        const packet = aPacket(3, [[0xaa, 0xbb, 0xcc], [0xdd, 0xee, 0xff]]);
        expect(page.vm.formatPath(packet)).toBe("aabbcc,ddeeff");
    });

    it("reads a direct packet as no hops", () => {
        const page = mountPage();
        expect(page.vm.hopCount(aPacket(1, []))).toBe(0);
        expect(page.vm.hopCount(aPacket(3, []))).toBe(0);
    });

    it("matches a hop against the whole hash, not its first byte", () => {
        // two contacts sharing a first byte: a one byte prefix cannot tell them
        // apart, and would name the wrong station
        const wrong = new Uint8Array(32).fill(0); wrong.set([0xaa, 0x11, 0x11], 0);
        const right = new Uint8Array(32).fill(0); right.set([0xaa, 0xbb, 0xcc], 0);
        GlobalState.contacts = [
            { advName: "Wrong Station", publicKey: wrong },
            { advName: "Right Station", publicKey: right },
        ];

        const page = mountPage();
        const hop = page.vm.pathItems(aPacket(3, [[0xaa, 0xbb, 0xcc]]))[0];
        expect(page.vm.findContactByPublicKeyPrefix(hop)?.advName).toBe("Right Station");
    });

    it("treats the no path sentinel as no hops rather than throwing", () => {
        const page = mountPage();
        expect(page.vm.hopCount({ pathLen: 0xFF, path: new Uint8Array(0) })).toBe(0);
    });

    it("survives a truncated path rather than inventing hops", () => {
        const page = mountPage();
        // claims two three byte hops but carries only four bytes
        const packet = { pathLen: packedPathLen(3, 2), path: new Uint8Array([1, 2, 3, 4]) };
        expect(MeshCorePath.fromPathAndLength(packet.path, packet.pathLen)).toBe(null);
        expect(page.vm.hopCount(packet)).toBe(0);
    });

});
