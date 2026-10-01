# To do

What is wanted but not built, and what is known to be wrong but deliberately left.
Anything *proven* is in [AUDIT.md](AUDIT.md); this is the list of what has not been
done at all.

## Wanted

- [x] **Dark mode.** Asked for 29 Sep, built the same day. Follows the device by
      default with an explicit override, applied before mount so there is no white
      flash. See the Dark mode section of AUDIT.md for what to check on a real screen.
      **A one-press toggle followed the same night**, in the header beside the other
      buttons -- night mode is something reached for when the light changes, not
      something worth walking into a settings page for. It flips what is *on screen*
      rather than the stored choice, so from "follow the device" at night it goes to
      light rather than setting a "dark" that changes nothing. Below the `sm` breakpoint
      it folds into the menu, the same bargain the sharing button struck: four icon
      buttons wanted 237px of a 375px row and the station name is what loses.

- [x] **A three-stage battery gauge: yellow at 25%, red at 15%.** Asked for 29 Sep,
      built the same day. Grey above a quarter, `text-yellow-700` at 25% or less,
      `text-red-600` at 15% or less, in `Header.vue`.
      **The first build shipped the low stage as amber**, not the yellow this entry
      asked for; the operator caught it on 30 Sep ("use yellow and red not amber")
      and it is yellow from v1.12. Computed rather than eyeballed: on white,
      yellow-600 is 2.94:1 against the 4.5:1 body-sized text needs, and yellow-700 is
      4.92:1. red-600 is 4.83:1 and gray-700 10.31:1, so all three stages pass.
      style.css lifts yellow-700 to `#facc15` in dark mode (10.81:1 against the
      header), a new entry alongside the other mid-tone warnings.
      Colour is not the only signal, and was not before either: the percentage is
      spelled out beside the icon and the fill is proportional. On top of that the
      outline thickens from 1.5 to 2.25 at red, which is what carries in sunlight and
      to the one in twelve men who cannot separate that red from that grey. No word like
      "Low" was added -- the badge is pinned to pixels because 375px of phone ran out
      once already, and text is the one thing here that cannot be afforded. The advice
      lives in the hover title instead.
      Nine mutations, all caught, including both thresholds from either side and the two
      checks in the wrong order, which is what makes 15 red rather than yellow; three
      more for the colour swap (back to amber, a brighter yellow, the dark lift gone).
      **PROVEN on hardware 30 Sep** on node 2, drained 96% to 7% over Bluetooth: the
      low colour at 24%, 16% low (the prediction from the 29 Sep run, confirmed), red
      with the 2.25 outline at 13%. The proof saw the amber shade; only the yellow
      shade itself is still unseen on a radio. AUDIT.md has the trail.

