// scripts/verify-veritaqc-westgard-validation-idor.mjs
//
// Receipt for the VeritaQC server batch (2026-07-12):
//   HIGH #1  the Westgard evaluator anchored on `sdis.length - 1` (the last
//            DATE-ordered result), so a back-dated / out-of-order entry scored a
//            different (in-control) point -> false accept + baseline poison.
//            Fixed to `ids.indexOf(newResultId)`.
//   #7       POST /qc/results now validates result_value finiteness + ISO date.
//   #5       the corrective-action insert now verifies qc_rule_violation_id
//            belongs to the (lab-scoped) qc_result_id before storing it (IDOR).
//
// The functional block replicates evaluateWestgardForLot's anchor + baseline math
// against a real better-sqlite3 fixture (mirroring the exact ORDER BY) and proves
// the OLD anchor misses a back-dated flyer while the NEW anchor catches it.
//
//   node scripts/verify-veritaqc-westgard-validation-idor.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

console.log("=== source proofs ===");
ok("#1 evaluator anchors on ids.indexOf(newResultId)", /const i = ids\.indexOf\(newResultId\);/.test(src));
ok("#1 old sdis.length-1 anchor is gone", !/const i = sdis\.length - 1;/.test(src));
ok("#1 guards missing candidate (return [])", /const i = ids\.indexOf\(newResultId\);\s*\n\s*if \(i < 0\) return \[\];/.test(src));
ok("#7 rejects non-finite result_value", /if \(!Number\.isFinite\(Number\(result_value\)\)\)/.test(src));
ok("#7 rejects non-ISO result_date", /if \(!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(String\(result_date\)\)\)/.test(src));
ok("#5 CA insert validates the violation belongs to the result",
  /SELECT 1 FROM qc_rule_violations WHERE id = \? AND qc_result_id = \?[\s\S]*?Rule violation does not belong to this result/.test(src));

console.log("\n=== #1 functional proof: back-dated flyer, old anchor vs new anchor ===");
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE qc_results (id INTEGER PRIMARY KEY, lab_id INTEGER, control_lot_id INTEGER,
                           result_value REAL, result_date TEXT, accepted_for_reporting INTEGER);
`);
const LAB = 5, LOT = 1;
// In-control baseline ~100 +/- 1, dated 2026-04-01 .. 2026-04-10 (ids 1..10).
const seed = [100.2, 99.8, 100.5, 99.5, 100.1, 99.9, 100.3, 99.7, 100.0, 100.4];
seed.forEach((v, k) => {
  const day = String(k + 1).padStart(2, "0");
  db.prepare("INSERT INTO qc_results (lab_id, control_lot_id, result_value, result_date, accepted_for_reporting) VALUES (?,?,?,?,1)")
    .run(LAB, LOT, v, `2026-04-${day}`);
});
// Tech back-enters a MISSED out-of-control QC: value 130 (a ~30-SD flyer),
// dated 2026-04-05 -> it gets the max id (11) but sorts into the MIDDLE.
const flyer = db.prepare("INSERT INTO qc_results (lab_id, control_lot_id, result_value, result_date, accepted_for_reporting) VALUES (?,?,?,?,1)")
  .run(LAB, LOT, 130, "2026-04-05");
const newResultId = Number(flyer.lastInsertRowid); // 11

// Faithful replica of the evaluator's setup (same ORDER BY as routes.ts:2647).
function setup(newId) {
  const history = db.prepare(
    "SELECT id, result_value FROM qc_results WHERE lab_id = ? AND control_lot_id = ? AND accepted_for_reporting = 1 ORDER BY result_date ASC, id ASC"
  ).all(LAB, LOT);
  const baseline = history.filter(r => r.id !== newId);
  const bvals = baseline.map(r => r.result_value);
  const mean = bvals.reduce((a, b) => a + b, 0) / bvals.length;
  const variance = bvals.reduce((s, v) => s + (v - mean) ** 2, 0) / (bvals.length - 1);
  const sd = Math.sqrt(variance);
  const ids = history.map(r => r.id);
  const sdis = history.map(r => (r.result_value - mean) / sd);
  return { ids, sdis };
}
const { ids, sdis } = setup(newResultId);

// The new result is NOT the last element (proves the invariant the old code assumed is false).
const lastId = ids[ids.length - 1];
ok("#1 back-dated flyer (id 11) does NOT sort last in date order", lastId !== newResultId);

// OLD anchor: i = last -> scores the latest-dated in-control point -> |z| < 3 -> MISS.
const iOld = sdis.length - 1;
const oldFires13s = Math.abs(sdis[iOld]) > 3;
ok("#1 OLD anchor (sdis.length-1) MISSES the flyer (false accept)", oldFires13s === false);

// NEW anchor: i = indexOf(newResultId) -> scores the 130 flyer -> |z| >> 3 -> 1-3s reject.
const iNew = ids.indexOf(newResultId);
const newFires13s = Math.abs(sdis[iNew]) > 3;
ok("#1 NEW anchor (indexOf) CATCHES the flyer as 1-3s reject", newFires13s === true);
ok("#1 NEW anchor SDI is the flyer's (|z| > 20)", Math.abs(sdis[iNew]) > 20);

// Normal case: a same-day-latest entry -> both anchors agree (score the new point).
const norm = db.prepare("INSERT INTO qc_results (lab_id, control_lot_id, result_value, result_date, accepted_for_reporting) VALUES (?,?,?,?,1)")
  .run(LAB, LOT, 100.1, "2026-04-11");
const normId = Number(norm.lastInsertRowid);
const s2 = setup(normId);
ok("#1 normal latest-dated entry: indexOf == last (anchors agree)",
  s2.ids.indexOf(normId) === s2.sdis.length - 1);

db.close();
console.log(fails === 0 ? "\n=== VERITAQC WESTGARD/VALIDATION/IDOR: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
