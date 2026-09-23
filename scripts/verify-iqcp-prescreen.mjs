// scripts/verify-iqcp-prescreen.mjs
//
// Gate 3 receipt (step 2, math/branch verification) for the IQCP Builder
// 3-question pre-screen. Exercises every branch of evaluatePrescreen():
// each single "no" must return not-indicated with the matching reason, and
// only all-three-yes returns indicated. Run:  npx tsx scripts/verify-iqcp-prescreen.mjs
import { evaluatePrescreen } from "../server/iqcpQuestionBank.ts";

let failures = 0;
function check(label, got, wantIndicated, reasonNeedle) {
  const okI = got.indicated === wantIndicated;
  const okR = got.reason.toLowerCase().includes(reasonNeedle.toLowerCase());
  const pass = okI && okR;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) {
    console.log(`      indicated: got ${got.indicated}, want ${wantIndicated}`);
    console.log(`      reason:    "${got.reason}"`);
    console.log(`      expected reason to contain: "${reasonNeedle}"`);
  }
}

// Branch 1: not nonwaived -> not indicated (waived reason)
check("waived test", evaluatePrescreen({ nonwaived: "no", reduce_intent: "yes", mfr_less_strict: "yes" }), false, "Waived tests never require");
// Branch 2: nonwaived but no intent to reduce -> not indicated (default QC reason)
check("no intent to reduce", evaluatePrescreen({ nonwaived: "yes", reduce_intent: "no", mfr_less_strict: "yes" }), false, "do not intend to run less QC");
// Branch 3: nonwaived + intent, but mfr QC >= default -> not indicated
check("mfr QC not less strict", evaluatePrescreen({ nonwaived: "yes", reduce_intent: "yes", mfr_less_strict: "no" }), false, "at least as stringent");
// Branch 4: all three yes -> indicated
check("all three yes", evaluatePrescreen({ nonwaived: "yes", reduce_intent: "yes", mfr_less_strict: "yes" }), true, "valid QC option");
// Robustness: case-insensitive + whitespace
check("YES with spaces/caps", evaluatePrescreen({ nonwaived: " YES ", reduce_intent: "Yes", mfr_less_strict: "yes" }), true, "valid QC option");
// Robustness: blank/undefined answer treated as not-yes -> not indicated at first gate
check("blank answers", evaluatePrescreen({}), false, "Waived tests never require");
// Short-circuit order: first "no" wins even if later answers are also "no"
check("multiple no, first wins", evaluatePrescreen({ nonwaived: "no", reduce_intent: "no", mfr_less_strict: "no" }), false, "Waived tests never require");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
