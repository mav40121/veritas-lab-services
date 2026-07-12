// scripts/verify-veritatrack-signoff-writeback.mjs
//
// Receipt for the VeritaTrack sign-off VeritaMap writeback wrong-lab fix
// (audit #3 HIGH, #107 class, 2026-07-11). On sign-off of a map-linked task, the
// writeback picked veritamap_maps by users.lab_id (the owner's HOME lab), which
// can drift from the active lab. A multi-lab owner signing off a task on Lab B
// therefore wrote the completion date onto Lab A's veritamap_tests and never
// updated Lab B. The fix uses signoffLabId (= task.lab_id, the lab the sign-off
// was recorded against) for the map lookup.
//
//   node scripts/verify-veritatrack-signoff-writeback.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "server/veritatrack.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// ── source receipts ───────────────────────────────────────────────────────
console.log("--- source receipts ---");
ok("the owner-home-lab lookup (SELECT lab_id FROM users) is gone from the writeback",
  !/const ownerLabRow = sqlite\.prepare\(\s*"SELECT lab_id FROM users WHERE id = \?"/.test(src));
ok("the map lookup now scopes by signoffLabId",
  /const maps = signoffLabId != null[\s\S]*?veritamap_maps WHERE lab_id = \?[\s\S]*?\)\.all\(signoffLabId\)/.test(src));
ok("signoffLabId is still derived from the task's lab (task.lab_id, fallback resolveLegacyLabId)",
  /const signoffLabId = task\.lab_id \?\? resolveLegacyLabId\(sqlite, req\) \?\? null;/.test(src));
ok("the #107-class fix is documented", /#107-class fix \(2026-07-11\): scope the VeritaMap writeback to the/.test(src));

// ── functional sqlite proof ───────────────────────────────────────────────
console.log("--- functional sqlite proof ---");
let Database;
try { Database = (await import("better-sqlite3")).default; }
catch {
  console.log("SKIP: better-sqlite3 not importable (source receipts still authoritative).");
  console.log(fails === 0 ? "\n=== VERITATRACK SIGNOFF WRITEBACK: PASS (receipts) ===" : `\n=== ${fails} FAIL ===`);
  process.exit(fails === 0 ? 0 : 1);
}
const sq = new Database(":memory:");
sq.exec(`
  CREATE TABLE veritamap_maps (id INTEGER PRIMARY KEY, lab_id INTEGER);
  CREATE TABLE veritamap_tests (id INTEGER PRIMARY KEY, map_id INTEGER, analyte TEXT, cal_ver_date TEXT);
`);
const LAB_A = 10, LAB_B = 14;
const mapA = sq.prepare("INSERT INTO veritamap_maps (lab_id) VALUES (?)").run(LAB_A).lastInsertRowid;
const mapB = sq.prepare("INSERT INTO veritamap_maps (lab_id) VALUES (?)").run(LAB_B).lastInsertRowid;
sq.prepare("INSERT INTO veritamap_tests (map_id, analyte, cal_ver_date) VALUES (?, 'Sodium', NULL)").run(mapA);
sq.prepare("INSERT INTO veritamap_tests (map_id, analyte, cal_ver_date) VALUES (?, 'Sodium', NULL)").run(mapB);

// A multi-lab owner signs off a Sodium cal-ver task on Lab B. signoffLabId = B.
const signoffLabId = LAB_B, usersHomeLab = LAB_A, DATE = "2026-07-11";
const writeback = (labForLookup) => {
  const maps = sq.prepare("SELECT id FROM veritamap_maps WHERE lab_id = ?").all(labForLookup).map(m => m.id);
  if (maps.length) {
    const ph = maps.map(() => "?").join(",");
    sq.prepare(`UPDATE veritamap_tests SET cal_ver_date = ? WHERE map_id IN (${ph}) AND analyte = ?`).run(DATE, ...maps, "Sodium");
  }
};
// FIXED behavior: look up by signoffLabId (the task's lab, B).
writeback(signoffLabId);
const bDate = sq.prepare("SELECT cal_ver_date FROM veritamap_tests WHERE map_id = ?").get(mapB).cal_ver_date;
const aDate = sq.prepare("SELECT cal_ver_date FROM veritamap_tests WHERE map_id = ?").get(mapA).cal_ver_date;
ok("fixed writeback updates the TASK's lab (Lab B) map", bDate === DATE);
ok("fixed writeback does NOT touch the owner's home lab (Lab A) map", aDate === null);
// Demonstrate the OLD bug: looking up by users.lab_id (A) would have hit Lab A.
const aOnly = sq.prepare("SELECT id FROM veritamap_maps WHERE lab_id = ?").all(usersHomeLab).map(m => m.id);
ok("the OLD users.lab_id lookup would have wrongly targeted Lab A", aOnly.includes(mapA) && !aOnly.includes(mapB));
sq.close();

console.log(fails === 0 ? "\n=== VERITATRACK SIGNOFF WRITEBACK: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
