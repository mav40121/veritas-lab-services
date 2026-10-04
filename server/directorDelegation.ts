// Medical Director Letter of Delegation - the catalog of delegable responsibilities.
//
// Under CLIA (42 CFR 493 Subpart M) and the CMS Laboratory Director Responsibilities
// brochure, the laboratory director may delegate certain duties IN WRITING, specifying
// which responsibilities, to personnel in defined positions (Clinical Consultant,
// Technical Consultant for moderate complexity, Technical Supervisor for high complexity,
// and General Supervisor for a narrower high-complexity set). The director's core duties
// (test-system appropriateness, safety, onsite visits, signing/approving policies) are
// NON-delegable and intentionally do not appear here.
//
// Two items carry a `gate`: they map to live access checks wired in Phase 2 (QC period
// review co-sign; corrective-action / finding closure). The rest are documented
// delegations with no software gate yet.

export type DelegationPosition =
  | "clinical_consultant"
  | "technical_consultant"
  | "technical_supervisor"
  | "general_supervisor";

export type DelegationComplexity = "moderate" | "high";
export type DelegationGate = "qc_period_cosign" | "finding_closure";

export interface DelegationItem {
  key: string;
  label: string;
  group: string;
  positions: DelegationPosition[];
  gate?: DelegationGate;
}

const TC_TS: DelegationPosition[] = ["technical_consultant", "technical_supervisor"];

export const DELEGATION_CATALOG: DelegationItem[] = [
  // Clinical Consultant
  { key: "cc_report_interpretation", group: "Clinical consultation", positions: ["clinical_consultant"],
    label: "Ensure test reports include the information needed to interpret results." },
  { key: "cc_consult", group: "Clinical consultation", positions: ["clinical_consultant"],
    label: "Be available to consult on results and interpret them for specific patient conditions." },

  // Technical Consultant / Technical Supervisor - general testing
  { key: "select_method", group: "General laboratory testing", positions: TC_TS,
    label: "Select the appropriate test methodology." },
  { key: "verify_method", group: "General laboratory testing", positions: TC_TS,
    label: "Verify test method performance (accuracy and precision) before use." },
  { key: "qc_program", group: "General laboratory testing", positions: TC_TS,
    label: "Establish and maintain the QA and QC programs." },
  { key: "qc_period_cosign", group: "General laboratory testing", positions: TC_TS, gate: "qc_period_cosign",
    label: "Review and co-sign the monthly QC period review." },
  { key: "analytical_performance", group: "General laboratory testing", positions: TC_TS,
    label: "Establish and maintain acceptable analytical performance for each test system." },
  { key: "finding_closure", group: "General laboratory testing", positions: ["technical_consultant", "technical_supervisor", "general_supervisor"], gate: "finding_closure",
    label: "Review and close corrective actions and inspection findings (remedial action; results reported only when the system functions)." },

  // Technical Consultant / Technical Supervisor - proficiency testing
  { key: "pt_program", group: "Proficiency testing", positions: TC_TS,
    label: "Enroll in a CMS-approved PT program; test PT samples per CLIA; return results on time; ensure staff review PT reports; follow corrective action on unacceptable PT." },

  // Technical Consultant / Technical Supervisor - personnel and competency
  { key: "personnel_competency", group: "Personnel and competency", positions: TC_TS,
    label: "Train personnel and assure competency before and during testing; maintain the competency-monitoring procedures; identify remedial training and continuing-education needs; provide the approved procedure manual." },

  // General Supervisor (high complexity)
  { key: "gs_orientation_training", group: "General supervision (high complexity)", positions: ["general_supervisor"],
    label: "Ensure testing personnel receive orientation and training; evaluate and document testing-personnel competency." },
];

export const DELEGATION_POSITIONS: DelegationPosition[] = [
  "clinical_consultant", "technical_consultant", "technical_supervisor", "general_supervisor",
];
export const DELEGATION_COMPLEXITIES: DelegationComplexity[] = ["moderate", "high"];

export function isDelegationPosition(x: any): x is DelegationPosition {
  return DELEGATION_POSITIONS.includes(x);
}
export function isDelegationComplexity(x: any): x is DelegationComplexity {
  return DELEGATION_COMPLEXITIES.includes(x);
}

export function positionLabel(p: DelegationPosition): string {
  switch (p) {
    case "clinical_consultant": return "Clinical Consultant";
    case "technical_consultant": return "Technical Consultant (moderate complexity)";
    case "technical_supervisor": return "Technical Supervisor (high complexity)";
    case "general_supervisor": return "General Supervisor (high complexity)";
  }
}
export function complexityLabel(c: DelegationComplexity): string {
  return c === "high" ? "High complexity (covers moderate)" : "Moderate complexity";
}

// The catalog items a given position may be delegated.
export function itemsForPosition(p: DelegationPosition): DelegationItem[] {
  return DELEGATION_CATALOG.filter((i) => i.positions.includes(p));
}

// Keep only keys valid for the position, coerced to booleans.
export function sanitizeResponsibilities(p: DelegationPosition, raw: any): Record<string, boolean> {
  const allowed = new Set(itemsForPosition(p).map((i) => i.key));
  const out: Record<string, boolean> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) if (allowed.has(k)) out[k] = !!v;
  }
  return out;
}

// The single catalog item backing a gate (used by the Phase 2 access checks).
export function itemForGate(gate: DelegationGate): DelegationItem | undefined {
  return DELEGATION_CATALOG.find((i) => i.gate === gate);
}

// Does a position cover the complexity of an item? A TS (high) covers moderate too;
// a TC covers moderate only. CC and GS are position-specific, not complexity-scaled here.
export function positionCoversComplexity(p: DelegationPosition, itemComplexity: DelegationComplexity): boolean {
  if (p === "technical_supervisor" || p === "general_supervisor") return true; // high-qualified, covers moderate
  if (p === "technical_consultant") return itemComplexity === "moderate";
  return true; // clinical_consultant: not complexity-scaled
}
