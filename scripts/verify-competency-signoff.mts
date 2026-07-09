// scripts/verify-competency-signoff.mts
//
// Receipt for the VeritaComp competency-PDF sign-off fixes (2026-07-09):
//   1. The "Overall Determination" in the Evaluator Sign-Off block hardcoded
//      "PASS" (green) regardless of the real verdict, so a FAILED competency
//      record certified PASS above the signature -- an indefensible document.
//   2. The evaluator name/title/initials fell back to "M. Veri" / "Technical
//      Consultant" / "MV" when blank, stamping Michael's identity on other labs'
//      records.
//
// Renders the real buildCompetencyHTML for pass / fail / remediation and a blank
// template, and asserts the sign-off reflects the actual verdict and never the
// personal-identity fallback. No DB, no browser.
//
// Run: node_modules/.bin/tsx scripts/verify-competency-signoff.mts

import { buildCompetencyHTML } from "../server/pdfReport";

let fails = 0;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

const render = (status: string, extra: Record<string, any> = {}, blank = false) =>
  buildCompetencyHTML({
    assessment: { status, employee_name: "Test Tech", competency_type: "moderate", assessment_type: "6-month", assessment_date: "2026-06-01", ...extra },
    items: [], methodGroups: [], checklistItems: [], labName: "Riverside Regional", cliaNumber: "22D0999999", blank,
  } as any);

const failHtml = render("fail");
const passHtml = render("pass");
const remHtml = render("remediation");
const blankHtml = render("", {}, true);

console.log("=== Sign-off determination reflects the real verdict ===");
ok("FAIL record sign-off says 'Overall Determination: FAIL'", failHtml.includes("Overall Determination: FAIL"));
ok("FAIL record sign-off does NOT say 'Overall Determination: PASS'", !failHtml.includes("Overall Determination: PASS"));
ok("PASS record sign-off says 'Overall Determination: PASS'", passHtml.includes("Overall Determination: PASS"));
ok("REMEDIATION record sign-off says 'Overall Determination: REMEDIATION REQUIRED'", remHtml.includes("Overall Determination: REMEDIATION REQUIRED"));
ok("BLANK template shows a fill-in line, not PASS", blankHtml.includes("Overall Determination: ____________") && !blankHtml.includes("Overall Determination: PASS"));

console.log("\n=== No personal-identity fallback stamped on other labs' records ===");
ok("no 'M. Veri' fallback when evaluator_name blank", !failHtml.includes("M. Veri") && !passHtml.includes("M. Veri"));
ok("a supplied evaluator name still renders", render("pass", { evaluator_name: "A. Director" }).includes("A. Director"));

console.log(fails === 0 ? "\n=== ALL PASS: sign-off is verdict-accurate and identity-safe ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
