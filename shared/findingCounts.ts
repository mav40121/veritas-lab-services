// shared/findingCounts.ts
//
// What the VeritaResponse list counts as open and as past its deadline. The rule was written inside
// client/src/pages/VeritaResponseAppPage.tsx; it lives here (2026-11-11) so the page and the compliance digest
// (server/digestCounts.ts) count findings by one rule.
//
// Audit #11: only CMS, CAP and TJC carry a hard regulatory response deadline, and ISO 15189 too (its due date is the
// one the accreditation body set, entered by the lab, #108). COLA is consultative and AABB's 45 days is the FDA
// reportable-event window, so their clocks are soft targets and never "overdue". A non-inspection entry type carries
// accreditor 'Other', a soft clock as well.

export const HARD_DEADLINE_ACCREDITORS: ReadonlySet<string> = new Set(["CMS", "CAP", "TJC", "ISO"]);
export const isHardDeadline = (accreditor: string | null | undefined): boolean => HARD_DEADLINE_ACCREDITORS.has(String(accreditor ?? ""));

/** Open until closed or accepted. */
export const isFindingOpen = (f: { status?: string | null }): boolean => f.status !== "closed" && f.status !== "accepted";

/** Open, on a hard-deadline clock, and its due date (YYYY-MM-DD) is before today (the lab's day). */
export function isFindingPastDue(f: { status?: string | null; accreditor?: string | null; due_date?: string | null }, todayIso: string): boolean {
  if (!f.due_date || !isFindingOpen(f) || !isHardDeadline(f.accreditor)) return false;
  return String(f.due_date).slice(0, 10) < todayIso;
}
