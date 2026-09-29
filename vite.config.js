import path from "path";
import { readFileSync } from "fs";
import vue from '@vitejs/plugin-vue';

// The version and build date are injected rather than written into the source. A
// version somebody has to remember to update is one that goes stale, and a station
// claiming a version it is not running is worse than one claiming none: it is the
// answer the net would act on.
const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf-8"));
const builtAt = new Date().toISOString();

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
