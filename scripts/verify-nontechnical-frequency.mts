// scripts/verify-nontechnical-frequency.mts
// Math receipt (CLAUDE.md, the verify-*.js convention) for the site-set non-technical competency frequency (Michael 2026-11-04, go Q216 = 1,
// 2026-11-06): what a save accepts, the due date from a person's signed records, and the status at each boundary. Then the technical timing
// on the same known dates, 42 CFR 493.1451(b)(9) and 493.1413(b)(9), which never reads this setting. Pure: no database, no server.
//   node_modules/.bin/tsx scripts/verify-nontechnical-frequency.mts
import { parseNontechnicalFrequency, nontechnicalFrequencyLabel, nontechnicalDueCounts, NONTECHNICAL_FREQUENCY_MONTHS } from "../shared/competencyNontechnicalFrequency";
import { nontechnicalClock } from "../server/competencyNontechnicalDue";
import { signedRecordDate, methodClock } from "../server/competencyMethodClock";
import { nextCompetencyDue, competencyDueColumns } from "../server/competencySchedule";

let failures = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  :: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!ok) failures++;
};

// What a save accepts.
eq("the choices are 12, 24 and 36 months", [...NONTECHNICAL_FREQUENCY_MONTHS], [12, 24, 36]);
for (const m of [12, 24, 36]) eq(`${m} is accepted`, parseNontechnicalFrequency(m), { months: m });
eq("a number as text is accepted", parseNontechnicalFrequency("24"), { months: 24 });
eq("null clears it", parseNontechnicalFrequency(null), { months: null });
eq("an empty value clears it", parseNontechnicalFrequency(""), { months: null });
for (const bad of [undefined, 0, -12, 18, 24.5, 240, "abc", "0", true, false, [24], {}]) {
  eq(`${JSON.stringify(bad) ?? "a missing value"} is refused`, "error" in parseNontechnicalFrequency(bad), true);
}
eq("the words", [nontechnicalFrequencyLabel(24), nontechnicalFrequencyLabel(null)], ["Every 24 months", "Not set: no due dates"]);

// The due date.
const pass = (id: number, date: string | null) => ({ id, status: "pass", date });
const T = "2026-11-06";
const due = (records: Array<{ id: number; status: string; date: string | null }>, months: number, today = T) => {
  const c = nontechnicalClock(records, months, today);
  return c && [c.nextDue, c.daysUntil, c.bucket];
};
eq("every 12 months", due([pass(1, "2026-03-15")], 12), ["2027-03-15", 129, "compliant"]);
eq("every 24 months", due([pass(1, "2026-03-15")], 24), ["2028-03-15", 495, "compliant"]);
eq("every 36 months", due([pass(1, "2026-03-15")], 36), ["2029-03-15", 860, "compliant"]);
eq("a leap day clamps to the end of February", due([pass(1, "2024-02-29")], 24), ["2026-02-28", -251, "overdue"]);
eq("a leap day at 36 months: the same clamp", nontechnicalClock([pass(1, "2024-02-29")], 36, T)?.nextDue, "2027-02-28");
eq("Jan 31 plus 12 months stays Jan 31", nontechnicalClock([pass(1, "2026-01-31")], 12, T)?.nextDue, "2027-01-31");
eq("nothing on file: no date", nontechnicalClock([], 24, T), null);
eq("an unreadable date doesn't count", nontechnicalClock([pass(1, "not a date"), pass(2, null), pass(3, "2026-13-45")], 24, T), null);
eq("an unreadable date doesn't hide a good one", nontechnicalClock([pass(1, "junk"), pass(2, "2026-03-15")], 12, T)?.nextDue, "2027-03-15");
eq("the last pass counts, whatever order they arrive in", nontechnicalClock([pass(1, "2023-01-10"), pass(2, "2026-01-10"), pass(3, "2024-01-10")], 24, T)?.nextDue, "2028-01-10");

// The newest signed record decides whether it is due again.
const fail = (id: number, date: string, status = "fail") => ({ id, status, date });
eq("a Fail after a pass: due again now", nontechnicalClock([pass(1, "2026-01-10"), fail(2, "2026-06-01")], 24, T), { lastPassDate: "2026-01-10", nextDue: T, daysUntil: 0, bucket: "dueSoon30", remediationOpen: true });
eq("Remediation Required after a pass: the same", nontechnicalClock([pass(1, "2026-01-10"), fail(2, "2026-06-01", "remediation")], 24, T)?.remediationOpen, true);
eq("a Fail with no pass at all: due again now, no last pass", nontechnicalClock([fail(1, "2026-06-01")], 24, T), { lastPassDate: null, nextDue: T, daysUntil: 0, bucket: "dueSoon30", remediationOpen: true });
eq("a pass after a Fail closes it", nontechnicalClock([fail(1, "2026-01-10"), pass(2, "2026-06-01")], 24, T), { lastPassDate: "2026-06-01", nextDue: "2028-06-01", daysUntil: 573, bucket: "compliant", remediationOpen: false });
eq("same date: the later record wins", nontechnicalClock([pass(1, "2026-06-01"), fail(2, "2026-06-01")], 24, T)?.remediationOpen, true);
eq("same date, the other way round", nontechnicalClock([fail(1, "2026-06-01"), pass(2, "2026-06-01")], 24, T)?.remediationOpen, false);

