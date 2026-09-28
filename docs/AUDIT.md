# Full audit

Run `npm run audit` first, then work through the hardware checklist below.

The script covers what a machine can check. The checklist covers what it cannot, and
that is the half that has found every real fault so far: a request frame missing its
command byte, a run that kept transmitting after its tab closed, a disconnected radio
reported as packet loss, a duration estimate four times out. None of those failed a
test or a build at the time.

## Why drift matters here

This fork depends on facts about other people's code, and those facts can change
without anything here breaking loudly.

`meshcore.js` does not implement repeater discovery, so this app writes the request
frame and parses the reply itself. Command `55` and push code `0x8E` are hard coded.
If the firmware renumbers them, discovery will report **"No repeater answered"** —
which is a legitimate result, so it reads as an answer rather than a fault. The script
checks those constants against the firmware source for exactly that reason.

It also warns if the library starts implementing control data, because at that point
the hand written frames should be deleted rather than maintained.

## What the script checks

| Group | Checks |
| ----- | ------ |
| Tests and build | six node suites, the component suites, a production build |
| meshcore.js | installed version, a newer release, `AdvType.Repeater`, whether control data is still unimplemented |
| Firmware | `CMD_SEND_CONTROL_DATA`, `PUSH_CODE_CONTROL_DATA`, `CMD_GET_CONTACT_BY_KEY`, `PUSH_CODE_CONTACT_DELETED`, `DISCOVER_REQ`, `DISCOVER_RESP`, `MAX_TEXT_LEN`, the path length packing, `OUT_PATH_UNKNOWN`, `MAX_PATH_SIZE` |
| Upstream | commits in `liamcottle/meshcore-web` not in this fork |
| Deployment | the live build matches the local one, the worker is stamped and precaches this build, the tree is clean, everything is pushed |
| Database | every field a schema declares is copied by its insert, and the version keeps pace with its migrations |

Network checks are skipped rather than failed when offline, so an audit in the field
still tells you whether the app works.

## Hardware checklist

Two radios, both powered. Test on the **Emcomm Testing** channel, never Public, and
mark every transmission `DRILL`. Roughly 20 to 30 transmissions in total.

Connect each radio in its own browser tab; a radio can only be held by one page.

### Loading screen

- [ ] **Connecting.** A loading screen covers the app from the moment the link opens. It
      names each step, and counts contacts against the number the radio announced. It
      is gone once the node is read, and the tabs are full when it goes. A second read
      of the contact list says it is checking for dropped contacts. Channels get a bar
      and a count too: slots read of the radio's total, with how many were found.
- [ ] **Disconnect on the loading screen.** Ends the attempt and removes the screen. Nothing
      comes back up as the steps still under way finish.
- [ ] **...and it does so without throwing.** Watch the console while doing it. An
      interrupted connect threw an uncaught `InvalidStateError: The port is closed`
      out of the unguarded `close()` in `Connection.disconnect`, because the port was
      already closing. The screen still cleared and the state still reset, so nothing
      looked wrong -- which is why it went unnoticed through three sessions. Seen
      27 Sep. An operator who changes their mind mid-connect is doing the ordinary
      thing, and it should not raise.
- [ ] **Backup and restore.** Back up current info, Load last backup, and Leave EMCOMM mode
      each cover the Settings page with their own title and step, counting the steps of a
      restore. Each screen goes away when it finishes or fails, and the result is left to
      read.

### Sending

- [ ] **Multi-part report to a channel.** Every part arrives on the other node, in
      order, with `[1/2]` style markers. This is the path most likely to regress,
      because the send loop is where the reliability work happened.
      Passed 28 Sep: a 5Ws that split into five reached node 2 as `[1/5]` to `[5/5]`,
      all present and in order.
      **Pressing Send does not send.** A "Confirm transmission" panel opens first --
      "To Emcomm Testing, 5 transmissions, about 27 s on the air, Cancel / Send now" --
      and on 28 Sep that panel sat unnoticed for two minutes while the receiving node
      was watched for parts that were never going to arrive. Check the sending node
      shows a run in progress before concluding anything about the receiver.
- [ ] **Multi-part report direct to a contact.** Every part reports **Delivered**, and
      they go out one at a time. The device tracks a single outstanding direct message,
      so a part sent before the previous is acknowledged is simply lost.
      Passed 28 Sep: three parts, all three Delivered at node 1 and all three received
      at node 2. The preview states the rule rather than leaving it implied -- "Sent as
      3 separate messages, each one after the previous is acknowledged", against the
      channel's "about 6 seconds apart", so the two paths can be told apart before
      anything goes out.
- [ ] **Split points fall between fields**, not mid field, on a report that splits.
      Passed 28 Sep where it can be: part 1 ended at "1 WHO: Team 2" and part 2 opened
      "2 WHAT:". A single field longer than a packet necessarily carries across parts
      3 to 5, which is not the fault this item is about -- fill several short fields
      rather than one long one if you want to see the rule doing its work.
- [ ] **5Ws Briefing.** Send one to the other node on Emcomm Testing with ACK REQ
      ticked. It arrives numbered 1 WHO to 5 WHY under FM and DTG, ending "ACK REQ".
      Its WHERE button fills in degrees and MGRS, marked "last known" on a radio
      without a live fix.
      Passed 28 Sep, all of it. Node 2 received `[1/2] 5WS BRIEFING / FM / DTG / 1 WHO
      / 2 WHAT / 3 WHEN` and `[2/2] 4 WHERE: 31.9270, -106.4001 (13R CR 67642 33199)
      last known / 5 WHY / ACK REQ`.
      The WHERE button is labelled **Check GPS** and lives on the report form, not the
      settings page -- worth knowing, since the no-GPS item above refers to the same
      words for a different control. **It takes more than nine seconds to answer on a
      radio with no live fix**: read the field too early and it is empty, which looks
      exactly like the button doing nothing.
- [ ] **OPORD.** Send one with only the mission and one other paragraph filled in.
      Every blank paragraph arrives as its tag with a hyphen, such as "1A HAZARDS: -",
      in Army order.
      Passed 28 Sep with only 2 MISSION and 5B SIGNAL filled: node 2 received NR, REF,
      1A, 1B, 1C, 3A, 3B, 3C, 3D, 4A, 4B, 4C and 5A each as its tag and a hyphen, in
      order, across three parts.
      Changing the form clears the chosen channel. Send report then does nothing and
      says "Select a channel to send on" -- correct, but it looks like a dead button
      if the line is not read.

### Position

Worth doing on both radios if they differ, because a guard is only demonstrated by the
case it refuses.

- [ ] **A radio with GPS** fills the field, and the value is a plausible position to
      four decimal places.
      Passed 28 Sep on node 2: 31.926999, -106.400119, and it had drifted from
      31.927018, -106.400171 read earlier in the day, which is the sign of a live fix
      rather than a stored one.
- [ ] **A radio without GPS** offers `Check GPS`, probes again when pressed, and
      **leaves the field empty**. It must never write `0, 0`, which formats perfectly
      well and points at the Gulf of Guinea.
      Not reproducible on the bench as it stands: node 1 has no live fix but does hold
      a hand-entered position, so its fields are correctly filled rather than empty,
      and the settings page offers "Set from live GPS fix" rather than "Check GPS" --
      that wording is the report form's location button. Getting the real case means a
      radio holding no position at all, which on this bench would mean clearing node
      1's, and that is the position the 27 Sep defect was about. Leave it and use a
      third radio, or check the guard in the source.

### Date time groups

- [ ] Exact, approximate (`ABT` prefix) and a range. All three passed 28 Sep on the
      5Ws form: `280013L SEP`, `ABT 280013L SEP`, `302300L SEP-010100L OCT`.
      Read the **composed preview at the foot of the form**, not the input box. The box
      holds the raw DTG and the `ABT` is added when the line is composed, so switching
      the mode and watching the box not change looks like a fault and is not one.
      Nothing has to be sent: the preview updates as the fields are filled.
- [ ] A range crossing a month renders both months, `302300L SEP-010100L OCT`, rather
      than compacting and losing one. Passed 28 Sep, and check the contrast in the same
      pass: a range inside one day compacts to `280100-0500L SEP`, stating the day and
      month once. Getting both of those right is the point -- either rule applied
      everywhere would be wrong half the time.

### Ping and discovery

- [ ] **Discover** finds the repeaters in direct range, with both signal readings. It
      listens for 10 s at the bench settings, not the 30 s it used to, and finds the
      same repeaters it found at 30.
      Passed 28 Sep: one repeater in direct range, `snr_there=0.25dB snr_back=12.00dB
      rssi=-79`, countdown starting at 10 s.
- [ ] **Clicking a discovered repeater** selects it in the picker below, which then
      reads "selected below" against the discovered entry. Passed 28 Sep.
- [ ] **The picker's order is what it says it is.** The help reads "Most recently
      heard first", and favourites are pinned above that: on 28 Sep the top two were
      heard 6 and 14 hours ago, sitting above a block heard "now", and they were
      exactly the two starred repeaters. Pinning favourites is reasonable; saying only
      "most recently heard" while doing something else is what to decide about.
- [ ] **Ping** a repeater that answers traces. Signal readings should be exact
      multiples of 0.25, which is the sign the quarter dB decoding is right.
      Passed 28 Sep, and check the arithmetic while you are there rather than trusting
      the line: a run of 5 with one lost read `5 sent, 20% lost` and averaged only the
      four replies. Read the whole panel, not a filtered view of it -- the `2. timeout`
      line and the `N sent, X% lost` line are the ones that say a reply went missing,
      and dropping them makes a healthy run look like it is hiding loss.
- [ ] **A repeater that answers discovery but not ping** is explained rather than
      looking broken. Not every repeater answers traces.
      The explanation is standing text on the tab and does not wait for the case to
      happen: "discovery proves it hears you, ping additionally needs it to answer
      trace requests." Confirmed present 28 Sep. The pairing itself was not
      reproducible that day -- discovery found one repeater and it answered ping --
      so this still wants a repeater that does one and not the other.

### Failure handling

These are the ones worth the trouble, because each produces a confident wrong answer
rather than an error.

- [ ] **Pull the cable mid ping run.** The run stops and says the radio disconnected.
      The replies already collected are kept and the loss figure covers only what was
      actually sent. It must not fill the remainder with timeouts.
