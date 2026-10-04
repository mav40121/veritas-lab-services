// Receipt for server/competencySchedule.ts (Gate 3). Asserts the regulatory dates for
// every branch, including the NYS+TJC dual (hire-anchored, stricter ceiling binds) and
// Michael's May(Y1) -> January(Y2) NYS proof. Run:
//   node_modules/.bin/tsx scripts/verify-competency-cadence.ts
import { nextCompetencyDue, validMilestonesFor, competencyDueColumns, competencySeedAtCreate } from "../server/competencySchedule";

let pass = 0, fail = 0;
function eq(label: string, got: any, want: any) {
  const pick = (o: any) => ({ nextMilestone: o.nextMilestone, targetDate: o.targetDate, earliest: o.earliest, latest: o.latest });
  const g = JSON.stringify(pick(got)), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        got : ${g}\n        want: ${w}`); }
}
function truthy(label: string, cond: boolean) { if (cond) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label}`); } }
const r = nextCompetencyDue;
const D = "2026-05-15"; // recorded date == hire for the simple cases

console.log("--- WAIVED (all bodies): Initial/annual -> annual (+12) ---");
eq("waived initial -> annual (CLIA, no grace)", r({ recordedMilestone: "initial", recordedDate: D, highestComplexity: "W", accreditor: "CLIA" }),
  { nextMilestone: "annual", targetDate: "2027-05-15", earliest: null, latest: "2027-05-15" });
eq("waived annual -> annual (TJC +30d)", r({ recordedMilestone: "annual", recordedDate: D, highestComplexity: "WAIVED", accreditor: "TJC" }),
  { nextMilestone: "annual", targetDate: "2027-05-15", earliest: null, latest: "2027-06-14" });

console.log("--- NON-WAIVED, national only, chained from recorded ---");
eq("CLIA initial -> 6-month (ceiling = target, no grace)", r({ recordedMilestone: "initial", recordedDate: D, highestComplexity: "H", accreditor: "CLIA" }),
  { nextMilestone: "six_month", targetDate: "2026-11-15", earliest: null, latest: "2026-11-15" });
eq("CLIA 6-month -> 1st annual (+6)", r({ recordedMilestone: "six_month", recordedDate: D, highestComplexity: "H", accreditor: "CLIA" }),
  { nextMilestone: "first_annual", targetDate: "2026-11-15", earliest: null, latest: "2026-11-15" });
eq("CLIA 1st annual -> annual (+12)", r({ recordedMilestone: "first_annual", recordedDate: D, highestComplexity: "H", accreditor: "CLIA" }),
  { nextMilestone: "annual", targetDate: "2027-05-15", earliest: null, latest: "2027-05-15" });
eq("TJC initial -> 6-month (+6, +20d)", r({ recordedMilestone: "initial", recordedDate: D, highestComplexity: "H", accreditor: "TJC" }),
  { nextMilestone: "six_month", targetDate: "2026-11-15", earliest: null, latest: "2026-12-05" });
eq("TJC 1st annual -> annual (+12, +30d)", r({ recordedMilestone: "first_annual", recordedDate: D, highestComplexity: "H", accreditor: "TJC" }),
  { nextMilestone: "annual", targetDate: "2027-05-15", earliest: null, latest: "2027-06-14" });
eq("CAP initial -> 6-month (no grace, like CLIA)", r({ recordedMilestone: "initial", recordedDate: D, highestComplexity: "H", accreditor: "CAP" }),
  { nextMilestone: "six_month", targetDate: "2026-11-15", earliest: null, latest: "2026-11-15" });

console.log("--- NON-WAIVED NYS (dual): hire-anchored, stricter ceiling binds ---");
// NYS+TJC initial: 6-month = hire+6 (Nov 15); NYS ceiling Dec 31, TJC ceiling Dec 5 -> TJC binds.
eq("NYS+TJC initial -> 6-month: hire+6, earliest hire+4, TJC ceiling (Dec 5) binds over NYS (Dec 31)",
  r({ recordedMilestone: "initial", recordedDate: D, hireDate: D, highestComplexity: "H", regime: "NYS-CLEP", accreditor: "TJC" }),
  { nextMilestone: "six_month", targetDate: "2026-11-15", earliest: "2026-09-15", latest: "2026-12-05" });
// NYS+CAP initial: no TJC day tolerance -> NYS calendar ceiling (Dec 31) binds.
eq("NYS+CAP initial -> 6-month: NYS Dec-31 ceiling binds",
  r({ recordedMilestone: "initial", recordedDate: D, hireDate: D, highestComplexity: "H", regime: "NYS-CLEP", accreditor: "CAP" }),
  { nextMilestone: "six_month", targetDate: "2026-11-15", earliest: "2026-09-15", latest: "2026-12-31" });
