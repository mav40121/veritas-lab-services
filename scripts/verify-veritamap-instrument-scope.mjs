// scripts/verify-veritamap-instrument-scope.mjs
//
// Receipt for the SEV-0 fix: the VeritaMap instrument-tests PUT and
// delete-instrument routes must reject an :instId that does not belong to the
// :id map, so a writer in one lab cannot wipe/overwrite another lab's (or another
// map's) instrument test menu.
//
// This drives the NEGATIVE case only (non-mutating): pair a real map id with an
// instrument id that belongs to a DIFFERENT map and assert HTTP 404. Before the
// fix these routes deleted+re-inserted veritamap_instrument_tests keyed by
// instrument_id alone (no map scope) and returned 200.
//
// Env: BASE (default prod www), VERIFY_TOKEN (a lab user JWT), MAP_ID (a map the
// token can access), FOREIGN_INST_ID (an instrument id NOT on MAP_ID). Skips if
// token/ids absent (compile-safe).

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.VERIFY_TOKEN || "";
const MAP_ID = process.env.MAP_ID || "";
const FOREIGN_INST_ID = process.env.FOREIGN_INST_ID || "";

if (!TOKEN || !MAP_ID || !FOREIGN_INST_ID) {
  console.log("SKIP: set VERIFY_TOKEN + MAP_ID + FOREIGN_INST_ID to run the live 404 check.");
  process.exit(0);
}

const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
// A benign payload; the guard must reject BEFORE any delete/insert runs.
const body = JSON.stringify({ tests: [{ analyte: "SCOPE_PROBE_DO_NOT_KEEP", specialty: "chemistry", complexity: "high", active: 1 }] });

let fails = 0;
async function check(label, url) {
  const r = await fetch(`${BASE}${url}`, { method: "PUT", headers: H, body });
  const ok = r.status === 404;
  console.log(`${ok ? "PASS" : "FAIL"}: ${label} -> HTTP ${r.status} (want 404)`);
  if (!ok) fails++;
}

// Both route families: lab-scoped (live UI path) and legacy.
await check("lab-scoped tests-PUT with foreign instrument", `/api/labs/1/veritamap/maps/${MAP_ID}/instruments/${FOREIGN_INST_ID}/tests`);
await check("legacy tests-PUT with foreign instrument", `/api/veritamap/maps/${MAP_ID}/instruments/${FOREIGN_INST_ID}/tests`);

console.log(fails === 0 ? "\n=== VERITAMAP INSTRUMENT SCOPE: ALL PASS (foreign instId rejected) ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
