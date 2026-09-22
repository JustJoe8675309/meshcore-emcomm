// The service worker's install and activate, run from the real source file.
//
// Found on the bench after a deploy. An update arrived while the tab's network
// was down. The worker's install was best effort, so it skipped every file it
// could not fetch, took over with an empty cache, and deleted the previous
// build's complete one as it activated. The next offline load was "This site
// can't be reached". A failed install must change nothing, so that the previous
// worker and its cache stay in charge.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// tests run from the project root
const SOURCE = readFileSync(resolve(process.cwd(), "src/public/service-worker.js"), "utf8");
const SHELL = ["/", "/index.html", "/manifest.json", "/icon.png"];
const ASSETS = ["/assets/index-NEW.js", "/assets/index-NEW.css", "/assets/SettingsPage-NEW.js"];

// Cache storage that behaves like the browser's: addAll stores nothing unless
// every response is ok, and a cache is a map from path to response.
function cacheStorage(fetchPath, initial = {}) {
    const store = new Map(Object.entries(initial).map(([name, paths]) => [name, new Map(paths.map((p) => [p, "cached"]))]));
    const handle = (name) => ({
        async addAll(paths) {
            const responses = await Promise.all(paths.map((p) => fetchPath(p)));
            if(responses.some((r) => !r.ok)){
                throw new TypeError("addAll: a response was not ok");
            }
            const cache = store.get(name);
            responses.forEach((r, i) => cache.set(paths[i], r));
        },
        async keys() {
            return [...store.get(name).keys()].map((p) => ({ url: `https://app.test${p}` }));
        },
    });
    return {
        store,
        api: {
            async open(name) { if(!store.has(name)) store.set(name, new Map()); return handle(name); },
            async keys() { return [...store.keys()]; },
            async delete(name) { return store.delete(name); },
            async match() { return undefined; },
        },
    };
}

function worker({ build = "NEW", assets = ASSETS, fetchPath = async () => ({ ok: true }), initial = {} } = {}) {
    const listeners = {};
    const self = {
        location: { origin: "https://app.test" },
        addEventListener: (type, cb) => { listeners[type] = cb; },
        skipWaiting: vi.fn(async () => {}),
        clients: { claim: vi.fn(async () => {}) },
    };
    const caches = cacheStorage(fetchPath, initial);
    const source = SOURCE.replace("__BUILD_ID__", build).replace("__BUILD_ASSETS__", JSON.stringify(assets));
    new Function("self", "caches", "fetch", "console", source)(self, caches.api, fetchPath, { log: () => {} });

    const fire = async (type) => {
        let waited = null;
        listeners[type]({ waitUntil: (p) => { waited = p; } });
        return waited;
    };
    return { self, caches, fire, name: `meshcore-emcomm-${build}` };
}

describe("service worker install", () => {

    it("caches the whole build, then takes over", async () => {
        const w = worker();
        await w.fire("install");

        expect([...w.caches.store.get(w.name).keys()].sort()).toEqual([...SHELL, ...ASSETS].sort());
        expect(w.self.skipWaiting).toHaveBeenCalled();
    });

    it("fails, and does not take over, when any file cannot be fetched", async () => {
        // one chunk missing is enough: a build that cannot start offline must not
        // replace one that can
        const w = worker({ fetchPath: async (p) => ({ ok: p !== "/assets/SettingsPage-NEW.js" }) });

        await expect(w.fire("install")).rejects.toThrow();
        expect(w.self.skipWaiting).not.toHaveBeenCalled();
    });

    it("leaves the previous build's cache whole when the network is down", async () => {
        // the bench case: a complete old cache, and an update that cannot fetch
        const old = "meshcore-emcomm-OLD";
        const w = worker({
            fetchPath: async () => { throw new TypeError("Failed to fetch"); },
            initial: { [old]: [...SHELL, "/assets/index-OLD.js"] },
        });

        await expect(w.fire("install")).rejects.toThrow();

        expect(w.self.skipWaiting).not.toHaveBeenCalled();
        expect([...w.caches.store.get(old).keys()]).toContain("/assets/index-OLD.js");
    });

});

describe("service worker activate", () => {

    it("drops older builds once this one is fully cached", async () => {
        const old = "meshcore-emcomm-OLD";
        const w = worker({ initial: { [old]: [...SHELL, "/assets/index-OLD.js"] } });
        await w.fire("install");

        await w.fire("activate");

        expect(w.caches.store.has(old)).toBe(false);
        expect(w.caches.store.has(w.name)).toBe(true);
        expect(w.self.clients.claim).toHaveBeenCalled();
    });

    it("keeps older builds if this one is not fully cached", async () => {
        // the step that cannot be undone is checked on its own, not left to install
        const old = "meshcore-emcomm-OLD";
        const w = worker({ initial: { [old]: [...SHELL, "/assets/index-OLD.js"], "meshcore-emcomm-NEW": ["/"] } });

        await w.fire("activate");

        expect(w.caches.store.has(old)).toBe(true);
        expect(w.self.clients.claim).toHaveBeenCalled();
    });

});
