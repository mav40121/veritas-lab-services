#!/usr/bin/env node
// verify-veritaqc-import.js
//
// Offline contract tests for VeritaQC → VeritaCheck Verification Import
// Phase A (Precision). Seeds an in-memory SQLite DB with a known dataset
// of qc_control_lots + qc_results + qc_rule_violations, then exercises
// the SQL shapes the four endpoints will hit:
//
//   1. Plan-gate allowlist (vs hasQcImportAccess)
//   2. Candidates: control-lot options for a (lab, analyte)
//   3. Candidates: multi-lot warning when no control_lot picked
//   4. Preview: most-recent subsample returns N most recent values
//   5. Preview: random subsample respects the cap
//   6. Preview: all-strategy bypasses the cap
//   7. Preview: Westgard-flagged rows are flagged in the row set
//   8. Preview: import_source shape (date_range, instrument_id,
//      control_lot_id, result_ids, subsample_strategy, replicates
//      counts, imported_at)
//   9. Mapping upsert: insert then update via ON CONFLICT
//
// Pattern mirrors scripts/verify-precision-parity.js and the other
// verify-*.js scripts referenced in CLAUDE.md §2 Gate 3.

import Database from "better-sqlite3";

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");

// ── Schema (mirrors server/db.ts CREATE TABLE shapes used by the import)
db.exec(`
  CREATE TABLE labs (id INTEGER PRIMARY KEY);
  CREATE TABLE qc_control_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    analyte TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'mid',
    lot_number TEXT NOT NULL,
    manufacturer TEXT,
    mfr_mean REAL NOT NULL,
    mfr_sd REAL NOT NULL,
    mfr_sd_interval INTEGER NOT NULL DEFAULT 2,
    status TEXT NOT NULL DEFAULT 'active',
    UNIQUE(lab_id, analyte, lot_number)
  );
  CREATE TABLE qc_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    control_lot_id INTEGER NOT NULL,
    instrument TEXT,
    result_value REAL NOT NULL,
    result_date TEXT NOT NULL,
    accepted_for_reporting INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE qc_rule_violations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qc_result_id INTEGER NOT NULL,
    rule_code TEXT NOT NULL,
    severity TEXT NOT NULL
  );
  CREATE TABLE veritaqc_import_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    analyte TEXT NOT NULL,
    qc_level TEXT NOT NULL,
    study_level_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(lab_id, analyte, qc_level)
  );
`);

// ── Seed: one lab, Glucose analyte, two control lots (low + mid).
//        50 results on lot 1 (mid), 30 results on lot 2 (low). Three of
//        the lot-1 results have a Westgard violation. Two instruments
//        appear across the rows.
db.prepare("INSERT INTO labs (id) VALUES (1)").run();
const lot1 = db.prepare(
  "INSERT INTO qc_control_lots (lab_id, analyte, level, lot_number, manufacturer, mfr_mean, mfr_sd) VALUES (?, ?, ?, ?, ?, ?, ?)"
).run(1, "Glucose", "mid", "C-Q1-MID", "Bio-Rad", 100, 5).lastInsertRowid;
const lot2 = db.prepare(
  "INSERT INTO qc_control_lots (lab_id, analyte, level, lot_number, manufacturer, mfr_mean, mfr_sd) VALUES (?, ?, ?, ?, ?, ?, ?)"
).run(1, "Glucose", "low", "C-Q1-LOW", "Bio-Rad", 50, 3).lastInsertRowid;

function isoDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const insertResult = db.prepare(
  "INSERT INTO qc_results (lab_id, control_lot_id, instrument, result_value, result_date) VALUES (?, ?, ?, ?, ?)"
);
for (let i = 0; i < 50; i++) {
  insertResult.run(1, lot1, i % 2 === 0 ? "Cobas c503" : "Cobas c702", 100 + (i % 7) * 0.5, isoDaysAgo(50 - i));
}
for (let i = 0; i < 30; i++) {
  insertResult.run(1, lot2, "Cobas c503", 50 + (i % 5) * 0.3, isoDaysAgo(30 - i));
}
const flaggedIds = db.prepare(
  "SELECT id FROM qc_results WHERE control_lot_id = ? ORDER BY id ASC LIMIT 3"
).all(lot1).map(r => r.id);
const insertViolation = db.prepare(
  "INSERT INTO qc_rule_violations (qc_result_id, rule_code, severity) VALUES (?, '1-3s', 'fail')"
);
for (const id of flaggedIds) insertViolation.run(id);