- [x] **A version number, visible at the top.** Asked for 29 Sep, built the same day.
      Shows `v1.1 · 29 Sep 2026` in small grey on the app-name line -- not the
      station-name line, which is the width-critical one on a phone.
      Both halves are injected from the build (`__BUILD__` in vite.config.js, read by
      `src/js/Version.js`), never typed in, so they cannot drift. `npm run audit` reads
      the same stamp back out of the bundle and compares it with package.json.
      Patch versions are not shown: they are what changes when a typo is fixed, and the
      extra characters crowd the station name.
      **Bump `version` in package.json** to make the number move -- minor for a new
      feature or a batch of user-visible fixes, major for a change that breaks a
      station's stored settings. It is bumped on every deploy now, since the operator
      is told the version rather than the commit.
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
      **The charging half is BUILT, 30 Sep, v1.13** ("can you tell when it is charging
      and represent that state with a lightning bolt in the battery icon"). The radio
      cannot tell -- the protocol carries millivolts and nothing about the charger --
      so `Battery.js` infers it from the trend: a rise of 30 mV or more across the
      last half hour of readings is a charger (a drain falls under 1 mV a minute
      and the reading bounces at most 16 mV; a charger lifted node 2 from 5% to 24%
      between one minute and the next, then 1 point a minute through the twenties
      and 2 points in four minutes by 35% -- the five-minute window v1.13 shipped
      with never latched on a reconnect into that slow climb, which the operator
      saw first: "there is no bolt"; v1.14 widened it), held once seen
      because a cell near full stops rising, and let go when the reading drops 24 mV
      below its peak -- the lift leaving with the plug. While charging the badge
      draws a bolt in place of the fill, goes green whatever the level (a rising 20%
      is not a warning), and the title says "charging". Sixteen mutations, all
      caught. **The bolt is PROVEN on node 2, 30 Sep 20:11 (v1.14)**: a replug
      jumped the reading 3598 -> 3737 mV and the badge went to the bolt. The
      charger's lift on this radio is ~140 mV, so a charging percentage reads 17
      points high. The release is proven too: unplugged at 20:14 the reading fell
      139 mV, the bolt went and the stages came back (24%, yellow).
      Also found and fixed on the way: `v-if="GlobalState.batteryPercentage"` hid
      the badge entirely at 0%, the one reading an operator most needs.
      **The cadence half is still open:** once a minute, and whether a stale reading
      can sit for hours (the 28 Sep evidence) is not yet explained.
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

- [ ] **Sweep the whole repo for anything else personal.** **Survey done 29 Sep; one
      decision and one chore left.**
      What was checked and is clean: the shipped bundle, the whole working tree, the
      manifest, the privacy policy, the icon, the branch names. No callsign, no real
      coordinates, no MGRS, no email address anywhere in `dist/`. `.claude/` is
      gitignored, so local paths never leave this machine. `package.json` names Liam
      Cottle as author, which is upstream attribution rather than operator data.
      The only "Joe" in the shipped app is inside the repository URL in an `og:url`
      meta -- the operator's own public GitHub handle, and deliberate.

      **The decision: the example station is still `Joe-NOCALL-HTv3`**, in the README,
      this file, and about 25 test files. The callsign is scrubbed; the first name is
      not. It is arguably already public, since the GitHub account is `JustJoe8675309`,
      which is why this was not changed unilaterally -- renaming it touches 28 files and
      a pile of test assertions, and is only worth doing if the operator wants it.
      "El Paso" survives in three comments explaining a timezone and a magnetic
      declination. City level, not shipped (comments are stripped), and the app's own
      placeholder position is a public landmark in that city anyway.

      **The chore: git history.** Scrubbing the working tree removed nothing from past
      commits. Of 450 commits, **72 add or remove the callsign, 11 the real latitude,
      13 the real longitude and 4 the MGRS**, and some commit messages quote them.
      If the repo is public, that history is public. The rewrite is prepared and
      verified but has to be run by the operator -- it means a force push and it breaks
      every existing clone, so it is a decision rather than a chore. Worth doing before
      the repo gets more attention rather than after.

- [ ] **The connect-time capture re-reads every channel slot.** What is left of a
      bigger finding, most of which is now fixed.
      **The original entry blamed the channel read for the slow "Remembering this
      radio's own settings" step. That was wrong.** Measuring it on 29 Sep showed the
      capture was also calling `Connection.loadContacts()` a second time, so a Bluetooth
      connect read all 260 contacts twice -- up to two minutes each. Worse, on node 2
      the connect had merged its way to 194 of 260 and the capture's second read reached
      only 160 and replaced the better list with it. That half is fixed: the connect now
      passes `{ reread: false }` and the capture uses the list already in hand.
      What remains is the channel half, which is real but smaller: 40 slot reads, each a
      round trip, with three attempts of four seconds for every slot that will not
      answer.
      **The design, ready to build.** `Connection.loadChannels()` already reads every
      slot, normalises `idx`, and records what it could not read in
      `GlobalState.channelsMissing` and `channelSlots` -- which is the same guarantee
      `captureChannels` makes for itself. So the capture can take that read the way it
      now takes the contacts: an option on `capture()`, with the missing count carried
      into `missing.channelSlotsUnreadable` so `captureIsDegraded` still works.
      **The care it needs**, and the reason it was not done in the same sitting as the
      contact fix: this is the way home. `captureChannels` reads for itself so a short
      read cannot be mistaken for an empty slot -- that is how node 3 lost a channel --
      and a channel's key cannot be heard again. Whatever is reused has to carry that
      guarantee intact, and the reuse has to be proven on a Bluetooth link before it is
      trusted, not just in tests.

- [x] **A failed single-contact read starts a whole-list re-read, and they pile up.**
      **Fixed 30 Sep, v1.9**: one full read at a time, keyed to the connection; a later
      caller joins it and a single-contact refresh waits for it rather than asking into
      the middle of it. Seven tests with a radio that yields between frames -- a
      synchronous fake cannot overlap anything -- and five mutations, all caught, the
      last only after a test for an old radio's read finishing late was added.
      The original finding follows.
      Found 30 Sep on node 3, and it affects every node.
      The connect's own contact read was still running when two more full reads began:

          one contact read failed (a different contact came back), reading them all
          contacts: a full read started while 1 other was running
          contacts: a full read started while 2 other was running
          contacts: giving up after 201s, last pass gained 0
          contacts: 311 of 313 after 3 passes

      Three full reads at once. `loadContacts` already warns about this -- its comment
      says two "take turns pass by pass and double the wait" -- and nothing stops it.
      Node 3 converged in three passes and still took **201 seconds**, because the
      passes were sharing the link with two other reads.
      The trigger is a single-contact read getting somebody else's answer back, which
      falls back to re-reading the entire list. That fallback is reasonable on its own
      and unreasonable while a full read is already in flight: it should join the one
      running rather than start another. `contactLoadsRunning` is already counted, so
      the information is there -- what is missing is a single in-flight read that
      callers await instead of a fresh one each.
      This is likely inflating the contact numbers measured on every node, so it is
      worth fixing **before** drawing any more conclusions from read timings.

- [ ] **Node 2 reads short over Bluetooth and the other radios do not.** Measured
      30 Sep. This is a radio to look at, not a transport to work around.

          node 1  serial     215 roster   215  (100%)
          node 2  bluetooth  260 roster   191 (73%) then 228 (88%), 8 and 6 passes
          node 3  bluetooth  313 roster   311 (99.4%), 3 passes

      **Node 3 has a bigger roster over the same transport and converged in three
      passes**, which is what `loadContacts` documents as normal. So it is neither
      Bluetooth nor roster size. Two reads of node 2 also delivered *different*
      subsets -- 10 contacts appeared only in the first, 47 only in the second, union
      238 of 260 -- so the loss is random rather than a fixed truncation, which rules
      out the roster cap that was considered.
      What is left: node 2's firmware build, its BLE stack, its antenna or RF
      environment, or the hardware. A reflash is a reasonable next step **but not until
      its identity is backed up** -- `meshcore-node-backups/` currently holds one
      export from 19 Sep with no node name, no public key and no private key field, so
      node 2's identity is protected nowhere. See [[node-identity-backup]].
      **Correction worth keeping:** this was written up first as "Bluetooth loses
      contacts under burst", in commit messages and here, on the evidence of one radio.
      One control on node 3 overturned it. The fixes that came out of it stand on their
      own -- not reading contacts twice, not letting a short read overwrite a fuller
      record, ending a stalled read rather than a working one -- because none of them
      depended on the cause.

- [x] **Rewrite the contact read: persist, delta, repair by key, reconcile by count.**
      Decided and built 30 Sep, v1.10. The analysis is in [CONTACT-READ.md](CONTACT-READ.md).
      `ContactStore` keeps each radio's list between connects; the next connect asks
      `CMD_GET_CONTACTS` for what changed `since` the newest lastmod it has; a full read
      that comes up short is repaired by `CMD_GET_CONTACT_BY_KEY`, one frame per missing
      contact, because the app now knows *which* ones it did not get. Every outcome the
      delta cannot prove by count falls through to the full read the app has always done,
      so the worst case is today's behaviour plus a few seconds.
      Seventeen tests against a radio that honours `since`, answers by key, and drops
      frames on command; sixteen mutations, all caught. Two of my own tests were worthless
      until tightened -- `byKeyCalls > 0` where the exact count was the point -- and one
      redundant "newest" mark was removed rather than tested, because belt-and-braces
      code hides single mutations.
      **PROVEN on node 2, 30 Sep, three connects in a row over Bluetooth:**
      1. First v1.10 connect, nothing stored: full read, 253 of 260 in 7 passes, saved.
      2. Second: the delta fell through (count changed overnight) to a full read that
         stalled at 259 -- and **the repair by key fetched the missing two by name**:
         `repaired 2 by key, 0 no longer on the radio`, then `260 of 260 after 5 passes`.
         The first complete read that radio has ever produced.
      3. Third, store complete: `contacts: 260 of 260, 2 changed, 1 delta pass` --
         the Contacts row went from empty to Complete in **one second**, against 87 s
         the connect before and 127-208 s over the two days prior.
      Both new paths -- the delta and the repair -- ran on real hardware, on the radio
      that lost 42 contacts two nights earlier, and neither made anything worse.

## Known wrong, left deliberately

These came out of the 27-29 Sep audit and are judgement calls about what the app
should *say*, not defects. See AUDIT.md for the evidence behind each.

- [ ] **Two buttons called Send on screen at once.** The position prompt's Send and a
      conversation's own Send. The wrong one gets pressed -- it happened twice on the
      bench, once to the operator and once to Claude. The prompt's own group is
      Send / Send with message / Decline / Not now, so scoping to that group is what
      would disambiguate.
- [ ] **The room panel says "Not logged in"** after a radio reconnect while the room is
      actively pushing posts, and the instinctive remedy is the one thing that does not
      help.
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
      **Proven on node 1, 29 Sep**: 15 contacts forgotten by hand, the connect asked
      rather than overwriting, and keeping the older record wrote nothing. AUDIT.md has
      the staging, which is the fiddly part.


## Worth knowing before writing a test like these

**A source grep cannot tell code from the prose describing it.** Two tests written on
29 Sep passed with the thing they guarded removed, because the file's own comment
explained the decision and said the words -- `role="menuitem"` and `w-full text-left`.
Both were caught by mutation, not by review. Assert against the rendered element
(`wrapper.classes()`, `wrapper.attributes("role")`) whenever there is one; keep source
inspection for what mounting genuinely cannot see, like a Tailwind breakpoint.

## Cannot be tested on the bench

- [ ] The **charge badge's yellow shade** needs a radio between 16% and 25%. The
      three stages and the red outline were proven on node 2 on 30 Sep (see AUDIT.md),
      but with the amber shade that build carried; the yellow that replaced it the
      same evening is a contrast calculation (4.92:1) until an eye sees it.
- [ ] **A repeater that answers discovery but not ping.**
- [ ] The **375px phone items**: Chrome will not be dragged below about 500px and
      `resize_window` does nothing, so these need the real device.
- [ ] The crib sheet's **no-split-across-pages** check needs a form longer than one
      page, and no single form is.
