// The header's Connect button.
//
// It was reported as doing nothing when clicked. It was not broken: it is a link
// to the connect screen, and on a node with nothing cached the page behind it is
// already showing the same Bluetooth and Serial buttons. Pressing it moved you to
// another copy of what you were looking at.
//
// It still earns its place in one state. With contacts or channels cached the page
// shows those lists instead of the connect buttons, and this is then the only way
// back to connecting. So the rule is not "remove it", it is "show it only where it
// leads somewhere".

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import Header from "../../src/components/Header.vue";
import GlobalState from "../../src/js/GlobalState.js";

function mountHeader() {
    return mount(Header, {
        global: {
            stubs: {
                RouterLink: { template: "<a class='router-link'><slot/></a>" },
                DropDownMenu: true,
                DropDownMenuItem: true,
                IconButton: true,
            },
        },
    });
}

const hasConnectButton = (wrapper) => wrapper.findAll("a.router-link")
    .some((link) => link.text().trim() === "Connect");

describe("Header connect button", () => {

    beforeEach(() => {
        GlobalState.connection = null;
        GlobalState.selfInfo = null;
        GlobalState.contacts = [];
        GlobalState.channels = [];
    });

    it("is hidden on a fresh app, where the page already offers the same buttons", () => {
        expect(hasConnectButton(mountHeader())).toBe(false);
    });

    it("is shown when cached contacts hide the connect buttons", () => {
        GlobalState.contacts = [{ publicKey: new Uint8Array(32), advName: "KJ5HBN" }];
        expect(hasConnectButton(mountHeader())).toBe(true);
    });

    it("is shown when cached channels hide the connect buttons", () => {
        // channels alone are enough: the page shows the tabs on either list
        GlobalState.channels = [{ idx: 0, name: "Emcomm Testing" }];
        expect(hasConnectButton(mountHeader())).toBe(true);
    });

    it("is hidden while connected, where Disconnect belongs instead", () => {
        GlobalState.connection = {};
        GlobalState.contacts = [{ publicKey: new Uint8Array(32), advName: "KJ5HBN" }];
        expect(hasConnectButton(mountHeader())).toBe(false);
    });

});
