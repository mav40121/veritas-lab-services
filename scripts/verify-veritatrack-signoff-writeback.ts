// scripts/verify-veritatrack-signoff-writeback.ts
//
// Receipt for the VeritaTrack sign-off VeritaMap writeback wrong-lab fix
// (#107-class, HIGH, 2026-08-10). Imports the REAL applyMapSignoffWriteback and
// drives it against an in-memory better-sqlite3 DB.
//
// The bug: the helper resolved the map's lab from users.lab_id (the owner's HOME
// lab). A multi-lab owner signing off a map-linked task on Lab B wrote the
// completion date onto Lab A's veritamap_tests and never updated Lab B. The fix
// threads signoffLabId (= task.lab_id) in and scopes the writeback to it.
//
//   npx tsx scripts/verify-veritatrack-signoff-writeback.ts
import Database from "better-sqlite3";
import { applyMapSignoffWriteback } from "../server/veritatrackMapSync";

let fails = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}${cond ? "" : "  -- " + detail}`);
  if (!cond) fails++;
};

const LAB_A = 10;   // owner's HOME lab (users.lab_id)
const LAB_B = 14;   // the task's lab (signoffLabId)
const OWNER = 99;   // a multi-lab owner who belongs to both labs

const sq = new Database(":memory:");
sq.exec(`
  CREATE TABLE veritamap_maps (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER, user_id INTEGER);
  CREATE TABLE veritamap_tests (id INTEGER PRIMARY KEY AUTOINCREMENT, map_id INTEGER, analyte TEXT, last_cal_ver TEXT, updated_at TEXT);
`);
const mapA = Number(sq.prepare("INSERT INTO veritamap_maps (lab_id, user_id) VALUES (?, ?)").run(LAB_A, OWNER).lastInsertRowid);
const mapB = Number(sq.prepare("INSERT INTO veritamap_maps (lab_id, user_id) VALUES (?, ?)").run(LAB_B, OWNER).lastInsertRowid);
sq.prepare("INSERT INTO veritamap_tests (map_id, analyte, last_cal_ver) VALUES (?, 'Sodium', NULL)").run(mapA);
sq.prepare("INSERT INTO veritamap_tests (map_id, analyte, last_cal_ver) VALUES (?, 'Sodium', NULL)").run(mapB);

const dateOf = (mapId: number) =>
  (sq.prepare("SELECT last_cal_ver FROM veritamap_tests WHERE map_id = ? AND analyte = 'Sodium'").get(mapId) as any).last_cal_ver;
const resetDates = () => sq.prepare("UPDATE veritamap_tests SET last_cal_ver = NULL").run();

const DATE = "2026-08-10";

// ── 1. The fix: sign-off on Lab B writes to Lab B, not the home lab A ────────
let res = applyMapSignoffWriteback(sq, LAB_B, OWNER, "Sodium", "last_cal_ver", DATE);
ok("writeback reports 1 row updated on the task's lab", res.updated === 1 && !res.warning, JSON.stringify(res));
ok("Lab B (the sign-off's lab) map got the date", dateOf(mapB) === DATE, `got ${dateOf(mapB)}`);
ok("Lab A (owner's HOME lab) map was NOT touched", dateOf(mapA) === null, `got ${dateOf(mapA)}`);

// ── 2. Demonstrate the OLD bug shape: scoping to the home lab hits A, not B ──
resetDates();
res = applyMapSignoffWriteback(sq, LAB_A, OWNER, "Sodium", "last_cal_ver", DATE);
ok("scoping to the home lab (old bug) would have wrongly updated Lab A", dateOf(mapA) === DATE && dateOf(mapB) === null);

// ── 3. Legacy fallback: signoffLabId null -> user_id path still works ────────
resetDates();
res = applyMapSignoffWriteback(sq, null, OWNER, "Sodium", "last_cal_ver", DATE);
ok("null lab falls back to user_id and updates the owner's maps", res.updated === 2 && dateOf(mapA) === DATE && dateOf(mapB) === DATE);

// ── 4. Field allowlist guard preserved ──────────────────────────────────────
resetDates();
res = applyMapSignoffWriteback(sq, LAB_B, OWNER, "Sodium", "not_a_field", DATE);
ok("non-allowlisted map field is rejected without touching the DB", res.updated === 0 && !!res.warning && dateOf(mapB) === null);

// ── 5. Zero-row warning preserved (unknown analyte) ─────────────────────────
resetDates();
res = applyMapSignoffWriteback(sq, LAB_B, OWNER, "Potassium", "last_cal_ver", DATE);
ok("unknown analyte reports updated=0 with a warning (no silent success)", res.updated === 0 && !!res.warning);

sq.close();
console.log(fails === 0
  ? "\n=== VERITATRACK SIGNOFF WRITEBACK: PASS (real function, right-lab proven) ==="
  : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
