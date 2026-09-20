// Stamps the built service worker with this build's identity.
//
// Runs after vite build. Two problems it solves, both of which were invisible.
//
// The cache grew without bound. Hashed assets are cached first and never
// revalidated, which is right, but nothing removed the ones a new build replaced.
// Twelve deploys in a day left twelve complete copies of the app on the device.
// Naming the cache after the build means activate() deletes the previous one.
//
// And the service worker never updated. Its bytes were identical from build to
// build, and a browser only installs a new worker when the file has changed, so
// any future change to the caching rules would never have reached anyone already
// running the app.
//
// The identity is the main bundle's content hash rather than a timestamp or a
// counter. That way a build which changes no code keeps the same cache, and
// returning operators re-download nothing.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";

const INDEX = "dist/index.html";
const WORKER = "dist/service-worker.js";
const ASSETS = "dist/assets";
const PLACEHOLDER = "__BUILD_ID__";
const ASSETS_PLACEHOLDER = "__BUILD_ASSETS__";

for(const path of [INDEX, WORKER]){
    if(!existsSync(path)){
        console.error(`stamp-service-worker: ${path} is missing, run vite build first`);
        process.exit(1);
    }
}

const bundle = readFileSync(INDEX, "utf8").match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
if(!bundle){
    console.error("stamp-service-worker: no main bundle in dist/index.html, cannot identify this build");
    process.exit(1);
}

const worker = readFileSync(WORKER, "utf8");
for(const placeholder of [PLACEHOLDER, ASSETS_PLACEHOLDER]){
    if(!worker.includes(placeholder)){
        // without these the worker still runs, and that is the problem: the cache
        // name would be fixed again and the growth would return, or the build would
        // precache nothing and fail to start offline. Both are silent.
        console.error(`stamp-service-worker: ${placeholder} not found in the built worker`);
        process.exit(1);
    }
}

// everything vite emitted, which is knowable here and not inside the worker.
// caching these at install is what lets the app start offline after one load
// rather than two, and makes routes work that were never opened online.
const assets = readdirSync(ASSETS).map((name) => `/assets/${name}`).sort();
if(assets.length === 0){
    console.error("stamp-service-worker: dist/assets is empty, the build produced nothing to cache");
    process.exit(1);
}

const buildId = bundle[1];
writeFileSync(WORKER, worker
    .replaceAll(PLACEHOLDER, buildId)
    .replace(ASSETS_PLACEHOLDER, JSON.stringify(assets)));
console.log(`stamp-service-worker: cache is meshcore-emcomm-${buildId}, ${assets.length} assets precached`);
