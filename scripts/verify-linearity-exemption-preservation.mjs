// scripts/verify-linearity-exemption-preservation.mjs
//
// Gate 3 receipt for the VeritaMap tests-save exemption-preservation fix.
//
// The build wizard saves an instrument's menu via DELETE + reinsert of its rows
// (analyte/specialty/complexity/active only). Before this fix the four
// linearity_exempt_* columns were dropped on every save, which is what wiped
// San Carlos's cal-ver exemptions map-wide (2026-07-31 and 2026-08-01) and made
// every combo read "Cal Ver / Linearity required".
//
// This mirrors the exact SQL of captureInstrumentExemptions/restoreInstrument-
// Exemptions (server/routes.ts) against an in-memory DB and proves:
//   1. OLD path (DELETE + bare reinsert) LOSES exemptions  -> harness bites
//   2. NEW path (capture -> DELETE -> reinsert -> restore) PRESERVES them
//   3. analyte kept   -> exemption preserved
//   4. analyte removed from the menu -> exemption correctly gone
//   5. analyte re-added fresh -> no stale exemption
//
// Run: node scripts/verify-linearity-exemption-preservation.mjs
import Database from "better-sqlite3";

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE veritamap_instrument_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id INTEGER, map_id INTEGER,
      analyte TEXT, specialty TEXT, complexity TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      linearity_exempt_multical INTEGER NOT NULL DEFAULT 0,
      linearity_exempt_noncal INTEGER NOT NULL DEFAULT 0,
      linearity_exempt_waived INTEGER NOT NULL DEFAULT 0,
      linearity_exempt_other TEXT,
      UNIQUE(instrument_id, map_id, analyte)
    );
  `);
  return db;
}

const INST = 10, MAP = 1;
// Seed: Glucose (multical-exempt), Sodium (waived-exempt), Amphetamines (noncal-exempt), ALT (not exempt)
function seed(db) {
  const ins = db.prepare("INSERT INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active, linearity_exempt_multical, linearity_exempt_noncal, linearity_exempt_waived, linearity_exempt_other) VALUES (?,?,?,?,?,?,?,?,?,?)");
  ins.run(INST, MAP, "Glucose", "Chemistry", "MODERATE", 1, 1, 0, 0, null);
  ins.run(INST, MAP, "Sodium", "Chemistry", "MODERATE", 1, 0, 0, 1, null);
  ins.run(INST, MAP, "Amphetamines", "Toxicology", "MODERATE", 1, 0, 1, 0, null);
  ins.run(INST, MAP, "ALT", "Chemistry", "MODERATE", 1, 0, 0, 0, null);
}
const exemptCount = (db) => db.prepare("SELECT COUNT(*) n FROM veritamap_instrument_tests WHERE instrument_id=? AND map_id=? AND (linearity_exempt_multical=1 OR linearity_exempt_noncal=1 OR linearity_exempt_waived=1 OR (linearity_exempt_other IS NOT NULL AND TRIM(linearity_exempt_other)<>''))").get(INST, MAP).n;
const isExempt = (db, analyte) => {
  const r = db.prepare("SELECT linearity_exempt_multical mc, linearity_exempt_noncal nc, linearity_exempt_waived wv, linearity_exempt_other ot FROM veritamap_instrument_tests WHERE instrument_id=? AND map_id=? AND lower(trim(analyte))=lower(trim(?))").get(INST, MAP, analyte);
  return !!(r && (r.mc || r.nc || r.wv || (r.ot || "").trim()));
};

// The DELETE + bare reinsert that both save paths run.
function bareReinsert(db, tests) {
  db.prepare("DELETE FROM veritamap_instrument_tests WHERE instrument_id=? AND map_id=?").run(INST, MAP);
  const stmt = db.prepare("INSERT OR IGNORE INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?,?,?,?,?,?)");
  for (const t of tests) stmt.run(INST, MAP, t.analyte, t.specialty || "", t.complexity || "", t.active ?? 1);
}
// Mirrors captureInstrumentExemptions (server/routes.ts)
function capture(db) {
  return db.prepare("SELECT lower(trim(analyte)) AS k, linearity_exempt_multical AS mc, linearity_exempt_noncal AS nc, linearity_exempt_waived AS wv, linearity_exempt_other AS ot FROM veritamap_instrument_tests WHERE instrument_id=? AND map_id=?").all(INST, MAP).filter((r) => r.mc || r.nc || r.wv || (r.ot || "").trim());
}
// Mirrors restoreInstrumentExemptions (server/routes.ts)
function restore(db, snap) {
  const upd = db.prepare("UPDATE veritamap_instrument_tests SET linearity_exempt_multical=?, linearity_exempt_noncal=?, linearity_exempt_waived=?, linearity_exempt_other=? WHERE instrument_id=? AND map_id=? AND lower(trim(analyte))=?");
  let n = 0;
  for (const e of snap) n += upd.run(e.mc ? 1 : 0, e.nc ? 1 : 0, e.wv ? 1 : 0, (e.ot || "").trim() || null, INST, MAP, e.k).changes;
  return n;
}

const menuSame = [
  { analyte: "Glucose", specialty: "Chemistry", complexity: "MODERATE" },
  { analyte: "Sodium", specialty: "Chemistry", complexity: "MODERATE" },
  { analyte: "Amphetamines", specialty: "Toxicology", complexity: "MODERATE" },
  { analyte: "ALT", specialty: "Chemistry", complexity: "MODERATE" },
];

// --- 1. OLD path proves the bug: bare reinsert wipes all exemptions ---
{
  const db = freshDb(); seed(db);
  check("baseline seed has 3 exemptions", exemptCount(db) === 3);
  bareReinsert(db, menuSame);
  check("OLD path (no restore) WIPES exemptions to 0  [harness bites]", exemptCount(db) === 0);
  db.close();
}

// --- 2. NEW path preserves exemptions across an identical-menu save ---
{
  const db = freshDb(); seed(db);
  const snap = capture(db);
  check("capture found 3 exempt analytes", snap.length === 3);
  bareReinsert(db, menuSame);
  const restored = restore(db, snap);
  check("restore re-applied 3 exemptions", restored === 3);
  check("NEW path preserves exemptions (3)", exemptCount(db) === 3);
  check("Glucose still exempt", isExempt(db, "Glucose"));
  check("Sodium still exempt", isExempt(db, "Sodium"));
  check("Amphetamines still exempt", isExempt(db, "Amphetamines"));
  check("ALT still not exempt", !isExempt(db, "ALT"));
  db.close();
}

// --- 3. analyte REMOVED from the menu: its exemption correctly disappears ---
{
  const db = freshDb(); seed(db);
  const snap = capture(db);
  const menuNoSodium = menuSame.filter((t) => t.analyte !== "Sodium");
  bareReinsert(db, menuNoSodium);
  restore(db, snap); // restore keyed by analyte; Sodium row no longer exists -> 0 changes for it
  check("removed analyte (Sodium) is gone from instrument", db.prepare("SELECT COUNT(*) n FROM veritamap_instrument_tests WHERE instrument_id=? AND map_id=? AND analyte='Sodium'").get(INST, MAP).n === 0);
  check("remaining exemptions preserved (Glucose+Amphetamines=2)", exemptCount(db) === 2);
  check("Glucose still exempt after Sodium removed", isExempt(db, "Glucose"));
  db.close();
}

// --- 4. analyte RE-ADDED fresh (was never exempt) stays non-exempt ---
{
  const db = freshDb(); seed(db);
  const snap = capture(db); // captures Glucose/Sodium/Amphetamines
  const menuPlusChloride = [...menuSame, { analyte: "Chloride", specialty: "Chemistry", complexity: "MODERATE" }];
  bareReinsert(db, menuPlusChloride);
  restore(db, snap);
  check("newly added Chloride is NOT exempt (no stale flag)", !isExempt(db, "Chloride"));
  check("original 3 exemptions intact", exemptCount(db) === 3);
  db.close();
}

// --- 5. case/whitespace-insensitive key match ---
{
  const db = freshDb(); seed(db);
  const snap = capture(db);
  const menuCased = menuSame.map((t) => t.analyte === "Glucose" ? { ...t, analyte: "  glucose  " } : t);
  bareReinsert(db, menuCased);
  restore(db, snap);
  check("exemption re-applies despite case/whitespace drift on analyte", isExempt(db, "glucose"));
  db.close();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
