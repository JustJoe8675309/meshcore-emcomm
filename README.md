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

A report cut short by leaving the Reports tab stops, as it should, but is not forgotten. The
panel's own record of how far it got used to go with the panel, so coming back showed an empty
form while the stations held a report with its end missing. It is now kept, and the tab says
the report was interrupted, how many parts went out and to where, and offers to send only the
rest. It will not finish it through a different radio: a channel is a slot number on the radio,
so the rest could land on another channel entirely.

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

**How long it listens** depends on the radio settings. It used to be a fixed 30 seconds. A
repeater answers after a random wait of up to ten times the airtime of its short reply, so
that many answering at once do not all collide (`getRetransmitDelay`, widened four times, in
the repeater firmware). Add the request going out and the last reply coming back, and the
slowest answer a repeater on default settings can give is twelve airtimes. At SF7 and 62.5 kHz
that is about 2 seconds. The app listens for that, rounded up to a whole second, and never
under 10 seconds, which leaves room for a repeater whose owner has raised its delay. So it is
10 seconds at the bench settings, and about 19 at SF12 and 125 kHz.

Tested side by side on the bench, with one node on each build. Node 2 listened for 10 s and
found JOE- QTHish at 11 dB. Node 1, still on the 30 s build, found the same repeater and
nothing else. N.E. ELP OBSVR, found on other days, answered neither search.

The replies were then timed as they arrived, by tapping node 1's serial line. JOE- QTHish
answered 0.81 s after Discover was pressed. It answered again about a second into the search
that converting to EMCOMM mode runs. Both are inside the 1.8 s the arithmetic allows a default
repeater at these settings.

From node 2 over Bluetooth, the same 10 s search found two repeaters:
- WTRA-NMF at 1.54 s. It heard node 2 at -5.25 dB and node 2 heard it at 4.75 dB, and node 1
  has never found it.
- JOE- QTHish at 2.62 s. That is past the 1.8 s the arithmetic allows. Part of it is likely
  Bluetooth delivery, since node 1 over serial heard the same repeater at 0.81 s. The rest may
  be that repeater's own delay setting, or the request waiting for a clear channel before it went
  out.

Node 2's transmit power was then raised from 20 to 22 dBm, the maximum its firmware reports. It
was also moved from indoors to the porch outside, and searched four more times over four
minutes:

| Repeater | Answered | Heard node 2 at | Node 2 heard it at |
|---|---|---|---|
| JOE- QTHish | 4 of 4 | 11 to 12 dB | 12 dB |
| FEDF MC Repeater | 3 of 4 | +3.25 to -2 dB | about 10 dB |
| Dorje Solar Tobin Wells | 1 of 4 | 8.75 dB | 2 dB |
| WTRA-NMF | 0 of 4 | | |

Every reply came within 2.73 s. FEDF MC Repeater and Dorje Solar Tobin Wells answered no search
from indoors at 20 dBm. The power and the position changed together, so which one brought them
in cannot be told apart from these results. Of the two, the move outside is likely to count for
more: 2 dB is modest, and a house wall can cost far more than that. WTRA-NMF answered once from
indoors and not at all from the porch, which is a reminder that links this weak come and go from
one minute to the next.

To tell them apart, node 2 was set back to 20 dBm and searched four more times from the same
spot on the porch:

| Repeater | Porch, 22 dBm | Porch, 20 dBm |
|---|---|---|
| JOE- QTHish | 4 of 4 | 3 of 4 |
| FEDF MC Repeater | 3 of 4 | 3 of 4 |
| Dorje Solar Tobin Wells | 1 of 4 | 3 of 4 |
| WTRA-NMF | 0 of 4 | 0 of 4 |

So it was the move outside, not the power. At 20 dBm on the porch, both newcomers answered at
least as often as at 22, and FEDF MC Repeater heard node 2 at much the same strength, +1.25 to
-2.75 dB. Over eight searches, 2 dB made no difference that could be seen; the house wall did.
The one miss by JOE- QTHish, the strongest link of all, shows that even a good link loses the
odd reply. The slowest reply at 20 dBm was 2.54 s.

