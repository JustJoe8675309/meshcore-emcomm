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
- [ ] **Backup and restore.** Back up current info, Load last backup, and Leave EMCOMM mode
      each cover the Settings page with their own title and step, counting the steps of a
      restore. Each screen goes away when it finishes or fails, and the result is left to
      read.

### Sending

- [ ] **Multi-part report to a channel.** Every part arrives on the other node, in
      order, with `[1/2]` style markers. This is the path most likely to regress,
      because the send loop is where the reliability work happened.
- [ ] **Multi-part report direct to a contact.** Every part reports **Delivered**, and
      they go out one at a time. The device tracks a single outstanding direct message,
      so a part sent before the previous is acknowledged is simply lost.
- [ ] **Split points fall between fields**, not mid field, on a report that splits.
- [ ] **5Ws Briefing.** Send one to the other node on Emcomm Testing with ACK REQ
      ticked. It arrives numbered 1 WHO to 5 WHY under FM and DTG, ending "ACK REQ".
      Its WHERE button fills in degrees and MGRS, marked "last known" on a radio
      without a live fix.
- [ ] **OPORD.** Send one with only the mission and one other paragraph filled in.
      Every blank paragraph arrives as its tag with a hyphen, such as "1A HAZARDS: -",
      in Army order.

### Position

Worth doing on both radios if they differ, because a guard is only demonstrated by the
case it refuses.

- [ ] **A radio with GPS** fills the field, and the value is a plausible position to
      four decimal places.
- [ ] **A radio without GPS** offers `Check GPS`, probes again when pressed, and
      **leaves the field empty**. It must never write `0, 0`, which formats perfectly
      well and points at the Gulf of Guinea.

### Date time groups

- [ ] Exact, approximate (`ABT` prefix) and a range.
- [ ] A range crossing a month renders both months, `302300L SEP-010100L OCT`, rather
      than compacting and losing one.

### Ping and discovery

- [ ] **Discover** finds the repeaters in direct range, with both signal readings. It
      listens for 10 s at the bench settings, not the 30 s it used to, and finds the
      same repeaters it found at 30.
- [ ] **Clicking a discovered repeater** selects it in the picker below.
- [ ] **Ping** a repeater that answers traces. Signal readings should be exact
      multiples of 0.25, which is the sign the quarter dB decoding is right.
- [ ] **A repeater that answers discovery but not ping** is explained rather than
      looking broken. Not every repeater answers traces.

### Failure handling

These are the ones worth the trouble, because each produces a confident wrong answer
rather than an error.

- [ ] **Pull the cable mid ping run.** The run stops and says the radio disconnected.
      The replies already collected are kept and the loss figure covers only what was
      actually sent. It must not fill the remainder with timeouts.
- [ ] **Cancel a run part way.** Statistics cover the replies collected, not the whole
      intended run.
- [ ] **A run where everything times out.** Loss reads 100% and the averages are
      hidden, because `avg snr 0dB` would read as a measurement of a dead link rather
      than the absence of one.
- [ ] **A run that partly succeeds.** The loss percentage and averages are taken over
      the real replies only.
- [ ] **Switch tabs mid send.** Transmission stops. Nothing should keep talking to the
      radio with no display and no way to cancel. Then go back to Reports: it must say
      the report was interrupted, how many parts went out and to where, and offer to
      send the rest. It used to show an empty form, with nothing to say the stations
      had a report with its end missing.
- [ ] **Confirm box, short window.** In a browser window a few hundred pixels tall, fill
      in a report and press Send. The confirmation opens inside the panel. No white band
      appears below the app, and the page as a whole does not scroll. It used to: the
      form's hidden "required" labels were positioned against the page, not the panel.
- [ ] **Resend one part.** After a multi part channel report, Reports shows "Last
      report sent" with a Resend button per part. Resend part 2: the other node gets
      that part again, word for word on the same channel, and no other part.
- [ ] **The gap between parts.** The preview says how many seconds apart the parts
      go, 6 at the bench settings (SF7, 62.5 kHz). The other node's timestamps should
      agree, and all parts should arrive.

### Contacts and channels

- [ ] **One list.** The first tab lists contacts and channels together. The filter
      offers All, Companions, Rooms, Repeaters and Channels, and the count beside
      Search follows it.
- [ ] **Both orders.** A-Z mixes the two kinds alphabetically. Heard Recently puts
      the channel messaged most recently among the contacts by advert time, and a
      channel never used at the end. Favourites stay on top either way.
- [ ] **The choice sticks** across leaving the tab and reloading the app.

### Report field notes and the crib sheet

- [ ] **Every field has a blue i**, and tapping it opens a note between the label
      and the box. Check a form with dropdowns, such as the 9-line or the flood
      report: the note names every option.
