// Verify the manual-method attestation PDF renderer (renderManualMethodElementHtml).
// Proves: the surveyor-facing framing ("Manual method (attested; not computed by
// VeritaCheck)", "PASS (attested by manual method)"), that the note + evidence
// URL render, that a missing URL falls back to "Retained in the laboratory
// record.", and that free-text note/URL are HTML-escaped (no injection).
// Run: npx tsx scripts/verify-manual-method.mts
import { renderManualMethodElementHtml } from "../server/veritacheck_verification";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  -- " + detail : ""}`); }
}

const teal = "#01696F";

// 1. Full attestation with note + evidence URL.
const full = renderManualMethodElementHtml("Precision", "CLSI EP15-A3", {
  analyte: "Manual Differential",
  manual_note: "Verified against 20 concurrent manual diffs; within CLSI H20 limits.",
  manual_evidence_url: "https://example.com/evidence/manual-diff",
}, teal);
check("labels as manual method (attested; not computed)", full.includes("Manual method (attested; not computed by VeritaCheck)"));
check("result reads PASS (attested by manual method)", full.includes("PASS") && full.includes("attested by manual method"));
check("renders the analyte", full.includes("Manual Differential"));
check("renders the attestation note", full.includes("within CLSI H20 limits"));
check("renders the evidence link", full.includes('href="https://example.com/evidence/manual-diff"'));

// 2. No evidence URL -> fallback text, no <a>.
const noUrl = renderManualMethodElementHtml("Carryover", "CLSI EP10-A3", { manual_note: "n/a" }, teal);
check("no URL falls back to 'Retained in the laboratory record.'", noUrl.includes("Retained in the laboratory record."));
check("no URL renders no anchor tag", !noUrl.includes("<a href"));

// 3. HTML injection in the note + URL is escaped.
const evil = renderManualMethodElementHtml("Accuracy", "EP15", {
  manual_note: '<script>alert(1)</script> & "quote"',
  manual_evidence_url: 'https://x/"><script>bad()</script>',
}, teal);
check("note script tag is escaped", !evil.includes("<script>alert(1)</script>") && evil.includes("&lt;script&gt;"));
check("note ampersand/quote escaped", evil.includes("&amp;") && evil.includes("&quot;"));
check("evidence URL attribute cannot break out", !evil.includes('"><script>bad()'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