- [ ] **Cancel a run part way.** Statistics cover the replies collected, not the whole
      intended run.
      Passed 28 Sep: cancelled a run of 9 at "Cancel (7 of 9)", and the panel kept
      `7 of 9` with seven lines and `7 sent, 14.29% lost` -- loss over the 7 actually
      sent, not the 9 intended, with 8 and 9 left off rather than filled in as
      timeouts. The averages covered the six replies and came out right by hand.
- [ ] **A finished run keeps its own total.** Run a ping, let it finish, then change
      the Requests box without starting a new run. The results header must still
      describe the run that produced them. Seen 27 Sep: a completed run of 2 read
      "2 of 2", and changing Requests to 5 relabelled it "2 of 5", which reads as
      three lost replies that were never asked for. Selecting a different repeater
      clears the results, so the window is narrow -- but a run's own total is not the
      live setting, and an operator reading a percentage off that header is being
      told something untrue.
      **Still reproduces on `xGe7JBjO`, 28 Sep**, and the reproduction narrows it to
      the header alone: a finished run of 5 relabelled itself "5 of 9" while the reply
      list still showed its five lines and the summary still read "5 sent, 20% lost".
      So only that one header is bound to the live input, and the run's own count is
      already right there in the line beneath it -- which is what a fix should use.
- [ ] **A run where everything times out.** Loss reads 100% and the averages are
      hidden, because `avg snr 0dB` would read as a measurement of a dead link rather
      than the absence of one.
      Passed 28 Sep against a repeater about 250 miles away: `2 of 2`, both timeout,
      `2 sent, 100% lost`, and no avg/min/max lines at all. Picking any repeater
      heard days ago rather than "now" is the easy way to get a dead link on demand,
      and confirms the neighbouring claim that selecting a different repeater clears
      the previous run's results.
- [ ] **A run that partly succeeds.** The loss percentage and averages are taken over
      the real replies only.
      Passed 28 Sep twice over, and both are worth doing by hand. A run of 5 with one
      timeout read `5 sent, 20% lost` and averaged the four replies:
      (2.50+1.50+1.00+2.25)/4 = 1.81, which is what it printed. The cancelled run of 7
      averaged its six: (1.00+2.25+3.25+0.00+3.25+2.25)/6 = 2.00, also as printed. A
      wrong denominator is the failure this item is about, and it is invisible unless
      the sum is actually done.
- [ ] **Switch tabs mid send.** Transmission stops. Nothing should keep talking to the
      radio with no display and no way to cancel. Then go back to Reports: it must say
      the report was interrupted, how many parts went out and to where, and offer to
      send the rest. It used to show an empty form, with nothing to say the stations
      had a report with its end missing.
      Passed 28 Sep on `xGe7JBjO`, recovery included. Left the tab 11 s into a 14 s
      send and came back to "Report interrupted -- The Reports tab was left while 5Ws
      Briefing was sending, so it stopped. 2 of 3 messages were sent to Emcomm Testing.
      Message 3 did not go out", with a "Send remaining 1" button. Node 2 held parts 1
      and 2 at 09:50 and part 3 at 09:51 after that button was pressed, so the report
      was completed rather than merely reported as broken.
      Finish the test by pressing it. Leaving the run half sent leaves the other
      stations holding a report with its end missing, which is the very thing the item
      exists to prevent.
- [ ] **Confirm box, short window.** In a browser window a few hundred pixels tall, fill
      in a report and press Send. The confirmation opens inside the panel. No white band
      appears below the app, and the page as a whole does not scroll. It used to: the
      form's hidden "required" labels were positioned against the page, not the panel.
- [ ] **Resend one part.** After a multi part channel report, Reports shows "Last
      report sent" with a Resend button per part. Resend part 2: the other node gets
      that part again, word for word on the same channel, and no other part.
      Passed 28 Sep, counted rather than eyeballed: node 2 went from five parts, one
      of each, to six with `[2/5]` twice and every other part still once, and the two
      copies of part 2 were byte identical. Counting is what makes "no other part"
      mean anything on a screen already full of near identical lines.
      A single resend raises no confirm panel, unlike the whole report -- reasonable,
      since it is one message rather than 27 s of airtime, but worth knowing so its
      absence is not read as a failed press. The panel above it also explains why the
      button exists: "Channel messages are not acknowledged, so one can be lost
      without this radio knowing."
- [ ] **The gap between parts.** The preview says how many seconds apart the parts
      go, 6 at the bench settings (SF7, 62.5 kHz). The other node's timestamps should
      agree, and all parts should arrive.
      28 Sep: the preview said "550 bytes, 5 packets, ~27 s on air" and "Sent as 5
      separate messages, about 6 seconds apart", and all five arrived. The timestamp
      half cannot be done this way -- the conversation stamps to the minute, and five
      parts 6 s apart land inside one. Consistent with 6 s, not a measurement of it.
      Time it on the sending node, or against a part that crosses a minute boundary.

### Contacts and channels

- [ ] **One list.** The first tab lists contacts and channels together. The filter
      offers All, Companions, Rooms, Repeaters and Channels, and the count beside
      Search follows it.
      Passed 28 Sep, and check the arithmetic rather than that the number merely
      changes: All 206, Companions 51, Rooms 6, Repeaters 147, Channels 2, which sum
      to exactly 206. The label follows too, not just the count -- "Search 51
      Companions", not "51 Contacts and Channels".
- [ ] **Both orders.** A-Z mixes the two kinds alphabetically. Heard Recently puts
      the channel messaged most recently among the contacts by advert time, and a
      channel never used at the end. Favourites stay on top either way.
      Passed 28 Sep for everything the bench can show: A-Z put the seven favourites
      first and alphabetical among themselves, then `#Emcomm-Training` at the head of
      the rest because `#` sorts before letters, with `Emcomm Testing` out at 70 among
      the repeaters. Heard Recently put `Emcomm Testing`, just messaged, at 42 among
      contacts by advert time.
      **The "never used" clause is not testable on this bench** and looks like a fault
      if you assume it is: `#Emcomm-Training` sat at 117 of 206 rather than at the end,
      because it is not unused -- it holds drill traffic from 23 Sep and was placed by
      that, correctly, between contacts heard 3 and 4 days ago. Open the channel and
      look before calling it misfiled. That clause wants a channel added and never
      messaged.
- [ ] **The filter and order options are controls, not just clickable text.** Seen
      28 Sep: every option in that menu -- All, Companions, Rooms, Repeaters,
      Channels, A-Z, Heard Recently -- is a plain `div` with `cursor-pointer` and no
      `role`, no `tabindex` and no accessible name anywhere up the chain. They work
      under a mouse and are unreachable by keyboard, and a screen reader is told
      nothing about them. This is the same family as the two unnamed header buttons,
      which were still unnamed on `xGe7JBjO`, and a step worse: those are at least
      `button` elements. A radiogroup with `role="radio"` and `aria-checked` would say
      what the menu already looks like.
- [ ] **The choice sticks** across leaving the tab and reloading the app.
      The keys are `stations_list_filter` and `stations_list_order`.
      Leaving the tab and returning: passed 28 Sep. **The reload half is inconclusive**,
      not passed: `repeater / a-z` was stored, survived a reload, and then read
      `all / heard-recently` after the operator reconnected the radio. Only
      StationsList's own watchers write those keys and nothing on the connect path
      touches them, so it was most likely changed in the UI in passing -- but it was
      not watched, so it is not a result. Redo it with nobody else touching the app. Leaving the tab
      and returning: passed 28 Sep. The reload half was only proven at the storage
      layer that day -- the choice survived a fresh load of the app, but in a tab that
      was not connected, which shows the connect page rather than the list, and
      reloading a connected tab costs the radio link. Worth finishing during a session
      where a reconnect is cheap.
      Do not read `contacts_list_filter` / `contacts_list_order` while doing this. They
      are left over from the old separate tabs, are deliberately ignored, and keep
      stale values for ever, so they will disagree with what is on screen. That is on
      purpose and has its own unit test: a browser from the old tabs gets the new
      default instead of inheriting an A-Z, companions-only view.

### Report field notes and the crib sheet

- [ ] **Every field has a blue i**, and tapping it opens a note between the label
      and the box. Check a form with dropdowns, such as the 9-line or the flood
      report: the note names every option.
      Passed 28 Sep: the 9-line has nine fields and nine i buttons, line 3's note
      names URGENT, PRIORITY and ROUTINE, line 5's names LITTER and AMBULATORY.
- [ ] **Two notes open at once.** Open line 3 and line 5 of the 9-line; both stay
      open, because an operator is comparing them. Passed 28 Sep.
- [ ] **Nothing of it is transmitted.** Fill a form with notes open and read the
      transmission preview: the bytes are unchanged.
      Passed 28 Sep by string comparison rather than by eye -- the preview was
      identical with both notes open and with both closed, and no note text appeared
      in it. Worth doing this way: the notes are long enough that reading the preview
      twice and judging it the same proves very little.
- [ ] **On a phone with the text turned up**, the note is readable, the i is big
      enough to hit with a glove, and the form does not scroll sideways. The i
      scales with the text on purpose — it is a touch target, unlike the battery
      readout in the header. Measured on a built app at 375px with every note of the
      OPORD, flood and 9-line open at once, at root fonts of 16, 22 and 24px: no
      sideways scroll, nothing past the right edge, the crib sheet's footer pinned in
      view at all three, and the i 28, 39 and 42px square. It was 24px at the default
      font before this measurement, which is small for a gloved hand.
      **This one cannot be driven from here.** `resize_window` reports success and
      leaves the viewport at whatever the window already is -- checked again 28 Sep,
      it claimed 375x812 and `innerWidth` stayed 1920. Anything measured after calling
      it is a measurement of the desktop window. The operator resizes the window by
      hand, or it goes on the phone.
- [ ] **The crib sheet prints** from a computer: the form's fields and notes only,
      without the app's header, tabs or the sheet's own buttons, and a field is not
      split across two pages. Print to PDF is enough to check it. **Printed to PDF
      23 Sep** for one form; worth a glance at that PDF for the two details above.
- [ ] **The crib sheet is reachable with no radio**, from the link under the connect
      buttons, and opens as the index. The operator had to connect a node to reach
      it, which is backwards: printing a binder is a desk job the night before.
      Passed 28 Sep in a tab that never connected: "Report crib sheet -- What goes in
      each field of every report. Print it before you need it." sits under the two
      connect buttons and opens straight to the index.
- [ ] **The index finds a form in two presses.** Open it cold, press the 9-line, and
      its fields appear with nothing else. "The list" goes back without closing.
      Passed 28 Sep: two presses from the connect page reached all nine fields with no
      other form on screen, and "The list" returned to the index with the sheet still
      open.
