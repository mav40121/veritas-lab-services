// Verify the VeritaPace leverage-chain math against Michael Veri's published FMC
// worked example (MedicalLab Management, June 2019):
//   goal 0.12 -> ~1037 hr/week (25.9 FTEs) budgeted; staffing model 1132 hr/week
//   (28.3 FTEs) = ~58,500 hr/year -> projected productivity 0.13.
//
// Mirrors shared/operationsForecast.ts. Run: node scripts/verify-forecast-from-goal.js

const HOURS_PER_FTE_YEAR = 2080; // 40 hr/week x 52
const WEEKS = 52;

function forecastFromGoal(goalRatio, annualVolume, hoursPerFteYear = HOURS_PER_FTE_YEAR) {
  const annualHourAllowance = goalRatio * annualVolume;
  return {
    annualHourAllowance,
    weeklyHourAllowance: annualHourAllowance / WEEKS,
    fteBudget: hoursPerFteYear > 0 ? annualHourAllowance / hoursPerFteYear : 0,
  };
}
function chainGap(annualVolume, fteBudget, staffingModelFte, hoursPerFteYear = HOURS_PER_FTE_YEAR) {
  const staffingModelAnnualHours = staffingModelFte * hoursPerFteYear;
  return {
    fteGap: staffingModelFte - fteBudget,
    staffingModelAnnualHours,
    projectedProductivity: annualVolume > 0 ? staffingModelAnnualHours / annualVolume : 0,
  };
}

let fails = 0;
function check(name, cond, got) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  (got " + got + ")"}`);
  if (!cond) fails++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- FMC: goal 0.12, projected volume ~450,000 tests/year ---
const VOL = 450000;
const f = forecastFromGoal(0.12, VOL);

check("annual hour allowance = goal x volume (exact 54,000)", f.annualHourAllowance === 54000, f.annualHourAllowance);
check("weekly hour allowance ~1037 (paper)", near(f.weeklyHourAllowance, 1037, 3), f.weeklyHourAllowance.toFixed(1));
check("FTE budget ~25.9 (paper)", near(f.fteBudget, 25.9, 0.1), f.fteBudget.toFixed(2));

// --- downstream: staffing model 28.3 FTEs -> ~58,500 hr -> projected productivity 0.13 ---
const g = chainGap(VOL, f.fteBudget, 28.3);
check("staffing-model annual hours ~58,500 (paper)", near(g.staffingModelAnnualHours, 58500, 400), g.staffingModelAnnualHours);
check("projected productivity ~0.13 (paper)", near(g.projectedProductivity, 0.13, 0.002), g.projectedProductivity.toFixed(4));
check("FTE gap = need - budget (model exceeds budget by ~2.4)", near(g.fteGap, 2.4, 0.15), g.fteGap.toFixed(2));

// --- formula sanity: zero/edge inputs ---
check("zero volume -> zero allowance & budget", forecastFromGoal(0.12, 0).fteBudget === 0);
check("zero hours-per-FTE guarded (no divide-by-zero)", forecastFromGoal(0.12, VOL, 0).fteBudget === 0);

// --- alternate hoursPerFte (e.g., productive-hours basis 1800) shifts FTE budget ---
const alt = forecastFromGoal(0.12, VOL, 1800);
check("alt hours-per-FTE (1800) -> 30.0 FTE budget", near(alt.fteBudget, 30.0, 0.05), alt.fteBudget.toFixed(2));

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
