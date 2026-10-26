// shared/findingTypes.ts
//
// VeritaResponse entry types and their templates (Michael 2026-10-26: the entry-type mock was approved as written,
// D1-D7). Each type has its own fields, prompts and clock instead of one survey template for all:
//   inspection     - a survey or inspection citation (the original template, unchanged)
//   pt_failure     - unsuccessful proficiency testing; no accreditor; clock from the evaluation received date
//   internal_nce   - a lab-found non-conforming event; no accreditor and no clock
//   fda_deviation  - a biological product deviation (21 CFR 606.171); its own report-by date
//   qc_escalation  - escalated from a VeritaQC corrective action; no CMS clock, a lab target instead
//   aaa_escalation - escalated from a failed alternative assessment in VeritaPT; same as qc_escalation
// Type-specific answers live in findings.type_details (JSON). The server keeps only the keys listed here
// (sanitizeTypeDetails), so the page and the server cannot drift. A detail with `column` maps to an existing
// findings column instead of the JSON.
// No em dashes in any user-facing string (CLAUDE.md section 3).

import { PT_ROOT_CAUSE_CATEGORIES } from "./ptFailure";

export const FINDING_SOURCE_TYPES = ["inspection", "pt_failure", "internal_nce", "fda_deviation", "qc_escalation", "aaa_escalation"] as const;
export type FindingSourceType = typeof FINDING_SOURCE_TYPES[number];

export type PlanKey = "immediate_action" | "containment" | "root_cause" | "corrective_action" | "preventive_action" | "monitoring_plan";
type Opt = { value: string; label: string };
export type DetailField =
  | { key: string; label: string; kind: "text"; placeholder?: string; long?: boolean; column?: boolean }
  | { key: string; label: string; kind: "date"; column?: boolean }
  | { key: string; label: string; kind: "int"; placeholder?: string }
  | { key: string; label: string; kind: "enum"; options: readonly Opt[]; column?: boolean }
  | { key: string; label: string; kind: "checklist"; items: { value: string; label: string; hint: string }[] };

export interface FindingTypeTemplate {
  label: string;                   // New Finding button and list badge
  title: string | null;            // page title prefix; null = "<accreditor> Finding" (inspection)
  subtitle: string | null;         // shown under the title when the finding has no standard reference
  usesAccreditor: boolean;         // accreditor, finding number, phase, inspection ID and the accreditor clock
  anchorLabel: string | null;      // the date the clock counts from (null: the accreditor table decides)
  descriptionLabel: string;
  descriptionPlaceholder: string;
  notesLabel: string | null;       // the second narrative field (surveyor_notes); null hides it
  detailsTitle: string | null;
  details: DetailField[];
  planTitle: string;
  planNote: string;
  plan: Record<PlanKey, { label: string; placeholder: string }>;
}

export const PATIENT_IMPACT: readonly Opt[] = [
  { value: "none", label: "None" }, { value: "possible", label: "Possible" }, { value: "confirmed", label: "Confirmed" },
];
export const NCE_PHASES: readonly Opt[] = [
  { value: "pre_analytic", label: "Pre-analytic" }, { value: "analytic", label: "Analytic" }, { value: "post_analytic", label: "Post-analytic" },
];
export const NCE_CATEGORIES: readonly Opt[] = [
  { value: "specimen", label: "Specimen" }, { value: "reagent_supply", label: "Reagent or supply" }, { value: "equipment", label: "Equipment" },
  { value: "result_reporting", label: "Result reporting" }, { value: "process_staffing", label: "Process or staffing" }, { value: "other", label: "Other" },
];
export const FDA_DISPOSITIONS: readonly Opt[] = [
  { value: "quarantined", label: "Quarantined" }, { value: "discarded", label: "Discarded" }, { value: "transfused", label: "Transfused" }, { value: "other", label: "Other" },
];
export const QC_CAUSES: readonly Opt[] = [
  { value: "control_material", label: "Control material" }, { value: "reagent", label: "Reagent" }, { value: "calibration", label: "Calibration" },
  { value: "instrument", label: "Instrument" }, { value: "operator", label: "Operator" }, { value: "other", label: "Other" },
];
export const CHECKLIST_ANSWERS: readonly Opt[] = [
  { value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "na", label: "N/A" },
];
export const PT_CHECKLIST = [
  { value: "clerical", label: "Clerical", hint: "Result transcribed and submitted correctly; units, method and instrument codes right; right sample." },
  { value: "material", label: "PT material", hint: "Reconstituted, stored and mixed per the instructions; tested within stability." },
  { value: "analytic", label: "Analytic", hint: "QC acceptable on that run; calibration current; reagent lot; instrument flags and maintenance." },
  { value: "peer", label: "Method and peer group", hint: "Right peer group; possible matrix effect; how peers performed." },
  { value: "same_manner", label: "Tested like a patient specimen (42 CFR 493.801(b))", hint: "Routine staff, workload, methods and number of tests." },
  { value: "patient_impact", label: "Patient impact", hint: "Patient results from the testing window reviewed; corrected reports issued, if any." },
];

