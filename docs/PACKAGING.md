# Turning this into an installable app

Held for when the app is finished enough to package. Nothing here is built yet, and
none of it changes how the app works today.

Two plans: **A** finishes the PWA, which is what the app already nearly is, and **B**
wraps it as a real Android and iPhone app with Capacitor. A is worth doing whatever
happens next; B only becomes worth it for the three things a browser cannot do.

## What decides this

The app talks to radios two ways, and the browser support is not the same:

| | Web Serial (USB) | Web Bluetooth |
| --- | --- | --- |
| Chrome / Edge, desktop | yes | yes |
| Chrome, Android | **no** | yes |
| Safari / iPhone | **no** | **no** |
| Firefox | **no** | **no** |

So today: a phone means Android and Bluetooth; USB means a desktop; an iPhone cannot
be used at all. Both transports come from `meshcore.js` through
`src/js/Connection.js`, which calls `WebBleConnection.open()` and
`WebSerialConnection.open()`.

**Three things a browser cannot do**, and the only real reasons to go to plan B:
1. **Run with the app closed or the phone locked.** Repeating adverts, repeating
   position requests and roll calls all run on browser timers, which is why the app
   holds a wake lock and says it needs to stay open.
2. **iPhone at all.**
3. **Reconnect a radio by itself.** The browser requires a person to pick the device
   every time, which is why a dropped link needs the operator.

---

## Plan A: finish the PWA

The app already has a manifest (`src/public/manifest.json`), an offline service worker
stamped per build, and an install prompt from the browser. What is missing is the
polish that makes an installed copy look and behave like an app.

**A1. Icons and identity.** One 512×512 icon exists. Add 192×192, a maskable icon
(Android crops to a circle, and an unpadded icon loses its edges), and an Apple touch
icon. Add `apple-mobile-web-app-*` tags to `src/index.html` so an iPhone home screen
copy opens without Safari's chrome, even though the radio cannot be used there.
Decide a name and a theme colour: the manifest currently says `#FFFFFF`, which gives a
white status bar. Amber would match the EMCOMM banner.

**A2. Screenshots and a description** in the manifest, so the install prompt shows what
the app is. These are also what a Play listing would need later.

**A3. Say when an update is waiting.** The service worker installs a new build in the
background and the operator gets it on the next start, with nothing on screen to say
so. Add a small "a new version is ready, reload" line. During an incident nobody should
be surprised by a version change, and nobody should be stuck on an old one either.

**A4. A first-run page.** What the app needs (Chrome or Edge, a radio on USB or
Bluetooth), what it cannot do (iPhone, Firefox), and how to install it. Today an
operator on the wrong browser sees a Connect button that does nothing useful.

**A5. Check the offline story on a clean device.** Install, turn off the network, close
the app, reopen it, connect a radio, send a report. The audit checklist has this; it is
worth a run specifically after packaging changes.

**A6. Write the install instructions** into the README for other operators: Chrome menu
to install, and what to expect on a phone.

Cost: nothing. Risk: none to the radios. This is all presentation.

---

## Plan B: a real app with Capacitor

Capacitor wraps the built web app in a native Android and iOS shell and gives it native
plugins for Bluetooth and USB serial. The Vue app stays exactly as it is; what changes
is how `Connection.js` opens a link.

### B1. A transport layer in this app

`meshcore.js` makes this small. Every connection extends its `Connection` class, which
does all the framing and command handling and calls `sendToRadioFrame(bytes)` to
transmit and hands received frames back the same way. `WebBleConnection` is about 100
lines on top of that.

So: add `src/js/transport/` with

- `NativeBleConnection.js` — the same shape as `WebBleConnection`, using
  `@capacitor-community/bluetooth-le` for scanning, connecting, writing the RX
  characteristic and subscribing to TX.
- `NativeSerialConnection.js` — the same, over a USB serial plugin
  (`capacitor-usb-serial` or similar; needs checking for CH340 and CP2102 support,
  which is what these radios use).
- `Transports.js` — picks native when running under Capacitor, web otherwise, so the
  desktop browser build keeps working unchanged and the tests keep running in Node.

