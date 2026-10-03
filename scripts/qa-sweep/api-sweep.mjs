// scripts/qa-sweep/api-sweep.mjs
//
// Authenticated API + artifact sweep across the THREE login types that matter:
//   1. owner            - the lab's owner_user_id
//   2. admin-member     - an active 'admin' lab_members row (reaches the lab via
//                         membership, often with a free personal plan: the exact
//                         persona that failed the USON demo)
//   3. demo-seat        - an active user_seats seat_user on the lab
//
// It auto-discovers those three users on a lab INSIDE the owned QA system (--org)
// from a database copy, mints a JWT for each (JWT_SECRET must match the running
// server), then for each persona exercises every module's reads, a write-access
// probe, and the document generators against a RUNNING server. Prints a pass/fail
// matrix and exits non-zero if any hard failure is found (403/500 on a read, a
// write blocked for owner/admin, a 500, or a failed document generator).
//
// Target scoping (never a client account): pass --org <id> (the Michael-owned
// "Veritas QA System", org 5) or an explicit --lab <id>. One is REQUIRED; there is
// no blind "first paid lab" fallback (that once picked a client lab, San Carlos).
//
// Usage (the /qa-sweep command wires this up):
//   JWT_SECRET=<server secret> node scripts/qa-sweep/api-sweep.mjs \
//     --base http://localhost:5199 --db /path/to/prod-copy.db --org 5 [--lab <id>]
//
// READ-ONLY against the DB (discovery only). Write probes send invalid bodies, so
// they test ACCESS without persisting junk; run against a disposable copy anyway.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const BASE = (arg('--base', 'http://localhost:5199')).replace(/\/$/, '');
const DB_PATH = arg('--db');
const FORCE_LAB = arg('--lab') ? Number(arg('--lab')) : null;
const ORG = arg('--org') ? Number(arg('--org')) : null;
const SECRET = process.env.JWT_SECRET;
if (!DB_PATH) { console.error('FATAL: --db <path to a DB copy> is required'); process.exit(2); }
if (!SECRET) { console.error('FATAL: JWT_SECRET env is required (must match the running server)'); process.exit(2); }
if (ORG !== null && !Number.isInteger(ORG)) { console.error('FATAL: --org must be an integer'); process.exit(2); }
// Never sweep a client account. Require an explicit target: the owned QA system
// (--org, the Michael-owned "Veritas QA System", org 5) or a specific --lab. The
// old blind "first paid lab" fallback picked San Carlos (a client) on the first
// run; that path is gone.
if (!FORCE_LAB && ORG === null) {
  console.error('FATAL: pass --org <id> (the Michael-owned QA system: org 5 "Veritas QA System") or --lab <id>.');
  console.error('This sweep refuses to auto-select an arbitrary paid lab: it can land on a CLIENT account');
  console.error('(the first run picked San Carlos). QA runs only on the owned test system.');
  process.exit(2);
}

const db = new Database(DB_PATH, { readonly: true });
const one = (sql, ...a) => db.prepare(sql).get(...a);

// ---- discover the target lab + the three personas on it ----
// Scoped to the QA organization (--org), never a free-for-all scan of prod.
// Membership in a paid org = paid, so org-scoped discovery does NOT filter on the
// (often stale) lab-level plan column; it just needs active members. Prefer a lab
// with an admin-member distinct from the owner (the persona that failed the USON
// demo), else any lab in the org with active members.
const lab = FORCE_LAB
  ? one(`SELECT id, owner_user_id, organization_id FROM labs WHERE id = ?`, FORCE_LAB)
  : (one(`SELECT id, owner_user_id, organization_id FROM labs l
          WHERE l.organization_id = ? AND l.owner_user_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM lab_members m WHERE m.lab_id = l.id AND m.status='active'
                        AND m.role='admin' AND m.user_id != l.owner_user_id)
          ORDER BY l.id LIMIT 1`, ORG)
     || one(`SELECT id, owner_user_id, organization_id FROM labs l
             WHERE l.organization_id = ? AND l.owner_user_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM lab_members m WHERE m.lab_id = l.id AND m.status='active')
             ORDER BY l.id LIMIT 1`, ORG));
if (!lab) { console.error(`FATAL: no lab with active members found${ORG !== null ? ` in org ${ORG}` : ''}${FORCE_LAB ? ` (lab ${FORCE_LAB})` : ''}`); process.exit(2); }
if (ORG !== null && FORCE_LAB && lab.organization_id !== ORG) {
  console.error(`FATAL: --lab ${FORCE_LAB} is in org ${lab.organization_id}, not the QA org ${ORG}; refusing to sweep outside the test system`);
  process.exit(2);
}
const LAB = lab.id;
const ownerId = lab.owner_user_id;
const adminId = one(`SELECT user_id FROM lab_members WHERE lab_id=? AND role='admin' AND status='active' AND user_id != ? LIMIT 1`, LAB, ownerId)?.user_id;
const seatId = one(`SELECT seat_user_id FROM user_seats WHERE lab_id=? AND seat_user_id IS NOT NULL AND status='active' LIMIT 1`, LAB)?.seat_user_id;

const personas = [
  { name: 'owner', userId: ownerId, canWrite: true },
  { name: 'admin-member', userId: adminId, canWrite: true },
  { name: 'demo-seat', userId: seatId, canWrite: false }, // seat writes may be legitimately view-only
].filter(p => p.userId);
console.log(`Target lab: ${LAB} (${one(`SELECT lab_name FROM labs WHERE id=?`, LAB)?.lab_name}) plan=${one(`SELECT plan FROM labs WHERE id=?`, LAB)?.plan}`);
console.log('Personas:', personas.map(p => `${p.name}=${p.userId}`).join(', '));
db.close();

