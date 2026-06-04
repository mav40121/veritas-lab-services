#!/usr/bin/env node
// verify-veritacheck-instruments-lab-scope.js
//
// Verify that GET /api/labs/:labId/veritacheck/lab-instruments scopes by
// lab_id, not user_id. Customer report 2026-06-04 on San Carlos lab:
// deleting one of two redundant maps caused VeritaCheck to stop showing
// any instruments. Root cause: the legacy /api/veritacheck/lab-instruments
// endpoint queries WHERE m.user_id = ?, and the kept map's user_id did not
// match the requester even though its lab_id correctly pointed at San
// Carlos. The fix mirrors the Print Labels lab-scope fix (PR #530), the
// John-Hall account-settings fix (PR #472/#473), and the count-sheet
// lab-scoping. Same shape, same antipattern.
//
// What this script proves (offline, against an in-memory sqlite):
//
//   1. Lab-scoped query WHERE m.lab_id = ? returns all instruments under
//      maps assigned to that lab, regardless of which user owns the map
//      row.
//   2. Legacy user-scoped query WHERE m.user_id = ? misses instruments
//      under maps whose user_id does not match the requester, even when
//      those maps correctly belong to the same lab.
//   3. Cross-lab isolation: a request scoped to Lab 1 cannot see Lab 2
//      instruments via the lab-scoped query.
//   4. Empty-lab case: a lab with no maps returns zero instruments cleanly
//      (no error).
//   5. Counterfactual: reproduces the San Carlos symptom shape -- a
//      requester whose user_id does not match the kept map's user_id sees
//      0 instruments under the legacy query but the correct count under
//      the lab-scoped query.

import Database from "better-sqlite3";

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE labs (id INTEGER PRIMARY KEY);
  CREATE TABLE veritamap_maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    lab_id INTEGER,
    name TEXT NOT NULL
  );
  CREATE TABLE veritamap_instruments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id INTEGER NOT NULL,
    instrument_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Primary',
    category TEXT NOT NULL DEFAULT 'Chemistry'
  );
