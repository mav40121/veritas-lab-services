// Receipt for the Operations Leverage Report grid-only branch (PR: option 1).
//
// buildLeverageReportHTML must render three distinct states:
//   1. grid-only  (staffing grid present, no saved goal) -> show the staffing model
//      section (FTE need, weekly hours) + "What this shows", NOT the empty fallback.
//   2. full       (goal + staffing) -> the full leverage chain + "What the gap means".
//   3. empty      (no goal, no staffing) -> the "Set a goal ... populate the chain" fallback.
//
// Pure render assertions on the HTML string; no browser, no DB. Run: npx tsx scripts/verify-leverage-report-gridonly.mjs

import { buildLeverageReportHTML } from "../server/leverageReport.ts";

const CTX = { labName: "Michaels Lab", cliaNumber: "55D5555555", preparedBy: "John Hall", date: "2026-06-30" };

let fails = 0;
function check(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) fails++;
}

// 1. GRID-ONLY: no goal, staffing grid present (the case from the screenshot).
const gridOnly = buildLeverageReportHTML({
  goalRatio: null, annualVolume: null, hoursPerFte: 2080,
  annualHourAllowance: null, weeklyHourAllowance: null, fteBudget: null,
  staffingFte: 6.6, staffingSource: "grid", staffingWeeklyHours: 264,
  fteGap: null, projectedProductivity: null,
}, CTX);
check("grid-only: chain label is 'Staffing model'", gridOnly.includes("Staffing model"));
check("grid-only: shows FTE need row", gridOnly.includes("Staffing-model FTE need (shift grid)"));
check("grid-only: shows 6.6 FTE", gridOnly.includes("6.6 FTE"));
check("grid-only: shows weekly staffed hours 264", gridOnly.includes("264 hr/wk"));
check("grid-only: 'What this shows' heading", gridOnly.includes("What this shows"));
check("grid-only: interpretation cites the staffing model", gridOnly.includes("The staffing model needs 6.6 FTE based on 264 weekly staffed hours from the shift grid"));
check("grid-only: NOT the empty 'populate the chain' fallback", !gridOnly.includes("Set a goal in VeritaPace to populate the chain"));
check("grid-only: NOT a gap section", !gridOnly.includes("What the gap means"));
check("grid-only: no em dash", !gridOnly.includes("—"));

// 2. FULL: goal + staffing grid -> full chain + trade-off.
const full = buildLeverageReportHTML({
  goalRatio: 0.12, annualVolume: 450000, hoursPerFte: 2080,
  annualHourAllowance: 54000, weeklyHourAllowance: 1038, fteBudget: 25.96,
  staffingFte: 28.3, staffingSource: "grid", staffingWeeklyHours: 1132,
  fteGap: 2.34, projectedProductivity: 0.13,
}, CTX);
check("full: chain label is 'The leverage chain'", full.includes("The leverage chain"));
check("full: shows FTE budget at goal", full.includes("FTE budget at goal"));
check("full: shows the GAP row", full.includes("GAP (need minus budget)"));
check("full: 'What the gap means' heading", full.includes("What the gap means"));
check("full: trade-off Option A/B present", full.includes("Option A. Reduce staff") && full.includes("Option B. Invest"));

// 3. EMPTY: no goal, no staffing -> the original empty fallback.
const empty = buildLeverageReportHTML({
  goalRatio: null, annualVolume: null, hoursPerFte: 2080,
  annualHourAllowance: null, weeklyHourAllowance: null, fteBudget: null,
  staffingFte: null, staffingSource: "none", staffingWeeklyHours: null,
  fteGap: null, projectedProductivity: null,
}, CTX);
check("empty: shows the 'populate the chain' fallback", empty.includes("Set a goal in VeritaPace to populate the chain"));
check("empty: shows generic no-goal notice", empty.includes("No productivity goal and volume are set yet"));
check("empty: no staffing model section", !empty.includes("Staffing-model FTE need"));

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
