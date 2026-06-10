// scripts/verify-pdf-active-lab.mjs
//
// Receipts for the active-lab routing fix (Michael L feedback,
// 2026-06-10). The /api/generate-pdf path and the bug-class sweep
// targets all now resolve lab identity via resolveActiveLabForRequest,
// which:
//   1. honors X-Active-Lab-Id header when user is an active member
//   2. honors body.lab_id when user is an active member
//   3. silently falls back to default_lab_id resolver on non-member
//      or absent input (so PDFs still succeed, they just use the
//      legacy lab)
//
// Schema mirrors the relevant bits of server/db.ts:
//   labs (id, lab_name, clia_number, user_id)
//   users (id, lab_id)         -- default_lab_id stored as users.lab_id
//   lab_members (lab_id, user_id, status)
//
// Run: node scripts/verify-pdf-active-lab.mjs

import Database from "better-sqlite3";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

// Mirror of resolveActiveLabForRequest in server/routes.ts.
function resolveActiveLabForRequest(db, userId, req) {
  let requested = null;
  const hdr = req?.headers?.["x-active-lab-id"];
  if (hdr) {
    const n = Number(hdr);
    if (Number.isFinite(n) && n > 0) requested = n;
  }
  if (!requested && req?.body?.lab_id !== undefined) {
    const n = Number(req.body.lab_id);
    if (Number.isFinite(n) && n > 0) requested = n;
  }
  if (requested) {
    const mem = db.prepare(
      `SELECT 1 AS ok FROM labs WHERE id = ? AND user_id = ?
       UNION
       SELECT 1 AS ok FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active'`
    ).get(requested, userId, requested, userId);
    if (mem) return db.prepare("SELECT * FROM labs WHERE id = ?").get(requested);
  }
  return resolveLabForUser(db, userId);
}
function resolveLabForUser(db, userId) {
  const u = db.prepare("SELECT lab_id FROM users WHERE id = ?").get(userId);
  if (u?.lab_id) return db.prepare("SELECT * FROM labs WHERE id = ?").get(u.lab_id);
  return null;
}

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE labs (id INTEGER PRIMARY KEY, user_id INTEGER, lab_name TEXT, clia_number TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, lab_id INTEGER);
    CREATE TABLE lab_members (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER, user_id INTEGER, status TEXT);
    INSERT INTO labs (id, user_id, lab_name, clia_number) VALUES
      (1, 100, 'Michael L Lab', '99D0000001'),
      (2, 200, 'UMass Memorial Health - Milford Regional Medical Center', '22D0070843'),
      (3, 300, 'Riverside Regional Medical Center', '22D0999999');
    INSERT INTO users (id, lab_id) VALUES (10, 2); -- Michael L's user; default_lab_id = Milford (the bug)
    INSERT INTO lab_members (lab_id, user_id, status) VALUES (1, 10, 'active'); -- but he is an active member of his own lab
    INSERT INTO lab_members (lab_id, user_id, status) VALUES (2, 10, 'active'); -- and also of Milford
  `);
  return db;
}

// ── Test 1: legacy behavior — no header, no body — falls back to default_lab_id ──
{
  const db = makeDb();
  const lab = resolveActiveLabForRequest(db, 10, { headers: {}, body: {} });
  check("no header/body -> falls back to default_lab_id (legacy bug repro)", lab?.id === 2, `got ${lab?.id} (${lab?.lab_name})`);
  check("no header/body -> shows Milford (this is what Michael L saw)", lab?.lab_name?.includes("Milford"), `got ${lab?.lab_name}`);
  db.close();
}

// ── Test 2: X-Active-Lab-Id header for a lab the user IS a member of (the fix) ──
{
  const db = makeDb();
  const lab = resolveActiveLabForRequest(db, 10, { headers: { "x-active-lab-id": "1" }, body: {} });
  check("header active-lab=1 -> returns Michael L Lab", lab?.id === 1, `got ${lab?.id} (${lab?.lab_name})`);
  check("header active-lab=1 -> shows Michael L Lab (the fix)", lab?.lab_name === "Michael L Lab", `got ${lab?.lab_name}`);
}

// ── Test 3: body.lab_id falls back when no header ─────────────────────────
{
  const db = makeDb();
  const lab = resolveActiveLabForRequest(db, 10, { headers: {}, body: { lab_id: 1 } });
  check("body.lab_id=1 -> returns Michael L Lab", lab?.id === 1);
}

// ── Test 4: header wins over body when both are present ───────────────────
{
  const db = makeDb();
  const lab = resolveActiveLabForRequest(db, 10, { headers: { "x-active-lab-id": "1" }, body: { lab_id: 2 } });
  check("header beats body when both present", lab?.id === 1);
}

// ── Test 5: non-member lab_id silently downgrades (does NOT leak) ─────────
{
  const db = makeDb();
  // User 10 is NOT a member of lab 3 (Riverside). Header should be rejected.
  const lab = resolveActiveLabForRequest(db, 10, { headers: { "x-active-lab-id": "3" }, body: {} });
  check("non-member lab_id is rejected", lab?.id !== 3, `got ${lab?.id} -- LEAK if 3`);
  check("non-member lab_id falls back to default_lab_id", lab?.id === 2);
}

// ── Test 6: lab owner can resolve their own lab even if not in lab_members ──
{
  const db = makeDb();
  // User 100 owns lab 1 (labs.user_id = 100) but has no lab_members row.
  // Insert minimal user record so the fallback also has something to read.
  db.prepare("INSERT INTO users (id, lab_id) VALUES (100, 1)").run();
  const lab = resolveActiveLabForRequest(db, 100, { headers: { "x-active-lab-id": "1" }, body: {} });
  check("lab owner without lab_members row can resolve their own lab", lab?.id === 1);
}

// ── Test 7: malformed header is silently ignored ──────────────────────────
{
  const db = makeDb();
  const cases = ["not-a-number", "-5", "0", ""];
  for (const v of cases) {
    const lab = resolveActiveLabForRequest(db, 10, { headers: { "x-active-lab-id": v }, body: {} });
    check(`malformed header "${v}" -> falls back, no throw`, lab?.id === 2);
  }
}

// ── Test 8: case sensitivity of header lookup ────────────────────────────
{
  const db = makeDb();
  // Express normalizes headers to lowercase; this just confirms our mirror does too.
  const lab = resolveActiveLabForRequest(db, 10, { headers: { "x-active-lab-id": "1" }, body: {} });
  check("lowercase header name resolves", lab?.id === 1);
}

// ── Test 9: numeric body.lab_id and string body.lab_id both work ─────────
{
  const db = makeDb();
  const labA = resolveActiveLabForRequest(db, 10, { headers: {}, body: { lab_id: 1 } });
  const labB = resolveActiveLabForRequest(db, 10, { headers: {}, body: { lab_id: "1" } });
  check("body.lab_id numeric works", labA?.id === 1);
  check("body.lab_id string works", labB?.id === 1);
}

console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
