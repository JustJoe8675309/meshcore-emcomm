# Full audit

Run `npm run audit` first, then work through the hardware checklist below.

The script covers what a machine can check. The checklist covers what it cannot, and
that is the half that has found every real fault so far: a request frame missing its
command byte, a run that kept transmitting after its tab closed, a disconnected radio
reported as packet loss, a duration estimate four times out. None of those failed a
test or a build at the time.

## Why drift matters here

This fork depends on facts about other people's code, and those facts can change
without anything here breaking loudly.

`meshcore.js` does not implement repeater discovery, so this app writes the request
frame and parses the reply itself. Command `55` and push code `0x8E` are hard coded.
If the firmware renumbers them, discovery will report **"No repeater answered"** —
which is a legitimate result, so it reads as an answer rather than a fault. The script
checks those constants against the firmware source for exactly that reason.

It also warns if the library starts implementing control data, because at that point
the hand written frames should be deleted rather than maintained.

## What the script checks

| Group | Checks |
| ----- | ------ |
| Tests and build | six node suites, the component suites, a production build |
| meshcore.js | installed version, a newer release, `AdvType.Repeater`, whether control data is still unimplemented |
| Firmware | `CMD_SEND_CONTROL_DATA`, `PUSH_CODE_CONTROL_DATA`, `DISCOVER_REQ`, `DISCOVER_RESP`, `MAX_TEXT_LEN`, the path length packing, `OUT_PATH_UNKNOWN`, `MAX_PATH_SIZE` |
| Upstream | commits in `liamcottle/meshcore-web` not in this fork |
| Deployment | the live build matches the local one, the worker is stamped and precaches this build, the tree is clean, everything is pushed |

Network checks are skipped rather than failed when offline, so an audit in the field
still tells you whether the app works.

## Hardware checklist

Two radios, both powered. Test on the **Emcomm Testing** channel, never Public, and
mark every transmission `DRILL`. Roughly 20 to 30 transmissions in total.

Connect each radio in its own browser tab; a radio can only be held by one page.

### Sending

- [ ] **Multi-part report to a channel.** Every part arrives on the other node, in
      order, with `[1/2]` style markers. This is the path most likely to regress,
      because the send loop is where the reliability work happened.
- [ ] **Multi-part report direct to a contact.** Every part reports **Delivered**, and
      they go out one at a time. The device tracks a single outstanding direct message,
      so a part sent before the previous is acknowledged is simply lost.
- [ ] **Split points fall between fields**, not mid field, on a report that splits.

### Position

Worth doing on both radios if they differ, because a guard is only demonstrated by the
case it refuses.

- [ ] **A radio with GPS** fills the field, and the value is a plausible position to
      four decimal places.
- [ ] **A radio without GPS** offers `Check GPS`, probes again when pressed, and
      **leaves the field empty**. It must never write `0, 0`, which formats perfectly
      well and points at the Gulf of Guinea.

### Date time groups

- [ ] Exact, approximate (`ABT` prefix) and a range.
- [ ] A range crossing a month renders both months, `302300L SEP-010100L OCT`, rather
      than compacting and losing one.

### Ping and discovery

- [ ] **Discover** finds the repeaters in direct range, with both signal readings.
- [ ] **Clicking a discovered repeater** selects it in the picker below.
- [ ] **Ping** a repeater that answers traces. Signal readings should be exact
      multiples of 0.25, which is the sign the quarter dB decoding is right.
- [ ] **A repeater that answers discovery but not ping** is explained rather than
      looking broken. Not every repeater answers traces.

### Failure handling

These are the ones worth the trouble, because each produces a confident wrong answer
rather than an error.

- [ ] **Pull the cable mid ping run.** The run stops and says the radio disconnected.
      The replies already collected are kept and the loss figure covers only what was
      actually sent. It must not fill the remainder with timeouts.
- [ ] **Cancel a run part way.** Statistics cover the replies collected, not the whole
      intended run.
