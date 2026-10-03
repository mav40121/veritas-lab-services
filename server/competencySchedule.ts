// Competency due-date scheduling engine.
//
// Sources: reference_competency_cadence_matrix memory; CLIA 42 CFR 493.1235 (CFR-0163:
// "six months after initial training, again at twelve months from start of patient
// testing, and at least annually thereafter"); TJC published interval tolerances
// (6mo = +20d, 12mo = +30d, expressed as a late ceiling); NYS CLEP 10 NYCRR 58-1.2(d)
// (semiannual = twice per calendar year, 4-8 months apart).
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

export type CompetencyMilestone = "initial" | "six_month" | "first_annual" | "annual";

export interface NextDueInput {
  recordedMilestone: CompetencyMilestone;
  recordedDate: string;              // ISO (YYYY-MM-DD)
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

  // NON-WAIVED national only (CLIA/TJC/CAP): chained from the recorded date.
  const target = addMonthsIso(d, months);
  return { nextMilestone: next, targetDate: target, earliest: null,
    latest: tjc ? addDaysIso(target, tjcTolDays(months)) : target,
    rule: tjc
      ? `${accLabel}: ${months} months from the recorded ${m}, plus ${tjcTolDays(months)} days`
      : `${accLabel}: ${months} months from the recorded ${m} (no published day tolerance; target is the due date)` };
}
