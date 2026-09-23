/**
 * What each field of each report means, in the operator's own terms.
 *
 * A placeholder shows an example and a label gives a name; neither says what the
 * field is *for*, and the standard forms are full of words that mean something
 * precise to the agency receiving them and nothing to a ham filling one in for the
 * first time. LITTER and AMBULATORY, precedence, check, HX, accretion. Guessing at
 * a drill is a lesson; guessing at an incident is a wrong ambulance.
 *
 * So every field has a note, reached by a small blue i beside its label. None of
 * it is transmitted: it costs no airtime, and it is plain text in the bundle, so
 * it is there with no signal and no second device.
 *
 * Kept apart from the form definitions on purpose. It is prose, it is the longest
 * thing in the reports code, and it is the part most likely to be revised after a
 * net — while the field definitions are the on-air format and should be dull to
 * read. `ReportForms` attaches these to their fields at load, and a test refuses a
 * field with no note and a note naming a field that no longer exists.
 *
 * House rules for writing one:
 *   - say what goes in the box, not what the form is called
 *   - explain every option of a dropdown, since the options are bare codes
 *   - where a standard sets a threshold, give it and say whose it is
 *   - the receiving agency's protocol wins; say so rather than implying ours does
 *   - stay on what to type. An operator relaying a report is not the one deciding
 *     triage, and this is not the place to suggest otherwise.
 */

const COMMON = {
    // said in several forms, so it reads the same way in all of them
    dtg: "Type it as a date-time group, or use Now to stamp it from this radio's clock. "
        + "Say which zone you mean — L for local, Z for UTC — because a report read an hour late is a report acted on late.",
    position: "Where this is, in whatever form the other station can use: a street address, a landmark, "
        + "a grid square, degrees or MGRS. The button beside the field fills it from the radio's own GPS fix.",
    callsign: "Your callsign, as you would give it on voice. It identifies the station on air and in the log.",
    spotter: "Your callsign, and your spotter number after a slash if the weather service issued you one "
        + "(e.g. K7ABC/1234). It is how the office knows whose eyes these are.",
    comments: "Anything the fields above could not hold. Kept short: every word is airtime, and a long "
        + "report is split into parts that each have to arrive.",
};

