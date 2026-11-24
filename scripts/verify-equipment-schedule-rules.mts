// scripts/verify-equipment-schedule-rules.mts
//
// Receipt for shared/equipmentSchedules.ts (B10, 2026-11-24): frequencies, due dates, reminder lead times, days with no record, and how a
// checklist step is judged. Imports the real functions. Run: npx tsx scripts/verify-equipment-schedule-rules.mts
import {
  addMonths, alignDue, answerFails, cleanDays, cleanSteps, daysInForce, daysLabel, dueAfter, dueOnDay, dueSoonDays, dueWithDays, firstDue, frequencyLabel, judgeStep, limitsLabel, missedDays, nominalDays, parseDays,
  planScheduleDue, reminderLeadDays, sameSteps, scheduleStatus, withDaysChange, type ChecklistStep,
} from "../shared/equipmentSchedules";
import { rollForward } from "../server/equipmentScheduleData";

let fails = 0;
const ok = (label: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : "  :: " + detail}`); if (!cond) fails++; };

// How often
ok("labels", frequencyLabel("every_n_days", 90) === "Every 90 days" && frequencyLabel("every_n_days", 1) === "Every 1 day" && frequencyLabel("semiannual") === "Every 6 months" && frequencyLabel("manual") === "No set interval");
ok("the plain days an older reader sees", nominalDays("quarterly") === 91 && nominalDays("every_n_days", 45) === 45 && nominalDays("manual") === null && nominalDays("every_n_days", 0) === null);
ok("months end on their last day", addMonths("2026-01-31", 1) === "2026-02-28" && addMonths("2028-01-31", 1) === "2028-02-29" && addMonths("2026-11-30", 3) === "2027-02-28" && addMonths("2026-12-15", 1) === "2027-01-15");
ok("next due by frequency", dueAfter("daily", null, "2026-12-31", null) === "2027-01-01" && dueAfter("weekly", null, "2026-12-28", null) === "2027-01-04" && dueAfter("monthly", null, "2026-03-31", null) === "2026-04-30" && dueAfter("quarterly", null, "2026-11-30", null) === "2027-02-28"
  && dueAfter("semiannual", null, "2026-08-31", null) === "2027-02-28" && dueAfter("annual", null, "2024-02-29", null) === "2025-02-28" && dueAfter("every_n_days", 90, "2026-11-20", null) === "2027-02-18" && dueAfter("every_n_days", 0, "2026-11-20", null) === null && dueAfter("manual", 90, "2026-11-20", null) === null);

// Every N days is what the single interval was
const was = (day: string, n: number) => { const x = new Date(day + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }; // the single interval's own arithmetic
ok("every N days gives exactly what the single PM interval gave", ([["2026-11-20", 90], ["2026-06-01", 365], ["2028-02-28", 1], ["2026-12-31", 30], ["2024-02-29", 365]] as [string, number][]).every(([day, n]) => dueAfter("every_n_days", n, day, null) === was(day, n)));
ok("an earlier date is held unless the person says so", planScheduleDue({ currentDue: "2026-12-10", frequency: "weekly", intervalDays: null, daysOfWeek: null, doneOn: "2026-11-20" }).held?.works_out_to === "2026-11-27" && planScheduleDue({ currentDue: "2026-12-10", frequency: "weekly", intervalDays: null, daysOfWeek: null, doneOn: "2026-11-20", allowEarlier: true }).move);

// Status and reminders
const st = (next_due_date: string | null, frequency: string, is_primary = 0) => scheduleStatus({ next_due_date, frequency, is_primary }, "2026-11-20");
ok("due soon is nearer for what comes round often", st("2026-11-20", "daily") === "due_soon" && st("2026-11-21", "daily") === "ok" && st("2026-11-21", "weekly") === "due_soon" && st("2026-11-22", "weekly") === "ok" && st("2026-11-27", "monthly") === "due_soon" && st("2026-11-28", "monthly") === "ok");
ok("the first schedule keeps its 30 days", st("2026-12-20", "quarterly", 1) === "due_soon" && st("2026-12-21", "quarterly", 1) === "ok" && dueSoonDays("daily", null, true) === 30);
ok("yesterday is overdue, no date is none", st("2026-11-19", "annual") === "overdue" && st(null, "annual") === "none");
ok("reminder lead: the first schedule's interval as before; none for daily, 3 days weekly, 7 monthly, never more than the lab's", reminderLeadDays("every_n_days", 7, true, 14) === 14 && reminderLeadDays("manual", null, true, 30) === 30 && reminderLeadDays("daily", null, false, 14) === 0 && reminderLeadDays("weekly", null, false, 14) === 3
  && reminderLeadDays("monthly", null, true, 14) === 7 && reminderLeadDays("annual", null, false, 14) === 14 && reminderLeadDays("weekly", null, false, 2) === 2 && reminderLeadDays("every_n_days", 5, false, 14) === 4 && reminderLeadDays("every_n_days", 1, false, 14) === 0);

// Days with no record
const days = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `2026-09-${String(a + i).padStart(2, "0")}`);
ok("every day done", missedDays({ from: "2026-09-01", to: "2026-09-30", done: days(1, 30) }).missed.length === 0);
ok("the days with none, named", JSON.stringify(missedDays({ from: "2026-09-03", to: "2026-09-07", done: days(3, 4) })) === JSON.stringify({ expected: 5, missed: ["2026-09-05", "2026-09-06", "2026-09-07"] }));
ok("a day wholly out of service isn't owed; a part day is", JSON.stringify(missedDays({ from: "2026-09-18", to: "2026-09-22", done: [], downtime: [{ down_from: "2026-09-19T12:00", down_until: "2026-09-21T08:00" }] })) === JSON.stringify({ expected: 4, missed: ["2026-09-18", "2026-09-19", "2026-09-21", "2026-09-22"] }));
ok("one done on a day out of service still counts", missedDays({ from: "2026-09-20", to: "2026-09-20", done: ["2026-09-20"], downtime: [{ down_from: "2026-09-01T00:00", down_until: null }] }).expected === 1);
ok("nothing owed when it starts after the window", missedDays({ from: "2026-10-01", to: "2026-09-30", done: [] }).expected === 0);

// The days a daily schedule is due. 2026-09-04 is a Friday, 2026-09-05 a Saturday, 2026-09-07 a Monday.
const MF = "1,2,3,4,5";
ok("blank, or all seven, is every day", parseDays(null) === null && parseDays("") === null && parseDays("0,1,2,3,4,5,6") === null && dueOnDay(null, "2026-09-05"));
ok("a list is tidied: sorted, no repeats, seven is every day", cleanDays([5, 1, 1, 3], "daily").value === "1,3,5" && cleanDays([0, 1, 2, 3, 4, 5, 6], "daily").value === null && cleanDays(null, "daily").value === null && cleanDays(null, "weekly").value === null);
ok("no days, a day that isn't one, words, and any frequency but daily are refused", !!cleanDays([], "daily").error && !!cleanDays([7], "daily").error && !!cleanDays([-1], "daily").error && !!cleanDays([1.5], "daily").error && !!cleanDays(["1"], "daily").error && !!cleanDays("1,2", "daily").error && !!cleanDays([1], "weekly").error && !!cleanDays([], "monthly").error);
ok("labels", daysLabel(MF) === "Monday to Friday" && daysLabel("0,6") === "Sat, Sun" && daysLabel("1,3,5") === "Mon, Wed, Fri" && daysLabel(null) === "" && frequencyLabel("daily", null, MF) === "Daily, Monday to Friday" && frequencyLabel("daily", null, "0,1") === "Daily, Mon, Sun" && frequencyLabel("daily", null, null) === "Daily" && frequencyLabel("weekly", null, MF) === "Weekly");
ok("the next due day: itself when it is one, else the next; only for a daily schedule", alignDue("daily", MF, "2026-09-04") === "2026-09-04" && alignDue("daily", MF, "2026-09-05") === "2026-09-07" && alignDue("daily", "0", "2026-09-07") === "2026-09-13" && alignDue("daily", null, "2026-09-05") === "2026-09-05" && alignDue("weekly", MF, "2026-09-05") === "2026-09-05");
ok("done Friday, next due Monday; done on the weekend, next due Monday too", dueAfter("daily", null, "2026-09-04", MF) === "2026-09-07" && dueAfter("daily", null, "2026-09-05", MF) === "2026-09-07" && dueAfter("daily", null, "2026-09-06", MF) === "2026-09-07" && dueAfter("daily", null, "2026-09-07", MF) === "2026-09-08" && dueAfter("daily", null, "2026-12-31", MF) === "2027-01-01");
ok("every day is what it was", ["2026-09-04", "2026-09-05", "2026-12-31"].every((x) => dueAfter("daily", null, x, null) === dueAfter("every_n_days", 1, x, null)));
ok("a typed date on a day it isn't due goes to the next one", planScheduleDue({ currentDue: null, frequency: "daily", intervalDays: null, daysOfWeek: MF, doneOn: "2026-09-04", typedDue: "2026-09-12" }).computed === "2026-09-14" && planScheduleDue({ currentDue: null, frequency: "manual", intervalDays: null, daysOfWeek: null, doneOn: "2026-09-04", typedDue: "2026-09-12" }).computed === "2026-09-12");
ok("the first due date: today when it is one of its days, else the next", firstDue("daily", null, "2026-09-04", MF) === "2026-09-04" && firstDue("daily", null, "2026-09-05", MF) === "2026-09-07" && firstDue("daily", null, "2026-09-05", null) === "2026-09-05" && firstDue("weekly", null, "2026-09-05", null) === "2026-09-12" && firstDue("manual", null, "2026-09-05", null) === null);
const dst = (next_due_date: string, today: string) => scheduleStatus({ next_due_date, frequency: "daily", days_of_week: MF }, today);
ok("status: on schedule over the weekend, due on Monday, overdue on Tuesday, and Friday missed is overdue on Saturday", dst("2026-09-07", "2026-09-05") === "ok" && dst("2026-09-05", "2026-09-05") === "ok" && dst("2026-09-07", "2026-09-07") === "due_soon" && dst("2026-09-07", "2026-09-08") === "overdue" && dst("2026-09-04", "2026-09-05") === "overdue");
ok("a change of days moves the date with them", dueWithDays("2026-09-05", MF, "2026-09-04", true) === "2026-09-07" && dueWithDays("2026-09-07", null, "2026-09-05", false) === "2026-09-05" && dueWithDays("2026-09-07", null, "2026-09-04", true) === "2026-09-05" && dueWithDays("2026-09-02", MF, "2026-09-04", false) === "2026-09-02" && dueWithDays(null, MF, "2026-09-04", false) === null);
const weekdays = (a: number, b: number) => days(a, b).filter((x) => dueOnDay(MF, x));
ok("weekdays only: a weekend with nothing isn't missed", JSON.stringify(missedDays({ from: "2026-09-01", to: "2026-09-30", done: weekdays(1, 30), dueOn: (x) => dueOnDay(MF, x) })) === JSON.stringify({ expected: 22, missed: [] }));
ok("a weekday with nothing is, and a weekend record counts as done and never as a problem", JSON.stringify(missedDays({ from: "2026-09-01", to: "2026-09-30", done: [...weekdays(1, 30).filter((x) => x !== "2026-09-09"), "2026-09-05"], dueOn: (x) => dueOnDay(MF, x) })) === JSON.stringify({ expected: 23, missed: ["2026-09-09"] }));
// A change counts from the day it is made
const h1 = withDaysChange({ days_of_week: null, days_history: null, starts_on: "2026-09-01" }, MF, "2026-09-16");
ok("the first change keeps what was in force before", h1 === JSON.stringify([{ from: "2026-09-01", days: null }, { from: "2026-09-16", days: MF }]) && daysInForce({ days_of_week: MF, days_history: h1 }, "2026-09-12") === null && daysInForce({ days_of_week: MF, days_history: h1 }, "2026-09-16") === MF && daysInForce({ days_of_week: MF, days_history: h1 }, "2026-08-01") === null);
const h2 = withDaysChange({ days_of_week: MF, days_history: h1, starts_on: "2026-09-01" }, "1,2,3,4,5,6", "2026-09-16");
ok("a second change the same day replaces the first; back to what it was leaves no history", h2 === JSON.stringify([{ from: "2026-09-01", days: null }, { from: "2026-09-16", days: "1,2,3,4,5,6" }]) && withDaysChange({ days_of_week: MF, days_history: h1, starts_on: "2026-09-01" }, null, "2026-09-16") === null);
const h3 = withDaysChange({ days_of_week: MF, days_history: h1, starts_on: "2026-09-01" }, "1,3,5", "2026-09-21");
ok("a later change adds to it", daysInForce({ days_of_week: "1,3,5", days_history: h3 }, "2026-09-18") === MF && daysInForce({ days_of_week: "1,3,5", days_history: h3 }, "2026-09-22") === "1,3,5");
ok("a schedule that started today has no earlier days to keep", withDaysChange({ days_of_week: null, days_history: null, starts_on: "2026-09-16" }, MF, "2026-09-16") === null);
ok("with no start on file the days before are still what they were", daysInForce({ days_of_week: MF, days_history: withDaysChange({ days_of_week: null, days_history: null, starts_on: null }, MF, "2026-09-16") }, "2026-09-05") === null);
ok("a history that can't be read falls back to the days on file", daysInForce({ days_of_week: MF, days_history: "not json" }, "2026-09-05") === MF);
ok("a month the days changed in: each day by what was in force then", JSON.stringify(missedDays({ from: "2026-09-01", to: "2026-09-30", done: [], dueOn: (x) => dueOnDay(daysInForce({ days_of_week: MF, days_history: h1 }, x), x) }).missed.filter((x) => ["2026-09-05", "2026-09-06", "2026-09-19", "2026-09-20"].includes(x))) === JSON.stringify(["2026-09-05", "2026-09-06"]));
ok("the demo date refresh rolls to a due day", rollForward("daily", null, "2026-09-01", "2026-09-05", MF) === "2026-09-07" && rollForward("daily", null, "2026-09-01", "2026-09-05", null) === "2026-09-05" && rollForward("weekly", null, "2026-09-01", "2026-09-05", null) === "2026-09-08" && rollForward("daily", null, "2026-09-05", "2026-09-05", MF) === "2026-09-07");

// Checklists
const cleaned = cleanSteps([{ step_text: "  Wipe   the probe " }, { step_text: "Temp", kind: "value", unit: "C", min_value: "2", max_value: 8 }, { step_text: "Pressure", kind: "value" }]);
ok("steps are tidied", cleaned.steps?.[0].step_text === "Wipe the probe" && cleaned.steps?.[0].kind === "check" && cleaned.steps?.[1].min_value === 2 && cleaned.steps?.[2].min_value === null);
ok("a check keeps no unit or limits", JSON.stringify(cleanSteps([{ step_text: "x", kind: "check", unit: "C", min_value: 1 }]).steps?.[0]) === JSON.stringify({ step_text: "x", kind: "check", unit: null, min_value: null, max_value: null }));
ok("bad steps are refused", !!cleanSteps("x").error && !!cleanSteps([{ step_text: "" }]).error && !!cleanSteps([{ step_text: "x", kind: "value", min_value: 9, max_value: 1 }]).error && !!cleanSteps([{ step_text: "x", kind: "value", max_value: "high" }]).error && !!cleanSteps(Array.from({ length: 101 }, () => ({ step_text: "x" }))).error);
ok("the same steps are the same, any difference isn't", sameSteps(cleaned.steps!, cleanSteps(cleaned.steps!).steps!) && !sameSteps(cleaned.steps!, cleaned.steps!.slice(1)) && !sameSteps(cleaned.steps!, [{ ...cleaned.steps![0] }, { ...cleaned.steps![1], max_value: 9 }, cleaned.steps![2]]));
const check: ChecklistStep = { step_text: "x", kind: "check", unit: null, min_value: null, max_value: null };
const value: ChecklistStep = { step_text: "x", kind: "value", unit: "C", min_value: 2, max_value: 8 };
ok("a check: pass, N/A, or fail with its corrective action", judgeStep(check, { result: "pass" }).outcome?.result === "pass" && judgeStep(check, { result: "na" }).outcome?.result === "na" && judgeStep(check, { result: "fail" }).code === "CORRECTIVE_ACTION_REQUIRED" && judgeStep(check, { result: "fail", corrective_action: "done" }).outcome?.result === "fail" && judgeStep(check, undefined).code === "STEP_UNANSWERED" && judgeStep(check, { result: "yes" }).code === "STEP_UNANSWERED");
ok("a value is judged by its limits, ends included, whatever result was sent", judgeStep(value, { value: 2 }).outcome?.result === "pass" && judgeStep(value, { value: "8" }).outcome?.result === "pass" && judgeStep(value, { value: 8.01, result: "pass" }).code === "CORRECTIVE_ACTION_REQUIRED" && judgeStep(value, { value: 1, corrective_action: "a" }).outcome?.result === "fail");
ok("a value must be there, must be a number, or be N/A; with no limits any number passes", judgeStep(value, {}).code === "STEP_UNANSWERED" && judgeStep(value, { value: "warm" }).code === "BAD_VALUE" && judgeStep(value, { result: "na" }).outcome?.value === null && judgeStep({ ...value, min_value: null, max_value: null }, { value: -400 }).outcome?.result === "pass" && judgeStep({ ...value, min_value: null }, { value: 0 }).outcome?.result === "pass");
ok("zero is a value", judgeStep({ ...value, min_value: 0 }, { value: 0 }).outcome?.value === 0);
ok("the form asks for the action exactly when the server would", [[check, { result: "fail" }], [check, { result: "pass" }], [check, { result: "na" }], [value, { value: 9 }], [value, { value: 5 }], [value, { result: "na", value: 9 }], [value, {}]].every(([s, a]: any) => answerFails(s, a) === (judgeStep(s, a).code === "CORRECTIVE_ACTION_REQUIRED")));
ok("limits read in words", limitsLabel(value) === "2 to 8 C" && limitsLabel({ ...value, max_value: null }) === "at least 2 C" && limitsLabel({ ...value, min_value: null }) === "at most 8 C" && limitsLabel({}) === "");

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
