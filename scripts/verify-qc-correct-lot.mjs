// verify-qc-correct-lot.mjs — exercises the branch logic of
// POST /api/admin/qc-correct-lot-number against an in-memory DB.
// Confirms: successful rename updates only the lot_number (results untouched),
// a same-value rename is a no-op, a rename that would collide on
// UNIQUE(lab_id, analyte, lot_number) is blocked (409), and unknown lot / wrong
// lab return 404.
import Database from "better-sqlite3";

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE qc_control_lots (
    id INTEGER PRIMARY KEY, lab_id INT, analyte TEXT, level TEXT,
    lot_number TEXT, updated_at TEXT, UNIQUE(lab_id, analyte, lot_number));
  CREATE TABLE qc_results (id INTEGER PRIMARY KEY, control_lot_id INT, result_value REAL);
`);
db.prepare("INSERT INTO qc_control_lots (id,lab_id,analyte,level,lot_number) VALUES (?,?,?,?,?)")
  .run(15, 19, "PSA (FREND 1)", "low", "303071");
db.prepare("INSERT INTO qc_control_lots (id,lab_id,analyte,level,lot_number) VALUES (?,?,?,?,?)")
  .run(16, 19, "PSA (FREND 1)", "high", "6362A25001");
db.prepare("INSERT INTO qc_results (id,control_lot_id,result_value) VALUES (1,15,1.24),(2,15,1.78),(3,16,15.0)").run();

// Mirror of the endpoint's logic.
function correct(labId, lotId, newLotNumber) {
  const newLot = String(newLotNumber).trim();
  const lot = db.prepare("SELECT id,analyte,level,lot_number FROM qc_control_lots WHERE id=? AND lab_id=?").get(lotId, labId);
  if (!lot) return { status: 404 };
  if (lot.lot_number === newLot) return { status: 200, unchanged: true };
  const clash = db.prepare("SELECT id FROM qc_control_lots WHERE lab_id=? AND analyte=? AND lot_number=? AND id!=?").get(labId, lot.analyte, newLot, lotId);
  if (clash) return { status: 409, clash: clash.id };
  const info = db.prepare("UPDATE qc_control_lots SET lot_number=?, updated_at=? WHERE id=? AND lab_id=?").run(newLot, "now", lotId, labId);
  return { status: 200, rows_updated: info.changes };
}

let ok = true;
const assert = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + ": " + name); if (!cond) ok = false; };

const r1 = correct(19, 15, "6361A25001");
assert("rename returns 200 + 1 row", r1.status === 200 && r1.rows_updated === 1);
assert("lot 15 now 6361A25001", db.prepare("SELECT lot_number FROM qc_control_lots WHERE id=15").get().lot_number === "6361A25001");
assert("results still attached (2 on lot 15)", db.prepare("SELECT COUNT(*) c FROM qc_results WHERE control_lot_id=15").get().c === 2);
assert("result values unchanged", db.prepare("SELECT result_value FROM qc_results WHERE id=1").get().result_value === 1.24);

const r2 = correct(19, 16, "6362A25001");
assert("same-value rename is no-op", r2.status === 200 && r2.unchanged === true);

const r3 = correct(19, 16, "6361A25001");
assert("collision on unique key blocked (409)", r3.status === 409 && r3.clash === 15);
assert("lot 16 unchanged after collision", db.prepare("SELECT lot_number FROM qc_control_lots WHERE id=16").get().lot_number === "6362A25001");

assert("unknown lot -> 404", correct(19, 999, "X").status === 404);
assert("wrong lab -> 404", correct(3, 15, "X").status === 404);

console.log(ok ? "\nALL PASS" : "\nFAILED");
process.exit(ok ? 0 : 1);