const L = `/api/labs/${LAB}`;
const READS = [
  '/members', '/studies', '/veritacheck/coverage', '/veritacheck/lab-instruments',
  '/veritamap/maps', '/veritamap/labwide', '/veritascan/scans', '/veritascan/documents',
  '/veritascan/coverage', '/competency/programs', '/competency/employees',
  '/competency/dashboard-stats', '/competency/owed', '/staff/lab', '/staff/employees',
  '/staff/position-descriptions', '/staff/credentials-dashboard-stats', '/pt/enrollments',
  '/pt/coverage', '/pt/aa-records', '/equipment', '/findings', '/iqcp/plans',
  '/iqcp/eligible-tests', '/veritalab/certificates', '/veritaceu/roster-summary',
  '/qc/recent', '/qc/lots', '/readiness', '/compliance/score',
  '/veritapolicy/documents', '/veritapolicy/manuals', '/veritapolicy/workflows',
].map(p => `${L}${p}`).concat([
  '/api/veritatrack/tasks', '/api/veritatrack/dashboard', '/api/productivity',
  '/api/staffing-grid', '/api/staffing-studies', '/api/pi/departments', '/api/inventory',
  '/api/inventory/reorder-list', '/api/veritaops/studies',
]);
const WRITES = [
  `${L}/studies`, `${L}/veritamap/maps`, `${L}/veritascan/scans`, `${L}/competency/programs`,
  `${L}/staff/employees`, `${L}/pt/enrollments`, `${L}/equipment`, `${L}/findings`,
  `${L}/qc/results`, `${L}/veritalab/certificates`, `${L}/veritapolicy/manuals`,
  '/api/veritatrack/tasks', '/api/productivity', '/api/inventory', '/api/pi/metrics', '/api/veritaops/studies',
];
const ARTIFACTS = [
  { m: 'POST', p: `${L}/staff/cms209`, label: 'CMS 209 PDF' },
  { m: 'GET', p: `${L}/veritamap/coverage-report.xlsx`, label: 'VeritaMap coverage xlsx' },
  { m: 'GET', p: `${L}/veritacheck/coverage/export`, label: 'VeritaCheck coverage export' },
];

async function hit(path, token, method = 'GET', body) {
  const headers = { Authorization: `Bearer ${token}`, 'X-Active-Lab-Id': String(LAB) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const r = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let snip = '';
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) snip = (await r.text()).slice(0, 140).replace(/\s+/g, ' ');
    else snip = `[${ct} ${r.headers.get('content-length') || '?'}b]`;
    return { status: r.status, snip };
  } catch (e) { return { status: 0, snip: 'FETCH-ERR ' + e.message }; }
}

const flagged = [];
const token = (p) => jwt.sign({ userId: p.userId }, SECRET, { expiresIn: '1h' });
for (const p of personas) {
  const t = token(p);
  console.log(`\n================ ${p.name} (user ${p.userId}) ================`);
  console.log('--- reads ---');
  for (const ep of READS) {
    const r = await hit(ep, t);
    let v;
    if (r.status === 200) v = 'PASS';
    else if (r.status === 403) v = 'ACCESS-FAIL';
    else if (r.status >= 500) v = 'SERVER-ERR';
    else if (r.status === 400) v = 'needs-params';
    else v = `HTTP-${r.status}`;
    if (v === 'ACCESS-FAIL' || v === 'SERVER-ERR') flagged.push({ persona: p.name, kind: 'READ', ep, v, status: r.status, snip: r.snip });
    console.log(`  ${v.padEnd(13)} ${String(r.status).padEnd(4)} ${ep}`);
  }
  console.log('--- write access probes (invalid body) ---');
  for (const ep of WRITES) {
    const r = await hit(ep, t, 'POST', {});
    let v;
    if (r.status === 403) v = 'ACCESS-BLOCKED';
    else if (r.status === 400 || r.status === 422) v = 'PASS(validation)';
    else if (r.status === 200 || r.status === 201) v = 'PASS(wrote)';
    else if (r.status >= 500) v = 'SERVER-ERR';
    else v = `HTTP-${r.status}`;
    const hard = v === 'SERVER-ERR' || (v === 'ACCESS-BLOCKED' && p.canWrite);
    if (hard) flagged.push({ persona: p.name, kind: 'WRITE', ep, v, status: r.status, snip: r.snip });
    console.log(`  ${v.padEnd(16)} ${String(r.status).padEnd(4)} ${ep}`);
  }
  console.log('--- document generators ---');
  for (const a of ARTIFACTS) {
    const r = await hit(a.p, t, a.m, a.m === 'POST' ? {} : undefined);
    const v = r.status === 200 ? 'PASS' : r.status === 403 ? 'ACCESS-FAIL' : r.status >= 500 ? 'SERVER-ERR' : `HTTP-${r.status}`;
    if (v !== 'PASS' && !(v.startsWith('HTTP') && !p.canWrite)) flagged.push({ persona: p.name, kind: 'ARTIFACT', ep: a.label, v, status: r.status, snip: r.snip });
    console.log(`  ${v.padEnd(13)} ${String(r.status).padEnd(4)} ${a.label}`);
  }
}

console.log('\n\n================ FLAGGED (hard failures) ================');
if (!flagged.length) console.log('  none');
for (const f of flagged) console.log(`  [${f.persona}] ${f.kind} ${f.v} ${f.status} ${f.ep}  ${f.snip || ''}`);
console.log(`\nTOTAL HARD FAILURES: ${flagged.length}`);
process.exit(flagged.length ? 1 : 0);
