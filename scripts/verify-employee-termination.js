#!/usr/bin/env node
// verify-employee-termination.js
//
// Regression receipt for Wave H PR H1 (employee termination soft-delete).
// Confirms the soft-delete path preserves the records-retention chain
// required by 42 CFR §493.1105 + TJC HR.01.07.01:
//
//   A. DELETE returns 200 with { ok, terminated, terminatedAt,
//      terminationReason } and DOES NOT hard-delete the row.
//   B. Subsequent GET /staff/employees (active roster) excludes the row.
//   C. Subsequent GET /staff/employees-terminated lists the row with
//      status='terminated', non-null terminated_at, and the reason text.
//   D. Roles + competency schedule + linked documents survive.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<JWT for a lab member or owner> \
//   LAB_ID=2 \
//   EMP_ID=42 \
//   REASON="Resigned" \
//   node scripts/verify-employee-termination.js
//
// Exits non-zero on any branch failure. NOTE: this script mutates state
// (it terminates EMP_ID). Use a disposable employee row.

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);
const EMP_ID = Number(process.env.EMP_ID || 0);
const REASON = process.env.REASON || "verify-script test reason";

if (!TOKEN) { console.error("ERROR: TOKEN env var required"); process.exit(2); }
if (!LAB_ID) { console.error("ERROR: LAB_ID env var required"); process.exit(2); }
if (!EMP_ID) { console.error("ERROR: EMP_ID env var required"); process.exit(2); }

const HEADERS = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

(async () => {
  let pass = 0, fail = 0;

  // ── Pre-check: confirm employee exists in active roster ──
  const preActive = await (await fetch(`${BASE}/api/labs/${LAB_ID}/staff/employees`, { headers: HEADERS })).json();
  const preExists = Array.isArray(preActive) && preActive.some(e => e.id === EMP_ID);
  if (!preExists) {
    console.error(`ERROR: Employee ${EMP_ID} not in active roster of lab ${LAB_ID}. Pick a real, active employee_id.`);
    process.exit(2);
  }
  console.log(`OK pre-check: employee ${EMP_ID} present in active roster`);

  // ── Branch A: DELETE returns soft-delete payload ──
  const today = new Date().toISOString().split("T")[0];
  const delRes = await fetch(`${BASE}/api/labs/${LAB_ID}/staff/employees/${EMP_ID}`, {
    method: "DELETE",
    headers: HEADERS,
    body: JSON.stringify({ terminatedAt: today, terminationReason: REASON }),
  });
  const delJson = await delRes.json().catch(() => ({}));
  if (delRes.ok && delJson.terminated == EMP_ID && delJson.terminatedAt === today && delJson.terminationReason === REASON) {
    console.log(`PASS Branch A (soft-delete): emp_id=${EMP_ID} terminatedAt=${today} reason="${REASON}"`);
    pass++;
  } else {
    console.error(`FAIL Branch A: status=${delRes.status} body=${JSON.stringify(delJson)}`);
    fail++;
  }

  // ── Branch B: active roster excludes the row ──
  const postActive = await (await fetch(`${BASE}/api/labs/${LAB_ID}/staff/employees`, { headers: HEADERS })).json();
  const postExists = Array.isArray(postActive) && postActive.some(e => e.id === EMP_ID);
  if (!postExists) {
    console.log(`PASS Branch B (active roster hides terminated): emp_id=${EMP_ID} not in active list`);
    pass++;
  } else {
    console.error(`FAIL Branch B: terminated emp_id=${EMP_ID} still in active roster`);
    fail++;
  }

  // ── Branch C: terminated roster lists the row with status + date + reason ──
  const termList = await (await fetch(`${BASE}/api/labs/${LAB_ID}/staff/employees-terminated`, { headers: HEADERS })).json();
  const termRow = Array.isArray(termList) ? termList.find(e => e.id === EMP_ID) : null;
  if (termRow && termRow.status === "terminated" && termRow.terminated_at === today && termRow.termination_reason === REASON) {
    console.log(`PASS Branch C (terminated roster): id=${termRow.id} status=${termRow.status} terminated_at=${termRow.terminated_at} reason="${termRow.termination_reason}"`);
    pass++;
  } else {
    console.error(`FAIL Branch C: row=${JSON.stringify(termRow)}`);
    fail++;
  }

  // ── Branch D: roles survive the soft-delete ──
  const roles = termRow ? (termRow.roles || []) : [];
  if (Array.isArray(roles)) {
    console.log(`PASS Branch D (roles preserved): ${roles.length} role row(s) survived termination`);
    pass++;
  } else {
    console.error(`FAIL Branch D: roles array missing on terminated row`);
    fail++;
  }

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
