// verify-veritatrack-map-backfill.mjs — exercises the backfill logic behind
// POST /api/admin/veritatrack/backfill-map-links and the create-path auto-link,
// against an in-memory DB. Confirms:
//   - an unlinked task whose category is map-tracked AND whose analyte is on the
//     lab's map gets linked (Precision -> last_precision, Cal Ver -> last_cal_ver);
//   - a task whose analyte is NOT on the map is left unlinked (no name-drift link);
//   - a task in a non-map category (QC Review) is left unlinked;
//   - already-linked and inactive tasks are never touched;
//   - the analyte parser keeps hyphens inside the analyte name;
//   - the backfill is idempotent (a second run links 0);
//   - after linking, the sign-off write-back (exact analyte match) resolves to
//     exactly one map row — i.e. the sign-off now actually reaches the map.
// Also guards against drift: asserts the four category->field pairs and the
// last_precision write allowlist entry still exist in server/veritatrackMapSync.ts.
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));

let ok = true;
const assert = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + ": " + name); if (!cond) ok = false; };

// ── Drift guard: the inline maps below must match the source of truth ─────────
const src = readFileSync(join(HERE, "..", "server", "veritatrackMapSync.ts"), "utf8");
const CATEGORY_TO_MAP_FIELD = {
  "Calibration Verification": "last_cal_ver",
  "Correlation": "last_method_comp",
  "Correlation / Method Comparison": "last_method_comp",
  "Precision Verification": "last_precision",
  "Policy Review": "last_sop_review",
  "SOP Review": "last_sop_review",
};
for (const [cat, field] of Object.entries(CATEGORY_TO_MAP_FIELD)) {
  assert(`source maps "${cat}" -> ${field}`, src.includes(`"${cat}": "${field}"`));
}
assert("source allowlists last_precision for sign-off write-back", /MAP_SIGNOFF_FIELDS\s*=\s*\[[^\]]*"last_precision"/.test(src));

// Mirror of analyteFromTaskName (split on FIRST " - " so analyte hyphens survive).
function analyteFromTaskName(name) {
  if (!name) return null;
  const idx = name.indexOf(" - ");
  if (idx < 0) return null;
  return name.slice(idx + 3).trim() || null;
}
assert("analyte parser keeps inner hyphens",
  analyteFromTaskName("Precision Verification - 25-hydroxyvitamin D (25-OH-D)") === "25-hydroxyvitamin D (25-OH-D)");
assert("analyte parser returns null with no separator", analyteFromTaskName("Pipette Calibration") === null);

// ── In-memory fixture ─────────────────────────────────────────────────────────
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE veritamap_maps (id INTEGER PRIMARY KEY, lab_id INT, user_id INT);
  CREATE TABLE veritamap_tests (
    id INTEGER PRIMARY KEY, map_id INT, analyte TEXT, active INT DEFAULT 1,
    last_cal_ver TEXT, last_method_comp TEXT, last_precision TEXT, last_sop_review TEXT);
  CREATE TABLE veritatrack_tasks (
    id INTEGER PRIMARY KEY, lab_id INT, name TEXT, category TEXT,
    map_analyte TEXT, map_field TEXT, active INT DEFAULT 1, updated_at TEXT);