- [ ] **Both groupings list all 26 forms**, once each: by organization and by type.
      A form missing from one of them is a form nobody can find that way.
      Passed 28 Sep, and this one is worth doing by set rather than by counting on
      screen: 26 in each grouping, 26 unique in each, no duplicates, and the two sets
      differed in neither direction. Counting alone would miss a form listed twice in
      one grouping and absent from the other.
- [ ] **Opened from a form, it shows that form**, not the index — and "The list" is
      still there for an operator who wants a different one.
      Passed 28 Sep from the OPORD form: it opened on OPORD, no other form was
      listed, and "The list" was present.
- [ ] **The booklet prints a page per form**, all 26, each starting on a fresh page.

### Position requests

Needs two radios, each running this app, both on the same channel.

There is **no tick per channel** any more, and has not been since the list went: every
channel and every room is answered, and the only choice a station has is whether its
operator is asked first or it answers automatically. This section used to say to tick
the channel under Position requests in settings, which sent an auditor hunting in
settings for a control that does not exist -- and told them a quiet roll call was the
other station's configuration, which is the wrong place to look during a net.

- [ ] **Once, on the channel.** From node 1, ask node 2 on Emcomm Testing. Node 2 is
      prompted with Send, Send with message and Decline. **Send**: node 1's Positions
      tab shows node 2 in degrees and MGRS, with miles, kilometres and a bearing that
      says *magnetic*, and the declination.
- [ ] **Send with message** opens the channel on node 2, and node 1 shows "Message to
      follow".
- [ ] **Decline** stops node 1's repeats and shows "Declined by" and node 2's callsign.
- [ ] **Current or last known.** Answered from a radio with a live GPS fix, the answer
      is a current fix with its time. From a radio without GPS, it reads "Last known
      position, not a current fix" in amber, and a direct answer's text starts "Last
      known position of".
- [ ] **`0, 0` is refused for the right reason.** Entering `0, 0` is correctly
      rejected -- it is the unset position, not a place anyone is -- but the message
      reads "Not a position: latitude -90 to 90, longitude -180 to 180", and `0, 0`
      satisfies that range. `Geo.isPosition` rejects out-of-range and `0, 0`
      together and `PositionEntry.vue` has one message for both. The operator most
      likely to hit it is one who typed zeros by mistake, and they are told their
      numbers are outside a range they are inside. Seen 27 Sep.
- [ ] **Enter current position.** On the radio without GPS, the prompt offers it.
      Enter a position and use Save to radio and send. The radio's own position
      (This station) changes to it, and the asker sees "Entered by hand at …, not
      GPS". A position past 90 or 180, or 0, 0, is refused.
- [ ] **Update position, with a GPS fix.** On the radio with GPS, press Update
      position on the Positions tab. It says it updated from the GPS, and This
      station shows the new position. No entry fields appear.
- [ ] **Update position, without one.** On the radio without GPS, the same button
      says there is no live fix and opens the entry, prefilled with what the radio
      holds. Save to radio: This station changes, and the radio agrees when read
      back. Cancel leaves it alone.
- [ ] **Enter current position as MGRS.** Switch the entry to MGRS, type a reference,
      and see it shown back in degrees. A shorter reference says how big its square is.
      A reference that cannot be read is refused.
- [ ] **Several stations asking.** Needs three radios. With two asking at once, the
      prompt says one more is waiting; answering brings up the second. A station asking
      again keeps its place and its entry becomes its newest request.
      Check the queue line by its **count**, not its presence: after the second ask the
      prompt gained "Asked 2 times." and still said "1 more station is waiting", which
      is the whole claim. A second slot would have said 2.
- [ ] **What the asker's own list says after asking twice.** The queue above is the
      answering station's side. On the asking station, a second "Once" request makes a
      **second entry**, and once the answer lands against the newer one the older is
      left reading "No answer after 1 request. Its radio answered, but without a
      position: it has no working GPS, or its owner does not share location."
      Every clause of that is true -- the radio's own telemetry answered first, with no
      live fix -- but it sits directly above the same station's freshly received
      position, so the list tells an operator a station has no position immediately
      under its position. Two records for two presses is defensible; the diagnosis
      surviving on the superseded one is what to decide about. Seen 27 Sep.
- [ ] **Roll call on a channel.** From node 1's channel menu, Request Positions (Roll
      Call), once, on Emcomm Testing. Node 2 is prompted "asks everyone". Send:
      node 1's card lists node 2 with distance and magnetic bearing, stays
      Listening, and closes 5 minutes later with its count. Two stations side by
      side read "same location" instead of a distance, which is correct.
- [ ] **Roll call asked again.** Choose "up to N times, every M minutes, for stations
      not yet heard". It offers **3 times every 15 minutes** by default; 5 minutes is
      the shortest allowed and anything under 15 is warned about in amber, so set 2
      and 5 to keep the test short. Node 2 answers the first and stays silent on the
      second, because the second carries a heard list with node 2's key prefix in it
      and a station that finds itself there returns without answering.
      Silence alone does not prove that: a lost datagram looks identical, and the
      stand-down is a silent return with nothing logged or shown. Prove it with the
      **Track** option as a control -- that asks everyone each time -- and confirm node
      2 answers *both* of those asks. Silent under "not yet heard", answering under
      Track, is the pair that shows the heard list did the work.
- [ ] **Roll call answered automatically.** With node 2 answering automatically, its
      answer is held back by a random wait so that answers do not collide, and is not
      sent the instant the roll call lands.
      The wait is `random(0, W)`, where W is the airtime of an answer times 20, clamped
      to between 10 s and 60 s -- so a delay anywhere from about zero up to W is
      correct, and it differs every time. This item used to say "a random 10 to 60 s",
      which read the clamp on W as though it were the delay: a 7 s answer measured on
      the bench looked like a fault and was not one. Ask twice and check the two waits
      differ, rather than timing one against a floor that does not exist.
      The roll call dialog states W for the channel in use ("up to 10 s" on Emcomm
      Testing at SF 7), so read the figure there rather than assuming it.
- [ ] **Roll call with two answerers.** Needs three radios, and is the test the
      stagger exists for: one answerer can never show a collision being avoided.
      Turn auto-answer on in the mode tab of *both* answering nodes first -- it is off
      by default, and with it off you are timing the operator, not the stagger. Run the
      roll call three or four times and record when each answer lands.
      What proves it is not one gap but the **spread and the order**: on 27 Sep the
      gaps were 8.4 s, 1.0 s and 4.5 s, every answer inside the stated 10 s, and the
      order reversed between runs. The order reversing is the part that matters --
      node 2 is on Bluetooth and node 3 on serial, so a fixed gap in a fixed order
      would have been the link speeds rather than the random draw.
      Card timestamps are minute-resolution and cannot time this; watch the Positions
      list change instead. Exclude the "N min old" age line when you do -- it ticks
      over by itself and reads as a fresh answer that never arrived.
- [ ] **Send My Position** from node 1's channel menu: node 2 lists it as "Sent to
      everyone on Emcomm Testing, unasked".
- [ ] **Only one button called Send is reachable at a time.** When the position
      prompt opens over a conversation -- a channel or a room -- the prompt's Send and
      the conversation's own Send are both on screen, both labelled exactly "Send".
      On 27 Sep the wrong one was pressed on the bench, which did nothing and left
      the prompt sitting there looking ignored. Answering a roll call during a net is
      the moment to be sure which button sends what.
      **Happened again on 28 Sep**, answering a roll call in a room, which is the exact
      situation named above: two buttons reading "Send", the conversation's was pressed,
      nothing went out and the prompt sat there. It is not a hypothetical, and it costs
      an answer every time it happens. The prompt's own buttons are Send, Send with
      message, Decline, Not now -- scoping to that group is what makes it unambiguous,
      and is what a person cannot do by eye.
- [ ] **A station that joins mid roll call still gets it.** Seen 28 Sep and worth
      keeping: a room roll call posted at 3:09:08 with its window open to 3:14 was
      pushed to node 3 when it connected at 3:10:03, the operator was prompted, and the
      answer counted on the asking station. It pairs with the expiry half below --
      same roll call, same room, one station inside the window and one outside -- which
      is what isolates the rule rather than testing the room's replay in general.
- [ ] **Roll call in a room.** Both nodes logged in to the test room. The roll call
      and the answer arrive, neither appears in the
      room's conversation on either node, and a stock app in the room would show
      them as text lines. Log node 2 out for more than 10 minutes, then back in: the
      replayed roll call is not put to it again.
      First half passed 28 Sep: node 1's card read "1 answered ... 42 ft (13 m), 115
      degrees magnetic", and both room conversations still showed only their four
      earlier posts. The dialog and the prompt are both room-aware -- "Each post takes
      one of the 32 places the room keeps for members who are away", and the answering
      operator is told "Your answer is posted in the room, so everyone in it sees it".
      **The prompt arrives in about a second in a room**, not the 20-35 s a channel or
      direct request takes, because the room pushes it. Do not use the channel timing
      to decide a room prompt is missing.
      **There is no way to log out of a room**, so the second half cannot be done as
      written -- checked in the source 28 Sep: `RoomLoginBar.vue` only ever logs in,
      nothing calls a logout, and `GlobalState.roomLogins` is a plain in-memory object
      that is never persisted. What the item is really after is the station being away
      from the room for more than ten minutes and then back, so the room replays its
      backlog and an old roll call must not be put to the operator again. Get there by
      disconnecting that node's radio for the ten minutes, then reconnecting and
      logging in, which also needs the password typed.
      Worth deciding separately whether a room ought to offer a logout at all. A
      reload clears the app's record while the room's own session is untouched, so an
      operator who wants to leave a room has nothing to press.
- [ ] **Map links.** On an Android phone, tap a position's degrees and its MGRS
      reference: each opens the map app, or asks which one, with a pin named for the
      station. On an iPhone, Apple Maps. On Windows, OpenStreetMap in a new tab.
      Emulating a phone user agent proves only which link is chosen, never that the
      phone honours it, so the two phone thirds need the phone. It needs the laptop to
      release that radio first as well: only one host can hold a Bluetooth link, so
      connect the phone to the radio and read its own GPS fix from This station.
      **The Windows third needs nobody** and was proven 28 Sep: both the degrees line
      and the MGRS line are links, and clicking one opened
      `openstreetmap.org/?mlat=...&mlon=...#map=16/...` in a new tab at the station's
      position. Note the pin is named on the phone branches only -- `geo:` and
      `maps.apple.com` take a label, OSM's `mlat`/`mlon` marker does not -- so "a pin
      named for the station" is not something to go looking for on the desktop.
      Both links carry the accessible name "Open in maps: This station", which is
      worth knowing while the header's unnamed buttons are still open.
