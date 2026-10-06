// client/src/lib/gettingStartedContent.ts
//
// Single source of truth for the "Getting Started with VeritaAssure" guide.
// Feeds the public Resources page (/resources/getting-started) and, in a later
// pass, the in-app onboarding wizard and per-module cards, so the system path,
// the printable handout, and the in-app version never drift.
//
// Copy rules: no em dashes, TM on product names, "medical director or designee",
// www email. Tasks are workflow-level (no invented UI step names).

export interface GuideStep {
  task: string;
  who: string;
}

export interface PhaseBlock {
  title: string;
  steps: GuideStep[];
}

export interface ModuleGuide {
  name: string;          // includes the TM mark
  stream: "Compliance" | "Operations";
  what: string;          // one line: what the module does
  steps: string[];       // first steps to get going
}

// ---- System onboarding path (the 6-phase checklist) ----
export const SYSTEM_PHASES: PhaseBlock[] = [
  {
    title: "Phase 1: Account setup and access",
    steps: [
      { task: "Sign in and complete your user profile: name, title, credentials, and analyst initials.", who: "Each user" },
      { task: "Complete the HIPAA acknowledgment at first sign-in.", who: "Each user" },
      { task: "Enter lab identity: lab name, CLIA number, and address.", who: "Owner or admin" },
      { task: "Add users and assign seats and roles (owner, admin, writer, read-and-sign staff).", who: "Owner or admin" },
      { task: "Designate the medical director or designee from your lab members.", who: "Owner or admin" },
    ],
  },
  {
    title: "Phase 2: Build your lab foundation",
    steps: [
      { task: "VeritaMap™: add each instrument and its analytes, and set complexity (waived, moderate, or high) on each test.", who: "Owner or admin" },
      { task: "VeritaMap™: enter your verified reference ranges, AMR, and MEC-adopted critical values. The system never pre-fills these.", who: "Owner or admin" },
      { task: "VeritaStaff™: build the employee roster and assign instruments to each employee.", who: "Owner or admin" },
    ],
  },
  {
    title: "Phase 3: Compliance modules",
    steps: [
      { task: "Run your first VeritaCheck™ verification study and generate the PDF for the medical director or designee to sign.", who: "Tech or writer" },
      { task: "Assess an employee's competency in VeritaComp™ and capture the evaluator sign-off.", who: "Technical consultant or supervisor" },
      { task: "Author or import a policy in VeritaPolicy™ and assign it for read-and-sign.", who: "Owner or admin" },
      { task: "Enter QC in VeritaQC™, apply Westgard rules, and capture the medical director or designee co-sign.", who: "Tech or writer" },
      { task: "Enroll your PT programs in VeritaPT™ and schedule recurring tasks in VeritaTrack™.", who: "Owner or admin" },
    ],
  },
  {
    title: "Phase 4: Operations modules",
    steps: [
      { task: "Set up inventory, reorder points, and vendors in VeritaStock™.", who: "Owner, admin, or tech" },
      { task: "Build a competency-aware schedule in VeritaShift™ and model cost per reportable test in VeritaOps™.", who: "Owner or admin" },
    ],
  },
  {
    title: "Phase 5: Reports and inspection readiness",
    steps: [
      { task: "Generate and review your key PDFs; confirm the signature block appears on page 1.", who: "Owner or admin" },
      { task: "Use the Inspection Readiness dashboard (and the network roll-up for multi-site systems) to see your overall standing.", who: "Owner or admin" },
    ],
  },
  {
    title: "Phase 6: Go-live and ongoing",
    steps: [
      { task: "Confirm your recurring cycles are scheduled: policy two-year review, competency cadence, and the PT calendar.", who: "Owner or admin" },
      { task: "Invite the remaining staff to the Staff Portal for read-and-sign access.", who: "Owner or admin" },
    ],
  },
];

