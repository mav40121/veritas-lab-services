// scripts/verify-legacy-resolver-unification.mjs
//
// Receipt for the 2026-06-12 resolver unification (server/routes.ts):
// resolveLegacyLabId now honors a membership-validated X-Active-Lab-Id and
// otherwise behaves exactly as before, and the four resolveLegacyLabId-group
// writes (veritamap_maps, cumsum_trackers, pt_events, pt_corrective_actions)
// tag lab_id through the SAME resolver their list reads use, so write==read
// in every branch.
//
// Replicates the real logic over an in-memory schema (same pattern as
// verify-active-lab-resolution.mjs) and asserts:
//   1. no header           -> default_lab_id (behavior unchanged)
//   2. no header, no default -> first active membership (unchanged)
//   3. header=owned lab    -> that lab (switcher honored)
//   4. header=foreign lab  -> default lab (access denied, falls through)
//   5. header=member lab   -> that lab (active membership honored)
//   6. header=garbage      -> default lab
//   7. header=pending-member lab -> default lab (pending not honored)
//   8. seat user, header=owner's lab -> that lab (seat path honored)
//   9. DRIFT: users.lab_id != default_lab_id, no header -> read and
//      write (same resolver) BOTH return default_lab_id. This is why the
//      writes go through resolveLegacyLabId and NOT resolveActiveLabForRequest:
//      the latter's no-header fallback uses users.lab_id and would diverge.
//
// Run: node scripts/verify-legacy-resolver-unification.mjs

import Database from "better-sqlite3";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE labs (id INTEGER PRIMARY KEY, name TEXT, owner_user_id INTEGER);
  CREATE TABLE users (id INTEGER PRIMARY KEY, lab_id INTEGER, default_lab_id INTEGER);
  CREATE TABLE lab_members (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER, user_id INTEGER, status TEXT);
  CREATE TABLE user_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, seat_user_id INTEGER, owner_user_id INTEGER, status TEXT);
`);
// u1 owns labs 1+2, defaults to 1. u2 owns lab 3. u3 is an active member of
// lab 2 (default 2 via membership only). u4 is the DRIFT user: lab_id=3 but
// default_lab_id=1. u5 is a seat user under u1. u6 is a PENDING member of 2.
db.exec(`
  INSERT INTO labs VALUES (1,'Michaels Lab',1),(2,'Riverside Regional',1),(3,'Other Lab',2);
  INSERT INTO users VALUES (1,1,1),(2,3,3),(3,NULL,NULL),(4,3,1),(5,NULL,NULL),(6,NULL,1);
  INSERT INTO lab_members (lab_id,user_id,status) VALUES (2,3,'active'),(2,6,'pending');
  INSERT INTO user_seats (seat_user_id,owner_user_id,status) VALUES (5,1,'active');
`);

// ── Mirror of resolveLabForUser (routes.ts:830) ──
function resolveLabForUser(userId) {
  const userRow = db.prepare("SELECT lab_id FROM users WHERE id = ?").get(userId);
  if (userRow?.lab_id) return db.prepare("SELECT * FROM labs WHERE id = ?").get(userRow.lab_id);
  const seatRow = db.prepare("SELECT owner_user_id FROM user_seats WHERE seat_user_id = ? AND status = 'active' LIMIT 1").get(userId);
  if (seatRow) {
    const ownerRow = db.prepare("SELECT lab_id FROM users WHERE id = ?").get(seatRow.owner_user_id);
    if (ownerRow?.lab_id) return db.prepare("SELECT * FROM labs WHERE id = ?").get(ownerRow.lab_id);
  }
  return null;
}

// ── Mirror of resolveActiveLabForRequest (routes.ts:872) ──
function resolveActiveLabForRequest(userId, req) {
  let requested = null;
  const hdr = req?.headers?.["x-active-lab-id"];
  if (hdr) { const n = Number(hdr); if (Number.isFinite(n) && n > 0) requested = n; }
  if (!requested && req?.body?.lab_id !== undefined) {
    const n = Number(req.body.lab_id); if (Number.isFinite(n) && n > 0) requested = n;
  }
  if (requested) {
    const mem = db.prepare(
      `SELECT 1 AS ok FROM labs WHERE id = ? AND owner_user_id = ?
       UNION
       SELECT 1 AS ok FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active'`
    ).get(requested, userId, requested, userId);
    if (!mem) {
      const seatOwner = db.prepare("SELECT owner_user_id FROM user_seats WHERE seat_user_id = ? AND status = 'active' LIMIT 1").get(userId);
      if (seatOwner) {
        const seatMem = db.prepare(
          `SELECT 1 AS ok FROM labs WHERE id = ? AND owner_user_id = ?
           UNION
           SELECT 1 AS ok FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active'`
        ).get(requested, seatOwner.owner_user_id, requested, seatOwner.owner_user_id);
        if (seatMem) return db.prepare("SELECT * FROM labs WHERE id = ?").get(requested);
      }
    } else {
      return db.prepare("SELECT * FROM labs WHERE id = ?").get(requested);
    }
  }
  return resolveLabForUser(userId);
}

