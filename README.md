# MeshCore Emcomm

A web based [MeshCore](https://github.com/meshcore-dev/MeshCore) client for the
[Companion Radio Firmware](https://github.com/meshcore-dev/MeshCore/blob/main/examples/companion_radio/main.cpp),
with structured emergency communications report forms.

This is a fork of [liamcottle/meshcore-web](https://github.com/liamcottle/meshcore-web), which is no
longer maintained upstream. Everything the original client does still works: contacts, channels,
messaging, settings and the RX log.

## What this fork adds

### Reports tab

A tab alongside Contacts and Channels. Pick the channel to transmit on, choose a report form,
fill it in, and send. Seventeen forms are included:

| Form | Purpose | On the air |
| ---- | ------- | ---------- |
| ICS-209 SITREP / Status Report | Situation report from the field | 159 b, 1 packet |
| ICS-211 ARES/RACES Check-In | Register your station with net control | 115 b, 1 packet |
| ICS-213 General Message | General message traffic between stations | 192 b, 2 packets |
| ICS-213RR Resource Request | Request personnel, equipment or supplies | 133 b, 1 packet |
| 9-Line MEDEVAC Request | Medical evacuation request, standard nine lines | 214 b, 2 packets |
| ARRL Radiogram (NTS) | Formal traffic in National Traffic System format | 218 b, 2 packets |
| Communications Status | A repeater, mesh node or link up or down | 151 b, 1 packet |
| Damage Assessment | Observed damage at a location, with severity | 157 b, 1 packet |
| Health & Welfare | Enquiry or reply about an individual | 184 b, 2 packets |
| Net Activation | Announce a net is open and how to check in | 167 b, 2 packets |
| Net Check-Out | Leave the net and release your station | 114 b, 1 packet |
| Net Traffic Summary | Net control summary of a session | 113 b, 1 packet |
| Position / Station Report | Where a station is and whether it is operational | 141 b, 1 packet |
| Road / Route Status | Whether a route is passable, and any detour | 134 b, 1 packet |
| SALUTE Spot Report | Size, activity, location, unit, time, equipment | 161 b, 2 packets |
| Shelter Status | Population, capacity and needs | 135 b, 1 packet |
| SKYWARN Spotter Report | Severe weather observation for the NWS | 166 b, 2 packets |

The table is in the order the picker shows. All seventeen have been transmitted between two
nodes and received whole, the multi part ones in every part, over USB serial and over Bluetooth.

The whole app was run against both radios again after the reliability audit, since that work
changed the send path itself. A multi part report reached the far node on a channel and, sent
direct, had every part acknowledged. Both positions behaved: the node without a receiver
refused and left the field empty, the node with one filled it. Date time groups came out exact,
approximate and as a range crossing a month. Discovery found two repeaters, one of them
clicked through to the picker and pinged.

Bluetooth is worth calling out because it frames differently. `MAX_FRAME_SIZE` is 176 bytes, so a
report larger than that is chunked by the transport as well as split into parts by this client, and
the two have nothing to do with each other. A 216 byte radiogram was sent over Bluetooth and
received whole, splitting at the same field boundary it splits at over serial.

Every figure is the **total on the air**: the rendered report plus the `<sender name>: ` prefix the
firmware prepends, which is charged against the same 160 bytes. It is the number the confirm step
shows before you transmit, plus that prefix. Each one was produced by filling the form with
realistic content for that report, so they show what a form of that shape actually costs rather
than a best or worst case.

The figures therefore depend on the sending node's name, which is the single biggest influence on
them. They were measured from a node called `Joe-KJ5HBN-HTv3`, a 15 character name that spends 17
bytes before a word of the report is written. Several of the forms that split here would fit in one
packet from a node with a short name; the radiogram and the 9-line carry enough content that they
will usually split whatever the node is called. Direct messages carry no prefix at all and always
have the full 160 bytes.

The four ICS forms carry their real form numbers and sort first. The rest have no ICS
number, and none has been invented for them: a made up number on a form an incident
management system does not recognise is worse than no number. SKYWARN and SALUTE are
named after the formats they follow.

Form names lead with the form number, and the picker sorts by it. Type into the picker to
filter: `213` narrows to both ICS-213 forms, `check` finds the check-in. Matching is a
plain case insensitive substring against the whole name. Arrow keys move, Enter selects,
Escape closes without changing the selection.

These are compact radio versions rather than the full official forms. They carry the same
traffic in the fields that matter over the air, but do not reproduce the printed layout.

Reports are sent as plain text so any stock MeshCore client can read them. A report renders as a
short tagged block, and fields left blank are dropped rather than sent as empty tags:

```
ICS-213
TO: J. Smith, Ops Chief
FM: R. Jones, Net Control
SUBJ: Shelter status
DTG: 191830L SEP
MSG: Shelter 3 at capacity 40 of 40.
BY: K7ABC
```

### Ping tab

A fourth tab, for the question the contact list cannot answer: which repeaters can this
station actually work, right now, without anything relaying for it.

Everything here is **zero hop** on purpose. A repeater reachable only through another
repeater is useful traffic-wise but tells you nothing about your own coverage, and a
contact marked "No Path (Flood)" describes how it was *learned*, not whether it can be
*reached*. On one node here, 106 repeaters were known and two were reachable directly.

**Ping** sends trace requests to one repeater and reports both signal readings:

    1. snr_there=11.75dB snr_back=12.25dB time=435ms
    2. timeout
    3 sent, 33.33% lost
    avg snr_there=11.75dB, snr_back=11.92dB, time=571ms

The two numbers are the point. `snr_there` is measured at the far end and `snr_back` here,
and they are frequently different: one repeater on this bench consistently hears us 8 to
10 dB worse than we hear it. A link that works in one direction only is exactly the
failure worth finding before an incident rather than during one.

A timeout is recorded as a result rather than an error, because packet loss is what is
being measured. Cancelling keeps the replies already collected and reports on those.
Averages are hidden when nothing came back, since `avg snr 0dB` would read as a
measurement of a dead link rather than the absence of one.

A dropped link is not packet loss and is not recorded as any. Pulling the cable mid run
stops the run and says so, keeping the replies already collected, rather than filling the
remainder with timeouts and reporting a loss figure for requests that were never sent.

Getting that right needed more than checking the link before each request. A trace already
in flight when the radio goes away used to surface as the trace's own timeout, seconds
later, and a timeout is recorded as loss — so whether a cable pull came out as a disconnect
or as a lost packet depended on which arrived first. The request now races the trace
against the connection's own `disconnected` event, which decides it by what happened rather
than by when.

With no radio the panel says so, on both cards, instead of leaving the buttons greyed out
with no explanation. Discovery used to not check the link at all, so it stayed pressable
and failed into a message offering the firmware version as an equally likely cause; it now
only offers that when the cause is genuinely unknown.

All of that has happened on the air rather than only in tests, including the awkward middle
case of a run that partly succeeds: three sent, one lost, 33.33%, with the averages taken
over the two real replies.

**Discover repeaters** asks every repeater in direct range to identify itself, which finds
ones that have not adverted since you came into range and so are not in the contact list at
all. Each answer carries both signal readings and the responder's public key. A repeater
already known can be clicked to select it for pinging; one that is new can be saved as a
contact, under a name built from its key, because the discovery reply does not carry one.
The device replaces that name when the repeater next adverts.

Discovery and ping do not always agree, and both are right when they disagree. Discovery
proves a repeater is in range and hears you, because it answered. Ping additionally
requires it to answer trace requests, and not every repeater does: one here replies to
discovery at 11 dB and times out on every ping, including with three times the timeout.

The protocol for this is worth recording, because `meshcore.js` 1.15.0 implements neither
half and both are assembled by hand in `Connection.js`. Discovery is **not** an advert;
adverting draws no replies, tested zero hop and flood. It is a control packet:

| Direction | Frame |
| --------- | ----- |
| Request | `[55, 0x80, 1<<ADV_TYPE_REPEATER, tag x4, since x4]` |
| Reply | `[0x8E, our_snr, rssi, path_len, 0x9X, their_snr, tag x4, pubkey]` |

Command 55 is `CMD_SEND_CONTROL_DATA` and `0x8E` is `PUSH_CODE_CONTROL_DATA`; the library's
command list skips 55 and its push codes stop at `0x8C`, so the frame is written directly
and the reply is read off its `rx` event. Both are firmware v8 and above. The tag is not
decoration: replies are broadcast rather than addressed, so without matching it a run
collects answers to somebody else's discovery.

### Channel or contact

A report can go to a channel, which everyone holding that channel secret receives, or
direct to a single station. Only chat contacts are offered, since repeaters and rooms
cannot receive a message, and no contact is selected by default so a report cannot be
sent to the wrong station by a stray click.

Every picker, form, channel and contact, filters as you type on a case insensitive
substring. It matters most for contacts, where a busy mesh gives you hundreds and typing
`kj5` to reach your own stations beats scrolling, but it is useful on channels too:
`#` lists only the hashtag channels, `dac` goes straight to `#dac-ares`.

Direct messages are acknowledged, so the app shows **Delivered** once the recipient
confirms receipt. Channel messages are broadcast and have no acknowledgement, so there is
no way to know who heard them. For traffic that must be confirmed, send it direct.

### Confirm before transmitting

Pressing Send does not key the radio. It shows a confirmation with the destination, the
number of transmissions and the estimated time on the air, and only the second press
transmits. Cancel returns to the form with everything still filled in, so a report can be
shortened and sent again. Editing anything after confirming drops the confirmation, so
what was approved on screen is always what goes out.

The estimate uses the radio settings the device reports, the firmware's datagram layout
and the standard LoRa time on air calculation, including the 32 symbol preamble MeshCore
uses at SF8 and below. It is a floor: repeater retransmission and contention with other
stations are not included. Reports longer than 30 seconds of airtime carry an extra
warning, since holding a shared emergency channel that long is an operational decision.

### Date time groups

A DTG field can be exact, approximate, or a range. The qualifier is carried in the value
itself rather than in a separate tag, so an exact time costs exactly what it always did
and only the reports that need a qualifier pay for one.

| Mode | On the air | Bytes |
| ---- | ---------- | ----- |
| Exact | 191745L SEP | 11 |
| Approximate | ABT 191745L SEP | 15 |
| Between, same day | 191700-1745L SEP | 16 |
| Between, over midnight | 191700-201745L SEP | 18 |

A range states the day, zone and month once where both ends allow it, which saves seven
bytes over repeating the whole group. That only happens when both ends match the expected
shape exactly; anything else is joined verbatim, so free text such as `first light-dusk`
still transmits rather than being refused or rearranged.

The zone letter follows the operator setting above. The composing and reading back live in
`src/js/reports/Dtg.js` and are covered by `test/dtg.test.mjs`.

### Position from the radio

The location fields carry a **Position** button that fills them from the radio, so a grid
reference does not have to be typed at the moment typing is least affordable.

MeshCore exposes one position for the local device, the advert lat and lon in `selfInfo`.
On a node with GPS the firmware serves it from the live fix; on a node without, it is
whatever was set in Settings. That it really is live was measured rather than assumed:
polling a stationary Heltec V4 gave five different values over 24 seconds, drifting about
half a metre, which is receiver wander. A stored value would have repeated exactly.

The button re-queries the device each press rather than reusing the `selfInfo` fetched at
connect time, so a station that has moved reports where it is rather than where it started.

Positions are written as decimal degrees to four places, `31.9270, -106.4001`, about eleven
metres in eighteen bytes. A six character grid square would save twelve bytes but covers
roughly eight kilometres by five at these latitudes: fine for a net check in, useless for a
pickup point or a damage location. Degrees also read correctly to someone at an emergency
operations centre who has never heard of Maidenhead. Four places is coarse enough that the
GPS jitter above does not change the value, so pressing the button twice gives the same
answer while the position stays current.

A device with no position set reports exactly `0, 0`. That formats perfectly well and points
at the Gulf of Guinea, so it is refused and the operator told, rather than written into a
report. A position genuinely on the equator or the prime meridian still works.

### Packet size handling

The companion firmware caps a channel message at `MAX_TEXT_LEN` (160 bytes), and that budget
includes the `<sender name>: ` prefix the firmware prepends in `BaseChatMesh::sendGroupMessage()`.
Anything over the cap is **silently truncated by the firmware**, so this fork enforces the limit
before transmitting.

Reports that do not fit are split into numbered parts (`[1/3]`, `[2/3]`, ...) sent 2 seconds apart.

A report is one field per line, so parts break **between fields**: whole lines are packed into each
part, and a part begins with a field or the form header. An operator copying part 2 onto a paper
form sees whole fields rather than the tail of one.

A single field too long to fit a part on its own has to break mid line, which in practice means a
long free text field. That case breaks on word boundaries where possible and splits into as many
parts as it takes, however large the field is. Splitting is byte aware rather than character aware,
so a multi byte character is never cut in half. Nothing is dropped: the only hard limit is 99 parts,
and a report past that is refused outright rather than silently shortened.

The Reports tab shows the exact bytes and the exact packets before you transmit, so what you see on
screen is what goes over the air.

### Newlines between fields, and what other clients do with them

Fields are separated by a newline, which costs one byte. This client preserves them, so a report
arrives laid out one field per line.

Not every client does. The upstream client renders message text without `white-space: pre-wrap`,
so newlines collapse into spaces and the report arrives as one run-on line. The `TAG: value` shape
survives that well enough to read, because each tag delimits itself:

    SITREP DTG: 192004L SEP LOC: Shelter 3, Main St COND: Power out, road passable...

It survives least well on the 9-line and SALUTE, whose tags are single digits and letters and so
blend into the content: `3: 1 URGENT 4: NONE 5: 1 LITTER` takes a moment to parse.

Separating with ` | ` instead would render identically everywhere. It was measured and rejected:
it costs 8 to 18 bytes per report, and pushes SITREP, Damage Assessment and Communications Status
from one packet to two, in the SITREP case spending a whole second transmission on `NEXT: 2100L`.
Paying a packet on the common forms to improve two uncommon ones is the wrong trade on shared air.
Both were sent on the air and compared on a stock client before deciding.

### Contacts tab

Lists the contacts you can send text to: people and room servers. Repeaters belong to the
Ping tab, which discovers them and shows both signal readings, and the empty state says so
rather than implying none were heard.

**Favourites live on the radio.** Bit 0 of a contact's flags is the firmware's own favourite
mark, so these are the same favourites the official app shows: they survive clearing site
data and travel with the node. The upper bits of that byte are contact permissions, which
the firmware consults before answering a telemetry or location request, and the device
command replaces the whole contact record. So the fault worth guarding is not a star that
fails to stick, it is silently changing who may query your node. Setting a favourite reads
the record, changes bit 0, and sends every other field back untouched. Favourites rise to
the top of the contacts tab and of every picker, with the lifting done inside
`SearchableSelect` so no picker can be forgotten.

**Contacts can be added from a `meshcore://` link.** This is the only way to add a room
server: the room firmware does not implement the discovery control packet at all, so a room
is invisible until it adverts within earshot, however close it is. The link is parsed before
anything is transmitted, so an empty box, text that is not hex, an odd number of digits and
something too short to hold a key, timestamp and signature are each named rather than handed
to the radio to refuse with a bare error code.

**The contact list is re-read until it is complete.** The device announces how many contacts
it will send and `meshcore.js` discards that number, resolving with whatever arrived. On a
node holding 265 contacts over Bluetooth the first pass delivered 240, 248, 250, 254 and 256
across five runs — up to 9% silently missing on every connect, and a short list looks exactly
like a short list. Reading the contact store is a query to the attached device rather than a
transmission, so it costs no airtime, and merging passes by public key converged every time
in two or three. A link that loses nothing still pays for exactly one pass, and a shortfall
that cannot be made up is reported rather than quietly settled for.

**A contact's path length is not a hop count.** The firmware packs the hop count into the low
six bits and the path hash size into the top two, so reading the byte as a number reported a
directly reachable station as 128 hops away. `src/js/PathInfo.js` unpacks it, applies the
firmware's own validity test, and shows anything it cannot read as an unknown path with the
raw value kept, rather than inventing a distance.

### EMCOMM mode

Turns a node that has been living on a busy mesh into one set up for an incident, with a way
back. Three buttons under Emcomm in settings: back up, restore, and convert. The decisions and
their reasoning are in [docs/EMCOMM-MODE.md](docs/EMCOMM-MODE.md).

**Converting** clears every companion, drops repeaters and rooms quiet for more than 90 days,
sets the node name, transmit power, position and clock, optionally checks the radio settings,
then announces the station and looks for repeaters. It is decided in one dialog rather than a
chain of prompts, because six confirmations under time pressure is how the wrong one gets
accepted.

Companions go entirely because a person's node re-adds itself the moment it adverts. Repeaters
and rooms are kept on an age rule because they do not come back so easily: discovery finds
repeaters only at zero hops, and cannot find a room at all.

**A contact whose age cannot be read is kept.** `lastAdvert` is the advertising node's own
clock, not when this node heard it, and on the bench a contact claimed an advert about four
years in the future. On a 265 contact node, 19 of 191 repeaters and rooms had timestamps that
could not be trusted — about 10%. Deleting a working repeater over a wrong clock costs routing
during an incident; keeping a dead one costs a line in a list.

**Radio settings default to the USA/Canada preset** — 910.525 MHz, BW 62.5, SF 7, CR 5 — behind
a dialog showing the current values beside the new ones, with every field editable. That is the
only preset MeshCore publishes; the FAQ says the rest live in the phone client and the web
flasher, and a guessed frequency is both an off mesh problem and a licensing one. The dialog
says plainly that changing them takes the node off the mesh of anyone still on the old settings.

**Backups** live in two slots per node: a protected pre-EMCOMM one written only when converting,
and a latest one written by the button. Otherwise pressing backup while already converted would
replace the way home with the stripped configuration it was meant to undo. They can be written
to and read from a file, which is the copy that survives clearing site data, and a file is
checked against the connected node before it can be restored.

Restoring adds everything back and removes nothing. Trimming is the mode's business, and keeping
them apart means a restore can never lose anything by itself.

An **EMCOMM Settings** group at the bottom of the settings page shows each setting the mode
changes, with what it is now, so any of them can be set or put back by hand. Radio settings
appear there but are not editable: they are the one change that can leave a node unable to hear
anybody, and they should not sit beside the emergency controls.

#### What it cost to get right

Proven on both radios and both transports: 265 contacts to 155 and back, 211 to 134 and back,
every setting identical afterwards.

| Fault | What the operator saw |
| ----- | --------------------- |
| `getContacts` waits for an `EndOfContacts` frame with no timeout | A conversion that finished every removal and then hung for ever, on a radio answering everything else |
| `loadChannels` falls back to default channels carrying no secrets | A backup that would have restored garbage over working channels |
| `getChannels` stops at the first index it cannot read | One channel with an unusual key would silently truncate the list and take every later one with it |

The first of those is older than EMCOMM mode. `loadContacts` could always have hung at connect;
re-reading for completeness simply gave it more chances.

**Timing, measured.** Over serial: backup 5s, restore of 229 writes 18s. Over Bluetooth: backup
6s, restore of 286 writes 64s, and 110 removals 67s. Removals run about a third the speed of
writes, so trimming is the slow half, not restoring.

### Room servers

Rooms appear in the contacts tab beside people, with their own icon, and open the same
conversation view: a room's posts arrive addressed from the room's own public key. Upstream
called them an unsupported contact type.

A room holds its posts until you log in. **No password is stored anywhere** — not in this
app, not in browser storage, and not on the node, which has no field for one. The companion
command carries it in the frame every time, so it is typed per login and dropped as soon as
the call returns. The firmware ships with `hello` as the room password, which the login bar
names in its text rather than filling into the box: prefilling it meant typing a different
password without clearing first silently sent the two joined together. An empty box sends no
password at all, which the firmware handles deliberately by checking its ACL, and is how a
room with no password is joined.

The room grants a role, and this app reads it. Posting is refused outright when a room
granted read access only, and when no login has been made at all, because a room drops a
post it will not accept rather than refusing it: the send would time out and read as a range
problem. Posts show who wrote them, resolved against the contact list.

#### What this cost to get right

Eight faults, seven of which failed silently, and most only visible against a real room:

| Fault | What the operator saw |
| ----- | --------------------- |
| `meshcore.js` gives a login the device's transmit estimate plus one second, about 8.8s three hops out | "No answer" while already logged in; the success push arrived at 12s |
| An empty box substituted the default password | A room with no password could not be joined at all |
| Posting was allowed before logging in | The post looked sent and never arrived |
| The role was read from the legacy `is_admin` byte rather than the ACL byte at index 12 | A room granting admin reported as read only, and posting was blocked |
| The password box was prefilled | Typing over it sent the default joined to what was typed |
| `txt_type` was tested in the form the room packs for the mesh | Every author stayed mojibake; the companion unpacks it first, so it arrives as 2, not 8 |
| A room post's author prefix is UTF-8 decoded with the text by `meshcore.js` | Four bytes of mojibake in front of every post, unrecoverable afterwards |
| `Database.Message.insert` copies fields one by one and never copied the author | Text came through clean and the author vanished on the way to storage |

Three of those were declared fixed on the strength of reading the firmware source and were
still wrong. What worked was capturing the actual frames and writing the tests against those
bytes: `test/components/signed_posts.test.mjs` contains a frame exactly as the radio sent it.

The last one cannot be caught by a round trip through the database, because the document
stored is the one the insert built and it is consistent with itself. So
`test/components/message_insert.test.mjs` reads the source and checks that every field a
schema declares is copied by its insert.

### Real channel selection

Upstream hardcoded a single "Public Channel". This fork upgrades `@liamcottle/meshcore.js` from
1.2.0 to 1.15.0 and enumerates the channels actually configured on the device via `getChannels()`,
falling back to the public channel if the firmware does not support the command.

### Works offline

An emergency client that only runs while the network is up is not much use in an
emergency. Everything needed at runtime is already local: the radio is on USB or
Bluetooth, and messages are stored in IndexedDB. The service worker caches the app's
own files so it starts with no network at all.

One online load is needed first to populate the cache. After that, pull the plug on the
network and the app still opens, routes and talks to the radio.

Installing it (Chrome's "Install app") is worth doing for field use: it opens in its
own window with no browser chrome, and the cache is what makes that work when
disconnected.

The page itself is fetched network first, so a new deployment is picked up when online and
served from cache when not. Each build gets its own cache, named after the main bundle's
content hash, and activating a new one deletes the previous. Before that the cache name was
fixed and nothing ever evicted a superseded build: twelve deploys in one day left twelve
complete copies of the app on the device, 197 entries and 6.75 MB. It also meant the worker
itself never updated, because its bytes never changed.

The whole build is precached when the worker installs, rather than cached as each file is
requested. That is not an optimisation. A new build starts with an empty cache, and a new
worker only takes control after the page that fetched the bundle has already loaded, so the
first load after a deploy stored the shell and none of the code it references — `index.html`
came back from the cache offline and then failed to boot. It healed on the next online load,
which is worth nothing to an operator who updates and then loses infrastructure. Precaching
also means routes never opened online still work offline. The list is written into the
worker by `scripts/stamp-service-worker.mjs`, which runs after the build and so can see what
the build actually produced.

This is verified on the radios rather than assumed, and the verification is fussier than it
looks. Chrome's DevTools offline throttle is owned by whichever debugger attached last, so
running any script in the tab to check whether it is offline puts it back online. Set the
throttle, reload without probing first, then read the page's own timings: zero bytes
transferred, and `workerStart` above zero on both the navigation and the bundle, which
together prove the worker's cache fallback ran rather than a quiet hit on the network.

## Running it

This is a web app, not a native application. It runs in Chromium based browsers and
can be installed as a PWA on Windows and Android, which is what makes it feel like an
app. Connecting to a device needs Web Serial or Web Bluetooth, so Chrome or Edge:
Safari and Firefox support neither. On Android, Web Bluetooth has worked for years and
Web Serial arrived in Chrome 148.

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Then open the printed URL. Connecting to a device needs Web Bluetooth or Web Serial, so use Chrome
or Edge. Web Serial and Web Bluetooth both require a secure context, meaning `localhost` or https.

To build for production:

```bash
npm run build
```

## Deploying it for other operators

The app is static once built, so it can be hosted anywhere that serves files over HTTPS.
HTTPS is not optional: Web Serial and Web Bluetooth refuse to run without a secure context,
so a plain http host will load the page and then fail to connect to anything.

It is built for the **root** of a domain. The manifest declares `"scope": "/"` and
`"start_url": "/"`, and the service worker caches absolute paths like `/index.html` and
`/assets/`. A host that serves the app from a subdirectory, which is what GitHub Pages does
for a project repository, breaks all three. Use a host that gives you a root domain, or
change the Vite `base`, the manifest and the service worker paths together.

On Cloudflare, connect the repository and set the build command to `npm run build` and the
output directory to `dist`. The node version comes from `.node-version`, currently 22.

Cloudflare now offers two shapes of project, and they do not configure the same way. A classic
**Pages** project takes the output directory from the dashboard and needs nothing else. A
**Worker** with static assets deploys with wrangler, which does not read that dashboard field,
and fails with

    The `assets` property in your configuration is missing the required `directory` property

*after* a successful build, which reads as a build failure and is not one. `wrangler.toml` in
this repository supplies that directory, so either shape works.

Nothing else needs configuring. There are no environment variables, no server, no API: the
radio is attached to the operator's own machine and the messages live in their browser.

### Updating a deployed copy

There is one step: push to `master`. Cloudflare watches the repository, runs the build and
deploys it. Nothing is uploaded by hand and there is no separate deploy action.

    npm test                      # six suites, no hardware needed
    npm run build                 # optional, to see it build before pushing
    git add -A
    git commit -m "..."
    git push

Watch the build under Workers & Pages, the `app` worker, Deployments. A build takes a
couple of minutes, most of it installing dependencies. Check the outcome rather than
assuming it: a failed *deploy* is reported after a *successful* build, so the log ends in
green vite output and then says Failed.

Then confirm what is actually being served, which is the only check that matters:

    curl -s https://app.meshcore-emcomm.workers.dev/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'

and compare it with `dist/assets/` from a local build of the same commit. Matching hashes
mean the deployed bundle is the one you built.

The service worker cache name looks after itself. `npm run build` stamps it with the main
bundle's content hash, so every build that changes code gets its own cache and the previous
one is deleted when the new worker activates, while a build that changes no code keeps the
same cache and costs returning operators nothing.

That replaces a fixed name, which had two faults worth knowing about because neither showed
up as an error. Nothing evicted superseded builds, so the cache grew for ever: twelve
deploys in one day left twelve complete copies of the app on the device, 197 entries and
6.75 MB. And the worker's own bytes never changed, so browsers never installed a new one,
meaning any future change to the caching rules would never have reached anyone already
running the app.

Pruning by what `index.html` references would have been the wrong fix. The app code splits,
so lazily loaded chunks are named in JavaScript rather than in the document, and deleting
them would leave routes that work online and fail offline.

To roll back, revert the commit and push. Deployments are per commit and Cloudflare keeps
the previous ones, so an older deployment can also be promoted from the dashboard, but
reverting keeps the repository and the live site telling the same story.

### What other operators get

They open the URL once while online. That first load fetches the current build and fills the
cache, and the app works with no network from then on.

Updates need no action from them. A navigation, which means opening the app or launching the
installed copy, tries the network first and falls back to the cache only when the network
cannot be reached. So an operator who can reach the internet always starts the newest build,
and one who cannot still starts. Both halves were tested by killing the server and reloading.

They will each need the channel secret to exchange traffic with you, and that does not belong
in this repository or anywhere else public. Pass it out of band.

## Auditing it

    npm run audit

Runs the tests and the build, then checks the things that can rot quietly: whether the
firmware still numbers the commands this app hard codes, whether `meshcore.js` has
started implementing what is currently written by hand, whether upstream has moved, and
whether what is deployed matches what is built. Network checks are skipped rather than
failed when offline.

`docs/AUDIT.md` has the other half, a hardware checklist for two radios. That half has
found every real fault so far. None of them failed a test or a build at the time: a
request frame missing its command byte, a run still transmitting after its tab closed, a
disconnected radio reported as packet loss, and an app that could not start offline on the
first load after any deploy while looking perfectly healthy online.

They share a shape. None is a crash; each is a confident answer where the honest one is
that the radio went away or the file was never cached. That is the class of fault a test
suite is worst at noticing and an operator is worst placed to second guess.

The room server work added eight more, seven of them silent, and is worth reading as a
worked example: see the table under [Room servers](#room-servers). Three were declared
fixed on the strength of reading the firmware source and were still wrong, because the
companion radio does not hand a client what the mesh packet carried — it unpacks the text
type, and it reports permissions in a different byte than the legacy flag. Tests written
from a reading of the protocol passed while the feature did nothing.

What worked, and is worth repeating: capture the frame the radio actually sent, put those
bytes in the test, and reason from them.

EMCOMM mode added three more, all in reading from the radio rather than writing to it, and all
found on hardware rather than in a suite. The worst waited for a frame that never came, with no
timeout behind it, on a link that was otherwise working perfectly.

## Tests

```bash
npm test
```

Six plain node suites and sixteen component suites, 287 tests in all, no hardware
required:

- `test/report_encoder.test.mjs` covers rendering and packet splitting, including a
  simulation of the firmware's own truncation rule to confirm no part can ever exceed
  160 bytes on the air. Also covers multi byte characters, surrogate pairs, the exact
  byte boundary, and part counts that push the `[n/m]` marker into two digits. Two
  sections cover splitting behaviour specifically: that every part of a split report
  starts on a field boundary, and that a single field too large for one message still
  splits into as many parts as it takes with nothing lost, whether or not it contains
  any whitespace to break on.
- `test/serial_framing.test.mjs` feeds synthetic device frames through the serial
  decoder to cover the USB path: frames split byte by byte, split mid header, several
  frames coalesced into one chunk, and resync after boot noise.
- `test/airtime.test.mjs` checks the airtime estimate on the confirmation step: packet
  sizes against the firmware's datagram layout, time on air against the LoRa
  calculation, and the totals an operator sees before transmitting.
- `test/dtg.test.mjs` covers composing and reading back date time groups, including
  ranges that cross midnight, span months, mix zones, or are only half typed.
- `test/forms.test.mjs` checks the form catalogue as data: unique ids, names and on air
  headers, no duplicated tags within a form, no select without options, no unknown field
  type or prefill flag, and that every form renders both empty and fully populated.
- `test/position.test.mjs` covers decoding the radio's position, and refusing the unset
  one: zero, zero formats perfectly well and points at the Gulf of Guinea.

The component suites under `test/components/` run on Vitest and need a DOM, which is why
they are separate. They exist because the logic suites cannot see the faults that actually
occurred: a request frame built without its command byte, a guard never consulted, a loop
still transmitting after its panel was unmounted, an error recorded as a measurement. Each
was checked to fail before its fix and pass after, because a regression test that cannot
fail is only decoration.

- `test/components/discovery.test.mjs` drives repeater discovery against a fake radio and
  asserts the bytes on the wire, not merely that the function returns. It feeds synthetic
  replies back too, including one carrying another operator's tag, which must be ignored
  because discovery responses are broadcast rather than addressed. It also covers a ping
  whose radio vanishes mid trace, which must give up at once rather than wait out the
  trace's own timeout and be counted as a lost packet; without the fix that test hangs for
  the full timeout, which is exactly the symptom on the bench.
- `test/components/ping_panel.test.mjs` mounts the ping panel and covers the cases that
  produce a confident wrong answer: a dropped link must stop the run rather than count as
  packet loss, statistics must describe what was sent rather than what was intended,
  averages must stay hidden when nothing came back, and leaving the tab must stop
  transmitting. With no radio it must say so rather than only grey its buttons, refuse to
  transmit if started anyway, and blame the disconnect for a failed discovery only when
  the disconnect is actually the cause.
- `test/components/reports_panel.test.mjs` covers the send orchestration, which is where a
  mistake quietly loses somebody's traffic. Parts must go out in order; a direct message
  must wait for each acknowledgement before sending the next, because the device tracks
  only one outstanding message and the next part is simply lost otherwise; an
  unacknowledged part must be retried and then stop rather than be transmitted over; and a
  resume must continue from the part that failed, to the destination the earlier parts
  went to, rather than repeating what already arrived.
- `test/components/searchable_select.test.mjs` covers the combobox behind every picker.
  It is a text input pretending to be a select, so filtering, keyboard movement, what
  Enter and Escape do, and everything assistive technology is told are all hand written
  and can all break silently.
- `test/components/report_form_fields.test.mjs` covers the two parts of the field
  renderer that are more than markup: the date time group, which builds one string from a
  mode and two inputs and must keep the chosen mode while a range is half typed, and the
  position button, which must refuse to write a plausible looking wrong answer into a
  report.

### Known issue: serial resync

The frame parser in `meshcore.js` treats any `0x3e` (`>`) as a frame start and accepts
whatever two bytes follow as a length, without sanity checking it. Serial noise
containing a stray `>` can therefore desync the parser indefinitely, swallowing every
real frame behind it. The last case in `serial_framing.test.mjs` demonstrates this.

This is upstream library behaviour rather than something this fork can fix cleanly. The
connection watchdog limits the damage: instead of hanging forever you get a "device did
not respond" message after 15 seconds and can reconnect.

## Adding your own forms

Forms are data, not code. Add an entry to [`src/js/reports/ReportForms.js`](src/js/reports/ReportForms.js)
and it appears in the dropdown automatically. Each field needs an `id`, a short `tag` used on the
air, a `label`, and a `type` of `text`, `textarea`, `select` or `dtg`.

Keep tags short. Every byte is airtime.

## Credits

Original MeshCore web client by [Liam Cottle](https://github.com/liamcottle). MeshCore itself is by
[the MeshCore project](https://github.com/meshcore-dev/MeshCore).

## License

MIT, same as upstream. See [LICENSE](LICENSE).
