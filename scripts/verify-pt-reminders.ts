// scripts/verify-pt-reminders.ts
//
// Receipt for MLC-2b (VeritaPT submission-deadline reminders). Imports the REAL
// decideTaskReminder and exercises the ptReminders.ts notifiable-selection: only
// PENDING events with a submission_due_date are candidates, and each is put
// through the shared approaching-ladder / lead-window / overdue-cadence / dedup
// decision. Mirrors the filter + decision in server/ptReminders.ts.
//
//   npx tsx scripts/verify-pt-reminders.ts
import { decideTaskReminder } from "../server/veritatrackReminders";

let fails = 0;
const ok = (label: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}${cond ? "" : "  -- " + detail}`); if (!cond) fails++; };

// Selection mirror: pending + has due date, then decide.
function ptNotifiable(events: any[], leadDays: number, overdueCadenceDays: number) {
  return events
    .filter(e => e.pass_fail === "pending" && e.submission_due_date)
    .map(e => ({ id: e.id, ...decideTaskReminder({
      daysUntilDue: e.days,
      leadDays,
      overdueCadenceDays,
      approachingKindsSent: e.approachingKindsSent || new Set<string>(),
      daysSinceLastOverdue: e.daysSinceLastOverdue ?? null,
    }) }))
    .filter(x => x.notify);
}

const events = [
  { id: 1, pass_fail: "pending", submission_due_date: "2026-08-01", days: -10 },                // overdue -> notify
  { id: 2, pass_fail: "pending", submission_due_date: "2026-08-18", days: 7 },                  // ladder step within lead -> notify approaching-7
  { id: 3, pass_fail: "pending", submission_due_date: "2026-08-21", days: 10 },                 // within lead but NOT a ladder step -> no
  { id: 4, pass_fail: "pending", submission_due_date: "2026-09-30", days: 45 },                 // beyond lead -> no
  { id: 5, pass_fail: "pass",    submission_due_date: "2026-08-01", days: -10 },                // graded -> excluded by filter
  { id: 6, pass_fail: "pending", submission_due_date: null,        days: 3 },                   // no due date -> excluded by filter
  { id: 7, pass_fail: "pending", submission_due_date: "2026-08-18", days: 7, approachingKindsSent: new Set(["approaching-7"]) }, // already sent -> dedup, no
];

const notif = ptNotifiable(events, 14, 2);
const ids = notif.map(n => n.id).sort();
ok("overdue pending event (1) and the ladder-step event (2) are notifiable", JSON.stringify(ids) === JSON.stringify([1, 2]), JSON.stringify(ids));
ok("event 1 fires kind 'overdue'", notif.find(n => n.id === 1)?.kind === "overdue");
ok("event 2 fires kind 'approaching-7'", notif.find(n => n.id === 2)?.kind === "approaching-7");
ok("non-ladder-step within lead (3), beyond-lead (4) are NOT notified", !ids.includes(3) && !ids.includes(4));
ok("a graded (pass) event (5) is excluded even though overdue", !ids.includes(5));
ok("a pending event with no due date (6) is excluded", !ids.includes(6));
ok("an already-sent approaching kind (7) is deduped", !ids.includes(7));

// Overdue cadence: sent 1 day ago (cadence 2) -> no; 2 days ago -> yes.
const od1 = decideTaskReminder({ daysUntilDue: -5, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: new Set(), daysSinceLastOverdue: 1 });
const od2 = decideTaskReminder({ daysUntilDue: -5, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: new Set(), daysSinceLastOverdue: 2 });
ok("overdue cadence: 1 day since last < cadence 2 -> no resend", od1.notify === false);
ok("overdue cadence: 2 days since last >= cadence 2 -> resend", od2.notify === true && od2.kind === "overdue");

console.log(fails === 0 ? "\n=== PT REMINDERS: PASS (real decideTaskReminder, selection verified) ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
