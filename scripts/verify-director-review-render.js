#!/usr/bin/env node
/**
 * verify-director-review-render.js
 *
 * Receipt for the 2026-07-31 fix to directorReviewHTML (server/pdfReport.ts):
 * the VeritaCheck PDF "Laboratory Director or Designee Review" block now
 * reflects the electronic sign-off instead of always printing a blank wet-ink
 * template. San Carlos hit this: study #1199 (BILIRUBIN, DIRECT) was signed off
 * by "Chineme Swann" (finalized_signature captured), yet the PDF showed a blank
 * block. Rules:
 *   - finalized + signer present + NOT a fail  -> "Accepted" checked, signer
 *     name on Signature + Print Name, finalized date on Date.
 *   - finalized + signer + FAIL -> signer/date shown, accept boxes left blank
 *     (never assert acceptance on a failed run).
 *   - draft / no signer -> blank wet-ink template.
 *
 * Mirrors the branching as pure logic and asserts what the block would show.
 */

function reviewState(study) {
  const finalized = !!study && String(study.lifecycle_state || "") === "finalized";
  const signer = String((study && (study.finalized_signature ?? "")) || "").trim();
  const signedOn = study && study.finalized_at ? String(study.finalized_at).slice(0, 10) : "";
  const signed = finalized && !!signer;
  const accepted = signed && String((study && study.status) || "").toLowerCase() !== "fail";
  return {
    acceptedChecked: accepted,
    signatureShown: signed ? signer : "",
    dateShown: signed ? signedOn : "",
    blankTemplate: !signed,
  };
}

let fails = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log(`PASS  ${name}`);
  else { fails++; console.log(`FAIL  ${name}\n  expected ${JSON.stringify(want)}\n  got      ${JSON.stringify(got)}`); }
};

// The exact San Carlos case (study #1199).
eq("signed PASS (BILIRUBIN DIRECT / Chineme Swann)", reviewState({
  lifecycle_state: "finalized", finalized_signature: "Chineme Swann",
  finalized_at: "2026-07-31T19:39:33.141Z", status: "pass",
}), { acceptedChecked: true, signatureShown: "Chineme Swann", dateShown: "2026-07-31", blankTemplate: false });

eq("signed FAIL -> signer shown, accept NOT auto-checked", reviewState({
  lifecycle_state: "finalized", finalized_signature: "Chineme Swann",
  finalized_at: "2026-07-31T19:39:33.141Z", status: "fail",
}), { acceptedChecked: false, signatureShown: "Chineme Swann", dateShown: "2026-07-31", blankTemplate: false });

eq("draft study -> blank wet-ink template", reviewState({
  lifecycle_state: "draft", finalized_signature: null, finalized_at: null, status: "pass",
}), { acceptedChecked: false, signatureShown: "", dateShown: "", blankTemplate: true });

eq("finalized but no captured signer -> blank template", reviewState({
  lifecycle_state: "finalized", finalized_signature: "", finalized_at: null, status: "pass",
}), { acceptedChecked: false, signatureShown: "", dateShown: "", blankTemplate: true });

eq("no study object -> blank template", reviewState(undefined),
  { acceptedChecked: false, signatureShown: "", dateShown: "", blankTemplate: true });

console.log(`\n${fails === 0 ? "All" : "NOT all"} director-review render cases passed.`);
if (fails > 0) { console.error(`${fails} case(s) FAILED.`); process.exit(1); }
