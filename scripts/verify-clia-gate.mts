// Verify the lab-identity gate for finalized VeritaCheck studies.
// Proves: drafts are always exempt; a non-draft save is blocked only when the
// lab has no usable CLIA (null / empty / whitespace); a real CLIA (including
// Michaels Lab's 55D5555555 and San Carlos 03D0531813) is allowed.
// Run: npx tsx scripts/verify-clia-gate.mts
import { blockFinalizeWithoutClia } from "../server/cliaGate";

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

// Drafts are never blocked, regardless of CLIA.
check("draft + no CLIA -> allowed", blockFinalizeWithoutClia(true, null) === false);
check("draft + empty CLIA -> allowed", blockFinalizeWithoutClia(true, "") === false);
check("draft + real CLIA -> allowed", blockFinalizeWithoutClia(true, "03D0531813") === false);

// Finalized studies require a usable CLIA.
check("finalize + real CLIA (San Carlos) -> allowed", blockFinalizeWithoutClia(false, "03D0531813") === false);
check("finalize + real CLIA (Michaels Lab) -> allowed", blockFinalizeWithoutClia(false, "55D5555555") === false);
check("finalize + null CLIA -> BLOCKED", blockFinalizeWithoutClia(false, null) === true);
check("finalize + undefined CLIA -> BLOCKED", blockFinalizeWithoutClia(false, undefined) === true);
check("finalize + empty CLIA -> BLOCKED", blockFinalizeWithoutClia(false, "") === true);
check("finalize + whitespace CLIA -> BLOCKED", blockFinalizeWithoutClia(false, "   ") === true);
// Non-string junk is treated as no CLIA.
check("finalize + numeric junk -> BLOCKED", blockFinalizeWithoutClia(false, 12345 as any) === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
