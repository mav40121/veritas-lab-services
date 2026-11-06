// shared/competencyNontechnicalFrequency.ts
//
// How often non-technical competency comes due at a site (Michael 2026-11-04: "The sites shoudl be able to set frequency",
// go Q216 = 1, 2026-11-06). One setting per lab, labs.competency_nontechnical_months. Blank means not set, and a non-technical
// record then has no due date, as it always has. A new-hire evaluation is a non-technical program with its own hire-date clock
// and isn't covered. Technical and waived competency timing, 42 CFR 493.1451(b)(9) and 493.1413(b)(9), doesn't read this.

export const NONTECHNICAL_FREQUENCY_MONTHS = [12, 24, 36] as const;

export const isNontechnicalFrequency = (m: unknown): m is number =>
  (NONTECHNICAL_FREQUENCY_MONTHS as readonly number[]).includes(m as number);

const FREQUENCY_PROBLEM = `Choose every ${NONTECHNICAL_FREQUENCY_MONTHS.slice(0, -1).join(", ")} or ${NONTECHNICAL_FREQUENCY_MONTHS[NONTECHNICAL_FREQUENCY_MONTHS.length - 1]} months, or leave it blank.`;

/** What a save asked for: null clears the setting. A request that leaves the value out is refused, so it can't clear it by accident. */
export function parseNontechnicalFrequency(raw: unknown): { months: number | null } | { error: string } {
  if (raw === null || raw === "") return { months: null };
  if (raw === undefined || typeof raw === "boolean" || Array.isArray(raw)) return { error: FREQUENCY_PROBLEM };
  const n = Number(raw);
  return isNontechnicalFrequency(n) ? { months: n } : { error: FREQUENCY_PROBLEM };
}

export const NONTECHNICAL_FREQUENCY_NOT_SET = "Not set: no due dates";

export const nontechnicalFrequencyLabel = (months: number | null | undefined): string =>
  months ? `Every ${months} months` : NONTECHNICAL_FREQUENCY_NOT_SET;

// Same names as the technical status buckets (server/competencyReminders.ts CompetencyBucket).
export type NontechnicalBucket = "overdue" | "dueSoon30" | "dueSoon90" | "compliant";

/** One person on one non-technical program. */
export interface NontechnicalDueItem {
  programId: number;
  programName: string;
  department: string | null;
  employeeId: number;               // competency_employees.id, what a program's roster lists
  staffEmployeeId: number | null;   // staff_employees.id when linked
  name: string;
  title: string | null;
  lastPassDate: string | null;
  nextDue: string;
  daysUntil: number;                // negative = overdue by that many days
  bucket: NontechnicalBucket;
  remediationOpen: boolean;         // the newest signed record is a Fail or Remediation Required
  reason: string;
}

export interface NontechnicalDueCounts { overdue: number; dueSoon: number; current: number; total: number }
export interface NontechnicalDueResponse { months: number | null; today: string; items: NontechnicalDueItem[]; counts: NontechnicalDueCounts }

export function nontechnicalDueCounts(items: Array<{ bucket: NontechnicalBucket }>): NontechnicalDueCounts {
  const overdue = items.filter((i) => i.bucket === "overdue").length;
  const dueSoon = items.filter((i) => i.bucket === "dueSoon30" || i.bucket === "dueSoon90").length;
  return { overdue, dueSoon, current: items.length - overdue - dueSoon, total: items.length };
}
