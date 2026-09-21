# EMCOMM mode

Turns a node that has been living on a busy mesh into one set up for an incident:
a trimmed contact list, radio and power settings checked, position and clock
current, and an advert announcing the station is up. With a way back.

This file records what was decided and why. The reasoning is the part worth
keeping: several of these choices look arbitrary until you know what they are
avoiding.

## What the app can and cannot change

The app talks to the node over the **companion protocol**, not the CLI. That is
the boundary the whole design sits inside, and anything the protocol cannot
*read* is something that cannot be restored.

| Setting | Read | Write |
| ------- | ---- | ----- |
| Node name | yes | yes |
| Advert lat/lon | yes | yes |
| TX power, and the radio's maximum | yes | yes |
| Frequency, bandwidth, spreading factor, coding rate | yes | yes |
| Manual add contacts flag | yes | yes |
| Channels: index, name, secret | yes | yes |
| Contacts: every field, including flags and path | yes | yes |
| Device clock | yes | yes |
| Flood scope / transport key | **no** | yes |

**Not reachable at all.** These are CLI only and need a serial session:
`advert.interval` (zero hop advert interval), `flood.advert.interval`,
`txdelay`, `direct.txdelay`, `agc.reset.interval`, `radio.fem.txgain`.

So "adjust the zero hop and flood adverts" can only mean **sending** one on
demand. How often the node adverts by itself cannot be changed from here.

Flood scope is write only, so it is never touched: setting it would be a change
that could not be put back.

## What converting does

### Contacts

| Type | Action |
| ---- | ------ |
| Companions | Remove all |
| Rooms | Remove if not heard in 90 days |
| Repeaters | Remove if not heard in 90 days |
| Any type whose age cannot be read | **Keep** |

Companions come back on their own: a person's node adverts and is re-added
without anyone doing anything. That makes them the cheapest thing to clear and
the easiest to recover, which is why they go entirely.

Repeaters and rooms are kept on a 90 day rule because they do not come back so
easily. Discovery finds repeaters only at **zero hops**, so a repeater three hops
out that is still perfectly useful would not return. A room is worse: the room
firmware does not implement the discovery control packet at all, so a removed
room only comes back if it happens to advert within earshot or someone pastes a
`meshcore://` link.

**Why an unreadable age means keep.** `lastAdvert` is the *advertising node's*
clock, not when this node heard it — the firmware annotates the field "by THEIR
clock". On the bench one contact claimed an advert dated about four years in the
future. So the age can be nonsense in either direction, and the two mistakes are
not equal: deleting a working repeater because its clock is wrong costs routing
during an incident, while keeping a dead one costs a line in a list.

A timestamp counts as unreadable when it is in the future, or old enough to
predate the firmware.

### Node settings

| Setting | Value | Why |
| ------- | ----- | --- |
| Name | Prompted, prefilled from the operator callsign, editable | Other operators see this. It should say the station is in emergency mode, but the name is the operator's to choose. |
| TX power | The radio's maximum | Reach matters more than battery during an incident, and it is backed up first. |
| Position | From a live GPS fix | Position is operationally useful, and the app already proves a fix is live rather than trusting the one cached at connect. |
| Clock | Synced to the browser | Date time groups, message ordering and the room server's replay check all depend on it. Drift is common and the fix is free. |
| Manual add contacts | On, after discovery | Stops the list refilling with every station the node hears, so a curated roster stays curated. |
| Frequency, BW, SF, CR | US preset, behind a confirmation | See below. |
| Channels | Untouched | Their secrets may not be written down anywhere else. |
| Flood scope | Untouched | Write only. |

### Radio settings

Defaults to the **USA/Canada (Recommended)** preset: **910.525 MHz, BW 62.5,
SF 7, CR 5**. That value comes from the MeshCore FAQ, which notes that as of
October 2025 many regions moved to BW 62.5 and a lower spreading factor in place
of the original SF11.

It is applied only through a dialog that shows the current values beside the new
ones, with every field editable and a preset dropdown offering **USA/Canada
(Recommended)** and **Custom**. Nothing else is listed: the US preset is the only
one published in the MeshCore repository, the FAQ says the rest live in the phone
client and the web flasher, and inventing a frequency is both an off-mesh and a
licensing problem.

The dialog says plainly that changing these takes the node off the mesh of anyone
not using the same settings. It is the one change here that can isolate a
station, which is why it is confirmed rather than applied.

### After converting

Offers a **flood advert**, with zero hop available, then runs repeater discovery.
Flood is the default because announcing the station mesh wide is usually the
point during an incident, and it is a single packet.

## Backups

**Two slots.**

- **Pre-EMCOMM**: written when converting, and only then. This is the way home
  and routine use cannot overwrite it.
- **Latest**: written by the "back up current info" button at any time.

Pressing backup while already in EMCOMM mode would otherwise replace the way home
with the stripped configuration, which is exactly when it is least recoverable.

**Stored in the browser and exportable to a file.** Browser storage works with
one tap in the field but is wiped by clearing site data and exists only on this
machine. The file is the durable copy and can live with the node identity
backups, which are kept outside the repository. A backup contains **channel
secrets and every contact's public key**, so treat the file accordingly.

**A backup that cannot be verified complete warns and lets the operator decide.**
The device announces how many contacts it will send, and over Bluetooth up to 9%
have gone missing in a single read. The count is checked, the shortfall is shown
with real numbers, and converting is still allowed: the operator is the one who
knows whether the node is being stubborn and the risk is worth taking.

**Restore is exact.** The node goes back to the backed up state and anything
gained since is discarded. A restore that merged would leave the node in a state
it had never been in before, which is not a restore.

## Interface

Three buttons under **Emcomm**, at the top of settings:

1. **Back up current info**
2. **Load last backup**, with the date and time beneath it, offering both slots
   when a pre-EMCOMM backup exists
3. **Convert to EMCOMM mode**

An **EMCOMM settings** group sits at the bottom of the settings list, just above
**Commands**. It has one row per setting the mode changes, each showing what it
is now and what EMCOMM mode sets it to, so it answers "what did the mode do, and
what can I put back by hand" in one place. Name, position and TX power appear
here as well as in the groups above; both read from the device, so they cannot
silently disagree.

Radio parameters appear there **read only**, with a link to the Radio group. They
are the one setting that takes a station off the mesh, and they should not sit
one mis-tap away from the emergency controls.

The group shows mode state at the top: in EMCOMM mode since a given time, or not
in it. State is keyed by the node's public key, so connecting a different radio
does not show the wrong one.

## Build order

Built in stages, each verified on the radios before the next. The point of the
order is that **the way home exists and is proven before anything deletes a
contact**.

1. **Backup and restore only.** No wipe, no settings changes. Back up a node,
   restore it, confirm nothing changed. Verify the file export and import.
2. **Trimming.** The contact rules, with the 90 day window and the unreadable
   age case. Restore is already proven, so a mistake here is recoverable.
3. **Settings, radio dialog, advert and discovery.**
4. **The EMCOMM settings group.**

## Known risks

**There is no bulk delete.** Removing contacts is one command per contact, so
clearing a 265 contact node is 265 commands over a link measured dropping frames.
Both wipe and restore verify afterwards and retry what did not take, and show
progress. A half completed wipe leaves the node in a state that is neither, which
is worse than either.

**A backup is only as good as the read it came from.** The contact list is
re-read and merged until complete for exactly this reason. See the contact
loading notes in the README.

**Radio settings can isolate a station.** Everything else here is a nuisance if
wrong. This one can leave a node unable to hear anybody, with no indication other
than silence.