`Connection.js` then calls `Transports.openBluetooth()` and `Transports.openSerial()`
instead of the library's `open()` directly. `SerialResilience.js` patches
`WebSerialConnection.prototype.readLoop`, so it needs the same treatment for the
native one, or the resilience logic moved into a shared mixin.

This is the only real code change in the whole plan, and it is contained.

### B2. The native project

- `npm i @capacitor/core @capacitor/cli @capacitor/android` and `npx cap init`, with
  `webDir: "dist"`, so `npm run build` then `npx cap sync` is the whole pipeline.
- Android permissions in the manifest: `BLUETOOTH_SCAN` (with
  `neverForLocation` if we never derive location from it), `BLUETOOTH_CONNECT`, and
  for older Android `ACCESS_FINE_LOCATION`, which Android requires for BLE scanning
  and which needs explaining in the app so it does not look like the app wants to
  track the operator. USB serial needs an intent filter and a device filter list.
- A keystore, generated once and backed up outside the repo beside the node keys. Lose
  it and the app cannot be updated, only replaced under a new name.

### B3. What being native buys, done properly

- **A foreground service** so repeating adverts, roll calls and repeating position
  requests keep running with the screen off, with a notification saying the app is
  holding the radio. This is the main prize.
- **Automatic reconnect** to the last radio, without a chooser, after a drop or a
  restart.
- **Real notifications** for messages and position requests, which a locked phone
  currently misses.
- **Background-safe storage.** IndexedDB carries over as it is, but a native build can
  also export and import the whole database to a file without the browser's download
  awkwardness.

### B4. iPhone

`@capacitor/ios` and the same BLE plugin give an iPhone version, Bluetooth only: there
is no USB serial path on iOS for these radios. Needs a Mac to build, an Apple
Developer account at $99 a year, and a review that will ask what the Bluetooth
permission is for.

### B5. Distribution

- **Sideload:** `./gradlew assembleRelease`, signed with the keystore, handed to the
  club as an APK. No fees, no review, no waiting. This is the sensible first step.
- **Play Store:** a bundle rather than an APK, $25 once, a privacy policy URL (there
  is already `src/public/privacy-policy.html` to build on), the data safety form
  (this app sends nothing anywhere, which is a short form), and Bluetooth permission
  declarations.
- **F-Droid** is possible since the source is public, but it is fussy about build
  reproducibility and is probably not worth it.

### B6. Keeping both alive

The web app stays the primary target: it is what updates instantly, and it is the only
thing that works on a desktop over USB. The native builds follow at whatever pace the
store allows. One test suite covers both, since the transport layer is the only
difference and it is mockable.

---

## Order I would do it in

1. Plan A, all of it. It is an afternoon and it helps every operator today.
2. B1 and B2, and a sideloaded APK for one phone. Prove Bluetooth works natively
   before promising anything.
3. B3's foreground service, which is the reason to be native at all.
4. Play Store, if other operators actually want it from a store.
5. iPhone, only if someone needs it, since it is the most cost for the least reach.

## The name

**Mesh-Emcomm**, chosen 2026-09-22. It is what the header, the browser tab, the install
prompt and the line other stations see on a position request all say. Deliberately not
"MeshCore-Emcomm" any more: the app is not official MeshCore, and a store listing should
not suggest it is.

Left alone on purpose, because changing them costs something and buys nothing:
- **The address** `app.meshcore-emcomm.workers.dev`. A PWA install is bound to its
  origin, so operators who installed from the old address would keep pointing at it and
  lose their settings and message history.
- **The repository, the Cloudflare worker and the offline cache prefix.** Internal
  names nobody reads.

Still to do before publishing: `src/public/privacy-policy.html` came from the original
project and names Liam Cottle as the service provider. It needs rewriting for this app
and whoever publishes it, which both stores will ask for anyway.

## Licence and naming, before publishing anywhere

The project is MIT, forked from Liam Cottle's `meshcore-web`. His copyright and the MIT
text stay in the repo and in any published build; add a copyright line of your own
beside it. The app's name and icon should not suggest it is official MeshCore. Both
stores will ask for a privacy policy even though the app collects nothing, and the
honest answer — everything stays on the device and the radio — is a short document.
