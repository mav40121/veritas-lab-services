// Receipt for the SQLite-backed pdf_tokens store (server/pdfTokens.ts).
//
// What this script proves:
//
//  1. PERSISTENCE: a token minted via INSERT is still claimable via SELECT
//     after the SQLite handle is closed and re-opened. This is the property
//     the old in-memory Map did NOT have, and the property that broke
//     VeritaOps CPRT PDF downloads when prod restarted between the POST
//     (mint) and the browser GET (claim).
//
//  2. SINGLE-USE: a second claim against the same token after a successful
//     first claim returns null. The DELETE inside the claim is what enforces
//     this; this script confirms it survives the re-open.
//
//  3. TTL: an expired token (expires < now) returns null on claim AND the
//     row is removed (cleanup-on-failed-claim semantics).
//
//  4. PRUNE: the opportunistic "DELETE WHERE expires < ?" sweep removes
//     stale rows without touching live ones.
//
//  5. CONCURRENT CLAIM RACE: when two reads happen between SELECT and
//     DELETE on the same token, both can see the row (the bug-class window
//     that's identical to the in-memory Map's). This script DOCUMENTS the
//     window without asserting on it — UUIDs are unguessable so the race
//     is not exploitable, but a future caller who needs strict at-most-once
//     should know.
//
//  6. LIVE (optional): if API + TOKEN env are set, POSTs to a real PDF
//     endpoint, GETs /api/pdf/<token>, asserts %PDF- magic bytes. This is
//     the actual customer-facing receipt.
//
// Run (offline contract check):
//
//   node scripts/verify-pdf-token-persistence.js
//
// Run (live, exercises the VeritaOps CPRT PDF on prod):
//
//   API=https://www.veritaslabservices.com \
//   TOKEN=<jwt> \
//   LAB=3 \
//   STUDY=<cprt_study_id> \
//     node scripts/verify-pdf-token-persistence.js
//
// Exits non-zero on any failure so this can land in CI later.

import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

let failures = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` :: ${detail}` : ''}`);
    failures++;
  }
}

// ---------------------------------------------------------------------------
// Offline contract check. Mirrors the exact SQL that server/pdfTokens.ts
// runs, against a tmp DB we create and tear down ourselves.
// ---------------------------------------------------------------------------

const TMP = path.join(os.tmpdir(), `verify-pdf-tokens-${process.pid}-${Date.now()}.db`);
console.log(`[offline] tmp db: ${TMP}`);

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS pdf_tokens (
    token TEXT PRIMARY KEY,
    buffer BLOB NOT NULL,
    filename TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pdf_tokens_expires ON pdf_tokens(expires);
`;

function openDb() {
  const db = new Database(TMP);
  db.exec(SCHEMA);
  return db;
}

function mint(db, buffer, filename, ttlMs = 300_000) {
  const token = crypto.randomUUID();
  const expires = Date.now() + ttlMs;
  db.prepare('INSERT INTO pdf_tokens (token, buffer, filename, expires) VALUES (?, ?, ?, ?)').run(token, buffer, filename, expires);
  return token;
}

function claim(db, token) {
  const row = db.prepare('SELECT buffer, filename, expires FROM pdf_tokens WHERE token = ?').get(token);
  if (!row) return null;
  db.prepare('DELETE FROM pdf_tokens WHERE token = ?').run(token);
  if (row.expires < Date.now()) return null;
  return row;
}

console.log('\n[1] PERSISTENCE across SQLite handle close / re-open');
{
  let db = openDb();
  const buf = Buffer.from('%PDF-1.4 fake content for test', 'utf-8');
  const token = mint(db, buf, 'TestPersistence.pdf');
  db.close();

  // Simulate process restart by opening a fresh handle to the same file.
  db = openDb();
  const claimed = claim(db, token);
  check(
    'token minted before close is still claimable after re-open',
    !!claimed && Buffer.from(claimed.buffer).equals(buf) && claimed.filename === 'TestPersistence.pdf',
    claimed ? `filename=${claimed.filename} buflen=${claimed.buffer.length}` : 'null returned',
  );
  db.close();
}

console.log('\n[2] SINGLE-USE: second claim on the same token returns null');
{
  const db = openDb();
  const token = mint(db, Buffer.from('one-shot'), 'OneShot.pdf');
  const first = claim(db, token);
  const second = claim(db, token);
  check('first claim returns the row', !!first);
  check('second claim returns null', second === null);
  db.close();
}