// Michael's proof: a second competency recorded in January (Y2) is past both ceilings -> overdue.
{
  const capNys = r({ recordedMilestone: "initial", recordedDate: D, hireDate: D, highestComplexity: "H", regime: "NYS-CLEP", accreditor: "CAP" });
  truthy("NYS proof: Jan-2027 second record is past the Dec-31 ceiling (overdue)", "2027-01-10" > (capNys.latest as string));
}
eq("NYS+TJC 6-month -> 1st annual: hire+12 (TJC +20d binds)",
  r({ recordedMilestone: "six_month", recordedDate: D, hireDate: D, highestComplexity: "H", regime: "NYS-CLEP", accreditor: "TJC" }),
  { nextMilestone: "first_annual", targetDate: "2027-05-15", earliest: null, latest: "2027-06-04" });
eq("NYS+TJC 1st annual -> annual: hire+24 (TJC +30d binds)",
  r({ recordedMilestone: "first_annual", recordedDate: D, hireDate: D, highestComplexity: "H", regime: "NYS-CLEP", accreditor: "TJC" }),
  { nextMilestone: "annual", targetDate: "2028-05-15", earliest: null, latest: "2028-06-14" });

console.log("--- milestone selector set ---");
eq("waived selector", { nextMilestone: validMilestonesFor("W").join(","), targetDate: null, earliest: null, latest: null }, { nextMilestone: "initial,annual", targetDate: null, earliest: null, latest: null });
eq("non-waived selector", { nextMilestone: validMilestonesFor("H").join(","), targetDate: null, earliest: null, latest: null }, { nextMilestone: "initial,six_month,first_annual,annual", targetDate: null, earliest: null, latest: null });

console.log("--- competencyDueColumns: DB-column projection used by every write path ---");
function eqCols(label: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        got : ${g}\n        want: ${w}`); }
}
// CLIA non-waived full chain. Proves the 1st-annual fix: six_month -> first_annual at +6,
// first_annual -> annual at +12. The OLD inline code skipped first_annual for CLIA.
eqCols("CLIA non-waived chain (initial/6mo/1st-annual recorded)",
  competencyDueColumns({ accreditor: "CLIA", nys: false, highestComplexity: "H", hireDate: "2026-05-15" },
    { initialCompletedAt: "2026-05-15", sixMonthCompletedAt: "2026-11-20", firstAnnualCompletedAt: "2027-05-25" }),
  { six_month_due_at: "2026-11-15", first_annual_due_at: "2027-05-20", annual_due_at: "2028-05-25", nys_six_month_due_at: null });
// Waived: NO 6-month, NO 1st-annual (over-application guard). initial -> annual at +12.
eqCols("waived: only annual, no 6-month / no 1st-annual column",
  competencyDueColumns({ accreditor: "CLIA", nys: false, highestComplexity: "W", hireDate: "2026-05-15" },
    { initialCompletedAt: "2026-05-15", sixMonthCompletedAt: "2026-11-20" }),
  { six_month_due_at: null, first_annual_due_at: null, annual_due_at: "2027-05-15", nys_six_month_due_at: null });
// NYS+TJC non-waived, initial recorded: six-month is HIRE-anchored (hire+6), legacy NYS column set too.
eqCols("NYS+TJC non-waived initial -> six_month hire-anchored (hire+6) + legacy NYS column",
  competencyDueColumns({ accreditor: "TJC", nys: true, highestComplexity: "H", hireDate: "2026-05-15" },
    { initialCompletedAt: "2026-06-01" }),
  { six_month_due_at: "2026-11-15", first_annual_due_at: null, annual_due_at: null, nys_six_month_due_at: "2026-11-15" });
// annual re-roll (lastAnnual recorded): annual_due_at = +12 from recorded.
eqCols("CLIA annual re-roll: lastAnnual recorded -> annual +12",
  competencyDueColumns({ accreditor: "CLIA", nys: false, highestComplexity: "M", hireDate: "2020-01-01" },
    { lastAnnualCompletedAt: "2026-05-15" }),
  { six_month_due_at: null, first_annual_due_at: null, annual_due_at: "2027-05-15", nys_six_month_due_at: null });

console.log("--- competencySeedAtCreate: only NYS non-waived is hire-anchored at create ---");
eqCols("NYS non-waived seed = hire+6 / hire+12 / hire+24",
  competencySeedAtCreate({ accreditor: "TJC", nys: true, highestComplexity: "H", hireDate: "2026-05-15" }),
  { six_month_due_at: "2026-11-15", first_annual_due_at: "2027-05-15", annual_due_at: "2028-05-15", nys_six_month_due_at: "2026-11-15" });
eqCols("non-NYS create seed = all null (waits for recorded initial)",
  competencySeedAtCreate({ accreditor: "CLIA", nys: false, highestComplexity: "H", hireDate: "2026-05-15" }),
  { six_month_due_at: null, first_annual_due_at: null, annual_due_at: null, nys_six_month_due_at: null });
eqCols("NYS waived create seed = all null (waived never hire-anchored)",
  competencySeedAtCreate({ accreditor: "TJC", nys: true, highestComplexity: "W", hireDate: "2026-05-15" }),
  { six_month_due_at: null, first_annual_due_at: null, annual_due_at: null, nys_six_month_due_at: null });

console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
