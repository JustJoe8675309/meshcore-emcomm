// Full audit.
//
// Two jobs. The first is the ordinary one: do the tests pass and does it build.
// The second matters more and is easy to forget, because nothing here fails when
// it goes wrong: this fork depends on facts about somebody else's firmware and
// somebody else's library, and those facts can change without warning.
//
// Where the library does not implement something, this app writes the bytes by
// hand. Command 55 and push code 0x8E are assembled and parsed here rather than by
// meshcore.js. If the firmware renumbers them, discovery stops working and reports
// "no repeater answered", which is a legitimate result and so looks like an answer
// rather than a fault. That is exactly the failure this checks for.
//
// Network checks are skipped rather than failed when offline, because an audit run
// in the field should still tell you whether the app works.

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const PASS = "PASS", FAIL = "FAIL", WARN = "WARN", SKIP = "SKIP";
const results = [];

function record(section, name, status, detail = "") {
    results.push({ section, name, status, detail });
    const mark = { PASS: "  ok ", FAIL: "FAIL ", WARN: "warn ", SKIP: "skip " }[status];
    console.log(`${mark} ${name}${detail ? "  — " + detail : ""}`);
}

function section(title) {
    console.log(`\n=== ${title} ===`);
}

function run(command, { quiet = true } = {}) {
    return execSync(command, { encoding: "utf8", stdio: quiet ? "pipe" : "inherit", maxBuffer: 32 * 1024 * 1024 });
}

function tryRun(command) {
    try {
        return { ok: true, out: run(command) };
    } catch(e) {
        return { ok: false, out: (e.stdout ?? "") + (e.stderr ?? ""), error: e };
    }
}

// ---------------------------------------------------------------- the app itself

section("Tests and build");
{
    const tests = tryRun("npm test");
    const suites = (tests.out.match(/ALL CHECKS PASSED/g) ?? []).length;
    const components = tests.out.match(/Tests\s+(\d+) passed/);

    // Say which test failed, rather than "run it directly". A run under this
    // script has failed twice with everything passing on its own, and an audit
    // that cannot tell a real failure from its own flake is worth nothing in the
    // hour before a deployment.
    const named = tests.out.match(/^\s*FAIL\s+(.+)$/m)?.[1]?.trim();
    const why = tests.ok ? ""
        : named ? named
        : `npm test exited ${tests.error?.status ?? "?"}${tests.error?.signal ? " on " + tests.error.signal : ""}`
            + ", with no FAIL line: the run itself did not finish";

    record("app", `node suites (${suites} of 6)`, suites === 6 && tests.ok ? PASS : FAIL, tests.ok ? "" : why);
    record("app", `component tests (${components?.[1] ?? "?"})`, components && tests.ok ? PASS : FAIL, tests.ok ? "" : why);

    // npm run build, not vite directly: the real build also stamps the service
    // worker, and auditing a build nobody ships is worse than not auditing one
    const build = tryRun("npm run build");
    record("app", "production build", build.ok ? PASS : FAIL);
}

// ------------------------------------------------- assumptions about the library

section("Assumptions about meshcore.js");
{
    const pkgPath = "node_modules/@liamcottle/meshcore.js/package.json";
    if(!existsSync(pkgPath)){
        record("library", "installed", FAIL, "run npm install");
    } else {

        const installed = JSON.parse(readFileSync(pkgPath, "utf8")).version;
        record("library", `version ${installed}`, PASS);

        const constants = readFileSync("node_modules/@liamcottle/meshcore.js/src/constants.js", "utf8");

        // the repeater filter in a discovery request is 1 << this
        const repeaterType = constants.match(/Repeater:\s*(\d+)/)?.[1];
        record("library", "AdvType.Repeater is 2", repeaterType === "2" ? PASS : FAIL,
            repeaterType === "2" ? "" : `now ${repeaterType}; the discovery type filter is built from it`);

        // if the library ever implements these, the hand written frames should go
        const hasControlData = /SendControlData\s*:\s*55/.test(constants);
        const hasControlPush = /ControlData\s*:\s*0x8E/i.test(constants);
        record("library", "control data still unimplemented", hasControlData || hasControlPush ? WARN : PASS,
            hasControlData || hasControlPush
                ? "the library now has it, so Connection.discoverRepeaters can stop writing raw frames"
                : "discovery is hand written, as expected");

        const latest = tryRun("npm view @liamcottle/meshcore.js version");
        if(!latest.ok){
            record("library", "newer version available", SKIP, "offline");
        } else {
            const newest = latest.out.trim();
            record("library", `latest is ${newest}`, newest === installed ? PASS : WARN,
                newest === installed ? "" : `installed ${installed}; read its changelog before upgrading`);
        }

    }
}

// ------------------------------------------------ assumptions about the firmware

