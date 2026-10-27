// scripts/verify-competency-import-clears-existing.ts
//
// Receipt for Michael Q12 = 1 (2026-10-27): the historical competency import fills each
// person's schedule from the records it loads (server/competencyImportSchedule.ts), so staff
// moved over from another system with passed competencies count as cleared for patient
// testing instead of reading as new hires. Exercises every branch of
// scheduleFromImportedHistory on known inputs.
// Run: npx tsx scripts/verify-competency-import-clears-existing.ts

import { scheduleFromImportedHistory, type ImportedCompetency } from "../server/competencyImportSchedule";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const row = (assessmentType: string, assessmentDate: string, status = "pass", evaluatorName = "T. Super"): ImportedCompetency => ({ assessmentType, assessmentDate, status, evaluatorName });
const H = { waived: false }, W = { waived: true };
const j = (v: unknown) => JSON.stringify(v);

// 1-2: nothing passed -> no change (the person stays not cleared)
check("1. orientation only -> no change", scheduleFromImportedHistory([row("orientation", "2026-09-01")], H) === null);
check("2. only fail / remediation rows -> no change",
  scheduleFromImportedHistory([row("annual", "2025-05-01", "fail"), row("initial", "2024-01-10", "remediation")], H) === null);

// 3-4: annual-like history -> Existing staff, clock from the latest; initial and 6-month left blank
const a3 = scheduleFromImportedHistory([row("annual", "2024-06-01", "pass", "Old Eval"), row("annual", "2026-03-15", "pass", "New Eval"), row("initial", "2012-07-01")], H);
check("3. two annuals + an old initial -> Existing staff, Most recent annual = 2026-03-15, initial/6-month blank",
  a3?.recordedAs === "existing" && a3.lastAnnualCompletedAt === "2026-03-15" && a3.lastAnnualSignedBy === "New Eval" && a3.initialCompletedAt === null && a3.sixMonthCompletedAt === null, j(a3));
const a4 = scheduleFromImportedHistory([row("reassessment", "2025-11-02"), row("duty_change", "2026-01-20")], H);
check("4. reassessment + duty change -> Existing staff from the latest (2026-01-20)", a4?.recordedAs === "existing" && a4.lastAnnualCompletedAt === "2026-01-20", j(a4));

// 5-6: first-year walk from the earliest initial
const a5 = scheduleFromImportedHistory([row("initial", "2026-05-01", "pass", "Init Eval"), row("initial", "2026-06-15"), row("6month", "2026-04-01"), row("6month", "2026-10-30", "pass", "Six Eval")], H);
check("5. initials + 6-month -> initial = earliest (2026-05-01), 6-month = first on/after it (2026-10-30), marking unchanged",
  a5?.recordedAs === null && a5.initialCompletedAt === "2026-05-01" && a5.initialSignedBy === "Init Eval" && a5.sixMonthCompletedAt === "2026-10-30" && a5.sixMonthSignedBy === "Six Eval" && a5.lastAnnualCompletedAt === null, j(a5));
const a6 = scheduleFromImportedHistory([row("initial", "2026-05-01"), row("6month", "2026-10-30")], W);
check("6. waived tester: initial kept, no 6-month (waived has none)", a6?.initialCompletedAt === "2026-05-01" && a6.sixMonthCompletedAt === null, j(a6));

// 7-8: 6-month with no initial -> Existing staff
const a7 = scheduleFromImportedHistory([row("6month", "2025-12-01"), row("6month", "2026-02-01")], H);
check("7. 6-month only -> Existing staff, clock from the latest 6-month (2026-02-01)", a7?.recordedAs === "existing" && a7.sixMonthCompletedAt === "2026-02-01" && a7.lastAnnualCompletedAt === null, j(a7));
const a8 = scheduleFromImportedHistory([row("6month", "2026-02-01")], W);
check("8. 6-month only, waived -> Existing staff, counted as the most recent competency", a8?.recordedAs === "existing" && a8.lastAnnualCompletedAt === "2026-02-01" && a8.sixMonthCompletedAt === null, j(a8));

// 9-11: edge cases
const a9 = scheduleFromImportedHistory([row("annual", "2025-09-01"), row("initial", "2026-08-01")], H);
check("9. a new-method initial after the last annual does not move the person's annual clock", a9?.recordedAs === "existing" && a9.lastAnnualCompletedAt === "2025-09-01" && a9.initialCompletedAt === null, j(a9));
const a10 = scheduleFromImportedHistory([row("annual", "2026-01-10", "fail"), row("initial", "2025-02-03")], H);
check("10. a failed annual is ignored; the passed initial clears", a10?.recordedAs === null && a10.initialCompletedAt === "2025-02-03" && a10.lastAnnualCompletedAt === null, j(a10));
const a11 = scheduleFromImportedHistory([row("initial", "2026-05-01"), row("6month", "2026-04-01")], H);
check("11. a 6-month dated before the initial is not used as the 6-month", a11?.initialCompletedAt === "2026-05-01" && a11.sixMonthCompletedAt === null, j(a11));
const a12 = scheduleFromImportedHistory([row("annual", "not-a-date"), row("orientation", "2026-01-01")], H);
check("12. a row with no valid date is not used", a12 === null, j(a12));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
