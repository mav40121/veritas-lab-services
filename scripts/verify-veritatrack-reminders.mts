// Verify the VeritaTrack due-date reminder decision logic
// (server/veritatrackReminders.ts decideTaskReminder) plus the shared date
// helper it relies on (server/veritatrack.ts nextDue). Proves:
//   - approaching reminders fire once per ladder step inside the lead window
//   - a ladder step already sent is not re-sent (dedup)
//   - non-ladder day counts never fire
//   - days beyond lead_days never fire; the ladder is filtered to <= lead_days
//   - overdue (days<=0) and never-signed-off (days=null) fire on the cadence
//   - the overdue cadence gate respects daysSinceLastOverdue
//   - nextDue advances the month cleanly, clamps a month end (Jan 31 + 1 month = Feb 28/29, not Mar 3), and counts
//     days for Weekly (#111, Michael 2026-10-26); a weekly task's due-soon window is 2 days and its reminder lead 1 day
//   - daysUntilDateOnly counts from the lab's day
// Run: npx tsx scripts/verify-veritatrack-reminders.mts
import { decideTaskReminder, APPROACHING_LADDER } from "../server/veritatrackReminders";
import { nextDue, dueSoonWindow, daysUntilDateOnly } from "../server/veritatrack";
import { withLabClock, labLocalDate, addLabDays } from "../server/dateLocal";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  -- " + detail : ""}`); }
}

const none = new Set<string>();

console.log("APPROACHING ladder / lead window");
{
  const d = decideTaskReminder({ daysUntilDue: 14, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: null });
  check("days=14, lead=14, unsent -> notify approaching-14", d.notify === true && d.kind === "approaching-14", JSON.stringify(d));
}
{
  const d = decideTaskReminder({ daysUntilDue: 14, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: new Set(["approaching-14"]), daysSinceLastOverdue: null });
  check("days=14 already sent -> no notify (dedup)", d.notify === false && d.kind === "approaching-14", JSON.stringify(d));
}
{
  const d = decideTaskReminder({ daysUntilDue: 7, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: null });
  check("days=7, lead=14 -> notify approaching-7", d.notify === true && d.kind === "approaching-7", JSON.stringify(d));
}
{
  const d = decideTaskReminder({ daysUntilDue: 3, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: null });
  check("days=3 -> notify approaching-3", d.notify === true && d.kind === "approaching-3", JSON.stringify(d));
}
{
  const d = decideTaskReminder({ daysUntilDue: 1, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: null });
  check("days=1 -> notify approaching-1", d.notify === true && d.kind === "approaching-1", JSON.stringify(d));
}
{
  const d = decideTaskReminder({ daysUntilDue: 10, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: null });
  check("days=10 (not a ladder step) -> no notify", d.notify === false && d.kind === null, JSON.stringify(d));
}
{
  const d = decideTaskReminder({ daysUntilDue: 15, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: null });
  check("days=15 (> lead 14) -> no notify", d.notify === false && d.kind === null, JSON.stringify(d));
}
{
  const d = decideTaskReminder({ daysUntilDue: 30, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: null });
  check("days=30, lead=14 -> no notify (30 filtered out)", d.notify === false && d.kind === null, JSON.stringify(d));
}
{
  const d = decideTaskReminder({ daysUntilDue: 30, leadDays: 30, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: null });
  check("days=30, lead=30 -> notify approaching-30", d.notify === true && d.kind === "approaching-30", JSON.stringify(d));
}
{
  // lead=7 filters the ladder to [7,3,1]; 14 is no longer a valid step.
  const d = decideTaskReminder({ daysUntilDue: 14, leadDays: 7, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: null });
  check("days=14, lead=7 -> no notify (outside window)", d.notify === false && d.kind === null, JSON.stringify(d));
}

console.log("OVERDUE cadence");
{
  const d = decideTaskReminder({ daysUntilDue: 0, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: null });
  check("days=0 (due today), never sent -> notify overdue", d.notify === true && d.kind === "overdue", JSON.stringify(d));
}
{
  const d = decideTaskReminder({ daysUntilDue: -5, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: null });
  check("days=-5, never sent -> notify overdue", d.notify === true && d.kind === "overdue", JSON.stringify(d));
}
{
  const d = decideTaskReminder({ daysUntilDue: -5, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: 1 });
  check("overdue, 1 day since last, cadence 2 -> no notify", d.notify === false && d.kind === "overdue", JSON.stringify(d));
}
{
  const d = decideTaskReminder({ daysUntilDue: -5, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: 2 });
  check("overdue, 2 days since last, cadence 2 -> notify", d.notify === true && d.kind === "overdue", JSON.stringify(d));
}
{
  const d = decideTaskReminder({ daysUntilDue: -1, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: 0 });
  check("overdue, 0 days since last (already today) -> no notify", d.notify === false && d.kind === "overdue", JSON.stringify(d));
}
{
  const d = decideTaskReminder({ daysUntilDue: null, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: null });
  check("days=null (never signed off) -> notify overdue", d.notify === true && d.kind === "overdue", JSON.stringify(d));
}
{
  const d = decideTaskReminder({ daysUntilDue: null, leadDays: 14, overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: 3 });
  check("days=null, 3 since last, cadence 2 -> notify overdue", d.notify === true && d.kind === "overdue", JSON.stringify(d));
}

