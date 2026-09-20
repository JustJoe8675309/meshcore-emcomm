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

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const INDEX = "dist/index.html";
const WORKER = "dist/service-worker.js";
const PLACEHOLDER = "__BUILD_ID__";

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
if(!worker.includes(PLACEHOLDER)){
    // the source worker should carry the placeholder; without it the cache name
    // would be fixed again and the growth would come back silently
    console.error(`stamp-service-worker: ${PLACEHOLDER} not found in the built worker`);
    process.exit(1);
}

const buildId = bundle[1];
writeFileSync(WORKER, worker.replaceAll(PLACEHOLDER, buildId));
console.log(`stamp-service-worker: cache is meshcore-emcomm-${buildId}`);
