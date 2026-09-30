# Why the contact list does not all load, and what a rewrite would look like

Written overnight 29-30 Sep 2026 for discussion. Everything marked *verified* was read
in the MeshCore firmware source (`meshcore-dev/MeshCore`, the same files
`npm run audit` checks) or measured on the bench that night. Everything else is marked
as inference.

## The short version

The radio streams its contacts through a **four-frame send queue** that **drops any
frame it cannot fit**, silently, and tells nobody. Contacts alone would never fill it,
because the firmware paces them at one per 60 ms. What fills it is everything *else*
the radio wants to tell the app at the same moment -- an advert heard, a path change, a
message waiting -- none of which is paced. When three of those land inside one 60 ms
window, the next frame written is lost, and on a busy mesh that is often a contact.
Which contact depends on when the mesh happened to speak, so the loss is random and a
different few every time. That is what the bench showed.

USB serial has no queue: it writes straight to the port and blocks. That is why node 1
reads 215 of 215 every time and has never dropped one.

The app's answer today is to read the whole list again and merge. It works on a quiet
link and degrades on a noisy one, because every pass re-fights the same contention.

**The firmware already offers the fix and the app has never used it.** `CMD_GET_CONTACTS`
takes a `since` timestamp and streams only contacts modified after it; the end-of-list
frame hands back the newest timestamp "so app can update their since". A connect after
the first would ask for a handful of frames instead of 260. And `CMD_GET_CONTACT_BY_KEY`
fetches one contact in one frame, so the few a short read misses can be repaired by
name instead of by streaming everything again. The rewrite is: persist the list, ask
for the delta, repair the gaps by key, reconcile against the count. The pieces exist.

## What the radio does when asked for its contacts (verified)

`examples/companion_radio/MyMesh.cpp`:

1. On `CMD_GET_CONTACTS` it replies `RESP_CODE_CONTACTS_START` carrying
   `getNumContacts()` -- **the total, not a filtered count** (the comment says so).
2. It starts an iterator. If one is already running it replies `ERR_CODE_BAD_STATE`
   and does nothing; the app already handles this by listening without asking.
3. In its main loop, **only when `!_serial->isWriteBusy()`**, it takes the next
   contact, applies `contact.lastmod > _iter_filter_since`, and writes one
   `RESP_CODE_CONTACT` frame. One contact per loop pass, and never sooner than the
   interface allows.
4. At the end it writes `RESP_CODE_END_OF_CONTACTS` carrying `_most_recent_lastmod`.

`lastmod` is by the radio's own clock (`ContactInfo.h`), which the app sets at every
connect.

## Where the frames are lost (verified)

`src/helpers/esp32/SerialBLEInterface.{h,cpp}`:

    #define FRAME_QUEUE_SIZE  4
    ...
    if (send_queue_len >= FRAME_QUEUE_SIZE) {
      BLE_DEBUG_PRINTLN("writeFrame(), send_queue is full!");
      return 0;                                  // dropped. caller ignores the 0.
    }
    ...
    #define BLE_WRITE_MIN_INTERVAL 60            // one notify per 60 ms, at most
    bool isWriteBusy() { return millis() < _last_write + BLE_WRITE_MIN_INTERVAL; }

So the BLE link carries at most about 16 frames a second, from a queue four deep, and
a write that finds the queue full is discarded. `writeFrame` returns 0 for it; every
caller in `MyMesh.cpp` ignores the return value. There is no sequence number in a
contact frame, so a dropped one leaves no hole the app can see -- only a count that
comes up short against `CONTACTS_START`.

**Contacts by themselves cannot overflow this.** The iterator waits for
`!isWriteBusy()`, so it adds one frame per 60 ms into a queue draining one per 60 ms.
The overflow comes from the writers that do not wait. From the same file, the pushes
that write frames whenever their event happens, regardless of the queue:

    PUSH_CODE_NEW_ADVERT      a station heard for the first time -- a FULL contact frame
    PUSH_CODE_ADVERT          a known station heard again
    PUSH_CODE_PATH_UPDATED    a path changed
    PUSH_CODE_MSG_WAITING     a message arrived
    PUSH_CODE_SEND_CONFIRMED  an ack
    PUSH_CODE_TELEMETRY_RESPONSE, LOGIN_*, TRACE_DATA, LOG_RX_DATA, ...

A mesh with 260 known stations at night is advertising all the time. Three pushes in
one 60 ms window and the queue is full; the next contact the iterator writes is gone.

## Why serial never loses (verified)

`src/helpers/ArduinoSerialInterface.cpp`:

    bool isWriteBusy() const { return false; }
    size_t writeFrame(...) { _serial->write(hdr, 3); return _serial->write(src, len); }

No queue, no pacing, no drop. The Arduino serial write blocks until the bytes are in
the USB buffer. Node 1 reads 215 of 215 for this reason and no other.

## Why the loss is random, and why the bench looked the way it did

- **A different subset each time** (node 2: 10 contacts only in read A, 47 only in
  read B, union 238 of 260) -- because the drops are decided by when the mesh spoke,
  not by which contact was being sent. Verified on the bench.
