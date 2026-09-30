import path from "path";
import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import vue from '@vitejs/plugin-vue';

// The version and build date are injected rather than written into the source. A
// version somebody has to remember to update is one that goes stale, and a station
// claiming a version it is not running is worse than one claiming none: it is the
// answer the net would act on.
const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf-8"));

// The commit's date, not the clock's.
//
// `new Date()` here made the build unreproducible: two builds of identical source
// produced different content hashes, because the timestamp went into a chunk. That
// quietly broke the audit's "live build matches local" check, which is one of the two
// things that can tell an operator whether what is deployed is what we have -- the
// deployed hash could never match a local one again. Found by deploying and watching
// the live hash come back different from the local one for the same commit.
//
// The commit date is within hours of the deploy and is the honest thing to show
// anyway: two stations reporting the same version now agree on its date, and the
// number can be checked against the repository. Falls back to the clock for a build
// from a tarball with no git.
let builtAt;
try {
    builtAt = execFileSync("git", ["log", "-1", "--format=%cI"], { cwd: __dirname })
        .toString().trim();
} catch(e) {
    builtAt = new Date().toISOString();
}
if(!builtAt){
    builtAt = new Date().toISOString();
}

export default {

    // vite app is loaded from /src
    root: path.join(__dirname, "src"),

    // build to /dist instead of /src/dist
    build: {
        outDir: '../dist',
        emptyOutDir: true,
    },

    // One labelled object, not two bare strings. A bare "1.1.0" in the bundle is
    // indistinguishable from the hundreds of dependency version strings already in
    // there -- the audit check for it passed against a version the build could not
    // possibly have contained. `version:` and `builtAt:` survive minification, so
    // the shipped app can be asked what it thinks it is and answer unambiguously.
    define: {
        __BUILD__: JSON.stringify({ version: pkg.version, builtAt }),
    },

    // add plugins
    plugins: [
        vue(),
    ],

}
