// scripts/verify-veritacheck-verification-scope.mjs
//
// Receipt for the cross-lab IDOR fix on VeritaCheck verification child rows.
// PATCH/DELETE of an instrument unit or study slot must reject an id that
// belongs to a DIFFERENT verification, so a writer cannot edit or flip another
// lab's verification by primary key. Before the fix these mutated by bare id
// under a parent-only guard and returned 200.
//
// Drives the NEGATIVE case only (non-mutating): pair verification A (accessible)
// with a child id from verification B and assert 404. Skips if env absent.
//
// Env: BASE (default prod www), VERIFY_TOKEN, VERIF_ID (a verification the token
// can access), FOREIGN_UNIT_ID (instrument unit on another verification),
// FOREIGN_SLOT_ID (study slot on another verification).

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.VERIFY_TOKEN || "";
const VERIF = process.env.VERIF_ID || "";
const UNIT = process.env.FOREIGN_UNIT_ID || "";
const SLOT = process.env.FOREIGN_SLOT_ID || "";

if (!TOKEN || !VERIF || (!UNIT && !SLOT)) {
  console.log("SKIP: set VERIFY_TOKEN + VERIF_ID + FOREIGN_UNIT_ID/FOREIGN_SLOT_ID to run.");
  process.exit(0);
}
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
let fails = 0;
async function check(label, method, url, body) {
  const r = await fetch(`${BASE}${url}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const ok = r.status === 404;
  console.log(`${ok ? "PASS" : "FAIL"}: ${label} -> HTTP ${r.status} (want 404)`);
  if (!ok) fails++;
}
if (UNIT) {
  await check("PATCH foreign instrument unit", "PATCH", `/api/veritacheck/verifications/${VERIF}/instruments/${UNIT}`, { location: "SCOPE_PROBE" });
  await check("DELETE foreign instrument unit", "DELETE", `/api/veritacheck/verifications/${VERIF}/instruments/${UNIT}`);
}
if (SLOT) {
  await check("PATCH foreign study slot (verdict flip)", "PATCH", `/api/veritacheck/verifications/${VERIF}/studies/${SLOT}`, { passed: 1 });
}
console.log(fails === 0 ? "\n=== VERITACHECK VERIFICATION SCOPE: ALL PASS (foreign child id rejected) ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