`);
// Lab 2, map 48. On the map: Glucose, Albumin, and a hyphenated analyte. NOT on the map: Foobar, AMP.
db.prepare("INSERT INTO veritamap_maps (id,lab_id,user_id) VALUES (48,2,17)").run();
for (const a of ["Glucose", "Albumin", "25-hydroxyvitamin D (25-OH-D)"]) {
  db.prepare("INSERT INTO veritamap_tests (map_id,analyte) VALUES (48,?)").run(a);
}
const T = (id, name, category, ma = null, mf = null, active = 1) =>
  db.prepare("INSERT INTO veritatrack_tasks (id,name,category,lab_id,map_analyte,map_field,active) VALUES (?,?,?,2,?,?,?)")
    .run(id, name, category, ma, mf, active);
T(1, "Precision Verification - Glucose", "Precision Verification");                       // -> last_precision
T(2, "Calibration Verification - Albumin", "Calibration Verification");                   // -> last_cal_ver
T(3, "Precision Verification - Foobar", "Precision Verification");                         // analyte not on map -> skip
T(4, "QC Review - Chemistry", "QC Review");                                               // no map field -> skip
T(5, "Correlation - Glucose", "Correlation", "Glucose", "last_method_comp");              // already linked -> untouched
T(6, "Precision Verification - AMP", "Precision Verification");                            // name drift, not on map -> skip
T(7, "Precision Verification - Glucose", "Precision Verification", null, null, 0);         // inactive -> skip
T(8, "Precision Verification - 25-hydroxyvitamin D (25-OH-D)", "Precision Verification"); // hyphenated -> last_precision

// ── Mirror of the endpoint's backfill logic ──────────────────────────────────
function backfill({ dryRun = false, onlyLab = null } = {}) {
  const rows = db.prepare(
    `SELECT id, lab_id, name, category FROM veritatrack_tasks
      WHERE active = 1 AND (map_analyte IS NULL OR map_analyte = '' OR map_field IS NULL OR map_field = '')`
  ).all();
  const labAnalytes = new Map();
  const analytesForLab = (lid) => {
    if (labAnalytes.has(lid)) return labAnalytes.get(lid);
    const maps = db.prepare("SELECT id FROM veritamap_maps WHERE lab_id = ?").all(lid);
    const set = new Set();
    if (maps.length) {
      const ph = maps.map(() => "?").join(",");
      for (const r of db.prepare(`SELECT DISTINCT analyte FROM veritamap_tests WHERE map_id IN (${ph})`).all(...maps.map(m => m.id)))
        if (r.analyte) set.add(r.analyte);
    }
    labAnalytes.set(lid, set);
    return set;
  };
  const toApply = [];
  let skippedNoField = 0, skippedNoMatch = 0;
  for (const t of rows) {
    if (onlyLab != null && t.lab_id !== onlyLab) continue;
    const field = CATEGORY_TO_MAP_FIELD[t.category];
    if (!field) { skippedNoField++; continue; }
    const analyte = analyteFromTaskName(t.name);
    if (!analyte || t.lab_id == null || !analytesForLab(t.lab_id).has(analyte)) { skippedNoMatch++; continue; }
    toApply.push({ id: t.id, analyte, field });
  }
  if (!dryRun) {
    const upd = db.prepare("UPDATE veritatrack_tasks SET map_analyte=?, map_field=?, updated_at='now' WHERE id=?");
    for (const it of toApply) upd.run(it.analyte, it.field, it.id);
  }
  return { scanned: rows.length, linked: toApply.length, skippedNoField, skippedNoMatch };
}

// dry run must change nothing
const dry = backfill({ dryRun: true });
assert("dryRun links 3 (t1,t2,t8)", dry.linked === 3);
assert("dryRun skips 1 no-field (t4)", dry.skippedNoField === 1);
assert("dryRun skips 2 no-match (t3 Foobar, t6 AMP)", dry.skippedNoMatch === 2);
assert("dryRun wrote nothing (t1 still unlinked)", db.prepare("SELECT map_field FROM veritatrack_tasks WHERE id=1").get().map_field === null);

// live run
const live = backfill();
assert("live links 3", live.linked === 3);
assert("t1 Precision -> last_precision on Glucose", (() => {
  const r = db.prepare("SELECT map_analyte,map_field FROM veritatrack_tasks WHERE id=1").get();
  return r.map_analyte === "Glucose" && r.map_field === "last_precision";
})());
assert("t2 Cal Ver -> last_cal_ver on Albumin", (() => {
  const r = db.prepare("SELECT map_analyte,map_field FROM veritatrack_tasks WHERE id=2").get();
  return r.map_analyte === "Albumin" && r.map_field === "last_cal_ver";
})());
assert("t8 hyphenated analyte linked -> last_precision", (() => {
  const r = db.prepare("SELECT map_analyte,map_field FROM veritatrack_tasks WHERE id=8").get();
  return r.map_analyte === "25-hydroxyvitamin D (25-OH-D)" && r.map_field === "last_precision";
})());
assert("t3 Foobar left unlinked (not on map)", db.prepare("SELECT map_field FROM veritatrack_tasks WHERE id=3").get().map_field === null);
assert("t4 QC Review left unlinked (no map field)", db.prepare("SELECT map_field FROM veritatrack_tasks WHERE id=4").get().map_field === null);
assert("t6 AMP left unlinked (name drift, not on map)", db.prepare("SELECT map_field FROM veritatrack_tasks WHERE id=6").get().map_field === null);
assert("t5 already-linked untouched", (() => {
  const r = db.prepare("SELECT map_analyte,map_field FROM veritatrack_tasks WHERE id=5").get();
  return r.map_analyte === "Glucose" && r.map_field === "last_method_comp";
})());
assert("t7 inactive untouched", db.prepare("SELECT map_field FROM veritatrack_tasks WHERE id=7").get().map_field === null);

// idempotency
const again = backfill();
assert("second run links 0 (idempotent)", again.linked === 0);

// After linking, the sign-off write-back must resolve to exactly one map row.
// This is what actually turns the map green — mirror applyMapSignoffWriteback's
// UPDATE (exact analyte match, no active filter) for t1's now-present link.
function signoffWriteback(taskId, date) {
  const t = db.prepare("SELECT lab_id,map_analyte,map_field FROM veritatrack_tasks WHERE id=?").get(taskId);
  if (!t.map_analyte || !t.map_field) return { linked: false, updated: 0 };
  const maps = db.prepare("SELECT id FROM veritamap_maps WHERE lab_id=?").all(t.lab_id);
  const ph = maps.map(() => "?").join(",");
  const info = db.prepare(`UPDATE veritamap_tests SET ${t.map_field}=? WHERE map_id IN (${ph}) AND analyte=?`)
    .run(date, ...maps.map(m => m.id), t.map_analyte);
  return { linked: true, updated: info.changes };
}
const wb = signoffWriteback(1, "2026-08-22");
assert("sign-off write-back now updates exactly 1 map row", wb.linked && wb.updated === 1);
assert("map Glucose row now shows the precision date", db.prepare("SELECT last_precision FROM veritamap_tests WHERE analyte='Glucose'").get().last_precision === "2026-08-22");

console.log(ok ? "\nALL PASS" : "\nFAILURES PRESENT");
process.exit(ok ? 0 : 1);