- [ ] **A run where everything times out.** Loss reads 100% and the averages are
      hidden, because `avg snr 0dB` would read as a measurement of a dead link rather
      than the absence of one.
- [ ] **A run that partly succeeds.** The loss percentage and averages are taken over
      the real replies only.
- [ ] **Switch tabs mid send.** Transmission stops. Nothing should keep talking to the
      radio with no display and no way to cancel.

### Room servers

Needs a room you control. Everything here was wrong at some point and none of it
failed loudly, so walk it rather than assuming. A room three or four hops out is a
worse test than one at zero hops: put the room in direct range and routing stops
being a variable.

- [ ] **The room appears** in the contacts tab with its own icon, and opens a
      conversation titled Room. Discovery will never find it, whatever the range:
      the room firmware does not implement the control packet at all. It has to
      advert in earshot, or be added from a `meshcore://` link.
- [ ] **Log in.** Watch how long it takes. A room in direct range answers in about
      a second and one several hops out took 10 to 12, against the 8.8 the library
      used to allow. If a login ever reports no answer, listen past the timeout on
      the raw frames before believing it.
- [ ] **The role is read from the reply**, not guessed. A room granting admin says
      "Logged in as admin"; one granting read only says so and the composer refuses
      to post. Both were reported wrong by reading the legacy byte.
- [ ] **A wrong password looks exactly like silence**, by design: the room source
      says "no response. Client will timeout". The message must not blame the range.
- [ ] **Post.** It should read Delivered, and it should appear in the room on
      another client. Delivered alone is not proof the room accepted it.
- [ ] **A post from somebody else is attributed by name**, not by four bytes of
      mojibake. Rows stored before that fix keep theirs: the bytes were destroyed
      by UTF-8 decoding before they were saved and cannot be recovered, so check a
      post that arrives during the test rather than scrollback.

### Offline

The interesting case is the **first** load after a deploy, not the steady state. A new
build gets a new, empty cache, so anything the worker does not precache at install is
missing exactly once — and the app looked fine online while being unable to start at
all offline.

- [ ] After a deploy, load the app **once**, then check the cache holds the whole build
      and not just the shell. `caches.keys()` should show one `meshcore-emcomm-<hash>`
      matching the bundle in `index.html`, and it should contain
      `/assets/index-<hash>.js`, not only `/`, `/index.html`, `/manifest.json`,
      `/icon.png`. A shell without its code comes back from the cache offline and then
      fails to boot.
- [ ] Only one cache is present. Earlier builds are deleted on activate, so a device
      that has seen a dozen deploys holds one copy of the app, not a dozen.
- [ ] Take the tab offline and reload. The app still starts, routes, and talks to the
      radio. The app is deployed to Cloudflare rather than run locally, so there is no
      server to stop; see below for how to cut the network and how to prove it was cut.
- [ ] Put the tab back online and reload. It picks up the current build.

## The firmware source is not what arrives

Read this before adding anything that parses a new frame. It cost three fixes that
were declared done, tested, deployed, and still did nothing.

**The companion radio is a layer, not a pipe.** It does not hand a client what the
mesh packet carried. It unpacks, re-packs and reorders on the way through, so a
constant read from the firmware's mesh code is a statement about the mesh, not
about the bytes that reach this app. Two examples, both of which passed review
against the source:

- A room packs a post's type as `(TXT_TYPE_SIGNED_PLAIN << 2) | retry`, so the
  source says 8. The companion strips the retry bits first, so **2** arrives.
  Testing the packed form matched no post ever, and every author stayed mojibake.
- A login reply carries a legacy `is_admin` flag immediately after the push code
  and the real ACL role at index 12. Reading the obvious first byte turned a room
  granting admin into "read only", and the app then refused to post into a room
  that had given it full rights.