- [ ] **Two notes open at once.** Open line 3 and line 5 of the 9-line; both stay
      open, because an operator is comparing them.
- [ ] **Nothing of it is transmitted.** Fill a form with notes open and read the
      transmission preview: the bytes are unchanged.
- [ ] **On a phone with the text turned up**, the note is readable, the i is big
      enough to hit with a glove, and the form does not scroll sideways. The i
      scales with the text on purpose — it is a touch target, unlike the battery
      readout in the header. Measured on a built app at 375px with every note of the
      OPORD, flood and 9-line open at once, at root fonts of 16, 22 and 24px: no
      sideways scroll, nothing past the right edge, the crib sheet's footer pinned in
      view at all three, and the i 28, 39 and 42px square. It was 24px at the default
      font before this measurement, which is small for a gloved hand.
- [ ] **The crib sheet prints** from a computer: the form's fields and notes only,
      without the app's header, tabs or the sheet's own buttons, and a field is not
      split across two pages. Print to PDF is enough to check it. **Printed to PDF
      23 Sep** for one form; worth a glance at that PDF for the two details above.
- [ ] **The crib sheet is reachable with no radio**, from the link under the connect
      buttons, and opens as the index. The operator had to connect a node to reach
      it, which is backwards: printing a binder is a desk job the night before.
- [ ] **The index finds a form in two presses.** Open it cold, press the 9-line, and
      its fields appear with nothing else. "The list" goes back without closing.
- [ ] **Both groupings list all 26 forms**, once each: by organization and by type.
      A form missing from one of them is a form nobody can find that way.
- [ ] **Opened from a form, it shows that form**, not the index — and "The list" is
      still there for an operator who wants a different one.
- [ ] **The booklet prints a page per form**, all 26, each starting on a fresh page.

### Position requests

Needs two radios, each running this app, on a channel ticked under **Position requests**
in settings on the one being asked.

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
- [ ] **Roll call on a channel.** From node 1's channel menu, Request Positions (Roll
      Call), once, on Emcomm Testing. Node 2, with the channel ticked, is prompted
      "asks everyone". Send: node 1's card lists node 2 with distance and magnetic
      bearing, stays Listening, and closes 5 minutes later with its count.
- [ ] **Roll call asked again.** Up to 2 times every 5 minutes. Node 2 answers the
      first and stays silent on the second, which names it as heard.
- [ ] **Roll call answered automatically.** With node 2 answering automatically, its
      answer comes a random 10 to 60 s after the roll call, not at once.
- [ ] **Send My Position** from node 1's channel menu: node 2 lists it as "Sent to
      everyone on Emcomm Testing, unasked".
- [ ] **Roll call in a room.** Both nodes logged in to the test room, and the room
      ticked on node 2. The roll call and the answer arrive, neither appears in the
      room's conversation on either node, and a stock app in the room would show
      them as text lines. Log node 2 out for more than 10 minutes, then back in: the
      replayed roll call is not put to it again.
- [ ] **Map links.** On an Android phone, tap a position's degrees and its MGRS
      reference: each opens the map app, or asks which one, with a pin named for the
      station. On an iPhone, Apple Maps. On Windows, OpenStreetMap in a new tab.
      Emulating a phone user agent proves only which link is chosen, never that the
      phone honours it, so this one needs the phone. It needs the laptop to release
      that radio first as well: only one host can hold a Bluetooth link, so connect
      the phone to the radio and read its own GPS fix from This station.
- [ ] **Same location.** Two radios side by side read "Same location as this
      station", with no bearing. Further apart but under a tenth of a mile, the
      distance is in feet and metres.
- [ ] **Direct.** Ask directly: nothing appears in either conversation, and the answer
      reaches only node 1.
- [ ] **Repeats.** Every 1 minute for 2 minutes, with node 2 not answering: three
      requests — now, and one at each minute inside the window — then "No answer
      after 3 requests", and nothing afterwards however long you wait. The form
      says "3 requests" before you send it, so check the count it promises is the
      count that goes out. Repeats stop when either radio disconnects.
- [ ] **The interval list is one press**: 1, 5, 15, 30, 60. Anything else is typed
      on the row below it.
- [ ] **A window shorter than the interval is refused** — every 15 minutes for 5 —
      rather than sending once and calling itself a repeat.
- [ ] **A channel nobody chose** is answered too — that is the point of the
      change. Ask from a channel you never set up for positions and check it is
      still put to the operator.
- [ ] **The radio's own answer.** With node 2's app closed and its location sharing on,
      node 1 gets node 2's GPS position from its radio about 30 s after asking. With
      sharing off it gets nothing, and says it could be either reason.
- [ ] **A stock client** on the channel shows nothing for the datagrams. **Proven
      23 Sep** on node 3 running the factory app: a position sent to a channel showed
      nothing, as designed.