So the arithmetic is a guide, not a bound, and the 10 s floor is what actually matters here: the
slowest answer seen so far left more than 7 s to spare.

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

Reports that do not fit are split into numbered parts (`[1/3]`, `[2/3]`, ...), sent with a gap
between them.

The gap used to be 2 seconds. On the bench a three part report reached node 2 as `[1/3]` and
`[3/3]`: node 1's radio had answered Ok to `[2/3]` and it was in node 1's own history, so it
was lost on the air. Channel messages are never acknowledged, so nothing at the sending end can
tell. The gap is now eight times the airtime of the longest part, rounded up to a whole second
and never under 5 seconds. The radio answers Ok when it has queued a part, and sending it takes
one airtime. A repeater then waits a random 0 to 2.5 airtimes before passing a flood packet on
(`getRetransmitDelay` in the firmware) and one more airtime sending it, so eight airtimes covers
two hops of repeats. At SF7 and 62.5 kHz a full part takes about 0.6 s, so the gap is 6 s; at
SF12 and 125 kHz it is nearer a minute. The transmission preview shows the gap in use.

A longer gap makes a loss less likely but cannot rule it out, so the Reports tab keeps the last
channel report it sent in full, with a Resend button for each part. When a station says it is
missing `[2/3]`, that part goes out again word for word, to the same channel, and nothing else
does. As with finishing an interrupted report, it will only go through the radio the report
went out on. Reports sent to a contact do not get this: each part is acknowledged and
retransmitted until it is, and the send stops if one never is.

Both were proven on the bench. A three part DRILL report from node 1 on Emcomm Testing
reached node 2 whole, with the preview saying about 6 seconds apart. Node 1 started parts 2
and 3 at 6 and 13 seconds, and node 2 received `[2/3]` and `[3/3]` 7.0 seconds apart. Resend 2
then put a second, identical `[2/3]` on node 2, and nothing else: `[1/3]` and `[3/3]` stayed at
one copy each.

Six seconds was a decision, not only a result of the formula. The gap was weighed against
shorter settings. Three seconds clears one hop of repeats at the bench settings. Four covers one
hop fully and two hops most of the time, but by the same arithmetic a two hop repeat is still
on the air about one time in five. Six covers two hops fully. The cost is a few seconds: a three
part report takes about 13 seconds instead of 10, and a ten part report about 55 instead of 40.
For emergency traffic a missing part matters more than that, so the gap stays at eight airtimes
with a 5 second minimum, which is 6 seconds at these settings. A gap can still not rule out:
- another station keying up;
- a repeater whose owner has raised `tx_delay_factor` above the default 0.5 that the arithmetic
  assumes;
- a weak signal.

That is what Resend is for.

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

**After that, one contact at a time.** Every advert the radio heard used to re-read the whole
list: on the bench, 211 contacts and 2.8 seconds over serial, or 161 contacts read twice over
Bluetooth, for one station's update. Once device commands took turns, everything else waited
behind that read, and the settings page sat empty for twelve seconds after an advert arrived.
The notification names the contact, and the firmware has a command `meshcore.js` does not
implement, `CMD_GET_CONTACT_BY_KEY`, that returns just that one. Captured on the radio: the
contact in 21 ms, and `ERR` not found in 9 ms for a key it does not hold.

What the firmware sends was read from its source and confirmed on the radio, and it is not what
the library's naming suggests. A station the radio has just added arrives as a plain advert,
key only, not as a new-advert notice: that one carries a full record, but only for stations the
radio chose not to keep. An eviction to make room arrives as its own notice, which the library
does not parse and which the full re-read used to cover without anyone noticing; it is now
handled, or evicted contacts would stay in the list for good. If the radio will not answer the
one-contact request, on older firmware or with a dropped reply, the app falls back to the full
read.

**A contact's path length is not a hop count.** The firmware packs the hop count into the low
six bits and the path hash size into the top two, so reading the byte as a number reported a
directly reachable station as 128 hops away. `src/js/PathInfo.js` unpacks it, applies the
firmware's own validity test, and shows anything it cannot read as an unknown path with the
raw value kept, rather than inventing a distance.

### Repeating adverts

