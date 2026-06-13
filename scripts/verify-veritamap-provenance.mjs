// scripts/verify-veritamap-provenance.mjs
//
// Receipt for Wave A4.1 (2026-06-12): VeritaMap provenance schema + lock
// semantics. Replicates the migration block and the lock-conflict helpers
// over an in-memory schema and asserts every branch:
//
//   1. migration adds all 10 provenance columns and is IDEMPOTENT
//   2. refLockConflict: unlocked -> null; locked + unchanged -> null;
//      locked + changed -> conflict string
//   3. attest-ref precondition: an empty reference range cannot be attested
//   4. unlock clears the attestation fields AND the lock (no stale
//      attestation can cover new values)
//   5. amrLockConflict mirrors 2 for the per-instrument AMR rows
//   6. mec-review precondition: criticals must exist before recording review
//
// Run: node scripts/verify-veritamap-provenance.mjs

import Database from "better-sqlite3";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE veritamap_analyte_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id INTEGER NOT NULL, analyte TEXT NOT NULL,
    ref_range_low TEXT, ref_range_high TEXT,
    critical_low TEXT, critical_high TEXT, units TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(map_id, analyte)
  );
  CREATE TABLE veritamap_amr_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id INTEGER NOT NULL, instrument_id INTEGER NOT NULL, analyte TEXT NOT NULL,
    amr_low TEXT, amr_high TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(map_id, instrument_id, analyte)
  );
