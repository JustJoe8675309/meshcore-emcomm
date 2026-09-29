# To do

What is wanted but not built, and what is known to be wrong but deliberately left.
Anything *proven* is in [AUDIT.md](AUDIT.md); this is the list of what has not been
done at all.

## Wanted

- [x] **Dark mode.** Asked for 29 Sep, built the same day. Follows the device by
      default with an explicit override, applied before mount so there is no white
      flash. See the Dark mode section of AUDIT.md for what to check on a real screen.

- [ ] **A three-stage battery gauge: yellow at 25%, red at 15%.** Asked for 29 Sep.
      Today it is two-stage and the threshold is a single `<= 20`, in
      `Header.vue:237`, painting `text-red-600` against `text-gray-700`.
      The point of the middle stage is that red should mean *act now*, and a gauge that
      only ever goes red gives no warning while there is still time to do something
      about it. Yellow at 25% is "put the spare on charge"; red at 15% is "you are
      about to lose this station".
      **Three things to get right:**
      1. The thresholds are `<= 25` and `<= 15`, so the order matters -- test 15 as red
         rather than yellow, and 25 as yellow rather than grey.
      2. Yellow on white is the classic unreadable combination. `text-yellow-400` is
         fine on the mode banner because it is a *background* there with black on it;
         as text it needs to be darker, around `amber-600`, and then lifted in dark
         mode like the other warnings.
      3. Colour must not be the only signal, since this is exactly the readout an
         operator glances at in bad light. Consider the number itself doing some of the
         work, or an icon change.
      **This supersedes an in-flight test.** A radio is being drained to check the
      current red-at-20% boundary, and AUDIT.md and the memory both record the check as
      "21% grey against 20% red". When this lands, that item becomes 26/25 for yellow
      and 16/15 for red, and the notes need updating with it -- otherwise the next run
      chases a boundary that no longer exists.

- [ ] **A version number, visible at the top.** Asked for 29 Sep: major and minor,
      with the date it was deployed, such as `V1.1 (29 Sept 2026)`.
      The build already carries a content hash (`index-g9T4k04X.js`) and the service
      worker cache is stamped with it, but neither is a thing an operator can read out
      on the air. The point of this one is the question "what version are you on?"
      being answerable across a net, and answerable by someone reading a phone screen
      rather than a developer console.
      Take both the number and the date **from the build** rather than typing them in,
      or they will drift the first time somebody forgets: a hand-edited version that
      says 1.1 while the station runs 1.0 is worse than none. The audit script already
      compares the live bundle against the local one and is the natural place to check
      the two agree.

- [ ] **Show whether a sent message was heard**, the way the factory MeshCore app
      shows repeats. Asked for 29 Sep.
      This matters most for **channel traffic, which gets no feedback at all today**.
      Channel datagrams are unacknowledged -- one of four Send My Position broadcasts
      arrived at zero range on the bench -- so an operator sending to a channel has no
      way to tell a delivered message from one that went nowhere. A direct message at
      least reports Delivered. Hearing a repeater rebroadcast your own message is
      proof it left your immediate area, which is the one signal available on a path
      that cannot acknowledge.
      Note this is *not* the same as delivery: heard means a repeater picked it up and
      passed it on, not that anybody received it. The wording should not let those be
      confused, since "heard" reading as "delivered" would be worse than showing
      nothing. Worth checking what `meshcore.js` surfaces before designing it -- the
      repeater discovery push (`0x8E`) is one the library does not handle at all, so
      the relevant frames may need handling directly.

## Known wrong, left deliberately

These came out of the 27-29 Sep audit and are judgement calls about what the app
should *say*, not defects. See AUDIT.md for the evidence behind each.

- [ ] **Two buttons called Send on screen at once.** The position prompt's Send and a
      conversation's own Send. The wrong one gets pressed -- it happened twice on the
      bench, once to the operator and once to Claude. The prompt's own group is
      Send / Send with message / Decline / Not now, so scoping to that group is what
      would disambiguate.
- [ ] **Two header buttons carry no accessible name**, while the share button carries
      both `aria-label` and `title`. A screen reader announces them as "button".
- [ ] **The contacts filter and order menu options are plain `div`s** -- no role, no
      tabindex, no accessible name. Mouse-only, and silent to a screen reader.
- [ ] **A finished ping run relabels itself** when the Requests box changes: a
      completed run of 5 reads "5 of 9". Only that header is bound to the live input;
      the run's own count is already in the line beneath it.
- [ ] **"Once" closes before a person can answer.** Three direct requests answered at
      ordinary human speed all returned "the answer came after this app had stopped
      asking". Nothing is lost and the wording is true, but the normal case reports
      itself as a near miss.
- [ ] **`0, 0` is refused for the right reason and told the wrong one** -- the message
      cites a range that `0, 0` is inside.
- [ ] **The room panel says "Not logged in"** after a radio reconnect while the room is
      actively pushing posts, and the instinctive remedy is the one thing that does not
      help.
- [ ] **There is no way to leave a room.** `RoomLoginBar.vue` only logs in, and the
      login is in-memory only, so an operator who wants out has nothing to press.
- [ ] **"1 contact(s)"** -- six warning strings hedge the plural with `(s)` while the
      same files pluralise properly elsewhere.
- [ ] **The repeater picker says "most recently heard first"** and pins favourites
      above that.

## Cannot be tested on the bench

- [ ] The **charge badge turning red at 20%** needs a radio actually that flat.
- [ ] **A repeater that answers discovery but not ping.**
- [ ] The **375px phone items**: Chrome will not be dragged below about 500px and
      `resize_window` does nothing, so these need the real device.
- [ ] The crib sheet's **no-split-across-pages** check needs a form longer than one
      page, and no single form is.
