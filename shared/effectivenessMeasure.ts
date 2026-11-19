// shared/effectivenessMeasure.ts
//
// Measured effectiveness monitoring on a VeritaResponse finding (Lifepoint ask, Michael 2026-11-19: "would be great to
// build monitoring in for action plans"). The lab says what it audits, the target compliance rate and, if it wants, how
// many it audits each time; each checkpoint records how many were audited and how many were compliant. A checkpoint at
// or above the target reads effective, below it not effective (which reopens a closed finding, as before). The target
// is the lab's own: The Joint Commission no longer runs a Measure of Success in its post-survey follow-up, so nothing
// here states a required rate. The server and the screen both decide through these functions.

export interface MonitoringSchedule { key: string; label: string; intervals: number[] }

export const MONITORING_SCHEDULES: readonly MonitoringSchedule[] = [
  { key: "30-60-90", label: "30, 60 and 90 days", intervals: [30, 60, 90] },
  { key: "monthly-4", label: "Monthly for 4 months", intervals: [30, 60, 90, 120] },
  { key: "monthly-6", label: "Monthly for 6 months", intervals: [30, 60, 90, 120, 150, 180] },
];
export const DEFAULT_SCHEDULE_KEY = "30-60-90";

export function scheduleIntervals(key: unknown): number[] | null {
  const s = MONITORING_SCHEDULES.find((x) => x.key === key);
  return s ? [...s.intervals] : null;
}

export interface MonitoringPlan { measure: string | null; targetPct: number | null; sample: number | null }

// Reads and checks a plan sent by the screen. Blank fields are allowed (null); a target must be a whole number from 1 to
// 100 and a sample a whole number from 1 to 10,000. Returns an error message for the first bad field.
export function parseMonitoringPlan(body: any): { ok: true; plan: MonitoringPlan } | { ok: false; error: string } {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null);
  const int = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
  const target = int(body?.target_pct);
  if (target !== null && !(Number.isInteger(target) && target >= 1 && target <= 100)) {
    return { ok: false, error: "The target must be a whole number from 1 to 100 percent." };
  }
  const sample = int(body?.sample);
  if (sample !== null && !(Number.isInteger(sample) && sample >= 1 && sample <= 10000)) {
    return { ok: false, error: "The sample must be a whole number from 1 to 10,000." };
  }
  return { ok: true, plan: { measure: text(body?.measure), targetPct: target, sample } };
}

// Audited and compliant counts for one checkpoint. Both whole numbers; audited at least 1; compliant 0 to audited.
export function parseCounts(audited: unknown, compliant: unknown): { ok: true; audited: number; compliant: number } | { ok: false; error: string } {
  const a = Number(audited), c = Number(compliant);
  if (!Number.isInteger(a) || a < 1 || a > 100000) return { ok: false, error: "Audited must be a whole number of at least 1." };
  if (!Number.isInteger(c) || c < 0) return { ok: false, error: "Compliant must be a whole number of 0 or more." };
  if (c > a) return { ok: false, error: "Compliant can't be more than audited." };
  return { ok: true, audited: a, compliant: c };
}

// The compliance rate in percent, one decimal place.
export function complianceRate(audited: number, compliant: number): number {
  return Math.round((compliant / audited) * 1000) / 10;
}

// Effective when the rate meets the target. Compared on the counts, not the rounded rate, so 899 of 1,000 against a
// 90% target is below it.
export function measuredStatus(audited: number, compliant: number, targetPct: number): "effective" | "not_effective" {
  return compliant * 100 >= targetPct * audited ? "effective" : "not_effective";
}

export interface CheckLike { status: string; audited_count?: number | null; compliant_count?: number | null }

// One line for the panel: how far monitoring has got and how the recorded checkpoints did.
export function monitoringSummary(checks: CheckLike[], targetPct: number | null): string {
  if (!checks.length) return "";
  const done = checks.filter((c) => c.status !== "pending");
  const missed = done.filter((c) => c.status === "not_effective").length;
  if (done.length === 0) return `${checks.length} checkpoints scheduled; none recorded yet.`;
  const target = targetPct ? ` the ${targetPct}% target` : "";
  if (done.length === checks.length) {
    return missed === 0
      ? `Monitoring complete: all ${checks.length} checkpoints ${targetPct ? `met${target}` : "were effective"}.`
      : `Monitoring complete: ${missed} of ${checks.length} checkpoints ${targetPct ? `fell below${target}` : "were not effective"}.`;
  }
  return `${done.length} of ${checks.length} checkpoints recorded; ${missed === 0 ? (targetPct ? `all met${target}` : "all effective") : `${missed} ${targetPct ? `below${target}` : "not effective"}`}.`;
}
