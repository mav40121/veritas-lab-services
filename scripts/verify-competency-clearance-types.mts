// scripts/verify-competency-clearance-types.mts
// Receipt (CLAUDE.md, the verify-*.js convention) for the rule that only a technical or waived record can clear a person for patient testing, and for which schedule an
// import builds from what's left. Pure: no database, no server. The route-level proof is tests/integration/competency-clearance-program-type.test.ts.
//   node_modules/.bin/tsx scripts/verify-competency-clearance-types.mts
import { programCanClearForTesting, CLEARANCE_PROGRAM_TYPES } from "../shared/competencyClearance";
import { scheduleFromImportedHistory } from "../server/competencyImportSchedule";

let failures = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  :: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!ok) failures++;
};

eq("the list is technical and waived, nothing else", [...CLEARANCE_PROGRAM_TYPES], ["technical", "waived"]);
for (const t of ["technical", "waived"]) eq(`${t} can clear`, programCanClearForTesting(t), true);
for (const t of ["nontechnical", "Technical", "evaluation", "", null, undefined, 0, {}]) eq(`${JSON.stringify(t) ?? "a missing type"} can't`, programCanClearForTesting(t), false);

// What an import builds once the non-technical rows are out, on known dates. Same answers as before this rule.
const row = (assessmentType: string, assessmentDate: string, status = "pass") => ({ assessmentType, assessmentDate, status, evaluatorName: "Made Up" });
const fill = (rows: ReturnType<typeof row>[], waived = false) => {
  const f = scheduleFromImportedHistory(rows, { waived });
  return f && [f.recordedAs, f.initialCompletedAt, f.sixMonthCompletedAt, f.lastAnnualCompletedAt];
};
eq("an annual: Existing staff, clock from it", fill([row("annual", "2026-03-15")]), ["existing", null, null, "2026-03-15"]);
eq("an initial: the first-year walk", fill([row("initial", "2026-02-10")]), [null, "2026-02-10", null, null]);
eq("an initial and a 6-month", fill([row("initial", "2026-02-10"), row("6month", "2026-08-10")]), [null, "2026-02-10", "2026-08-10", null]);
eq("a 6-month with no initial: Existing staff", fill([row("6month", "2026-08-10")]), ["existing", null, "2026-08-10", null]);
eq("waived, a 6-month with no initial counts as the most recent", fill([row("6month", "2026-08-10")], true), ["existing", null, null, "2026-08-10"]);
eq("orientation only: nothing", fill([row("orientation", "2026-02-10")]), null);
eq("failed only: nothing", fill([row("annual", "2026-02-10", "fail")]), null);
eq("no rows, which is what a file of only non-technical rows now hands it: nothing", fill([]), null);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
