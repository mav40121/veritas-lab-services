// server/veritapolicyTracker.ts
//
// The VeritaDC policy tracker: the master list plus the lab's custom policies, overlaid with what the lab saved in
// veritapolicy_master_status. One definition, so the screen, its summary and the readiness PDF can't disagree. The PDF read
// veritapolicy_requirement_status until 2026-11-05, which nothing on the screen writes, so every lab's report said Not
// Started and 0% whatever it had entered.

import { VERITAPOLICY_MASTER_LIST } from "./veritapolicyMasterList";

const AO_COLUMNS = [
  { flag: "accreditation_tjc", key: "tjc_citations", label: "TJC" },
  { flag: "accreditation_cap", key: "cap_citations", label: "CAP" },
  { flag: "accreditation_cola", key: "cola_citations", label: "COLA" },
  { flag: "accreditation_aabb", key: "aabb_citations", label: "AABB" },
] as const;

export interface VeritaPolicyTrackerRow {
  policy_id: string;
  policy_name: string;
  section: string;
  subspecialty: string;
  service_line: string;
  description: string;
  cfr_citations: string;
  ao_citations: Array<{ label: string; value: string }>;
  notes: string;
  status: string;
  is_na: boolean;
  na_reason: string | null;
  our_policy_name: string | null;
  user_notes: string | null;
  updated_at: string | null;
  is_custom: boolean;
}

/**
 * The tracker for a lab. The lab's accreditor flags pick the citation columns. An account with no lab reads its statuses by
 * owner, and has no custom policies, which belong to a lab.
 */
export function veritaPolicyTracker(sqlite: any, lab: any, ownerUserId: number) {
  const aoCols = AO_COLUMNS.filter((a) => lab?.[a.flag]);
  const statuses = (lab?.id
    ? sqlite.prepare("SELECT * FROM veritapolicy_master_status WHERE lab_id = ?").all(lab.id)
    : sqlite.prepare("SELECT * FROM veritapolicy_master_status WHERE user_id = ?").all(ownerUserId)) as any[];
  const saved = new Map<string, any>(statuses.map((s) => [String(s.policy_id), s]));
  const overlay = (policyId: string) => {
    const us = saved.get(policyId);
    const isNa = !!us?.is_na;
    return {
      status: isNa ? "na" : (us?.status || "not_started"),
      is_na: isNa,
      na_reason: us?.na_reason || null,
      our_policy_name: us?.our_policy_name || null,
      user_notes: us?.notes || null,
      updated_at: us?.updated_at || null,
    };
  };
  const citations = (source: any) => aoCols.map((a) => ({ label: a.label, value: source[a.key] || "" }));

  const rows: VeritaPolicyTrackerRow[] = VERITAPOLICY_MASTER_LIST.map((p) => ({
    policy_id: p.policy_id,
    policy_name: p.policy_name,
    section: p.section,
    subspecialty: p.subspecialty,
    service_line: p.service_line,
    description: p.description,
    cfr_citations: p.cfr_citations,
    ao_citations: citations(p),
    notes: p.notes || "",
    ...overlay(p.policy_id),
    is_custom: false,
  }));
  // The lab's custom policy entries (policies not on the built-in catalog).
  const customEntries = (lab?.id ? sqlite.prepare("SELECT * FROM veritapolicy_custom_entries WHERE lab_id = ? ORDER BY id").all(lab.id) : []) as any[];
  for (const ce of customEntries) {
    const policyId = `custom-${ce.id}`;
    rows.push({
      policy_id: policyId,
      policy_name: ce.policy_name,
      section: ce.section || "Custom",
      subspecialty: "",
      service_line: ce.service_line || "all",
      description: ce.description || "",
      cfr_citations: ce.cfr_citations || "",
      ao_citations: citations(ce),
      notes: ce.notes || "",
      ...overlay(policyId),
      is_custom: true,
    });
  }
  return {
    rows,
    ao_label: aoCols.length === 0 ? "CLIA only" : aoCols.map((a) => a.label).join(", "),
    ao_columns: aoCols.map((a) => a.label),
  };
}

/** The readiness numbers on the screen: complete over applicable, with N/A left out of the denominator. */
export function veritaPolicyTrackerSummary(rows: VeritaPolicyTrackerRow[]) {
  let complete = 0, in_progress = 0, not_started = 0, na = 0;
  for (const r of rows) {
    if (r.is_na) na += 1;
    else if (r.status === "complete") complete += 1;
    else if (r.status === "in_progress") in_progress += 1;
    else not_started += 1;
  }
  const total = rows.length;
  const applicable = total - na;
  const score = applicable > 0 ? Math.round((complete / applicable) * 100) : 0;
  return { total, complete, in_progress, not_started, na, applicable, score };
}
