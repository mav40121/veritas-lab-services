// scripts/qa-sweep/api-sweep.mjs
//
// Authenticated API + artifact sweep across the FOUR login types that matter:
//   1. owner            - the lab's owner_user_id
//   2. admin-member     - an active 'admin' lab_members row (reaches the lab via
//                         membership, often with a free personal plan: the exact
//                         persona that failed the USON demo)
//   3. demo-seat        - an active user_seats seat_user on the lab (read-and-sign staff)
//   4. medical-director - the active member whose email matches labs.medical_director_email;
//                         has director-only powers (QC co-sign, policy approval, findings
//                         sign-off, CMS 209 LD line) that no other login exercises
//
// It auto-discovers those users on a lab INSIDE the owned QA system (--org)
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

// ---- discover the target lab + the personas on it ----
// Scoped to the QA organization (--org), never a free-for-all scan of prod.
// Membership in a paid org = paid, so org-scoped discovery does NOT filter on the
// (often stale) lab-level plan column; it just needs active members. Pick the lab
// with the RICHEST persona coverage so the sweep actually exercises all four logins:
//   1. a lab with a designated medical director who is an active member (only such a
//      lab can exercise the 4th login; this is the whole point of the MD persona),
//   2. else a lab with an admin-member distinct from the owner (the USON-demo persona),
//   3. else any lab in the org with active members.
// Ordering by lab id alone is wrong: it grabbed Riverside (no MD, no seats) over
// Michaels Lab, silently dropping the director and staff logins.
const lab = FORCE_LAB
  ? one(`SELECT id, owner_user_id, organization_id FROM labs WHERE id = ?`, FORCE_LAB)
  : (one(`SELECT l.id, l.owner_user_id, l.organization_id FROM labs l
          WHERE l.organization_id = ? AND l.owner_user_id IS NOT NULL
            AND l.medical_director_email IS NOT NULL AND TRIM(l.medical_director_email) != ''
            AND EXISTS (SELECT 1 FROM lab_members m JOIN users u ON u.id = m.user_id
                        WHERE m.lab_id = l.id AND m.status='active'
                          AND lower(u.email) = lower(l.medical_director_email))
          ORDER BY l.id LIMIT 1`, ORG)
     || one(`SELECT id, owner_user_id, organization_id FROM labs l
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
// The medical director is the active member whose email matches labs.medical_director_email.
// It is a distinct ACCESS persona (approve major policy revisions, co-sign QC, sign off
// findings, the LD line on the CMS 209) even though it is not a distinct lab_members.role.
const mdId = one(`SELECT lm.user_id FROM lab_members lm JOIN users u ON u.id = lm.user_id
  JOIN labs l ON l.id = lm.lab_id
  WHERE lm.lab_id = ? AND lm.status = 'active' AND l.medical_director_email IS NOT NULL
    AND lower(u.email) = lower(l.medical_director_email) LIMIT 1`, LAB)?.user_id;
// Prefer an admin-member who is NOT the MD, so the admin and medical-director personas are
// different users (on a small lab the MD is often also an admin); fall back to any admin.
const adminId = one(`SELECT lm.user_id FROM lab_members lm JOIN users u ON u.id = lm.user_id
  WHERE lm.lab_id = ? AND lm.role = 'admin' AND lm.status = 'active' AND lm.user_id != ?
    AND lower(u.email) != COALESCE((SELECT lower(medical_director_email) FROM labs WHERE id = ?), '')
  LIMIT 1`, LAB, ownerId, LAB)?.user_id
  || one(`SELECT user_id FROM lab_members WHERE lab_id=? AND role='admin' AND status='active' AND user_id != ? LIMIT 1`, LAB, ownerId)?.user_id;
// Prefer a VIEW-ONLY seat (the true read-and-sign staff archetype) so the staff persona
// genuinely tests restricted access. A seat granted edit (edit_all or per-module "edit")
// is a writer and would correctly behave like one, masking real over-permission. Fall
// back to any staff-role seat, then any seat.
const seatId = one(`SELECT seat_user_id FROM user_seats WHERE lab_id=? AND seat_user_id IS NOT NULL AND status='active'
      AND (seat_type='view_only' OR permissions LIKE '%view_all%' OR (permissions NOT LIKE '%edit%')) LIMIT 1`, LAB)?.seat_user_id
  || one(`SELECT us.seat_user_id FROM user_seats us
      JOIN lab_members lm ON lm.lab_id = us.lab_id AND lm.user_id = us.seat_user_id AND lm.status = 'active'
      WHERE us.lab_id = ? AND us.seat_user_id IS NOT NULL AND us.status = 'active' AND lm.role = 'staff'
      LIMIT 1`, LAB)?.seat_user_id
  || one(`SELECT seat_user_id FROM user_seats WHERE lab_id=? AND seat_user_id IS NOT NULL AND status='active' LIMIT 1`, LAB)?.seat_user_id;

// Expected write access is derived from the member's ACTUAL lab role, not the persona
// label: owner/admin are writers; a plain staff member is not. This matters because the
// medical director is often ALSO an admin (then they are correctly expected to write);
// a pure non-admin MD would be a non-writer. canWrite drives the two-way access check.
const roleOf = (uid) => uid ? (one(`SELECT role FROM lab_members WHERE lab_id=? AND user_id=? AND status='active' LIMIT 1`, LAB, uid)?.role || 'none') : null;
// A user is an expected WRITER if they own/admin the lab OR hold a seat that grants edit
// (edit_all or any per-module "edit"). A pure view_only seat is a non-writer. This keeps
// the two-way access check honest regardless of which member we picked for a persona.
const seatWriterOf = (uid) => { if (!uid) return false; const perm = one(`SELECT permissions FROM user_seats WHERE lab_id=? AND seat_user_id=? AND status='active' LIMIT 1`, LAB, uid)?.permissions || ''; return /edit_all/.test(perm) || /"\w+"\s*:\s*"edit"/.test(perm); };
const mk = (name, uid, extra = {}) => { const role = roleOf(uid); const writer = role === 'owner' || role === 'admin' || seatWriterOf(uid); return { name, userId: uid, role, canWrite: writer, ...extra }; };
const personas = [
  mk('owner', ownerId),
  mk('admin-member', adminId),
  mk('staff-seat', seatId),
  mk('medical-director', mdId, { isMd: true }), // director-only powers; writer only if also owner/admin
].filter(p => p.userId)
 // Dedupe: never test the same user under two persona names (e.g. an admin who also
 // holds a seat). Keep the first by the priority order above.
 .filter((p, i, arr) => arr.findIndex(x => x.userId === p.userId) === i);
console.log(`Target lab: ${LAB} (${one(`SELECT lab_name FROM labs WHERE id=?`, LAB)?.lab_name}) plan=${one(`SELECT plan FROM labs WHERE id=?`, LAB)?.plan}`);
console.log('Personas:', personas.map(p => `${p.name}=${p.userId}(role=${p.role},expect-write=${p.canWrite ? 'Y' : 'N'})`).join(', '));
if (personas.find(p => p.isMd)?.canWrite) console.log('NOTE: the medical-director persona is also owner/admin, so write expectations cannot isolate a pure reviewer MD on this lab.');
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
  `${L}/qc/results`, `${L}/qc/control-lots`, `${L}/veritalab/certificates`, `${L}/veritapolicy/manuals`,
  `${L}/schedule/shifts`, `${L}/veritastock/vendors`,
  '/api/veritatrack/tasks', '/api/productivity', '/api/inventory', '/api/pi/metrics',
  '/api/veritaops/studies', '/api/staffing-studies',
];
// Owner-only actions: only the lab OWNER may reach these (admins, staff, MD blocked).
// Bodies are shaped to pass the owner gate and then fail on a bogus target, so the
// owner reaches (404/400) while non-owners are blocked (403) BEFORE any mutation.
const OWNER_ONLY = [
  { m: 'POST', p: `${L}/transfer-ownership`, body: { newOwnerUserId: 999999999, confirm: false }, label: 'Transfer lab ownership' },
];
const ARTIFACTS = [
  { m: 'POST', p: `${L}/staff/cms209`, label: 'CMS 209 PDF' },
  { m: 'GET', p: `${L}/veritamap/coverage-report.xlsx`, label: 'VeritaMap coverage xlsx' },
  { m: 'GET', p: `${L}/veritacheck/coverage/export`, label: 'VeritaCheck coverage export' },
];
// Director-only actions: only the designated Medical Director may reach these. The QC
// period-review co-sign is the canonical one: with a well-formed body it passes field
// validation and reaches the identity gate, which returns 403 for anyone who is not the
// MD and 409 for the MD on a non-existent record. Probed two-way (gated on an MD existing):
// the MD must NOT be blocked (403 = fail); every other login must be (403 = pass).
const MD_ONLY = [
  { m: 'POST', p: `${L}/qc/period-reviews/md-cosign`, body: { control_lot_id: 999999999, period_year: 2099, period_month: 1 }, label: 'QC period-review MD co-sign' },
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
  // Write access, checked BOTH ways against the expectation (p.canWrite):
  //   writer expected  -> 403 is UNDER-PERMISSION (wrongly blocked)
  //   non-writer        -> anything but 403 is OVER-PERMISSION (reached a write it should not)
  // A non-writer reaching may be a legit per-seat edit grant or an ungated endpoint;
  // flagged as "verify" rather than asserted a bug.
  console.log(`--- write access probes (expect-write=${p.canWrite ? 'Y' : 'N'}) ---`);
  for (const ep of WRITES) {
    const r = await hit(ep, t, 'POST', {});
    const blocked = r.status === 403, serverErr = r.status >= 500, authErr = r.status === 401 || r.status === 404;
    let v, hard = false;
    if (serverErr) { v = 'SERVER-ERR'; hard = true; }
    else if (p.canWrite) { // should be able to write
      if (blocked) { v = 'UNDER-PERM(writer blocked)'; hard = true; }
      else if (authErr) v = `HTTP-${r.status}`;
      else v = (r.status === 200 || r.status === 201) ? 'PASS(wrote)' : 'PASS(reached)';
    } else { // should NOT be able to write
      if (blocked) v = 'PASS(blocked)';
      else if (authErr) v = `HTTP-${r.status}`;
      else { v = 'OVER-PERM(verify)'; hard = true; }
    }
    if (hard) flagged.push({ persona: p.name, kind: 'WRITE', ep, v, status: r.status, snip: r.snip });
    console.log(`  ${v.padEnd(26)} ${String(r.status).padEnd(4)} ${ep}`);
  }
  console.log('--- owner-only actions (expect: owner reaches, all others blocked) ---');
  for (const a of OWNER_ONLY) {
    const r = await hit(a.p, t, a.m, a.body);
    const blocked = r.status === 403, isOwner = p.role === 'owner';
    let v, hard = false;
    if (r.status >= 500) { v = 'SERVER-ERR'; hard = true; }
    else if (isOwner) { if (blocked) { v = 'UNDER-PERM(owner blocked)'; hard = true; } else v = 'PASS(owner reached)'; }
    else { if (blocked) v = 'PASS(blocked)'; else { v = 'OVER-PERM(non-owner reached)'; hard = true; } }
    if (hard) flagged.push({ persona: p.name, kind: 'OWNER-ONLY', ep: a.label, v, status: r.status, snip: r.snip });
    console.log(`  ${v.padEnd(26)} ${String(r.status).padEnd(4)} ${a.label}`);
  }
  console.log('--- document generators ---');
  for (const a of ARTIFACTS) {
    const r = await hit(a.p, t, a.m, a.m === 'POST' ? {} : undefined);
    const v = r.status === 200 ? 'PASS' : r.status === 403 ? 'ACCESS-FAIL' : r.status >= 500 ? 'SERVER-ERR' : `HTTP-${r.status}`;
    if (v !== 'PASS' && !(v.startsWith('HTTP') && !p.canWrite)) flagged.push({ persona: p.name, kind: 'ARTIFACT', ep: a.label, v, status: r.status, snip: r.snip });
    console.log(`  ${v.padEnd(13)} ${String(r.status).padEnd(4)} ${a.label}`);
  }
  if (mdId) {
    console.log('--- medical-director-only actions ---');
    for (const a of MD_ONLY) {
      const r = await hit(a.p, t, a.m, a.body);
      let v, hard = false;
      if (r.status >= 500) { v = 'SERVER-ERR'; hard = true; }
      else if (p.isMd) {
        if (r.status === 403) { v = 'ACCESS-FAIL(MD blocked)'; hard = true; }
        else v = 'PASS(MD reached)';
      } else {
        if (r.status === 403) v = 'PASS(blocked)';
        else if (r.status === 401 || r.status === 404) v = `HTTP-${r.status}`;
        else { v = 'OVER-PERMISSION'; hard = true; }
      }
      if (hard) flagged.push({ persona: p.name, kind: 'MD-ACTION', ep: a.label, v, status: r.status, snip: r.snip });
      console.log(`  ${v.padEnd(22)} ${String(r.status).padEnd(4)} ${a.label}`);
    }
  }
}

console.log('\n\n================ FLAGGED (hard failures) ================');
if (!flagged.length) console.log('  none');
for (const f of flagged) console.log(`  [${f.persona}] ${f.kind} ${f.v} ${f.status} ${f.ep}  ${f.snip || ''}`);
console.log(`\nTOTAL HARD FAILURES: ${flagged.length}`);
process.exit(flagged.length ? 1 : 0);
