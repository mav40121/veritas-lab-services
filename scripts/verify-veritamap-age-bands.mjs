// scripts/verify-veritamap-age-bands.mjs
//
// Receipt for the veritamap_analyte_values age/sex band rebuild (PR 1 of the
// San Carlos reference-range + critical-value load).
//
// The table was UNIQUE(map_id, analyte): one row per analyte, so an age-specific
// value (San Carlos creatinine: peds 0-18y crit >0.99 vs adult 18+) could not be
// stored without flattening it onto the adult row. SQLite cannot ALTER a UNIQUE
// constraint, so db.ts does a create-copy-drop-rename rebuild. This script mirrors
// that exact SQL against a throwaway DB and proves:
//
//   1. Every pre-existing row survives and becomes the "All ages" / any-sex band.
//   2. Provenance (mec_reviewed_*, ref_attested_*, ref_locked) survives. Losing it
//      would silently destroy director attestations under 42 CFR 493.1253.
//   3. Row ids are preserved.
//   4. Multiple bands per analyte are now possible (the whole point).
//   5. A genuinely duplicate band is still rejected.
//   6. Two "All ages" rows for one analyte are rejected. This is the reason
//      age_max_days is NOT NULL with a sentinel: SQLite treats NULLs as DISTINCT
//      inside a UNIQUE index, so a nullable upper bound would let duplicates
//      coexist and silently defeat the constraint.
//   7. The migration guard is idempotent (a second boot is a no-op).
//
// Run: node scripts/verify-veritamap-age-bands.mjs

import Database from "better-sqlite3";

const UNBOUNDED = 999999;
const DAYS_18Y = 6570;

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const db = new Database(":memory:");

// ---- 1. Build the OLD schema exactly as it existed in production ----
db.exec(`
  CREATE TABLE veritamap_analyte_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id INTEGER NOT NULL,
    analyte TEXT NOT NULL,
    ref_range_low TEXT,
    ref_range_high TEXT,
    critical_low TEXT,
    critical_high TEXT,
    units TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(map_id, analyte)
  );
`);
for (const ddl of [
  "ALTER TABLE veritamap_analyte_values ADD COLUMN mec_reviewed_at TEXT",
  "ALTER TABLE veritamap_analyte_values ADD COLUMN mec_reviewed_by TEXT",
  "ALTER TABLE veritamap_analyte_values ADD COLUMN ref_attested_at TEXT",
  "ALTER TABLE veritamap_analyte_values ADD COLUMN ref_attested_by TEXT",
  "ALTER TABLE veritamap_analyte_values ADD COLUMN ref_attested_title TEXT",
  "ALTER TABLE veritamap_analyte_values ADD COLUMN ref_locked INTEGER NOT NULL DEFAULT 0",
]) db.exec(ddl);

// Seed: a plain row, a fully-attested row, and a row on a different map.
db.prepare(`INSERT INTO veritamap_analyte_values
  (map_id, analyte, ref_range_low, ref_range_high, critical_low, critical_high, units, updated_at)
  VALUES (48, 'Sodium', '136', '145', '120', '160', 'mmol/L', '2026-07-01')`).run();
db.prepare(`INSERT INTO veritamap_analyte_values
  (map_id, analyte, ref_range_low, ref_range_high, critical_low, critical_high, units, updated_at,
   mec_reviewed_at, mec_reviewed_by, ref_attested_at, ref_attested_by, ref_attested_title, ref_locked)
  VALUES (48, 'Hemoglobin', '12.0', '18.0', '6.5', '20.0', 'g/dL', '2026-07-01',
          '2026-06-17', 'MEC', '2026-07-01', 'Dr. Gilles', 'Medical Director', 1)`).run();
db.prepare(`INSERT INTO veritamap_analyte_values
  (map_id, analyte, ref_range_low, ref_range_high, units, updated_at)
  VALUES (72, 'Glucose', '70', '99', 'mg/dL', '2026-07-01')`).run();