An advert is how a node tells the mesh it exists. Both kinds are on the header menu as single
presses, which is fine while somebody is watching the app. During a net nobody is, and a station
that adverted once at sign-on drifts out of everybody's contact list as paths change around it.

Two fields in the EMCOMM settings group take an interval in minutes, one per kind. Blank or zero
means off. The schedule is stored per node, because it is a property of the station's role: a base
running flood adverts hourly and a handheld running zero hop adverts every ten minutes are both
reasonable and are not the same setting.

**Closing the app stops the adverts; reconnecting starts them again.** Nothing but the app sends
them, so while it is closed the node sends no scheduled adverts at all. Reopen the app and connect
the same node, and its schedule starts again by itself, with no need to press Apply. Three things
to know about that:
- **It is kept in the browser.** The schedule lives in that browser's own storage on that computer
  or phone. Connecting the node from another browser or device, or after clearing the site's data,
  starts with no schedule.
- **The count starts again.** It does not carry on from before the app closed. The first advert
  after reconnecting is one full interval later: on an hourly flood schedule, an hour after
  connecting, however long the app was closed.
- **It follows the node.** Connecting node 2 in a browser where node 1 had a schedule does not give
  node 2 that schedule.

Nothing is sent the moment the schedule is applied or restarts. An advert on every page load would
put a burst on the air each time the app is reopened, which during testing is constantly. To be
heard at once after reconnecting, send one from the header menu.

**The two kinds cost very different amounts of air.** A zero hop advert is heard only by stations
in direct range and is repeated by nobody. A flood routed advert is rebroadcast by every repeater
that hears it, so its cost is multiplied by the size of the mesh — running one every few minutes is
how a single station drowns a net. Anything under an hour is called out in the form rather than
blocked: the operator is licensed and it is their call, but they should make it knowingly.

A missed advert is logged and not raised. The next one is along shortly and the radio may simply
have been busy, so one refusal never silently ends the schedule.

**Proven on air, including in a background tab.** The schedule runs on a browser timer, and
browsers slow the timers of pages nobody is looking at: Chrome throttles a tab hidden for more than
five minutes to about one wake-up a minute. So it was tested hidden, with a second node listening
and every frame timestamped at both ends. Node 2 over Bluetooth, on a one minute zero hop schedule
with its tab hidden for sixteen minutes, sent sixteen adverts and node 1 heard all sixteen, each
59 to 61 seconds after the last and about a second after it was sent. The eleven minutes past the
throttling threshold looked no different from the first five, and the page was never frozen. The
shortest interval the form accepts is one minute, which is already as coarse as the throttling,
so on a desktop the schedule keeps time with the tab in the background.

**A locked phone stops sending.** Tested the same way, with the phone on node 2 over Bluetooth and
node 1 listening. With the screen on, one a minute to the second. Locked, one more went out a minute
later and then nothing: nine missed in a row over the next nine minutes, while node 1 went on
hearing everything else on the mesh. Android suspends the page. It does not drop the link: on
unlocking, the app was still connected, sent one advert at once, and carried on at one a minute
without being touched. The missed ones are not made up, and nothing on the screen admits they were
missed, because the status line reports that a schedule is set, not that adverts are going out.

So on a phone, repeating adverts need the app on screen. There is no fallback in the radio: the
companion firmware has no advert timer of its own, only the commented out remains of one, so
nothing but the app can keep a companion node adverting. Two things follow from that.

**The screen is kept on while a schedule runs.** The page asks the browser for a screen wake lock
whenever either interval is set, lets it go when the schedule stops or the radio disconnects, and
takes it again when the page comes back into view, because browsers drop it whenever the page is
hidden. That stops the phone timing out and locking itself. It cannot stop somebody pressing the
power button, and a browser without the feature, or one that refuses it, is named as such in the
settings group rather than assumed to be working.

Proven on the same phone, again with node 1 listening: the settings group reported the screen as
kept on, the phone was left untouched for six minutes, well past its own timeout, and the screen
stayed on. Node 1 heard six adverts out of six, 58 to 62 seconds apart, where the locked phone had
fallen silent within a minute.

