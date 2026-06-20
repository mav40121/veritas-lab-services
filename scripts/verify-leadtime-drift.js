// scripts/verify-leadtime-drift.js
//
// Math receipt for the lead-time drift flag (GET .../lead-time-flags in
// server/veritabench.ts). Flag an item when its trailing-average actual lead
// time deviates from the programmed lead time by more than max(3 days, 25%),
// over at least 3 receipts. Direction: slower = actual longer (stockout risk),
// faster = actual shorter (over-buffered safety stock). Mirrors the endpoint.
//
//   node scripts/verify-leadtime-drift.js

const MIN_SAMPLE = 3, WINDOW = 6;

function drift(actualsNewestFirst, programmed) {
  const sample = actualsNewestFirst.slice(0, WINDOW);
  if (sample.length < MIN_SAMPLE || !Number.isFinite(programmed) || programmed <= 0) return null;
  const avg = sample.reduce((a, b) => a + b, 0) / sample.length;
  const tol = Math.max(3, programmed * 0.25);
  const delta = avg - programmed;
  if (Math.abs(delta) < tol) return null;
  return {
    direction: delta > 0 ? "slower" : "faster",
    avg_actual: Math.round(avg),
    suggested: Math.round(avg),
    sample_size: sample.length,
    delta_days: Math.round(delta),
  };
}

const cases = [
  { name: "RESP demo: 21d programmed, ~28d actual -> slower", actuals: [30, 28, 29, 27], programmed: 21, expect: { direction: "slower", suggested: 29 } },
  { name: "EDTA demo: 12d programmed, ~7d actual -> faster", actuals: [8, 6, 7], programmed: 12, expect: { direction: "faster", suggested: 7 } },
  { name: "On target -> no flag", actuals: [13, 11, 12], programmed: 12, expect: null },
  { name: "Small deviation under tolerance -> no flag", actuals: [14, 13, 14], programmed: 12, expect: null },
  { name: "Too few receipts -> no flag", actuals: [30, 30], programmed: 12, expect: null },
  { name: "Large programmed uses 25% band, not 3 days", actuals: [52, 52, 52], programmed: 40, expect: { direction: "slower", suggested: 52 } },
  { name: "Only the 6 most recent count", actuals: [22, 22, 22, 22, 22, 22, 5, 5], programmed: 21, expect: null },
];

let failed = 0;
for (const c of cases) {
  const got = drift(c.actuals, c.programmed);
  const ok = c.expect === null
    ? got === null
    : got && got.direction === c.expect.direction && got.suggested === c.expect.suggested;
  if (!ok) { failed++; console.log(`FAIL  ${c.name}: got ${JSON.stringify(got)}`); }
  else console.log(`PASS  ${c.name}${got ? ` -> ${got.direction} ${got.suggested}d` : " -> no flag"}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
