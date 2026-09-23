// scripts/verify-iqcp-crud.mjs
//
// Gate 3 receipt for the IQCP Phase 2 plan CRUD SQL. Builds the four IQCP tables
// in a throwaway in-memory DB and exercises the exact query shapes the endpoints
// use: create (indicated + not_indicated), replace-set worksheet rows, re-read,
// and delete-cascade. Asserts the round-trip. Run: npx tsx scripts/verify-iqcp-crud.mjs
import Database from "better-sqlite3";

const db = new Database(":memory:");
db.exec(`
CREATE TABLE iqcp_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER NOT NULL, map_id INTEGER, instrument_id INTEGER, instrument_name TEXT NOT NULL, test_scope TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'screening', screen_nonwaived TEXT, screen_reduce_intent TEXT, screen_mfr_less_strict TEXT, screen_result TEXT, screen_notes TEXT, title TEXT, created_by_user_id INTEGER, approved_by_user_id INTEGER, approved_by_name TEXT, approved_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE iqcp_risk_items (id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, component TEXT NOT NULL, phase TEXT, source_of_error TEXT, reducible TEXT, mitigation TEXT, residual_risk TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE iqcp_qcp_items (id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, qc_type TEXT NOT NULL, frequency TEXT, acceptability_criteria TEXT, corrective_action TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE iqcp_qa_items (id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, activity TEXT NOT NULL, frequency TEXT, assessment_method TEXT, corrective_action TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
`);

let fails = 0;
const now = new Date().toISOString();
const ok = (label, cond) => { if (!cond) { fails++; console.log("FAIL " + label); } else console.log("PASS " + label); };

// yes/yes/yes -> indicated -> status draft
const p1 = db.prepare(`INSERT INTO iqcp_plans (lab_id, map_id, instrument_id, instrument_name, test_scope, status, screen_nonwaived, screen_reduce_intent, screen_mfr_less_strict, screen_result, title, created_by_user_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(2, 5, 213, "Cepheid GeneXpert", JSON.stringify(["Strep A"]), "draft", "yes", "yes", "yes", "indicated", null, 37, now, now);
const plan1 = db.prepare("SELECT * FROM iqcp_plans WHERE id = ? AND lab_id = ?").get(p1.lastInsertRowid, 2);
ok("create indicated plan (status draft, screen_result indicated)", plan1 && plan1.status === "draft" && plan1.screen_result === "indicated");
ok("test_scope round-trips as JSON", JSON.stringify(JSON.parse(plan1.test_scope)) === JSON.stringify(["Strep A"]));

// not indicated (waived) -> status not_indicated
const p2 = db.prepare(`INSERT INTO iqcp_plans (lab_id, instrument_name, test_scope, status, screen_nonwaived, screen_result, created_by_user_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
  .run(2, "CLINITEK Status+", "[]", "not_indicated", "no", "not_indicated", 37, now, now);
const plan2 = db.prepare("SELECT status, screen_result FROM iqcp_plans WHERE id = ?").get(p2.lastInsertRowid);
ok("create not-indicated plan", plan2.status === "not_indicated" && plan2.screen_result === "not_indicated");

// lab scoping: a plan from lab 2 must not resolve under lab 99
ok("lab-scope guard blocks cross-lab read", !db.prepare("SELECT * FROM iqcp_plans WHERE id = ? AND lab_id = ?").get(p1.lastInsertRowid, 99));

// replace-set risk items twice; second set must fully replace the first
const insRisk = (planId, items) => {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM iqcp_risk_items WHERE plan_id = ?").run(planId);
    items.forEach((it, i) => db.prepare(`INSERT INTO iqcp_risk_items (plan_id, component, phase, source_of_error, reducible, mitigation, residual_risk, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(planId, it.component, it.phase, it.source_of_error, it.reducible, it.mitigation, it.residual_risk, i, now, now));
  });
  tx();
};
insRisk(plan1.id, [
  { component: "Specimen", phase: "Pre-analytic", source_of_error: "Wrong tube", reducible: "yes", mitigation: "Reject criteria", residual_risk: "low" },
  { component: "Test System", phase: "Analytic", source_of_error: "No electronic QC", reducible: "no", mitigation: "External QC weekly", residual_risk: "low" },
]);
ok("risk items inserted (2)", db.prepare("SELECT COUNT(*) n FROM iqcp_risk_items WHERE plan_id = ?").get(plan1.id).n === 2);
insRisk(plan1.id, [{ component: "Reagent", phase: "Pre-analytic", source_of_error: "Lot mix", reducible: "yes", mitigation: "Lot log", residual_risk: "low" }]);
const risk = db.prepare("SELECT component, sort_order FROM iqcp_risk_items WHERE plan_id = ? ORDER BY sort_order").all(plan1.id);
ok("replace-set fully replaces (1 row, is Reagent)", risk.length === 1 && risk[0].component === "Reagent" && risk[0].sort_order === 0);

// qcp + qa
db.prepare(`INSERT INTO iqcp_qcp_items (plan_id, qc_type, frequency, acceptability_criteria, corrective_action, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(plan1.id, "External liquid QC", "Weekly", "Within range", "Repeat + investigate", 0, now, now);
db.prepare(`INSERT INTO iqcp_qa_items (plan_id, activity, frequency, assessment_method, corrective_action, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(plan1.id, "Monitor QC for shifts/trends", "Monthly", "LJ review", "Retrain", 0, now, now);
ok("qcp + qa rows present", db.prepare("SELECT COUNT(*) n FROM iqcp_qcp_items WHERE plan_id=?").get(plan1.id).n === 1 && db.prepare("SELECT COUNT(*) n FROM iqcp_qa_items WHERE plan_id=?").get(plan1.id).n === 1);

// delete cascade
const del = db.transaction(() => {
  db.prepare("DELETE FROM iqcp_risk_items WHERE plan_id = ?").run(plan1.id);
  db.prepare("DELETE FROM iqcp_qcp_items WHERE plan_id = ?").run(plan1.id);
  db.prepare("DELETE FROM iqcp_qa_items WHERE plan_id = ?").run(plan1.id);
  db.prepare("DELETE FROM iqcp_plans WHERE id = ? AND lab_id = ?").run(plan1.id, 2);
});
del();
ok("delete removes plan + all child rows", !db.prepare("SELECT 1 FROM iqcp_plans WHERE id=?").get(plan1.id)
  && db.prepare("SELECT COUNT(*) n FROM iqcp_risk_items WHERE plan_id=?").get(plan1.id).n === 0
  && db.prepare("SELECT COUNT(*) n FROM iqcp_qcp_items WHERE plan_id=?").get(plan1.id).n === 0
  && db.prepare("SELECT COUNT(*) n FROM iqcp_qa_items WHERE plan_id=?").get(plan1.id).n === 0);

db.close();
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
