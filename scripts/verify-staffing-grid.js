// Verify the VeritaShift staffing-grid FTE math against Michael's LTSHealth Staff
// Management Tool "Staffing Grid" sheet: 27 position lines summing to 1,481 weekly
// hours = 37.0 FTE. Mirrors shared/operationsForecast.ts staffingGridFte.
//
// Run: node scripts/verify-staffing-grid.js

const WEEKS = 52;
function staffingGridFte(lines, hoursPerFteYear = 2080) {
  const weeklyHoursPerFte = hoursPerFteYear / WEEKS; // 40 at 2080
  const weeklyHours = lines.reduce((s, l) => s + ((l.hoursPerShift || 0) * (l.daysPerWeek || 0) + (l.overUnder || 0)), 0);
  return { weeklyHours, fteNeed: weeklyHoursPerFte > 0 ? weeklyHours / weeklyHoursPerFte : 0 };
}

let fails = 0;
const check = (n, c, got) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "  (got " + got + ")"}`); if (!c) fails++; };
const near = (a, b, t) => Math.abs(a - b) <= t;

// LTSHealth Staffing Grid, Main Lab (hoursPerShift, daysPerWeek, overUnder), from the
// tool's sheet 2 (TOTAL = hours x days + over/under).
const LTS = [
  [8, 5, 0], [8, 5, -20], [8, 5, -20], [8, 5, -24], [8, 5, 0], [28, 5, 0], [8, 5, 0], [8, 5, -20],
  [12, 6, 0], [12, 2, 0], [8, 5, 0], [8, 2, 0], [4, 5, 0], [8, 5, 0], [8, 2, 0], [12, 5, 24], [8, 2, 0],
  [24, 5, 40], [24, 2, 0], [24, 5, 0], [16, 2, 0], [26, 5, 20], [12, 2, 0], [6, 5, 0], [16, 1, 0], [37, 5, 0], [26, 2, 0],
].map(([h, d, o]) => ({ hoursPerShift: h, daysPerWeek: d, overUnder: o }));

const r = staffingGridFte(LTS);
check("LTSHealth grid weekly hours = 1,481", r.weeklyHours === 1481, r.weeklyHours);
check("LTSHealth grid FTE need ~ 37.0", near(r.fteNeed, 37.025, 0.05), r.fteNeed.toFixed(3));
check("27 position lines summed", LTS.length === 27, LTS.length);

check("over-under subtracts (Core Sup 8x5-20 = 20 hr)", staffingGridFte([{ hoursPerShift: 8, daysPerWeek: 5, overUnder: -20 }]).weeklyHours === 20);
check("over-under adds (Micro 12x5+24 = 84 hr)", staffingGridFte([{ hoursPerShift: 12, daysPerWeek: 5, overUnder: 24 }]).weeklyHours === 84);
check("empty grid -> 0 FTE", staffingGridFte([]).fteNeed === 0);
check("alt hoursPerFte 1872 (36 hr/wk) -> 1481/36 FTE", near(staffingGridFte(LTS, 1872).fteNeed, 1481 / 36, 0.05));

// Leverage-chain invariant: the coverage-built model exceeds the demand-driven budget,
// so the gap is positive. FMC budget = 0.12 x 450,000 / 2080 = 25.96 FTE.
check("coverage model FTE exceeds demand budget (positive gap)", r.fteNeed > 25.96, r.fteNeed.toFixed(2));

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