const HELP = {

    // ---- General message traffic ----

    ics213: {
        to: "The person the message is for, and their job if you know it — a position gets there when a name "
            + "has gone off shift. This is the addressee, not the station relaying it.",
        from: "Who the message is from: the person whose words these are, not you, unless you wrote it. "
            + "Their position matters for the same reason.",
        subject: "A few words on what this is about, so it can be found and answered later. "
            + "Think of it as the line a busy Ops Chief reads first.",
        datetime: COMMON.dtg,
        message: "The message itself, in plain language. No abbreviations, no ten-codes, no jargon the "
            + "receiving station may not share — this form crosses between agencies who each have their own. "
            + "Write what you were given, and do not improve it.",
        approved_by: "Who authorised sending it, if anyone did. Left empty when the sender is also the "
            + "authority. Agencies use it to show a message was not one operator's own idea.",
    },

    ics213reply: {
        to: "Whoever sent you the message you are answering. Their name and position, as they gave it.",
        from: "Who is answering. Your callsign is enough if the reply is yours to make.",
        ref: "Which message this answers — its subject, or the time it was sent. Without it a reply arriving "
            + "at a busy net is an answer to nobody's question.",
        datetime: COMMON.dtg,
        reply: "The answer, in plain language. Answer what was asked, in the order it was asked, so the two "
            + "messages can be read side by side.",
        by: "The person whose answer this is, and their position. The one on the ground who knows, "
            + "which is often not the operator sending it.",
    },

    ics213rr: {
        item: "What is wanted, described so a logistics section can find one: what it is, and the detail that "
            + "makes it the right one. \"Generator\" fills a warehouse; \"portable generator 5kW\" is an item.",
        qty: "How many. A number, not \"some\" or \"a few\" — it is what gets loaded on a truck.",
        needed_by: "The time it stops being useful. Be honest: everything marked \"now\" means nothing is.",
        deliver_to: "Where it goes, and to whom if that matters. A staging area, a shelter, a checkpoint — "
            + "somewhere a driver can find without calling back.",
        priority: "How this sits against everything else being asked for. ROUTINE — normal handling, it can "
            + "wait its turn. PRIORITY — ahead of routine traffic, needed soon. IMMEDIATE — life safety or the "
            + "operation stops without it. The receiving agency's own definitions govern; if theirs differ, use theirs.",
        requested_by: "Who is asking, by name, position or callsign. Somebody has to be answerable for the "
            + "request, and it should not default to the operator who typed it.",
    },

    radiogram: {
        number: "Your own serial number for this message, counting up from the first one you originate. "
            + "It is how a message is referred to afterwards: \"my number 41\".",
        precedence: "How the message is handled in the traffic system. EMERGENCY — spelled out in full, and "
            + "only for danger to life or property, where no normal means is working. P (Priority) — important "
            + "messages with a time limit, including official disaster traffic. W (Welfare) — an enquiry after "
            + "someone's safety, or their reassurance to family. R (Routine) — everything else, and most of what "
            + "moves in normal times.",
        handling: "Optional instructions to every station that handles it, as an HX code. The common ones ask "
            + "for a report of delivery back to you (HXC) or for the addressee's reply to be originated as a new "
            + "message (HXE). Leave it empty if you were given nothing, and ask the originating station rather "
            + "than inventing one.",
        station: "The callsign of the station that first put this message into the system. Yours if you wrote "
            + "it down from the person who sent it; otherwise whoever did.",
        check: "The number of words in the text, and nothing else — not the address, not the signature. Count "
            + "it, because every station down the line checks it and a mismatch means something was lost. Mixed "
            + "groups like 146.520 count as one word.",
        place: "The town the message came from, not the town you are in. Written as city and state.",
        datetime: COMMON.dtg,
        addressee: "Who it is being delivered to, with everything a stranger needs to reach them: name, full "
            + "address, and a phone number if there is one. This is the part that makes delivery possible, so it "
            + "does not get shortened.",
        text: "The message, 25 words or fewer, plain language. X stands in for a full stop. Keep it to what "
            + "must be said — the limit is there so a hundred of these can move in an evening.",
        signature: "Who the message is from, as the addressee will recognise them. Usually a first name.",
    },

    welfare: {
        type: "Which direction this is going. INQUIRY — someone outside is asking after a person in the "
            + "affected area. REPLY — the answer coming back out.",
        name: "The person being asked about, in full. Nicknames and initials cost hours at the delivery end.",
        address: "Where they are expected to be: an address, a shelter, or the last place anyone knew of. "
            + "It is what makes the enquiry answerable at all.",
        status: "What is known, not what is hoped. SAFE — seen and well. INJURED — hurt; the detail belongs "
            + "with the agency, not on air. EVACUATED — left the area, and say where to if you know. "
            + "NOT FOUND — looked for and not located. UNKNOWN — nobody has checked yet. Leave it empty rather "
            + "than guess.",
        contact: "Who is asking and how they are related, so the reply reaches the right person. "
            + "A name and a relationship is usually enough.",
        message: "Status only, in plain language. No medical detail, no names of other people, nothing you "
            + "would not want read aloud — this traffic is not private and the families hear it repeated.",
    },

    // ---- Nets ----

    checkin: {
        callsign: COMMON.callsign,
        name: "What to call you on air, if it helps. Optional, and usually a first name.",
        location: "Where you are operating from: a grid square, a station number, an address or a landmark. "
            + "Net control uses it to know who covers what. " + COMMON.position,
        station_type: "How you are set up. FIXED — a permanent station at a home or building, on its usual "
            + "antenna. MOBILE — in a vehicle, able to move. PORTABLE — carried in and set up where you are, "
            + "which usually means less antenna and less power.",
        power: "What is keeping you on the air, because it tells net control how long you last. "
            + "COMMERCIAL — mains. GENERATOR — running on fuel, so it has a limit. BATTERY — a limit you should "
            + "know. SOLAR — a limit that depends on the weather.",
        traffic: "Whether you have messages waiting to pass. YES puts you in the queue to be called; NO means "
            + "you are checking in to be counted and available.",
        comments: "Anything net control should know as you check in — when you go off shift, what you cannot "
            + "hear, who you are with. " + COMMON.comments,
    },

    checkout: {
        callsign: COMMON.callsign,
        datetime: COMMON.dtg,
        location: "Where you are leaving from, if it is not obvious. " + COMMON.position,
        comments: "Where you are going, when you are back, or who has taken over from you. Net control is "
            + "keeping a list of who is covered and who is not.",
    },

    netopen: {
        net: "The name this net is known by, so stations joining late know they are in the right place.",
        datetime: COMMON.dtg,
        control: "The callsign running the net. Anything asked of the net goes through them.",
        type: "How the net is being run. DIRECTED — stations transmit only when called; used when traffic is "
            + "heavy. OPEN — stations call each other as needed. EMERGENCY — activated for a real incident, and "
            + "priority traffic comes first. TRAINING — an exercise, and everything on it should be marked as "
            + "one so nobody mistakes it for the real thing.",
        purpose: "Why the net is up, in a few words: the incident, the event, or the exercise. It tells a "
            + "station whether they belong on it.",
        checkin: "How you want stations to check in — by callsign when called, by area, by list. "
            + "Said once at the start saves the next twenty minutes.",
    },

    netsummary: {
        net: "Which net this summarises, named as it was announced. The section keeps these by net, "
            + "so a name that drifts from month to month loses its own history.",
        datetime: COMMON.dtg,
        control: "The callsign of the station that ran the net. It is who the section asks if a figure "
            + "here is queried later.",
        checkins: "How many stations checked in, as a number. It is the figure that ends up in the section's "
            + "monthly report, so count rather than estimate.",
        traffic: "How many formal messages were handled, as a number. Not how many times anybody spoke.",
        next_net: "When the net meets again, if it is a regular one.",
    },

    // ---- Facilities ----

    shelter: {
        name: "The shelter as the public and the agencies know it — usually the building's name.",
        datetime: COMMON.dtg,
        status: "Whether it can take people right now. OPEN — taking arrivals. FULL — open but at capacity, so "
            + "send people elsewhere. STANDBY — staffed or ready but not yet taking arrivals. "
            + "CLOSED — not in use, and say in Needs where people are being sent instead.",
        population: "How many people are in there now, as a number. The one figure the EOC asks for most, and "
            + "the one that changes fastest.",
        capacity: "How many it is rated to hold, if you know it. Together with population it says how much "
            + "room is left without anyone doing arithmetic on air.",
        needs: "What is running short, with numbers: cots, water, formula, blankets, staff. \"Supplies\" gets "
            + "nothing sent; \"cots x20\" gets twenty cots.",
    },

    aidstation: {
        station: "Which station this is, the way the event names it — a number and a mile marker if it has one.",
        datetime: COMMON.dtg,
        status: "OPEN — staffed and serving. STANDBY — set up but not yet serving, or holding for the first "
            + "arrivals. CLOSING — packing up, so participants may arrive to nothing. "
            + "CLOSED — nobody there. Say it plainly, because the course behind you depends on it.",
        through: "How many participants have passed this point, as a number. It is how the event works out "
            + "who is still on the course.",
        onhand: "How many are still at the station right now — resting, waiting, being looked at.",
        water: "Water and food on hand. OK — enough for the participants still to come. LOW — order now, "
            + "there is time. OUT — the station cannot serve, and that is urgent.",
        medical: "What medical attention has happened here. NONE — nothing. MINOR — small things handled on "
            + "the spot. TREATED — someone was properly attended to and carried on or stopped. "
            + "TRANSPORTED — someone left by vehicle, which the event needs to know at once.",
        needs: "What to bring on the next run, with numbers. Ice, water, cups, fuel, a radio that works.",
    },

    // ---- Events ----

    participant: {
        bib: "The number on the participant, which is how the event identifies them. The most important "
            + "field here: a wrong number is a wrong family telephoned.",
        datetime: COMMON.dtg,
        status: "What has happened to them. PASSED — went through, still going. DNF — did not finish, stopped "
            + "of their own accord. WITHDRAWN — pulled by the event or by an official. INJURED — hurt; the "
            + "detail goes to the medical team, not on air. TRANSPORTED — left by vehicle, and say where to. "
            + "REJOINED — back on the course after stopping. NOT SEEN — expected and never arrived, which is "
            + "the one that starts a search.",
        location: "Where this happened, in the event's own terms — station, mile marker, junction. "
            + COMMON.position,
        name: "Their name, if you have it. Helpful at the finish, never a substitute for the number.",
        destination: "Where they were taken or where they are heading, and by whom. It closes the loop for "
            + "whoever is looking for them.",
        comments: "What they said and what you saw. \"Walking, declined transport\" is the kind of thing that "
            + "matters later.",
    },

    sag: {
        datetime: COMMON.dtg,
        location: "Where the vehicle should come, precisely enough to be found on the move: mile marker, side "
            + "of the road, nearest landmark. " + COMMON.position,
        count: "How many people need picking up, as a number. It decides which vehicle is sent.",
        need: "What is actually wanted. RIDE — a person needs a lift. RIDE + BIKE — the bicycle comes too, so "
            + "it needs a rack or a van. MECHANICAL — the rider carries on if the machine is fixed. "
            + "WATER — supplies, not a lift. MEDICAL — attention rather than transport, and say so plainly in "
            + "comments if anyone is hurt.",
        priority: "How soon. ROUTINE — when a vehicle is next going that way. PRIORITY — ahead of other "
            + "pickups. URGENT — someone is not safe where they are: heat, cold, traffic or injury.",
        bib: "The participant's number if you can see it, so the event can tie this to its own records.",
        comments: "What the driver needs to know to find them and what to expect: which side of the road, "
            + "what shade there is, whether they can walk.",
    },

    sweep: {
        datetime: COMMON.dtg,
        point: "Where you are as you report this, in the course's own terms. " + COMMON.position,
        status: "What you are telling the event. LAST PARTICIPANT PASSED — the final one has gone through "
            + "this point. COURSE CLEAR BEHIND ME — nobody is left between here and where you started, which "
            + "is what lets stations behind you stand down. SWEEPING — still working forward. "
            + "STATION CLOSED — this point is packed up and unstaffed.",
        bib: "The last number you saw, so the event can check it against who has finished.",
        comments: "Anything still out there: walkers ahead of you, a cone field left up, a gate to be shut.",
    },

    // ---- Field observation ----

    sitrep: {
        datetime: COMMON.dtg,
        location: "Where this situation is. " + COMMON.position,
        conditions: "What it is like there now: power, water, roads, how many people, what is working and "
            + "what is not. Observed, not inferred — somebody will act on this without seeing it themselves.",
        casualties: "Whether anyone is hurt, and roughly how many and how badly. Write NONE rather than leave "
            + "it empty: silence reads as \"not looked at\" and gets asked again.",
        needs: "What would change the situation, with numbers. Resources, people, or a decision from somebody "
            + "with the authority to make it.",
        next_report: "When you will report again. It stops the net asking, and if you miss it somebody knows "
            + "to come looking.",
    },

    damage: {
        datetime: COMMON.dtg,
        location: "Where the damage is, as precisely as you can — a block number beats a street name. "
            + COMMON.position,
        type: "What is damaged. STRUCTURE — a building. UTILITY — power, water, gas or telephone plant. "
            + "ROAD — the roadway itself or a bridge. FLOOD — water where it should not be. FIRE — burning, or "
            + "burnt. OTHER — say what in the description.",
        severity: "How bad it is, by what you can see. MINOR — usable, cosmetic or small damage. "
            + "MODERATE — damaged and impaired, but standing and repairable. MAJOR — unsafe or unusable. "
            + "DESTROYED — gone, or beyond repair. You are describing, not condemning a building: "
            + "the jurisdiction's own inspectors decide that.",
        casualties: "Whether anyone is hurt at this location. NONE rather than empty, for the same reason as "
            + "in a SITREP.",
        description: "What you can see from where you are. Not what caused it, not whether it is safe to "
            + "enter, not what it will cost. The people who decide those things are relying on your eyes only.",
    },

    route: {
        datetime: COMMON.dtg,
        route: "The road as it is signed: US-70, NM-28, Main St. The name a driver would recognise.",
        segment: "Which part of it, between two points anyone can find — mile markers, junctions or "
            + "crossroads. A whole highway is never the answer.",
        status: "OPEN — passable to ordinary traffic. RESTRICTED — passable with a condition: one lane, high "
            + "clearance, official vehicles, slow. Say which in Cause. CLOSED — not passable, or barricaded.",
        cause: "Why, in a few words. Water, debris, a downed line, a collision, a closure by an authority.",
        detour: "The way round, if you know one that works. A detour nobody has driven is worth saying so.",
    },

    comms: {
        datetime: COMMON.dtg,
        system: "Which system or asset this is about, named the way operators refer to it — a repeater "
            + "callsign and frequency, a node name, a circuit.",
        type: "What kind of thing it is. REPEATER — a voice repeater. MESH NODE — one of these radios or "
            + "another node. SIMPLEX — a direct channel with no infrastructure. INTERNET — a link or a service. "
            + "PHONE — landline or cellular. POWER — the mains or plant that everything else depends on.",
        status: "UP — working normally. DEGRADED — working worse: less coverage, noise, reduced power. "
            + "INTERMITTENT — working sometimes, which is the hardest to plan around, so say it rather than "
            + "rounding to up or down. DOWN — not working.",
        location: "Where the asset is, if that matters — a mountain, a building, a site name. " + COMMON.position,
        restore: "When it is expected back, and who says so. \"Unknown\" is a real and useful answer; a guess "
            + "presented as a time is not.",
        comments: "What is actually wrong and what is being done, as far as you know. Mains lost, no "
            + "generator, technician en route.",
    },

    position: {
        callsign: COMMON.callsign,
        datetime: COMMON.dtg,
        location: "Where you are now. " + COMMON.position,
        station_type: "FIXED — a permanent station. MOBILE — in a vehicle. PORTABLE — set up where you are. "
            + "IN TRANSIT — moving right now, so this position is already old.",
        status: "What you can do from here. OPERATIONAL — fully able to work the net. LIMITED — on the air but "
            + "restricted: power, antenna, noise or your own situation. STANDBY — available but not working, and "
            + "reachable. OFF AIR — not able to be reached, which is worth telling somebody before it happens.",
        power: "What is keeping you up: MAINS, GENERATOR, BATTERY or SOLAR. It is how net control works out how "
            + "long you last.",
        destination: "Where you are heading, if you are moving. It saves being asked, and tells the net where "
            + "your coverage is going.",
    },

    salute: {
        size: "How many and how much: people, vehicles, animals. Count if you can, estimate if you cannot, "
            + "and say which you did.",
        activity: "What they are doing, in plain words. Observed behaviour only — clearing debris, blocking a "
            + "road, standing at a gate. Not why you think they are doing it.",
        location: "Where they are. " + COMMON.position,
        unit: "Who or what they appear to be, if there is anything to go on: markings, uniforms, vehicle "
            + "signage, an agency name. Leave it empty rather than guess at an identity.",
        datetime: "When you observed this, not when you are reporting it. " + COMMON.dtg,
        equipment: "What they have with them that matters: machinery, vehicles, tools. It is often the part "
            + "that tells the receiving agency what is really happening.",
    },

    // ---- Weather ----

    skywarn: {
        spotter: COMMON.spotter,
        datetime: "When you saw it, not when you are sending it. A report timed wrong is a warning drawn on "
            + "the wrong place. " + COMMON.dtg,
        location: "Where the weather is — distance and direction from a town the office will know, "
            + "e.g. 3 mi NW of Anthony. Not simply where you are standing, if they are different. "
            + COMMON.position,
        event: "What you observed. TORNADO — a rotating column in contact with the ground, or debris being "
            + "lifted under a rotating cloud. FUNNEL CLOUD — rotation visible aloft, not reaching the ground. "
            + "WALL CLOUD — a lowered, rotating cloud base at the back of a storm. HAIL — measure it and give "
            + "the size. WIND DAMAGE — what the wind broke, since damage is evidence and a guessed speed is not. "
            + "HIGH WIND — a measured or estimated speed with no damage. FLASH FLOOD — rapid rise of water where "
            + "it does not normally run. HEAVY RAIN — a measured amount and over what time. SNOW — use the "
            + "Winter Weather report instead when you have measurements. DUST STORM — blowing dust cutting "
            + "visibility, which closes roads.",
        measurement: "The number that makes the report usable: hail diameter in inches, wind in mph, rain in "
            + "inches and over how long. The National Weather Service generally treats hail of one inch or more, "
            + "and wind of 58 mph or more, as severe — but report what you have either way and let the office "
            + "judge. Compare hail to a coin or a ball and say which.",
        direction: "Which way it is going, as a compass direction. \"Moving toward\", not where it came from.",
        description: "What you saw, plainly. Rotation, shape, what broke, what moved. Not what you think the "
            + "storm is doing — the radar operator already has a view you do not, and your value is the ground truth.",
    },

    winterwx: {
        spotter: COMMON.spotter,
        datetime: "When you measured, not when you send it. " + COMMON.dtg,
        location: "Where the measurement was taken, as distance and direction from a known town, and the "
            + "elevation if you know it — snow changes fast with height. " + COMMON.position,
        newsnow: "How much has fallen since your last report, and say since when. Measure on a board or a "
            + "flat open surface away from drifts, to the nearest tenth of an inch, and clear it after each "
            + "reading so the next one means something.",
        total: "How much has fallen for the whole storm so far, from when it started. It is not the depth on "
            + "the ground if any has settled or melted — give what you have and say which it is.",
        ice: "How thick the ice is on exposed surfaces, in inches, and on what — branches, wires, a railing. "
            + "A quarter of an inch starts breaking limbs; half an inch starts taking power lines down.",
        visibility: "How far you can see, and why it is short: blowing snow, fog, heavy fall. It is what "
            + "closes a highway, more often than the depth.",
        comments: "Measured or estimated, and say which. An honest estimate is useful; an estimate offered as "
            + "a measurement is not. " + COMMON.comments,
    },

    flood: {
        spotter: COMMON.spotter,
        datetime: "When you observed it. Water moves, so an old time changes the meaning. " + COMMON.dtg,
        location: "Where, precisely: a road and the crossing or creek it is at. " + COMMON.position,
        what: "Pick the one that matches what is in front of you. WATER OVER ROAD — flowing across the "
            + "roadway. STREET FLOODING — standing "
            + "water in a street or a lot. OUT OF BANKS — a creek or river over its banks into ground that is "
            + "normally dry. STRUCTURE FLOODED — water inside a building. ROAD WASHED OUT — the roadway itself "
            + "is damaged or gone, which stays dangerous after the water drops. "
            + "GAUGE READING — you are reporting a river gauge, so put the reading in the next field.",
        depth: "How deep, or what the gauge reads, with the unit. Judge it against something fixed — a kerb, "
            + "a sign post, a doorway — from where you are standing. Never enter the water to find out.",
        trend: "Which way it is going, which matters more than the depth for a warning. RISING, STEADY or "
            + "FALLING, by watching a fixed mark for a few minutes. UNKNOWN if you have not had time to watch, "
            + "and say that rather than guess.",
        closed: "Whether the road is already closed or barricaded. YES — signed or blocked. NO — still open "
            + "with water on it, which is the case that gets people killed. UNKNOWN — you cannot see.",
        comments: "What you can see, not what you infer. Whether vehicles are driving through it, whether "
            + "anyone is stranded, whether the barricade has been moved. " + COMMON.comments,
    },

    // ---- Tasking ----

    fivews: {
        from: "Who is issuing this task, so the team knows whose authority it carries and who to come back to.",
        datetime: "When the task is being issued. " + COMMON.dtg,
        who: "Who is being sent: the team or the people, by callsign. Naming them stops two teams doing the "
            + "same job and nobody doing the next one.",
        what: "The task itself, in plain words, and what you want back. \"Check the shelter and report "
            + "capacity and needs\" can be finished; \"assess the shelter\" cannot.",
        when: "When it should happen or be done by. " + COMMON.dtg,
        where: "Where they are going, precisely enough to arrive without asking: an address, a gate, a "
            + "landmark, degrees or MGRS. " + COMMON.position,
        why: "The reason behind the task. It is the field people leave empty and the one that matters most: a "
            + "team that knows the purpose can adapt when they arrive and find something different, instead of "
            + "carrying out a task that no longer makes sense.",
        ack: "Ask the team to acknowledge, which adds ACK REQ to what is sent. Worth it for anything you need "
            + "to know was received rather than merely transmitted.",
    },

    opord: {
        number: "Your own number for this order, so it can be referred to and amended later.",
        datetime: "When the order is issued. " + COMMON.dtg,
        refs: "What this order relies on that the reader should already have: a map, an annex of the county "
            + "plan, an earlier order. Name them so nobody works from the wrong edition.",
        hazards: "What the situation is doing to you — weather, flooding, fire, road closures, darkness, "
            + "heat. Everything in the environment that shapes what can be attempted.",
        friendly: "Who else is out there and what they are doing: the EOC, other agencies, other teams, "
            + "aircraft. It prevents duplicated effort and tells your people who they may meet.",
        attached: "Who joins you or leaves you for this operation, and when. A team lent to another sector is "
            + "a team you no longer have.",
        mission: "One sentence covering who, what, when, where and why. The one line that gets repeated "
            + "back — if it needs two sentences, it is two missions.",
        intent: "What you want achieved and what \"finished\" looks like. Written so that if communications "
            + "fail entirely, the teams can still act sensibly on their own.",
        concept: "How the operation is meant to unfold, in sequence. Enough that a team can see where their "
            + "part fits; not so much that it becomes their task list.",
        tasks: "What each team is to do, one line each, by team. Specific enough to be finished and reported.",
        coordinating: "What applies to everybody: timings, check-in schedules, boundaries, safety rules, what "
            + "to do on losing contact. The paragraph that stops teams inventing their own answers.",
        supply: "Fuel, water, batteries, food: what there is, where it is, and who fetches it. Batteries end "
            + "more operations than weather does.",
        transport: "What vehicles there are, who they belong to, and how to ask for one.",
        medical: "Where medical help is, how to call for it, and where people are taken. Written down before "
            + "it is needed, not worked out during.",
        command: "Who is in charge, where they are, and who takes over if they cannot be reached. Succession "
            + "in writing is how an operation survives its leader losing signal.",
        signal: "Channels and call signs, with check-in times, and what to do when a channel fails. "
            + "The paragraph the radio operators actually read.",
    },

    // ---- Medical ----

    medevac: {
        line1: "Where the pickup is, precisely enough to be found from the air or the road: a grid reference "
            + "or coordinates, and a description anyone can recognise. " + COMMON.position,
        line2: "The frequency and callsign to reach the people at the pickup site. It is how the crew talks "
            + "to the ground on the way in, so give the one that will be monitored, not the one you are on now.",
        line3: "How many patients at each level of urgency, which is what decides the order everyone is "
            + "collected in. The commonly used levels are URGENT — evacuate within about an hour to save life, "
            + "limb or eyesight; PRIORITY — within about four hours before they deteriorate; ROUTINE — within "
            + "about a day. Count them, e.g. 1 URGENT, 2 PRIORITY. The requesting agency's own definitions "
            + "govern, so use theirs if they differ, and pass on the assessment you were given rather than "
            + "making one.",
        line4: "What the crew has to bring that they would not otherwise carry. NONE — nothing special. "
            + "HOIST — the patient must be lifted out, because there is nowhere to land. EXTRACTION — the "
            + "patient is trapped and cutting or lifting gear is needed to reach them. VENTILATOR — the patient "
            + "cannot breathe unaided.",
        line5: "How the patients have to travel, which decides how the vehicle or aircraft is loaded and how "
            + "many fit. LITTER — cannot walk, must be carried. AMBULATORY — can walk, or be walked with help. "
            + "Count each, e.g. 1 LITTER, 2 AMBULATORY. This is a separate question from how urgent they are "
            + "(line 3): a walking patient can still be the first to go.",
        line6: "What is wrong, as you observed it or as you were told by whoever is with the patient: what "
            + "happened, what is injured, whether they are conscious. Plain words. You are relaying an "
            + "observation, not making a diagnosis.",
        line7: "How the crew will recognise the site. NONE — nothing marked, so line 1 and line 9 carry all "
            + "the weight. PANELS — coloured panels or cloth laid out. SMOKE — smoke, which also shows wind "
            + "direction. SIGNAL — a flare, mirror or other signalling device. LIGHTS — vehicle lights, "
            + "strobes or torches, which is usually the answer at night. OTHER — say what in line 9.",
        line8: "Who the patients are, in the terms the receiving agency uses for counting — for example "
            + "3 CIVILIAN. It affects where they can be taken, not how they are treated.",
        line9: "What the crew needs to know about the ground: what the surface is, the slope, wires, trees, "
            + "poles, traffic, livestock, wind. The field that keeps the people coming to help from becoming "
            + "casualties themselves.",
    },

};

/**
 * The note for one field, or null.
 *
 * Null rather than an empty string, so a field with nothing written for it is
 * visibly missing rather than quietly blank.
 */
class ReportFieldHelp {

    static for(formId, fieldId) {
        return HELP[formId]?.[fieldId] ?? null;
    }

    /** Every note for a form, keyed by field id. Used by the tests and the crib sheet. */
    static forForm(formId) {
        return HELP[formId] ?? {};
    }

    /** The forms this file has notes for, so a test can spot one it does not. */
    static get formIds() {
        return Object.keys(HELP);
    }

}

export default ReportFieldHelp;
export { COMMON };
