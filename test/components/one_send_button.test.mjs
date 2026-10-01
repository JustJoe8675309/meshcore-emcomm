// Only one button that sends is reachable while a station waits on a position answer.
//
// The prompt's buttons were "Send" and "Send with message", and the conversation
// behind it has a "Send" of its own. On 27 Sep the wrong one was pressed on the
// bench, and on 28 Sep again -- by the operator, answering a roll call in a room:
// nothing went out and the prompt sat there looking ignored. Three things stop it
// now, and each is checked here: the prompt's buttons say what they send, the
// page behind is inert while the prompt is up, and the prompt takes the focus so a
// keystroke meant for the message box cannot land there.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Constants } from "@liamcottle/meshcore.js";
import * as Protocol from "../../src/js/position/PositionProtocol.js";
import PositionService from "../../src/js/position/PositionService.js";
import PositionPrompt from "../../src/components/position/PositionPrompt.vue";
import App from "../../src/components/App.vue";
import GlobalState from "../../src/js/GlobalState.js";

const ME = new Uint8Array(32).fill(0xa7);
const THEM = new Uint8Array(32).fill(0x39);

function connect() {
    GlobalState.connection = { on() {}, off() {} };
    GlobalState.selfInfo = { name: "NOCALL-HT", publicKey: ME, advLat: 31761900, advLon: -106485000 };
    GlobalState.contacts = [{ publicKey: THEM, advName: "NOCALL-BASE", type: Constants.AdvType.Chat, flags: 0 }];
    GlobalState.channels = [{ idx: 7, name: "Emcomm Testing" }];
    GlobalState.gpsStatus = "unconfirmed";
}

function reset() {
    PositionService.state.prompts?.splice?.(0);
    PositionService.state.prompt = null;
}

function ask() {
    PositionService.onChannelData({
        channelIdx: 7,
        dataType: Protocol.DATA_TYPE,
        data: Protocol.encode({ kind: Protocol.KIND.REQUEST, tag: 4321, to: ME, from: THEM, name: "NOCALL-BASE" }),
    });
}

describe("one Send at a time", () => {

    beforeEach(() => {
        window.localStorage.clear();
        reset();
        connect();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        reset();
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
    });

    it("names the prompt's buttons for what they send, and none is a bare Send", async () => {
        const wrapper = mount(PositionPrompt, { global: { mocks: { $router: { push() {} } } } });
        ask();
        await flushPromises();
        const labels = wrapper.findAll("button").map((b) => b.text());
        expect(labels).toContain("Send my position");
        expect(labels).toContain("Send my position with a message");
        expect(labels).not.toContain("Send");
        expect(labels).not.toContain("Send with message");
        wrapper.unmount();
    });

    it("says what it sends while a position is being typed in, too", async () => {
        const wrapper = mount(PositionPrompt, { global: { mocks: { $router: { push() {} } } } });
        ask();
        await flushPromises();
        wrapper.vm.entering = true;
        await flushPromises();
        expect(wrapper.find("[data-answer='send']").text()).toBe("Save to radio and send my position");
        expect(wrapper.find("[data-answer='send-with-message']").text()).toBe("Save to radio, then add a message");
        wrapper.unmount();
    });

    it("takes the focus when it opens, away from a message box", async () => {
        const box = document.createElement("textarea");
        document.body.appendChild(box);
        box.focus();
        expect(document.activeElement).toBe(box);

        const wrapper = mount(PositionPrompt, { attachTo: document.body, global: { mocks: { $router: { push() {} } } } });
        ask();
        await flushPromises();
        expect(document.activeElement).toBe(wrapper.find("[role='alertdialog']").element);

        wrapper.unmount();
        box.remove();
    });

    it("makes the page behind inert while the prompt is up, and only then", async () => {
        const wrapper = mount(App, {
            global: {
                stubs: { RouterView: { template: "<div class='page'><button>Send</button></div>" }, PositionPrompt: true, PositionRequestDialog: true, GroupPositionDialog: true, ConnectSteps: true, BusyOverlay: true },
            },
        });
        const holder = () => wrapper.find(".page").element.parentElement;
        expect(holder().hasAttribute("inert")).toBe(false);

        ask();
        await flushPromises();
        expect(PositionService.state.prompt).not.toBe(null);
        expect(holder().hasAttribute("inert")).toBe(true);

        PositionService.state.prompt = null;
        await flushPromises();
        expect(holder().hasAttribute("inert")).toBe(false);
        wrapper.unmount();
    });

});
