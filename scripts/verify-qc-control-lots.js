// Receipt for the customer-facing VeritaQC Add Control Lot endpoints
// (POST /api/labs/:labId/qc/control-lots and PATCH /:id for status).
//
// What this script proves end-to-end on production (or any reachable env):
//
//  1. POST a new control lot with the 4 required fields → 200, the response
//     payload echoes the created row with status='active'.
//  2. GET /qc/lots includes the new lot.
//  3. POST a duplicate (same lab + analyte + lot_number) → 409 Conflict with
//     a useful error message that names the analyte and lot number.
//  4. POST with negative SD → 400.
//  5. POST with bogus level (e.g. "very-high") → 400.
//  6. PATCH status=retired → 200, the lot's status flips, ordering in
//     GET /qc/lots demotes it below active lots.
//  7. PATCH status=active → 200, the lot is restored.
//  8. PATCH with bogus status → 400.
//  9. PATCH against a non-existent lot id → 404.
//
// Run (against prod, lab 3, with the test-account JWT):
//
//   API=https://www.veritaslabservices.com TOKEN=<jwt> LAB=3 \
//     node scripts/verify-qc-control-lots.js
//
// The script will CREATE one lot with a randomized lot number, then leave
// it RETIRED at the end. Run again any time — the randomization avoids the
// UNIQUE constraint colliding with prior runs.
//
// Exits non-zero on any failure so this can drop into CI later.

const API = process.env.API || 'http://localhost:5000';
const TOKEN = process.env.TOKEN;
const LAB = process.env.LAB || '3';

if (!TOKEN) {
  console.error('TOKEN env var required. Pull from browser localStorage["veritas_token"].');
  process.exit(2);
}

let failures = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` :: ${detail}` : ''}`);
    failures++;
  }
}

function authHeaders(extra) {
  return { Authorization: `Bearer ${TOKEN}`, ...(extra || {}) };
}

async function getLots() {
  const r = await fetch(`${API}/api/labs/${LAB}/qc/lots`, { headers: authHeaders() });
  return r.ok ? (await r.json()).lots : [];
}

const RUN_TAG = `VERIFY-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TEST_ANALYTE = 'VerifyAnalyte';
const TEST_LOT = RUN_TAG;
console.log(`Run tag: ${RUN_TAG}\n`);

// ─── [1] POST a new lot ────────────────────────────────────────────────────
console.log('[1] POST /qc/control-lots with required fields only');
const createRes = await fetch(`${API}/api/labs/${LAB}/qc/control-lots`, {
  method: 'POST',
  headers: authHeaders({ 'Content-Type': 'application/json' }),
  body: JSON.stringify({
    analyte: TEST_ANALYTE,
    lot_number: TEST_LOT,
    mfr_mean: 100,
    mfr_sd: 3.5,
  }),
});
check('status 200', createRes.status === 200, `got ${createRes.status}`);
const created = createRes.ok ? (await createRes.json()).lot : null;
check('response carries an id', !!created && typeof created.id === 'number');
check('default status is active', created?.status === 'active');
check('default level is mid', created?.level === 'mid');
check('default sd_interval is 2', created?.mfr_sd_interval === 2);
const newLotId = created?.id;

// ─── [2] GET /qc/lots includes the new lot ────────────────────────────────
console.log('\n[2] GET /qc/lots shows the new lot');
let lots = await getLots();
check('new lot present in GET /qc/lots', lots.some(l => l.id === newLotId));

// ─── [3] POST duplicate → 409 ──────────────────────────────────────────────
console.log('\n[3] POST duplicate (same lab + analyte + lot_number) → 409');
const dupRes = await fetch(`${API}/api/labs/${LAB}/qc/control-lots`, {
  method: 'POST',
  headers: authHeaders({ 'Content-Type': 'application/json' }),
  body: JSON.stringify({
    analyte: TEST_ANALYTE,
    lot_number: TEST_LOT,
    mfr_mean: 99,
    mfr_sd: 2.0,
  }),
});
check('status 409', dupRes.status === 409, `got ${dupRes.status}`);
const dupBody = await dupRes.json().catch(() => ({}));
check('error names the analyte', String(dupBody.error || '').includes(TEST_ANALYTE));
check('error names the lot number', String(dupBody.error || '').includes(TEST_LOT));