- [ ] **A stock client shows nothing for a direct request either**, which is not what
      this checklist used to say. Proven the same evening: the direct request carries a
      readable line but travels as text type 1, and the stock app does not display that
      as a message. Checked against the alternative by sending an ordinary direct
      message from the same station over the same path, which arrived normally — so it
      is displayed, not delivery, that fails. If this is ever changed to text type 0,
      test that it does not then clutter both stations' conversations.

### Room servers

Needs a room you control. Everything here was wrong at some point and none of it
failed loudly, so walk it rather than assuming. A room three or four hops out is a
worse test than one at zero hops: put the room in direct range and routing stops
being a variable.

- [ ] **The room appears** in the contacts tab with its own icon, and opens a
      conversation titled Room. Discovery will never find it, whatever the range:
      the room firmware does not implement the control packet at all. It has to
      advert in earshot, or be added from a `meshcore://` link.
- [ ] **Log in.** Watch how long it takes. A room in direct range answers in about
      a second and one several hops out took 10 to 12, against the 8.8 the library
      used to allow. If a login ever reports no answer, listen past the timeout on
      the raw frames before believing it.
- [ ] **The role is read from the reply**, not guessed. A room granting admin says
      "Logged in as admin"; one granting read only says so and the composer refuses
      to post. Both were reported wrong by reading the legacy byte.
- [ ] **A wrong password looks exactly like silence**, by design: the room source
      says "no response. Client will timeout". The message must not blame the range.
- [ ] **Post.** It should read Delivered, and it should appear in the room on
      another client. Delivered alone is not proof the room accepted it.
- [ ] **Posts keep arriving an hour later.** Log both nodes in, leave them alone for
      an hour with the tabs in the background, then post from node 1. It must reach
      node 2 without anyone logging in again. This is the check that found the worst
      room fault so far: the room stops pushing to a client after three pushes go
      unacknowledged, and **logging in again does not clear it** because a blank
      password takes the ACL path, which resets nothing. A station in that state is
      logged in, can post, and silently hears nothing. The app now sends a
      keep-alive request every two minutes, which is the only thing that resets the
      count.
- [ ] **A post sent while the other node was asleep still arrives.** Put node 2's tab
      in the background or disconnect it briefly, post from node 1, bring node 2
      back. The keep-alive carries the newest post it actually received, so the room
      re-pushes what was missed rather than only what comes next.
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
- [ ] **Sharing is in the menu** on a phone, since its button folds away there.
      Settings keeps its own button at every width, between the advert menu and the
      close button, and Disconnect is still one press.
- [ ] **A computer is unchanged**: app icon, four buttons, battery badge.
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
- [ ] **A big read does not block the connect for ever.** It should finish within
      a minute or so; the read has a 90 second cap and ends four seconds after the
      frames stop.

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
- [ ] **Connecting is not made slow by it.** Time a connect before and after: the
      profile and the backup share one read of the slots, so it should cost one
      pass over the channels, not three.
- [ ] **A live change still outlasts the way home.** Connect, raise the transmit
      power and save, then round trip through Emcomm-Training. The power must
      still be raised: the backup was taken at connect and holds the old value, so
      the mode's own settings are written again after the restore.
- [ ] **The way home is taken fresh every time.** Switch away from normal, come
      home, add a channel, and switch away again: the new backup must include it.
      Node 3 failed this on 23 Sep — its backup was from three days earlier, made
      by a build that stopped at 16 slots, and the round trip cleared
      `#emcomm-testing` out of slot 16 with nothing to put back. A backup kept for
      ever drifts away from the radio it describes.
- [ ] **Who answers position requests survives the way home.** Tick a channel,
      round trip, and check the ticks still match the slots the channels came home
      to — on node 3 the switch wrote slots 7 and 16 and the backup's own settings
      overwrote it with 7 thirteen seconds later, then captured that into the next
      backup, so the mistake carried itself forward. If a mark goes missing,
      instrument it rather than guessing: patch `Storage.prototype.setItem` in the
      page to log writes to `position_settings` with a stack, then do a round trip.
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
      same fields in the same layout. This radio now, Backups and Commands are
      folded below them.
- [ ] **Inside a tab the headings fold and all start shut**: Radio, Operator,
      Companions, Repeaters, Channels, Rooms, Also. Every tick is under Also, and
      none is left beside the frequency and power fields.
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
      second copy of any of them.
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
- [ ] **A failed read says so.** If the radio will not answer, the page must show the
      warning above the fields rather than a form full of blanks, within about ten
      seconds. One way to get a radio that will not answer while still connected:
      reboot node 1 from Settings, whose USB bridge keeps the port open, and open
      settings again at once.
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
- [ ] **Clear the field and apply.** The schedule reads off, and nothing further
      arrives at the other node.
- [ ] **A flood interval under an hour raises the caution** and still lets you set it.
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

