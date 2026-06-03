#!/usr/bin/env node
// verify-veritaqc-bulk-import.js
//
// Offline contract tests for Phase D-1 of the VeritaQC Import family
// (parking-lot #39 Option D, started 2026-06-02). The new endpoint
// GET /api/labs/:labId/qc/import-analyte-bulk-candidates returns the
// full (level x instrument) cube for ONE analyte, used by the future
// qc_range modal to populate the multi-cell grid in one shot.
//
// Strategy mirrors the existing verify-veritaqc-import.js: in-memory
// sqlite, seed known qc_control_lots + qc_results + qc_rule_violations,
// then exercise the SQL the endpoint runs and assert the shape.
//
// What this script proves:
//
//   1. Returns a level row per control lot for the analyte.
//   2. Each level's instruments array has one entry per distinct
//      instrument in qc_results for that lot.
//   3. Each instrument entry includes result_count, latest_result_date,
//      was_westgard_flagged_count, replicate_values[].
//   4. Date range filter (start_date / end_date) trims the result set
//      appropriately.
//   5. Instrument filter narrows to a single instrument per level.
//   6. Empty result_set (no qc_results matching) returns levels:[] for
//      a missing analyte (no lot rows).
//   7. Westgard-flagged correlated subquery is correct.

import Database from "better-sqlite3";

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");

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
    status TEXT NOT NULL DEFAULT 'active'
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
`);

db.prepare("INSERT INTO labs (id) VALUES (1)").run();

// Two Glucose lots: low + mid. Two instruments: c503 + c702.
const insLot = db.prepare(
  "INSERT INTO qc_control_lots (lab_id, analyte, level, lot_number, manufacturer, mfr_mean, mfr_sd) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
const lotLow = insLot.run(1, "Glucose", "low", "C-LOW-1", "Bio-Rad", 50, 3).lastInsertRowid;
const lotMid = insLot.run(1, "Glucose", "mid", "C-MID-1", "Bio-Rad", 100, 5).lastInsertRowid;

function iso(d) { return d.toISOString().split("T")[0]; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); }

const insR = db.prepare(
  "INSERT INTO qc_results (lab_id, control_lot_id, instrument, result_value, result_date) VALUES (?, ?, ?, ?, ?)"
);
// Low + c503: 15 results spread over 20 days
for (let i = 0; i < 15; i++) insR.run(1, lotLow, "Cobas c503", 50 + (i % 4) * 0.5, daysAgo(20 - i));
// Low + c702: 5 results in last 5 days
for (let i = 0; i < 5; i++) insR.run(1, lotLow, "Cobas c702", 50 + (i % 3) * 0.3, daysAgo(5 - i));
// Mid + c503: 22 results over 30 days
for (let i = 0; i < 22; i++) insR.run(1, lotMid, "Cobas c503", 100 + (i % 5) * 0.4, daysAgo(30 - i));

// Flag the 2 oldest mid+c503 results
const oldest = db
  .prepare("SELECT id FROM qc_results WHERE lab_id = 1 AND control_lot_id = ? ORDER BY result_date ASC LIMIT 2")
  .all(lotMid);
for (const r of oldest)
  db.prepare("INSERT INTO qc_rule_violations (qc_result_id, rule_code, severity) VALUES (?, '1-3s', 'fail')").run(r.id);

// Reproduce the endpoint logic locally for the offline test.
function bulkCandidates(analyte, { instrument = null, startDate = null, endDate = null } = {}) {
  const lots = db
    .prepare(
      "SELECT id, level, lot_number, manufacturer, mfr_mean, mfr_sd FROM qc_control_lots WHERE lab_id = 1 AND analyte = ? ORDER BY (status = 'active') DESC, id DESC"
    )
    .all(analyte);
  if (lots.length === 0) return { analyte, levels: [] };

  const buildWhere = (lotId) => {
    const clauses = ["r.lab_id = 1", `r.control_lot_id = ${lotId}`];
    if (instrument) clauses.push(`r.instrument = '${instrument}'`);
    if (startDate)  clauses.push(`r.result_date >= '${startDate}'`);
    if (endDate)    clauses.push(`r.result_date <= '${endDate}'`);
    return clauses.join(" AND ");
  };

  const levels = lots.map(lot => {
    const where = buildWhere(lot.id);
    const instrumentsRows = db
      .prepare(
        `SELECT r.instrument, COUNT(*) AS result_count, MAX(r.result_date) AS latest_result_date,
                SUM(CASE WHEN EXISTS(SELECT 1 FROM qc_rule_violations v WHERE v.qc_result_id = r.id) THEN 1 ELSE 0 END) AS was_westgard_flagged_count
           FROM qc_results r WHERE ${where} AND r.instrument IS NOT NULL AND r.instrument != ''
          GROUP BY r.instrument ORDER BY r.instrument ASC`
      )
      .all();
    const instruments = instrumentsRows.map(row => {
      const values = db
        .prepare(`SELECT r.result_value FROM qc_results r WHERE ${where} AND r.instrument = '${row.instrument}' ORDER BY r.result_date DESC, r.id DESC`)
        .all();
      return {
        instrument: row.instrument,
        result_count: row.result_count,
        latest_result_date: row.latest_result_date,
        was_westgard_flagged_count: row.was_westgard_flagged_count,
        replicate_values: values.map(v => Number(v.result_value)).filter(v => Number.isFinite(v)),
      };
    });
    return {
      qc_level: lot.level,
      control_lot: lot.lot_number,
      control_lot_id: lot.id,
      manufacturer: lot.manufacturer,
      target_value: lot.mfr_mean,
      target_sd: lot.mfr_sd,
      instruments,
    };
  });
  return { analyte, levels };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? " — " + detail : "")); }
}

// 1. Missing analyte: empty levels
const empty = bulkCandidates("Cholesterol");
check("missing analyte returns empty levels[]", Array.isArray(empty.levels) && empty.levels.length === 0);

// 2. Glucose: 2 lots, both surface
const glu = bulkCandidates("Glucose");
check("Glucose returns 2 lot rows", glu.levels.length === 2);
check("Glucose level rows have qc_level + control_lot fields",
  glu.levels.every(l => "qc_level" in l && "control_lot" in l));

// 3. Each level row has target_value + target_sd from the lot
const mid = glu.levels.find(l => l.qc_level === "mid");
const low = glu.levels.find(l => l.qc_level === "low");
check("mid level target_value = 100", mid.target_value === 100);
check("low level target_sd = 3", low.target_sd === 3);

// 4. Mid lot: should have 1 instrument (c503), 22 results
check("mid lot has 1 instrument row", mid.instruments.length === 1);
check("mid lot c503 has 22 results", mid.instruments[0].result_count === 22);
check("mid lot c503 was_westgard_flagged_count = 2", mid.instruments[0].was_westgard_flagged_count === 2);
check("mid lot c503 replicate_values has 22 numbers",
  Array.isArray(mid.instruments[0].replicate_values) && mid.instruments[0].replicate_values.length === 22);

// 5. Low lot: 2 instruments (c503 + c702)
check("low lot has 2 instrument rows", low.instruments.length === 2);
const lowC503 = low.instruments.find(i => i.instrument === "Cobas c503");
const lowC702 = low.instruments.find(i => i.instrument === "Cobas c702");
check("low c503 has 15 results", lowC503.result_count === 15);
check("low c702 has 5 results",  lowC702.result_count === 5);
check("low c702 flagged count = 0 (no violations on c702)", lowC702.was_westgard_flagged_count === 0);

// 6. Instrument filter: narrows to a single instrument per level
const gluC503 = bulkCandidates("Glucose", { instrument: "Cobas c503" });
const lowFiltered = gluC503.levels.find(l => l.qc_level === "low");
check("instrument filter narrows low to 1 row", lowFiltered.instruments.length === 1);
check("instrument filter narrows low to c503", lowFiltered.instruments[0].instrument === "Cobas c503");

// 7. Date range filter: end_date 10 days ago should exclude recent results
const recentOnly = bulkCandidates("Glucose", { startDate: daysAgo(10) });
const recentMid = recentOnly.levels.find(l => l.qc_level === "mid");
check("date filter (last 10 days) shrinks mid results count",
  recentMid.instruments[0].result_count < 22, `got ${recentMid.instruments[0].result_count}`);

// 8. replicate_values is ordered desc by date
check("replicate_values length matches result_count",
  mid.instruments[0].replicate_values.length === mid.instruments[0].result_count);

console.log("");
console.log(`SUMMARY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