const NO_PHI = "No patient names or record numbers.";
const INSPECTION_PLAN: FindingTypeTemplate["plan"] = {
  immediate_action: { label: "Immediate action", placeholder: "What was done the same day the citation was received." },
  containment: { label: "Containment", placeholder: "How affected results, lots, or processes were isolated or recalled." },
  root_cause: { label: "Root cause", placeholder: "Why the deficiency occurred. Address the system, not the person." },
  corrective_action: { label: "Corrective action (POC element 1)", placeholder: "What changed: SOP revision, retraining, instrument adjustment, lot rejection." },
  preventive_action: { label: "Preventive / system-level action (POC elements 2 + 3)", placeholder: "Identification of others potentially affected, and the systemic change so it does not recur." },
  monitoring_plan: { label: "Monitoring plan (POC element 4)", placeholder: "How effectiveness will be verified at 30/60/90 days." },
};

export const FINDING_TYPE_TEMPLATES: Record<FindingSourceType, FindingTypeTemplate> = {
  inspection: {
    label: "Inspection finding", title: null, subtitle: null, usesAccreditor: true, anchorLabel: null,
    descriptionLabel: "Description (no PHI)",
    descriptionPlaceholder: "What the surveyor cited, in their words where possible. No patient names or MRNs.",
    notesLabel: "Surveyor notes (optional, no PHI)", detailsTitle: null, details: [],
    planTitle: "Plan of correction",
    planNote: "The CMS Statement of Deficiencies (form CMS-2567) requires 5 elements: corrective action for affected patients or items, identification of others potentially affected, systems to prevent recurrence, ongoing monitoring, and a completion date. The CMS-2567 PDF stays locked until all five are filled in.",
    plan: INSPECTION_PLAN,
  },
  pt_failure: {
    label: "PT failure", title: "PT Failure",
    subtitle: "42 CFR 493.1236(a) and (d): proficiency testing results are evaluated and documented",
    usesAccreditor: false, anchorLabel: "PT evaluation received",
    descriptionLabel: "What happened (no PHI)",
    descriptionPlaceholder: "Which result was unacceptable, the target and acceptable range, and what the laboratory reported.",
    notesLabel: null, detailsTitle: "PT investigation",
    details: [
      { key: "pt_checklist", label: "Investigation checklist", kind: "checklist", items: PT_CHECKLIST },
      { key: "root_cause_category", label: "Root cause category", kind: "enum", options: PT_ROOT_CAUSE_CATEGORIES, column: true },
      { key: "evidence_of_correction", label: "Evidence of correction (kept for CMS)", kind: "text", long: true, placeholder: "What shows the problem is corrected: repeat testing, peer data, QC records, retraining." },
    ],
    planTitle: "Corrective action",
    planNote: "After unsuccessful proficiency testing, CMS can ask for evidence that the laboratory took steps to correct the problem (42 CFR 493.803(c)(2)). Document each step here.",
    plan: {
      immediate_action: { label: "Immediate action", placeholder: "What was done when the evaluation arrived: result review, a hold on reporting if needed." },
      containment: { label: "Containment", placeholder: "Patient results or lots set aside while the investigation runs." },
      root_cause: { label: "Root cause", placeholder: "What the checklist found. Name the system cause, not the person." },
      corrective_action: { label: "Corrective action", placeholder: "What changed: recalibration, SOP revision, retraining, method or peer-group correction." },
      preventive_action: { label: "Preventive action", placeholder: "What keeps it from recurring on this and related analytes." },
      monitoring_plan: { label: "Monitoring", placeholder: "How the fix is confirmed: the next PT event, split samples, QC review at 30, 60 and 90 days." },
    },
  },
  internal_nce: {
    label: "Internal event (NCE)", title: "Internal Event", subtitle: "Internal non-conforming event",
    usesAccreditor: false, anchorLabel: null,
    descriptionLabel: "What happened (no PHI)",
    descriptionPlaceholder: `What was found, where and when. Refer to patients or samples by internal case number only. ${NO_PHI}`,
    notesLabel: null, detailsTitle: "Event details",
    details: [
      { key: "event_date", label: "Event date", kind: "date", column: true },
      { key: "discovered_by", label: "Discovered by", kind: "text", column: true, placeholder: "Name or role who found it" },
      { key: "nce_phase", label: "Phase", kind: "enum", options: NCE_PHASES },
      { key: "nce_category", label: "Category", kind: "enum", options: NCE_CATEGORIES },
      { key: "nce_area", label: "Area or bench", kind: "text", placeholder: "e.g. Chemistry, specimen receiving" },
      { key: "patient_impact", label: "Patient impact", kind: "enum", options: PATIENT_IMPACT },
      { key: "patient_impact_count", label: "Results affected", kind: "int", placeholder: "0" },
      { key: "corrected_reports", label: "Corrected reports issued, and to whom", kind: "text", long: true },
    ],
    planTitle: "Corrective action",
    planNote: "Corrective action policies and procedures must be followed, and every corrective action documented (42 CFR 493.1282).",
    plan: {
      immediate_action: { label: "Immediate action", placeholder: "What was done when the event was found." },
      containment: { label: "Containment", placeholder: "Specimens, results, lots or equipment set aside, and reports held or corrected." },
      root_cause: { label: "Root cause", placeholder: "Why it happened. Address the system, not the person." },
      corrective_action: { label: "Corrective action", placeholder: "What changed to fix this event." },
      preventive_action: { label: "Preventive action", placeholder: "What changed so it does not happen again." },
      monitoring_plan: { label: "Effectiveness check", placeholder: "How and when the laboratory will confirm the fix held." },
    },
  },
  fda_deviation: {
    label: "FDA product deviation", title: "FDA Product Deviation", subtitle: "21 CFR 606.171",
    usesAccreditor: false, anchorLabel: null,
    descriptionLabel: "What happened (no PHI)",
    descriptionPlaceholder: `The deviation or unexpected event, the product and unit affected, and how it was found. ${NO_PHI}`,
    notesLabel: null, detailsTitle: "Product disposition",
    details: [
      { key: "fda_disposition", label: "Disposition of the product", kind: "enum", options: FDA_DISPOSITIONS },
      { key: "fda_disposition_note", label: "Disposition details", kind: "text", long: true, placeholder: "Units involved and where each one went." },
    ],
    planTitle: "Investigation and corrective action",
    planNote: "Deviations should be investigated whether or not they are reportable (21 CFR 606.171(f)).",
    plan: {
      immediate_action: { label: "Immediate action", placeholder: "What was done with the product and any related units when the event was found." },
      containment: { label: "Containment", placeholder: "Related units or components quarantined or traced." },
      root_cause: { label: "Root cause", placeholder: "Why the deviation occurred." },
      corrective_action: { label: "Corrective action", placeholder: "What changed to fix it." },
      preventive_action: { label: "Preventive action", placeholder: "What keeps it from recurring." },
      monitoring_plan: { label: "Monitoring", placeholder: "How the fix is confirmed." },
    },
  },
  qc_escalation: {
    label: "QC escalation", title: "QC Event",
    subtitle: "42 CFR 493.1282(b)(2): control results outside the laboratory's acceptability criteria",
    usesAccreditor: false, anchorLabel: "Escalated on",
    descriptionLabel: "QC event (no PHI)",
    descriptionPlaceholder: "The control, rule and value. Filled in from VeritaQC™.",
    notesLabel: "Notes from VeritaQC™", detailsTitle: "QC investigation and patient look-back",
    details: [
      { key: "qc_rerun", label: "Rerun and its outcome", kind: "text", long: true, placeholder: "e.g. Reran Level 1 with a new vial: 102 mg/dL, within limits." },
      { key: "qc_cause", label: "Cause", kind: "enum", options: QC_CAUSES },
      { key: "lookback_runs", label: "Runs reviewed (back to the last acceptable run)", kind: "text", long: true, placeholder: "Which runs, from when to when." },
      { key: "lookback_results", label: "Patient results evaluated", kind: "int", placeholder: "0" },
      { key: "patient_impact", label: "Patient impact", kind: "enum", options: PATIENT_IMPACT },
      { key: "lookback_corrected", label: "Corrected reports issued, and to whom", kind: "text", long: true },
    ],
    planTitle: "Corrective action",
    planNote: "All patient test results obtained in the unacceptable test run and since the last acceptable test run must be evaluated (42 CFR 493.1282(b)(2)).",
    plan: {
      immediate_action: { label: "Immediate action", placeholder: "What was done when the rule fired (filled in from VeritaQC™)." },
      containment: { label: "Containment", placeholder: "Patient results from the failed run held until the look-back was done." },
      root_cause: { label: "Root cause", placeholder: "Why QC failed." },
      corrective_action: { label: "Corrective action", placeholder: "What changed: new control vial, recalibration, reagent lot, maintenance." },
      preventive_action: { label: "Preventive action", placeholder: "What keeps it from recurring." },
      monitoring_plan: { label: "Monitoring", placeholder: "How QC performance is watched afterward." },
    },
  },
  aaa_escalation: {
    label: "Alternative assessment", title: "Alternative Assessment",
    subtitle: "42 CFR 493.1236(c): accuracy verified at least twice a year where no PT is available",
    usesAccreditor: false, anchorLabel: "Escalated on",
    descriptionLabel: "What happened (no PHI)",
    descriptionPlaceholder: "The analyte and the assessment that failed. Filled in from VeritaPT™.",
    notesLabel: "Notes from VeritaPT™", detailsTitle: "Accuracy verification",
    details: [
      { key: "aaa_method", label: "How accuracy was verified", kind: "text", long: true, placeholder: "For example, split samples with another laboratory." },
      { key: "aaa_criteria", label: "Acceptance criteria", kind: "text", long: true },
      { key: "aaa_results", label: "Results against the criteria", kind: "text", long: true },
      { key: "patient_impact", label: "Patient impact", kind: "enum", options: PATIENT_IMPACT },
      { key: "aaa_next_date", label: "Next verification date", kind: "date" },
    ],
    planTitle: "Corrective action",
    planNote: "All proficiency testing evaluation and verification activities must be documented (42 CFR 493.1236(d)).",
    plan: {
      immediate_action: { label: "Immediate action", placeholder: "What was done when the assessment failed." },
      containment: { label: "Containment", placeholder: "Patient results set aside while the investigation runs." },
      root_cause: { label: "Root cause", placeholder: "Why the results disagreed. Name the system cause, not the person." },
      corrective_action: { label: "Corrective action", placeholder: "What changed: recalibration, SOP revision, retraining." },
      preventive_action: { label: "Preventive action", placeholder: "What keeps it from recurring." },
      monitoring_plan: { label: "Monitoring", placeholder: "How the fix is confirmed, including the next verification." },
    },
  },
};

