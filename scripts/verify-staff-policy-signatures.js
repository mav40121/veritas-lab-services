#!/usr/bin/env node
/**
 * verify-staff-policy-signatures.js
 *
 * Receipt for LHF-1 (surface kiosk Staff Portal policy signatures to the
 * director/surveyor views). The only branching pure-logic is the signer-name
 * formatter shared by the roster/surveyor helper, the compliance rollup, and
 * the xlsx sheet. Keep in lockstep with staffPolicySignaturesForDoc /
 * perStaffAttest in server/routes.ts.
 */

// Mirror of the name formatting used server-side: "Last, First M.", falling
// back to the typed signature, then a neutral label, so a deleted or unnamed
// staff row never renders blank on a surveyor-facing artifact.
function signerName(r) {
  const nm = [r.last_name, r.first_name].filter(Boolean).join(", ");
  return nm ? nm + (r.middle_initial ? ` ${r.middle_initial}.` : "") : (r.typed_signature || "Staff member");
}

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
  ok ? pass++ : fail++;
};

check("last, first, middle", signerName({ last_name: "Doe", first_name: "Jane", middle_initial: "Q" }), "Doe, Jane Q.");
check("last, first (no middle)", signerName({ last_name: "Doe", first_name: "Jane" }), "Doe, Jane");
check("last only", signerName({ last_name: "Doe" }), "Doe");
check("first only", signerName({ first_name: "Jane" }), "Jane");
check("no name -> typed signature fallback", signerName({ typed_signature: "J. Doe" }), "J. Doe");
check("no name, no typed -> neutral label", signerName({}), "Staff member");
check("empty strings treated as absent", signerName({ last_name: "", first_name: "", typed_signature: "X" }), "X");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