**The status line says what actually went out.** Each kind shows when it last went out, or when
the first is due, and turns amber once one is more than thirty seconds late, saying that a locked
screen or a backgrounded app is the usual reason. Sends are recorded only once the radio has taken
them, and the times belong to the radio they went through, so connecting another radio starts
them afresh.

### EMCOMM mode

Turns a node that has been living on a busy mesh into one set up for an incident, with a way
back. Three buttons under Emcomm in settings: back up, restore, and convert. The decisions and
their reasoning are in [docs/EMCOMM-MODE.md](docs/EMCOMM-MODE.md).

**Converting** clears every companion, drops repeaters and rooms quiet for more than 90 days,
sets the node name, transmit power, position and clock, optionally checks the radio settings,
then announces the station and looks for repeaters. By default it also:
- raises the transmit power to the radio's maximum;
- **shares location with any station that asks**, so the radio answers a position request
  itself, even with this app closed, if it has a working GPS. This also shares battery voltage;
- **adds contacts automatically**, so every station heard can be messaged and can ask for a
  position. The radio only answers telemetry from stations in its contacts. The list refills
  after the trim.

Each is a tick box in the dialog. Location sharing is the radio's telemetry permission, which
lives in one command with the add contacts mode, the advert location policy and multi acks.
`meshcore.js` sends only the first of those, so the app writes the whole command itself and
sends the others back exactly as the radio reported them. Backups now keep all of them, so
leaving EMCOMM mode puts location sharing back as it was. A backup taken before this change
restores the add contacts mode alone, as it always did. It is decided in one dialog rather than a
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

A restore that changes the node's name sends one zero hop advert and says so. Writing the name
back announces nothing on its own, and on the bench node 2 went on listing node 1 by its EMCOMM
name until an advert went out by hand. Zero hop reaches the stations in direct range, which
are the ones most likely to be talking to it; stations further out learn the name at the next
flood advert. Nothing is sent when the name is unchanged.

**Leave EMCOMM mode** restores the pre-EMCOMM backup specifically, and appears whenever the node
is in the mode and that backup exists. The final audit found the way home unreachable without it:
the two slots stayed apart as designed, but Load last backup restores the newest, so one routine
backup taken during the incident, which is exactly what an operator does, put the pre-EMCOMM
backup beyond every button. The backup list is also refreshed the moment the pre-convert backup
is saved; mid conversion it still named the one before, and Save to file exported that.

An **EMCOMM Settings** group at the bottom of the settings page shows each setting the mode
changes, with what it is now, so any of them can be set or put back by hand, and holds the
repeating advert intervals. Radio settings are not repeated there: the groups above already show
them in editable fields, and a second copy of a value is a second thing to disagree.

#### What it cost to get right

Proven on both radios and both transports: 265 contacts to 155 and back, 211 to 134 and back,
every setting identical afterwards.

| Fault | What the operator saw |
| ----- | --------------------- |
| `getContacts` waits for an `EndOfContacts` frame with no timeout | A conversion that finished every removal and then hung for ever, on a radio answering everything else |
| `loadChannels` falls back to default channels carrying no secrets | A backup that would have restored garbage over working channels |
| `getChannels` stops at the first index it cannot read | One channel with an unusual key would silently truncate the list and take every later one with it |
| Commands share one emitter and match replies by response code, not by request | The settings page stopped prefilling: the group's clock read and the page's self info read crossed, and every field came up empty |
| Bluetooth writes that collide are caught and only logged | "GATT operation already in progress" in the console, and a command that never reached the radio waiting for a reply that could not come |
| The serial read loop returns on any read error, emitting nothing | A radio rebooted behind a CP210x bridge, whose port stays open, raised a FramingError: the app showed it connected while hearing nothing, until disconnected and connected again |

The crossed replies are the same shape as the rest and the worst of them, because it was silent
and it lied: an empty Name box looks like a node with no name, and saving it would have written
one. The emitter hands each reply to every listener waiting on that code, so one `Ok` confirms
every command waiting for an `Ok`, whether or not the radio has read it yet.

