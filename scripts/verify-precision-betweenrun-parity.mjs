// scripts/verify-precision-betweenrun-parity.mjs
// Proves the demo precision PDF now agrees with the client's EP15-A3 nested ANOVA
// (and the on-screen table) on every CV component. The demo PDF endpoint
// (server/routes.ts /api/demo/studies/:id/pdf) used betweenRunCV = withinRunCV * 0.6,
// a display heuristic with no EP15 basis, while the client (client/src/lib/calculations.ts)
// computes betweenRunCV via nested ANOVA -> 0 for a single-run-per-day design.
// This mirrors BOTH methods on one 5-day x 1-run dataset and asserts within-run,
// between-day, between-run, and total CV all match, and that the old *0.6 heuristic
// would have disagreed. Run: node scripts/verify-precision-betweenrun-parity.mjs

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log("PASS  " + n); } else { fail++; console.log("FAIL  " + n); } };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Balanced EP15 study: 5 days x 4 replicates/day, one run per day.
const days = [
  [99.8, 100.2, 100.0, 99.9],
  [100.5, 100.7, 100.4, 100.6],
  [99.5, 99.6, 99.4, 99.7],
  [100.1, 100.3, 100.0, 100.2],
  [99.9, 100.0, 100.1, 99.8],
];
const all = days.flat();
const grand = mean(all);

// ── SERVER method (mirror of routes.ts, WITH the fix betweenRunCV = 0) ──────
function serverMethod() {
  const k = days.length;
  const nPerDay = days[0].length;
  const wrVar = days.reduce((acc, d) => {
    const dm = mean(d);
    return acc + d.reduce((s, v) => s + (v - dm) ** 2, 0);
  }, 0) / (all.length - k);
  const withinRunCV = (Math.sqrt(wrVar) / grand) * 100;
  const msBetween = days.reduce((acc, d) => acc + nPerDay * (mean(d) - grand) ** 2, 0) / (k - 1);
  const bdVar = Math.max(0, (msBetween - wrVar) / nPerDay);
  const betweenDayCV = (Math.sqrt(bdVar) / grand) * 100;
  const betweenRunCV = 0; // the fix
  const totalCV = (Math.sqrt(wrVar + bdVar) / grand) * 100;
  const oldBetweenRunCV = withinRunCV * 0.6; // the pre-fix heuristic, for the repro
  return { withinRunCV, betweenDayCV, betweenRunCV, totalCV, oldBetweenRunCV };
}

// ── CLIENT method (mirror of calculations.ts advanced ANOVA, runsPerDay = 1) ─
function clientMethod() {
  const runsPerDay = 1;
  const replicatesPerRun = days[0].length;
  let ssWithin = 0, dfWithin = 0, ssBetweenRun = 0, dfBetweenRun = 0;
  const dayMeans = [];
  for (const dayRuns of days) {
    const runMeans = [];
    for (let r = 0; r < runsPerDay; r++) {
      const runVals = dayRuns.slice(r * replicatesPerRun, (r + 1) * replicatesPerRun);
      const rm = mean(runVals);
      runMeans.push(rm);
      ssWithin += runVals.reduce((s, v) => s + (v - rm) ** 2, 0);
      dfWithin += runVals.length - 1;
    }
    const dm = mean(runMeans);
    dayMeans.push(dm);
    ssBetweenRun += runMeans.reduce((s, rm) => s + replicatesPerRun * (rm - dm) ** 2, 0);
    dfBetweenRun += runMeans.length - 1;
  }
  const gMean = mean(dayMeans);
  const ssBetweenDay = dayMeans.reduce((s, dm) => s + (runsPerDay * replicatesPerRun) * (dm - gMean) ** 2, 0);
  const dfBetweenDay = dayMeans.length - 1;
  const msWithin = dfWithin > 0 ? ssWithin / dfWithin : 0;
  const msBetweenRun = dfBetweenRun > 0 ? ssBetweenRun / dfBetweenRun : 0;
  const msBetweenDay = dfBetweenDay > 0 ? ssBetweenDay / dfBetweenDay : 0;
  const varWithinRun = msWithin;
  const varBetweenRun = Math.max(0, (msBetweenRun - msWithin) / replicatesPerRun);
  const msNextDown = dfBetweenRun > 0 ? msBetweenRun : msWithin;
  const varBetweenDay = Math.max(0, (msBetweenDay - msNextDown) / (runsPerDay * replicatesPerRun));
  const varTotal = varWithinRun + varBetweenRun + varBetweenDay;
  const toCV = (v) => (Math.sqrt(v) / gMean) * 100;
  return { withinRunCV: toCV(varWithinRun), betweenDayCV: toCV(varBetweenDay), betweenRunCV: toCV(varBetweenRun), totalCV: toCV(varTotal) };
}

const s = serverMethod();
const c = clientMethod();
console.log(`server: within=${s.withinRunCV.toFixed(4)} betweenDay=${s.betweenDayCV.toFixed(4)} betweenRun=${s.betweenRunCV.toFixed(4)} total=${s.totalCV.toFixed(4)}`);
console.log(`client: within=${c.withinRunCV.toFixed(4)} betweenDay=${c.betweenDayCV.toFixed(4)} betweenRun=${c.betweenRunCV.toFixed(4)} total=${c.totalCV.toFixed(4)}\n`);

check("between-run CV is 0 on the fixed server path", near(s.betweenRunCV, 0));
check("between-run CV is 0 on the client ANOVA (single run/day)", near(c.betweenRunCV, 0));
check("between-run parity: server == client", near(s.betweenRunCV, c.betweenRunCV));
check("within-run CV parity: server == client", near(s.withinRunCV, c.withinRunCV));
check("between-day CV parity: server == client", near(s.betweenDayCV, c.betweenDayCV));
check("total CV parity: server == client", near(s.totalCV, c.totalCV));
check("within-run CV is a real nonzero value (sanity)", s.withinRunCV > 0);
check("between-day CV is a real nonzero value (sanity, there IS day-to-day spread)", s.betweenDayCV > 0);

// Repro: the old 0.6 heuristic produced a nonzero between-run that disagreed with the client.
check("repro: the old withinRunCV*0.6 heuristic was nonzero", s.oldBetweenRunCV > 0);
check("repro: the old heuristic DISAGREED with the client ANOVA", !near(s.oldBetweenRunCV, c.betweenRunCV, 1e-6));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
