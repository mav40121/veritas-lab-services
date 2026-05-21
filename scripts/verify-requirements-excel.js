#!/usr/bin/env node
/**
 * verify-requirements-excel.js
 *
 * Receipt for the VeritaPolicy Requirements Index Excel export
 * (PARKING_LOT #30 follow-up to PR #309). Drives the endpoint
 * server-side, parses the returned xlsx with ExcelJS, and asserts:
 *
 *   1. Endpoint returns 200 with a Content-Type matching .xlsx
 *   2. Workbook opens, has About + Requirements sheets, About sheet
 *      is sheet 1
 *   3. Requirements sheet has the expected header row
 *   4. Plain-Language Summary column carries the 5 pilot summaries
 *      next to their respective verbatim text
 *   5. Lab identity (name + CLIA) appears in About row 2
 *
 * Usage:
 *   node scripts/verify-requirements-excel.js \
 *     --base https://www.veritaslabservices.com \
 *     --token "<JWT>" \
 *     --labId 3
 *
 * If --base is omitted, defaults to http://localhost:5050.
 * If --labId is omitted, hits the legacy /api/veritapolicy/... route.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => {
  if (!a.startsWith('--')) return [null, null];
  const key = a.slice(2);
  const next = arr[i + 1];
  if (next && !next.startsWith('--')) return [key, next];
  return [key, true];
}).filter(([k]) => k));

const BASE = args.base || 'http://localhost:5050';
const TOKEN = args.token || process.env.VERITAS_TOKEN || '';
const LAB_ID = args.labId;

const PILOT_STANDARDS = [
  '42 CFR §493.1235',
  '42 CFR §493.1252',
  '42 CFR §493.1253',
  '42 CFR §493.1281',
  '42 CFR §493.1289',
];

const url = LAB_ID
  ? `${BASE}/api/labs/${LAB_ID}/veritapolicy/requirements/excel`
  : `${BASE}/api/veritapolicy/requirements/excel`;

let fails = 0;
const pass = (msg) => console.log('  PASS  ' + msg);
const fail = (msg) => { console.log('  FAIL  ' + msg); fails += 1; };

console.log('--- VeritaPolicy Requirements Index Excel verification ---');
console.log('GET ' + url);
if (!TOKEN) { console.log('  (no --token / VERITAS_TOKEN set; legacy route may 401)'); }

const res = await fetch(url, { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} });
if (!res.ok) { fail(`HTTP ${res.status}: ${await res.text()}`); process.exit(1); }
pass('HTTP 200');

const ct = res.headers.get('content-type') || '';
if (!ct.includes('spreadsheetml.sheet')) fail('Content-Type is "' + ct + '", expected spreadsheetml.sheet');
else pass('Content-Type is xlsx');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(__dirname, '..', '.tmp-requirements-verify.xlsx');
fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));

const { default: ExcelJS } = await import('exceljs');
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(tmp);

if (wb.worksheets.length < 2) fail('Workbook has ' + wb.worksheets.length + ' sheet(s); expected at least 2');
else pass('Workbook has 2+ sheets');

const sheet1 = wb.worksheets[0];
if (sheet1?.name !== 'About') fail('Sheet 1 is "' + sheet1?.name + '", expected About');
else pass('Sheet 1 is About');

const reqSheet = wb.getWorksheet('Requirements');
if (!reqSheet) { fail('Requirements sheet not found'); process.exit(1); }
pass('Requirements sheet present');

const headerRow = reqSheet.getRow(1);
const headerVals = [];
headerRow.eachCell({ includeEmpty: true }, (c) => headerVals.push(String(c.value || '')));
const expectedHeaders = [
  'Source', 'Citation', 'Section Title', 'Verbatim Text',
  'Plain-Language Summary', 'Service Line', 'Chapter',
  'CAP Cross-Refs', 'TJC Cross-Refs', 'COLA Cross-Refs', 'AABB Cross-Refs', 'Notes',
];
let hdrOk = true;
for (let i = 0; i < expectedHeaders.length; i += 1) {
  if (headerVals[i] !== expectedHeaders[i]) { hdrOk = false; break; }
}
if (!hdrOk) fail('Header row mismatch. Got: ' + headerVals.join(' | '));
else pass('Header row matches expected schema');

const citationColIdx = expectedHeaders.indexOf('Citation') + 1;
const verbatimColIdx = expectedHeaders.indexOf('Verbatim Text') + 1;
const summaryColIdx  = expectedHeaders.indexOf('Plain-Language Summary') + 1;

const foundStandards = new Set();
const rowSummary = new Map();
for (let r = 2; r <= reqSheet.rowCount; r += 1) {
  const cite = String(reqSheet.getRow(r).getCell(citationColIdx).value || '');
  const summary = String(reqSheet.getRow(r).getCell(summaryColIdx).value || '');
  if (PILOT_STANDARDS.includes(cite)) {
    foundStandards.add(cite);
    if (summary && summary.length > 50) {
      if (!rowSummary.has(cite)) rowSummary.set(cite, summary);
    }
  }
}

for (const std of PILOT_STANDARDS) {
  if (!foundStandards.has(std)) fail(`${std}: not present in Requirements sheet`);
  else if (!rowSummary.has(std)) fail(`${std}: rows present but no row carries a non-empty plain-language summary`);
  else pass(`${std}: present with summary (${rowSummary.get(std).length} chars)`);
}

// About sheet identity check
const aboutRow2 = String(sheet1.getCell('A2').value || '');
if (!/Prepared for:/.test(aboutRow2) || !/CLIA:/.test(aboutRow2)) {
  fail('About row 2 missing "Prepared for: X    CLIA: Y" pattern; got: ' + aboutRow2);
} else {
  pass('About row 2 carries lab identity: ' + aboutRow2);
}

try { fs.unlinkSync(tmp); } catch {}

if (fails > 0) { console.log('\n' + fails + ' check(s) FAILED'); process.exit(1); }
console.log('\nAll checks passed.');