section("Assumptions about the MeshCore firmware");
{
    const gh = tryRun("gh --version");
    if(!gh.ok){
        record("firmware", "protocol constants", SKIP, "gh not available");
    } else {

        // each of these is a number this app hard codes because the library does not
        // expose it. the source of truth is the firmware, so check the firmware.
        const wanted = [
            {
                name: "CMD_SEND_CONTROL_DATA is 55",
                path: "examples/companion_radio/MyMesh.cpp",
                pattern: /#define\s+CMD_SEND_CONTROL_DATA\s+55\b/,
                why: "discovery requests are sent with this command byte",
            },
            {
                name: "PUSH_CODE_CONTROL_DATA is 0x8E",
                path: "examples/companion_radio/MyMesh.cpp",
                pattern: /#define\s+PUSH_CODE_CONTROL_DATA\s+0x8E\b/i,
                why: "discovery replies are recognised by this push code",
            },
            {
                name: "CMD_GET_CONTACT_BY_KEY is 30",
                path: "examples/companion_radio/MyMesh.cpp",
                pattern: /#define\s+CMD_GET_CONTACT_BY_KEY\s+30\b/,
                why: "an advert fetches just that contact with this command; renumbered, every advert falls back to a full re-read of the list",
            },
            {
                name: "PUSH_CODE_CONTACT_DELETED is 0x8F",
                path: "examples/companion_radio/MyMesh.cpp",
                pattern: /#define\s+PUSH_CODE_CONTACT_DELETED\s+0x8F\b/i,
                why: "contacts the radio evicts are removed from the list on this push; missed, they stay listed for good",
            },
            {
                name: "DISCOVER_REQ is 0x80",
                path: "examples/simple_repeater/MyMesh.cpp",
                pattern: /#define\s+CTL_TYPE_NODE_DISCOVER_REQ\s+0x80\b/i,
                why: "the discovery request payload starts with this",
            },
            {
                name: "DISCOVER_RESP is 0x90",
                path: "examples/simple_repeater/MyMesh.cpp",
                pattern: /#define\s+CTL_TYPE_NODE_DISCOVER_RESP\s+0x90\b/i,
                why: "replies are matched on the top four bits of this",
            },
            {
                // out_path_len and a packet's path_len are not counts: the top two
                // bits hold the path hash size and the bottom six the hop count.
                // Reading the byte as a number reported a directly reachable
                // station as 128 hops away, and the rx log as three times its real
                // hop count. If this packing changes the app misreports distances
                // rather than failing, which is why it is checked here.
                name: "path length packs hash size and hop count",
                path: "src/Packet.cpp",
                pattern: /hash_count\s*=\s*path_len\s*&\s*63[\s\S]{0,120}hash_size\s*=\s*\(path_len\s*>>\s*6\)\s*\+\s*1/,
                why: "PathInfo and the rx log unpack the byte with these exact shifts",
            },
            {
                name: "path hash size 4 is still reserved",
                path: "src/Packet.cpp",
                pattern: /hash_size\s*==\s*4\s*\)\s*return\s+false/,
                why: "this is what keeps OUT_PATH_UNKNOWN (0xFF) from colliding with a real route",
            },
            {
                name: "OUT_PATH_UNKNOWN is 0xFF",
                path: "src/helpers/ContactInfo.h",
                pattern: /#define\s+OUT_PATH_UNKNOWN\s+0xFF\b/i,
                why: "the no path sentinel the contact list renders as flood routed",
            },
            {
                name: "MAX_PATH_SIZE is 64",
                path: "src/MeshCore.h",
                pattern: /#define\s+MAX_PATH_SIZE\s+64\b/,
                why: "the bound PathInfo uses to reject a path that could not fit",
            },
            {
                // position roll calls and answers in a room go as plain posts for
                // exactly this reason: both bench radios are admins of the test room
                name: "a room runs text type 1 from an admin as a command",
                path: "examples/simple_room_server/MyMesh.cpp",
                pattern: /flags\s*==\s*TXT_TYPE_CLI_DATA\s*\)\s*\{\s*if\s*\(\s*client->isAdmin\(\)\s*\)/,
                why: "if rooms stop doing this, type 1 could carry room traffic out of stock apps' sight; if they change how, re-check sendRoomPost",
            },
            {
                name: "the Bluetooth send queue drops what will not fit",
                path: "src/helpers/esp32/SerialBLEInterface.cpp",
                pattern: /send_queue_len\s*>=\s*FRAME_QUEUE_SIZE\s*\)\s*\{[\s\S]{0,160}?return\s+0;/,
                why: "why a contact read over Bluetooth loses a different few every pass, and why the app reads the list up to 8 times",
            },
            {
                name: "that queue is four frames deep",
                path: "src/helpers/esp32/SerialBLEInterface.h",
                pattern: /#define\s+FRAME_QUEUE_SIZE\s+4\b/,
                why: "four frames is what a burst of adverts fills, which is what costs the contacts",
            },
            {
                name: "a room post holds 151 bytes",
                path: "examples/simple_room_server/MyMesh.h",
                pattern: /#define\s+MAX_POST_TEXT_LEN\s+\(\s*160\s*-\s*9\s*\)/,
                why: "position posts in a room are cut to Protocol.MAX_ROOM_BYTES, 151",
            },
            {
                name: "a room keeps 32 posts",
                path: "examples/simple_room_server/MyMesh.h",
                pattern: /#define\s+MAX_UNSYNCED_POSTS\s+32\b/,
                why: "the room settings warn that position posts take one of the room's 32 places",
            },
            {
                name: "a room stamps posts with its own clock",
                path: "examples/simple_room_server/MyMesh.cpp",
                pattern: /memcpy\(\s*&reply_data\[len\],\s*&post\.post_timestamp,\s*4\s*\)/,
                why: "replayed room requests are told from new ones by this time",
            },
            {
                name: "every channel slot answers, and only the ones past the end error",
                path: "src/helpers/BaseChatMesh.cpp",
                pattern: /getChannel\(int idx, ChannelDetails& dest\)\s*\{\s*if\s*\(\s*idx >= 0 && idx < MAX_GROUP_CHANNELS\s*\)/,
                why: "an unused slot answers with an empty name, which is what lets a read failure with an answered slot after it be called a hole",
            },
            {
                name: "a room stops pushing after three failed pushes",
                path: "examples/simple_room_server/MyMesh.cpp",
                pattern: /push_failures\s*<\s*3/,
                why: "RoomKeepAlive exists to clear this count; if the rule goes, the keep-alive interval can be reconsidered",
            },
            {
                name: "a client request resets the push failure count",
                path: "examples/simple_room_server/MyMesh.cpp",
                pattern: /extra\.room\.push_failures\s*=\s*0;\s*\/\/\s*reset so push can resume/,
                why: "the keep-alive request is the only thing that gets a cut-off station's posts flowing again",
            },
            {
                name: "a keep-alive request is type 2",
                path: "src/helpers/BaseChatMesh.h",
                pattern: /#define\s+REQ_TYPE_KEEP_ALIVE\s+0x02\b/,
                why: "RoomKeepAlive.REQ_TYPE_KEEP_ALIVE sends this byte",
            },
            {
                name: "a blank password login skips the reset block",
                path: "examples/simple_room_server/MyMesh.cpp",
                pattern: /if\s*\(\s*data\[8\]\s*==\s*0\s*\)\s*\{\s*\/\/\s*blank password/,
                why: "why logging in again does not restart a room's pushes, which is what the keep-alive is for",
            },
            {
                name: "a room login carries the room's clock",
                path: "examples/companion_radio/MyMesh.cpp",
                pattern: /memcpy\(\s*&out_frame\[i\],\s*&tag,\s*4\s*\);\s*i\s*\+=\s*4;\s*\/\/\s*NEW:\s*include server timestamp/,
                why: "readRoomClockOffset reads bytes 8 to 11 of the login success push as the room's time",
            },
            {
                name: "MAX_TEXT_LEN is 160",
                path: "src/helpers/BaseChatMesh.h",
                pattern: /MAX_TEXT_LEN\s*\(?\s*(?:160|10\s*\*\s*CIPHER_BLOCK_SIZE)/,
                why: "every byte budget and split in the app is derived from it",
            },
        ];

        const cache = new Map();
        for(const check of wanted){

            if(!cache.has(check.path)){
                const fetched = tryRun(`gh api repos/meshcore-dev/MeshCore/contents/${check.path} --jq .content`);
                cache.set(check.path, fetched.ok ? Buffer.from(fetched.out, "base64").toString("utf8") : null);
            }

            const source = cache.get(check.path);
            if(source === null){
                record("firmware", check.name, SKIP, "could not fetch, offline or rate limited");
                continue;
            }

            const holds = check.pattern.test(source);
            record("firmware", check.name, holds ? PASS : FAIL, holds ? "" : check.why);

        }

    }
}

// -------------------------------------------------------------- upstream drift

section("Upstream fork");
{
    const hasUpstream = tryRun("git remote get-url upstream");
    if(!hasUpstream.ok){
        record("upstream", "remote configured", SKIP, "no upstream remote");
    } else {
        const fetched = tryRun("git fetch upstream --quiet");
        if(!fetched.ok){
            record("upstream", "commits not in this fork", SKIP, "offline");
        } else {

            // do not assume the branch name: this fork is on master and plenty of
            // projects are on main, and guessing wrong skips the check silently
            const heads = tryRun("git ls-remote --heads upstream");
            const branch = ["main", "master"].find((b) => heads.out?.includes(`refs/heads/${b}`));

            if(!branch){
                record("upstream", "commits not in this fork", SKIP, "no main or master on upstream");
            } else {
                const behind = tryRun(`git rev-list --count HEAD..upstream/${branch}`);
                const count = Number(behind.out?.trim() ?? NaN);
                record("upstream", `commits not in this fork (${branch})`,
                    Number.isNaN(count) ? SKIP : (count === 0 ? PASS : WARN),
                    Number.isNaN(count) ? "could not compare"
                        : (count === 0 ? "level with upstream" : `${count} upstream commits, review before merging`));
            }

        }
    }
}

// ----------------------------------------------------------- what is deployed

section("Deployment");
{
    const localAsset = tryRun('node -e "const fs=require(\'fs\');const f=fs.readdirSync(\'dist/assets\').find(n=>/^index-.*\\.js$/.test(n));process.stdout.write(f||\'\')"');
    const local = localAsset.out?.trim();

    const served = tryRun('curl -s --max-time 15 https://app.meshcore-emcomm.workers.dev/');
    if(!served.ok || !served.out){
        record("deploy", "live build matches local", SKIP, "could not reach the site");
    } else {
        const remote = served.out.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1];
        record("deploy", "live build matches local", remote === local ? PASS : WARN,
            remote === local ? remote : `live ${remote}, local ${local}; push or rebuild`);
    }

    // a fixed cache name is how the cache grew without bound before, and it fails
    // silently, so check the stamp actually landed
    if(existsSync("dist/service-worker.js")){
        const worker = readFileSync("dist/service-worker.js", "utf8");
        const stamped = worker.match(/meshcore-emcomm-([A-Za-z0-9_-]+)/)?.[1];
        const bundle = existsSync("dist/index.html")
            ? readFileSync("dist/index.html", "utf8").match(/assets\/index-([A-Za-z0-9_-]+)\.js/)?.[1]
            : null;
        record("deploy", "service worker stamped with the build",
            stamped && stamped === bundle ? PASS : FAIL,
            stamped === "__BUILD_ID__" ? "placeholder left in place, the cache would grow for ever"
                : (stamped === bundle ? `meshcore-emcomm-${stamped}` : `worker says ${stamped}, bundle is ${bundle}`));

        // without the asset list the worker still installs and the app still works
        // online, and only fails on the first offline start after a deploy, which is
        // the moment it is least likely to be noticed and most likely to matter
        const listed = worker.match(/const BUILD_ASSETS = (\[[^\]]*\])/)?.[1];
        const precached = listed ? JSON.parse(listed) : [];
        const hasBundle = bundle && precached.includes(`/assets/index-${bundle}.js`);
        record("deploy", "service worker precaches this build",
            hasBundle ? PASS : FAIL,
            !listed ? "no asset list, the app cannot start offline until its second load"
                : (hasBundle ? `${precached.length} assets` : "the main bundle is not in the precache list"));
    }

    const dirty = tryRun("git status --porcelain");
    record("deploy", "working tree clean", dirty.out.trim() === "" ? PASS : WARN, dirty.out.trim().split("\n")[0] ?? "");

    const unpushed = tryRun("git log origin/master..HEAD --oneline");
    const n = unpushed.out.trim() === "" ? 0 : unpushed.out.trim().split("\n").length;
    record("deploy", "everything pushed", n === 0 ? PASS : WARN, n === 0 ? "" : `${n} unpushed`);
}

// ------------------------------------------------------------------- summary

const failed = results.filter((r) => r.status === FAIL);
const warned = results.filter((r) => r.status === WARN);
const skipped = results.filter((r) => r.status === SKIP);

console.log(`\n${"=".repeat(60)}`);
console.log(`${results.length} checks: ${results.filter((r) => r.status === PASS).length} passed, `
    + `${failed.length} failed, ${warned.length} to look at, ${skipped.length} skipped`);

if(failed.length){
    console.log("\nFailed:");
    failed.forEach((r) => console.log(`  ${r.name}${r.detail ? " — " + r.detail : ""}`));
}
if(warned.length){
    console.log("\nWorth a look:");
    warned.forEach((r) => console.log(`  ${r.name}${r.detail ? " — " + r.detail : ""}`));
}
if(skipped.length){
    console.log(`\nSkipped (${skipped.map((r) => r.name).join(", ")})`);
}

console.log("\nThis covers what a machine can check. The hardware checklist in");
console.log("docs/AUDIT.md is the other half, and it is the half that has found");
console.log("every real fault so far.");

process.exit(failed.length === 0 ? 0 : 1);
