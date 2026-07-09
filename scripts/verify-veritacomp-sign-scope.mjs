// scripts/verify-veritacomp-sign-scope.mjs
//
// Receipt for the lab-scoped competency sign route (2026-07-09 review). The
// legacy POST /api/competency/assessments/:id/sign gates on the program's
// user_id, so a multi-lab OWNER could sign an assessment in a lab other than the
// active one by a stale id. The new lab-scoped twin
// POST /api/labs/:labId/competency/assessments/:id/sign pins the program to the
// URL's labId and 404s an assessment that is not in that lab.
//
// Drives the NEGATIVE case only (non-mutating): pair a lab the token can access
// with an assessment id that is NOT in that lab and assert HTTP 404. Skips
// (compile-safe) when env is absent.
//
// Env: BASE (default prod www), VERIFY_TOKEN (a VeritaComp-writer JWT), LAB_ID
// (a lab the token can access), FOREIGN_ASSESSMENT_ID (an assessment in a
// DIFFERENT lab, or a non-existent id).

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.VERIFY_TOKEN || "";
const LAB_ID = process.env.LAB_ID || "";
const FOREIGN = process.env.FOREIGN_ASSESSMENT_ID || "";

if (!TOKEN || !LAB_ID || !FOREIGN) {
  console.log("SKIP: set VERIFY_TOKEN + LAB_ID + FOREIGN_ASSESSMENT_ID to run the live 404 check.");
  process.exit(0);
}

const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
let fails = 0;
async function check(label, url) {
  // Empty body = a same-day sign; the guard must reject on the id/lab mismatch
  // BEFORE any UPDATE runs, so this is non-mutating on a correctly-scoped server.
  const r = await fetch(`${BASE}${url}`, { method: "POST", headers: H, body: "{}" });
  const ok = r.status === 404;
  console.log(`${ok ? "PASS" : "FAIL"}: ${label} -> HTTP ${r.status} (want 404)`);
  if (!ok) fails++;
}

await check(
  "lab-scoped sign with foreign assessment id",
  `/api/labs/${LAB_ID}/competency/assessments/${FOREIGN}/sign`,
);

console.log(fails === 0
  ? "\n=== VERITACOMP SIGN SCOPE: PASS (foreign assessment rejected by lab pin) ==="
  : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
