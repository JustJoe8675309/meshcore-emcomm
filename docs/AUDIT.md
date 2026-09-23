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
- [ ] **Same location.** Two radios side by side read "Same location as this
      station", with no bearing. Further apart but under a tenth of a mile, the
      distance is in feet and metres.
- [ ] **Direct.** Ask directly: nothing appears in either conversation, and the answer
      reaches only node 1.
- [ ] **Repeats.** Every 1 minute until answered, then Up to 3 times every 1 minute
      with node 2 not answering: three requests, then "No answer after 3 requests".
      Repeats stop when either radio disconnects.
- [ ] **A channel not ticked** is not answered.
- [ ] **The radio's own answer.** With node 2's app closed and its location sharing on,
      node 1 gets node 2's GPS position from its radio about 30 s after asking. With
      sharing off it gets nothing, and says it could be either reason.
- [ ] **A stock client** on the channel shows nothing for the datagrams. Sent a direct
      request, it shows the readable line.

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
- [ ] **A position answering choice survives a round trip.** Tick a channel and a
      room under "who answers position requests" while in Normal, switch to
      Emcomm-Training and back, and both must still be ticked. Node 2 lost both
      silently: the tick boxes wrote the live settings only, and the switch wrote
      the mode's own (empty) choice over them.
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
