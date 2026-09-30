# To do

What is wanted but not built, and what is known to be wrong but deliberately left.
Anything *proven* is in [AUDIT.md](AUDIT.md); this is the list of what has not been
done at all.

## Wanted

- [x] **Dark mode.** Asked for 29 Sep, built the same day. Follows the device by
      default with an explicit override, applied before mount so there is no white
      flash. See the Dark mode section of AUDIT.md for what to check on a real screen.

- [x] **A three-stage battery gauge: yellow at 25%, red at 15%.** Asked for 29 Sep,
      built the same day. Grey above a quarter, `text-amber-700` at 25% or less,
      `text-red-600` at 15% or less, in `Header.vue`.
      **amber-600 was the wrong colour**, though it is what this entry suggested.
      Computed rather than eyeballed: on white, amber-600 is 3.19:1 against the 4.5:1
      body-sized text needs, and amber-700 is 5.02:1. red-600 is 4.83:1 and gray-700
      10.31:1, so all three stages pass, and so do the dark-mode liftings at 5.99 to
      10.28:1. amber-700 was already lifted in style.css with the other mid-tone
      warnings, so it needed no new palette entry.
      Colour is not the only signal, and was not before either: the percentage is
      spelled out beside the icon and the fill is proportional. On top of that the
      outline thickens from 1.5 to 2.25 at red, which is what carries in sunlight and
      to the one in twelve men who cannot separate that red from that grey. No word like
      "Low" was added -- the badge is pinned to pixels because 375px of phone ran out
      once already, and text is the one thing here that cannot be afforded. The advice
      lives in the hover title instead.
      Nine mutations, all caught, including both thresholds from either side and the two
      checks in the wrong order, which is what makes 15 red rather than amber.
      **The old evidence was reinterpreted, not discarded.** The 29 Sep flat-radio run
      read 16% as red; under these thresholds it should read amber, so AUDIT.md now
      carries that as a prediction to check. Amber has never been seen on hardware.

- [x] **A version number, visible at the top.** Asked for 29 Sep, built the same day.
      Shows `v1.1 · 29 Sep 2026` in small grey on the app-name line -- not the
      station-name line, which is the width-critical one on a phone.
      Both halves are injected from the build (`__BUILD__` in vite.config.js, read by
      `src/js/Version.js`), never typed in, so they cannot drift. `npm run audit` reads
      the same stamp back out of the bundle and compares it with package.json.
      Patch versions are not shown: they are what changes when a typo is fixed, and the
      extra characters crowd the station name.
      **Bump `version` in package.json** to make the number move -- minor for a new
      feature, major for a change that breaks a station's stored settings.
      Untested on a real screen; see the header section of AUDIT.md for what to look at.

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

- [ ] **Battery indicator: how often it updates, and whether it is charging.**
      Asked for 29 Sep, alongside the three-stage gauge above.
      There is evidence for both halves from the 28-29 Sep drain. The watcher logged
      **100% at 16:27 on the 28th, then 16% at 13:54 the next day, then 33% two minutes
      after that.** Two things fall out of it:
      - **It can sit stale for hours.** A gauge an operator is meant to act on should
        not be able to show a figure from yesterday. Find out whether the radio pushes
        the reading or it is only fetched at connect and on certain commands, and give
        it a known cadence.
      - **16% to 33% in two minutes is charging, and nothing said so.** A station on a
        charger and a station about to die look identical, which is the distinction
        that actually matters during a net.
      Check what `meshcore.js` exposes first: the battery may arrive with other
      telemetry rather than on its own, and the radio may report voltage rather than a
      percentage, in which case charging has to be inferred from the trend and should
      only be shown when it is confident. Pairs with the three-stage gauge -- a falling
      25% and a rising 25% deserve different treatment.

