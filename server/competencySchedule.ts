// Competency due-date scheduling engine.
//
// Sources: CLIA 42 CFR 493.1451(b)(9) (high complexity) and 493.1413(b)(9) (moderate):
// "at least semiannually during the first year the individual tests patient specimens.
// Thereafter, evaluations must be performed at least annually unless test methodology or
// instrumentation changes ..."; 493.1445(e)(12) / 493.1407(e)(11) require the initial
// demonstration "prior to testing patients' specimens". (493.1235 is the written-policy
// standard only; it sets no interval.) TJC published interval tolerances (6mo = +20d,
// 12mo = +30d, expressed as a late ceiling); NYS CLEP 10 NYCRR 58-1.2(d) (semiannual =
// twice per calendar year, 4-8 months apart).
//
// The clock starts at the INITIAL competency, not the hire date (Michael, 2026-10-11):
// the initial has no deadline from hire, it only has to come before patient testing. The
// first year of patient testing runs initial -> initial + 12, so the 6-month is due at
// initial + 6 and the 1st annual (the second semiannual) at initial + 12, whatever day the
// 6-month was actually done. Annual after that.
//
// Given a competency just RECORDED (milestone + date), the employee's hire date and
// testing complexity, and the lab's accreditor + regime, returns the NEXT milestone with
// a TARGET date and the acceptable WINDOW (earliest..latest). "latest" is the late ceiling
// (overdue after it); "earliest" is a hard minimum (only NYS sets one). Pure + deterministic.
//
// Anchoring:
//   NON-WAIVED, national only (CLIA/TJC/CAP): chained from the RECORDED date.
//   NON-WAIVED, NYS (always DUAL with TJC/CAP): HIRE-anchored -- initial, then hire+6,
//     hire+12, annually. BOTH rule sets apply; the binding ceiling is the EARLIER of the
//     NYS calendar ceiling and the accreditor's day tolerance, and the minimum is the LATER.
//   WAIVED (all bodies): Initial -> annual (+12mo) thereafter. [TJC WT.03.01.01 EP 5]

import { alignAnnualToMonth } from "@shared/competencySignoff";

export type CompetencyMilestone = "initial" | "six_month" | "first_annual" | "annual";

export interface NextDueInput {
  recordedMilestone: CompetencyMilestone;
  recordedDate: string;              // ISO (YYYY-MM-DD)
  initialDate?: string | null;       // the recorded initial; pins the 1st annual to initial + 12
  hireDate?: string | null;
  highestComplexity?: string | null; // 'W'/'WAIVED' => waived
  accreditor?: string | null;        // 'TJC' | 'CAP' | 'COLA' | 'CLIA' ...
  regime?: string | null;            // 'NYS-CLEP' => NYS (dual with the accreditor)
}
export interface NextDueResult {
  nextMilestone: CompetencyMilestone | null;
  targetDate: string | null;
  earliest: string | null;
  latest: string | null;
  rule: string;
}

export const isWaivedComplexity = (c?: string | null): boolean => {
  const s = String(c ?? "").trim().toUpperCase(); return s === "W" || s === "WAIVED";
};
export const isNysRegime = (r?: string | null): boolean =>
  String(r ?? "").trim().toUpperCase() === "NYS-CLEP";
export const isTjc = (a?: string | null): boolean =>
  String(a ?? "").trim().toUpperCase() === "TJC";

export function validMilestonesFor(highestComplexity?: string | null): CompetencyMilestone[] {
  return isWaivedComplexity(highestComplexity)
    ? ["initial", "annual"]
    : ["initial", "six_month", "first_annual", "annual"];
}

