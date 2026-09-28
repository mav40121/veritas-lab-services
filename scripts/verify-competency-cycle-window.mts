// Verifies competencyCycleWindowDays (shared/competencyStatus) and the
// "assessed this cycle" cutoff boundary used by GET /competency/owed:
// a first-year (semiannual) employee's covering assessment goes stale at 6
// months; an established employee's at 12 months (42 CFR 493.1451(b)(8)).
import { competencyCycleWindowDays } from "../shared/competencyStatus.ts";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log("  PASS", name); }
  else { fail++; console.log("  FAIL", name); }
}

// 1) Regime -> window days
ok("first-year (initial done, first annual not done) => 183",
  competencyCycleWindowDays({ initial_completed_at: "2026-04-01", first_annual_completed_at: null }) === 183);
ok("established (first annual done) => 365",
  competencyCycleWindowDays({ initial_completed_at: "2025-01-01", first_annual_completed_at: "2026-01-01" }) === 365);
ok("no schedule => 365 (never tighten)", competencyCycleWindowDays(null) === 365);
ok("not started (no initial) => 365", competencyCycleWindowDays({ initial_completed_at: null, first_annual_completed_at: null }) === 365);

// 2) Cutoff boundary: a covering assessment 200 days old.
const dayMs = 24 * 60 * 60 * 1000;
const today = new Date(); today.setHours(0, 0, 0, 0);
const assessed200 = today.getTime() - 200 * dayMs;
const firstYearCutoff = today.getTime() - competencyCycleWindowDays({ initial_completed_at: "2026-04-01", first_annual_completed_at: null }) * dayMs;
const establishedCutoff = today.getTime() - competencyCycleWindowDays({ initial_completed_at: "2025-01-01", first_annual_completed_at: "2026-01-01" }) * dayMs;
ok("200-day-old assessment is STALE for first-year employee (200 > 183)", !(assessed200 >= firstYearCutoff));
ok("200-day-old assessment is CURRENT for established employee (200 < 365)", assessed200 >= establishedCutoff);

// 3) A 150-day-old assessment is current for BOTH.
const assessed150 = today.getTime() - 150 * dayMs;
ok("150-day-old assessment current for first-year (150 < 183)", assessed150 >= firstYearCutoff);
ok("150-day-old assessment current for established (150 < 365)", assessed150 >= establishedCutoff);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