`);

// Seed two labs:
//   Lab 1 = San Carlos. Has one kept map whose user_id is 999 (a stale
//          ownership reference, perhaps an old account or a seat user). The
//          requester's user_id is 100. The legacy query misses this map
//          because 100 != 999.
//   Lab 2 = Riverside. Has one map owned by user 100. Both queries see it.
db.prepare("INSERT INTO labs (id) VALUES (1)").run();
db.prepare("INSERT INTO labs (id) VALUES (2)").run();

const insertMap = db.prepare(
  "INSERT INTO veritamap_maps (user_id, lab_id, name) VALUES (?, ?, ?)"
);
const sanCarlosMapId = insertMap.run(999, 1, "San Carlos Main").lastInsertRowid;
const riversideMapId = insertMap.run(100, 2, "Riverside Main").lastInsertRowid;

const insertInst = db.prepare(
  "INSERT INTO veritamap_instruments (map_id, instrument_name) VALUES (?, ?)"
);
// San Carlos has 5 instruments under the kept map.
for (const name of ["Cobas c503", "Cobas c702", "Sysmex XN-1000", "Stago Compact Max", "Atellica CH"]) {
  insertInst.run(sanCarlosMapId, name);
}
// Riverside has 3 instruments.
for (const name of ["Roche Cobas 6000", "Stago STA-R Max", "Sysmex CS-2500"]) {
  insertInst.run(riversideMapId, name);
}

// Reproduce the legacy user-scoped query (the bug shape).
function legacyUserScoped(userId) {
  return db
    .prepare(
      `SELECT i.id, i.instrument_name, i.map_id, m.name AS map_name
         FROM veritamap_instruments i
         JOIN veritamap_maps m ON m.id = i.map_id
        WHERE m.user_id = ?
        ORDER BY m.name, i.instrument_name, i.id`
    )
    .all(userId);
}

// Reproduce the new lab-scoped query (the fix shape).
function labScoped(labId) {
  return db
    .prepare(
      `SELECT i.id, i.instrument_name, i.map_id, m.name AS map_name
         FROM veritamap_instruments i
         JOIN veritamap_maps m ON m.id = i.map_id
        WHERE m.lab_id = ?
        ORDER BY m.name, i.instrument_name, i.id`
    )
    .all(labId);
}

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log("PASS  " + name);
  } else {
    fail++;
    console.log("FAIL  " + name + (detail ? " -- " + detail : ""));
  }
}

// 1. Counterfactual reproducing the San Carlos symptom.
{
  const legacy = legacyUserScoped(100);
  check(
    "legacy WHERE m.user_id = 100: San Carlos kept map invisible (5 instruments missed)",
    legacy.every((r) => r.map_name !== "San Carlos Main"),
    `legacy returned ${legacy.length} rows`
  );
  check(
    "legacy WHERE m.user_id = 100: only Riverside's 3 instruments visible (the customer-observed symptom on the wrong lab)",
    legacy.length === 3 && legacy.every((r) => r.map_name === "Riverside Main")
  );
}

// 2. Lab-scoped query returns all 5 San Carlos instruments under Lab 1.
{
  const lab1 = labScoped(1);
  check(
    "lab-scoped Lab 1: returns all 5 San Carlos instruments",
    lab1.length === 5
  );
  check(
    "lab-scoped Lab 1: all rows belong to San Carlos Main",
    lab1.every((r) => r.map_name === "San Carlos Main")
  );
  check(
    "lab-scoped Lab 1: includes Cobas c503",
    lab1.some((r) => r.instrument_name === "Cobas c503")
  );
  check(
    "lab-scoped Lab 1: includes Atellica CH",
    lab1.some((r) => r.instrument_name === "Atellica CH")
  );
}

// 3. Lab-scoped query for Lab 2 returns only Riverside's 3 instruments.
{
  const lab2 = labScoped(2);
  check(
    "lab-scoped Lab 2: returns Riverside's 3 instruments only",
    lab2.length === 3 && lab2.every((r) => r.map_name === "Riverside Main")
  );
}

// 4. Cross-lab isolation: instruments from Lab 1 are not visible via Lab 2 query.
{
  const lab1Names = new Set(labScoped(1).map((r) => r.instrument_name));
  const lab2 = labScoped(2);
  const overlap = lab2.filter((r) => lab1Names.has(r.instrument_name));
  check(
    "cross-lab isolation: zero Lab 1 instruments leak into Lab 2's query",
    overlap.length === 0
  );
}

// 5. Empty-lab case: a lab with no maps returns zero instruments cleanly.
{
  db.prepare("INSERT INTO labs (id) VALUES (3)").run();
  const lab3 = labScoped(3);
  check(
    "lab-scoped query for a lab with no maps returns []",
    Array.isArray(lab3) && lab3.length === 0
  );
}

// 6. Sanity: legacy query for the actual map owner (user 999) finds the
// San Carlos instruments (just the wrong user-id to use for routing).
{
  const legacyByOwner = legacyUserScoped(999);
  check(
    "legacy WHERE m.user_id = 999 returns San Carlos's 5 instruments (proving the data is there, just misrouted)",
    legacyByOwner.length === 5 && legacyByOwner.every((r) => r.map_name === "San Carlos Main")
  );
}

// 7. Customer-reported delete-then-vanish shape: simulate the second map
//    being deleted (and its instruments cascading), confirm the kept map's
//    instruments stay visible via the lab-scoped query and stay invisible
//    via the legacy user-scoped one for user 100.
{
  const secondId = insertMap.run(999, 1, "San Carlos Secondary (small)").lastInsertRowid;
  insertInst.run(secondId, "Old Backup Analyzer");
  insertInst.run(secondId, "Decommissioned XR");
  // Simulate the actual DELETE cascade from server/routes.ts line 6694:
  db.prepare("DELETE FROM veritamap_instruments WHERE map_id = ?").run(secondId);
  db.prepare("DELETE FROM veritamap_maps WHERE id = ?").run(secondId);

  const legacyAfter = legacyUserScoped(100);
  const labAfter = labScoped(1);
  check(
    "post-delete: legacy WHERE m.user_id = 100 still misses kept San Carlos map (5 instruments invisible)",
    legacyAfter.filter((r) => r.map_name === "San Carlos Main").length === 0
  );
  check(
    "post-delete: lab-scoped WHERE m.lab_id = 1 returns the kept San Carlos map's 5 instruments",
    labAfter.length === 5 && labAfter.every((r) => r.map_name === "San Carlos Main")
  );
  check(
    "post-delete: deleted small map's instruments are gone from both queries",
    !legacyAfter.some((r) => r.instrument_name === "Old Backup Analyzer") &&
      !labAfter.some((r) => r.instrument_name === "Old Backup Analyzer")
  );
}

console.log("");
console.log(`SUMMARY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