// ---- Per-module getting-started checklists (all 18 modules) ----
export const MODULE_GUIDES: ModuleGuide[] = [
  { name: "VeritaMap™", stream: "Compliance", what: "Your instrument and test menu, the foundation the other modules read from.", steps: [
    "Add each instrument and its analytes to your lab's map.",
    "Set complexity (waived, moderate, or high) on every test; it drives PT, verification, competency, QC, and personnel.",
    "Enter your verified reference ranges, AMR, and MEC-adopted critical values.",
  ]},
  { name: "VeritaStaff™", stream: "Compliance", what: "Your personnel roster, credentials, and instrument assignments.", steps: [
    "Add staff with titles, credentials, and hire dates.",
    "Assign instruments to each employee; these assignments drive competency coverage.",
    "Track credentials and continuing education.",
  ]},
  { name: "VeritaCheck™", stream: "Compliance", what: "CLIA performance verification with a 42 CFR-cited, director-signed report.", steps: [
    "Pick an instrument and start a study (precision, correlation / method comparison, or calibration verification / linearity).",
    "Enter your data and review the regulatory verdict and coverage.",
    "Generate the PDF for the medical director or designee to sign.",
  ]},
  { name: "VeritaComp™", stream: "Compliance", what: "Competency assessment by employee and test system.", steps: [
    "Open an employee and assess competency by test system.",
    "Complete the required elements and capture the evaluator sign-off.",
    "Generate the competency record.",
  ]},
  { name: "VeritaPolicy™", stream: "Compliance", what: "Policy and procedure management with read-and-sign and version control.", steps: [
    "Author or import a policy and set its review interval.",
    "Assign it for read-and-sign.",
    "Use the major-revision workflow when a policy changes materially.",
  ]},
  { name: "VeritaScan™", stream: "Compliance", what: "Self-audit and document library against the requirements that apply to you.", steps: [
    "Run a compliance audit.",
    "Work the needs-review items.",
    "Keep source documents in the library.",
  ]},
  { name: "VeritaQC™", stream: "Compliance", what: "Quality control entry, Westgard rules, and IQCP.", steps: [
    "Enter QC results for a control.",
    "Apply Westgard rules and record corrective action.",
    "Capture the medical director or designee co-sign, and set up an IQCP where appropriate.",
  ]},
  { name: "VeritaPT™", stream: "Compliance", what: "Proficiency testing enrollment, results, and failure investigation.", steps: [
    "Enroll in your PT programs by vendor and category.",
    "Record results.",
    "Investigate any result that does not meet criteria; it links to a VeritaResponse™ investigation.",
  ]},
  { name: "VeritaTrack™", stream: "Compliance", what: "Recurring compliance tasks on a calendar, with owners and reminders.", steps: [
    "Create recurring compliance tasks.",
    "Set owners and due dates.",
    "Use the calendar to stay ahead of what is due.",
  ]},
  { name: "VeritaResponse™", stream: "Compliance", what: "Findings, non-conforming events, and corrective action to closure.", steps: [
    "Open a finding or non-conforming event.",
    "Document the investigation and root cause.",
    "Track corrective action to closure.",
  ]},
  { name: "VeritaLab™", stream: "Compliance", what: "Certificate reports and regulatory forms.", steps: [
    "Generate certificate reports.",
    "Produce regulatory forms such as CMS 116 and CMS 209.",
  ]},
  { name: "VeritaMaintain™", stream: "Compliance", what: "Equipment maintenance schedules and logs.", steps: [
    "Set up maintenance schedules for each instrument.",
    "Record completed maintenance.",
  ]},
  { name: "VeritaStock™", stream: "Operations", what: "Inventory, reorder points, and ordering.", steps: [
    "Add inventory items and vendors.",
    "Set reorder points.",
    "Place and receive orders.",
  ]},
  { name: "VeritaShift™", stream: "Operations", what: "Staff scheduling with competency-aware bench coverage.", steps: [
    "Build a staffing schedule.",
    "Turn on competency-aware bench coverage so only qualified staff cover a bench.",
  ]},
  { name: "VeritaOps™", stream: "Operations", what: "Cost per reportable test and operational metrics.", steps: [
    "Model cost per reportable test (CPRT).",
    "Review the operational metrics for your lab.",
  ]},
  { name: "VeritaBench™", stream: "Operations", what: "Bench workload view.", steps: [
    "Review bench workload across the lab.",
  ]},
  { name: "VeritaPace™", stream: "Operations", what: "Productivity and pace.", steps: [
    "Review productivity and pace.",
  ]},
  { name: "VeritaQA™", stream: "Operations", what: "QA document review and reviewer sign-off tracking.", steps: [
    "Track QA document review.",
    "Capture reviewer sign-off.",
  ]},
];