export function findingTemplate(sourceType: string | null | undefined): FindingTypeTemplate {
  return FINDING_TYPE_TEMPLATES[(sourceType as FindingSourceType) in FINDING_TYPE_TEMPLATES ? (sourceType as FindingSourceType) : "inspection"];
}

// Keep only the type_details keys this type defines, each in its own shape. Unknown keys, wrong enum values,
// malformed dates and oversize text are dropped, never stored. Column-backed details are not part of the JSON.
export function sanitizeTypeDetails(sourceType: string | null | undefined, input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const src = input as Record<string, unknown>;
  for (const f of findingTemplate(sourceType).details) {
    if ((f as any).column) continue;
    const v = src[f.key];
    if (v === undefined || v === null || v === "") continue;
    if (f.kind === "text") {
      if (typeof v === "string" && v.trim()) out[f.key] = v.trim().slice(0, 2000);
    } else if (f.kind === "date") {
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[f.key] = v;
    } else if (f.kind === "int") {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && n <= 1_000_000) out[f.key] = n;
    } else if (f.kind === "enum") {
      if (typeof v === "string" && f.options.some((o) => o.value === v)) out[f.key] = v;
    } else if (f.kind === "checklist") {
      if (typeof v !== "object" || Array.isArray(v)) continue;
      const items: Record<string, { answer: string; note: string }> = {};
      for (const it of f.items) {
        const row = (v as any)[it.value];
        if (!row || typeof row !== "object") continue;
        const answer = CHECKLIST_ANSWERS.some((a) => a.value === row.answer) ? String(row.answer) : "";
        const note = typeof row.note === "string" ? row.note.trim().slice(0, 1000) : "";
        if (answer || note) items[it.value] = { answer, note };
      }
      if (Object.keys(items).length) out[f.key] = items;
    }
  }
  return out;
}

export function parseTypeDetails(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, any>;
  try { const v = JSON.parse(String(raw)); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

// Single-event PT status from the score text (e.g. "60% (3/5)"), using the passing scores already coded in
// shared/ptFailure.ts (80 percent; 100 percent for immunohematology). The two-of-three pattern needs the analyte's
// other events, which a single finding does not carry, so it is not computed here.
export function ptScorePercent(score: string | null | undefined): number | null {
  const m = String(score ?? "").match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) return Number(m[1]);
  const f = String(score ?? "").match(/\((\d+)\s*\/\s*(\d+)\)/) || String(score ?? "").match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  if (f && Number(f[2]) > 0) return Math.round((Number(f[1]) / Number(f[2])) * 1000) / 10;
  return null;
}