// ─── [4] POST with negative SD → 400 ──────────────────────────────────────
console.log('\n[4] POST with negative SD → 400');
const negRes = await fetch(`${API}/api/labs/${LAB}/qc/control-lots`, {
  method: 'POST',
  headers: authHeaders({ 'Content-Type': 'application/json' }),
  body: JSON.stringify({
    analyte: TEST_ANALYTE,
    lot_number: `${TEST_LOT}-neg`,
    mfr_mean: 50,
    mfr_sd: -1,
  }),
});
check('status 400', negRes.status === 400, `got ${negRes.status}`);

// ─── [5] POST with bogus level → 400 ──────────────────────────────────────
console.log('\n[5] POST with bogus level → 400');
const lvlRes = await fetch(`${API}/api/labs/${LAB}/qc/control-lots`, {
  method: 'POST',
  headers: authHeaders({ 'Content-Type': 'application/json' }),
  body: JSON.stringify({
    analyte: TEST_ANALYTE,
    lot_number: `${TEST_LOT}-lvl`,
    level: 'very-high',
    mfr_mean: 50,
    mfr_sd: 1,
  }),
});
check('status 400', lvlRes.status === 400, `got ${lvlRes.status}`);

// ─── [6] PATCH retired ────────────────────────────────────────────────────
console.log('\n[6] PATCH /qc/control-lots/:id status=retired');
const retireRes = await fetch(`${API}/api/labs/${LAB}/qc/control-lots/${newLotId}`, {
  method: 'PATCH',
  headers: authHeaders({ 'Content-Type': 'application/json' }),
  body: JSON.stringify({ status: 'retired' }),
});
check('status 200', retireRes.status === 200, `got ${retireRes.status}`);
const retired = retireRes.ok ? (await retireRes.json()).lot : null;
check('row reports status=retired', retired?.status === 'retired');

console.log('  → GET /qc/lots ordering: retired lots come after active');
lots = await getLots();
const ours = lots.find(l => l.id === newLotId);
const firstActive = lots.find(l => l.status === 'active');
if (ours && firstActive) {
  check('retired lot is ranked below at least one active lot', lots.indexOf(firstActive) < lots.indexOf(ours));
} else if (ours && !firstActive) {
  console.log('    (skip ordering check: no active lots in this lab)');
} else {
  check('retired lot still visible in GET', !!ours);
}

// ─── [7] PATCH active ─────────────────────────────────────────────────────
console.log('\n[7] PATCH /qc/control-lots/:id status=active');
const reactRes = await fetch(`${API}/api/labs/${LAB}/qc/control-lots/${newLotId}`, {
  method: 'PATCH',
  headers: authHeaders({ 'Content-Type': 'application/json' }),
  body: JSON.stringify({ status: 'active' }),
});
check('status 200', reactRes.status === 200, `got ${reactRes.status}`);
const reactivated = reactRes.ok ? (await reactRes.json()).lot : null;
check('row reports status=active', reactivated?.status === 'active');

// ─── [8] PATCH bogus status ───────────────────────────────────────────────
console.log('\n[8] PATCH with bogus status → 400');
const badStatusRes = await fetch(`${API}/api/labs/${LAB}/qc/control-lots/${newLotId}`, {
  method: 'PATCH',
  headers: authHeaders({ 'Content-Type': 'application/json' }),
  body: JSON.stringify({ status: 'frozen' }),
});
check('status 400', badStatusRes.status === 400, `got ${badStatusRes.status}`);

// ─── [9] PATCH non-existent id ────────────────────────────────────────────
console.log('\n[9] PATCH on a non-existent lot id → 404');
const ghostRes = await fetch(`${API}/api/labs/${LAB}/qc/control-lots/99999999`, {
  method: 'PATCH',
  headers: authHeaders({ 'Content-Type': 'application/json' }),
  body: JSON.stringify({ status: 'retired' }),
});
check('status 404', ghostRes.status === 404, `got ${ghostRes.status}`);

// ─── Leave the lot RETIRED so the next run can re-tag with a fresh number ─
console.log('\n[cleanup] PATCH the test lot back to retired so it does not clutter the active list');
await fetch(`${API}/api/labs/${LAB}/qc/control-lots/${newLotId}`, {
  method: 'PATCH',
  headers: authHeaders({ 'Content-Type': 'application/json' }),
  body: JSON.stringify({ status: 'retired' }),
});
console.log(`  → test lot id=${newLotId} (analyte=${TEST_ANALYTE}, lot=${TEST_LOT}) left as retired`);

console.log(`\n${failures === 0 ? 'OK' : 'FAILURES: ' + failures}`);
process.exit(failures === 0 ? 0 : 1);
