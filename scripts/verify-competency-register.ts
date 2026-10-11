// Receipt for server/competencyRegisterExcel.ts buildCompetencyRegisterRows (Michael Q74 part C, 2026-10-11).
// Fixed "today" and fixed people; asserts every status branch, the 1st-annual figure (initial + 12 until the stored
// value exists; NYS keeps the stored value), waived N/A, clearance text, test systems, open reevaluations, and that
// items closed as "recorded at setup" never reach the Duty-Change Reevaluations sheet.
// Run: node_modules/.bin/tsx scripts/verify-competency-register.ts
import { buildCompetencyRegisterRows } from "../server/competencyRegisterExcel";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = "") => { if (cond) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label}${detail ? "  :: " + detail : ""}`); } };
const T = new Date("2026-10-11T00:00:00");
const base = { highest_complexity: "H", created_at: "2026-01-05T12:00:00Z" };
const employees = [
  // New hire, training then initial, 6-month done late: next item = 1st annual at initial + 12.
  { id: 1, first_name: "Nora", last_name: "Hale", title: "MLS", hire_date: "2026-01-05", recorded_as: "new_hire", training_completed_at: "2026-03-20", training_documented_by: "J. Trainer", training_record_url: "https://example.com/t.pdf", initial_completed_at: "2026-04-06", initial_signed_by: "T. Sup", six_month_due_at: "2026-10-06", six_month_completed_at: "2026-10-20", first_annual_due_at: "2027-04-06", ...base },
  // New hire, initial on file, 6-month not yet: 1st annual figured from the initial (stored column still empty).
  { id: 2, first_name: "Ann", last_name: "Bell", hire_date: "2026-03-01", recorded_as: "new_hire", training_completed_at: "2026-04-01", initial_completed_at: "2026-04-20", six_month_due_at: "2026-10-20", ...base },
  // New hire with no initial, added recently: not cleared (not yet overdue).
  { id: 3, first_name: "Cal", last_name: "Cole", hire_date: "2026-09-20", recorded_as: "new_hire", ...base, created_at: "2026-09-20T12:00:00Z" },
  // Legacy row, no initial, added long ago: overdue (hire/added + 90 passed).
  { id: 4, first_name: "Dee", last_name: "Dunn", hire_date: "2015-01-01", recorded_as: null, ...base },
  // Existing staff, last annual on file: cleared as existing staff; due in 90 days.
  { id: 5, first_name: "Eli", last_name: "Moss", hire_date: "2012-06-01", recorded_as: "existing", last_annual_completed_at: "2025-12-15", annual_due_at: "2026-12-15", ...base },
  // Waived tester: 6-month and 1st annual are N/A.
  { id: 6, first_name: "Fay", last_name: "Ford", hire_date: "2026-02-01", recorded_as: "new_hire", training_completed_at: "2026-02-05", initial_completed_at: "2026-02-10", annual_due_at: "2027-02-10", ...base, highest_complexity: "W" },
  // Existing staff, annual due in 20 days.
  { id: 7, first_name: "Gus", last_name: "Gray", hire_date: "2010-01-01", recorded_as: "existing", last_annual_completed_at: "2025-10-31", annual_due_at: "2026-10-31", ...base },
];
const testSystems = new Map<number, string[]>([[1, ["XN-1000", "Manual Differential"]], [5, ["Ortho 5600"]]]);
const events = [
  { employee_id: 1, test_system: "Manual Differential", detected_at: "2026-09-22T10:00:00Z", resolved_at: null, resolution_type: null },
  { employee_id: 5, test_system: "Ortho 5600", detected_at: "2026-10-09T10:00:00Z", resolved_at: "2026-10-11T12:00:00Z", resolution_type: "setup", resolution_reason: "Recorded at setup" },
  { employee_id: 5, test_system: "Tosoh AIA-900", detected_at: "2026-08-01T10:00:00Z", resolved_at: "2026-08-03T12:00:00Z", resolution_type: "not_a_change", resolution_reason: "Already performed it; missing from the record", closed_by: "Michael Veri" },
  { employee_id: 2, test_system: "Clinitek Novus", detected_at: "2026-07-14T10:00:00Z", resolved_at: "2026-07-21T12:00:00Z", resolution_type: "assessment", closed_by: "T. Sup" },
];
const out = buildCompetencyRegisterRows({ employees, testSystems, events, nys: false }, T);
const by = (n: string) => out.personnel.find((p) => p.name.startsWith(n))!;

console.log("--- Testing Personnel rows ---");
ok("sorted by last name", out.personnel.map((p) => p.name.split(",")[0]).join(",") === "Bell,Cole,Dunn,Ford,Gray,Hale,Moss", out.personnel.map((p) => p.name).join(" | "));
const h = by("Hale");
ok("new hire: recorded as, training date/by/link, initial + evaluator", h.recordedAs === "New hire" && h.trainingCompleted === "2026-03-20" && h.trainingBy === "J. Trainer" && h.trainingUrl === "https://example.com/t.pdf" && h.initialCompleted === "2026-04-06" && h.initialEvaluator === "T. Sup");
ok("new hire with initial: cleared = 'Yes'", h.cleared === "Yes", h.cleared);
ok("late 6-month: next item 1st annual, next due 2027-04-06, Compliant", h.nextItem === "1st annual competency due" && h.nextDue === "2027-04-06" && h.status === "Compliant", JSON.stringify([h.nextItem, h.nextDue, h.status]));
ok("test systems joined; 1 open reevaluation", h.testSystems === "XN-1000; Manual Differential" && h.openReevaluations === 1, `${h.testSystems} / ${h.openReevaluations}`);
const b = by("Bell");
ok("1st annual figured from the initial before the 6-month (2026-04-20 + 12 = 2027-04-20)", b.firstAnnualDue === "2027-04-20" && b.sixMonthDue === "2026-10-20", `${b.firstAnnualDue}`);
ok("6-month due in 9 days -> 'Due in 30 days'", b.status === "Due in 30 days" && b.nextDue === "2026-10-20", `${b.status} ${b.nextDue}`);
const c = by("Cole");
ok("new hire without initial, not past hire + 90 -> 'Not cleared', cleared 'No'", c.status === "Not cleared" && c.cleared === "No" && c.nextItem === "Initial competency not completed", `${c.status} ${c.cleared}`);
const d = by("Dunn");
ok("legacy row without initial, past hire/added + 90 -> 'Overdue', recorded as 'Not set'", d.status === "Overdue" && d.recordedAs === "Not set", `${d.status} ${d.recordedAs}`);
const m = by("Moss");
ok("existing staff with last annual -> cleared 'Existing staff', annual due 2026-12-15, 'Due in 90 days'", m.cleared === "Existing staff" && m.nextAnnualDue === "2026-12-15" && m.status === "Due in 90 days" && m.recordedAs === "Existing staff", `${m.cleared} ${m.status}`);
const f = by("Ford");
ok("waived: 6-month and 1st annual N/A; complexity 'Waived'; annual due 2027-02-10", f.sixMonthDue === "N/A (waived)" && f.firstAnnualDue === "N/A (waived)" && f.complexity === "Waived" && f.nextAnnualDue === "2027-02-10", JSON.stringify([f.sixMonthDue, f.firstAnnualDue, f.complexity]));
const g = by("Gray");
ok("existing staff, annual due in 20 days -> 'Due in 30 days'", g.status === "Due in 30 days" && g.nextDue === "2026-10-31", `${g.status} ${g.nextDue}`);
const nys = buildCompetencyRegisterRows({ employees: [employees[1]], testSystems: new Map(), events: [], nys: true }, T).personnel[0];
ok("NYS lab: 1st annual is not figured from the initial (hire-anchored stored value only)", nys.firstAnnualDue === null, String(nys.firstAnnualDue));

console.log("--- Duty-Change Reevaluations rows ---");
ok("setup items excluded: 3 of 4 events listed", out.reevaluations.length === 3, String(out.reevaluations.length));
ok("open first, with the reevaluate-before-reporting note", out.reevaluations[0].status === "Open" && out.reevaluations[0].name.startsWith("Hale") && /before this person reports/.test(out.reevaluations[0].note));
const nac = out.reevaluations.find((r) => r.status === "Closed: not a change");
ok("not a change: reason and who closed it", !!nac && nac.note === "Already performed it; missing from the record" && nac.closedBy === "Michael Veri" && nac.closedOn === "2026-08-03");
const re = out.reevaluations.find((r) => r.status === "Reevaluated");
ok("reevaluated: evaluator and date", !!re && re.closedBy === "T. Sup" && re.closedOn === "2026-07-21");

console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
