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
                // prefilled from the device advert name, which is usually the operator callsign
                prefillFromNodeName: true,
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
                prefillFromNodeName: true,
            },
        ],
    },
];

export default ReportForms;