**Both failed silently, which is the point.** A post with no recovered author looks
exactly like a post whose frame was never seen. A login reporting read only looks
exactly like a room that really is read only. Nothing errors, so nothing prompts a
second look, and a test written from the same misreading agrees with the code.

**So: capture the frame, then write the test against those bytes.** Attach a raw
`rx` listener, log the frame, and put the real array in the test.
`test/components/signed_posts.test.mjs` has one exactly as the radio sent it, and
`test/components/room_login.test.mjs` has the login reply. A test built from a
captured frame cannot agree with a misreading of the protocol, because it does not
contain one.

**Watch the timing too, not just the layout.** `meshcore.js` allows a login the
device's estimated transmit time plus one second. That estimate is for a
transmission; flood routing adds a random delay at every hop, so the round trip has
little to do with it. A room three hops out answered at 12 seconds against a
deadline of 8.8, and the operator was told nobody answered while they were logged
in. When something times out, listen past the timeout before believing it.

**And check where the data goes after it is parsed.** A field can be correct in the
frame, the schema, the migration, the caller and the view, and still never reach a
row: `Database.Message.insert` copies fields one at a time and drops anything not
named, without complaint. A round trip through the database will not catch that,
because the document stored is the one the insert built. `message_insert.test.mjs`
reads the source and checks the two lists agree.

## Two traps when testing this

Both of these cost a round trip the first time. Neither is a fault in the app.

**Checking whether a tab is offline is what puts it back online.** Chrome's DevTools
offline throttle is owned by whichever debugger attached last, and running any script in
the tab attaches one, so a probe to confirm the tab is cut off silently restores its
network. Set the throttle, reload **without probing first**, and read the evidence
afterwards from the page's own timings:

```js
const nav = performance.getEntriesByType("navigation")[0];
const js  = performance.getEntriesByType("resource").find((r) => /assets\/index-.*\.js$/.test(r.name));
// transferSize 0 on both, and workerStart above zero, is the proof
({ transferred: nav.transferSize + js.transferSize, navWorker: nav.workerStart, jsWorker: js.workerStart });
```

`transferSize` of zero says nothing came over the wire. `workerStart` above zero says the
service worker handled the request, and since the navigation is network first and only
falls back to cache in its `catch`, a zero transfer size there means the network genuinely
failed rather than quietly succeeded. Both readings are needed: either alone is consistent
with an ordinary HTTP cache hit while online.

Cutting the machine's wifi instead is a true test but blinds anything driving the browser
remotely, so the evidence has to be read after the network returns. The loaded page keeps
it, because the timings above survive until that page is navigated away.

**Driving the searchable select needs `mousedown`, not `click`.** Every picker in the app
is a text input pretending to be a select. The options are `div[role="option"]` and the
handler fires on `mousedown`, so that it wins against the input's blur. A plain `.click()`
selects nothing, and the filter text clears on blur, which looks exactly like a successful
pick until the dependent fields fail to render. Dispatch `mousedown`, `mouseup` and
`click`, then confirm the selection took by checking the input's value **and** that the
form fields appeared. Reaching into the component state instead is not available: the
production build strips `__vueParentComponent`.

## When something drifts

**The path length packing changed.** Distances start reading wrong rather than
failing. A path length is two fields in one byte — hop count in the low six bits,
hash size minus one in the top two — and both `src/js/PathInfo.js` and the rx log
unpack it with those exact shifts. Reading it as a plain number is what once
reported a directly reachable station as 128 hops away.

**A firmware constant changed.** Discovery is the thing that breaks. Read the firmware
source, update `Connection.discoverRepeaters`, and update the frame assertions in
`test/components/discovery.test.mjs` so they describe the new truth.

**The library implemented control data.** Delete the hand written frame and use the
library. Keep the tests: they assert behaviour, not implementation.

**Upstream has commits.** Read them before merging. This fork has diverged deliberately
in places, particularly around message rendering, where it preserves newlines that
upstream collapses.