Needs a node you can afford to change, and its backup on disk before you start.
Everything here deletes or rewrites something on the radio, so the order matters:
the way home is proven first, and only then is anything removed.

Do this on **Bluetooth** if you have the choice. Serial hides the faults: every
one found so far came from a dropped frame, and the link that drops them is BLE.

- [ ] **Back up, and check what is in it.** Contacts and channels both counted,
      no warnings. Then **Save to file** and open the file: it should carry the
      channel secrets, distinct per channel and not zeroed. A backup that quietly
      holds the fallback channel list looks fine until it is restored.
- [ ] **Restore without converting.** Nothing should change, nothing should be
      removed, and the settings should match afterwards. This is the way home, so
      it is proven before anything needs it.
- [ ] **Read the plan before agreeing to it.** The dialog states what will go, by
      kind, and how many are kept only because their age could not be read. On the
      bench that last number was 19 of 191, about 10%, which is worth noticing: if
      it reads zero on a node with a large list, suspect the check rather than the
      clocks.
- [ ] **Convert.** Watch that the radio row says *No change* when the node is
      already on the right settings. Nothing should be written that would not
      change anything.
- [ ] **A node without GPS refuses the position** and says why. It must never
      write 0, 0, which formats perfectly well and points at the Gulf of Guinea.
- [ ] **Check the radio afterwards, not the screen.** Name, contact counts by
      type, clock drift, automatic contacts (now **on** after a convert), transmit
      power at the maximum, and location sharing **On, anyone** in the EMCOMM group.
      The app reporting success is not the same as the device agreeing.
- [ ] **Leaving puts sharing back.** After Leave EMCOMM mode, location sharing and
      automatic contacts read as they did before converting.
- [ ] **Restore from the pre-EMCOMM slot.** Contact counts by type back to what
      they were, name back, no setting different, nothing missing from the backup.
      The mode badge should go back to saying the node is not in EMCOMM mode.
- [ ] **The other node sees the name come back.** The restore sends one zero hop
      advert when it changes the name, and says so. The other node should list this
      one by its restored name within seconds, not by its EMCOMM name.
- [ ] **The two slots stay apart.** Backing up while converted must not overwrite
      the pre-EMCOMM one. If it does, the way home is gone at the moment it is
      least recoverable.
- [ ] **The way home stays reachable.** Back up while converted, so the newest backup
      is the converted state, then press **Leave EMCOMM mode**. It must offer the
      pre-EMCOMM backup, not the newest, and restore the node to it.
- [ ] **The mode banner.** Green and "Normal mode" on a radio this app has just
      met. Tap it: the dialog offers three modes, marks the one in use, and lists
      what a switch would do without writing anything.
- [ ] **Switching to Emcomm-Live.** The bar goes red. On the radio: the name, power
      and radio settings from the Live tab, #Emcomm in slot 0, and every other
      channel slot empty. The other node should no longer hear it on the old
      channels.
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
      entered from the banner.
- [ ] **Private keys.** With a private channel in the mode, the share screen warns
      that the code carries its key. Untick it: the import says the channel was
      shared without its key and names it.
- [ ] **The tabs match.** Each of the three tabs in Settings shows the same fields.
      Editing a mode that is not in use changes nothing on the radio until it is
      entered.
- [ ] **The radio's emcomm settings.** After converting, the radio reads back with
      extra acknowledgements on, the position in adverts on, and location sharing
      on. The other node should see this station's position in its advert without
      asking for it.
- [ ] **Favourites survive the trim.** Star a companion before converting. It is
      still there afterwards, and the dialog said how many were kept.
- [ ] **The net channel.** #Emcomm appears in the channel list after converting, and
      it is ticked under Position requests. On the other node, convert with the same
      channel name: the two must be able to message each other on it, which proves
      both derived the same key. Convert a second time: it says the channel is
      already there rather than adding it twice.
- [ ] **A near miss is caught.** Rename the channel to #emcomm on one node, then
      convert with #Emcomm. It must keep the one on the radio, name it in the
      result, and not add a second. Then give a channel the name #Emcomm with a
      random key and convert: it must say the key was not worked out from the name
      and leave it alone.
- [ ] **Repeating adverts start.** The settings group shows zero hop every 30 min and
      flood every 60 after converting, and the other node hears one within the hour.
- [ ] **Leaving removes what the mode added, when asked.** While converted, let a
      contact be added automatically, add a test channel in an empty slot, set a
      repeating advert schedule and tick a channel for position requests. Leave: the
      second question names that contact and channel. OK: both are gone from the
      radio, the advert schedule is back to what it was, and the position settings
      are back as they were. Repeat with Cancel: they are kept, and the mode is still
      left.
- [ ] **Converting twice keeps the way home.** Convert again while converted. The
      Leave button still restores the backup from before the first convert.

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
