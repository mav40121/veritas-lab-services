// scripts/verify-studies-lab-scope.mjs
//
// Gate-3 math/branch receipt for the 2026-08-25 review Finding 2 fix:
// storage.getStudiesByLabForUser(labId, userId) must return the active lab's
// studies PLUS the caller's OWN pre-backfill orphans (lab_id IS NULL), and must
// NEVER return another lab's studies or another user's orphan. It exercises the
// exact SQL predicate used by the method:
//   (lab_id = ? OR (lab_id IS NULL AND user_id = ?))
// against the legacy getStudiesByUser fallback (all of a user's studies).
//
// Run: node scripts/verify-studies-lab-scope.mjs   (exits non-zero on any FAIL)
import Database from "better-sqlite3";

const db = new Database(":memory:");
db.exec(`CREATE TABLE studies (id INTEGER PRIMARY KEY, user_id INTEGER, lab_id INTEGER);`);
// user 100 belongs to labs 5 and 6, plus one pre-backfill orphan (lab_id NULL).
// user 200 also belongs to lab 5, plus their own orphan.
const rows = [
  [1, 100, 5],    // caller's study in the active lab
  [2, 100, 6],    // caller's study in a DIFFERENT lab -> must be hidden under lab 5
  [3, 100, null], // caller's OWN orphan -> must appear (Finding 2: must not vanish)
  [4, 200, 5],    // another user's study in the SAME lab -> correctly visible (lab-scoped)
  [5, 200, null], // another user's orphan -> must be hidden from user 100
];
const ins = db.prepare("INSERT INTO studies (id, user_id, lab_id) VALUES (?, ?, ?)");
for (const r of rows) ins.run(r[0], r[1], r[2]);

const byLabForUser = (labId, userId) =>
  db.prepare("SELECT id FROM studies WHERE (lab_id = ? OR (lab_id IS NULL AND user_id = ?)) ORDER BY id")
    .all(labId, userId).map((r) => r.id);
const byUser = (userId) =>
  db.prepare("SELECT id FROM studies WHERE user_id = ? ORDER BY id").all(userId).map((r) => r.id);

let failed = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  got=[${got}] want=[${want}]`);
  if (!ok) failed++;
};

// Active-lab path (header set / lab resolves): lab 5 rows + user 100's own orphan.
eq("getStudiesByLabForUser(5,100) = active-lab rows + own orphan", byLabForUser(5, 100), [1, 3, 4]);
// Leak-safety: user 100's lab-6 study is NOT shown under lab 5.
eq("cross-lab study 2 (user100, lab6) hidden under lab 5", byLabForUser(5, 100).includes(2), false);
// Leak-safety: user 200's orphan is NOT shown to user 100.
eq("other user's orphan (study 5) hidden from user 100", byLabForUser(5, 100).includes(5), false);
// The caller's own orphan IS present (the Finding 2 regression this fixes).
eq("own orphan (study 3) present -> does not vanish", byLabForUser(5, 100).includes(3), true);
// Viewing lab 6 shows study 2 + own orphan, not the lab-5 rows.
eq("getStudiesByLabForUser(6,100) = lab6 row + own orphan", byLabForUser(6, 100), [2, 3]);
// No-lab fallback (bare request, user resolves to no lab): all of user 100's studies.
eq("getStudiesByUser(100) fallback = every study of user 100", byUser(100), [1, 2, 3]);
// A lab-less user with only orphans still sees them via the fallback (prod case: 1 user, 49 orphans).
eq("getStudiesByUser(200) fallback includes orphan 5", byUser(200), [4, 5]);

db.close();
if (failed) { console.error(`\n${failed} FAIL(s)`); process.exit(1); }
console.log("\nAll studies lab-scope checks passed.");