function toUtc(iso: string): Date {
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00Z" : iso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date ${iso}`);
  return d;
}
export function addMonthsIso(iso: string, months: number): string {
  const d = toUtc(iso); const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10);
}
export function addDaysIso(iso: string, days: number): string {
  const d = toUtc(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
const endOfYearIso = (iso: string): string => `${toUtc(iso).getUTCFullYear()}-12-31`;
const minIso = (a: string, b: string): string => (a <= b ? a : b);
const maxIso = (a: string | null, b: string | null): string | null =>
  a == null ? b : b == null ? a : (a >= b ? a : b);

// Months since the prior milestone, for the TJC day-tolerance table.
const intervalMonths = (m: CompetencyMilestone): number =>
  m === "initial" ? 6 : m === "six_month" ? 6 : 12;
const nextOf = (m: CompetencyMilestone): CompetencyMilestone =>
  m === "initial" ? "six_month" : m === "six_month" ? "first_annual" : "annual";
const tjcTolDays = (months: number): number => (months >= 12 ? 30 : months >= 6 ? 20 : 10);

export function nextCompetencyDue(input: NextDueInput): NextDueResult {
  const { recordedMilestone: m, recordedDate: d, hireDate } = input;
  const waived = isWaivedComplexity(input.highestComplexity);
  const nys = isNysRegime(input.regime);
  const tjc = isTjc(input.accreditor);
  const accLabel = String(input.accreditor ?? "").trim().toUpperCase() || "CLIA";

  // WAIVED (all bodies): Initial -> annual (+12mo) thereafter.
  if (waived) {
    const target = addMonthsIso(d, 12);
    return { nextMilestone: "annual", targetDate: target, earliest: null,
      latest: tjc ? addDaysIso(target, 30) : target,
      rule: "waived: annual, 12 months after the recorded competency" };
  }

  const next = nextOf(m);
  const months = intervalMonths(m);

  // NON-WAIVED NYS (dual): hire-anchored targets, NYS calendar ceiling + accreditor tolerance.
  if (nys) {
    const a = hireDate || d;
    let target: string, earliest: string | null = null, nysCeil: string;
    switch (m) {
      case "initial":
        target = addMonthsIso(a, 6);
        earliest = addMonthsIso(a, 4); // NYS: no closer than 4 months
        nysCeil = minIso(addMonthsIso(a, 8), endOfYearIso(a)); // 4-8mo AND twice per calendar year
        break;
      case "six_month":    target = addMonthsIso(a, 12); nysCeil = endOfYearIso(target); break;
      case "first_annual": target = addMonthsIso(a, 24); nysCeil = endOfYearIso(target); break;
      default:             target = addMonthsIso(d, 12); nysCeil = endOfYearIso(target); break; // annual thereafter
    }
    if (nysCeil < target) nysCeil = target; // late-year-hire grace: ceiling never precedes the target
    const tjcCeil = tjc ? addDaysIso(target, tjcTolDays(months)) : null;
    const latest = tjcCeil ? minIso(nysCeil, tjcCeil) : nysCeil;
    const binds = tjcCeil && tjcCeil <= nysCeil ? accLabel : "NYS";
    return { nextMilestone: next, targetDate: target, earliest, latest,
      rule: `NYS + ${accLabel}: hire-anchored; due by the earlier of the NYS calendar ceiling and the ${accLabel} tolerance (${binds} binds)` };
  }

  // NON-WAIVED national only (CLIA/TJC/CAP): chained from the recorded date, except the
  // 1st annual, which closes the first year of patient testing and so is pinned to the
  // initial + 12 months (a late or early 6-month does not move it). If the 6-month was
  // only done at or after initial + 12, the first year has already closed and the next
  // one is due 6 months after it.
  let target = addMonthsIso(d, months);
  if (m === "six_month" && input.initialDate) {
    const pinned = addMonthsIso(input.initialDate, 12);
    if (pinned > d) target = pinned;
  }
  return { nextMilestone: next, targetDate: target, earliest: null,
    latest: tjc ? addDaysIso(target, tjcTolDays(months)) : target,
    rule: m === "six_month" && input.initialDate && target !== addMonthsIso(d, months)
      ? `${accLabel}: 12 months from the initial (closes the first year of patient testing)${tjc ? `, plus ${tjcTolDays(months)} days` : ""}`
      : tjc
      ? `${accLabel}: ${months} months from the recorded ${m}, plus ${tjcTolDays(months)} days`
      : `${accLabel}: ${months} months from the recorded ${m} (no published day tolerance; target is the due date)` };
}

// ── DB-column projection ────────────────────────────────────────────────────
// staff_competency_schedules carries one due column per milestone. Given the
// recorded completion dates, this maps each present completion to the NEXT
// milestone's due date via nextCompetencyDue(). The stored value is the TARGET
// date (the scheduled due); the acceptable tolerance ceiling is a property of
// the engine result, not a stored column. This is the single source the
// recording endpoints and the create-time seed both call, so every write path
// produces the same regulation-correct dates.
//
// Milestone -> column:
//   initial      -> six_month_due_at   (non-waived)  |  annual_due_at (waived)
//   six_month    -> first_annual_due_at (non-waived only; initial + 12 when the initial is on file)
//   first_annual -> annual_due_at      (non-waived only)
//   annual       -> annual_due_at      (re-rolls annually)
// Waived testers (TJC WT.03.01.01 EP 5) have NO 6-month and NO 1st-annual, so
// those columns stay null -- this is what stops the 6-month from being
// over-applied to waived-only staff.

export interface CompetencyCompletions {
  initialCompletedAt?: string | null;
  sixMonthCompletedAt?: string | null;
  firstAnnualCompletedAt?: string | null;
  lastAnnualCompletedAt?: string | null;
}
export interface CompetencyLabContext {
  accreditor?: string | null;        // lab.accreditation_body
  nys?: boolean;                     // lab.includes_nys === 1
  highestComplexity?: string | null; // staff_employees.highest_complexity
  hireDate?: string | null;          // staff_employees.hire_date
  annualMonth?: number | null;       // staff_labs.competency_annual_month: repeat annuals move EARLIER into this month
}
export interface CompetencyDueColumns {
  six_month_due_at: string | null;
  first_annual_due_at: string | null;
  annual_due_at: string | null;
  nys_six_month_due_at: string | null;
}

export function competencyDueColumns(lab: CompetencyLabContext, comp: CompetencyCompletions): CompetencyDueColumns {
  const regime = lab.nys ? "NYS-CLEP" : null;
  const waived = isWaivedComplexity(lab.highestComplexity);
  const base = {
    hireDate: lab.hireDate ?? null,
    highestComplexity: lab.highestComplexity ?? null,
    accreditor: lab.accreditor ?? null,
    regime,
  };
  const out: CompetencyDueColumns = {
    six_month_due_at: null, first_annual_due_at: null,
    annual_due_at: null, nys_six_month_due_at: null,
  };

  if (comp.initialCompletedAt) {
    const r = nextCompetencyDue({ recordedMilestone: "initial", recordedDate: comp.initialCompletedAt, ...base });
    if (r.nextMilestone === "annual") out.annual_due_at = r.targetDate; // waived path
    else out.six_month_due_at = r.targetDate;                          // non-waived
  }
  if (!waived && comp.sixMonthCompletedAt) {
    const r = nextCompetencyDue({ recordedMilestone: "six_month", recordedDate: comp.sixMonthCompletedAt, initialDate: comp.initialCompletedAt ?? null, ...base });
    out.first_annual_due_at = r.targetDate;
  }
  if (!waived && comp.firstAnnualCompletedAt) {
    const r = nextCompetencyDue({ recordedMilestone: "first_annual", recordedDate: comp.firstAnnualCompletedAt, ...base });
    out.annual_due_at = r.targetDate;
  }
  if (comp.lastAnnualCompletedAt) {
    const r = nextCompetencyDue({ recordedMilestone: "annual", recordedDate: comp.lastAnnualCompletedAt, ...base });
    out.annual_due_at = r.targetDate;
  }
  // Lab annual month (Michael Q157 = 1): the repeat annual moves earlier into the lab's month, never later.
  if (lab.annualMonth) out.annual_due_at = alignAnnualToMonth(out.annual_due_at, lab.annualMonth);

  // Legacy NYS six-month column (hire-anchored). The worklist reads
  // six_month_due_at, not this, but it is kept populated for back-compat on
  // NYS non-waived staff. Hire-anchored, so it does not need a recorded date.
  if (lab.nys && !waived && lab.hireDate) {
    const r = nextCompetencyDue({ recordedMilestone: "initial", recordedDate: lab.hireDate, ...base });
    out.nys_six_month_due_at = r.targetDate;
  }
  return out;
}

// Create-time seed. Nothing is recorded yet, so the only due dates that are
// knowable at hire are the NYS hire-anchored chain (hire+6, hire+12, hire+24)
// for NYS NON-waived staff. Every other case (national-only, or waived) waits
// for the recorded initial competency, so those columns stay null. This
// replaces the old blanket hire+6/+12/+24 seed that over-applied to everyone.
export function competencySeedAtCreate(lab: CompetencyLabContext): CompetencyDueColumns {
  const out: CompetencyDueColumns = {
    six_month_due_at: null, first_annual_due_at: null,
    annual_due_at: null, nys_six_month_due_at: null,
  };
  if (!lab.nys || isWaivedComplexity(lab.highestComplexity) || !lab.hireDate) return out;
  const base = { hireDate: lab.hireDate, highestComplexity: lab.highestComplexity ?? null, accreditor: lab.accreditor ?? null, regime: "NYS-CLEP" as const };
  out.six_month_due_at   = nextCompetencyDue({ recordedMilestone: "initial",      recordedDate: lab.hireDate, ...base }).targetDate; // hire+6
  out.first_annual_due_at = nextCompetencyDue({ recordedMilestone: "six_month",    recordedDate: lab.hireDate, ...base }).targetDate; // hire+12
  out.annual_due_at      = alignAnnualToMonth(nextCompetencyDue({ recordedMilestone: "first_annual", recordedDate: lab.hireDate, ...base }).targetDate, lab.annualMonth); // hire+24, in the lab's annual month when set
  out.nys_six_month_due_at = out.six_month_due_at;
  return out;
}
