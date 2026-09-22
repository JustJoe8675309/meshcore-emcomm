# Setting one station up, and handing it to the others

**Built on 22 September 2026 and not yet tried on the radios.** The QR button beside
the settings gear holds it. What follows is the design and the reasoning; the code
is `src/js/modes/ModeShare.js` and `src/components/modes/ModeSharing.vue`.

## What it is for

One operator sets a node up properly: the net's channels and their keys, the radio
settings, which rooms to use, the advert intervals. Everyone else at the muster
point should get the same thing in seconds, without reading keys aloud over the
air or typing a 32 character secret on a phone.

So: **the configured station shows a code, the others scan it**, and their app
writes what it carries into that mode. Nothing on the receiving radio changes
until they switch into the mode, which is already how modes work.

## What is shared, and what is not

A **mode profile** is what travels: radio settings, channels with their keys,
which rooms to use, position answering, advert intervals, the DRILL mark, and the
entering choices (trim, announce, discover).

Three things are deliberately left out:

- **The node name.** Every station is its own station; copying the name would put
  two KJ5HBN-EMCOMMs on the net. The receiver keeps its own.
- **Contacts.** They are not settings, they are who the radio has heard, and they
  come back from each station's own backup.
- **Normal mode.** Normal is the radio as its owner had it, so it is never
  something another station can hand over. Only Emcomm-Live and Emcomm-Training
  can be shared, which is also what was asked for: sharing happens by mode.

## The code itself

**A link, carried in a QR code.**

    https://app.meshcore-emcomm.workers.dev/#/mode?v=1&d=<base64url>

A phone camera opens it, the browser or the installed app takes the link, and the
app shows an import screen. Nothing is decoded by the camera app, and an operator
who has not installed the app still lands on the web one, which is the point.

**The payload** is the profile as JSON, compacted (short keys, no whitespace),
deflated, then base64url. A realistic live profile with three channels is about
400 bytes of JSON, 250 deflated, 340 as text: a version 12 QR at medium error
correction holds around 500 bytes, so it stays easily scannable on a phone screen
in daylight. If it ever will not fit, the app says so rather than producing a code
nobody can read.

**Also offered, for when a camera is not the answer:**
- **Copy as a link** to paste into a message, a spreadsheet or a group chat.
- **Save to a file**, which is the existing backup path, so a whole group can be
  set up from a memory stick with no phones involved.

## What the receiving operator sees

1. The app names the mode and who it came from, and lists what it would change:
   the channels by name, the radio settings against theirs, the advert intervals.
2. **Which mode to write it into**, defaulting to the mode it was shared as. A
   station can take someone's Live profile into its own Training slot on purpose,
   for a drill that mirrors the real thing.
3. **Nothing is written to the radio, and the import never switches modes.** The
   profile is saved, the screen lists what was taken in, and closing it returns to
   the ordinary app screen. The station stays in whatever mode it was already in,
   which for most operators at a muster point is Normal. Entering the mode is the
   banner's job, with its own confirmation: two deliberate steps, decided by the
   operator holding the radio.
4. If they are already in that mode, it says so plainly: the new profile takes
   effect when they switch into it again.

## The part that needs care: keys

A QR code on a screen is readable by anyone who can see the screen, and a
photograph of it keeps working afterwards. A channel key is the only thing
protecting that channel's traffic.

- **Hashtag channels carry no secret.** `#Emcomm`'s key is derived from its name,
  so the code carries the name and the receiver works the key out. Nothing is
  exposed that was not already public.
- **A private channel's key is real.** The code carries it, and the sharing screen
  says so: *this code contains the key to N private channels. Anyone who
  photographs it can read that traffic.*
- **An option to leave private keys out**, which shares the shape of the mode and
  leaves those channels for the operator to add by hand.
- **A time limit.** The payload carries when it was made, and the receiver warns
  about anything older than a day. It does not refuse it: a code printed on a
  briefing sheet the night before is a normal thing to use.

**No passphrase.** Decided, not deferred: it is one more thing to get wrong at a
muster point, and the honest answer is that a QR code is as private as the room it
is shown in. The warning about private keys does the work instead.

## How it is built

- `src/js/modes/ModeShare.js`: `encode(profile, { includePrivateKeys })` and
  `decode(text)`, with the compact keys and the version number. Pure functions,
  so the round trip is tested without a radio and without a camera.
- `src/components/modes/ModeShareDialog.vue`: the QR, the copy and save buttons,
  and the warning about keys. QR drawn by a small library, or by hand: a QR
  encoder is about 300 lines and avoids a dependency that would have to be
  audited.
- `src/components/modes/ModeImportDialog.vue`: what it would change, which mode to
  write it into, and Save.
- A route for `#/mode`, which opens the import dialog and then returns to where
  the operator was.
- **Scanning**: `BarcodeDetector` where the browser has it (Chrome on Android
  does), and paste the link where it does not. A phone's own camera app already
  scans the code and opens the link, so the in-app scanner is a convenience, not
  the path.

## What it does not solve

Two stations must already agree on the radio settings to hear each other at all.
This hands over the settings; it cannot tell an operator standing on the wrong
frequency that they are on the wrong frequency. The mode switch screen says what
it is about to change, which is the closest thing to a warning.
