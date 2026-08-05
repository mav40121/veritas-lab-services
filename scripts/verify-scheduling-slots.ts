// Verify the scheduling engine changes: slot interval (session length != cadence),
// deterministic daily holds, and back-compat when interval is unset.
//   npx tsx scripts/verify-scheduling-slots.ts
import { computeAvailability, type AvailabilityRule } from "../server/scheduling";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
};

const MON = "2026-08-03"; // a Monday (day_of_week 1)
const rule = (dow: number, s: string, e: string): AvailabilityRule =>
  ({ id: 1, event_type_id: 1, day_of_week: dow, start_time: s, end_time: e, active: 1 });

// ── Test 1: 50-min sessions on a 60-min cadence, 08:00–16:50 → 9 on-the-hour slots
const t1 = computeAvailability({
  fromDate: MON, toDate: MON, durationMinutes: 50, intervalMinutes: 60,
  rules: [rule(1, "08:00", "16:50")], blackouts: [], bookings: [],
});
const starts = t1.map((s) => s.start_time);
ok("T1 count = 9 slots", t1.length === 9);
ok("T1 starts on the hour 08:00..16:00", JSON.stringify(starts) ===
   JSON.stringify(["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00"]));
ok("T1 each session is 50 minutes (08:00–08:50)", t1[0].start_time === "08:00" && t1[0].end_time === "08:50");
ok("T1 last session ends 16:50", t1[t1.length - 1].end_time === "16:50");

// ── Test 2: deterministic holds — same date twice = identical; count = 9 - (2 or 3)
const runHolds = () => computeAvailability({
  fromDate: MON, toDate: MON, durationMinutes: 50, intervalMinutes: 60,
  syntheticHoldsPerDay: 3, rules: [rule(1, "08:00", "16:50")], blackouts: [], bookings: [],
}).map((s) => s.start_time);
const h1 = runHolds(), h2 = runHolds();
ok("T2 holds are deterministic (identical across calls)", JSON.stringify(h1) === JSON.stringify(h2));
ok("T2 holds remove 2 or 3 slots (6 or 7 remain)", h1.length === 6 || h1.length === 7);
ok("T2 held slots are a subset of the full grid", h1.every((s) => starts.includes(s)));

// Different day → (very likely) different held set, still valid count
const TUE = "2026-08-04";
const hTue = computeAvailability({
  fromDate: TUE, toDate: TUE, durationMinutes: 50, intervalMinutes: 60,
  syntheticHoldsPerDay: 3, rules: [rule(2, "08:00", "16:50")], blackouts: [], bookings: [],
}).map((s) => s.start_time);
ok("T2 other day also holds 2–3", hTue.length === 6 || hTue.length === 7);

// ── Test 3: back-compat — interval unset ⇒ step == duration (30-min back-to-back)
const t3 = computeAvailability({
  fromDate: MON, toDate: MON, durationMinutes: 30,
  rules: [rule(1, "08:00", "09:00")], blackouts: [], bookings: [],
});
ok("T3 back-compat: 30-min back-to-back → 2 slots at 08:00, 08:30",
   t3.length === 2 && t3[0].start_time === "08:00" && t3[1].start_time === "08:30");

// ── Test 4: afternoon blackout removes ≥12:00 slots
const t4 = computeAvailability({
  fromDate: MON, toDate: MON, durationMinutes: 50, intervalMinutes: 60,
  rules: [rule(1, "08:00", "16:50")],
  blackouts: [{ id: 1, blackout_date: MON, start_time: "12:00", end_time: "23:59", reason: null }],
  bookings: [],
});
ok("T4 afternoon blackout: no slot starts at/after 12:00",
   t4.every((s) => s.start_time < "12:00") && t4.length === 4);

// ── Test 5: whole-day blackout removes all slots
const t5 = computeAvailability({
  fromDate: MON, toDate: MON, durationMinutes: 50, intervalMinutes: 60,
  rules: [rule(1, "08:00", "16:50")],
  blackouts: [{ id: 1, blackout_date: MON, start_time: null, end_time: null, reason: null }],
  bookings: [],
});
ok("T5 whole-day blackout: 0 slots", t5.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
