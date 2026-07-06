// scripts/verify-comp-element-status.mjs
//
// Pure-logic mirror of the VeritaComp per-element status derivation in
// client/src/pages/VeritaCompAppPage.tsx (the "6 CLIA Competency Elements"
// summary table). Regression receipt for the 2026-07-06 fix: a competency
// signed on paper and entered as an overall determination has element rows
// that were never individually scored (every item defaults passed=0). The old
// logic derived FAIL there, producing a false "fail across the board" wall
// that contradicted the director's recorded verdict. The fix: only assert
// PASS/FAIL for an element that was actually scored; for unscored elements,
// mirror the assessment's overall status.
//
// Run: node scripts/verify-comp-element-status.mjs

// Mirror of the client derivation. `overallStatus` is the assessment's stored
// status field ("pass" | "fail" | "remediation" | ...). `items` is the list
// of assessment_items for one element (already filtered by method_number).
function elementStatus(items, overallStatus) {
  const scored = items.filter((i) =>
    !!i.passed || !!i.date_met || !!i.employee_initials || !!i.supervisor_initials || !!(i.evidence && String(i.evidence).trim())
  );
  if (items.length === 0) return "N/A";
  if (scored.length === 0) {
    return overallStatus === "pass" ? "PASS" : overallStatus === "fail" ? "FAIL" : "N/A";
  }
  return scored.every((i) => i.passed) ? "PASS" : "FAIL";
}

const blank = () => ({ passed: 0, date_met: null, employee_initials: null, supervisor_initials: null, evidence: null });
const scoredPass = () => ({ passed: 1, date_met: "2026-01-27", employee_initials: "BF", supervisor_initials: "MV", evidence: "obs" });
const scoredFail = () => ({ passed: 0, date_met: "2026-01-27", employee_initials: "BF", supervisor_initials: "MV", evidence: "obs" });

const cases = [
  // The reported bug: overall pass, element rows all blank (passed=0) -> was FAIL.
  { name: "unscored element on an overall-PASS record shows PASS, not FAIL", items: [blank(), blank(), blank()], overall: "pass", expect: "PASS" },
  { name: "unscored element on an overall-FAIL record shows FAIL", items: [blank(), blank()], overall: "fail", expect: "FAIL" },
  { name: "unscored element on a remediation record shows N/A (muted)", items: [blank()], overall: "remediation", expect: "N/A" },
  { name: "element with no items shows N/A regardless of overall status", items: [], overall: "pass", expect: "N/A" },
  { name: "genuinely scored + passed element shows PASS", items: [scoredPass(), scoredPass()], overall: "pass", expect: "PASS" },
  { name: "genuinely scored failure (date/initials present, passed=0) shows FAIL even on overall PASS", items: [scoredPass(), scoredFail()], overall: "pass", expect: "FAIL" },
  { name: "mixed scored-pass + unscored-blank ignores the blank, shows PASS", items: [scoredPass(), blank()], overall: "pass", expect: "PASS" },
  { name: "a lone evidence string counts as scored (passed=0) -> FAIL", items: [{ ...blank(), evidence: "note only" }], overall: "pass", expect: "FAIL" },
  { name: "whitespace-only evidence does NOT count as scored -> mirrors overall PASS", items: [{ ...blank(), evidence: "   " }], overall: "pass", expect: "PASS" },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const got = elementStatus(c.items, c.overall);
  const ok = got === c.expect;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}${ok ? "" : `  (expected ${c.expect}, got ${got})`}`);
  ok ? pass++ : fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
