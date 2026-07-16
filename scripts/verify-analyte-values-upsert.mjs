// scripts/verify-analyte-values-upsert.mjs
//
// Receipt for the PR-1 regression fix.
//
// WHAT BROKE: PR 1 widened veritamap_analyte_values from UNIQUE(map_id, analyte)
// to UNIQUE(map_id, analyte, age_min_days, age_max_days, sex). Both PUT routes
// still upserted with `ON CONFLICT(map_id, analyte)`. SQLite requires an upsert's
// conflict target to match a REAL unique index, so every reference-range /
// critical-value save returned 500 for every lab.
//
// WHY IT SHIPPED: PR 1's verification proved the DATA survived (801 rows, per-lab
// counts exact) and never exercised a WRITE. Reads were fine; writes were dead.
// Gate 3 step 7 (exercise both branches) and step 5 (bug-class sweep) both cover
// this and both were skipped.
//
// So this script does what that one didn't:
//   1. reproduces the regression (the old conflict target must FAIL) so the test
//      is proven capable of catching it,
//   2. exercises the fixed upsert on BOTH branches (insert AND update),
//   3. structurally checks the shipped source: every INSERT INTO
//      veritamap_analyte_values must name the table's real unique key, and the
//      veritamap_tests upserts must NOT have been over-corrected (different table,
//      key unchanged).
//
// Run: node scripts/verify-analyte-values-upsert.mjs

import Database from "better-sqlite3";
import { readFileSync } from "fs";

const ALL_AGES = { ageMinDays: 0, ageMaxDays: 999999, sex: "A", label: "All ages" };

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

// Post-migration schema, exactly as server/db.ts ships it.
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE veritamap_analyte_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id INTEGER NOT NULL,
    analyte TEXT NOT NULL,
    age_min_days INTEGER NOT NULL DEFAULT 0,
    age_max_days INTEGER NOT NULL DEFAULT 999999,
    sex TEXT NOT NULL DEFAULT 'A',
    band_label TEXT,
    ref_range_low TEXT, ref_range_high TEXT,
    critical_low TEXT, critical_high TEXT,
    units TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    mec_reviewed_at TEXT, mec_reviewed_by TEXT,
    ref_attested_at TEXT, ref_attested_by TEXT, ref_attested_title TEXT,
    ref_locked INTEGER NOT NULL DEFAULT 0,
    UNIQUE(map_id, analyte, age_min_days, age_max_days, sex)
  );
