/**
 * What version this station is running, and when it was built.
 *
 * Asked for on 29 Sep. The point is a question that gets asked across a net --
 * "what version are you on?" -- being answerable by someone holding a phone, rather
 * than only from a developer console. The build already carries a content hash in its
 * filename and the service worker cache is stamped with it, but neither is a thing
 * anybody can read aloud.
 *
 * **Both values come from the build, never from a constant typed in here.** A version
 * that has to be remembered is a version that goes stale the first time somebody
 * forgets, and a station claiming 1.1 while running 1.0 is worse than one claiming
 * nothing: it is the answer the net would act on.
 *
 * The number is major.minor from package.json. The patch is deliberately not shown --
 * it is what changes when a typo is fixed, and it would make the label long enough to
 * crowd the station name on a phone, which is the one thing in that header that has to
 * stay readable.
 */

// injected by vite, see vite.config.js. `typeof` rather than a direct read because
// under vitest nothing is injected and an undeclared identifier would throw; the
// tests pass both values in explicitly, so the fallbacks only shape what an
// un-injected build would show, which is nothing.
const BUILD = typeof __BUILD__ === "object" && __BUILD__ != null ? __BUILD__ : {};
const VERSION = typeof BUILD.version === "string" ? BUILD.version : "";
const BUILT_AT = typeof BUILD.builtAt === "string" ? BUILD.builtAt : "";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

class Version {

    /** "1.1" from a package version of "1.1.0". */
    static number(raw = VERSION) {
        const parts = String(raw ?? "").split(".");
        if(parts.length < 2 || parts[0] === ""){
            return null;
        }
        return `${parts[0]}.${parts[1]}`;
    }

    /** "29 Sep 2026" from the ISO stamp the build put in. */
    static built(raw = BUILT_AT) {
        if(!raw){
            return null;
        }
        const at = new Date(raw);
        if(Number.isNaN(at.getTime())){
            return null;
        }
        return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
    }

    /**
     * "v1.1 · 29 Sep 2026", or as much of it as the build supplied. Returns null when
     * neither is known, so a caller can leave the space empty rather than printing a
     * label that says nothing.
     */
    static label(version = VERSION, builtAt = BUILT_AT) {
        const number = this.number(version);
        const date = this.built(builtAt);
        if(number == null && date == null){
            return null;
        }
        if(date == null){
            return `v${number}`;
        }
        if(number == null){
            return date;
        }
        return `v${number} · ${date}`;
    }

}

export default Version;