The fix is in two layers, because the failures are in two places. Frames go onto the wire one at
a time, per connection, which ends the Bluetooth collisions for every command including the ones
the library sends itself; the library marks that spot with a todo for exactly this. Above that,
every command that gets a reply holds a queue until it has its reply, and never for ever: a queue
turns one lost reply into a frozen app unless every place in it is bounded. Commands the app does
not wait on, such as a path reset or the contact menu's delete, now collect their reply while
still at the head of the queue, because an `Ok` nobody collects lands on the next command. Long
waits on the mesh, a room login or a repeater discovery, hold the queue only until the radio says
the packet went out; the answer comes back as a push that only they can match.

A read that fails says so instead of leaving the form blank.

Web Serial treats break, buffer overrun, framing and parity errors as recoverable: the port hands
out a new stream. The read loop now carries on with it, and a pulled cable is still reported by
the port's own disconnect event. That also meant a reboot no longer forced the reconnect that used
to set the radio's clock; node 1 came back 656 seconds out. So a recovered line error now waits
for the radio to answer, sets its clock and reads it afresh. The first version of that check
never fired: `GlobalState` is reactive, so the connection read back from it is a proxy and was
never identical to the one it wraps. The test caught it before the radio did.

Not every reboot garbles the line, and a clean one left node 1 204 seconds out with nothing about
to notice. So the app's own Reboot command runs the same routine, and the minute timer that
reads the battery now reads the radio's clock as well, setting it once it has drifted more
than thirty seconds. That covers a reset button, a brownout or a watchdog restart, which say
nothing at all.

Simple local reads, the clock, self info, firmware details and battery, are bounded at five
seconds instead of the general twenty. They answer in a fraction of a second on either link, and
a radio that had stopped answering took the settings page 37 seconds to report, two such reads
each waiting out the general bound in turn.

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

### Position requests

Any station running this app can be asked for its position, from **Request Position** in the
menu beside it in Contacts. Everything that comes back is on the **Positions** tab.

**How it travels.**
- **On a channel,** the request and its answer are **channel datagrams**: binary packets that
  every client on the channel receives but only this app shows. Stock clients show nothing at
  all. Every station on the channel running this app sees the answer, so a position asked for
  on the net is shared with the net.
- **Direct,** there is no datagram, so it goes as a direct message of text type 1, which the
  firmware calls command data. Only the two stations see the answer. A station without this app
  sees a readable line, such as "Position request from KJ5HBN (answering needs
  MeshCore-Emcomm)", followed by the encoded request. This app reads it and keeps it out of the
  conversation.

**Asking.** Three modes: once; every N minutes until answered; or up to X times every Y minutes,
stopping early on an answer. Each request floods the whole mesh like a flood advert, so the
shortest interval is a minute, and the form warns under five. Repeats run on a browser timer,
so like repeating adverts they need the app on screen, and the screen is kept on while they
run. The tab shows each request, how many have gone, when the next is due, and a Stop button.

**Being asked.** A request on a channel is only answered on channels ticked under **Position
requests** in settings. A direct one is always put to the operator, since it is addressed to
them. The prompt offers three answers:
- **Send** sends the position and nothing else.
- **Send with message** sends it straight away, marked "message to follow", then opens the
  channel or conversation the request came from, so the message can be typed.
- **Decline** sends "Declined by" and the operator's callsign, or the node name if none is set.
  It stops the asker's repeats at once.

Repeated requests from one station raise one prompt, not a pile of them. Settings can switch
to answering automatically instead, which sends a plain Send with no prompt.

**What is shown.** For each station: its position in **decimal degrees** and as a ten digit
**MGRS** reference, its distance in **miles and kilometres**, and the bearing to it in **degrees
magnetic, stated as magnetic**, with the declination used shown beneath.

Close in, the distance changes form:
- **Under a tenth of a mile,** it is given in feet and metres, such as "328 ft (100 m)".
- **Under ten metres,** it reads **Same location**, with no bearing. On the bench, two radios a
  few feet apart read "0.0 mi (0.0 km), 341° magnetic", a bearing that meant nothing, and a GPS
  wanders a few metres standing still. A fix's age is given
when it is a live GPS fix. Distance and bearing need this station's own position; without one,
the tab says so.

**Current fix or last known position.** Every answer says which it is, in the message itself.
- The app decides whether a radio's GPS is live once, when it connects, and holds the position it
  read then. Answering with that and calling it current would be wrong the moment the fix was
  lost or the station moved.