- [ ] **Same location.** Two radios side by side read "Same location as this
      station", with no bearing. Further apart but under a tenth of a mile, the
      distance is in feet and metres.
      Both halves seen 28 Sep: "Same location as this station" when the two fixes
      matched, and "42 ft (13 m), 115 degrees magnetic" when GPS drift put them a few
      metres apart. The second is easier to get than it sounds -- leave the radios
      where they are and wait for the fixes to wander.
- [ ] **Direct.** Ask directly: nothing appears in either conversation, and the answer
      reaches only node 1.
- [ ] **"Once" closes before a person can answer.** Three direct requests on 28 Sep,
      answered by a human at ordinary speed, and every one came back
      "KJ5HBN-EMCOMM answered. The answer came after this app had stopped asking."
      The prompt takes 1-7 s to appear and the operator then has to read it and press
      Send, which is already past the window a single request listens for. Nothing is
      lost -- the position still arrives and is listed -- but the normal, correct case
      reports itself in the language of a near miss, and an operator reading that after
      every ask will conclude something is wrong. The wording is accurate; the question
      is whether "Once" should listen for longer than a person takes to answer.
- [ ] **Repeats.** Every 1 minute for 2 minutes, with nobody answering: **two**
      requests — now and at one minute — then "No answer after 2 requests", and
      nothing afterwards however long you wait. The form says the count before you
      send it, so the check is that the count it promises is the count that goes out.
      Repeats stop when either radio disconnects.
      This item said three until 28 Sep, counting the moment the window expires as a
      request inside it. The app sends at 0 and at 1 minute and treats 2 minutes as
      the end, states "That is 2 requests if nobody answers, the last one about 1
      minute from now" before sending, and then closed with "2 sent ... No answer
      after 2 requests". Promise and behaviour agree, which is what the item is for.
      Pick the target carefully: a companion last heard a month ago and marked No Path
      still answered from its radio within a minute, which is fine here -- a radio
      answering without a position does not close the request -- but it would have
      ruined the test had it carried one.
- [ ] **The interval list is one press**: 1, 5, 15, 30, 60. Anything else is typed
      on the row below it. Seen 28 Sep on the direct request dialog, with the typed
      row beneath as described. It is a native `select` holding exactly those five,
      not a row of chips -- so unlike the contacts filter menu it is keyboard
      reachable and announces itself.
- [ ] **A window shorter than the interval is refused** — every 15 minutes for 5 —
      rather than sending once and calling itself a repeat.
      Passed 28 Sep: Request goes disabled and the line reads "Asking for less time
      than the gap between requests would send one and stop, so give it at least 15
      minutes" -- the reason and the minimum, not just a refusal.
- [ ] **A channel nobody chose** is answered too — that is the point of the
      change. Ask from a channel you never set up for positions and check it is
      still put to the operator.
      Passed 28 Sep on `#Emcomm-Training`, a mode's own channel that has never been
      set up for anything: node 2 was prompted at 15 s, with the channel named and the
      right warning -- "Your answer is seen by every station on the channel running
      this app", rather than the direct request's "only the two of you".
- [ ] **The radio's own answer.** With node 2's app closed and its location sharing on,
      node 1 gets node 2's GPS position from its radio about 30 s after asking. With
      sharing off it gets nothing, and says it could be either reason.
- [ ] **A stock client** on the channel shows nothing for the datagrams. **Proven
      23 Sep** on node 3 running the factory app: a position sent to a channel showed
      nothing, as designed.
- [ ] **A stock client DOES show a direct request**, which is the point of sending it
      as plain text. On node 3 running the factory app, a direct position request from
      node 1 shows as an ordinary message: the readable line first — "Position request
      from KJ5HBN (answering needs Mesh-Emcomm)" — then the code. The operator can
      answer in words and node 1 gets the answer as a message. **Proven 27 Sep** on
      build `d2602d7`: node 3 displayed the line and was answered from.
      It went as text type 1 until then, and showed nothing at all: the sentence had
      been written for exactly that operator and nobody could read it. That was itself
      checked against the alternative by sending an ordinary direct message from the
      same station over the same path, which arrived normally — so it was display, not
      delivery, that failed.
- [ ] **Plain text does not clutter either conversation.** This is what changing the
      type risked, and it is the half still owed. On the **sending** station, node 1's
      conversation with the station it asked shows no request and no code — the
      readable line is for the other end, not for this operator's chat. On a
      **receiving station running this app**, the request does not land in the
      conversation either, and raises no notification; it is answered from the prompt.
      Only a stock station sees it as a message, which is the whole intent. A unit test
      holds both halves ([test/components/position_text_type.test.mjs]), but neither
      has been watched on the radios since the type changed.
      **Both halves now watched, 28 Sep, and both pass.** Node 1 asked node 2 directly
      and each conversation was captured before and after: byte for byte identical on
      both stations, with no request line and no `#mce1` code anywhere. Compare the
      captured strings rather than glancing at the list -- a request landing at the top
      of a long conversation is exactly what an eye skips.
      Do the control in the same pass: an exchange has to have actually happened, or
      "nothing in the conversation" is true for the boring reason. Node 1's Positions
      list carried node 2's answer while both conversations stayed clean.

### Room servers

Needs a room you control. Everything here was wrong at some point and none of it
failed loudly, so walk it rather than assuming. A room three or four hops out is a
worse test than one at zero hops: put the room in direct range and routing stops
being a variable.

- [ ] **The room appears** in the contacts tab with its own icon, and opens a
      conversation titled Room. Passed 28 Sep: the conversation header reads Room /
      Test Room / Room server, and `ContactIcon.vue` carries four separate branches --
      Chat, Repeater, Room and an unknown fallback -- so a room is not drawn as a
      companion. That one is easier to settle in the source than on screen, since the
      list row also holds a favourite star and a menu chevron. Discovery will never find it, whatever the range:
      the room firmware does not implement the control packet at all. It has to
      advert in earshot, or be added from a `meshcore://` link.
- [ ] **Log in.** Watch how long it takes. A room in direct range answers in about
      a second and one several hops out took 10 to 12, against the 8.8 the library
      used to allow. If a login ever reports no answer, listen past the timeout on
      the raw frames before believing it.
- [ ] **The role is read from the reply**, not guessed. A room granting admin says
      "Logged in as admin"; one granting read only says so and the composer refuses
      to post. Both were reported wrong by reading the legacy byte.
      Admin half passed 28 Sep: both nodes read "Logged in as admin" in Test Room.
      The read-only half still wants a room that grants it.
- [ ] **A wrong password looks exactly like silence**, by design: the room source
      says "no response. Client will timeout". The message must not blame the range.
- [ ] **Post.** It should read Delivered, and it should appear in the room on
      another client. Delivered alone is not proof the room accepted it.
      Passed 28 Sep: posted from node 1 at 09:05, Delivered there, and on screen at
      node 2 at 09:06 attributed to Joe-KJ5HBN-HTv3.
- [ ] **Posts keep arriving an hour later.** Log both nodes in, leave them alone for
      an hour with the tabs in the background, then post from node 1. It must reach
      node 2 without anyone logging in again. This is the check that found the worst
      room fault so far: the room stops pushing to a client after three pushes go
      unacknowledged, and **logging in again does not clear it** because a blank
      password takes the ACL path, which resets nothing. A station in that state is
      logged in, can post, and silently hears nothing. The app now sends a
      keep-alive request every two minutes, which is the only thing that resets the
      count.
      **PASSED 28 Sep, 61 minutes.** Posted at 09:05:55, left both tabs in the
      background, posted again at 10:07: node 2 went from four posts to five, received
      the new one at 10:07, and still read "Logged in as admin" with nobody having
      logged in again. Checked at the 55 minute mark too -- both panels still logged
      in, composers not blocked.
      Read the receiving node's conversation only after forcing a render. A background
      tab does not refresh what it shows, so the post can be there and invisible, and
      concluding the room had stopped pushing is exactly the wrong answer to come away
      with from this item.
- [ ] **A post sent while the other node was asleep still arrives.** Put node 2's tab
      in the background or disconnect it briefly, post from node 1, bring node 2
      back. The keep-alive carries the newest post it actually received, so the room
      re-pushes what was missed rather than only what comes next.
- [ ] **What the room panel claims after a reconnect.** Log in, disconnect the
      radio, post from the other node, reconnect. The missed post arrives without
      anyone logging in again -- proven 27 Sep -- but the panel then read
      **"Not logged in"** and showed "Log in to this room before posting" while the
      room was actively pushing to that station. The app cannot know the session
      survived, so claiming otherwise would be its own lie; what is not defensible is
      telling the operator to log in while posts arrive. It matters because the
      instinctive remedy is the one thing that does not work: a re-login on the ACL
      path resets no push-failure count, only a keep-alive does. Decide what the
      panel should say when it does not know, rather than leaving it saying the one
      thing that sends an operator down the wrong path.
- [ ] **A post from somebody else is attributed by name**, not by four bytes of
      mojibake. Rows stored before that fix keep theirs: the bytes were destroyed
      by UTF-8 decoding before they were saved and cannot be recovered, so check a
      post that arrives during the test rather than scrollback.

### The header on a phone

Everything in the header row except the battery badge scales with the root font,
and Android's own font-size setting is what moves it. Test with the phone's text
size turned up, not just at a narrow window.

- [ ] **The mode banner is not covered.** With the font enlarged, the battery and
      station name must stay inside their row. This was reported from the field:
      the battery line painted over the green bar, because the row had a fixed
      4rem height while its two lines of text grew past it.
- [ ] **The station name is readable**, not "Joe-KJ5H...". On a 375px screen with a
      22px root font the name wants 154px; it gets 161px with the app icon hidden,
      which is why the icon is hidden below the `sm` breakpoint.
- [ ] **The charge is readable** in its badge, and turns red at 20% or less.
      Readable half seen 28 Sep. The red half needs a radio actually down at 20%, so
      it waits for a flat battery rather than a bench session -- worth doing once
      deliberately, since a colour that only appears when things are going badly is
      exactly the kind that is never seen until it matters.
- [ ] **Sharing is in the menu** on a phone, since its button folds away there.
      Settings keeps its own button at every width, between the advert menu and the
      close button, and Disconnect is still one press.
