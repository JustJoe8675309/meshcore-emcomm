/**
 * Report form definitions for emergency communications traffic.
 *
 * Each form renders to a compact plain text message that is sent over a MeshCore
 * channel. Radio airtime is expensive and the firmware caps a message at 160
 * bytes, so tags are kept short and empty optional fields are omitted entirely,
 * unless the form sets keepBlankFields: then a blank field is sent as "TAG: -",
 * so the receiver can see it was left empty on purpose rather than lost.
 *
 * Field types:
 *   text     - single line input
 *   textarea - multi line input
 *   select   - dropdown, requires "options"
 *   dtg      - single line input with a "Now" button, prefilled with the current date time group
 *   check    - a tick box. Ticked, the tag is sent alone on its line ("ACK REQ"); unticked, nothing
 *
 * A text field with offersPosition gets a button that fills in this station's
 * position; with positionWithMgrs as well, the MGRS reference goes beside the
 * degrees, and a stored position is used, marked last known, when there is no
 * live GPS fix.
 */

const ReportForms = [
    {
        id: "ics213",
        name: "ICS-213 General Message",
        description: "General message traffic between stations.",
        // first line of the sent message, so receiving operators can identify the form
        header: "ICS-213",
        fields: [
            {
                id: "to",
                tag: "TO",
                label: "To (name / position)",
                type: "text",
                placeholder: "e.g: J. Smith, Ops Chief",
                required: true,
            },
            {
                id: "from",
                tag: "FM",
                label: "From (name / position)",
                type: "text",
                placeholder: "e.g: R. Jones, Net Control",
                required: true,
            },
            {
                id: "subject",
                tag: "SUBJ",
                label: "Subject",
                type: "text",
                placeholder: "e.g: Shelter status",
                required: true,
            },
            {
                id: "datetime",
                tag: "DTG",
                label: "Date / time",
                type: "dtg",
                required: true,
            },
            {
                id: "message",
                tag: "MSG",
                label: "Message",
                type: "textarea",
                placeholder: "Plain language. Avoid abbreviations the receiving station may not know.",
                required: true,
            },
            {
                id: "approved_by",
                tag: "BY",
                label: "Approved by",
                type: "text",
                placeholder: "e.g: K7ABC",
                required: false,
            },
        ],
    },
    {
        id: "checkin",
        name: "ICS-211 ARES/RACES Check-In",
        description: "Register your station with net control.",
        header: "CHECK-IN",
        fields: [
            {
                id: "callsign",
                tag: "CALL",
                label: "Callsign",
                type: "text",
                placeholder: "e.g: K7ABC",
                required: true,
                // prefilled from the operator callsign set in Settings
                prefillFromCallsign: true,
            },
            {
                id: "name",
                tag: "NAME",
                label: "Operator name",
                type: "text",
                placeholder: "e.g: Pat",
                required: false,
            },
            {
                id: "location",
                tag: "LOC",
                label: "Location / grid square",
                type: "text",
                placeholder: "e.g: DM43 or Station 12",
                required: true,
                // offers a button that fills this in from the radio's own position
                offersPosition: true,
            },
            {
                id: "station_type",
                tag: "STA",
                label: "Station type",
                type: "select",
                required: true,
                options: [
                    "FIXED",
                    "MOBILE",
                    "PORTABLE",
                ],
            },
            {
                id: "power",
                tag: "PWR",
                label: "Power source",
                type: "select",
                required: true,
                options: [
                    "COMMERCIAL",
                    "GENERATOR",
                    "BATTERY",
                    "SOLAR",
                ],
            },
            {
                id: "traffic",
                tag: "TFC",
                label: "Traffic to pass?",
                type: "select",
                required: true,
                options: [
                    "NO",
                    "YES",
                ],
            },
            {
                id: "comments",
                tag: "CMT",
                label: "Comments",
                type: "textarea",
                placeholder: "Optional",
                required: false,
            },
        ],
    },
    {
        id: "sitrep",
        name: "ICS-209 SITREP / Status Report",
        description: "Situation report from the field.",
        header: "SITREP",
        fields: [
            {
                id: "datetime",
                tag: "DTG",
                label: "Date / time",
                type: "dtg",
                required: true,
            },
            {
                id: "location",
                tag: "LOC",
                label: "Location",
                type: "text",
                placeholder: "e.g: Shelter 3, Main St",
                required: true,
                offersPosition: true,
            },
            {
                id: "conditions",
                tag: "COND",
                label: "Conditions",
                type: "textarea",
                placeholder: "e.g: Power out, road passable, 40 evacuees",
                required: true,
            },
            {
                id: "casualties",
                tag: "CAS",
                label: "Casualties",
                type: "text",
                placeholder: "e.g: NONE or 2 minor",
                required: false,
            },
            {
                id: "needs",
                tag: "NEEDS",
                label: "Resources needed",
                type: "textarea",
                placeholder: "e.g: Water, cots x20",
                required: false,
            },
            {
                id: "next_report",
                tag: "NEXT",
                label: "Next report at",
                type: "text",
                placeholder: "e.g: 1800L",
                required: false,
            },
        ],
    },
    {
        id: "ics213rr",
        name: "ICS-213RR Resource Request",
        description: "Request personnel, equipment or supplies.",
        header: "ICS-213RR",
        fields: [
            {
                id: "item",
                tag: "ITEM",
                label: "Requested item",
                type: "text",
                placeholder: "e.g: Portable generator 5kW",
                required: true,
            },
            {
                id: "qty",
                tag: "QTY",
                label: "Quantity",
                type: "text",
                placeholder: "e.g: 2",
                required: true,
            },
            {
                id: "needed_by",
                tag: "BY",
                label: "Needed by",
                type: "text",
                placeholder: "e.g: 1200L 14 JUN",
                required: true,
            },
            {
                id: "deliver_to",
                tag: "DEST",
                label: "Deliver to",
                type: "text",
                placeholder: "e.g: Staging Area B",
                required: true,
            },
            {
                id: "priority",
                tag: "PRI",
                label: "Priority",
                type: "select",
                required: true,
                options: [
                    "ROUTINE",
                    "PRIORITY",
                    "IMMEDIATE",
                ],
            },
            {
                id: "requested_by",
                tag: "REQ",
                label: "Requested by",
                type: "text",
                placeholder: "e.g: K7ABC",
                required: true,
                prefillFromCallsign: true,
            },
        ],
    },
    // ---- Net operations ----

    {
        id: "checkout",
        name: "Net Check-Out",
        description: "Leave the net and release your station.",
        header: "CHECK-OUT",
        fields: [
            { id: "callsign", tag: "CALL", label: "Callsign", type: "text", placeholder: "e.g: K7ABC", required: true, prefillFromCallsign: true },
            { id: "datetime", tag: "DTG", label: "Date / time", type: "dtg", required: true },
            { id: "location", tag: "LOC", label: "Location", type: "text", placeholder: "Optional", required: false, offersPosition: true },
            { id: "comments", tag: "CMT", label: "Comments", type: "text", placeholder: "e.g: Returning to service 0600", required: false },
        ],
    },

    {
        id: "netsummary",
        name: "Net Traffic Summary",
        description: "Net control summary of a session.",
        header: "NET-SUM",
        fields: [
            { id: "net", tag: "NET", label: "Net name", type: "text", placeholder: "e.g: DAC ARES Evening Net", required: true },
            { id: "datetime", tag: "DTG", label: "Date / time", type: "dtg", required: true },
            { id: "control", tag: "NCS", label: "Net control", type: "text", placeholder: "e.g: K7ABC", required: true, prefillFromCallsign: true },
            { id: "checkins", tag: "CHK", label: "Stations checked in", type: "text", placeholder: "e.g: 14", required: true },
            { id: "traffic", tag: "TFC", label: "Traffic handled", type: "text", placeholder: "e.g: 3", required: true },
            { id: "next_net", tag: "NEXT", label: "Next session", type: "text", placeholder: "e.g: 1900L tomorrow", required: false },
        ],
    },

    {
        id: "netopen",
        name: "Net Activation",
        description: "Announce that a net is open and how to check in.",
        header: "NET-OPEN",
        fields: [
            { id: "net", tag: "NET", label: "Net name", type: "text", placeholder: "e.g: DAC ARES Emergency Net", required: true },
            { id: "datetime", tag: "DTG", label: "Date / time", type: "dtg", required: true },
            { id: "control", tag: "NCS", label: "Net control", type: "text", placeholder: "e.g: K7ABC", required: true, prefillFromCallsign: true },
            { id: "type", tag: "TYPE", label: "Net type", type: "select", required: true, options: ["DIRECTED", "OPEN", "EMERGENCY", "TRAINING"] },
            { id: "purpose", tag: "PURP", label: "Purpose", type: "text", placeholder: "e.g: Flooding, Dona Ana County", required: false },
            { id: "checkin", tag: "CHK", label: "Check-in instructions", type: "text", placeholder: "e.g: By callsign when called", required: false },
        ],
    },

    // ---- Welfare and shelter ----

    {
        id: "welfare",
        name: "Health & Welfare",
        description: "Pass an enquiry or reply about an individual.",
        header: "WELFARE",
        fields: [
            { id: "type", tag: "TYPE", label: "Enquiry or reply", type: "select", required: true, options: ["INQUIRY", "REPLY"] },
            { id: "name", tag: "NAME", label: "Person", type: "text", placeholder: "e.g: J. Smith", required: true },
            { id: "address", tag: "ADDR", label: "Address or last known location", type: "text", placeholder: "e.g: 42 Main St, Las Cruces", required: true },
            { id: "status", tag: "STAT", label: "Status", type: "select", required: false, options: ["SAFE", "INJURED", "EVACUATED", "NOT FOUND", "UNKNOWN"] },
            { id: "contact", tag: "FROM", label: "Requested by / contact", type: "text", placeholder: "e.g: sister, M. Smith", required: false },
            { id: "message", tag: "MSG", label: "Message", type: "textarea", placeholder: "Plain language. Status only, no medical detail.", required: false },
        ],
    },

    {
        id: "shelter",
        name: "Shelter Status",
        description: "Report shelter population, capacity and needs.",
        header: "SHELTER",
        fields: [
            { id: "name", tag: "SHLT", label: "Shelter name", type: "text", placeholder: "e.g: Lincoln Middle School", required: true },
            { id: "datetime", tag: "DTG", label: "Date / time", type: "dtg", required: true },
            { id: "status", tag: "STAT", label: "Status", type: "select", required: true, options: ["OPEN", "FULL", "STANDBY", "CLOSED"] },
            { id: "population", tag: "POP", label: "Current population", type: "text", placeholder: "e.g: 40", required: true },
            { id: "capacity", tag: "CAP", label: "Capacity", type: "text", placeholder: "e.g: 120", required: false },
            { id: "needs", tag: "NEEDS", label: "Needs", type: "textarea", placeholder: "e.g: Cots x20, infant formula", required: false },
        ],
    },

    // ---- Damage and infrastructure ----

    {
        id: "damage",
        name: "Damage Assessment",
        description: "Report observed damage at a location.",
        header: "DAMAGE",
        fields: [
            { id: "datetime", tag: "DTG", label: "Date / time", type: "dtg", required: true },
            { id: "location", tag: "LOC", label: "Location", type: "text", placeholder: "e.g: 1400 blk Alameda", required: true, offersPosition: true },
            { id: "type", tag: "TYPE", label: "Type", type: "select", required: true, options: ["STRUCTURE", "UTILITY", "ROAD", "FLOOD", "FIRE", "OTHER"] },
            { id: "severity", tag: "SEV", label: "Severity", type: "select", required: true, options: ["MINOR", "MODERATE", "MAJOR", "DESTROYED"] },
            { id: "casualties", tag: "CAS", label: "Casualties", type: "text", placeholder: "e.g: NONE", required: false },
            { id: "description", tag: "DESC", label: "Description", type: "textarea", placeholder: "What you can see, not what you infer.", required: false },
        ],
    },

    {
        id: "route",
        name: "Road / Route Status",
        description: "Report whether a route is passable.",
        header: "ROUTE",
        fields: [
            { id: "datetime", tag: "DTG", label: "Date / time", type: "dtg", required: true },
            { id: "route", tag: "RTE", label: "Road or route", type: "text", placeholder: "e.g: US-70", required: true },
            { id: "segment", tag: "SEG", label: "Segment", type: "text", placeholder: "e.g: MM 12 to MM 18", required: true },
            { id: "status", tag: "STAT", label: "Status", type: "select", required: true, options: ["OPEN", "RESTRICTED", "CLOSED"] },
            { id: "cause", tag: "CAUSE", label: "Cause", type: "text", placeholder: "e.g: Debris flow", required: false },
            { id: "detour", tag: "DTOUR", label: "Detour", type: "text", placeholder: "e.g: North via Ridge St", required: false },
        ],
    },

    {
        id: "comms",
        name: "Communications Status",
        description: "Report a repeater, mesh node or link up or down.",
        header: "COMMS",
        fields: [
            { id: "datetime", tag: "DTG", label: "Date / time", type: "dtg", required: true },
            { id: "system", tag: "SYS", label: "System or asset", type: "text", placeholder: "e.g: W5XYZ 146.940", required: true },
            { id: "type", tag: "TYPE", label: "Type", type: "select", required: true, options: ["REPEATER", "MESH NODE", "SIMPLEX", "INTERNET", "PHONE", "POWER"] },
            { id: "status", tag: "STAT", label: "Status", type: "select", required: true, options: ["UP", "DEGRADED", "INTERMITTENT", "DOWN"] },
            { id: "location", tag: "LOC", label: "Location", type: "text", placeholder: "e.g: Tortugas Mtn", required: false, offersPosition: true },
            { id: "restore", tag: "ETR", label: "Estimated restoration", type: "text", placeholder: "e.g: Unknown, or 0600L", required: false },
            { id: "comments", tag: "CMT", label: "Comments", type: "text", placeholder: "e.g: Mains lost, no generator", required: false },
        ],
    },

    // ---- Station position ----

    {
        id: "position",
        name: "Position / Station Report",
        description: "Report where your station is and whether it is operational.",
        header: "POSITION",
        fields: [
            { id: "callsign", tag: "CALL", label: "Callsign", type: "text", placeholder: "e.g: K7ABC", required: true, prefillFromCallsign: true },
            { id: "datetime", tag: "DTG", label: "Date / time", type: "dtg", required: true },
            { id: "location", tag: "LOC", label: "Location / grid square", type: "text", placeholder: "e.g: DM62nr, or 1400 blk Alameda", required: true, offersPosition: true },
            { id: "station_type", tag: "STA", label: "Station type", type: "select", required: true, options: ["FIXED", "MOBILE", "PORTABLE", "IN TRANSIT"] },
            { id: "status", tag: "STAT", label: "Operational status", type: "select", required: true, options: ["OPERATIONAL", "LIMITED", "STANDBY", "OFF AIR"] },
            { id: "power", tag: "PWR", label: "Power source", type: "select", required: false, options: ["MAINS", "GENERATOR", "BATTERY", "SOLAR"] },
            { id: "destination", tag: "DEST", label: "Heading to", type: "text", placeholder: "e.g: Lincoln MS shelter", required: false },
        ],
    },

    // ---- Weather and observation ----

    {
        id: "skywarn",
        name: "SKYWARN Spotter Report",
        description: "Severe weather observation for the NWS.",
        header: "SKYWARN",
        fields: [
            { id: "spotter", tag: "SPTR", label: "Spotter ID", type: "text", placeholder: "e.g: K7ABC or K7ABC/1234", required: true, prefillFromSpotterId: true },
            { id: "datetime", tag: "DTG", label: "Time observed", type: "dtg", required: true },
            { id: "location", tag: "LOC", label: "Location of observation", type: "text", placeholder: "e.g: 3 mi NW of Anthony", required: true, offersPosition: true },
            { id: "event", tag: "EVNT", label: "Event", type: "select", required: true, options: ["TORNADO", "FUNNEL CLOUD", "WALL CLOUD", "HAIL", "WIND DAMAGE", "HIGH WIND", "FLASH FLOOD", "HEAVY RAIN", "SNOW", "DUST STORM"] },
            { id: "measurement", tag: "MEAS", label: "Measurement", type: "text", placeholder: "e.g: 1.00 in hail, or 60 mph", required: false },
            { id: "direction", tag: "MOVG", label: "Moving toward", type: "text", placeholder: "e.g: NE", required: false },
            { id: "description", tag: "DESC", label: "Description", type: "textarea", placeholder: "Report what you observed, not what you interpreted.", required: false },
        ],
    },

    {
        id: "salute",
        name: "SALUTE Spot Report",
        description: "Structured report of observed activity.",
        header: "SALUTE",
        fields: [
            { id: "size", tag: "S", label: "Size", type: "text", placeholder: "e.g: 6 people, 2 vehicles", required: true },
            { id: "activity", tag: "A", label: "Activity", type: "text", placeholder: "e.g: Clearing debris from roadway", required: true },
            { id: "location", tag: "L", label: "Location", type: "text", placeholder: "e.g: DM62, or 1400 blk Alameda", required: true, offersPosition: true },
            { id: "unit", tag: "U", label: "Unit or identity", type: "text", placeholder: "e.g: County road crew", required: false },
            { id: "datetime", tag: "T", label: "Time observed", type: "dtg", required: true },
            { id: "equipment", tag: "E", label: "Equipment", type: "text", placeholder: "e.g: 1 backhoe, 1 dump truck", required: false },
        ],
    },

    // ---- Formal traffic ----

    {
        id: "radiogram",
        name: "ARRL Radiogram (NTS)",
        description: "Formal traffic in National Traffic System format.",
        header: "RADIOGRAM",
        fields: [
            { id: "number", tag: "NR", label: "Message number", type: "text", placeholder: "e.g: 41", required: true },
            // the NTS precedences as they are actually written on a radiogram
            { id: "precedence", tag: "PREC", label: "Precedence", type: "select", required: true, options: ["R", "W", "P", "EMERGENCY"] },
            { id: "handling", tag: "HX", label: "Handling instructions", type: "text", placeholder: "e.g: HXC", required: false },
            { id: "station", tag: "STN", label: "Station of origin", type: "text", placeholder: "e.g: K7ABC", required: true, prefillFromCallsign: true },
            { id: "check", tag: "CK", label: "Check (word count of text)", type: "text", placeholder: "e.g: 12", required: true },
            { id: "place", tag: "PLC", label: "Place of origin", type: "text", placeholder: "e.g: LAS CRUCES NM", required: true },
            { id: "datetime", tag: "DTG", label: "Time filed", type: "dtg", required: true },
            { id: "addressee", tag: "TO", label: "Addressee (name, address, phone)", type: "textarea", placeholder: "e.g: M SMITH, 42 MAIN ST, LAS CRUCES NM 88001", required: true },
            { id: "text", tag: "TEXT", label: "Text (25 words or fewer)", type: "textarea", placeholder: "Plain language, X between sentences. The check must match the word count.", required: true },
            { id: "signature", tag: "SIG", label: "Signature", type: "text", placeholder: "e.g: JOE", required: true },
        ],
    },

    // ---- Tasking ----

    {
        id: "fivews",
        name: "5Ws Briefing",
        description: "Assigns a task or mission to a person or team: who, what, when, where and why.",
        header: "5WS BRIEFING",
        keepBlankFields: true,
        // the five W's are numbered, so a reply can say "ref your 3" and be understood
        fields: [
            { id: "from", tag: "FM", label: "From (who is tasking)", type: "text", placeholder: "e.g: KJ5HBN Net Control", required: true, prefillFromCallsign: true },
            { id: "datetime", tag: "DTG", label: "Date / time issued", type: "dtg", required: true },
            { id: "who", tag: "1 WHO", label: "1. Who (person or team assigned)", type: "text", placeholder: "e.g: Team 2 (KJ5ABC, KF5XYZ)", required: true },
            { id: "what", tag: "2 WHAT", label: "2. What (the task or mission)", type: "textarea", placeholder: "e.g: Check the shelter at Ridge Street school, report capacity and needs", required: true },
            { id: "when", tag: "3 WHEN", label: "3. When", type: "dtg", required: true },
            { id: "where", tag: "4 WHERE", label: "4. Where (address, description, degrees or MGRS)", type: "text", placeholder: "e.g: North gate, Ridge Street school", required: true, offersPosition: true, positionWithMgrs: true },
            { id: "why", tag: "5 WHY", label: "5. Why (the purpose, so they can adapt)", type: "textarea", placeholder: "e.g: EOC needs shelter status before the 2200 briefing", required: true },
            { id: "ack", tag: "ACK REQ", label: "Ask them to acknowledge (adds ACK REQ)", type: "check" },
        ],
    },

    {
        id: "opord",
        name: "OPORD (5 Paragraph Operations Order)",
        description: "The Army five paragraph operations order, with Hazards in place of enemy forces. Only the mission is required; blank parts are sent as a hyphen.",
        header: "OPORD",
        keepBlankFields: true,
        fields: [
            { id: "number", tag: "NR", label: "Order number", type: "text", placeholder: "e.g: 01-26" },
            { id: "datetime", tag: "DTG", label: "Date / time issued", type: "dtg" },
            { id: "refs", tag: "REF", label: "References (maps, plans)", type: "text", placeholder: "e.g: County EOP annex C" },
            { id: "hazards", tag: "1A HAZARDS", label: "1. Situation: a. Hazards (weather, flooding, fire, road closures)", type: "textarea" },
            { id: "friendly", tag: "1B FRIENDLY", label: "1. Situation: b. Friendly forces and other agencies", type: "textarea", placeholder: "e.g: EOC active, Red Cross at Ridge St, FD staging at Station 3" },
            { id: "attached", tag: "1C ATTACHED", label: "1. Situation: c. Attachments and detachments", type: "text" },
            { id: "mission", tag: "2 MISSION", label: "2. Mission (who, what, when, where and why, in one sentence)", type: "textarea", required: true },
            { id: "intent", tag: "3A INTENT", label: "3. Execution: a. Intent (purpose and end state)", type: "textarea" },
            { id: "concept", tag: "3B CONCEPT", label: "3. Execution: b. Concept of operations", type: "textarea" },
            { id: "tasks", tag: "3C TASKS", label: "3. Execution: c. Tasks to teams", type: "textarea", placeholder: "e.g: Team 1 shelter comms. Team 2 road status N sector" },
            { id: "coordinating", tag: "3D COORD", label: "3. Execution: d. Coordinating instructions (timings, check-ins, rules)", type: "textarea" },
            { id: "supply", tag: "4A SUPPLY", label: "4. Sustainment: a. Supply (fuel, water, batteries)", type: "text" },
            { id: "transport", tag: "4B TRANS", label: "4. Sustainment: b. Transportation", type: "text" },
            { id: "medical", tag: "4C MEDICAL", label: "4. Sustainment: c. Medical", type: "text" },
            { id: "command", tag: "5A COMMAND", label: "5. Command and signal: a. Command (leader's location, succession)", type: "text" },
            { id: "signal", tag: "5B SIGNAL", label: "5. Command and signal: b. Signal (channels, call signs, check-in times)", type: "textarea" },
        ],
    },

    // ---- Medical ----

    {
        id: "medevac",
        name: "9-Line MEDEVAC Request",
        description: "Medical evacuation request in the standard nine line format.",
        header: "9-LINE",
        // the lines are numbered rather than tagged, because that is the format
        fields: [
            { id: "line1", tag: "1", label: "1. Pickup location", type: "text", placeholder: "e.g: DM62nr, soccer field E of Lincoln MS", required: true, offersPosition: true },
            { id: "line2", tag: "2", label: "2. Frequency and callsign at site", type: "text", placeholder: "e.g: 146.520 K7ABC", required: true },
            { id: "line3", tag: "3", label: "3. Patients by precedence", type: "text", placeholder: "e.g: 1 URGENT, 2 PRIORITY", required: true },
            { id: "line4", tag: "4", label: "4. Special equipment", type: "select", required: true, options: ["NONE", "HOIST", "EXTRACTION", "VENTILATOR"] },
            { id: "line5", tag: "5", label: "5. Patients by type", type: "text", placeholder: "e.g: 1 LITTER, 2 AMBULATORY", required: true },
            { id: "line6", tag: "6", label: "6. Injury or illness", type: "textarea", placeholder: "What you observed. e.g: Fall from roof, head injury, conscious", required: true },
            { id: "line7", tag: "7", label: "7. Site marking", type: "select", required: true, options: ["NONE", "PANELS", "SMOKE", "SIGNAL", "LIGHTS", "OTHER"] },
            { id: "line8", tag: "8", label: "8. Patient status", type: "text", placeholder: "e.g: 3 CIVILIAN", required: false },
            { id: "line9", tag: "9", label: "9. Terrain and hazards at site", type: "text", placeholder: "e.g: Open field, power lines N side", required: false },
        ],
    },

];

export default ReportForms;