- [x] **Disconnect should offer to bring the station home first.** Asked for 29 Sep,
      built the same day. `DisconnectDialog.vue`: put it back to normal mode and then
      disconnect, disconnect and leave it in the mode, or stay connected.
      A station already in normal mode is not asked. There is nothing to come home
      from, and a question with one real answer teaches an operator to dismiss the
      dialog unread -- which is the habit that would make this one useless on the day
      it matters.
      **The disconnect waits for the switch**, it does not race it: dropping the link
      part way through writing channels is worse than either answer offered. And a
      switch that fails does not disconnect -- being told "it did not come home" while
      the radio is still on the air is recoverable; being told it after the link is
      gone is not. Seven mutations, all caught, including both of those.
      Checked on screen at 375px in both themes, against the built CSS, in all three
      states. That is what found "the channels was not set" -- `what` is sometimes
      plural, so the verb cannot agree with it, and the phrasing now fronts the
      failure instead. **ModeSwitchDialog still has the original wording.**
      **Proven on node 1, 29 Sep**, and it found a defect of its own. The dialog, the
      three answers, the held link and the progress line all worked -- the trip home
      took 26 s and the link was held throughout. But disconnecting the instant the
      switch finished **lost the contacts it had just restored**: the radio acks every
      write, and closing the port resets it before the firmware has flushed. The link
      is now held 60 s afterwards, with a countdown and a way out. See the contact
      item in AUDIT.md for the paired test that proved it.

- [ ] **Sweep the whole repo for anything else personal.** Deferred 29 Sep. The
      callsign and the position are done and the built bundle is clean, but that was
      two targeted passes rather than a survey.
      **The one that needs deciding first: git history.** Scrubbing the working tree
      does not remove anything from past commits. The old callsign, the home
      coordinates and the MGRS are all still recoverable with `git log -p`, and some
      commit messages quote them too. If the repo is public that history is public.
      Rewriting it means a force push and breaks every existing clone, so it is a
      decision rather than a chore -- and worth making before the repo gets more
      attention rather than after.
      Places a survey should cover beyond the source:
      - `package.json` author and repository fields, and the licence
      - `manifest.json` and the service worker: app name, description, any author field
      - anything under a public path that is not code -- icons, screenshots, sample files
      - commit messages and branch names, not just file contents
      - the audit and mode docs, which quote real bench sessions
      - `.claude/` settings and any launch config, which can carry local paths
      Check `dist/` as well as `src/` every time: comments are stripped by the build, so
      the source and the shipped app answer this question differently.

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
- [x] **A connect can overwrite the way home with a worse copy.** Found 29 Sep on
      node 1, fixed the same night. The refresh is kept -- it is how a channel added
      with another app becomes part of the way home, and node 3 lost a channel to a
      record three days old -- but a capture that would shrink the record now asks
      first and writes nothing until answered.
      `NodeBackup.shrinkage` judges the two kinds differently: any lost channel asks,
      because a channel's key cannot be heard again, while contacts have to drop by
      more than ten or more than a fifth, because a contact forgotten on purpose is
      ordinary and a station re-adverts by itself.
      **The check nearly shipped as dead code.** It lived inline in the connect path
      and every test passed with it removed -- the comparison and the dialog were both
      covered, and nothing noticed that nothing called them. It is
      `ModeProfiles.recordNormal` now, so the call itself is asserted.
      Untested on a radio; AUDIT.md says how to stage it.

- [ ] **"the channels was not set"** in `ModeSwitchDialog.vue`. A mode switch
      reports its failures as `${what} was not set`, and `what` is sometimes plural.
      The disconnect dialog fronts the failure instead -- "Could not set the
      channels: ..." -- which reads correctly either way; the switch dialog was left
      alone because its wording is asserted in tests that are about the switch, not
      about grammar. Same family as the `(s)` hedging below.
- [ ] **"1 contact(s)"** -- six warning strings hedge the plural with `(s)` while the
      same files pluralise properly elsewhere.
- [ ] **The repeater picker says "most recently heard first"** and pins favourites
      above that.

## Cannot be tested on the bench

- [ ] The **charge badge's amber and red stages** need a radio actually that flat.
      The old single threshold passed at 16% on 29 Sep; under the three stages the
      same 16% should read amber, so that reading is now a prediction to check
      rather than a pass. Amber has never been seen on hardware at all.
- [ ] **A repeater that answers discovery but not ping.**
- [ ] The **375px phone items**: Chrome will not be dragged below about 500px and
      `resize_window` does nothing, so these need the real device.
- [ ] The crib sheet's **no-split-across-pages** check needs a form longer than one
      page, and no single form is.