const beforeRows = db.prepare("SELECT * FROM veritamap_analyte_values ORDER BY id").all();
const beforeCount = beforeRows.length;

// ---- 2. Run the migration (same SQL shape as server/db.ts) ----
function runMigration() {
  const avCols = db.prepare("PRAGMA table_info(veritamap_analyte_values)").all().map((c) => c.name);
  if (!(avCols.length > 0 && !avCols.includes("age_min_days"))) return false; // guard
  const rebuild = db.transaction(() => {
    db.exec("DROP TABLE IF EXISTS veritamap_analyte_values_rebuild");
    db.exec(`
      CREATE TABLE veritamap_analyte_values_rebuild (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        map_id INTEGER NOT NULL,
        analyte TEXT NOT NULL,
        age_min_days INTEGER NOT NULL DEFAULT 0,
        age_max_days INTEGER NOT NULL DEFAULT 999999,
        sex TEXT NOT NULL DEFAULT 'A',
        band_label TEXT,
        ref_range_low TEXT,
        ref_range_high TEXT,
        critical_low TEXT,
        critical_high TEXT,
        units TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        mec_reviewed_at TEXT,
        mec_reviewed_by TEXT,
        ref_attested_at TEXT,
        ref_attested_by TEXT,
        ref_attested_title TEXT,
        ref_locked INTEGER NOT NULL DEFAULT 0,
        UNIQUE(map_id, analyte, age_min_days, age_max_days, sex)
      )
    `);
    db.exec(`
      INSERT INTO veritamap_analyte_values_rebuild
        (id, map_id, analyte, age_min_days, age_max_days, sex, band_label,
         ref_range_low, ref_range_high, critical_low, critical_high, units, updated_at,
         mec_reviewed_at, mec_reviewed_by, ref_attested_at, ref_attested_by, ref_attested_title, ref_locked)
      SELECT
         id, map_id, analyte, 0, 999999, 'A', 'All ages',
         ref_range_low, ref_range_high, critical_low, critical_high, units, updated_at,
         mec_reviewed_at, mec_reviewed_by, ref_attested_at, ref_attested_by, ref_attested_title, ref_locked
      FROM veritamap_analyte_values
    `);
    db.exec("DROP TABLE veritamap_analyte_values");
    db.exec("ALTER TABLE veritamap_analyte_values_rebuild RENAME TO veritamap_analyte_values");
  });
  rebuild();
  return true;
}

console.log("\nCase 1: migration preserves every existing row as the All-ages band");
const ran = runMigration();
check("migration executed on an un-migrated table", ran === true);
const afterRows = db.prepare("SELECT * FROM veritamap_analyte_values ORDER BY id").all();
check(`row count preserved (${beforeCount})`, afterRows.length === beforeCount, `got ${afterRows.length}`);
check("all rows defaulted to age_min_days=0", afterRows.every((r) => r.age_min_days === 0));
check(`all rows defaulted to age_max_days=${UNBOUNDED}`, afterRows.every((r) => r.age_max_days === UNBOUNDED));
check("all rows defaulted to sex='A'", afterRows.every((r) => r.sex === "A"));
check("all rows labelled 'All ages'", afterRows.every((r) => r.band_label === "All ages"));
check("row ids preserved", afterRows.map((r) => r.id).join(",") === beforeRows.map((r) => r.id).join(","));
check("clinical values preserved (Sodium 136-145, crit 120/160)", (() => {
  const na = afterRows.find((r) => r.analyte === "Sodium");
  return na.ref_range_low === "136" && na.ref_range_high === "145" && na.critical_low === "120" && na.critical_high === "160" && na.units === "mmol/L";
})());