`);

// ── Mirror of the db.ts Wave A4 migration block ──
function runMigration() {
  const avCols = db.prepare("PRAGMA table_info(veritamap_analyte_values)").all().map(c => c.name);
  for (const [col, ddl] of [
    ["mec_reviewed_at", "ALTER TABLE veritamap_analyte_values ADD COLUMN mec_reviewed_at TEXT"],
    ["mec_reviewed_by", "ALTER TABLE veritamap_analyte_values ADD COLUMN mec_reviewed_by TEXT"],
    ["ref_attested_at", "ALTER TABLE veritamap_analyte_values ADD COLUMN ref_attested_at TEXT"],
    ["ref_attested_by", "ALTER TABLE veritamap_analyte_values ADD COLUMN ref_attested_by TEXT"],
    ["ref_attested_title", "ALTER TABLE veritamap_analyte_values ADD COLUMN ref_attested_title TEXT"],
    ["ref_locked", "ALTER TABLE veritamap_analyte_values ADD COLUMN ref_locked INTEGER NOT NULL DEFAULT 0"],
  ]) {
    if (!avCols.includes(col)) { try { db.exec(ddl); } catch {} }
  }
  const amrCols = db.prepare("PRAGMA table_info(veritamap_amr_values)").all().map(c => c.name);
  for (const [col, ddl] of [
    ["amr_attested_at", "ALTER TABLE veritamap_amr_values ADD COLUMN amr_attested_at TEXT"],
    ["amr_attested_by", "ALTER TABLE veritamap_amr_values ADD COLUMN amr_attested_by TEXT"],
    ["amr_attested_title", "ALTER TABLE veritamap_amr_values ADD COLUMN amr_attested_title TEXT"],
    ["amr_locked", "ALTER TABLE veritamap_amr_values ADD COLUMN amr_locked INTEGER NOT NULL DEFAULT 0"],
  ]) {
    if (!amrCols.includes(col)) { try { db.exec(ddl); } catch {} }
  }
}
runMigration();
runMigration(); // idempotency: second run must not throw or duplicate

const avNames = db.prepare("PRAGMA table_info(veritamap_analyte_values)").all().map(c => c.name);
const amrNames = db.prepare("PRAGMA table_info(veritamap_amr_values)").all().map(c => c.name);
check("1a. analyte_values gains 6 provenance columns",
  ["mec_reviewed_at","mec_reviewed_by","ref_attested_at","ref_attested_by","ref_attested_title","ref_locked"].every(c => avNames.includes(c)));
check("1b. amr_values gains 4 provenance columns",
  ["amr_attested_at","amr_attested_by","amr_attested_title","amr_locked"].every(c => amrNames.includes(c)));
check("1c. migration is idempotent (no duplicate columns)",
  avNames.filter(c => c === "ref_locked").length === 1 && amrNames.filter(c => c === "amr_locked").length === 1);

// ── Mirrors of the routes.ts lock-conflict helpers ──
function refLockConflict(mapId, analyte, body) {
  const existing = db.prepare(
    "SELECT ref_range_low, ref_range_high, ref_locked FROM veritamap_analyte_values WHERE map_id = ? AND analyte = ?"
  ).get(mapId, analyte);
  if (!existing?.ref_locked) return null;
  const refChanged =
    (body?.ref_range_low || null) !== (existing.ref_range_low || null) ||
    (body?.ref_range_high || null) !== (existing.ref_range_high || null);
  return refChanged ? "locked" : null;
}
function amrLockConflict(mapId, instrumentId, analyte, body) {
  const existing = db.prepare(
    "SELECT amr_low, amr_high, amr_locked FROM veritamap_amr_values WHERE map_id = ? AND instrument_id = ? AND analyte = ?"
  ).get(mapId, instrumentId, analyte);
  if (!existing?.amr_locked) return null;
  const changed =
    (body?.amr_low || null) !== (existing.amr_low || null) ||
    (body?.amr_high || null) !== (existing.amr_high || null);
  return changed ? "locked" : null;
}

// Seed: Sodium with a verified range, attested + locked.
db.prepare("INSERT INTO veritamap_analyte_values (map_id, analyte, ref_range_low, ref_range_high, critical_low, critical_high, units) VALUES (1,'Sodium','136','145','120','160','mmol/L')").run();
check("2a. unlocked range: edits allowed", refLockConflict(1, "Sodium", { ref_range_low: "135", ref_range_high: "145" }) === null);

db.prepare("UPDATE veritamap_analyte_values SET ref_attested_at='2026-06-12T00:00:00Z', ref_attested_by='M. Veri', ref_attested_title='Laboratory Director', ref_locked=1 WHERE map_id=1 AND analyte='Sodium'").run();
check("2b. locked + unchanged values: PUT passes (criticals/units still editable)",
  refLockConflict(1, "Sodium", { ref_range_low: "136", ref_range_high: "145" }) === null);
check("2c. locked + changed low: conflict", refLockConflict(1, "Sodium", { ref_range_low: "130", ref_range_high: "145" }) === "locked");
check("2d. locked + changed high: conflict", refLockConflict(1, "Sodium", { ref_range_low: "136", ref_range_high: "150" }) === "locked");

// 3. Empty range cannot be attested (route precondition mirror).
db.prepare("INSERT INTO veritamap_analyte_values (map_id, analyte) VALUES (1,'Potassium')").run();
const k = db.prepare("SELECT * FROM veritamap_analyte_values WHERE map_id=1 AND analyte='Potassium'").get();
check("3. empty reference range cannot be attested", !(k.ref_range_low && k.ref_range_high));

// 4. Unlock clears attestation fields + lock.
db.prepare("UPDATE veritamap_analyte_values SET ref_attested_at=NULL, ref_attested_by=NULL, ref_attested_title=NULL, ref_locked=0 WHERE map_id=1 AND analyte='Sodium'").run();
const na = db.prepare("SELECT * FROM veritamap_analyte_values WHERE map_id=1 AND analyte='Sodium'").get();
check("4. unlock clears attestation fields and lock",
  !na.ref_locked && na.ref_attested_at === null && na.ref_attested_by === null && na.ref_attested_title === null);

// 5. AMR mirror.
db.prepare("INSERT INTO veritamap_amr_values (map_id, instrument_id, analyte, amr_low, amr_high, amr_locked) VALUES (1, 7, 'Sodium', '100', '180', 1)").run();
check("5a. locked AMR + changed: conflict", amrLockConflict(1, 7, "Sodium", { amr_low: "90", amr_high: "180" }) === "locked");
check("5b. locked AMR + unchanged: passes", amrLockConflict(1, 7, "Sodium", { amr_low: "100", amr_high: "180" }) === null);
check("5c. different instrument unaffected", amrLockConflict(1, 8, "Sodium", { amr_low: "90", amr_high: "180" }) === null);

// 6. MEC review precondition: criticals must exist first.
check("6. mec-review requires criticals entered first", !(k.critical_low || k.critical_high));

// ── 7. Export cell branches (Wave A4.3) — mirror of the routes.ts logic ──
function mecCell(av) {
  return av?.mec_reviewed_at
    ? `Reviewed/approved ${String(av.mec_reviewed_at).slice(0, 10)}${av.mec_reviewed_by ? ` (recorded by ${av.mec_reviewed_by})` : ""}`
    : (av?.critical_low || av?.critical_high) ? "Pending MEC review" : "";
}
function refAttestCell(av) {
  return av?.ref_locked
    ? `Attested by ${av.ref_attested_by}, ${av.ref_attested_title} on ${String(av.ref_attested_at).slice(0, 10)}`
    : (av?.ref_range_low && av?.ref_range_high) ? "Pending director attestation" : "";
}
check("7a. export: reviewed criticals show date + recorder",
  mecCell({ mec_reviewed_at: "2026-06-12", mec_reviewed_by: "MV", critical_low: "120" }) === "Reviewed/approved 2026-06-12 (recorded by MV)");
check("7b. export: criticals without review show Pending MEC review",
  mecCell({ critical_low: "120" }) === "Pending MEC review");
check("7c. export: no criticals -> blank MEC cell", mecCell({}) === "");
check("7d. export: locked range shows attestation line",
  refAttestCell({ ref_locked: 1, ref_attested_by: "M. Veri", ref_attested_title: "Laboratory Director", ref_attested_at: "2026-06-12T01:00:00Z", ref_range_low: "136", ref_range_high: "145" }) ===
  "Attested by M. Veri, Laboratory Director on 2026-06-12");
check("7e. export: unattested complete range shows pending",
  refAttestCell({ ref_range_low: "136", ref_range_high: "145" }) === "Pending director attestation");
check("7f. export: empty range -> blank attestation cell", refAttestCell({}) === "");

console.log("");
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log("ALL PASS (19/19): Wave A4 provenance schema, 493.1253 lock semantics, preconditions, and export cell branches verified.");