console.log('\n[3] TTL: expired token returns null AND row is deleted');
{
  const db = openDb();
  // Insert directly with expires in the past.
  const token = crypto.randomUUID();
  db.prepare('INSERT INTO pdf_tokens (token, buffer, filename, expires) VALUES (?, ?, ?, ?)')
    .run(token, Buffer.from('stale'), 'Stale.pdf', Date.now() - 1000);
  const claimed = claim(db, token);
  check('expired claim returns null', claimed === null);
  const remaining = db.prepare('SELECT COUNT(*) as n FROM pdf_tokens WHERE token = ?').get(token);
  check('expired row is removed by the claim', remaining.n === 0);
  db.close();
}

console.log('\n[4] PRUNE: DELETE WHERE expires < now removes only stale rows');
{
  const db = openDb();
  const liveTok = mint(db, Buffer.from('live'), 'Live.pdf', 300_000);
  const staleTok = crypto.randomUUID();
  db.prepare('INSERT INTO pdf_tokens (token, buffer, filename, expires) VALUES (?, ?, ?, ?)')
    .run(staleTok, Buffer.from('stale'), 'Stale.pdf', Date.now() - 60_000);

  db.prepare('DELETE FROM pdf_tokens WHERE expires < ?').run(Date.now());

  const liveStill = db.prepare('SELECT COUNT(*) as n FROM pdf_tokens WHERE token = ?').get(liveTok).n;
  const staleGone = db.prepare('SELECT COUNT(*) as n FROM pdf_tokens WHERE token = ?').get(staleTok).n;
  check('live token survives prune', liveStill === 1);
  check('stale token removed by prune', staleGone === 0);
  db.close();
}

console.log('\n[5] CONCURRENT-CLAIM RACE: documented, not asserted');
{
  // We do not enforce strict at-most-once because:
  //   (a) the production claim flow is one HTTP request, not a contention
  //       hot path;
  //   (b) UUID v4 tokens are unguessable so a second client cannot race in;
  //   (c) the old in-memory Map had the same window.
  // This block records the window so future readers know it's intentional.
  const db = openDb();
  const token = mint(db, Buffer.from('race'), 'Race.pdf');
  const peek1 = db.prepare('SELECT buffer, filename, expires FROM pdf_tokens WHERE token = ?').get(token);
  const peek2 = db.prepare('SELECT buffer, filename, expires FROM pdf_tokens WHERE token = ?').get(token);
  check('two SELECTs between SELECT-and-DELETE both see the row (race window documented)', !!peek1 && !!peek2);
  db.prepare('DELETE FROM pdf_tokens WHERE token = ?').run(token);
  const after = db.prepare('SELECT COUNT(*) as n FROM pdf_tokens WHERE token = ?').get(token);
  check('a single DELETE removes the row regardless of prior reads', after.n === 0);
  db.close();
}

try { fs.unlinkSync(TMP); } catch {}

// ---------------------------------------------------------------------------
// Live integration check. Opt-in via env vars.
// ---------------------------------------------------------------------------

const API = process.env.API;
const JWT = process.env.TOKEN;
const LAB = process.env.LAB;
const STUDY = process.env.STUDY;

if (API && JWT && LAB && STUDY) {
  console.log(`\n[live] POST ${API}/api/labs/${LAB}/veritaops/studies/${STUDY}/pdf`);
  const mintRes = await fetch(`${API}/api/labs/${LAB}/veritaops/studies/${STUDY}/pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${JWT}` },
  });
  if (!mintRes.ok) {
    console.log(`  FAIL  mint POST returned ${mintRes.status}`);
    failures++;
  } else {
    const { token } = await mintRes.json();
    console.log(`  PASS  mint returned token ${token}`);

    // Sleep 1s to mimic the realistic browser navigation gap.
    await new Promise(r => setTimeout(r, 1000));

    const claimRes = await fetch(`${API}/api/pdf/${token}`, {
      headers: { Authorization: `Bearer ${JWT}` },
    });
    const buf = Buffer.from(await claimRes.arrayBuffer());
    const isPdf = buf.slice(0, 5).toString('utf-8') === '%PDF-';
    check(`GET /api/pdf/<token> returns %PDF- bytes (status=${claimRes.status}, len=${buf.length})`, isPdf);

    // Second claim should now 404 because the first claim consumed it.
    const reclaim = await fetch(`${API}/api/pdf/${token}`, {
      headers: { Authorization: `Bearer ${JWT}` },
    });
    check('second claim on same token returns 404 (single-use enforced)', reclaim.status === 404);
  }
} else {
  console.log('\n[live] skipped (set API + TOKEN + LAB + STUDY env to exercise prod)');
}

console.log(`\n${failures === 0 ? 'OK' : 'FAILURES: ' + failures}`);
process.exit(failures === 0 ? 0 : 1);