console.log("ladder shape + nextDue");
check("APPROACHING_LADDER descends [30,14,7,3,1]", JSON.stringify([...APPROACHING_LADDER]) === JSON.stringify([30, 14, 7, 3, 1]));
check("nextDue 2026-01-15 +6mo = 2026-07-15", nextDue("2026-01-15", 6) === "2026-07-15", nextDue("2026-01-15", 6));
check("nextDue 2026-06-30 +1mo = 2026-07-30", nextDue("2026-06-30", 1) === "2026-07-30", nextDue("2026-06-30", 1));
check("nextDue 2026-07-15 +12mo = 2027-07-15", nextDue("2026-07-15", 12) === "2027-07-15", nextDue("2026-07-15", 12));

console.log("month ends, Weekly, the lab's day (#111)");
check("nextDue 2026-01-31 +1mo = 2026-02-28 (was 2026-03-03)", nextDue("2026-01-31", 1) === "2026-02-28", nextDue("2026-01-31", 1));
check("nextDue 2028-01-31 +1mo = 2028-02-29 (leap year)", nextDue("2028-01-31", 1) === "2028-02-29", nextDue("2028-01-31", 1));
check("nextDue 2026-08-31 +3mo = 2026-11-30", nextDue("2026-08-31", 3) === "2026-11-30", nextDue("2026-08-31", 3));
check("nextDue 2026-12-15 +1mo = 2027-01-15 (year rolls)", nextDue("2026-12-15", 1) === "2027-01-15", nextDue("2026-12-15", 1));
check("Weekly: nextDue 2026-10-26 +7d = 2026-11-02", nextDue("2026-10-26", 0, 7) === "2026-11-02", nextDue("2026-10-26", 0, 7));
check("Weekly across a month end: 2026-10-29 +7d = 2026-11-05", nextDue("2026-10-29", 0, 7) === "2026-11-05", nextDue("2026-10-29", 0, 7));
check("Weekly across a year end: 2026-12-28 +7d = 2027-01-04", nextDue("2026-12-28", 0, 7) === "2027-01-04", nextDue("2026-12-28", 0, 7));
check("a stored date-time sign-off uses its date part", nextDue("2026-10-26T23:30:00.000Z", 0, 7) === "2026-11-02", nextDue("2026-10-26T23:30:00.000Z", 0, 7));
check("frequency_days null falls back to months", nextDue("2026-10-26", 3, null) === "2027-01-26", nextDue("2026-10-26", 3, null));
check("due-soon window: weekly 2 days, monthly 30", dueSoonWindow({ frequency_days: 7 }) === 2 && dueSoonWindow({ frequency_days: null }) === 30 && dueSoonWindow({}) === 30);
check("daysUntilDateOnly with an explicit lab day", daysUntilDateOnly("2026-11-02", "2026-10-26") === 7 && daysUntilDateOnly("2026-10-25", "2026-10-26") === -1);
{
  const azToday = labLocalDate(new Date().toISOString(), false, "America/Phoenix");
  check("a never-signed task's base is the lab's day", withLabClock("America/Phoenix", () => nextDue(null, 0, 7)) === addLabDays(azToday, 7));
}
{
  // Weekly reminder lead: the runner passes leadDays = min(lab lead, 1) for a weekly task.
  const at3 = decideTaskReminder({ daysUntilDue: 3, leadDays: Math.min(14, 1), overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: null });
  const at1 = decideTaskReminder({ daysUntilDue: 1, leadDays: Math.min(14, 1), overdueCadenceDays: 2, approachingKindsSent: none, daysSinceLastOverdue: null });
  check("weekly, due in 3 days -> no reminder (the 30/14/7/3/1 ladder would send one)", at3.notify === false, JSON.stringify(at3));
  check("weekly, due tomorrow -> approaching-1", at1.notify === true && at1.kind === "approaching-1", JSON.stringify(at1));
}

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);
