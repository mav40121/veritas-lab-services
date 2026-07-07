// scripts/verify-veritamap-consistency.mjs
//
// Receipt for the VeritaMap consistency guard (server/veritamapConsistency.ts).
// Builds an in-memory DB, proves a clean fleet returns ok:true / 0 issues, then
// injects each divergence class (complexity, specialty, orphan, missing) and
// proves the audit catches them. Also proves rows on deleted maps are ignored.
// Run: node scripts/verify-veritamap-consistency.mjs

import Database from "better-sqlite3";
import { auditVeritamapConsistency } from "../server/veritamapConsistency.ts";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`}`);
  ok ? pass++ : fail++;
};

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE veritamap_maps (id INTEGER PRIMARY KEY, lab_id INTEGER, name TEXT);
    CREATE TABLE veritamap_tests (id INTEGER PRIMARY KEY, map_id INTEGER, analyte TEXT, specialty TEXT, complexity TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE veritamap_instrument_tests (id INTEGER PRIMARY KEY, map_id INTEGER, instrument_id INTEGER, analyte TEXT, specialty TEXT, complexity TEXT, active INTEGER DEFAULT 1);
  `);
  db.prepare("INSERT INTO veritamap_maps VALUES (48,2,'SCAHC')").run();
  // A clean, in-sync map: THC MODERATE on two instruments; ABO HIGH.
  const it = db.prepare("INSERT INTO veritamap_instrument_tests (map_id,instrument_id,analyte,specialty,complexity,active) VALUES (?,?,?,?,?,1)");
  const vt = db.prepare("INSERT INTO veritamap_tests (map_id,analyte,specialty,complexity,active) VALUES (?,?,?,?,1)");
  it.run(48, 306, "Cannabinoids (THC)", "Toxicology", "MODERATE");
  it.run(48, 307, "Cannabinoids (THC)", "Toxicology", "MODERATE");
  it.run(48, 306, "ABO Group", "Immunohematology", "HIGH");
  vt.run(48, "Cannabinoids (THC)", "Toxicology", "MODERATE");
  vt.run(48, "ABO Group", "Immunohematology", "HIGH");
  return db;
}

// 1. Clean fleet -> ok, 0 issues.
let r = auditVeritamapConsistency(freshDb());
check("clean fleet is ok", r.ok, true);
check("clean fleet 0 issues", r.totalIssues, 0);
check("checkedMaps counted", r.checkedMaps, 1);

// 2. Complexity drift (the San Carlos bug) is caught.
let db = freshDb();
db.prepare("UPDATE veritamap_tests SET complexity='WAIVED' WHERE analyte='Cannabinoids (THC)'").run();
r = auditVeritamapConsistency(db);
check("complexity drift caught", r.issues.complexityDrift.length, 1);
check("complexity drift detail", r.issues.complexityDrift[0].detail, "complexity WAIVED should be MODERATE");
check("not ok when drift present", r.ok, false);

// 3. Specialty drift is caught.
db = freshDb();
db.prepare("UPDATE veritamap_tests SET specialty='General Chemistry' WHERE analyte='ABO Group'").run();
check("specialty drift caught", auditVeritamapConsistency(db).issues.specialtyDrift.length, 1);

// 4. Orphan row (veritamap_tests with no backing instrument) is caught.
db = freshDb();
db.prepare("INSERT INTO veritamap_tests (map_id,analyte,specialty,complexity,active) VALUES (48,'Ghost','Toxicology','MODERATE',1)").run();
check("orphan row caught", auditVeritamapConsistency(db).issues.orphans.length, 1);

// 5. Missing analyte (instrument analyte absent from veritamap_tests) is caught.
db = freshDb();
db.prepare("INSERT INTO veritamap_instrument_tests (map_id,instrument_id,analyte,specialty,complexity,active) VALUES (48,306,'Lithium','Toxicology','MODERATE',1)").run();
check("missing analyte caught", auditVeritamapConsistency(db).issues.missing.length, 1);

// 6. Rows on a DELETED map are ignored (not flagged as orphan/missing).
db = freshDb();
db.prepare("INSERT INTO veritamap_instrument_tests (map_id,instrument_id,analyte,specialty,complexity,active) VALUES (999,1,'Zombie','Toxicology','MODERATE',1)").run();
db.prepare("INSERT INTO veritamap_tests (map_id,analyte,specialty,complexity,active) VALUES (999,'Zombie','Toxicology','WAIVED',1)").run();
r = auditVeritamapConsistency(db);
check("deleted-map rows ignored", r.totalIssues, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