console.log("\nCase 2: provenance survives the rebuild (493.1253 attestations)");
const hgb = afterRows.find((r) => r.analyte === "Hemoglobin");
check("mec_reviewed_at preserved", hgb.mec_reviewed_at === "2026-06-17", `got ${hgb.mec_reviewed_at}`);
check("mec_reviewed_by preserved", hgb.mec_reviewed_by === "MEC");
check("ref_attested_by preserved", hgb.ref_attested_by === "Dr. Gilles");
check("ref_attested_title preserved", hgb.ref_attested_title === "Medical Director");
check("ref_locked preserved", hgb.ref_locked === 1);

console.log("\nCase 3: multiple age bands per analyte are now possible");
const insertBand = db.prepare(`INSERT INTO veritamap_analyte_values
  (map_id, analyte, age_min_days, age_max_days, sex, band_label, ref_range_low, ref_range_high, critical_high, units, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-07-16')`);
let pedsOk = true;
try {
  // San Carlos creatinine: peds 0-18y ref 0.2-0.9 crit >0.99; adult 18+ ref 0.6-1.2
  insertBand.run(48, "Creatinine", 0, DAYS_18Y, "A", "0-18 y", "0.2", "0.9", "0.99", "mg/dL");
  insertBand.run(48, "Creatinine", DAYS_18Y, UNBOUNDED, "A", "18 y and older", "0.6", "1.2", null, "mg/dL");
} catch (e) { pedsOk = false; console.log("    insert error:", e.message); }
check("peds + adult creatinine bands both inserted", pedsOk);
const creat = db.prepare("SELECT * FROM veritamap_analyte_values WHERE map_id=48 AND analyte='Creatinine' ORDER BY age_min_days").all();
check("two distinct creatinine bands stored", creat.length === 2, `got ${creat.length}`);
check("peds band keeps its own critical (0.99)", creat[0]?.critical_high === "0.99");
check("adult band has no critical", creat[1]?.critical_high === null);

console.log("\nCase 4: sex-split bands are possible and distinct from each other");
let sexOk = true;
try {
  insertBand.run(48, "Ferritin", 0, UNBOUNDED, "F", "Female", "11", "307", null, "ng/mL");
  insertBand.run(48, "Ferritin", 0, UNBOUNDED, "M", "Male", "24", "336", null, "ng/mL");
} catch (e) { sexOk = false; console.log("    insert error:", e.message); }
check("F and M ferritin bands both inserted", sexOk);
check("two ferritin bands stored", db.prepare("SELECT COUNT(*) n FROM veritamap_analyte_values WHERE analyte='Ferritin'").get().n === 2);

console.log("\nCase 5: a genuinely duplicate band is still rejected");
let dupBlocked = false;
try {
  insertBand.run(48, "Creatinine", 0, DAYS_18Y, "A", "dup", "9", "9", null, "mg/dL");
} catch (e) { dupBlocked = /UNIQUE/i.test(e.message); }
check("exact duplicate (map+analyte+age+sex) rejected", dupBlocked);

console.log("\nCase 6: two 'All ages' rows for one analyte are rejected (NULL-distinct trap)");
// If age_max_days were nullable and set to NULL for 'unbounded', SQLite would treat
// the two NULLs as DISTINCT and BOTH rows would insert, silently defeating the key.
let allAgesDupBlocked = false;
try {
  insertBand.run(48, "Sodium", 0, UNBOUNDED, "A", "second all-ages", "1", "2", null, "mmol/L");
} catch (e) { allAgesDupBlocked = /UNIQUE/i.test(e.message); }
check("second All-ages Sodium row rejected", allAgesDupBlocked);

console.log("\nCase 7: migration guard is idempotent (second boot is a no-op)");
const countBeforeSecond = db.prepare("SELECT COUNT(*) n FROM veritamap_analyte_values").get().n;
const ranAgain = runMigration();
const countAfterSecond = db.prepare("SELECT COUNT(*) n FROM veritamap_analyte_values").get().n;
check("second run skipped by the guard", ranAgain === false);
check("no data lost on second boot", countAfterSecond === countBeforeSecond, `${countBeforeSecond} -> ${countAfterSecond}`);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
