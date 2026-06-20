// scripts/verify-safety-stock.js
//
// Math receipt for the statistical safety-stock advisor in VeritaStockPage.tsx.
// SS_days = ceil(Z x CV x sqrt(lead_time_days)); Z by service level, CV by
// chosen demand-variability band; 0 when lead time is 0.
//
//   node scripts/verify-safety-stock.js

const SERVICE = { "90": 1.28, "95": 1.65, "98": 2.05, "99": 2.33 };
const CV = { low: 0.15, med: 0.30, high: 0.50 };

function suggest(leadTimeDays, serviceLevel, variability) {
  const z = SERVICE[serviceLevel] ?? 1.65;
  const cv = CV[variability] ?? 0.30;
  if (!(leadTimeDays > 0)) return 0;
  return Math.ceil(z * cv * Math.sqrt(leadTimeDays));
}

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${actual}, expected ${expected}`);
}

// 1.65 x 0.30 x sqrt(9)=3 -> 1.485 -> ceil 2
check("95% / med / lead 9", suggest(9, "95", "med"), 2);
// 2.33 x 0.50 x sqrt(16)=4 -> 4.66 -> ceil 5
check("99% / high / lead 16", suggest(16, "99", "high"), 5);
// 1.28 x 0.15 x sqrt(4)=2 -> 0.384 -> ceil 1
check("90% / low / lead 4", suggest(4, "90", "low"), 1);
// 1.65 x 0.30 x sqrt(25)=5 -> 2.475 -> ceil 3
check("95% / med / lead 25", suggest(25, "95", "med"), 3);
// lead 0 -> 0
check("lead 0 -> 0", suggest(0, "95", "med"), 0);
// higher service + variability never decreases the suggestion
const lo = suggest(9, "90", "low");
const hi = suggest(9, "99", "high");
check("99/high >= 90/low (monotonic)", hi >= lo, true);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
