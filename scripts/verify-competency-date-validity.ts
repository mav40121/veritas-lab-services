// Verify receipt for the VeritaComp import/cohort calendar-date fix (2026-10-04).
//
// Bug: validateRows (bulk import) and validateCohort both accepted well-formed
// but IMPOSSIBLE dates (2024-13-45, 2024-02-30) because they only regex-checked
// the YYYY-MM-DD *shape*. Such a date imported onto a LOCKED, surveyor-facing
// competency record as its completion_date. Fix: both now use isValidYmd, which
// also round-trips the date through UTC to confirm it is a real calendar day.
//
// Run: node_modules/.bin/tsx scripts/verify-competency-date-validity.ts
import { isValidYmd, validateRows, type ParsedRow } from "../server/competencyBulkImport";
import { validateCohort, type CohortInput, type CohortContext } from "../server/competencyCohortSignoff";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  -> " + detail : ""}`);
  if (!cond) failures++;
}

// ── isValidYmd unit cases ──────────────────────────────────────────────
const bad = ["2024-13-45", "2024-02-30", "2024-00-10", "2024-01-00", "2025-04-31", "2023-02-29", "2024-13-01", "06/15/2024", "2024-6-15", ""];
const good = ["2024-06-15", "2024-02-29", "2000-02-29", "2024-12-31", "2024-01-01"];
for (const s of bad) check(`isValidYmd rejects "${s}"`, isValidYmd(s) === false, `got ${isValidYmd(s)}`);
for (const s of good) check(`isValidYmd accepts "${s}"`, isValidYmd(s) === true, `got ${isValidYmd(s)}`);

// ── validateRows (bulk import) end-to-end ──────────────────────────────
const ctx = {
  competencyEmployees: [{ id: 1, name: "Jane Smith", staff_employee_id: 10 }],
  staffEmployees: [{ id: 10, first_name: "Jane", last_name: "Smith" }],
  programs: [{ id: 5, name: "Chemistry Annual Competency" }],
};
function mkRow(date: string): ParsedRow {
  return {
    rowNumber: 2,
    raw: {},
    parsed: { employeeName: "Jane Smith", programName: "Chemistry Annual Competency", assessmentType: "annual", assessmentDate: date, status: "pass", evaluatorName: "M. Director" },
  };
}
const invalidImport = validateRows([mkRow("2024-13-45")], ctx)[0];
check("import: 2024-13-45 row is status=error (was 'ok' before fix)  [harness bites]",
  invalidImport.status === "error" && invalidImport.issues.some((i) => i.field === "Assessment Date" && i.severity === "error"),
  `status=${invalidImport.status}`);
const feb30 = validateRows([mkRow("2024-02-30")], ctx)[0];
check("import: 2024-02-30 row is status=error", feb30.status === "error");
const validImport = validateRows([mkRow("2024-06-15")], ctx)[0];
check("import: 2024-06-15 (real date, known employee+program) is status=ok",
  validImport.status === "ok", `status=${validImport.status} issues=${JSON.stringify(validImport.issues)}`);
const leapImport = validateRows([mkRow("2024-02-29")], ctx)[0];
check("import: 2024-02-29 (real leap day) is status=ok", leapImport.status === "ok", `status=${leapImport.status}`);

// ── validateCohort end-to-end ──────────────────────────────────────────
const cohortCtx: CohortContext = {
  competencyEmployees: [{ id: 1, name: "Jane Smith" }],
  programs: [{ id: 5, name: "Chemistry Annual Competency" }],
  existingAssessments: [],
};
function cohortInput(date: string): CohortInput {
  return { programId: 5, employeeIds: [1], assessmentType: "annual", assessmentDate: date, status: "pass", evaluatorName: "M. Director" };
}
const cohortBad = validateCohort(cohortInput("2024-02-30"), cohortCtx);
check("cohort: 2024-02-30 -> dateOk=false + shared error  [harness bites]",
  cohortBad.shared.dateOk === false && cohortBad.sharedIssues.some((i) => i.field === "assessmentDate" && i.severity === "error"),
  `dateOk=${cohortBad.shared.dateOk}`);
const cohortGood = validateCohort(cohortInput("2024-06-15"), cohortCtx);
check("cohort: 2024-06-15 -> dateOk=true, no date error", cohortGood.shared.dateOk === true);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