- [ ] **A computer is unchanged**: app icon, four buttons, battery badge.
      Passed 28 Sep at desktop width: Mesh-Emcomm, four header buttons, 100% badge.
- [ ] **Every header button says what it is.** Inspect the four. The share button
      carries both `aria-label` and `title`; on 27 Sep the advert menu and the
      settings button carried neither, so a screen reader announces them as "button"
      and voice control has nothing to say. Three icon buttons side by side, one
      labelled, is also an inconsistency rather than a deliberate choice.
      **Unchanged on `xGe7JBjO`, 28 Sep.** Of the four: two icon-only buttons carry
      neither `aria-label` nor `title`, the share button carries both, and Disconnect
      is named only by its visible text. Inspect the attributes rather than the
      rendering -- all four look equally fine on screen, which is the point.
- [ ] **Every dialog's buttons are on screen** without scrolling for them: sharing
      (Close), the first run wizard (Not now, Back, Next) and the mode switch
      (Close, Switch mode). Each is taller than a phone — sharing measured 1370px
      at a 22px root font, and a wizard step holds a whole settings form — so the
      button rows are pinned to the bottom of the scroll. Note that the pinning is
      a Tailwind class, which means it exists only if it was in the source when the
      build ran: check it on a real build, not a dev server.

### Contacts, on a big roster

- [ ] **The whole roster arrives.** Connect the node with the most contacts and
      compare the count with what the radio announces: the amber line above the
      list says when any are missing. Node 2 at 198 contacts came up 57 short,
      twice, because the read gave up on a quiet gap while the radio was still
      mid list and every later pass was refused with `ERR_CODE_BAD_STATE`.
      Passed 28 Sep on a fresh serial connect of node 1: 218 contacts and channels,
      no amber line. Passed again the same day on node 3, which has the biggest roster
      of the three: 289 contacts and channels, no amber line.
- [ ] **A big read does not block the connect for ever.** It should finish within
      a minute or so; the read has a 90 second cap and ends four seconds after the
      frames stop.
      Still owed, and easy to lose: it has to be watched *while* the connect happens.
      Missed twice on 28 Sep, both times through the instrument rather than the app.
      First the operator pressed Connect while nothing was sampling. Second, a timer
      was armed but built on `document.body.innerText`, which needs layout and goes
      stale in a **background tab** -- it reported start and finish in the same second
      for a connect that plainly took longer. Use `textContent`, which needs no layout,
      or foreground the tab. A connect timed at 0.0 s is the instrument failing, not a
      fast radio.

### Channels, and the way home

- [ ] **Every channel the radio holds is in the list**, and the count matches what
      the stock app shows. On the bench node 2's connect read came back with 7
      channels for 8 slots and one channel listed twice, because `meshcore.js`
      resolves a channel read with whatever channel info arrives next: a reply that
      came late was handed to the following slot, and everything after it was one
      out. Nothing warned, and the Normal profile captured from that read was short
      the Emcomm Testing channel it would never have written back.
- [ ] **A short read says so.** If a slot will not answer, an amber line above the
      list says how many slots would not read. Reconnecting is the remedy.
- [ ] **Switching mode with an incomplete backup is refused.** The switch stops
      before writing anything and offers "Switch anyway", because the pre-EMCOMM
      backup is taken once and never again while away from normal mode: whatever
      is missing from it is missing for the whole incident.
- [ ] **Every channel answers, wherever it sits.** Have the other node ask on a
      channel low in the list, on a radio whose channels are not in slots 0, 1,
      2... It must be answered. There is no list of ticked channels any more, and
      that list was the source of three faults in one evening — all of them about
      dragging ticks from slot to slot.
- [ ] **Manual or auto survives a round trip.** Set Auto reply in Normal, switch to
      Emcomm-Training and back: still Auto. It is part of the mode, so setting it
      in one mode does not change another.
      This is the whole of "who answers position requests" now. It used to be a list
      of ticked channels, and that list was the source of three faults in one evening,
      all of them about dragging ticks from slot to slot -- a tick left on the channel
      that used to be in that slot, a tick lost when a channel came home to a different
      one, and the backup's own copy overwriting the right answer with an old one. The
      setting is `{ autoAnswer }` per node, nothing else; `PositionService.settings()`
      is the check if this item ever looks wrong again.
      If the setting does go missing, instrument it rather than guessing: patch
      `Storage.prototype.setItem` in the page to log writes to `position_settings` with
      a stack, then do a round trip. That is how the backup was caught overwriting it
      thirteen seconds after the switch.
      Proven on the bench 27 Sep: set Auto in Normal while the station sat in
      Emcomm-Training, and the live setting did not move and nothing was written --
      a mode that is not in use saves to the app only. Round tripped through Normal
      and back: Normal kept Auto, Training and Live were untouched.
- [ ] **The switch dialog says the mode will answer position requests by itself.**
      Every other thing a switch does was announced and this one was not, until
      27 Sep. It is the most consequential silent change there is: turning it on
      makes the station give its position to anyone who asks with nobody at the
      radio, and an operator who chose "ask me first" was never told a switch had
      undone that. Both directions are said, because a station that quietly stops
      answering during a net looks broken to everyone still asking it, and only
      when it actually changes, like the transmit power line above.
      The unit test for this used to enumerate strings, which is how the setting
      slipped past a test whose own comment promised the next one would fail here.
- [ ] **"1 contact(s)".** Six warning strings hedge the plural with `(s)` --
      `ModeSwitch.js` twice, `SettingsPage.vue` three times, plus `repeater(s)` --
      while the same files pluralise properly elsewhere (`message is`/`messages are`).
      It never misleads, so it is cosmetic, but this app's wording is load-bearing
      everywhere else and a switch dialog is where an operator is reading hardest.
- [ ] **Coming home, the mode's settings are written after the backup, not before.**
      Instrumenting `position_settings` through a switch into Normal shows three
      writes: `apply()` sets the mode's value, `NodeBackup.restore()` overwrites it
      with whatever the backup held about nine seconds later, and `apply()` puts it
      back about five seconds after that. The end state is right and the re-apply is
      deliberate -- it is the same mechanism that makes "a live change still outlasts
      the way home" work. What to be aware of is the few seconds in between, when the
      station is running the backup's answer rather than the mode's: harmless in the
      direction seen on the bench, less so if the backup held Auto and the mode being
      entered wants manual.
- [ ] **Connecting records normal mode.** With the station in normal mode, add a
      channel with the stock app, then connect here: the Normal tab must show it,
      and so must the way home backup. It used to be recorded on the first connect
      only, and node 3 lost a channel to a record three days old.
- [ ] **Connecting in an emcomm mode records nothing.** Connect a station left in
      Emcomm-Training: the Normal tab must still hold its normal channels, not the
      drill's, and the way home backup must be untouched.
- [ ] **A radio left in a mode, on a browser that does not know it.** Put a node
      into Emcomm-Training, then open the app in a private window and connect it.
      It must ask "Is this station in a mode?", naming `#Emcomm-Training`, and
      record nothing until answered. Answering "It is in Emcomm-Training" sets the
      banner and warns that this computer cannot put it back; answering "This is
      its normal setup" records it and does not ask again for that radio.
- [ ] **A normal channel called Emcomm something is not asked about.** The bench
      channel Emcomm Testing must not trigger it — the test is the channel's key,
      not its name.
      Verified in the source 28 Sep, which is worth doing before spending a private
      window on it: `ModeProfiles.modeLeftOn` derives the key for each mode's default
      hashtag channel and compares it against each slot's `secret`, so a channel whose
      name merely contains "emcomm" cannot match. The live run is still owed, because
      what is verified here is the comparison, not that the dialog appears at all.
- [ ] **Connecting is not made slow by it.** Time a connect before and after: the
      profile and the backup share one read of the slots, so it should cost one
      pass over the channels, not three.
- [ ] **A live change still outlasts the way home.** Connect, raise the transmit
      power and save, then round trip through Emcomm-Training. The power must
      still be raised: the backup was taken at connect and holds the old value, so
      the mode's own settings are written again after the restore.
- [ ] **A position entered by hand outlasts the way home.** On the radio without
      GPS, enter a position by hand, then round trip through Emcomm-Training. It
      must still be there: the settings page promises the position "stays as it is
      through every switch", and it is not part of a mode, so nothing rewrites it
      after a restore the way the mode's own settings are rewritten above.
      This failed on the bench on 27 Sep and is fixed. The backup holds the
      position from when it was taken -- at connect, before the incident -- and
      coming home wrote that back, so a position entered during a drill was gone
      afterwards with nothing said. The station that enters a position by hand is
      the one with no GPS, so it lands on exactly the station that cannot get it
      back by itself, and its adverts go out carrying no position at all.
      Check the other direction too: **Load last backup** is an explicit restore
      and still writes the recorded position, but a backup taken before any
      position was set must never clear one set since.
- [ ] **The way home is taken fresh every time.** Switch away from normal, come
      home, add a channel, and switch away again: the new backup must include it.
      Node 3 failed this on 23 Sep — its backup was from three days earlier, made
      by a build that stopped at 16 slots, and the round trip cleared
      `#emcomm-testing` out of slot 16 with nothing to put back. A backup kept for
      ever drifts away from the radio it describes.
- [ ] **A channel the backup never saw still comes home.** With a backup that is
      missing one of normal mode's channels, coming home must write it into a free
      slot and say so in the warnings, rather than leaving the slot empty. Matched
      by key, so a channel the backup restored under another name is not written
      twice.
- [ ] **A channel above slot 16 survives a round trip.** Put one in slot 20 with
      the stock app or from settings, then switch into a mode and back: it must be
      in the backup, in the Normal profile, and back on the radio afterwards.
      Everything used to stop at 16 while the radios report 40, so such a channel
      was invisible to modes and missing from the way home.
- [ ] **Favourites survive a round trip.** Favourite a contact and a channel, round
      trip a mode, and both must still be favourited. **Proven 23 Sep** on node 2:
      the five contacts its backup recorded as favourited were still at the top of
      the list after Emcomm-Training and back, through the 90 day trim and the
      restore. The flag lives on the radio, bit 0 of the contact's flags byte, so
      the backup is the list of what to expect at the top.
- [ ] **A room with a real password.** Every login on the bench has used a blank
      field, which works because both nodes are already in that room's ACL — and
      that ACL path is exactly what makes the keep-alive necessary. Joining a
      passworded room for the first time is untested, and the operator has to type
      the password.
