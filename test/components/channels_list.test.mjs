// Channel ordering.
//
// The device hands channels over in slot order, which is the order somebody
// configured them in and carries no meaning for a reader. During a net the
// channel you want is a named one, and the hashtag channels are the long tail.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ChannelsList from "../../src/components/channels/ChannelsList.vue";

function mountList(names) {
    const channels = names.map((name, idx) => ({ idx, name }));
    return mount(ChannelsList, {
        props: { channels },
        global: { stubs: { ChannelListItem: true } },
    });
}

const ordered = (wrapper) => wrapper.vm.sortedChannels.map((c) => c.name);

describe("ChannelsList ordering", () => {

    it("puts named channels before hashtag ones", () => {
        const wrapper = mountList(["#elp-mesh", "Emcomm Testing", "#test", "Public"]);
        expect(ordered(wrapper)).toEqual(["Emcomm Testing", "Public", "#elp-mesh", "#test"]);
    });

    it("sorts this bench's real channel list the way an operator would expect", () => {
        // exactly what node 1 reports, in the slot order it reports them
        const wrapper = mountList([
            "Public", "#test", "#elp-mesh", "1", "#joebot",
            "#las-cruces", "#silvercity", "#elp-test", "Emcomm Testing",
        ]);
        expect(ordered(wrapper)).toEqual([
            "1", "Emcomm Testing", "Public",
            "#elp-mesh", "#elp-test", "#joebot", "#las-cruces", "#silvercity", "#test",
        ]);
    });

    it("orders numbers the way people read them, not the way strings compare", () => {
        // plain string order puts "net 10" before "net 2"
        const wrapper = mountList(["net 10", "net 2", "net 1"]);
        expect(ordered(wrapper)).toEqual(["net 1", "net 2", "net 10"]);
    });

    it("ignores case when sorting, so capitals do not float to the top", () => {
        const wrapper = mountList(["zulu", "Alpha", "bravo"]);
        expect(ordered(wrapper)).toEqual(["Alpha", "bravo", "zulu"]);
    });

    it("treats a leading space before the hash as a hashtag channel", () => {
        const wrapper = mountList([" #spaced", "Named"]);
        expect(ordered(wrapper)).toEqual(["Named", " #spaced"]);
    });

    it("does not reorder the array it was given", () => {
        const channels = [{ idx: 0, name: "#b" }, { idx: 1, name: "a" }];
        const wrapper = mount(ChannelsList, { props: { channels }, global: { stubs: { ChannelListItem: true } } });
        wrapper.vm.sortedChannels;
        expect(channels.map((c) => c.name)).toEqual(["#b", "a"]);
    });

    it("survives a channel with no name rather than throwing", () => {
        const wrapper = mountList(["Named", undefined]);
        expect(ordered(wrapper)).toHaveLength(2);
    });

});
