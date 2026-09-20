import vue from "@vitejs/plugin-vue";

// Separate from vite.config.js on purpose. That one sets root to src/, which is
// right for building the app and wrong for finding tests, which live alongside the
// plain node suites in test/.
export default {
    plugins: [
        vue(),
    ],
    test: {
        // components touch document and window, so they need a DOM
        environment: "happy-dom",
        // only the component suites; the rest are plain node scripts run by npm test
        include: ["test/components/**/*.test.mjs"],
    },
};