- [ ] **One of each channel after a round trip.** Read the slots before switching
      and again after coming home: the same channels, at the same slot numbers, and
      no channel twice. Node 2's eight channels at slots 0, 1, 4, 7, 8, 10, 11 and
      13 came home as twelve occupied slots, four of them duplicates, because the
      switch wrote the profile's list from slot 0 and the backup restore then wrote
      the same channels back at their recorded slots. The backup owns them now.
- [ ] **Normal mode comes back without the mode's own channel.** Switch into
      Emcomm-Training, then back to Normal: `#Emcomm-Training` must not be in
      Normal's channels, while an emcomm channel the operator made, such as Emcomm
      Testing, must still be carried. The training profile keeps its own channel
      for next time.
- [ ] **The switch preview says what happens to the channels it is not keeping**,
      not just that the slots are cleared: an emcomm-named channel is carried over,
      and anything else is kept in the mode being left, with its key.
- [ ] **The preview names everything that runs on entry.** Switching into
      Emcomm-Live, the dialog must list the radio's clock being set from this
      device, the advert position being taken from a GPS fix, the advert going out
      (flood or zero hop, whichever the mode says), and repeaters being searched
      for. Untick one in the mode tab and its line must go. These four ran on
      every switch with nothing said about them until 26 Sep; the clock was a
      fifth and was still silent until 27 Sep. Message times come from the radio,
      so setting its clock without saying so is not a small thing. If a setting is
      ever added to a profile that acts on entry, it belongs here and in the
      preview.
- [ ] **The history a station already had is still there** after the first
      connect on this build. Channel messages moved to a new schema version, and
      RxDB runs that migration on open: each old row keeps its text and gets an
      empty channel key, so it is still shown by slot. Checked on a radio because
      the migration needs a leader election across tabs, which the test
      environment cannot provide.
- [ ] **The unread badge belongs to the new channel.** After the switch, the
      channel now in a used slot must show its own unread count, not the old
      occupant's. Node 1 showed "#Emcomm-Training 91" — Public's count, on a drill
      channel that had never carried a message — because the list keyed its rows
      by slot and Vue reused the component. Check it in both directions: coming
      home, Public must not inherit the training channel's count either.
- [ ] **A new channel opens empty.** Send a few messages on a channel in Normal,
      switch to Emcomm-Training, and open `#Emcomm-Training`: it must have no
      conversation at all. Reported from the operator's radio, which showed the
      messages of whatever channel had been in that slot — channel history was
      filed under the slot number. It is filed under the channel's key now.
- [ ] **The channel that moved keeps its history.** Come home from the mode and
      open that same channel again: its messages are still there, even if the
      backup put it back in a different slot.
- [ ] **The one list does not call a new channel busy.** In the station list,
      ordered by heard recently, a channel entered for the first time must not sort
      as though it had the old channel's traffic.
- [ ] **The preview counts the messages with no channel key**, once, on a station
      that has history from before this build, and names Delete Message History as
      the way to clear a conversation that is already mixed. After one switch the
      count should be zero for the slots that were read.

### The settings page

- [ ] **It opens on a tab per mode** — Normal, Emcomm-Training, Emcomm-Live —
      coloured as the banner is, with the mode in use marked. All three hold the
      same fields in the same layout. Net defaults, Backups and Commands are
      folded below them. There is no "This radio now" below the tabs: it was
      dismantled into the tabs, and the item further down says so.
- [ ] **Inside a tab the headings fold and all start shut**: Radio, Operator,
      Position, Clock, Companions, Repeaters, Channels, Rooms, Also — nine of
      them, in that order. Every tick is under Also, and none is left beside the
      frequency and power fields.
- [ ] **A station left in a mode, on a computer that has never seen it at home.**
      Connect it on a second machine (or a private window). It asks "Is this
      station in a mode?"; answer that it is. Then, before anything else, open
      **every** mode tab and the setup wizard. The Normal tab must say this
      computer has no record of its normal settings and offer nothing to save,
      and no normal record may appear. A trip home must refuse when there is no
      backup either, and use the backup alone when there is one. The app once
      invented normal from the radio as it stood — which was the drill — and
      saved it, from four different places.
- [ ] **Tapping another mode tab while one is still reading** leaves the tab you
      tapped showing its own mode, never the one you left.

- [ ] **Normal mode has no DRILL tick** under Also; the two emcomm modes do.
- [ ] **Also ends with "On entering this mode"** in every mode: announce, set the
      clock, take a GPS fix, search for repeaters. Change one, Save, and the
      switch preview or the switch itself must follow it.
- [ ] **No two buttons on the settings page read the same.** The net defaults
      strip says "Training defaults" and "Live defaults"; only the mode tabs say
      "Emcomm-Training" and "Emcomm-Live". Pressing one must never be mistaken
      for the other: it edited and saved the wrong mode on the bench.
- [ ] **The net defaults offer transmit power** as either "as high as each radio
      goes" or a named number, and show what the connected radio is at.
- [ ] **Emcomm-Live answers position requests automatically and Emcomm-Training
      asks first**, out of the box. Check on a node whose modes are new.
- [ ] **Entering Emcomm-Training sends a zero hop advert, not a flood**, and its
      repeating flood is off. Entering Emcomm-Live floods, and repeats hourly.
- [ ] **Net defaults are editable with no radio connected.** On the connect
      screen, with nothing plugged in, press **Net defaults**: pick a mode, set
      the frequency and channels, Save. Settings itself needs a database and the
      database is opened per node, so that door does not open without a radio —
      this is the way in, beside the crib sheet. It offers no node name and no transmit power,
      and says why.
- [ ] **A fresh install already has net defaults**: the USA and Canada preset,
      910.525 / 62.5 kHz / SF 7 / CR 5, with the mode's channel and the emcomm
      answers. The strip says "as shipped" until you save your own, then "yours".
- [ ] **A mode tab offers to load one, and does not edit it.** "Load the net
      default for Emcomm-Live" appears only once one is written. Loading keeps
      this station's name and its own maximum power, fills the tab, and writes
      nothing down until Save.
- [ ] **"Start Emcomm-Live again from the app's defaults"** fills the tab, says nothing
      is written until Save, and leaves the saved mode alone until you press it.
      No such button on the Normal tab.
- [ ] **Operator is under Radio and reads the same in every tab.** Type a
      callsign, switch tabs, switch modes: it is still there, and a report form
      prefills with it. There is no Save in that group.
- [ ] **Save says so on the page**, in a green line, and a failure in a red one.
      Nothing blocks the tab: an alert stopped everything until it was dismissed,
      so a slow radio and a finished save looked the same.
- [ ] **Each setting is in one place.** Transmit power, "Answer from the radio
      itself", automatic contacts, the advert intervals and position answering
      appear on the mode tab and nowhere else. There is no "This radio now"
      section below the tabs.
      **Net defaults is not a second copy of any of them.** It holds what the net
      starts from, for loading into whatever radio turns up; a station's own
      setting still lives only on its mode tab. So transmit power appearing both
      on the tab and under Net defaults is correct, and was counted as a failure
      once by reading this item literally.
- [ ] **Position and Clock are folds in the tab**, and act when pressed: write a
      position, take a live GPS fix, sync the clock, all without Save. They read
      the same in every mode tab.
- [ ] **The readouts sit beside their fields**: "The radio is at X of Y dBm now"
      under the transmit power field, and what the repeating adverts have
      actually sent under the interval fields.

- [ ] **A tab keeps what was typed into it.** Change the power on one mode's tab,
      look at another mode, come back: it is still there and the tab says "Not
      saved yet". Save, and that line goes. A page reload starts again from what
      is written down.

- [ ] **There is one Save**, at the top of the page. It saves the tab on show and
      the position together, and there is no second Save inside the tab.
- [ ] **A direct request is visible to a stock station.** Ask a node running the
      stock MeshCore app for its position: it must show "Position request from X
      (answering needs Mesh-Emcomm)" followed by the code, as an ordinary
      message. It showed nothing at all until the type changed on 27 Sep.
- [ ] **A channel request is still invisible to it**, which is deliberate.
- [ ] **A request from a station on an older build still works**, because the
      code identifies it rather than the type.

- [ ] **A request on a channel the station does not hold** says so: "A station
      only hears a channel it holds. Check that they are on #x." The asked
      station shows no prompt at all, which is correct. Without that line the
      only explanation on screen is the radio fallback's, which sends the
      operator off to check a GPS.

- [ ] **A repeat sends what the form promised.** Ask every 1 minute for 2
      minutes with nobody answering: the form says 2 requests and 2 go out, and
      the tab says "No answer after 2 requests". Every 15 minutes for 5 is
      refused, with the arithmetic shown rather than just "invalid".

- [ ] **Logging in to a room says it is waiting**, names the 45 second wait, and
      says a wrong password is answered with silence so the wait is the same
      either way. Pressing Log in again while one is in flight does nothing.

- [ ] **Setup wizard is a row under Commands**, with the RX Log and Reboot, and
      opens the same walkthrough that runs on a first connection.
- [ ] **The wizard writes nothing to the radio**, which its first screen
      promises. On a station that is IN a mode, walk the wizard past that mode's
      step: the radio must not change. It once did, and on a fresh browser the
      step holds defaults this app invented seconds earlier — node 1 came back
      from another computer at the default maximum power instead of its 14 dBm.
- [ ] **A wizard step keeps what was typed into it.** Change the transmit power
      on the Normal step, press Next, then come back with Back: it is still
      there, and the Normal tab in Settings holds it too. The editor's own Save
      is the one at the top of the settings page, which is behind the dialog, so
      Next is what saves; the step says so rather than naming a button that
      cannot be pressed.
- [ ] **The contact groups read the same in all three tabs**, and each says it is
      not part of a mode. Switch modes and look again: the same contacts.
- [ ] **Rename a repeater** from its group, then pull the contact list down: the
      radio holds the new name. Its favourite star and its path must survive the
      rename.
- [ ] **Forget a companion** and answer no: nothing changes. Answer yes on one
      that can be heard again, and it goes; it comes back when it next adverts.
- [ ] **Add a room from a `meshcore://` link** in the Rooms group. It appears in
      Contacts & Channels too, and can be logged into. It must report success:
      the radio can be a moment behind its own acknowledgement, and a single read
      back once reported "the radio accepted that link but the contact did not
      appear" about a room that was already in the list.
- [ ] **Edit a channel** in a mode: rename `#Emcomm-Training` to `#Emcomm` and the
      key shown changes to the one worked out from the new name. On a private
      channel, a key shorter than 32 hex characters must refuse to save.
