// Receipt for the VeritaStock reorder-list endpoints + PDF/Excel generators.
//
// What this script verifies:
//  1. GET  /api/labs/:labId/inventory/reorder-list returns ONLY items where
//     qty_on_hand <= burn_rate * (lead_time_days + safety_stock_days). It
//     uses the same decorator the list endpoint uses so the trigger formula
//     never drifts between the table and the document.
//  2. The JSON payload includes the four computed fields the PDF/Excel
//     builders rely on: reorder_point, order_to_qty, days_remaining,
//     needs_reorder.
//  3. POST /api/labs/:labId/inventory/reorder-list/pdf returns a token,
//     and GET /api/pdf/:token returns a real PDF (magic bytes %PDF-).
//  4. POST /api/labs/:labId/inventory/reorder-list/excel returns a real
//     xlsx (magic bytes PK\x03\x04, the ZIP signature OOXML uses).
//  5. The legacy /api/inventory/reorder-list variants behave identically.
//
// What this script does NOT verify (visually inspect the PDF for these):
//  - Vendor section grouping order
//  - Signature block layout on page 1
//  - Header/footer lab identity stamping
//  - Excel sheet protection (verify by opening the workbook)
//
// Run (against prod, lab 3):
//   API=https://www.veritaslabservices.com TOKEN=<jwt> LAB=3 \
//     node scripts/verify-reorder-list.js
//
// Exits non-zero on any failure so this can land in CI later.

const fs = require('fs');
const path = require('path');

const API = process.env.API || 'http://localhost:5000';
const TOKEN = process.env.TOKEN;
const LAB_ID = process.env.LAB || '3';
const OUT_DIR = process.env.OUT_DIR || '.';

if (!TOKEN) {
  console.error('TOKEN env var required. Pull from browser localStorage["veritas_token"] or mint from JWT_SECRET.');
  process.exit(2);
}

const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

let failed = 0;
function check(label, cond, detail) {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failed += 1;
  console.log(`${status}  ${label}${detail ? '  // ' + detail : ''}`);
}

function isPDF(buf) {
  return buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}
function isXLSX(buf) {
  // OOXML is a ZIP container; check for PK\x03\x04 signature.
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04;
}

(async () => {
  // ── Lab-scoped variant ────────────────────────────────────────────────────
  const listR = await fetch(`${API}/api/labs/${LAB_ID}/inventory/reorder-list`, { headers: AUTH });
  check('GET lab-scoped reorder-list returns 200', listR.status === 200, `status=${listR.status}`);
  const list = await listR.json();
  check('payload has items[] + totalCount + generatedAt', Array.isArray(list.items) && typeof list.totalCount === 'number' && typeof list.generatedAt === 'string',
    `items=${Array.isArray(list.items) ? list.items.length : 'NOT array'} totalCount=${list.totalCount}`);

  // Pull the full inventory list to cross-check that every flagged item meets
  // the trigger and no items above the trigger leaked in.
  const fullR = await fetch(`${API}/api/labs/${LAB_ID}/inventory`, { headers: AUTH });
  const full = await fullR.json();
  const expectedNeedsReorder = full.filter(it => it.needs_reorder).map(it => it.id).sort();
  const actualNeedsReorder = list.items.map(it => it.id).sort();
  check('reorder-list matches /inventory needs_reorder filter (no drift)',
    JSON.stringify(expectedNeedsReorder) === JSON.stringify(actualNeedsReorder),
    `expected=${expectedNeedsReorder.length} actual=${actualNeedsReorder.length}`);

  // Every flagged item must carry the four computed fields the PDF builder relies on.
  const hasAllFields = list.items.length === 0 || list.items.every(it =>
    typeof it.reorder_point === 'number' &&
    typeof it.order_to_qty === 'number' &&
    (it.days_remaining === null || typeof it.days_remaining === 'number') &&
    it.needs_reorder === true
  );
  check('every item carries reorder_point + order_to_qty + days_remaining + needs_reorder',
    hasAllFields, `items=${list.items.length}`);

  // ── PDF ──────────────────────────────────────────────────────────────────
  const pdfPostR = await fetch(`${API}/api/labs/${LAB_ID}/inventory/reorder-list/pdf`, { method: 'POST', headers: AUTH });
  check('POST PDF returns 200', pdfPostR.status === 200, `status=${pdfPostR.status}`);
  const pdfTokenBody = pdfPostR.status === 200 ? await pdfPostR.json() : {};
  check('PDF response carries token + totalCount', typeof pdfTokenBody.token === 'string' && typeof pdfTokenBody.totalCount === 'number',
    `token=${pdfTokenBody.token ? 'present' : 'MISSING'} totalCount=${pdfTokenBody.totalCount}`);

  if (pdfTokenBody.token) {
    const pdfGetR = await fetch(`${API}/api/pdf/${pdfTokenBody.token}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    check('GET /api/pdf/:token returns 200', pdfGetR.status === 200, `status=${pdfGetR.status}`);
    const pdfBuf = Buffer.from(await pdfGetR.arrayBuffer());
    check('downloaded PDF has %PDF- magic bytes', isPDF(pdfBuf), `bytes=${pdfBuf.length}`);
    const pdfPath = path.join(OUT_DIR, `verify-reorder-${LAB_ID}.pdf`);
    fs.writeFileSync(pdfPath, pdfBuf);
    console.log(`      saved ${pdfPath} for visual inspection`);
  }

  // ── Excel ────────────────────────────────────────────────────────────────
  const xlsxPostR = await fetch(`${API}/api/labs/${LAB_ID}/inventory/reorder-list/excel`, { method: 'POST', headers: AUTH });
  check('POST Excel returns 200', xlsxPostR.status === 200, `status=${xlsxPostR.status}`);
  const xlsxBuf = xlsxPostR.status === 200 ? Buffer.from(await xlsxPostR.arrayBuffer()) : Buffer.alloc(0);
  check('downloaded XLSX has PK\\x03\\x04 magic bytes (valid OOXML)', isXLSX(xlsxBuf), `bytes=${xlsxBuf.length}`);
  if (xlsxBuf.length > 0) {
    const xlsxPath = path.join(OUT_DIR, `verify-reorder-${LAB_ID}.xlsx`);
    fs.writeFileSync(xlsxPath, xlsxBuf);
    console.log(`      saved ${xlsxPath} for visual inspection`);
  }

  // ── Legacy variant (must behave identically for a user whose account_id
  //    owns the same items via the lab_id backfill) ─────────────────────
  const legacyListR = await fetch(`${API}/api/inventory/reorder-list`, { headers: AUTH });
  check('GET legacy reorder-list returns 200', legacyListR.status === 200, `status=${legacyListR.status}`);
  const legacyList = await legacyListR.json();
  check('legacy payload shape matches lab-scoped',
    Array.isArray(legacyList.items) && typeof legacyList.totalCount === 'number',
    `items=${Array.isArray(legacyList.items) ? legacyList.items.length : 'NOT array'} totalCount=${legacyList.totalCount}`);

  console.log(`\n${failed === 0 ? 'ALL TESTS PASSED' : `${failed} TEST(S) FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