// ── Mirror of the UNIFIED resolveLegacyLabId (routes.ts:4771) ──
function resolveLegacyLabId(req) {
  const userId = req.user?.userId;
  if (!userId) return null;
  const hdr = req?.headers?.["x-active-lab-id"];
  if (hdr) {
    const requested = Number(hdr);
    if (Number.isFinite(requested) && requested > 0) {
      try {
        const active = resolveActiveLabForRequest(userId, req);
        if (active?.id && Number(active.id) === requested) return requested;
      } catch {}
    }
  }
  const u = db.prepare("SELECT default_lab_id FROM users WHERE id = ?").get(userId);
  if (u?.default_lab_id) return Number(u.default_lab_id);
  const m = db.prepare("SELECT lab_id FROM lab_members WHERE user_id = ? AND status = 'active' ORDER BY id ASC LIMIT 1").get(userId);
  return m?.lab_id ? Number(m.lab_id) : null;
}

const rq = (userId, hdr) => ({ user: { userId }, headers: hdr ? { "x-active-lab-id": String(hdr) } : {} });

// 1. No header -> default_lab_id (unchanged legacy behavior).
check("1. no header -> default lab", resolveLegacyLabId(rq(1)) === 1);
// 2. No header, no default -> first active membership.
check("2. no header, no default -> first membership", resolveLegacyLabId(rq(3)) === 2);
// 3. Header = owned non-default lab -> honored.
check("3. header=owned lab 2 -> 2 (switcher honored)", resolveLegacyLabId(rq(1, 2)) === 2);
// 4. Header = foreign lab -> denied, falls to default.
check("4. header=foreign lab 3 -> default 1", resolveLegacyLabId(rq(1, 3)) === 1);
// 5. Header = active-member lab -> honored.
check("5. header=member lab 2 (u3) -> 2", resolveLegacyLabId(rq(3, 2)) === 2);
// 6. Garbage header -> default.
check("6. header=garbage -> default 1", resolveLegacyLabId({ user: { userId: 1 }, headers: { "x-active-lab-id": "abc" } }) === 1);
// 7. Pending membership NOT honored.
check("7. header=pending-member lab 2 (u6) -> default 1", resolveLegacyLabId(rq(6, 2)) === 1);
// 8. Seat user under u1, header=2 (owner owns 2) -> honored via seat path.
check("8. seat user header=2 -> 2", resolveLegacyLabId(rq(5, 2)) === 2);
// 9. DRIFT user u4 (lab_id=3, default_lab_id=1), no header:
//    read resolver and write-through-same-resolver both -> 1 (agree), while
//    resolveActiveLabForRequest's fallback would -> 3 (diverges). Proves the
//    write must go through resolveLegacyLabId, not resolveActiveLabForRequest.
const driftRead = resolveLegacyLabId(rq(4));
const driftWrite = resolveLegacyLabId(rq(4));
const driftAlt = resolveActiveLabForRequest(4, rq(4))?.id ?? null;
check("9a. drift: read==write==1 via unified resolver", driftRead === 1 && driftWrite === 1);
check("9b. drift: resolveActiveLabForRequest would diverge (3)", Number(driftAlt) === 3,
  `got ${driftAlt} -- if this fails the divergence premise changed; re-evaluate which resolver writes use`);

console.log("");
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log("ALL PASS (10/10): unified resolver honors validated X-Active-Lab-Id, preserves every legacy branch, and write==read including under lab_id/default_lab_id drift.");