- [ ] **A mode can be edited from another mode.** In Emcomm-Training, change
      something on the Normal tab and save: the radio must not change. Switch home
      and it takes effect. That is the point of the tabs.
- [ ] **Each setting is in one place.** Transmit power used to be editable in
      three groups, the node name and the radio settings in two each. Look for a
      second copy of any of them. Net defaults does not count: it is the net's
      starting point rather than this station's setting, and has its own items.
- [ ] **Saving the mode in use reaches the radio.** In Normal, change the
      transmit power on the Normal tab and Save. The radio is at the new power
      before any switch — check it on the node itself, not only on screen.
- [ ] **Saving another mode does not.** From Normal, change the Emcomm-Live tab's
      power and Save: the radio is unchanged, and the tab says so.
- [ ] **Channels still wait for a switch.** Add a channel to the mode in use and
      Save: the radio's slots are untouched until the mode is entered.
- [ ] **A live change survives a round trip.** After the first check, switch to
      Emcomm-Training and back: the power must still be the new one.
- [ ] **A live change does not leak into the other modes.** After the above, the
      Emcomm-Live tab's transmit power is whatever it was.
- [ ] **The position is not a mode's.** Set a latitude and longitude under "This
      radio now", switch modes twice: the position is still there.
- [ ] **On a phone with the text turned up**, the group headings and their notes
      read without the page scrolling sideways.

### Settings, and repeating adverts

- [ ] **Open settings on a connected node and look before touching anything.** Name,
      frequency, bandwidth, spreading factor, coding rate, transmit power, latitude
      and longitude must all be filled in with the radio's current values. Empty
      fields are the fault, not the default: saving them writes the emptiness, and
      an empty Name box looks exactly like a node that has no name.
      Passed 28 Sep on node 1: name, 910525, 62500, SF 7, CR 5, 14 dBm, 31.927,
      -106.4001, and no warning.
- [ ] **A failed read says so.** If the radio will not answer, the page must show the
      warning above the fields rather than a form full of blanks, within about ten
      seconds. One way to get a radio that will not answer while still connected:
      reboot node 1 from Settings, whose USB bridge keeps the port open, and open
      settings again at once.
      **Do not use the reboot to get there.** Two attempts on 27 Sep failed: node 1
      over USB either answers again before the page renders, or drops the link
      altogether. **Disconnect the radio and open Settings instead** -- that holds
      the state indefinitely rather than for a fraction of a second, and it is the
      same failure from the page's point of view.
      Proven that way on 27 Sep. The warning reads "Could not read the current
      settings from the radio, so the fields below are empty. Save is off until they
      have loaded", Save is disabled, and the fields are not rendered at all rather
      than sitting there blank and saveable. Two things hold it: a mode tab renders
      "Reading this mode..." **instead of** the form while the profile is null, and
      `canSave` is `hasLoaded && !isLoading && !isSaving`. Both are a line apiece
      that a refactor could drop, which is why the item stays.
- [ ] **A serial radio survives its own reboot.** Reboot node 1 from Settings and wait
      a few seconds. Settings should fill without reconnecting, the console should
      show "Serial line error, reading on" if the reboot garbled the line, and the
      device clock should read in step. Before the fix the app went deaf while still
      saying it was connected, and after a reconnect the clock was minutes out. Not every
      reboot garbles the line; after a clean one the clock is set by the Reboot command
      itself, and any other restart is caught by the minute check within a minute.
- [ ] **A slow read says so too, and Save waits for it.** If the radio is busy, the
      page must say it is reading, with Save greyed out, and then fill in. Empty
      fields and a live Save button is the fault.
- [ ] **An advert updates one contact, not the list.** Over Bluetooth, open settings
      straight after an advert arrives from the other node. It should fill within
      about a second. Before the one-contact fetch it waited out a full re-read of
      the list, twelve seconds on the bench with 161 contacts. The console should not
      print `contacts: ... after 2 passes` for an advert; that line means the full
      read ran, which is only right at connect or as the fallback.
- [ ] **No collisions on Bluetooth.** Over a Bluetooth session that connects, opens
      settings, runs a repeating advert and receives adverts from the other node, the
      browser console must show no `GATT operation already in progress`. Before the
      frame lock it appeared at connect and again whenever an advert arrived while
      something else was talking to the radio. Serial cannot show this one: it is the
      Bluetooth stack that refuses a second write.
- [ ] **Set a zero hop advert interval of 1 minute and watch the other node.** The
      advert should arrive about a minute later, not the moment Apply was pressed.
      Nothing on the air at apply time is the point of the check.
      Passed 28 Sep: saved at 12:27:14, node 3 still read "13 mins ago" at 12:27:29,
      and read "now" at 12:28:19 -- about a minute after the save, nothing at it.
- [ ] **Clear the field and apply.** The schedule reads off, and nothing further
      arrives at the other node.
      Passed 28 Sep: the status went from "Zero hop and Flood running" to "Flood
      running" with the zero hop due line gone, and nothing more reached node 3.
      **Do not read the other node's "heard" label from a background tab.** It does
      not recompute while the tab is hidden: it sat on "now" for four minutes after
      the last advert, which reads as adverts still arriving. Navigating away and back
      forced a render and it said "4 mins ago" at once. Either conclusion drawn from
      the stale label would have been wrong. The sending node's own
      "Zero hop: last sent 12:28:15 AM" line is the better witness, and it agreed with
      the receiver to within the airtime.
- [ ] **A flood interval under an hour raises the caution** and still lets you set it.
      Re-checked on `xGe7JBjO` 28 Sep, after the shared component landed: 30, 45 and
      59 all warn, 60 is silent, and the value is still accepted either way. This is
      the warning that was dead for days while its unit tests passed, so it is worth
      the ten seconds every time the settings screens are touched.
- [ ] **Disconnect, and the timers stop.** They belong to the radio that was
      connected, not to the browser tab.
- [ ] **On a phone, set a schedule and leave the phone alone.** The settings group
      should say the screen is being kept on, and the screen should not time out.
      Adverts should keep arriving at the other node for as long as it stays on.
- [ ] **Then lock it with the power button for ten minutes.** Expect the adverts to stop
      about a minute after locking; that is Android suspending the page, measured and
      documented rather than a fault. On unlocking, the app should still be connected,
      send one advert at once, and carry on without being touched. The status line
      should show the gap: amber and overdue if you look before the catch-up send, and
      the fresh last-sent time after it. Saying "running" with no overdue warning after
      ten silent minutes is the fault.
- [ ] **Reconnect, and the saved schedule starts again** without being re-entered.
      Check it against the right node: the schedule is stored per node, and node 2's
      intervals must not appear on node 1.

### EMCOMM mode

**There is no "convert to EMCOMM mode" any more.** The dialog and the Leave EMCOMM
mode button went at `b73a1fc`, replaced by the three station modes and the banner.
Anything below that asks you to convert, or to leave, has been re-pointed at the
switch that does the same work -- entering Emcomm-Live or Emcomm-Training, and
coming home to Normal. Found on 27 Sep by an auditor looking for a Convert button
that has not existed for days.

The backup plumbing did **not** go with it: the pre-EMCOMM slot is still written,
now by the mode switch and by the "is this station in a mode?" dialog, and it is
still the way home. Those items stand as they were.

Needs a node you can afford to change, and its backup on disk before you start.
Everything here deletes or rewrites something on the radio, so the order matters:
the way home is proven first, and only then is anything removed.

Do this on **Bluetooth** if you have the choice. Serial hides the faults: every
one found so far came from a dropped frame, and the link that drops them is BLE.

- [ ] **Back up, and check what is in it.** Contacts and channels both counted,
      no warnings. Then **Save to file** and open the file: it should carry the
      channel secrets, distinct per channel and not zeroed. A backup that quietly
      holds the fallback channel list looks fine until it is restored.
- [ ] **Restore without switching mode.** Load the backup on a node that has not
      left Normal. Nothing should change, nothing should be removed, and the
      settings should match afterwards. This is the way home, so it is proven
      before anything needs it.
- [ ] **A node without GPS refuses the position** on entering a mode, and says why.
      The switch must report it as a result rather than an error -- on 27 Sep it read
      "the position from the GPS was not set: no live GPS fix, so the position was
      left alone" -- and must never write 0, 0, which formats perfectly well and
      points at the Gulf of Guinea.
- [ ] **Check the radio afterwards, not the screen.** After switching into an
      emcomm mode, read back from the device: name, contact counts by type, clock
      drift, automatic contacts, transmit power, and location sharing. The app
      reporting success is not the same as the device agreeing.
- [ ] **Coming home puts sharing back.** After switching back to Normal, location
      sharing and automatic contacts read as they did before the station left.
- [ ] **Restore from the pre-EMCOMM slot.** Contact counts by type back to what
      they were, name back, no setting different, nothing missing from the backup.
      The banner should go back to Normal mode. The slot is still written on the way
      out, so this is still the way home even though converting is gone.
- [ ] **The other node sees the name come back.** The restore sends one zero hop
      advert when it changes the name, and says so. The other node should list this
      one by its restored name within seconds, not by its EMCOMM name.
- [ ] **The two slots stay apart.** Backing up while in an emcomm mode must not
      overwrite the pre-EMCOMM one. If it does, the way home is gone at the moment
      it is least recoverable.
- [ ] **The way home stays reachable.** Back up while in an emcomm mode, so the
      newest backup is that state, then switch back to Normal. It must use the
      pre-EMCOMM backup, not the newest, and restore the node to it.
- [ ] **The mode banner.** Green and "Normal mode" on a radio this app has just
      met. Tap it: the dialog offers three modes, marks the one in use, and lists
      what a switch would do without writing anything.
- [ ] **Switching to Emcomm-Live.** The bar goes red. On the radio: the name, power
      and radio settings from the Live tab, and #Emcomm in slot 0. Every other slot
      is cleared **except** an emcomm-named channel already on the radio, which is
      carried over and written into the Live profile's own list -- see "Emcomm
      channels travel" below. This item used to say every other slot ends up empty,
      which stopped being true when carrying them over was added: on 27 Sep a switch
      from Training to Live left #Emcomm and Emcomm Testing, and that is correct.
      The other node should no longer hear it on the old channels.
- [ ] **Switching to Emcomm-Training.** The bar goes yellow. Send a report: every
      part arrives at the other node beginning DRILL, and every part still fits.
      Type a message: it arrives with DRILL in front.
