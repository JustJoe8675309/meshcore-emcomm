// Offline support.
//
// An emergency communications client that only works while the network is up is
// not much use during an emergency. Everything this app needs at runtime is local:
// the radio is on USB or Bluetooth, and messages live in IndexedDB. The only thing
// standing between it and working with no infrastructure is fetching its own files,
// which is what this caches.
//
// One online load is required first, to populate the cache. After that the app
// starts with no network at all.

// Stamped with the build's own bundle hash by scripts/stamp-service-worker.mjs,
// so every build gets its own cache and activate() drops the previous one.
//
// This was a fixed string, and the cache grew without bound: /assets/ is cache
// first and nothing evicted superseded builds, so twelve deploys in a day left
// twelve complete copies of the app, 197 entries and 6.75 MB, on the device.
//
// Pruning by what index.html references would have been wrong. The app code
// splits, so lazily loaded chunks are named in JavaScript rather than in the
// document, and deleting them would leave routes that work online and fail
// offline, which is the worst possible outcome for this app.
//
// The hash comes from the main bundle, so a build that changes no code keeps the
// same cache and costs returning operators nothing. A build that does change code
// re-downloads, which is affordable because a new service worker only ever
// arrives over the network in the first place.
const CACHE_NAME = "meshcore-emcomm-__BUILD_ID__";

// the minimum needed to boot
const APP_SHELL = [
    "/",
    "/index.html",
    "/manifest.json",
    "/icon.png",
];

// This build's hashed output, listed by scripts/stamp-service-worker.mjs, which
// runs after vite and so can see what the build actually produced.
//
// These used to be cached only as they were requested, which left a window where
// the app could not start offline at all. A new build gets a new, empty cache, and
// the new worker only takes control after the page that fetched the bundle has
// already loaded, so the first load after a deploy cached the shell and none of the
// code it references. index.html would come back from the cache offline and then
// fail to boot. It healed on the next online load, which is no comfort to an
// operator who updated the app and then lost infrastructure.
//
// Precaching also makes routes that were never visited online work offline, rather
// than only the ones the operator happened to open while they still had a network.
const BUILD_ASSETS = __BUILD_ASSETS__;

// Only build output is cached, named explicitly.
//
// This started as a list of things to exclude, which was the wrong way round. Vite's
// root is src/, so during development modules are served from paths like /js/... and
// /components/..., which an exclusion list does not cover unless it happens to name
// them. The result was the service worker caching dev modules and serving stale code
// back to the browser. A whitelist cannot make that mistake: anything not recognised
// here goes straight to the network and is never stored.
// (the shell paths are APP_SHELL above)

// content hashed build output, safe to serve from cache indefinitely
function isImmutableAsset(url) {
    return url.pathname.startsWith("/assets/");
}

function isCacheableShell(url) {
    return APP_SHELL.includes(url.pathname);
}

async function putInCache(request, response) {
    // opaque and error responses would poison the cache
    if(!response || !response.ok || response.type === "opaque"){
        return;
    }
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
}

self.addEventListener("fetch", (event) => {

    const request = event.request;

    // only ever cache plain GETs of our own files
    if(request.method !== "GET"){
        return;
    }

    const url = new URL(request.url);
    if(url.origin !== self.location.origin){
        return;
    }

    // the page itself: prefer the network so a new deploy is picked up, but fall
    // back to the cached shell when there is nothing to reach. the app uses hash
    // routing, so every route is served by the same document.
    if(request.mode === "navigate"){
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                await putInCache(request, response);
                return response;
            } catch(e) {
                const cached = await caches.match(request) || await caches.match("/index.html") || await caches.match("/");
                if(cached){
                    return cached;
                }
                throw e;
            }
        })());
        return;
    }

    // hashed assets never change under the same name, so cache first and skip the
    // network entirely once they are held
    if(isImmutableAsset(url)){
        event.respondWith((async () => {
            const cached = await caches.match(request);
            if(cached){
                return cached;
            }
            const response = await fetch(request);
            await putInCache(request, response);
            return response;
        })());
        return;
    }

    // anything not recognised as build output is left entirely alone, which is what
    // keeps development working and stops unknown responses accumulating in the cache
    if(!isCacheableShell(url)){
        return;
    }

    // the remaining shell files: serve from cache when present, and refresh in the
    // background so the next start is current
    event.respondWith((async () => {

        const cached = await caches.match(request);

        const networkFetch = fetch(request).then(async (response) => {
            await putInCache(request, response);
            return response;
        });

        if(cached){
            // do not let a failed background refresh surface as an error
            event.waitUntil(networkFetch.catch(() => {}));
            return cached;
        }

        return networkFetch;

    })());

});

// Install all or nothing, and only then take over.
//
// This was best effort: every file that failed to download was logged and
// skipped, and the worker took control anyway, deleting the previous build's
// cache as it activated. The audit caught the result on the bench. An update
// arrived while the tab's network was down, the new worker installed with an
// empty cache, took over, and threw away a complete one: the next load offline
// was "This site can't be reached". In the field that is an operator who gets an
// update over a bad link, and loses the app's offline copy at the worst moment.
//
// The old comment here argued that an all or nothing install would leave the app
// unable to start offline because of one missing chunk. It is the other way
// round. A failed install changes nothing: the previous worker and its complete
// cache stay in charge, the app starts offline on the build it already had, and
// the browser tries the update again on a later visit. Only a first install has
// no previous copy to fall back on, and a partial copy would not have booted
// either.
self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        // rejects if any file fails or answers with an error, which fails the
        // install and leaves the previous worker in control
        await cache.addAll([...APP_SHELL, ...BUILD_ASSETS]);
        await self.skipWaiting();
    })());
});

// Take over, and drop older builds only once this one is known to be complete.
//
// The install above guarantees that on its own. This checks again because
// deleting the previous cache is the one step here that cannot be undone, and a
// worker whose script changed without its bundle changing shares its cache name
// with the build it replaces.
self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        const held = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
        const complete = [...APP_SHELL, ...BUILD_ASSETS].every((path) => held.has(path));
        if(complete){
            const names = await caches.keys();
            await Promise.all(names
                .filter((name) => name !== CACHE_NAME)
                .map((name) => caches.delete(name)));
        } else {
            console.log("service worker: this build is not fully cached, so older caches are kept");
        }
        await self.clients.claim();
    })());
});

// handle push notification click
self.addEventListener('notificationclick', function(event) {

    // dismiss it
    event.notification.close();

    // open pwa
    event.waitUntil(findClient().then((client) => {

        // if an existing client exists, focus it and then send it the notification data
        if(client){
            client.focus();
            client.postMessage({
                type: "notificationclick",
                data: event.notification.data,
            });
            return;
        }

        // otherwise open a new window
        return self.clients.openWindow("/");

    }));

});

// find any running client
const findClient = function() {
    return self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
    }).then(function(clients) {
        return clients[0];
    });
};
