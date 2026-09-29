# To do

What is wanted but not built, and what is known to be wrong but deliberately left.
Anything *proven* is in [AUDIT.md](AUDIT.md); this is the list of what has not been
done at all.

## Wanted

- [ ] **Dark mode.** Asked for 29 Sep. Worth treating as an emcomm feature rather
      than a preference: this app gets used at night, at a muster point, on a phone
      held at arm's length, and a white screen at 3am ruins night vision and shows up
      across a field. Consider following the system setting by default with an explicit
      override, since an operator on a bright morning wants the opposite of one at
      night. The mode banner, the DRILL marking and the amber warnings all carry
      meaning by colour, so they need checking against a dark background rather than
      inverting with everything else.

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
