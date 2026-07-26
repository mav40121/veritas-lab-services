// Verify the VeritaTrack due-date reminder decision logic
// (server/veritatrackReminders.ts decideTaskReminder) plus the shared date
// helper it relies on (server/veritatrack.ts nextDue). Proves:
//   - approaching reminders fire once per ladder step inside the lead window
//   - a ladder step already sent is not re-sent (dedup)
//   - non-ladder day counts never fire
//   - days beyond lead_days never fire; the ladder is filtered to <= lead_days
//   - overdue (days<=0) and never-signed-off (days=null) fire on the cadence
//   - the overdue cadence gate respects daysSinceLastOverdue
//   - nextDue advances the month cleanly
// Run: npx tsx scripts/verify-veritatrack-reminders.mts
import { decideTaskReminder, APPROACHING_LADDER } from "../server/veritatrackReminders";
import { nextDue } from "../server/veritatrack";

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

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);
