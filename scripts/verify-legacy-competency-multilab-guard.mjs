// scripts/verify-legacy-competency-multilab-guard.mjs
//
// Receipt for hardening the legacy user_id-scoped competency routes (scorecard
// Security HIGH, 2026-07-10). The legacy PUT/DELETE/sign
// /api/competency/assessments/:id accept any assessment in the owner's account by
// id (no lab scope), so a multi-lab account could act on the wrong lab by a stale
// id. The lab-scoped /api/labs/:labId/... twins are the safe path (the client uses
// them whenever a lab is active). These legacy routes now reject when the account
// manages more than one lab (HTTP 409, multiLab:true); single-lab accounts are
// unaffected.
//
//   node scripts/verify-legacy-competency-multilab-guard.mjs        source assertions
//   BASE=... VERIFY_TOKEN=<multi-lab owner JWT> OWNED_ASSESSMENT_ID=<id the owner owns>
//     node scripts/verify-legacy-competency-multilab-guard.mjs      + live 409 (non-mutating)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routes = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

ok("accountLabCount helper defined once", (routes.match(/const accountLabCount =/g) || []).length === 1);
ok("helper counts labs by owner_user_id", /SELECT COUNT\(\*\) AS n FROM labs WHERE owner_user_id = \?/.test(routes));
ok("multi-lab guard applied to all 3 legacy routes", (routes.match(/accountLabCount\(dataUserId\) > 1/g) || []).length === 3);
ok("guard returns 409 with multiLab flag", /accountLabCount\(dataUserId\) > 1\) return res\.status\(409\)[\s\S]{0,180}multiLab: true/.test(routes));
// The guard must sit AFTER the existing owner check (so a foreign id still 404s first).
ok("guard placed after the owner-check 404", /assessment\.user_id !== dataUserId\) return res\.status\(404\)[\s\S]{0,240}accountLabCount\(dataUserId\) > 1/.test(routes));

const BASE = process.env.BASE || "";
const TOKEN = process.env.VERIFY_TOKEN || "";
const OWNED = process.env.OWNED_ASSESSMENT_ID || "";
if (!BASE || !TOKEN || !OWNED) {
  console.log("\n(skip live: set BASE + VERIFY_TOKEN (multi-lab owner) + OWNED_ASSESSMENT_ID to run the 409 check)");
  console.log(fails === 0 ? "\n=== LEGACY COMPETENCY GUARD (source): PASS ===" : `\n=== ${fails} FAIL ===`);
  process.exit(fails === 0 ? 0 : 1);
}
// Non-mutating: an empty-body legacy sign on an owned id. The guard returns 409
// BEFORE any UPDATE for a multi-lab account, so this does not lock the assessment.
const r = await fetch(`${BASE}/api/competency/assessments/${OWNED}/sign`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: "{}",
});
const j = await r.json().catch(() => ({}));
ok("live: multi-lab owner on legacy sign -> 409 multiLab (non-mutating)", r.status === 409 && j.multiLab === true);

console.log(fails === 0 ? "\n=== LEGACY COMPETENCY GUARD (source + live): PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