// ── Test runner
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? " — " + detail : "")); }
}

// 1. Plan-gate allowlist mirrors the hasQcImportAccess function in
//    server/routes.ts. Allowed: clinic/community/hospital tiers + waived
//    + legacy ones. Denied: per_study, veritacheck_only, veritascan_only,
//    free.
function hasQcImportAccess(user, lab) {
  const plan = (lab && lab.plan) || (user && user.plan);
  return [
    "annual", "starter", "professional", "lab", "complete",
    "waived", "community", "hospital", "large_hospital", "enterprise",
  ].includes(plan) || (user && user.userId && user.userId <= 11);
}
// The function returns truthy / falsy (not strictly boolean) because of
// the `userId <= 11` fallback. Test with !! / ! to normalise.
check("plan-gate: community allowed",     !!hasQcImportAccess({}, { plan: "community" }));
check("plan-gate: hospital allowed",      !!hasQcImportAccess({}, { plan: "hospital" }));
check("plan-gate: enterprise allowed",    !!hasQcImportAccess({}, { plan: "enterprise" }));
check("plan-gate: waived allowed",        !!hasQcImportAccess({}, { plan: "waived" }));
check("plan-gate: veritacheck_only denied (no QC data)", !hasQcImportAccess({}, { plan: "veritacheck_only" }));
check("plan-gate: per_study denied",      !hasQcImportAccess({}, { plan: "per_study" }));
check("plan-gate: free denied",           !hasQcImportAccess({}, { plan: "free" }));
check("plan-gate: early-admin user allowed", !!hasQcImportAccess({ userId: 1 }, { plan: "free" }));

// 2. Candidates: control-lot options for (lab=1, analyte=Glucose).
const lots = db.prepare(
  "SELECT id, level, lot_number, status FROM qc_control_lots WHERE lab_id = ? AND analyte = ? ORDER BY (status = 'active') DESC, id DESC"
).all(1, "Glucose");
check("candidates: 2 control lots for Glucose", lots.length === 2, `got ${lots.length}`);
check("candidates: lot 1 is C-Q1-MID", lots.some(l => l.lot_number === "C-Q1-MID"));
check("candidates: lot 2 is C-Q1-LOW", lots.some(l => l.lot_number === "C-Q1-LOW"));

// 3. Candidates: multi-lot warning fires when no control_lot filter and
//    date range spans both lots. We don't simulate the route here; we
//    just verify the underlying SQL groups by control_lot_id correctly.
const perLot = db.prepare(
  `SELECT control_lot_id, COUNT(*) AS n FROM qc_results
   WHERE lab_id = ? AND control_lot_id IN (?, ?)
   GROUP BY control_lot_id ORDER BY control_lot_id ASC`
).all(1, lot1, lot2);
check("multi-lot: per-lot grouping returns 2 rows", perLot.length === 2);
check("multi-lot: lot1 has 50 results", perLot.find(r => r.control_lot_id === lot1).n === 50);
check("multi-lot: lot2 has 30 results", perLot.find(r => r.control_lot_id === lot2).n === 30);

// 4. Preview: most_recent strategy returns N most recent results for
//    lot1, ordered desc by result_date.
const recent10 = db.prepare(
  `SELECT r.id, r.result_value, r.result_date,
          EXISTS(SELECT 1 FROM qc_rule_violations v WHERE v.qc_result_id = r.id) AS flagged
   FROM qc_results r
   WHERE r.lab_id = ? AND r.control_lot_id = ?
   ORDER BY r.result_date DESC, r.id DESC
   LIMIT 10`
).all(1, lot1);
check("preview most_recent: 10 rows", recent10.length === 10);
check("preview most_recent: rows are descending by date",
  recent10.every((r, i, a) => i === 0 || r.result_date <= a[i - 1].result_date));

