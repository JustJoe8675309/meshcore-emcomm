// Disconnect asks whether to take the station home first.
//
// Asked for on 29 Sep. The trap it closes: **the way home lives on the computer that
// holds the backup.** A node disconnected while still in an emcomm mode is left on
// drill channels and drill settings, and the operator who picks it up on another
// machine gets the "Is this station in a mode?" question and no way to put it back --
// the radio does not know it is in a mode, only this browser does.
//
// Worth knowing before changing any of this: the whole suite stayed green when the
// Disconnect button changed from "disconnect" to "ask first", because nothing in it
// pressed the button. A test that mounts the header is not a test of what its buttons
// do.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import Header from "../../src/components/Header.vue";
import DisconnectDialog from "../../src/components/modes/DisconnectDialog.vue";
import GlobalState from "../../src/js/GlobalState.js";
import Connection from "../../src/js/Connection.js";
import ModeProfiles from "../../src/js/modes/ModeProfiles.js";
import ModeSwitch from "../../src/js/modes/ModeSwitch.js";

const KEY = new Uint8Array(32).fill(7);

function mountHeader() {
    return mount(Header, {
        global: {
            stubs: {
                RouterLink: { template: "<a class='router-link'><slot/></a>" },
                DropDownMenu: { template: "<div><slot name='button'/><slot name='items'/></div>" },
                DropDownMenuItem: { template: "<button class='menu-item'><slot/></button>" },
                IconButton: true,
                ModeBanner: true,
                ModeSwitchDialog: true,
                ModeSharing: true,
                FirstRunSetup: true,
                LeftInModeDialog: true,
            },
        },
    });
}

const pressDisconnect = async (wrapper) => {
    const button = wrapper.findAll("button").find((b) => b.text() === "Disconnect");
    expect(button, "the header has no Disconnect button").not.toBe(undefined);
    await button.trigger("click");
    await wrapper.vm.$nextTick();
};

beforeEach(() => {
    GlobalState.connection = { on() {}, off() {} };
    GlobalState.selfInfo = { name: "Joe-NOCALL-HTv3", publicKey: KEY };
    GlobalState.batteryPercentage = 80;
    vi.spyOn(Connection, "disconnect").mockResolvedValue(undefined);
    vi.spyOn(ModeSwitch, "describe").mockResolvedValue({ changes: ["The channels go back to the station's own."] });
    vi.spyOn(ModeSwitch, "apply").mockResolvedValue({ failures: [], warnings: [] });
});

afterEach(() => {
    vi.restoreAllMocks();
    try { window.localStorage.clear(); } catch(e) {}
    GlobalState.connection = null;
    GlobalState.selfInfo = null;
    GlobalState.batteryPercentage = null;
});

describe("pressing Disconnect", () => {

    // a question with one real answer teaches an operator to dismiss the dialog
    // unread, which is the habit that would make this one useless when it matters
    it("does not ask a station that is already in normal mode", async () => {
        ModeProfiles.setCurrent("normal");
        const wrapper = mountHeader();

        await pressDisconnect(wrapper);

        expect(Connection.disconnect).toHaveBeenCalledOnce();
        expect(wrapper.vm.disconnectAsking).toBe(false);
    });

    it("asks a station that is in a mode, and disconnects nothing yet", async () => {
        ModeProfiles.setCurrent("live");
        const wrapper = mountHeader();

        await pressDisconnect(wrapper);

        expect(wrapper.vm.disconnectAsking).toBe(true);
        expect(Connection.disconnect).not.toHaveBeenCalled();
    });

});

describe("the dialog's three answers", () => {

    beforeEach(() => {
        ModeProfiles.setCurrent("live");
    });

    const open = async () => {
        const wrapper = mount(DisconnectDialog, { props: { open: false } });
        await wrapper.setProps({ open: true });
        await wrapper.vm.$nextTick();
        return wrapper;
    };

    const press = async (wrapper, startsWith) => {
        const button = wrapper.findAll("button").find((b) => b.text().startsWith(startsWith));
        expect(button, `no button starting "${startsWith}"`).not.toBe(undefined);
        await button.trigger("click");
        await wrapper.vm.$nextTick();
    };

    it("says which mode it is in, and that the way back is recorded here", async () => {
        const wrapper = await open();
        // the label, not just the sentence: "incident" is not a mode name and
        // setCurrent coerces an unknown one to normal, which quietly turned this
        // whole block into a test of the normal-mode label
        expect(wrapper.text()).toContain("This station is in Emcomm-Live");
        expect(wrapper.text()).toContain("the way back is recorded on this computer");
    });

    it("shows what coming home would change, the way the switch dialog does", async () => {
        const wrapper = await open();
        expect(ModeSwitch.describe).toHaveBeenCalledWith("normal");
        expect(wrapper.text()).toContain("The channels go back to the station's own.");
    });

    it("leaves it in the mode when that is the answer chosen", async () => {
        const wrapper = await open();

        await press(wrapper, "Disconnect, leave it in");

        expect(ModeSwitch.apply).not.toHaveBeenCalled();
        expect(Connection.disconnect).toHaveBeenCalledOnce();
    });

    // the order is the point: a disconnect that raced the switch would drop the link
    // part way through writing channels, which is worse than either answer offered
    it("takes it home first, and only then disconnects", async () => {
        const order = [];
        ModeSwitch.apply.mockImplementation(async () => {
            order.push("switch");
            return { failures: [], warnings: [] };
        });
        Connection.disconnect.mockImplementation(async () => { order.push("disconnect"); });
        const wrapper = await open();

        await press(wrapper, "Put it back to normal mode");
        await new Promise((r) => setTimeout(r, 0));

        expect(ModeSwitch.apply).toHaveBeenCalledWith("normal", expect.any(Function));
        expect(order).toEqual(["switch", "disconnect"]);
    });

    it("stays connected when that is the answer chosen", async () => {
        const wrapper = await open();

        await press(wrapper, "Stay connected");

        expect(Connection.disconnect).not.toHaveBeenCalled();
        expect(ModeSwitch.apply).not.toHaveBeenCalled();
        expect(wrapper.emitted("close")).toBeTruthy();
    });

});

