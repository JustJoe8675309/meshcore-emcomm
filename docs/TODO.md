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

- [ ] **Disconnect should offer to bring the station home first.** Asked for 29 Sep:
      pressing Disconnect asks whether to put the node back to normal mode or to
      disconnect as it stands.
      This is a real trap rather than a convenience. **The way home lives on the
      computer that holds the backup**, so a node disconnected while still in an emcomm
      mode is left on drill channels and drill settings, and the operator who picks it
      up on another machine gets the "Is this station in a mode?" question and no way
      to put it back. The radio does not know it is in a mode; only this browser does.
      Both answers have to stay easy: disconnecting as-is is correct when the operator
      is handing the radio on mid-incident or swapping to another device, so this must
      be a question and never an automatic switch. Worth saying in the dialog which
      mode it is in and what coming home would change, the way the switch dialog
      already does.
      Note a mode switch takes 40-90 s, so the dialog has to hold the disconnect until
      it finishes rather than racing it.

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
