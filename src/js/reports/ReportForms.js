/**
 * Report form definitions for emergency communications traffic.
 *
 * Each form renders to a compact plain text message that is sent over a MeshCore
 * channel. Radio airtime is expensive and the firmware caps a message at 160
 * bytes, so tags are kept short and empty optional fields are omitted entirely.
 *
 * Field types:
 *   text     - single line input
 *   textarea - multi line input
 *   select   - dropdown, requires "options"
 *   dtg      - single line input with a "Now" button, prefilled with the current date time group
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
            { id: "location", tag: "LOC", label: "Location", type: "text", placeholder: "Optional", required: false },
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
            { id: "location", tag: "LOC", label: "Location", type: "text", placeholder: "e.g: 1400 blk Alameda", required: true },
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

    // ---- Weather and observation ----

    {
        id: "skywarn",
        name: "SKYWARN Spotter Report",
        description: "Severe weather observation for the NWS.",
        header: "SKYWARN",
        fields: [
            { id: "spotter", tag: "SPTR", label: "Spotter ID", type: "text", placeholder: "e.g: K7ABC or K7ABC/1234", required: true, prefillFromSpotterId: true },
            { id: "datetime", tag: "DTG", label: "Time observed", type: "dtg", required: true },
            { id: "location", tag: "LOC", label: "Location of observation", type: "text", placeholder: "e.g: 3 mi NW of Anthony", required: true },
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
            { id: "location", tag: "L", label: "Location", type: "text", placeholder: "e.g: DM62, or 1400 blk Alameda", required: true },
            { id: "unit", tag: "U", label: "Unit or identity", type: "text", placeholder: "e.g: County road crew", required: false },
            { id: "datetime", tag: "T", label: "Time observed", type: "dtg", required: true },
            { id: "equipment", tag: "E", label: "Equipment", type: "text", placeholder: "e.g: 1 backhoe, 1 dump truck", required: false },
        ],
    },

];

export default ReportForms;