`);

console.log("\nCase 1: the regression reproduces (proves this test can catch it)");
let oldFailed = false, oldErr = "";
try {
  db.prepare(`
    INSERT INTO veritamap_analyte_values (map_id, analyte, ref_range_low, ref_range_high, critical_low, critical_high, units, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(map_id, analyte) DO UPDATE SET ref_range_low = excluded.ref_range_low
  `).run(48, "Sodium", "136", "145", "120", "160", "mmol/L", "2026-07-16");
} catch (e) { oldFailed = true; oldErr = e.message; }
check("the OLD ON CONFLICT(map_id, analyte) is rejected by SQLite", oldFailed, "it succeeded, so this test proves nothing");
check("rejected for the expected reason", /ON CONFLICT clause does not match/i.test(oldErr), oldErr);

// The fixed statement, mirroring both PUT routes.
const upsert = db.prepare(`
  INSERT INTO veritamap_analyte_values
    (map_id, analyte, age_min_days, age_max_days, sex, band_label,
     ref_range_low, ref_range_high, critical_low, critical_high, units, updated_at)
  VALUES (?, ?, ${ALL_AGES.ageMinDays}, ${ALL_AGES.ageMaxDays}, '${ALL_AGES.sex}', '${ALL_AGES.label}', ?, ?, ?, ?, ?, ?)
  ON CONFLICT(map_id, analyte, age_min_days, age_max_days, sex) DO UPDATE SET
    ref_range_low = excluded.ref_range_low,
    ref_range_high = excluded.ref_range_high,
    critical_low = excluded.critical_low,
    critical_high = excluded.critical_high,
    units = excluded.units,
    updated_at = excluded.updated_at
`);
const read = (analyte) => db.prepare(
  "SELECT * FROM veritamap_analyte_values WHERE map_id=? AND analyte=? AND age_min_days=? AND age_max_days=? AND sex=?"
).get(48, analyte, ALL_AGES.ageMinDays, ALL_AGES.ageMaxDays, ALL_AGES.sex);

console.log("\nCase 2: INSERT branch -- saving a range for a new analyte");
let ok = true, err = "";
try { upsert.run(48, "Sodium", "136", "145", "120", "160", "mmol/L", "2026-07-16"); }
catch (e) { ok = false; err = e.message; }
check("upsert succeeds on a new analyte", ok, err);
let row = read("Sodium");
check("values stored", row?.ref_range_low === "136" && row?.ref_range_high === "145" && row?.critical_low === "120" && row?.critical_high === "160" && row?.units === "mmol/L");
check("landed on the All-ages band", row?.age_min_days === 0 && row?.age_max_days === 999999 && row?.sex === "A" && row?.band_label === "All ages");
check("exactly one row", db.prepare("SELECT COUNT(*) n FROM veritamap_analyte_values WHERE analyte='Sodium'").get().n === 1);

console.log("\nCase 3: UPDATE branch -- editing the SAME analyte again (the conflict path)");
ok = true; err = "";
try { upsert.run(48, "Sodium", "135", "146", "119", "161", "mmol/L", "2026-07-17"); }
catch (e) { ok = false; err = e.message; }
check("upsert succeeds on an existing analyte (DO UPDATE fires)", ok, err);
row = read("Sodium");
check("values actually updated (136->135, 145->146)", row?.ref_range_low === "135" && row?.ref_range_high === "146");
check("criticals updated", row?.critical_low === "119" && row?.critical_high === "161");
check("updated_at moved", row?.updated_at === "2026-07-17");
check("STILL exactly one row (updated, not duplicated)", db.prepare("SELECT COUNT(*) n FROM veritamap_analyte_values WHERE analyte='Sodium'").get().n === 1);

console.log("\nCase 4: the All-ages band does not collide with a real age band");
db.prepare(`INSERT INTO veritamap_analyte_values (map_id, analyte, age_min_days, age_max_days, sex, band_label, ref_range_low, ref_range_high, critical_high, units, updated_at)
  VALUES (48,'Creatinine',0,6570,'A','0-18 y','0.2','0.9','0.99','mg/dL','2026-07-16')`).run();
ok = true; err = "";
try { upsert.run(48, "Creatinine", "0.6", "1.2", null, null, "mg/dL", "2026-07-16"); }
catch (e) { ok = false; err = e.message; }
check("PUT can still write the All-ages band alongside a peds band", ok, err);
check("both bands coexist", db.prepare("SELECT COUNT(*) n FROM veritamap_analyte_values WHERE analyte='Creatinine'").get().n === 2);
check("the peds band was NOT overwritten by the PUT",
  db.prepare("SELECT ref_range_low FROM veritamap_analyte_values WHERE analyte='Creatinine' AND age_max_days=6570").get()?.ref_range_low === "0.2");

console.log("\nCase 5: provenance is not clobbered by a later value edit");
db.prepare("UPDATE veritamap_analyte_values SET ref_locked=1, ref_attested_by='Dr. Gilles' WHERE analyte='Sodium'").run();
upsert.run(48, "Sodium", "134", "147", "118", "162", "mmol/L", "2026-07-18");
row = read("Sodium");
check("ref_locked survives the upsert (not in the SET list)", row?.ref_locked === 1);
check("ref_attested_by survives", row?.ref_attested_by === "Dr. Gilles");

console.log("\nCase 6: shipped source -- every analyte_values upsert names the real key");
const src = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
const avInserts = [...src.matchAll(/INSERT INTO\s+veritamap_analyte_values[\s\S]{0,600}?ON CONFLICT\(([^)]*)\)/g)].map((m) => m[1].trim());
check("found the analyte_values upserts in source", avInserts.length >= 2, `found ${avInserts.length}`);
check("ALL of them target the full band key", avInserts.every((t) => t === "map_id, analyte, age_min_days, age_max_days, sex"), JSON.stringify(avInserts));
check("NONE still target the stale (map_id, analyte)", !avInserts.some((t) => t === "map_id, analyte"));

console.log("\nCase 7: veritamap_tests was NOT over-corrected (different table, key unchanged)");
const vtInserts = [...src.matchAll(/INSERT INTO\s+veritamap_tests[\s\S]{0,600}?ON CONFLICT\(([^)]*)\)/g)].map((m) => m[1].trim());
check("found the veritamap_tests upserts", vtInserts.length >= 2, `found ${vtInserts.length}`);
check("they still target (map_id, analyte), which is still their real key", vtInserts.every((t) => t === "map_id, analyte"), JSON.stringify(vtInserts));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