// The status at each boundary, the same thresholds as the technical status.
const R = [pass(1, "2024-12-15")]; // due 2026-12-15 at 24 months
eq("due on the day: not overdue", due(R, 24, "2026-12-15"), ["2026-12-15", 0, "dueSoon30"]);
eq("the day after: overdue", due(R, 24, "2026-12-16"), ["2026-12-15", -1, "overdue"]);
eq("30 days out: due soon", due(R, 24, "2026-11-15"), ["2026-12-15", 30, "dueSoon30"]);
eq("31 days out: the 90-day group", due(R, 24, "2026-11-14"), ["2026-12-15", 31, "dueSoon90"]);
eq("90 days out: the 90-day group", due(R, 24, "2026-09-16"), ["2026-12-15", 90, "dueSoon90"]);
eq("91 days out: current", due(R, 24, "2026-09-15"), ["2026-12-15", 91, "compliant"]);
eq("the counts add up", nontechnicalDueCounts([{ bucket: "overdue" }, { bucket: "dueSoon30" }, { bucket: "dueSoon90" }, { bucket: "compliant" }, { bucket: "compliant" }]), { overdue: 1, dueSoon: 2, current: 2, total: 5 });

// Which date a signed record counts from (shared with the technical import reader).
eq("signed back-dated: the paper date", signedRecordDate({ signed_on_paper_date: "2024-12-15", completion_date: "2026-11-01T15:00:00.000Z", assessment_date: "2024-12-01" }, "America/New_York"), "2024-12-15");
eq("Bulk Import and Cohort: a date-only completion", signedRecordDate({ completion_date: "2025-08-08", assessment_date: "2025-08-01" }), "2025-08-08");
eq("signed in the evening, Eastern: that evening's date, not UTC's", signedRecordDate({ completion_date: "2026-02-02T03:30:00.000Z", assessment_date: "2026-01-20" }, "America/New_York"), "2026-02-01");
eq("signed in the morning UTC, Guam: the next day there", signedRecordDate({ completion_date: "2026-02-01T20:30:00.000Z", assessment_date: "2026-01-20" }, "Pacific/Guam"), "2026-02-02");
eq("no sign date on file: the assessment date", signedRecordDate({ assessment_date: "2026-01-20" }), "2026-01-20");

// Technical timing on known dates. None of these functions takes the setting, and these are the same answers as before this change.
const national = { hireDate: "2019-03-01", accreditor: "CLIA_ONLY", nys: false, annualMonth: null };
eq("nextCompetencyDue: initial, the 6-month at + 6", nextCompetencyDue({ recordedMilestone: "initial", recordedDate: "2026-05-15", highestComplexity: "M" }).targetDate, "2026-11-15");
eq("nextCompetencyDue: 6-month, the 1st annual pinned at initial + 12", nextCompetencyDue({ recordedMilestone: "six_month", recordedDate: "2026-03-20", initialDate: "2025-09-10", highestComplexity: "H" }).targetDate, "2026-09-10");
eq("nextCompetencyDue: annual, + 12", nextCompetencyDue({ recordedMilestone: "annual", recordedDate: "2026-02-01", highestComplexity: "M" }).targetDate, "2027-02-01");
eq("nextCompetencyDue: waived, initial then annual", nextCompetencyDue({ recordedMilestone: "initial", recordedDate: "2026-03-01", highestComplexity: "W" }).targetDate, "2027-03-01");
eq("competencyDueColumns: initial only", competencyDueColumns({ accreditor: "CLIA_ONLY", highestComplexity: "H", hireDate: "2019-03-01" }, { initialCompletedAt: "2026-05-15" }), { six_month_due_at: "2026-11-15", first_annual_due_at: null, annual_due_at: null, nys_six_month_due_at: null });
const signoff = (milestone: string, signedDate: string) => ({ milestone, signedDate, determination: "pass" });
eq("methodClock: the same 6-month", methodClock([signoff("initial", "2026-05-15")], "MODERATE", national, T).nextDue?.targetDate, "2026-11-15");
eq("methodClock: the same 1st annual", methodClock([signoff("six_month", "2026-03-20"), signoff("initial", "2025-09-10")], "HIGH", national, T).nextDue?.targetDate, "2026-09-10");
eq("methodClock: the same waived annual", methodClock([signoff("initial", "2026-03-01")], "WAIVED", national, T).nextDue?.targetDate, "2027-03-01");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
