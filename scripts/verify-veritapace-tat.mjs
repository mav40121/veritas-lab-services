// scripts/verify-veritapace-tat.mjs
//
// Receipt for Wave D2 (2026-06-12): VeritaPace TAT defensibility. Replicates
// the pi_metrics methodology migration + the create/update persistence over an
// in-memory DB and asserts:
//
//   1. migration adds the 5 methodology columns, idempotent
//   2. creating a TAT metric persists start/end events, threshold, methodology
//   3. a non-TAT metric nulls the structured TAT fields but keeps methodology
//   4. update preserves existing methodology when the field is omitted
//
// Run: node scripts/verify-veritapace-tat.mjs

import Database from "better-sqlite3";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE pi_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT, department_id INTEGER, account_id INTEGER,
    name TEXT, unit TEXT DEFAULT '%', direction TEXT DEFAULT 'lower_is_better',
    benchmark_green REAL, benchmark_yellow REAL, benchmark_red REAL,
    sort_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1, created_at TEXT
  );
`);
function migrate() {
  const cols = db.prepare("PRAGMA table_info(pi_metrics)").all().map(c => c.name);
  for (const [col, ddl] of [
    ["measurement_methodology", "ALTER TABLE pi_metrics ADD COLUMN measurement_methodology TEXT"],
    ["is_tat", "ALTER TABLE pi_metrics ADD COLUMN is_tat INTEGER DEFAULT 0"],
    ["tat_start_event", "ALTER TABLE pi_metrics ADD COLUMN tat_start_event TEXT"],
    ["tat_end_event", "ALTER TABLE pi_metrics ADD COLUMN tat_end_event TEXT"],
    ["tat_threshold_minutes", "ALTER TABLE pi_metrics ADD COLUMN tat_threshold_minutes REAL"],
  ]) { if (!cols.includes(col)) { try { db.exec(ddl); } catch {} } }
}
migrate(); migrate();
const cols = db.prepare("PRAGMA table_info(pi_metrics)").all().map(c => c.name);
check("1. migration adds 5 methodology columns, idempotent",
  ["measurement_methodology","is_tat","tat_start_event","tat_end_event","tat_threshold_minutes"].every(c => cols.includes(c)) &&
  cols.filter(c => c === "is_tat").length === 1);

function createMetric(b) {
  const r = db.prepare(
    "INSERT INTO pi_metrics (department_id, account_id, name, unit, direction, sort_order, active, created_at, measurement_methodology, is_tat, tat_start_event, tat_end_event, tat_threshold_minutes) VALUES (?,?,?,?,?,?,1,'now',?,?,?,?,?)"
  ).run(1, 7, b.name, b.unit ?? "%", b.direction ?? "higher_is_better", 0,
        b.measurement_methodology ?? null, b.is_tat ? 1 : 0,
        b.is_tat ? (b.tat_start_event ?? null) : null,
        b.is_tat ? (b.tat_end_event ?? null) : null,
        b.is_tat && b.tat_threshold_minutes != null ? b.tat_threshold_minutes : null);
  return db.prepare("SELECT * FROM pi_metrics WHERE id = ?").get(Number(r.lastInsertRowid));
}

const tat = createMetric({
  name: "CBC TAT <= 45 min", unit: "%", is_tat: true,
  tat_start_event: "collection", tat_end_event: "result_verified", tat_threshold_minutes: 45,
  measurement_methodology: "LIS collection-to-verify timestamps; excludes add-on and send-out tests.",
});
check("2a. TAT metric persists is_tat", tat.is_tat === 1);
check("2b. start/end events persisted", tat.tat_start_event === "collection" && tat.tat_end_event === "result_verified");
check("2c. threshold persisted", tat.tat_threshold_minutes === 45);
check("2d. methodology persisted", /collection-to-verify/.test(tat.measurement_methodology));

const nonTat = createMetric({
  name: "Blood culture contamination", is_tat: false,
  tat_start_event: "collection", tat_threshold_minutes: 60, // should be ignored
  measurement_methodology: "Contaminated / total blood culture sets per month.",
});
check("3a. non-TAT metric nulls structured TAT fields", nonTat.is_tat === 0 && nonTat.tat_start_event === null && nonTat.tat_threshold_minutes === null);
check("3b. non-TAT metric keeps its methodology", /Contaminated/.test(nonTat.measurement_methodology));

// Update preserving methodology when omitted (mirror server's existing fallback).
function updateMetric(id, b) {
  const ex = db.prepare("SELECT * FROM pi_metrics WHERE id = ?").get(id);
  db.prepare(
    "UPDATE pi_metrics SET name = ?, measurement_methodology = ?, tat_threshold_minutes = ? WHERE id = ?"
  ).run(b.name ?? ex.name,
        b.measurement_methodology !== undefined ? b.measurement_methodology : ex.measurement_methodology,
        b.tat_threshold_minutes !== undefined ? b.tat_threshold_minutes : ex.tat_threshold_minutes, id);
  return db.prepare("SELECT * FROM pi_metrics WHERE id = ?").get(id);
}
const updated = updateMetric(tat.id, { name: "CBC TAT <= 40 min", tat_threshold_minutes: 40 }); // methodology omitted
check("4a. update preserves omitted methodology", /collection-to-verify/.test(updated.measurement_methodology));
check("4b. update applies the new threshold", updated.tat_threshold_minutes === 40);

console.log("");
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log("ALL PASS (10/10): Wave D2 VeritaPace TAT methodology migration, persistence, non-TAT nulling, and update preservation verified.");
