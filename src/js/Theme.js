import { reactive } from "vue";

/**
 * Light or dark, and following the device when told to.
 *
 * Asked for on 29 Sep. It is not a decoration here: this app is read at night at a
 * muster point, on a phone held at arm's length, and a white screen at 3am both ruins
 * the operator's night vision and is visible across a field. The opposite is true at
 * midday, which is why "follow the device" is the default rather than a fixed choice.
 *
 * Three states, not a switch. An operator who has set their phone to dark for the
 * evening should not have to set this as well; one who wants the app light while the
 * phone is dark should be able to say so and have it stick.
 */

const KEY = "theme";
const CHOICES = ["system", "light", "dark"];

const state = reactive({
    // what the operator chose: system, light or dark
    choice: "system",
    // what is actually on screen right now: light or dark
    resolved: "light",
});

let media = null;

class Theme {

    static get state() {
        return state;
    }

    static get CHOICES() {
        return CHOICES;
    }

    /**
     * The stored choice, or "system" when there is none.
     *
     * Read through a guard: a browser can refuse storage outright rather than return
     * null -- Brave's Shields set to block all cookies throw here -- and losing the
     * theme is not a reason to fail to start.
     */
    static choice() {
        try {
            const stored = window.localStorage.getItem(KEY);
            return CHOICES.includes(stored) ? stored : "system";
        } catch(e) {
            return "system";
        }
    }

    static prefersDark() {
        try {
            return window.matchMedia != null && window.matchMedia("(prefers-color-scheme: dark)").matches;
        } catch(e) {
            return false;
        }
    }

    /** What should be on screen, given the choice and the device. */
    static resolve(choice = this.choice()) {
        if(choice === "dark"){
            return "dark";
        }
        if(choice === "light"){
            return "light";
        }
        return this.prefersDark() ? "dark" : "light";
    }

    /**
     * Put it on the page. The class goes on <html> rather than <body> so the page
     * background itself changes, and not just what is drawn on it -- otherwise an
     * overscroll or a short page flashes white, which is exactly the thing this is
     * meant to avoid at night.
     */
    static apply(choice = this.choice()) {
        const resolved = this.resolve(choice);
        state.choice = choice;
        state.resolved = resolved;
        try {
            const root = document.documentElement;
            root.classList.toggle("dark", resolved === "dark");
            // so a browser draws its own scrollbars and form controls to match
            root.style.colorScheme = resolved;
        } catch(e) {
            // no document: nothing to paint
        }
        return resolved;
    }

    /**
     * Flip what is on screen, and remember it.
     *
     * Always the opposite of what the operator can actually see, which is why it reads
     * `resolve()` rather than `choice()`: from "system" at night, the honest flip is to
     * light, not to a "dark" that changes nothing. Toggling therefore always leaves an
     * explicit choice -- "follow the device" stays available in settings, where there is
     * room to say what it means.
     */
    static toggle() {
        const next = this.resolve() === "dark" ? "light" : "dark";
        this.set(next);
        return next;
    }

    static set(choice) {
        if(!CHOICES.includes(choice)){
            return false;
        }
        try {
            window.localStorage.setItem(KEY, choice);
        } catch(e) {
            // the choice still holds for this session; it just will not be remembered
        }
        this.apply(choice);
        return true;
    }

    /**
     * Apply the stored choice and keep following the device while the choice is
     * "system". Called once at startup.
     */
    static start() {
        this.apply();
        try {
            if(window.matchMedia == null){
                return;
            }
            media = window.matchMedia("(prefers-color-scheme: dark)");
            const onChange = () => {
                // only follow the device while the operator has not overridden it
                if(state.choice === "system"){
                    this.apply("system");
                }
            };
            if(media.addEventListener != null){
                media.addEventListener("change", onChange);
            } else if(media.addListener != null){
                // older WebKit, which is most of the iOS field
                media.addListener(onChange);
            }
        } catch(e) {
            // a browser that will not answer the question keeps whatever is applied
        }
    }

}

export default Theme;