- **A bigger roster read clean on the same transport** (node 3: 311 of 313 in three
  passes, later 313 in one) -- because contention is about the *rate of pushes* during
  the read, not the size of the list. A quieter moment, or a quieter spot, reads clean.
- **Diminishing passes** (node 2: 120, then 194, then stalled) -- each pass re-fights
  the same contention for 15-20 s of streaming, and the merge only gains what the
  previous passes happened to miss *and* this one happens to keep.
- **Why two reads at once made it worse** (node 3, 201 s for three passes) -- two
  iterators cannot run, but the app's second read still got the radio's refusals and
  its own listening passes, and the extra command frames were more contention. Fixed
  in v1.9 by allowing one full read at a time.
- **The reflash.** Node 2 went from 167-228 of 260 to 252 of 260 with the same
  firmware build. *Inference, not verified:* the model says the read got better
  because fewer pushes competed, which could be the flash clearing state that was
  generating pushes (a bloated path table, a stuck iterator, a bonding oddity) -- or it
  could be the mesh being quieter at 01:15 than at 00:30. The two are separable, see
  the measurements below. What is *not* consistent with the model is a hardware fault:
  a failing BLE module would not read 97% cleanly ten minutes after reading 64%.

## What the app does today, and what each piece costs

`src/js/Connection.js`, `loadContacts` and `readContactsStream`:

| mechanism | what it does | cost |
|---|---|---|
| merge by public key across passes | recovers contacts a later pass keeps | every pass re-streams the whole list: 15-20 s of contention each |
| up to 8 passes | more chances | on a noisy link, passes 4-8 add almost nothing |
| listen without asking | picks up an iterator still running after a refusal | correct, but a refused pass still costs a pass |
| 120 s budget, extended to 240 s while gaining | stops a stalled read, not a working one | a connect can take four minutes |
| quiet detection instead of the end marker | survives the END frame being dropped | fine |
| one full read at a time (v1.9) | stops reads competing with each other | fine |
| `contactsMissing` recorded in the backup | a short read is marked short | fine |
| a short read never replaces a fuller record (v1.8) | protects the way home | fine, but the way home can still be short |
| single-contact refresh on advert (`CMD_GET_CONTACT_BY_KEY`) | keeps the list current without a full read | already the right primitive; only used for live updates |

Every one of these is a way of coping with re-streaming the whole list. None of them
changes the fact that the whole list is re-streamed.

## What the firmware offers that the app never uses (verified)

1. **`CMD_GET_CONTACTS` with `since`.** Four bytes after the command. The iterator
   sends only `contact.lastmod > since`. `meshcore.js` already exposes it as
   `sendCommandGetContacts(since)`; the app calls it with no argument, which is
   `since = 0`, which is everything. The end frame carries `_most_recent_lastmod` for
   exactly this purpose -- the comment in the firmware says "so app can update their
   since". Each contact frame also carries its own `lastmod` (`MyMesh.cpp` line 184),
   so the app can compute the newest itself even if the END frame is dropped.
2. **`CMD_GET_CONTACT_BY_KEY` (30).** One contact, one frame. The app uses it for live
   refreshes. It is also the right tool for repairing a short read: after 252 of 260,
   the missing eight can be asked for by name, eight frames, each trivially
   deliverable, instead of streaming 260 again in the hope of a better roll.
3. **`PUSH_CODE_CONTACT_DELETED` (0x8F)** tells the app when the radio evicts its
   oldest contact. The app handles it live. Combined with the total count from
   `CONTACTS_START`, it is enough to know when a persisted list has drifted.

## A rewrite from scratch: the design

**Principle:** never stream the whole list when a delta will do, and never stream the
whole list again to recover a few. Keep what was read; ask for what changed; repair
what was missed by name; check the total to know when a full read is genuinely needed.

**Persist per node** (the app already keeps a per-node IndexedDB for messages, opened at
"Opening this node's messages"):

- the contact list, keyed by public key, with each contact's `lastmod`
- `newestLastmod` -- the largest `lastmod` seen, from the END frame or computed
- `announcedTotal` -- the count from the last `CONTACTS_START`

**On connect:**

1. If nothing is persisted for this node: full read, as today (pass-merge). This is
   the one time the list has to be streamed, and it is the case the current code is
   already reasonably good at. Then repair by key (step 4) rather than re-streaming.
2. Otherwise send `CMD_GET_CONTACTS` with `since = newestLastmod - 1` (minus one
   second, because the filter is strict and a contact modified in the same second as
   the newest one seen would otherwise be skipped forever). Receive the delta: usually
   a handful of frames, which a four-deep queue handles easily. Merge.
3. Compare `announcedTotal` from `CONTACTS_START` (still the total, not the delta)
   with the persisted count after the merge. Equal: done, seconds after connecting.
   Radio has fewer: contacts were evicted or removed while away; the 0x8F pushes were
   not seen, so reconcile (step 5). Radio has more: the delta was short; repair (step 4).