- So when answering, the app reads the radio's position again, up to three times over about
  three seconds. A live receiver wanders in its last digit even standing still, so any change
  means the fix is current, and it goes as a current fix with the time.
- No change means it goes flagged as a **last known position, not a current fix**. So does
  every position from a radio without a confirmed GPS, and every answer where the re-read fails.
- The receiving app shows that in amber. The readable line a station without the app sees starts
  "Last known position of", followed by the name and "(not a current fix)".
- A position from a radio's telemetry is marked as not saying how current it is, because the
  firmware does not.

**Entering the current position.** When the prompt finds the position would go as last known, or
that there is none, it offers **Enter current position**. The prompt checks the GPS as soon as it
opens, not only on Send, so it can offer this first.
- The operator types where they are now, in decimal degrees, starting from what the radio holds,
  and the MGRS reference is shown as they type.
- It is saved to the radio, where it becomes the position the radio holds and adverts, and so the
  last known position for any later answer.
- It goes out marked as **entered by hand**, with the time: current by the operator's word, not
  by a GPS. The receiving app shows "Entered by hand at 12:40 AM, not GPS". A direct answer's
  readable line says "(entered by hand)".
- An entry that is not a position is refused: latitude past 90, longitude past 180, or 0, 0.
- The operator can still go back to sending the last known position.

Proven on the bench:
- Node 2 asked node 1, which has no GPS. Node 1's prompt said the answer would go as a last known
  position and offered the entry, prefilled with the position the radio held.
- A position about two metres away was entered and sent. Node 1's radio then held it (its MGRS
  reference moved from 67642 33199 to 67640 33201).
- Node 2 showed "Entered by hand at 12:45 AM, not GPS" and "Same location as this station",
  with no bearing.

On the bench, node 2 with a live GPS answered in 0.95 s. The first re-read had moved, and node 1
showed it as a current fix. The answer's MGRS reference differed in its last digits from the one
node 2's prompt had shown a moment before, so it was a fresh reading, not the one held since
connect.

The first attempt that night was a single request, and it was lost on the air with no answer. The
same request, repeating every minute, got through first time. Channel datagrams are not
acknowledged, which is what the repeat modes are for.

The other way round, node 1 was given a position by hand, with no GPS, and node 2 asked for it.
Node 1's prompt warned before sending that it would go as a last known position. Node 2 showed
the answer in amber as "Last known position, not a current fix".

**Magnetic bearing.** A bearing an operator walks has to be magnetic, because that is what a
hand compass reads. The declination comes from the **World Magnetic Model 2025**, worked out on
the device from NOAA's published coefficients, so it needs no network. It matches all twelve of
NOAA's official test values. The model is valid to the end of 2029; after that the tab says the
bearings may be a degree or more out until the app has the next model. Local magnetic
anomalies, from iron ore or vehicles, are not in any model.

**When the app does not answer.** Thirty seconds after each request, the station's radio is
asked directly with the firmware's own telemetry request. The radio answers that itself, with
its app closed, but only includes a position if it has a working GPS and its owner shares
location. That answer goes only to whoever asked.

On the bench, node 2's radio stayed silent with sharing off, and answered node 1 in 0.77 s with
it on. The answer carried its GPS position, battery voltage and chip temperature. A radio that
does not share says nothing at all, which is the same as being out of range, so the tab says
it could be either.

**What was proven on air before building.** A channel datagram from node 1 reached node 2 in
0.44 s, text intact, and repeaters re-flooded it up to three hops. A type 1 direct message
arrived in 0.58 s. The app before this change filed that direct message in the chat with a
notification, which is why it is now intercepted.

**Proven on the bench, end to end, on 22 September 2026.** Node 1 was on serial and node 2 on
Bluetooth, on Emcomm Testing:
- **Once, on the channel.** Node 2 was prompted, Send went out, and node 1 marked it answered,
  with node 2's live GPS position in degrees and MGRS.
- **Direct, every minute until answered.** The second request refreshed node 2's prompt to
  "Asked 2 times" rather than adding one. Nothing reached either conversation. Send with message
  opened node 2's conversation with node 1, and node 1 showed "message to follow" and stopped.
