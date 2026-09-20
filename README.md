# MeshCore Emcomm

A web based [MeshCore](https://github.com/meshcore-dev/MeshCore) client for the
[Companion Radio Firmware](https://github.com/meshcore-dev/MeshCore/blob/main/examples/companion_radio/main.cpp),
with structured emergency communications report forms.

This is a fork of [liamcottle/meshcore-web](https://github.com/liamcottle/meshcore-web), which is no
longer maintained upstream. Everything the original client does still works: contacts, channels,
messaging, settings and the RX log.

## What this fork adds

### Reports tab

A third tab alongside Contacts and Channels. Pick the channel to transmit on, choose a report form,
fill it in, and send. Seventeen forms are included:

| Form | Purpose | On the air |
| ---- | ------- | ---------- |
| ICS-209 SITREP / Status Report | Situation report from the field | 99 b, 1 packet |
| ICS-211 ARES/RACES Check-In | Register your station with net control | 104 b, 1 packet |
| ICS-213 General Message | General message traffic between stations | 154 b, 2 packets |
| ICS-213RR Resource Request | Request personnel, equipment or supplies | 132 b, 1 packet |
| Damage Assessment | Observed damage at a location, with severity | 157 b, 1 packet |
| Health & Welfare | Enquiry or reply about an individual | 167 b, 2 packets |
| Net Check-Out | Leave the net and release your station | 114 b, 1 packet |
| Net Traffic Summary | Net control summary of a session | 113 b, 1 packet |
| Road / Route Status | Whether a route is passable, and any detour | 134 b, 1 packet |
| SALUTE Spot Report | Size, activity, location, unit, time, equipment | 144 b, 2 packets |
| Shelter Status | Population, capacity and needs | 135 b, 1 packet |
| SKYWARN Spotter Report | Severe weather observation for the NWS | 170 b, 2 packets |
| 9-Line MEDEVAC Request | Medical evacuation request, standard nine lines | 214 b, 2 packets |
| ARRL Radiogram (NTS) | Formal traffic in National Traffic System format | 218 b, 2 packets |
| Communications Status | A repeater, mesh node or link up or down | 151 b, 1 packet |
| Net Activation | Announce a net is open and how to check in | 167 b, 2 packets |
| Position / Station Report | Where a station is and whether it is operational | 141 b, 1 packet |

All seventeen have been transmitted and received between two nodes. The byte figures are
measured, not estimated: they are what went to the radio, including the sender name prefix
the firmware prepends, using realistic content for each form.

Those figures depend on the sending node's name. The prefix is charged against the same
160 bytes as the content, so a long device name costs every channel report. The measurements
above use a 15 character name, which spends 17 bytes before any content. Most of the forms
that exceed one packet would fit in one with a short name; the radiogram and the 9-line
carry enough content that they will usually split whatever the node is called. Direct messages carry no
prefix at all and always have the full budget.

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

### Packet size handling

The companion firmware caps a channel message at `MAX_TEXT_LEN` (160 bytes), and that budget
includes the `<sender name>: ` prefix the firmware prepends in `BaseChatMesh::sendGroupMessage()`.
Anything over the cap is **silently truncated by the firmware**, so this fork enforces the limit
before transmitting.

Reports that do not fit are split into numbered parts (`[1/3]`, `[2/3]`, ...) sent 2 seconds apart.
Splitting is byte aware rather than character aware, so multi byte characters are never cut in half,
and it breaks on word boundaries where possible.

The Reports tab shows the exact bytes and the exact packets before you transmit, so what you see on
screen is what goes over the air.

### Real channel selection

Upstream hardcoded a single "Public Channel". This fork upgrades `@liamcottle/meshcore.js` from
1.2.0 to 1.15.0 and enumerates the channels actually configured on the device via `getChannels()`,
falling back to the public channel if the firmware does not support the command.

### Works offline

An emergency client that only runs while the network is up is not much use in an
emergency. Everything needed at runtime is already local: the radio is on USB or
Bluetooth, and messages are stored in IndexedDB. The service worker caches the app's
own files so it starts with no network at all.

One online load is needed first to populate the cache. After that, pull the plug on
the network and the app still opens, routes and talks to the radio. This was verified
by stopping the web server entirely and reloading.

Installing it (Chrome's "Install app") is worth doing for field use: it opens in its
own window with no browser chrome, and the cache is what makes that work when
disconnected.

Hashed build assets are cached as they are requested, since their names change every
build. The page itself is fetched network first so a new deployment is picked up when
online, and served from cache when not.

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

## Tests

```bash
npm test
```

Five suites, no hardware required:

- `test/report_encoder.test.mjs` covers rendering and packet splitting, including a
  simulation of the firmware's own truncation rule to confirm no part can ever exceed
  160 bytes on the air. Also covers multi byte characters, surrogate pairs, the exact
  byte boundary, and part counts that push the `[n/m]` marker into two digits.
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