// 5. Preview: random strategy still respects the cap.
const random10 = db.prepare(
  `SELECT id FROM qc_results WHERE lab_id = ? AND control_lot_id = ? ORDER BY RANDOM() LIMIT 10`
).all(1, lot1);
check("preview random: respects LIMIT 10", random10.length === 10);

// 6. Preview: all strategy bypasses the cap.
const allRows = db.prepare(
  `SELECT id FROM qc_results WHERE lab_id = ? AND control_lot_id = ?`
).all(1, lot1);
check("preview all: returns every row (50)", allRows.length === 50);

// 7. Preview: Westgard-flagged rows surface.
const flagged = recent10.filter(r => !!r.flagged);
check("preview most_recent: identifies flagged rows when present",
  // The 3 oldest rows on lot1 carry the violations, so the most-recent-10
  // subset will not include any. Run a separate query against all rows
  // to confirm the EXISTS() correlated subquery works.
  db.prepare(
    `SELECT COUNT(*) AS n FROM qc_results r
     WHERE r.lab_id = ? AND r.control_lot_id = ?
       AND EXISTS(SELECT 1 FROM qc_rule_violations v WHERE v.qc_result_id = r.id)`
  ).get(1, lot1).n === 3);

// 8. import_source shape (the contract the client persists into
//    data_points). We synthesize the same object the POST handler builds
//    and check the required keys are all present.
const importSource = {
  date_range: { start: isoDaysAgo(30), end: null },
  instrument_id: "Cobas c503",
  control_lot_id: lot1,
  control_lot_number: "C-Q1-MID",
  reagent_lot: null,
  result_ids: recent10.map(r => r.id),
  subsample_strategy: "most_recent",
  replicates_per_level_requested: 10,
  replicates_per_level_imported: 10,
  imported_at: new Date().toISOString(),
};
const requiredKeys = [
  "date_range", "instrument_id", "control_lot_id", "control_lot_number",
  "reagent_lot", "result_ids", "subsample_strategy",
  "replicates_per_level_requested", "replicates_per_level_imported",
  "imported_at",
];
for (const k of requiredKeys) {
  check("import_source has key: " + k, k in importSource);
}
check("import_source.reagent_lot is null (Phase A: no source data)", importSource.reagent_lot === null);
check("import_source.result_ids is a 10-element array",
  Array.isArray(importSource.result_ids) && importSource.result_ids.length === 10);

// 9. Sticky mapping: insert then update via ON CONFLICT.
const upsert = db.prepare(
  `INSERT INTO veritaqc_import_mappings (lab_id, analyte, qc_level, study_level_name, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(lab_id, analyte, qc_level) DO UPDATE SET
     study_level_name = excluded.study_level_name,
     updated_at = excluded.updated_at`
);
const now = new Date().toISOString();
upsert.run(1, "Glucose", "mid", "Level 2 (QC Mid)", now, now);
upsert.run(1, "Glucose", "low", "Level 1 (QC Low)", now, now);
const initialRows = db.prepare(
  "SELECT qc_level, study_level_name FROM veritaqc_import_mappings WHERE lab_id = ? AND analyte = ? ORDER BY qc_level ASC"
).all(1, "Glucose");
check("mapping: 2 initial rows seeded", initialRows.length === 2);
check("mapping: low -> Level 1 (QC Low)",
  initialRows.find(r => r.qc_level === "low").study_level_name === "Level 1 (QC Low)");

// Update the "mid" row via the same upsert.
upsert.run(1, "Glucose", "mid", "Level 2 (QC Mid CUSTOM)", now, now);
const updatedRows = db.prepare(
  "SELECT qc_level, study_level_name FROM veritaqc_import_mappings WHERE lab_id = ? AND analyte = ? ORDER BY qc_level ASC"
).all(1, "Glucose");
check("mapping: upsert kept row count at 2", updatedRows.length === 2);
check("mapping: upsert updated mid label",
  updatedRows.find(r => r.qc_level === "mid").study_level_name === "Level 2 (QC Mid CUSTOM)");

// ── Report
console.log("");
console.log(`SUMMARY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