- **Up to 3 times every minute, unanswered.** Three requests, then "No answer after 3 requests".
- **Decline** stopped the repeats after one request and showed "Declined by KJ5HBN".
- **The radio's own answer.** With node 2's location sharing turned on from the EMCOMM group and
  its app told "Not now", node 1 had node 2's GPS position from its radio 30 s after asking.
  Sharing was then turned off from the same button, and the radio read back exactly as before.
- **A channel not ticked.** Node 2's radio received the request and nothing was put to the
  operator.
- **Answering automatically.** Node 2 asked node 1, and node 1 answered within 4 s, with no
  prompt, that it has no position set.

Two things were changed from what the bench showed:
- **The list names the radio beside the operator.** Both bench radios share one callsign, so
  answers were indistinguishable by name.
- **A decline no longer hides a station's last known position.** It is now shown beneath the
  decline or "no position" answer.

Not yet seen: what a stock client shows. The third node is on the computer's only Bluetooth
connection, which node 2 was using.

**Limits.**
- **A second request replaces the first prompt.** If two stations ask at once, the newer
  request replaces the older one on screen.
- **Hidden, not secret.** Anyone holding the channel key who writes their own code can read the
  positions.
- **Not signed.** Anyone on the channel could send a false one. That was accepted for the first
  version.
- **The station's app must be open** to answer, or its radio must have GPS and share location.
- **MGRS stops at 84° N and 80° S.** The polar grid is not produced.

### Real channel selection

Upstream hardcoded a single "Public Channel". This fork upgrades `@liamcottle/meshcore.js` from
1.2.0 to 1.15.0 and enumerates the channels actually configured on the device via `getChannels()`,
falling back to the public channel if the firmware does not support the command.

### Loading screen

Connecting to a radio takes seconds, most of it reading the contact list, and until now the tabs
showed a node with nothing on it while that happened. A loading screen now covers the app from
the moment the link opens until the node has been read. It names each step as it happens:
- waiting for the radio to answer;
- setting its clock;
- opening its messages;
- reading contacts, counted against the number the radio said it would send;
- checking for dropped contacts, when a second read of the list is needed;
- reading channels, counted slot by slot against the number of slots the radio has, with how
  many configured channels have been found so far;
- reading waiting messages and the battery.

The channel count is of slots, not channels: every slot is read, empty ones too, so a radio
with forty slots and thirteen channels shows 40 of 40 and 13 found. That is why the channel
step took five seconds on the bench. The radio gives its slot count in its device info reply,
which `meshcore.js` files under a reserved field. A radio that does not give it still has
every slot read, with a count but no bar.

It has a Disconnect button, and it goes away if the attempt fails, leaving the reason on the
connect screen.

Proven on node 2 over Bluetooth, with every change on the screen timestamped:
- 1.3 s: the radio had answered, its clock was set, and the contacts were being read.
- 21.2 s: the count had gone up one contact at a time to 183 of 183.
- 24.3 s: channels. The three seconds before this are a second read of the contact list,
  checking that none were dropped. The count sat at 183 of 183 through it and looked stuck,
  so that step now says it is checking for dropped contacts.

Node 1 over USB serial is much quicker, and it confirmed the channel count. The whole screen
took 5.4 s:
- 2.9 s: all 213 contacts read in one pass, so the checking step never came up.
- 3.8 to 5.4 s: channels counted from 0 of 40 to 40 of 40, with 13 found. Both nodes have forty
  slots and thirteen channels.
- 29.5 s: the screen was gone and the node was ready.

A backup on node 1 showed its own screen for the 4 seconds it took, and went away with 213
contacts and 13 channels saved.

Converting node 1 and leaving EMCOMM mode again were recorded the same way.
- **Convert, 31 s.** The screen stepped through:
  - backing up before any change;
  - each setting as it was applied;
  - "Removing: N5TMT R51" and 76 more, counted up to 77;
  - announcing the station, then the repeater search;
  - turning off automatic contacts, then reading the node back. That was before the convert
    was changed to turn them on.

  It stood aside for the 2 seconds the convert dialog was waiting on an answer.
