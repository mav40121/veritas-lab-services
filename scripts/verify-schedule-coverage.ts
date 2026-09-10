// Verify receipt for VeritaShift Scheduler coverage-gap logic.
// Run: npx tsx scripts/verify-schedule-coverage.ts
import { computeCoverageGaps, type ShiftDef, type Assignment, type DeptRequirement } from "../server/schedule";

let pass = 0, fail = 0;
const assert = (n: string, c: boolean) => { console.log((c ? "PASS" : "FAIL") + ": " + n); c ? pass++ : fail++; };

const shifts: ShiftDef[] = [
  { id: 1, name: "Day", min_staff: 1 },
  { id: 2, name: "Night", min_staff: 2 },
];
const start = "2026-08-24", end = "2026-08-25"; // Mon-Tue

// Full coverage across both days.
const full: Assignment[] = [
  { shift_def_id: 1, work_date: "2026-08-24" },
  { shift_def_id: 2, work_date: "2026-08-24" }, { shift_def_id: 2, work_date: "2026-08-24" },
  { shift_def_id: 1, work_date: "2026-08-25" },
  { shift_def_id: 2, work_date: "2026-08-25" }, { shift_def_id: 2, work_date: "2026-08-25" },
];
assert("full coverage -> 0 gaps", computeCoverageGaps(shifts, full, start, end).length === 0);

// Monday night short by one (1 of 2 required).
const shortMonNight: Assignment[] = [
  { shift_def_id: 1, work_date: "2026-08-24" },
  { shift_def_id: 2, work_date: "2026-08-24" },
  { shift_def_id: 1, work_date: "2026-08-25" },
  { shift_def_id: 2, work_date: "2026-08-25" }, { shift_def_id: 2, work_date: "2026-08-25" },
];
const g = computeCoverageGaps(shifts, shortMonNight, start, end);
assert("night short by one -> exactly 1 gap", g.length === 1);
assert("gap names Mon night, 1 of 2", g[0].date === "2026-08-24" && g[0].shift_def_id === 2 && g[0].assigned === 1 && g[0].required === 2);

// Empty schedule -> a gap for every date x shift (2 days x 2 shifts).
assert("empty -> 4 gaps", computeCoverageGaps(shifts, [], start, end).length === 4);

// Single-day period checks each shift once.
assert("single day -> 2 gaps when empty", computeCoverageGaps(shifts, [], "2026-08-24", "2026-08-24").length === 2);

// Over-coverage never produces a gap.
const over: Assignment[] = [{ shift_def_id: 1, work_date: "2026-08-24" }, { shift_def_id: 1, work_date: "2026-08-24" }];
assert("over-coverage -> 0 gaps", computeCoverageGaps([{ id: 1, name: "Day", min_staff: 1 }], over, "2026-08-24", "2026-08-24").length === 0);

// ── Phase 3: department/bench-level coverage ──────────────────────────────
// Backward compatibility: passing no requirements leaves shift-level behavior
// exactly as before (the four assertions above already exercise the no-arg path).
const day: ShiftDef[] = [{ id: 1, name: "Day", min_staff: 1 }];
const oneDay = "2026-08-24";

// A Day shift that needs 1 Chemistry and 1 Micro, but only Chemistry is staffed.
const reqs: DeptRequirement[] = [
  { shift_def_id: 1, department: "Chemistry", min_staff: 1 },
  { shift_def_id: 1, department: "Micro", min_staff: 1 },
];
const chemOnly: Assignment[] = [{ shift_def_id: 1, work_date: oneDay, department: "Chemistry" }];
const gd = computeCoverageGaps(day, chemOnly, oneDay, oneDay, reqs);
assert("dept: shift-level met (1>=1) so no null-dept gap", gd.filter((x) => x.department == null).length === 0);
assert("dept: exactly one dept gap", gd.filter((x) => x.department != null).length === 1);
assert("dept: the gap is Micro 0 of 1", gd.some((x) => x.department === "Micro" && x.assigned === 0 && x.required === 1));

// Both departments staffed -> no dept gaps.
const bothDepts: Assignment[] = [
  { shift_def_id: 1, work_date: oneDay, department: "Chemistry" },
  { shift_def_id: 1, work_date: oneDay, department: "Micro" },
];
assert("dept: both benches met -> 0 gaps", computeCoverageGaps(day, bothDepts, oneDay, oneDay, reqs).length === 0);

