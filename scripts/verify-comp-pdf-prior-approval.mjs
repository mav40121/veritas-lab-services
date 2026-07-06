// scripts/verify-comp-pdf-prior-approval.mjs
//
// Pure-logic mirror of the VeritaComp PDF prior-approval changes in
// server/pdfReport.ts (2026-07-06). Regression receipt for PR 3:
//   1. compItemWasScored: an item counts as scored only if it has a pass flag,
//      date, initials, or evidence.
//   2. Element summary badge: unscored elements mirror the overall status
//      instead of printing a FAIL wall (matches the client fix).
//   3. Per-item verdict cell: scored items show Pass/Fail; unscored items show
//      "Not recorded" (so the detail pages stay consistent with the summary).
//   4. Prior-approval line renders only when signed_on_paper_date is set and
//      carries both dates plus the documentation.
//
// Run: node scripts/verify-comp-pdf-prior-approval.mjs

function compItemWasScored(item) {
  return !!(item.passed || item.date_met || item.employee_initials || item.supervisor_initials || (item.evidence && String(item.evidence).trim()));
}

// Element summary label (page 1) — mirror of the pdfReport derivation.
function elementSummary(items, overallStatus, naKey) {
  const isNa = items.length > 0 && items.every((i) => i[naKey]);
  const scored = items.filter(compItemWasScored);
  if (isNa) return "N/A";
  if (items.length === 0) return "N/A";
  if (scored.length === 0) return overallStatus === "pass" ? "PASS" : overallStatus === "fail" ? "FAIL" : "N/A";
  return scored.every((i) => i.passed) ? "PASS" : "FAIL";
}

// Per-item verdict cell text.
function itemVerdict(item) {
  if (!compItemWasScored(item)) return "Not recorded";
  return item.passed ? "Pass" : "Fail";
}

// Prior-approval line (returns "" when not a prior approval).
function priorApprovalLine(assessment) {
  if (!assessment.signed_on_paper_date) return "";
  const entered = assessment.completion_date ? String(assessment.completion_date).slice(0, 10) : "";
  let s = `Signed on paper: ${assessment.signed_on_paper_date}`;
  if (entered) s += `. Entered: ${entered}`;
  if (assessment.prior_approval_note) s += `. Documentation: ${assessment.prior_approval_note}`;
  return s;
}

const blank = () => ({ passed: 0, date_met: null, employee_initials: null, supervisor_initials: null, evidence: null });
const scoredPass = () => ({ passed: 1, date_met: "2026-01-27", employee_initials: "BF", supervisor_initials: "MV", evidence: null });
const scoredFail = () => ({ passed: 0, date_met: "2026-01-27", employee_initials: "BF", supervisor_initials: "MV", evidence: "observed" });

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (expected ${JSON.stringify(want)}, got ${JSON.stringify(got)})`}`);
  ok ? pass++ : fail++;
};

// Element summary: the Bobbi case (unscored, overall pass) -> PASS not FAIL.
check("unscored element on overall PASS -> PASS", elementSummary([blank(), blank(), blank()], "pass", "elX_na"), "PASS");
check("unscored element on overall FAIL -> FAIL", elementSummary([blank()], "fail", "elX_na"), "FAIL");
check("scored+passed element -> PASS", elementSummary([scoredPass(), scoredPass()], "pass", "elX_na"), "PASS");
check("scored failure -> FAIL even on overall PASS", elementSummary([scoredPass(), scoredFail()], "pass", "elX_na"), "FAIL");
check("N/A element (na flag) -> N/A", elementSummary([{ ...blank(), elX_na: 1 }], "pass", "elX_na"), "N/A");
check("no items -> N/A", elementSummary([], "pass", "elX_na"), "N/A");

// Per-item verdict cell.
check("unscored item -> Not recorded", itemVerdict(blank()), "Not recorded");
check("scored pass item -> Pass", itemVerdict(scoredPass()), "Pass");
check("scored fail item -> Fail", itemVerdict(scoredFail()), "Fail");
check("evidence-only item is scored -> Fail", itemVerdict({ ...blank(), evidence: "note" }), "Fail");
check("whitespace evidence is not scored -> Not recorded", itemVerdict({ ...blank(), evidence: "   " }), "Not recorded");

// Prior-approval line.
check("no signed_on_paper_date -> no line", priorApprovalLine({ signed_on_paper_date: null, completion_date: "2026-07-06T00:00:00Z" }), "");
check("prior approval renders both dates + documentation", priorApprovalLine({ signed_on_paper_date: "2026-01-27", completion_date: "2026-07-06T19:30:00Z", prior_approval_note: "paper 1/27, entered today" }), "Signed on paper: 2026-01-27. Entered: 2026-07-06. Documentation: paper 1/27, entered today");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
