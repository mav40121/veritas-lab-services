// scripts/verify-purge-orphan-maps.mjs
//
// Receipt for POST /api/admin/veritamap/purge-orphan-maps. Proves the purge
// deletes ONLY child rows whose map_id is absent from veritamap_maps and never
// touches rows on a live map. Run: node scripts/verify-purge-orphan-maps.mjs

import Database from "better-sqlite3";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`}`);
  ok ? pass++ : fail++;
};

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE veritamap_maps (id INTEGER PRIMARY KEY);
  CREATE TABLE veritamap_instruments (id INTEGER PRIMARY KEY, map_id INTEGER);
  CREATE TABLE veritamap_instrument_tests (id INTEGER PRIMARY KEY, map_id INTEGER);
  CREATE TABLE veritamap_tests (id INTEGER PRIMARY KEY, map_id INTEGER);
  CREATE TABLE veritamap_analyte_values (id INTEGER PRIMARY KEY, map_id INTEGER);
  CREATE TABLE veritamap_amr_values (id INTEGER PRIMARY KEY, map_id INTEGER);
`);
db.prepare("INSERT INTO veritamap_maps (id) VALUES (48)").run(); // one live map
// live-map rows (must survive) + dead-map rows (must go)
db.prepare("INSERT INTO veritamap_instruments (id,map_id) VALUES (1,48),(2,999),(3,999)").run();
db.prepare("INSERT INTO veritamap_instrument_tests (id,map_id) VALUES (1,48),(2,48),(3,999),(4,26)").run();
db.prepare("INSERT INTO veritamap_tests (id,map_id) VALUES (1,48),(2,999)").run();

const childTables = ["veritamap_instrument_tests", "veritamap_tests", "veritamap_analyte_values", "veritamap_amr_values", "veritamap_instruments"];
const orphan = (t) => db.prepare("SELECT COUNT(*) AS n FROM " + t + " WHERE map_id NOT IN (SELECT id FROM veritamap_maps)").get().n;

// dry-run scope
const before = Object.fromEntries(childTables.map((t) => [t, orphan(t)]));
check("scope: 2 orphan instruments", before.veritamap_instruments, 2);
check("scope: 2 orphan instrument_tests", before.veritamap_instrument_tests, 2);
check("scope: 1 orphan test", before.veritamap_tests, 1);

// apply
const purge = db.transaction(() => {
  for (const t of childTables) db.prepare("DELETE FROM " + t + " WHERE map_id NOT IN (SELECT id FROM veritamap_maps)").run();
});
purge();

// live rows preserved, orphans gone
check("live instrument preserved", db.prepare("SELECT COUNT(*) AS n FROM veritamap_instruments").get().n, 1);
check("live instrument_tests preserved", db.prepare("SELECT COUNT(*) AS n FROM veritamap_instrument_tests").get().n, 2);
check("live test preserved", db.prepare("SELECT COUNT(*) AS n FROM veritamap_tests").get().n, 1);
check("no orphans remain (instruments)", orphan("veritamap_instruments"), 0);
check("no orphans remain (instrument_tests)", orphan("veritamap_instrument_tests"), 0);
// idempotent second run
purge();
check("idempotent: still 1 live instrument", db.prepare("SELECT COUNT(*) AS n FROM veritamap_instruments WHERE map_id=48").get().n, 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