// An assignment with no department does NOT satisfy a department requirement.
const noDept: Assignment[] = [{ shift_def_id: 1, work_date: oneDay, department: null }];
const gnd = computeCoverageGaps(day, noDept, oneDay, oneDay, reqs);
assert("dept: null-department assignment does not count toward a bench", gnd.filter((x) => x.department != null).length === 2);

// Requirements for a shift not present in shiftDefs are simply ignored (no crash).
assert("dept: requirement for absent shift is ignored", computeCoverageGaps(day, bothDepts, oneDay, oneDay, [{ shift_def_id: 99, department: "Blood Bank", min_staff: 1 }]).length === 0);

// ── Phase 3b: competency-aware bench coverage ─────────────────────────────
// A Day shift needs 1 Chemistry; two staff are assigned to Chemistry, but only
// staff 7 is competent in Chemistry. staff 8 is not.
const chemReq: DeptRequirement[] = [{ shift_def_id: 1, department: "Chemistry", min_staff: 1 }];
const competentChem = new Map<string, Set<number>>([["chemistry", new Set([7])]]);

// Backward compatibility: omitting the competency map counts everyone (Phase 3).
const twoChemMixed: Assignment[] = [
  { shift_def_id: 1, work_date: oneDay, department: "Chemistry", staff_employee_id: 7 },
  { shift_def_id: 1, work_date: oneDay, department: "Chemistry", staff_employee_id: 8 },
];
assert("comp: no map -> both count, bench met (Phase 3 unchanged)", computeCoverageGaps(day, twoChemMixed, oneDay, oneDay, chemReq).length === 0);

// With the map, only the competent staff (7) counts: 1 of 1 -> still met.
assert("comp: competent staff counts -> bench met", computeCoverageGaps(day, twoChemMixed, oneDay, oneDay, chemReq, competentChem).length === 0);

// Only the non-competent staff (8) is on the bench -> competent count 0 -> gap.
const onlyIncompetent: Assignment[] = [{ shift_def_id: 1, work_date: oneDay, department: "Chemistry", staff_employee_id: 8 }];
const gInc = computeCoverageGaps(day, onlyIncompetent, oneDay, oneDay, chemReq, competentChem);
assert("comp: non-competent assignment -> bench gap 0 of 1", gInc.some((x) => x.department === "Chemistry" && x.assigned === 0 && x.required === 1));
assert("comp: shift-level still met (a body is present)", gInc.filter((x) => x.department == null).length === 0);

// The competency lookup tolerates case/whitespace between the scheduler's bench
// name and the VeritaComp department key (the helper stores LOWER(TRIM) keys).
// (The assignment<->requirement match itself is exact, per Phase 3, so keep the
// same bench string on both sides.)
const chemUpper: Assignment[] = [{ shift_def_id: 1, work_date: oneDay, department: "CHEMISTRY", staff_employee_id: 7 }];
const chemReqUpper: DeptRequirement[] = [{ shift_def_id: 1, department: "CHEMISTRY", min_staff: 1 }];
assert("comp: competency lookup is case-insensitive vs VeritaComp key", computeCoverageGaps(day, chemUpper, oneDay, oneDay, chemReqUpper, competentChem).length === 0);

// A competent set that lacks the assigned staff id -> no one counts -> gap.
const competentOther = new Map<string, Set<number>>([["chemistry", new Set([99])]]);
assert("comp: empty/mismatched competent set -> bench gap", computeCoverageGaps(day, twoChemMixed, oneDay, oneDay, chemReq, competentOther).some((x) => x.department === "Chemistry" && x.assigned === 0));

// An assignment with a null staff_employee_id never counts under competency.
const nullStaff: Assignment[] = [{ shift_def_id: 1, work_date: oneDay, department: "Chemistry", staff_employee_id: null }];
assert("comp: null staff id -> does not count toward bench", computeCoverageGaps(day, nullStaff, oneDay, oneDay, chemReq, competentChem).some((x) => x.department === "Chemistry" && x.assigned === 0));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
