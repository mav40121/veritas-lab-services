// verify-veritamap-study-stamp.mjs — exercises the logic behind
// stampMapDatesFromStudies + POST /api/admin/veritamap/backfill-from-studies
// against an in-memory DB. Confirms a finalized study stamps the matching
// VeritaMap grid date column (cal_ver/linearity -> last_cal_ver,
// method_comparison -> last_method_comp, precision -> last_precision), that the
// stamp is ADVANCE-ONLY (a newer date already on the map is never clobbered), that
// an analyte with no matching study is left blank, that a study for an off-map
// analyte stamps nothing, and that a second run stamps 0 (idempotent).
// NOTE: production cal-ver additionally requires an instrument match
// (studyMatchesInstrument); that path is exercised live. This unit test pins the
// field-mapping + advance-only + idempotency behavior. A source drift guard keeps
// the field mapping in sync with server/veritacheckCoverage.ts.
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
let ok = true;
const assert = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + ": " + name); if (!cond) ok = false; };

// ── Drift guard: field mapping must match the source of truth ────────────────
const src = readFileSync(join(HERE, "..", "server", "veritacheckCoverage.ts"), "utf8");
assert('source: MAP_STUDY_DATE_FIELDS = last_cal_ver/method_comp/precision',
  /MAP_STUDY_DATE_FIELDS\s*=\s*\["last_cal_ver",\s*"last_method_comp",\s*"last_precision"\]/.test(src));
