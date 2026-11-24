// The cross-lab list of open findings (Sanford program B2, 2026-11-24; server/systemFindings.ts). Pure helpers, so
// scripts/verify-readiness-rollup.mts exercises what the page filters by. The server already cut the list to the labs the
// reader's roll-up holds; a filter only takes rows away.
import { findingTemplate } from "@shared/findingTypes";
import { filterRollupByGroup, type RollupGroupRef, type RollupLab } from "@/lib/readinessRollup";

export interface SystemFindingRow {
  id: number; lab_id: number; lab_name: string | null; organization_id: number | null;
  accreditor: string; source_type: string; finding_number: string | null; standard_ref: string | null;
  due_date: string | null; status: string; past_due: boolean; past_target: boolean;
}
export interface SystemFindingLab { lab_id: number; lab_name: string | null; clia_number: string | null; organization_id: number | null; organization_name: string | null }

export const FINDING_STATUS_LABEL: Record<string, string> = {
  open: "Open", drafting: "Drafting", submitted: "Submitted", accepted: "Accepted", rejected_resubmit: "Resubmit", closed: "Closed",
};

/** The accreditor column: the accreditor, or the entry's type when it isn't filed under one (as the VeritaResponse list shows it). */
export function accreditorLabel(f: { accreditor: string; source_type: string }): string {
  if (f.accreditor === "Other" && f.source_type && f.source_type !== "inspection") return findingTemplate(f.source_type).label;
  return f.accreditor === "ISO" ? "ISO 15189" : f.accreditor;
}

export interface FindingFilter { organizationId: number | null; group: "all" | "none" | number; accreditor: string | null }

/** Labs of the list left by the system and group filters. "none" is the labs in none of the groups. */
export function labsForFilter(labs: SystemFindingLab[], groups: RollupGroupRef[], f: Pick<FindingFilter, "organizationId" | "group">): SystemFindingLab[] {
  const scoped = f.organizationId == null ? labs : labs.filter((l) => (l.organization_id ?? null) === f.organizationId);
  if (f.group === "all") return scoped;
  return filterRollupByGroup(scoped as unknown as RollupLab[], groups, f.group) as unknown as SystemFindingLab[];
}

export function filterFindings(rows: SystemFindingRow[], labs: SystemFindingLab[], groups: RollupGroupRef[], f: FindingFilter): SystemFindingRow[] {
  const ids = new Set(labsForFilter(labs, groups, f).map((l) => l.lab_id));
  return rows.filter((r) => ids.has(r.lab_id) && (f.accreditor == null || accreditorLabel(r) === f.accreditor));
}