- **Leave EMCOMM mode, 12.6 s.** Every restore step was counted, out of 231, followed by reading
  the node back and announcing the name. Node 1 came back as Joe-KJ5HBN-HTv3, with all 213
  contacts and 13 channels.

Over Bluetooth, node 2's next connection read all 183 contacts in one pass, in 12.5 s, so the
check for dropped contacts had nothing to do and rightly did not appear. It shows only when the
first read comes up short, and that does not happen on every connection.

Backing up, restoring, leaving EMCOMM mode and converting to it get the same screen, with the
step and a count where there is one. Each is a string of commands to the radio. Before this, the
only sign was a line of small text under the buttons, and the rest of the page was free to
press. A command pressed in the middle queued behind the restore and made it longer. It has no
cancel button, because stopping a restore half way leaves the node half restored, and every
step has its own timeout, so it always ends. The screen steps aside for a decision: the
conversion's confirmation dialog, and its question about an incomplete backup, are left
uncovered.

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

**The install is all or nothing, and a worker only takes over with a complete copy.** It was
best effort: a file that failed to download was skipped, and the worker took control anyway,
deleting the previous build's cache as it did. The final audit caught it by accident, when an
update arrived while the tab was still set offline from the test before. The new worker
installed with an empty cache, deleted a complete one, and the next load offline was "This
site can't be reached". In the field that is an operator who updates over a bad link and
loses the offline copy at the worst moment. Now a failed install changes nothing: the previous
worker and its cache stay in charge, and the browser tries the update again later. Activating
also checks the new cache is complete before deleting anything, because that is the one step
that cannot be undone.

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

### Audit status

The last full audit ran on 20 and 21 September 2026, on the two Heltec bench nodes (one
over USB serial, one over Bluetooth) and an Android phone. **Nothing from it is open.**
`npm run audit` passes 24 of 24 checks against the live build, and every item on the hardware
checklist has passed on the radios.

It found ten faults. Each is fixed, deployed and proven on hardware:

| Fault | Fixed in |
|---|---|
| The EMCOMM mode badge did not update after a convert or a restore | `51cb050` |
| The serial read loop stopped silently on a line error, leaving a connected radio deaf | `f8d7327` |
| The way home was unreachable: a newer backup hid the pre-EMCOMM one | `093a87e` |
| The backup list did not show the pre-convert backup until reloaded | `093a87e` |
| Simple reads had no timeout, so a radio that stopped answering took 37 s to report | `093a87e` |
| An update arriving while offline replaced a complete offline copy with an empty one | `1cc306d` |
| The radio's clock was left wrong after a restart, off by as much as 370 s | `dc144d5` |
| A report cut short by leaving the Reports tab left no sign it went out incomplete | `d7a5be1` |
| A restore changed the name back but did not announce it to other stations | `d7a5be1` |
| A node with no position showed 0, 0, a real place in the Gulf of Guinea | `d7a5be1` |

A middle part lost on the air while testing the interrupted report led to the longer gap between
parts and the Resend button (`91e13f8`, see [Packet size handling](#packet-size-handling)). That
was the radio link, not a fault in the app, and both changes are proven.

As before, not one of these failed a test or a build. Every one was found on the radios. Each
now has a component test, which brings the suite to 456.

Two things built since are proven except for one case each, and neither can be made to
happen on demand:
- **The check for dropped contacts.** The loading screen should say "Checking for dropped
  contacts..." when a Bluetooth connection's first read of the list comes up short. That
  happens on some connections and not others. On the one recorded since, node 2 read all 183
  contacts in one pass, so the step rightly never appeared.
- **Discovery's 10 second listen against N.E. ELP OBSVR.** This repeater was found on earlier
  days and has answered no search since discovery was shortened from 30 seconds. Four others
  have answered, the slowest at 2.73 s, so no trouble is expected, but it is not proven for this
  one.

## Tests

```bash
npm test
```

Six plain node suites and thirty-six component suites, 582 component tests, no hardware
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

The World Magnetic Model 2025 coefficients in `src/js/position/wmm2025.js` are from NOAA's
National Centers for Environmental Information and the British Geological Survey, and are in the
public domain.

## License

MIT, same as upstream. See [LICENSE](LICENSE).