assert('source: LINEARITY_TYPES = cal_ver + linearity', /LINEARITY_TYPES\s*=\s*new Set\(\["cal_ver",\s*"linearity"\]\)/.test(src));
assert('source: method_comparison -> last_method_comp', /put\(mc\.analyte,\s*"last_method_comp"/.test(src));
assert('source: precision -> last_precision', /put\(a,\s*"last_precision"/.test(src));
assert('source: advance-only guard in stamp UPDATE', /SET \$\{field\} = \?[\s\S]*?\$\{field\} < \?/.test(src));

const LINEARITY = new Set(["cal_ver", "linearity"]);
const nameMatch = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// Mirror of the stamp: per analyte, latest matching study date per field, advance-only.
function stamp(db, labId, { dryRun = false } = {}) {
  const mapIds = db.prepare("SELECT id FROM veritamap_maps WHERE lab_id=?").all(labId).map((m) => m.id);
  if (!mapIds.length) return 0;
  const ph = mapIds.map(() => "?").join(",");
  const analytes = [...new Set(db.prepare(`SELECT analyte FROM veritamap_instrument_tests WHERE map_id IN (${ph})`).all(...mapIds).map((c) => c.analyte))];
  const studies = db.prepare("SELECT id,test_name,study_type,date,coverage_analyte FROM studies WHERE lab_id=? AND archived_at IS NULL").all(labId);
  const matches = (s, a) => (s.coverage_analyte && s.coverage_analyte === a) || nameMatch(s.test_name, a);
  const want = {};
  const put = (a, f, d) => { if (!d) return; d = String(d).slice(0, 10); (want[a] ||= {}); if (!want[a][f] || want[a][f] < d) want[a][f] = d; };
  for (const a of analytes) for (const s of studies) {
    if (!matches(s, a)) continue;
    if (LINEARITY.has(s.study_type)) put(a, "last_cal_ver", s.date);
    else if (s.study_type === "method_comparison") put(a, "last_method_comp", s.date);
    else if (s.study_type === "precision") put(a, "last_precision", s.date);
  }
  let stamped = 0;
  for (const [a, fields] of Object.entries(want)) for (const [f, d] of Object.entries(fields)) {
    const n = db.prepare(`SELECT COUNT(*) c FROM veritamap_tests WHERE map_id IN (${ph}) AND analyte=? AND (${f} IS NULL OR ${f}='' OR ${f}<?)`).get(...mapIds, a, d).c;
    if (n > 0) { if (!dryRun) db.prepare(`UPDATE veritamap_tests SET ${f}=? WHERE map_id IN (${ph}) AND analyte=? AND (${f} IS NULL OR ${f}='' OR ${f}<?)`).run(d, ...mapIds, a, d); stamped += n; }
  }
  return stamped;
}

// ── Fixture ──────────────────────────────────────────────────────────────────
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE veritamap_maps (id INTEGER PRIMARY KEY, lab_id INT);
  CREATE TABLE veritamap_instrument_tests (id INTEGER PRIMARY KEY, map_id INT, analyte TEXT);
  CREATE TABLE veritamap_tests (id INTEGER PRIMARY KEY, map_id INT, analyte TEXT,
    last_cal_ver TEXT, last_method_comp TEXT, last_precision TEXT);
  CREATE TABLE studies (id INTEGER PRIMARY KEY, lab_id INT, test_name TEXT, study_type TEXT,
    date TEXT, coverage_analyte TEXT, archived_at TEXT);
`);
db.prepare("INSERT INTO veritamap_maps (id,lab_id) VALUES (1,5)").run();
for (const a of ["Glucose", "Potassium"]) {
  db.prepare("INSERT INTO veritamap_instrument_tests (map_id,analyte) VALUES (1,?)").run(a);
  db.prepare("INSERT INTO veritamap_tests (map_id,analyte) VALUES (1,?)").run(a);
}
// Potassium already has a NEWER manual cal-ver date -> advance-only must keep it.
db.prepare("UPDATE veritamap_tests SET last_cal_ver='2026-09-01' WHERE analyte='Potassium'").run();
// Studies: Glucose cal_ver + method_comparison + precision; Potassium cal_ver (older); Sodium off-map.
db.prepare("INSERT INTO studies (lab_id,test_name,study_type,date) VALUES (5,'Glucose','cal_ver','2026-03-01'),(5,'Glucose','method_comparison','2026-05-01'),(5,'Glucose','precision','2026-04-01'),(5,'Potassium','cal_ver','2026-02-01'),(5,'Sodium','cal_ver','2026-06-01')").run();
// An archived study must be ignored.
db.prepare("INSERT INTO studies (lab_id,test_name,study_type,date,archived_at) VALUES (5,'Glucose','method_comparison','2026-12-31','2026-12-31')").run();

const n1 = stamp(db, 5);
const g = () => db.prepare("SELECT * FROM veritamap_tests WHERE analyte='Glucose'").get();
const k = () => db.prepare("SELECT * FROM veritamap_tests WHERE analyte='Potassium'").get();
assert("Glucose cal_ver stamped 2026-03-01", g().last_cal_ver === "2026-03-01");
assert("Glucose method_comp stamped 2026-05-01", g().last_method_comp === "2026-05-01");
assert("Glucose precision stamped 2026-04-01", g().last_precision === "2026-04-01");
assert("archived study ignored (method_comp not 2026-12-31)", g().last_method_comp !== "2026-12-31");
assert("Potassium advance-only: newer manual 2026-09-01 kept (not older 2026-02-01)", k().last_cal_ver === "2026-09-01");
assert("Potassium method_comp still blank (no study)", k().last_method_comp === null);
assert("off-map analyte Sodium stamped nothing", db.prepare("SELECT COUNT(*) c FROM veritamap_tests WHERE analyte='Sodium'").get().c === 0);
assert("second run is idempotent (stamps 0)", stamp(db, 5) === 0);
assert("dryRun writes nothing", (() => { const before = g().last_precision; db.prepare("UPDATE veritamap_tests SET last_precision=NULL WHERE analyte='Glucose'").run(); const s = stamp(db, 5, { dryRun: true }); const after = g().last_precision; db.prepare("UPDATE veritamap_tests SET last_precision=? WHERE analyte='Glucose'").run(before); return s > 0 && after === null; })());

console.log(ok ? "\nALL PASS" : "\nFAILURES PRESENT");
process.exit(ok ? 0 : 1);