describe("when coming home does not work", () => {

    beforeEach(() => {
        ModeProfiles.setCurrent("live");
    });

    const openAndTryHome = async () => {
        const wrapper = mount(DisconnectDialog, { props: { open: false } });
        await wrapper.setProps({ open: true });
        await wrapper.vm.$nextTick();
        const button = wrapper.findAll("button").find((b) => b.text().startsWith("Put it back to normal mode"));
        await button.trigger("click");
        await new Promise((r) => setTimeout(r, 0));
        await wrapper.vm.$nextTick();
        return wrapper;
    };

    // being told "it did not come home" while the radio is still on the air is
    // recoverable; being disconnected and told the same thing is not
    it("does not disconnect when the switch reports failures", async () => {
        ModeSwitch.apply.mockResolvedValue({
            failures: [{ what: "the channels", reason: "the radio stopped answering" }],
            warnings: [],
        });

        const wrapper = await openAndTryHome();

        expect(Connection.disconnect).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain("still connected");
        // the verb cannot agree with a `what` that is sometimes plural
        expect(wrapper.text()).toContain("Could not set the channels: the radio stopped answering");
    });

    it("does not disconnect when the switch throws", async () => {
        ModeSwitch.apply.mockRejectedValue(new Error("no record of this station's normal settings"));

        const wrapper = await openAndTryHome();

        expect(Connection.disconnect).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain("no record of this station's normal settings");
    });

    it("offers to try again, and says what disconnecting now would mean", async () => {
        ModeSwitch.apply.mockResolvedValue({
            failures: [{ what: "the channels", reason: "timed out" }],
            warnings: [],
        });

        const wrapper = await openAndTryHome();

        expect(wrapper.findAll("button").some((b) => b.text().startsWith("Try again"))).toBe(true);
        expect(wrapper.text()).toContain("Disconnecting now would leave it in");
    });

    // the radio could not be read, but the trip home can still be attempted
    it("still offers the trip home when it cannot say what would change", async () => {
        ModeSwitch.describe.mockRejectedValue(new Error("the radio could not be read"));
        const wrapper = mount(DisconnectDialog, { props: { open: false } });
        await wrapper.setProps({ open: true });
        await new Promise((r) => setTimeout(r, 0));
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain("could not be read");
        expect(wrapper.findAll("button").some((b) => b.text().startsWith("Put it back to normal mode"))).toBe(true);
    });

});

describe("while it is working", () => {

    beforeEach(() => {
        ModeProfiles.setCurrent("live");
    });

    // the switch takes 40 to 90 seconds on real hardware, which is long enough for an
    // operator to conclude nothing is happening and press something else
    it("disables every button, so the switch cannot be raced", async () => {
        let release;
        ModeSwitch.apply.mockImplementation(() => new Promise((r) => {
            release = () => r({ failures: [], warnings: [] });
        }));
        const wrapper = mount(DisconnectDialog, { props: { open: false } });
        await wrapper.setProps({ open: true });
        await wrapper.vm.$nextTick();

        await wrapper.findAll("button").find((b) => b.text().startsWith("Put it back")).trigger("click");
        await wrapper.vm.$nextTick();

        for(const button of wrapper.findAll("button")){
            expect(button.attributes("disabled")).toBeDefined();
        }
        // and it says why the wait is expected, rather than looking hung
        expect(wrapper.text()).toContain("up to a minute and a half");

        release();
        await new Promise((r) => setTimeout(r, 0));
    });

    it("shows the radio's own progress while it works", async () => {
        let report;
        ModeSwitch.apply.mockImplementation((mode, onProgress) => new Promise((r) => {
            report = (p) => { onProgress(p); r({ failures: [], warnings: [] }); };
        }));
        const wrapper = mount(DisconnectDialog, { props: { open: false } });
        await wrapper.setProps({ open: true });
        await wrapper.vm.$nextTick();

        await wrapper.findAll("button").find((b) => b.text().startsWith("Put it back")).trigger("click");
        await wrapper.vm.$nextTick();
        report({ what: "restoring the channels", done: 3, total: 12 });
        await wrapper.vm.$nextTick();

        // the object shape, not "[object Object]", which is what {{ progress }} gave
        expect(wrapper.text()).toContain("restoring the channels");
        expect(wrapper.text()).toContain("(3 of 12)");
    });

});
