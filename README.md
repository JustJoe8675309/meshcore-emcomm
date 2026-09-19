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
fill it in, and send. Four forms are included:

| Form | Purpose |
| ---- | ------- |
| ICS-213 General Message | General message traffic between stations |
| ARES/RACES Check-In | Register your station with net control |
| SITREP / Status Report | Situation report from the field |
| ICS-213RR Resource Request | Request personnel, equipment or supplies |

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

## Running it

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

Two suites, no hardware required:

- `test/report_encoder.test.mjs` covers rendering and packet splitting, including a
  simulation of the firmware's own truncation rule to confirm no part can ever exceed
  160 bytes on the air. Also covers multi byte characters, surrogate pairs, the exact
  byte boundary, and part counts that push the `[n/m]` marker into two digits.
- `test/serial_framing.test.mjs` feeds synthetic device frames through the serial
  decoder to cover the USB path: frames split byte by byte, split mid header, several
  frames coalesced into one chunk, and resync after boot noise.

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