4. **Repair by key.** For a full read that came up short, the missing contacts are not
   identifiable today -- the app knows it is eight short, not which eight. With a
   persisted list they are: persisted minus received. Fetch each with
   `CMD_GET_CONTACT_BY_KEY`, one frame apiece, paced. For a delta that came up short
   the same applies to anything persisted whose `lastmod` should have brought it back.
   Anything the radio answers `not found` for is a contact it no longer holds: drop it.
5. **Reconcile** when the count says the persisted list has contacts the radio does
   not: walk the persisted keys with `CMD_GET_CONTACT_BY_KEY` and drop the `not found`
   ones. This is N single frames rather than one streamed list, and it can be done in
   the background after the connect has finished, because the operator's roster is
   already correct enough to use.
6. Keep the live pushes as they are: 0x80/0x81 refresh one contact, 0x8F removes one.
   They now update the persisted list too, so the next connect's delta is small.

**What exists already:** the per-node database, the pass-merge full read, the by-key
fetch and its wrong-answer fallback, the eviction handling, the `contactsMissing`
bookkeeping, the single-flight guard, and the `since` parameter in the library.

**What is new:** persisting contacts and `newestLastmod`; the `since` call; the
repair-by-key loop; the count reconciliation; tests for each, including a radio that
drops frames at random so the repair path is exercised rather than assumed. A day's
work, plus proving it on node 2 and node 3 over Bluetooth, which is the only proof
that counts.

**Risks and guards:**

- *The radio's clock jumps backwards* (a reset, or the app setting it from a device
  whose clock is behind): `lastmod` values go backwards and `since` excludes
  everything. Guard: if the delta is empty but `announcedTotal` differs from the
  persisted count, fall back to a full read.
- *The END frame is dropped* so `newestLastmod` never arrives: compute it from the
  received contacts' own `lastmod` fields instead of relying on the frame.
- *A contact updated while the delta is streaming* arrives with a `lastmod` newer than
  the stored `since` next time, so it is simply sent again. Harmless.
- *The way home:* the backup must be taken from the persisted, reconciled list, not
  from whatever one read returned, and must still record `missing` honestly. The v1.8
  rule (a short read never replaces a fuller record) stays.
- *A radio on old firmware without `since`:* it ignores the extra bytes and sends
  everything, which is today's behaviour. The count check catches it.

**What this does not fix:** the first-ever read of a large roster on a noisy mesh still
streams everything through the same four-slot queue and still loses some. Repair by key
then closes the gap in seconds instead of minutes, and every connect after that is a
delta. The queue itself is a firmware limit.

## What would fix it at the source

The firmware, not the app. Any one of: a deeper queue; `writeFrame` blocking or
retrying instead of dropping; the iterator pausing while the queue is above a
threshold; a sequence number in contact frames so a client can ask for the ones it
missed. The first two are a few lines in `SerialBLEInterface.cpp`. This is worth a
report to `meshcore-dev/MeshCore` with the bench numbers, because every BLE client has
this problem and most of them do not count. The app-side design above is right even if
the firmware is fixed, because deltas are cheaper than full reads on any link.

## Measurements to take next

1. **Count the pushes during a read.** The app receives every 0x80/0x81/msg-waiting
   frame; count them per contact read and record it beside the shortfall. If shortfall
   tracks push rate, the model is confirmed and node 2's reflash improvement can be
   explained by the mesh being quieter -- or not.
2. **Node 2 pre/post reflash, same time of day.** Read it at 00:30 tomorrow and
   compare with tonight's 00:30 result (167 of 260). Same conditions, one variable.
3. **Delta size on a second connect.** Once `since` is wired up, log how many frames a
   reconnect actually needs. The expectation is single digits.

## Decisions taken, 30 Sep

- **Build the rewrite: yes**, on the condition that it cannot make the app worse.
  Built as v1.10 (`src/js/contacts/ContactStore.js`, and the delta and repair paths in
  `Connection.js`). The condition is met by design: the delta path only counts as
  success when the merged count equals what the radio announced, and everything else
  falls through to the full read the app has always done. One refinement over the
  design above, found while testing: the end-of-list frame's "most recent lastmod" is
  *not* used for the next `since`. The radio computes it over every contact it sent,
  including the ones the queue dropped, so it can sit above anything that arrived --
  and a mark taken from it would skip exactly the contact that was lost. The mark is
  the newest of what actually arrived, which cannot skip anything.
  **Proven on node 2, 30 Sep.** Three connects: a first full read that saved 253 of
  260; a second where the delta fell through and the repair fetched the last two by
  name to reach 260 of 260, the first complete read that radio ever produced; and a
  third, with the store complete, that read `260 of 260, 2 changed, 1 delta pass` in
  one second. The two days before, the same radio took 127-208 s to reach 167-228.
- **The firmware issue**: not filed yet. The operator's priority is our app working
  reliably; the report can follow once the rewrite is proven on the bench.
- **Node 2**: no investigation of what the reflash cleared. It reads 252 of 260 now, the
  rewrite makes the remaining loss recoverable by name, and "reflash is the remedy" is
  noted in the bench memory.
