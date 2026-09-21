import vue from "@vitejs/plugin-vue";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Separate from vite.config.js on purpose. That one sets root to src/, which is
// right for building the app and wrong for finding tests, which live alongside the
// plain node suites in test/.
export default {
    plugins: [
        vue(),
    ],
    resolve: {
        alias: [
            // the app is built with src/ as the root, so a component asking for
            // "/icon.png" means src/public/icon.png. Tests run from the project
            // root and would not find it, failing the whole file before a single
            // test runs.
            { find: /^\/icon\.png$/, replacement: path.join(here, "src/public/icon.png") },
        ],
    },
    test: {
        // components touch document and window, so they need a DOM
        environment: "happy-dom",
        // only the component suites; the rest are plain node scripts run by npm test
        include: ["test/components/**/*.test.mjs"],
    },
};
