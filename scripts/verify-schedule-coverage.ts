// Verify receipt for VeritaShift Scheduler coverage-gap logic.
// Run: npx tsx scripts/verify-schedule-coverage.ts
import { computeCoverageGaps, type ShiftDef, type Assignment } from "../server/schedule";

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
