// scripts/verify-veritaceu-cycle.mjs
//
// Gate-3 receipt for VeritaCEU phase 1: the shared CE cycle math
// (computeCeuSummary in server/routes.ts), used by both the per-employee
// ceu-summary and the lab-wide roster-summary. Mirrors the function (with an
// injectable "now" for determinism) and exercises the window, attribution,
// capping, and the empty-roster case.
//
// Run: node scripts/verify-veritaceu-cycle.mjs

function computeCeuSummary(creditRows, required, cycleMonths, now = new Date()) {
  const cycleStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - cycleMonths, now.getUTCDate()));
  const cycleStartIso = cycleStart.toISOString();
  let earned = 0;
  const entries = [];
  for (const r of creditRows) {
    const when = r.activity_date || r.created_at;
    const whenIso = /^\d{4}-\d{2}-\d{2}$/.test(String(when))
      ? new Date(`${when}T00:00:00.000Z`).toISOString()
      : new Date(when).toISOString();
    const inCycle = whenIso >= cycleStartIso;
    const credits = typeof r.credits === "number" ? r.credits : 0;
    if (inCycle) earned += credits;
    entries.push({ inCycle, credits });
  }
  earned = Math.round(earned * 100) / 100;
  const remaining = Math.max(0, Math.round((required - earned) * 100) / 100);
  const pct = required > 0 ? Math.min(100, Math.round((earned / required) * 100)) : 0;
  const met = earned >= required;
  return { earned, remaining, pct, met, cycleStartIso, inCycleCount: entries.filter((e) => e.inCycle).length };
}

const NOW = new Date("2026-10-02T12:00:00.000Z"); // fixed reference
let pass = 0, fail = 0;
const eq = (name, got, want) => { if (got === want) { pass++; console.log(`  PASS  ${name} (= ${got})`); } else { fail++; console.log(`  FAIL  ${name}: got ${got}, want ${want}`); } };

// ASCP default 36/36mo. cycleStart = 2023-10-02.
// In-cycle activity.
let s = computeCeuSummary([{ credits: 12, activity_date: "2026-01-15" }], 36, 36, NOW);
eq("in-cycle credit earned", s.earned, 12);
eq("in-cycle remaining", s.remaining, 24);
eq("in-cycle pct", s.pct, 33);
eq("in-cycle not met", s.met, false);

// Out-of-cycle activity (before cycleStart 2023-10-02) does not count.
s = computeCeuSummary([{ credits: 50, activity_date: "2022-01-01" }], 36, 36, NOW);
eq("out-of-cycle earns 0", s.earned, 0);
eq("out-of-cycle inCycleCount 0", s.inCycleCount, 0);

// Boundary: exactly cycleStart counts (>=).
s = computeCeuSummary([{ credits: 36, activity_date: "2023-10-02" }], 36, 36, NOW);
eq("boundary date counts", s.earned, 36);
eq("boundary meets cycle", s.met, true);

// pct capped at 100 when over-earned.
s = computeCeuSummary([{ credits: 50, activity_date: "2026-02-02" }], 36, 36, NOW);
eq("pct capped at 100", s.pct, 100);
eq("remaining floored at 0", s.remaining, 0);
eq("over-earn met", s.met, true);

// Attribution falls back to created_at when no activity_date.
s = computeCeuSummary([{ credits: 10, created_at: "2026-03-03T09:00:00.000Z" }], 36, 36, NOW);
eq("created_at attribution in-cycle", s.earned, 10);

// Employee with no CE entries -> 0 earned, short, 0% (roster must still show them).
s = computeCeuSummary([], 36, 36, NOW);
eq("empty roster member earns 0", s.earned, 0);
eq("empty roster member not met", s.met, false);
eq("empty roster member pct 0", s.pct, 0);
eq("empty roster member remaining = required", s.remaining, 36);

// Custom requirement override (e.g. a state board rule).
s = computeCeuSummary([{ credits: 12, activity_date: "2026-01-01" }], 24, 24, NOW);
eq("custom required remaining", s.remaining, 12);
eq("custom required pct", s.pct, 50);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
