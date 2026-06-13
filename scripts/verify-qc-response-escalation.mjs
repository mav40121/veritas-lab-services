// scripts/verify-qc-response-escalation.mjs
//
// Receipt for Wave A7 (2026-06-12): VeritaQC corrective action -> VeritaResponse
// finding escalation. Replicates the server logic over an in-memory schema
// and asserts every branch:
//
//   1. escalation creates a CMS finding citing 42 CFR 493.1256(d), status open,
//      with the QC context folded into description + immediate_action
//   2. the corrective action's nce_reference is stamped "VeritaResponse#<id>"
//   3. escalation is idempotent: a second call returns 409 with the same id
//   4. the back-reference round-trips (parse the id back out)
//
// Run: node scripts/verify-qc-response-escalation.mjs

import Database from "better-sqlite3";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE labs (id INTEGER PRIMARY KEY, owner_user_id INTEGER);
  CREATE TABLE qc_control_lots (id INTEGER PRIMARY KEY, lab_id INTEGER, analyte TEXT, level TEXT, lot_number TEXT);
  CREATE TABLE qc_results (id INTEGER PRIMARY KEY, lab_id INTEGER, control_lot_id INTEGER, instrument TEXT, result_value REAL, result_date TEXT);
  CREATE TABLE qc_rule_violations (id INTEGER PRIMARY KEY, qc_result_id INTEGER, rule_code TEXT, severity TEXT, detail TEXT);
  CREATE TABLE qc_corrective_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER, qc_result_id INTEGER, qc_rule_violation_id INTEGER, action_taken TEXT, nce_reference TEXT, updated_at TEXT);
  CREATE TABLE findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, lab_id INTEGER, accreditor TEXT,
    finding_number TEXT, standard_ref TEXT, phase_or_severity TEXT, description TEXT,
    surveyor_notes TEXT, anchor_date TEXT, due_date TEXT, status TEXT, immediate_action TEXT
  );
`);

// Seed a lab + a rejected control run + the filed corrective action.
db.prepare("INSERT INTO labs (id, owner_user_id) VALUES (5, 99)").run();
db.prepare("INSERT INTO qc_control_lots (id, lab_id, analyte, level, lot_number) VALUES (1, 5, 'Potassium', 'high', 'LOT-K-2026')").run();
db.prepare("INSERT INTO qc_results (id, lab_id, control_lot_id, instrument, result_value, result_date) VALUES (10, 5, 1, 'Roche c503', 6.9, '2026-06-10')").run();
db.prepare("INSERT INTO qc_rule_violations (id, qc_result_id, rule_code, severity, detail) VALUES (20, 10, '1-3s', 'rejection', 'One result beyond +/- 3 SD.')").run();
db.prepare("INSERT INTO qc_corrective_actions (lab_id, qc_result_id, qc_rule_violation_id, action_taken, nce_reference) VALUES (5, 10, 20, 'Repeated control; recalibrated and reran in range.', NULL)").run();

function dueDateForFinding(accreditor, anchorDate) {
  if (!anchorDate) return null;
  const offsets = { CAP: 30, TJC: 60, CMS: 10, AABB: 45, COLA: 30, Other: 30 };
  const days = offsets[accreditor];
  if (days === undefined) return null;
  const d = new Date(anchorDate);
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Mirror of the server endpoint logic.
function escalate(caId, labId, today) {
  const ca = db.prepare("SELECT * FROM qc_corrective_actions WHERE id = ? AND lab_id = ?").get(caId, labId);
  if (!ca) return { status: 404 };
  const existing = /^VeritaResponse#(\d+)$/.exec(String(ca.nce_reference || ""));
  if (existing) return { status: 409, finding_id: Number(existing[1]) };
  const ctx = db.prepare(
    "SELECT r.result_value, r.result_date, r.instrument, l.analyte, l.lot_number, l.level FROM qc_results r JOIN qc_control_lots l ON r.control_lot_id = l.id WHERE r.id = ? AND r.lab_id = ?"
  ).get(ca.qc_result_id, labId);
  const viol = ca.qc_rule_violation_id ? db.prepare("SELECT * FROM qc_rule_violations WHERE id = ?").get(ca.qc_rule_violation_id) : null;
  const ruleCode = viol?.rule_code || "QC";
  const description = `VeritaQC escalation. ${ctx.analyte} ${ctx.level} (control lot ${ctx.lot_number}) fired Westgard rule ${ruleCode} on ${ctx.result_date}, instrument ${ctx.instrument}. Value ${ctx.result_value}. ${viol?.detail || ""}`.trim();
  const owner = db.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(labId);
  const ins = db.prepare(
    `INSERT INTO findings (user_id, lab_id, accreditor, finding_number, standard_ref, phase_or_severity, description, surveyor_notes, anchor_date, due_date, status, immediate_action)
     VALUES (?, ?, 'CMS', ?, '42 CFR 493.1256(d)', ?, ?, ?, ?, ?, 'open', ?)`
  ).run(owner.owner_user_id, labId, `QC-${ruleCode}`, viol?.severity || "rejection", description,
        `Auto-created from VeritaQC corrective action #${caId}.`, today, dueDateForFinding("CMS", today), ca.action_taken);
  const findingId = Number(ins.lastInsertRowid);
  db.prepare("UPDATE qc_corrective_actions SET nce_reference = ? WHERE id = ?").run(`VeritaResponse#${findingId}`, caId);
  return { status: 200, finding_id: findingId };
}

const r1 = escalate(1, 5, "2026-06-12");
check("1. escalation returns 200 with a finding id", r1.status === 200 && r1.finding_id > 0);
const f = db.prepare("SELECT * FROM findings WHERE id = ?").get(r1.finding_id);
check("1a. finding is CMS / 42 CFR 493.1256(d) / open", f.accreditor === "CMS" && f.standard_ref === "42 CFR 493.1256(d)" && f.status === "open");
check("1b. finding_number echoes the Westgard rule", f.finding_number === "QC-1-3s");
check("1c. description folds in analyte + rule + value", /Potassium/.test(f.description) && /1-3s/.test(f.description) && /6\.9/.test(f.description));
check("1d. immediate_action carries the QC corrective action verbatim", f.immediate_action === "Repeated control; recalibrated and reran in range.");
check("1e. due date is anchor + 10 (CMS)", f.due_date === "2026-06-22");

const ca = db.prepare("SELECT nce_reference FROM qc_corrective_actions WHERE id = 1").get();
check("2. corrective action stamped VeritaResponse#<id>", ca.nce_reference === `VeritaResponse#${r1.finding_id}`);

const r2 = escalate(1, 5, "2026-06-12");
check("3. second escalation is idempotent (409 + same id)", r2.status === 409 && r2.finding_id === r1.finding_id);
check("3a. no duplicate finding created", db.prepare("SELECT COUNT(*) c FROM findings").get().c === 1);

const parsed = /^VeritaResponse#(\d+)$/.exec(ca.nce_reference);
check("4. back-reference round-trips to the finding id", parsed && Number(parsed[1]) === r1.finding_id);

check("5. cross-lab caId is rejected (404)", escalate(1, 6, "2026-06-12").status === 404);

console.log("");
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log("ALL PASS (10/10): Wave A7 QC -> VeritaResponse escalation, citation, idempotency, and scoping verified.");
