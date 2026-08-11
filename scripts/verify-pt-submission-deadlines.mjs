// scripts/verify-pt-submission-deadlines.mjs
//
// Receipt for MLC-2 (PT submission-deadline tracking). Exercises the classifier
// used by the VeritaPT deadline banner: a pending PT event is OVERDUE when its
// submission_due_date is before today, DUE-SOON when within [0, 14] days, and
// not surfaced otherwise. Passed/failed events (already submitted) never surface.
//
//   node scripts/verify-pt-submission-deadlines.mjs
let fails = 0;
const ok = (label, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}${cond ? "" : "  -- " + detail}`); if (!cond) fails++; };

const TODAY = "2026-08-11";
const daysTo = (d) => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(TODAY + "T00:00:00Z")) / 86400000);
// Mirror of the banner classifier in VeritaPTAppPage.tsx.
function classify(events) {
  const pending = events.filter(e => e.submission_due_date && (e.pass_fail === "pending" || !e.pass_fail));
  const overdue = pending.filter(e => daysTo(e.submission_due_date) < 0);
  const soon = pending.filter(e => { const d = daysTo(e.submission_due_date); return d >= 0 && d <= 14; });
  return { overdue: overdue.map(e => e.id), soon: soon.map(e => e.id) };
}

const events = [
  { id: 1, analyte: "Glucose", pass_fail: "pending", submission_due_date: "2026-08-05" }, // -6 overdue
  { id: 2, analyte: "Sodium",  pass_fail: "pending", submission_due_date: "2026-08-11" }, // 0 due-soon (today)
  { id: 3, analyte: "AST",     pass_fail: "pending", submission_due_date: "2026-08-25" }, // +14 due-soon (boundary)
  { id: 4, analyte: "TSH",     pass_fail: "pending", submission_due_date: "2026-08-26" }, // +15 not surfaced
  { id: 5, analyte: "K",       pass_fail: "pass",    submission_due_date: "2026-08-01" }, // passed -> excluded
  { id: 6, analyte: "Ca",      pass_fail: "pending", submission_due_date: null },          // no due date -> excluded
];
const { overdue, soon } = classify(events);

ok("overdue = the one past-due pending event (id 1)", JSON.stringify(overdue) === JSON.stringify([1]), JSON.stringify(overdue));
ok("due-soon includes today (id 2) and the +14 boundary (id 3)", JSON.stringify(soon.sort()) === JSON.stringify([2, 3]), JSON.stringify(soon));
ok("+15 days (id 4) is NOT surfaced", !soon.includes(4) && !overdue.includes(4));
ok("a passed event (id 5) never surfaces even though its date is past", !overdue.includes(5) && !soon.includes(5));
ok("an event with no due date (id 6) is excluded", !overdue.includes(6) && !soon.includes(6));
ok("day math: -6, 0, +14, +15 boundaries", daysTo("2026-08-05") === -6 && daysTo("2026-08-11") === 0 && daysTo("2026-08-25") === 14 && daysTo("2026-08-26") === 15);

console.log(fails === 0 ? "\n=== PT SUBMISSION DEADLINES: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
