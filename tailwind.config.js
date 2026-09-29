import formsPlugin from '@tailwindcss/forms';

/** @type {import('tailwindcss').Config} */
export default {
    // the .dark class is put on <html> by src/js/Theme.js, which follows the device
    // unless the operator has chosen otherwise
    darkMode: 'class',
    content: [
        "./src/index.html",
        "./src/**/*.{vue,js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {

        },
    },
    plugins: [
        formsPlugin,
    ],
};
