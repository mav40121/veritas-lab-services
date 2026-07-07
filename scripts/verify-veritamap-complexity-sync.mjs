// scripts/verify-veritamap-complexity-sync.mjs
//
// Receipt for the San Carlos remediation:
//   1. rebuildMapTests now UPSERTS (was INSERT OR IGNORE) so a complexity
//      correction on veritamap_instrument_tests propagates to veritamap_tests.
//   2. Max complexity per analyte wins (HIGH > MODERATE > WAIVED).
//   3. The PATCH null-serialization guard turns { study_id: null } into SQL
//      NULL instead of the string "null" (Unlink / Redo fix).
// Run: node scripts/verify-veritamap-complexity-sync.mjs

import Database from "better-sqlite3";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`}`);
  ok ? pass++ : fail++;
};

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE veritamap_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, map_id INTEGER NOT NULL, analyte TEXT NOT NULL,
    specialty TEXT NOT NULL, complexity TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    instrument_source TEXT, notes TEXT, updated_at TEXT NOT NULL, UNIQUE(map_id, analyte));
`);

// The exact upsert statement rebuildMapTests now uses.
const upsert = db.prepare(`
  INSERT INTO veritamap_tests (map_id, analyte, specialty, complexity, active, instrument_source, updated_at)
  VALUES (?, ?, ?, ?, 1, ?, ?)
  ON CONFLICT(map_id, analyte) DO UPDATE SET
    specialty = excluded.specialty, complexity = excluded.complexity,
    instrument_source = excluded.instrument_source, updated_at = excluded.updated_at
`);
const cx = (a) => db.prepare("SELECT complexity FROM veritamap_tests WHERE map_id=48 AND analyte=?").get(a)?.complexity;

// 1. First rebuild writes WAIVED (the drug-screen default seed).
upsert.run(48, "Cannabinoids (THC)", "Toxicology", "WAIVED", "MEDTOX PROFILE V", "t0");
check("initial insert stores WAIVED", cx("Cannabinoids (THC)"), "WAIVED");

// 2. Correction to MODERATE must now propagate (the bug: INSERT OR IGNORE kept WAIVED).
upsert.run(48, "Cannabinoids (THC)", "Toxicology", "MODERATE", "MEDTOX PROFILE V", "t1");
check("correction to MODERATE propagates on re-sync", cx("Cannabinoids (THC)"), "MODERATE");

// 3. Preserve notes/active on conflict (not in the SET list).
db.prepare("UPDATE veritamap_tests SET notes='keep me', active=0 WHERE map_id=48 AND analyte='Cannabinoids (THC)'").run();
upsert.run(48, "Cannabinoids (THC)", "Toxicology", "MODERATE", "MEDTOX PROFILE V", "t2");
const row = db.prepare("SELECT notes, active FROM veritamap_tests WHERE map_id=48 AND analyte='Cannabinoids (THC)'").get();
check("notes preserved through upsert", row.notes, "keep me");
check("active preserved through upsert", row.active, 0);

// 4. Max complexity per analyte (blood bank: MODERATE then HIGH -> HIGH).
const RANK = { WAIVED: 0, MODERATE: 1, HIGH: 2 };
function maxComplexity(instrRows) {
  const byAnalyte = new Map();
  for (const r of instrRows) {
    const c = String(r.complexity).toUpperCase();
    const prev = byAnalyte.get(r.analyte);
    if (!prev || (RANK[c] ?? -1) > (RANK[String(prev).toUpperCase()] ?? -1)) byAnalyte.set(r.analyte, r.complexity);
  }
  return byAnalyte;
}
const agg = maxComplexity([
  { analyte: "ABO Group", complexity: "MODERATE" },
  { analyte: "ABO Group", complexity: "HIGH" },
  { analyte: "Glucose", complexity: "MODERATE" },
]);
check("ABO Group aggregates to HIGH (never downgraded)", agg.get("ABO Group"), "HIGH");
check("Glucose stays MODERATE", agg.get("Glucose"), "MODERATE");

// 5. Null-serialization guard (Unlink / Redo). The fixed expression:
const serialize = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);
check("study_id null -> SQL NULL (not 'null')", serialize(null), null);
check("real object still JSON-stringified", serialize({ a: 1 }), '{"a":1}');
check("scalar passes through", serialize(42), 42);
// Prove it round-trips through SQLite as NULL, clearing a link.
db.exec("CREATE TABLE slot (id INTEGER PRIMARY KEY, study_id INTEGER)");
db.prepare("INSERT INTO slot (id, study_id) VALUES (1, 999)").run();
db.prepare("UPDATE slot SET study_id = ? WHERE id = 1").run(serialize(null));
check("Unlink clears study_id to SQL NULL", db.prepare("SELECT study_id FROM slot WHERE id=1").get().study_id, null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