- [ ] **Back to Normal mode.** The bar goes green, the radio's own channels and
      contacts come back from the backup, and the other node hears it on the old
      channels again.
- [ ] **Favourites survive a switch.** Star a companion and a repeater, then switch
      to Emcomm-Live. Both are still in Contacts afterwards.
- [ ] **Emcomm channels travel.** With Emcomm Testing on the radio in Normal mode,
      switch to Emcomm-Live. The switch says it carried Emcomm Testing in, the
      channel is still on the radio, and the two nodes can still talk on it. The
      Live tab now lists it.
- [ ] **A channel in no mode is kept, not lost.** While in Normal mode, add a
      channel with a random key from the stock app or the Channels tab. Switch to
      Emcomm-Live: the switch says it kept that channel in Normal mode. Switch
      back: the channel is on the radio again with the same key, and the other node
      can still talk on it.
- [ ] **Sharing a mode.** On the set up node, the QR button beside the gear shows a
      code for Emcomm-Live and another for Emcomm-Training. Scan the Live one with
      a phone: the app opens at an import screen naming the mode and its channels.
      Save it: it says nothing on the radio has changed, and the Live tab in
      Settings shows those channels. The radio is unchanged until the mode is
      entered from the banner. **Proven 27 Sep** on build `d2602d7`, node 1 to node
      2: Live was sent out at SF 9 with an extra channel and arrived as both, the
      import screen read the profile back before saving, node 2 kept its own name
      and stayed in Normal, and its radio stayed at 20 dBm while the profile asked
      for 22. Still untried: reading the QR image with a phone camera -- the link
      went between two tabs -- and the private-key warning below.
- [ ] **Private keys.** With a private channel in the mode, the share screen warns
      that the code carries its key. Untick it: the import says the channel was
      shared without its key and names it.
- [ ] **The tabs match.** Each of the three tabs in Settings shows the same fields.
      Editing a mode that is not in use changes nothing on the radio until it is
      entered.
- [ ] **The radio's emcomm settings.** After entering an emcomm mode, the radio
      reads back with extra acknowledgements on, the position in adverts on, and
      location sharing on. The other node should see this station's position in its
      advert without asking for it.
- [ ] **Favourites survive the trim.** Star a companion before entering an emcomm
      mode. It is still there afterwards, and the switch said how many were kept.
      On 27 Sep a switch into Emcomm-Training dropped 39 contacts and reported it.
      Watch the number kept only because their age could not be read: on the bench
      that was once 19 of 191, about 10%, and if it reads zero on a node with a large
      list, suspect the check rather than the clocks.
- [ ] **The net channel.** #Emcomm appears in the channel list after switching to
      Emcomm-Live, and is answered for position requests like every other channel.
      Put the same channel name in the other node's Live tab: the two must be able
      to message each other on it, which proves both derived the same key from the
      name. Switch in a second time: it must not add the channel twice.
- [ ] **A near miss is caught.** Rename the channel to #emcomm on one node, then
      switch into a mode whose list holds #Emcomm. It must keep the one on the
      radio, name it in the result, and not add a second: the match ignores case.
      Then give a channel the name #Emcomm with a random key and switch: it must
      say the key was not worked out from the name and leave it alone.
- [ ] **Repeating adverts start.** After entering an emcomm mode the advert schedule
      from that mode is running -- the shipped Live default is zero hop every 30 min
      and flood every 60 -- and the other node hears one within the hour. Check the
      schedule against the mode's own tab rather than assuming the default: these are
      per mode and editable.
- [ ] **Coming home removes what the mode added, when asked.** While in an emcomm
      mode, let a contact be added automatically, add a test channel in an empty
      slot, set a repeating advert schedule and set position answering to automatic.
      Switch back to Normal: the second question names that contact and channel. OK:
      both are gone from the radio, the advert schedule is back to what it was, and
      the position settings are back as they were. Repeat with Cancel: they are kept,
      and the station still comes home.
- [ ] **A second switch keeps the way home.** Go from Emcomm-Training straight to
      Emcomm-Live without passing through Normal. Coming home must still restore the
      backup taken before the station first left Normal, not one taken in between.

Expect a conversion to take a couple of minutes over Bluetooth. Removals run at
roughly a third the speed of writes, so the trim is the slow half.

### Offline

The interesting case is the **first** load after a deploy, not the steady state. A new
build gets a new, empty cache, so anything the worker does not precache at install is
missing exactly once — and the app looked fine online while being unable to start at
all offline.

- [ ] After a deploy, load the app **once**, then check the cache holds the whole build
      and not just the shell. `caches.keys()` should show one `meshcore-emcomm-<hash>`
      matching the bundle in `index.html`, and it should contain
      `/assets/index-<hash>.js`, not only `/`, `/index.html`, `/manifest.json`,
      `/icon.png`. A shell without its code comes back from the cache offline and then
      fails to boot.
- [ ] Only one cache is present. Earlier builds are deleted on activate, so a device
      that has seen a dozen deploys holds one copy of the app, not a dozen.
- [ ] **An update that cannot download changes nothing.** With the previous build cached,
      set a tab offline in DevTools, deploy, and reload it. The app must still start, on
      the previous build, and `caches.keys()` must still show that build's cache with its
      files in it. The fault was a new worker taking over with an empty cache and
      deleting the complete one, after which the offline load failed outright.
- [ ] Take the tab offline and reload. The app still starts, routes, and talks to the
      radio. The app is deployed to Cloudflare rather than run locally, so there is no
      server to stop; see below for how to cut the network and how to prove it was cut.
      **Proven 23 Sep** on build `9a9476d`: the operator took their own device offline,
      the app opened, and it worked once a node was connected. Note that this cannot be
      checked from the app's built-in browser pane, which refuses to register a service
      worker at all — the script serves correctly, so it is the pane and not the app.
- [ ] Put the tab back online and reload. It picks up the current build.

## The firmware source is not what arrives

Read this before adding anything that parses a new frame. It cost three fixes that
were declared done, tested, deployed, and still did nothing.

**The companion radio is a layer, not a pipe.** It does not hand a client what the
mesh packet carried. It unpacks, re-packs and reorders on the way through, so a
constant read from the firmware's mesh code is a statement about the mesh, not
about the bytes that reach this app. Two examples, both of which passed review
against the source:

- A room packs a post's type as `(TXT_TYPE_SIGNED_PLAIN << 2) | retry`, so the
  source says 8. The companion strips the retry bits first, so **2** arrives.
  Testing the packed form matched no post ever, and every author stayed mojibake.
- A login reply carries a legacy `is_admin` flag immediately after the push code
  and the real ACL role at index 12. Reading the obvious first byte turned a room
  granting admin into "read only", and the app then refused to post into a room
  that had given it full rights.

**Both failed silently, which is the point.** A post with no recovered author looks
exactly like a post whose frame was never seen. A login reporting read only looks
exactly like a room that really is read only. Nothing errors, so nothing prompts a
second look, and a test written from the same misreading agrees with the code.

**So: capture the frame, then write the test against those bytes.** Attach a raw
`rx` listener, log the frame, and put the real array in the test.
`test/components/signed_posts.test.mjs` has one exactly as the radio sent it, and
`test/components/room_login.test.mjs` has the login reply. A test built from a
captured frame cannot agree with a misreading of the protocol, because it does not
contain one.

**Watch the timing too, not just the layout.** `meshcore.js` allows a login the
device's estimated transmit time plus one second. That estimate is for a
transmission; flood routing adds a random delay at every hop, so the round trip has
little to do with it. A room three hops out answered at 12 seconds against a
deadline of 8.8, and the operator was told nobody answered while they were logged
in. When something times out, listen past the timeout before believing it.

**And check where the data goes after it is parsed.** A field can be correct in the
frame, the schema, the migration, the caller and the view, and still never reach a
row: `Database.Message.insert` copies fields one at a time and drops anything not
named, without complaint. A round trip through the database will not catch that,
because the document stored is the one the insert built. `message_insert.test.mjs`
reads the source and checks the two lists agree.

## Two traps when testing this

Both of these cost a round trip the first time. Neither is a fault in the app.

**Checking whether a tab is offline is what puts it back online.** Chrome's DevTools
offline throttle is owned by whichever debugger attached last, and running any script in
the tab attaches one, so a probe to confirm the tab is cut off silently restores its
network. Set the throttle, reload **without probing first**, and read the evidence
afterwards from the page's own timings:

```js
const nav = performance.getEntriesByType("navigation")[0];
const js  = performance.getEntriesByType("resource").find((r) => /assets\/index-.*\.js$/.test(r.name));
// transferSize 0 on both, and workerStart above zero, is the proof
({ transferred: nav.transferSize + js.transferSize, navWorker: nav.workerStart, jsWorker: js.workerStart });
```

`transferSize` of zero says nothing came over the wire. `workerStart` above zero says the
service worker handled the request, and since the navigation is network first and only
falls back to cache in its `catch`, a zero transfer size there means the network genuinely
failed rather than quietly succeeded. Both readings are needed: either alone is consistent
with an ordinary HTTP cache hit while online.

Cutting the machine's wifi instead is a true test but blinds anything driving the browser
remotely, so the evidence has to be read after the network returns. The loaded page keeps
it, because the timings above survive until that page is navigated away.

**Driving the searchable select needs `mousedown`, not `click`.** Every picker in the app
is a text input pretending to be a select. The options are `div[role="option"]` and the
handler fires on `mousedown`, so that it wins against the input's blur. A plain `.click()`
selects nothing, and the filter text clears on blur, which looks exactly like a successful
pick until the dependent fields fail to render. Dispatch `mousedown`, `mouseup` and
`click`, then confirm the selection took by checking the input's value **and** that the
form fields appeared. Reaching into the component state instead is not available: the
production build strips `__vueParentComponent`.

## When something drifts

**The path length packing changed.** Distances start reading wrong rather than
failing. A path length is two fields in one byte — hop count in the low six bits,
hash size minus one in the top two — and both `src/js/PathInfo.js` and the rx log
unpack it with those exact shifts. Reading it as a plain number is what once
reported a directly reachable station as 128 hops away.

**A firmware constant changed.** Discovery is the thing that breaks. Read the firmware
source, update `Connection.discoverRepeaters`, and update the frame assertions in
`test/components/discovery.test.mjs` so they describe the new truth.

**The library implemented control data.** Delete the hand written frame and use the
library. Keep the tests: they assert behaviour, not implementation.

**Upstream has commits.** Read them before merging. This fork has diverged deliberately
in places, particularly around message rendering, where it preserves newlines that
upstream collapses.
