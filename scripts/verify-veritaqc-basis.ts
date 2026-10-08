// Verify receipt for the VeritaQC evaluation basis (server/qcBasis.ts +
// server/qcWestgard.ts), 2026-10-08, MedStar. Replaces
// verify-veritaqc-westgard-mfr.ts, which proved the 2026-10-07 manufacturer-
// only basis this change undoes.
//
// The client's rule, in his words (Mike Hiltunen, 2026-10-08): the chart and
// the Westgard rules use the same numbers; a lot uses the manufacturer's
// published ranges until it has enough data, then the lab's own. Exercises:
//   1. new lot, 0 and 19 prior runs  -> manufacturer mean/SD
//   2. 20 prior runs                 -> lab mean/SD from the first 20
//   3. persisted basis wins (auto lock, all_runs, manual)
//   4. 20 identical values (SD 0)    -> stays on the manufacturer values
//   5. lock: the run just entered never counts; lock fires on run 21, is
//      idempotent and never overwrites a persisted basis
//   6. Plymouth shape: lab runs ~1.08, insert 1.29/0.35. On the manufacturer
//      basis every run is below the mean and 10-x fires; on the lab's own
//      basis the same runs are in control
//   7. a run 3+ SD from the lab mean is a 1-3s rejection on the lab basis
//      that the manufacturer basis (SD 3.5x wider) would have missed
//   8. evaluateQcRun returns the basis that judged the run, and the chart's
//      basis (resolveBasis, no beforeResultId) equals the next run's basis
//
// Run: npx tsx scripts/verify-veritaqc-basis.ts
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
import { computeBasis, resolveBasis, lockEstablishedIfDue, sampleStats } from "../server/qcBasis";
import { evaluateQcRun, westgardRulesAt, rulesForRun } from "../server/qcWestgard";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const cfg = { establishN: 20 };
const MFR = { id: 1, mfr_mean: 1.29, mfr_sd: 0.35 };

// Deterministic Plymouth-like series around 1.08 (SD about 0.1).
const offs = [-0.12, 0.05, 0.1, -0.04, 0.0, -0.09, 0.13, 0.02, -0.06, 0.08, -0.11, 0.04, 0.07, -0.03, -0.08, 0.11, 0.01, -0.05, 0.09, -0.1, 0.03, -0.02, 0.06, -0.07, 0.12];
const runs = offs.map(o => Number((1.08 + o).toFixed(3)));

// 1. manufacturer until enough runs
const b0 = computeBasis(MFR, [], cfg)!;
check("1a. 0 prior runs: manufacturer mean/SD", b0.source === "manufacturer" && b0.mean === 1.29 && b0.sd === 0.35, b0.label);
const b19 = computeBasis(MFR, runs.slice(0, 19), cfg)!;
check("1b. 19 prior runs: still manufacturer, label counts 19 of 20", b19.source === "manufacturer" && b19.runsOnLot === 19 && b19.label.includes("19 of 20"), b19.label);

// 2. lab's own from the first 20
const first20 = sampleStats(runs.slice(0, 20));
const b20 = computeBasis(MFR, runs.slice(0, 20), cfg)!;
const b25 = computeBasis(MFR, runs.slice(0, 25), cfg)!;
check("2. 20+ prior runs: lab mean/SD from the FIRST 20, not a running window",
  b20.source === "established" && near(b20.mean, first20.mean) && near(b20.sd, first20.sd) && near(b25.mean, first20.mean) && near(b25.sd, first20.sd),
  `mean ${b20.mean.toFixed(4)} sd ${b20.sd.toFixed(4)}`);

// 3. persisted basis wins
const pAuto = computeBasis({ ...MFR, lab_mean: 1.1, lab_sd: 0.1, lab_basis_n: 20, lab_basis_source: "auto", lab_basis_locked_at: "2026-10-08T00:00:00Z" }, [], cfg)!;
const pAll = computeBasis({ ...MFR, lab_mean: 1.09, lab_sd: 0.12, lab_basis_n: 33, lab_basis_source: "all_runs" }, runs, cfg)!;
const pMan = computeBasis({ ...MFR, lab_mean: 1.0, lab_sd: 0.2, lab_basis_source: "manual" }, runs, cfg)!;
check("3. a persisted basis wins over the automatic one (auto, all_runs, manual)",
  pAuto.persisted && pAuto.mean === 1.1 && pAll.mean === 1.09 && pAll.label.includes("from 33 runs") && pMan.mean === 1.0 && pMan.label.includes("entered by the lab"),
  `${pAuto.label} | ${pAll.label} | ${pMan.label}`);

// 4. zero spread does not become a basis
const flat = computeBasis(MFR, Array(20).fill(1.1), cfg)!;
check("4. 20 identical values (SD 0) stay on the manufacturer values", flat.source === "manufacturer", flat.label);

// 5-8 against a real SQLite schema
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE qc_control_lots (id INTEGER PRIMARY KEY, lab_id INTEGER, analyte TEXT, mfr_mean REAL, mfr_sd REAL,
    mfr_range_low REAL, mfr_range_high REAL, lab_mean REAL, lab_sd REAL, lab_basis_n INTEGER, lab_basis_locked_at TEXT,
    lab_basis_source TEXT, updated_at TEXT);
  CREATE TABLE qc_results (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER, control_lot_id INTEGER,
    result_value REAL, result_date TEXT, accepted_for_reporting INTEGER DEFAULT 1, voided_at TEXT);
  CREATE TABLE qc_rule_settings (lab_id INTEGER, analyte TEXT, establish_n INTEGER);
`);
const LAB = 7;
db.prepare("INSERT INTO qc_control_lots (id, lab_id, analyte, mfr_mean, mfr_sd, mfr_range_low, mfr_range_high) VALUES (1, ?, 'PSA (FREND B)', 1.29, 0.35, 0.59, 1.99)").run(LAB);
const add = (i: number, v: number) => Number(db.prepare("INSERT INTO qc_results (lab_id, control_lot_id, result_value, result_date) VALUES (?, 1, ?, ?)")
  .run(LAB, v, `2026-06-${String(i + 1).padStart(2, "0")}`).lastInsertRowid);
const evals: any[] = [];
for (let i = 0; i < 21; i++) {
  const id = add(i, runs[i]);
  const e = evaluateQcRun(db, LAB, 1, id, 10, 7);
  const lot = db.prepare("SELECT lab_mean FROM qc_control_lots WHERE id = 1").get() as any;
  evals.push({ id, basis: e.basis, violations: e.violations.map(v => v.rule_code), lockedAfter: lot.lab_mean != null });
}
check("5a. runs 1-20 judged on the manufacturer basis; run 21 on the lab's own",
  evals.slice(0, 20).every(e => e.basis.source === "manufacturer") && evals[20].basis.source === "established" && near(evals[20].basis.mean, first20.mean),
  `run21 basis ${evals[20].basis.label}`);
check("5b. no lock while the 20th run is the one just entered; lock on run 21 from the first 20",
  !evals[19].lockedAfter && evals[20].lockedAfter);
const locked = db.prepare("SELECT lab_mean, lab_sd, lab_basis_n, lab_basis_source FROM qc_control_lots WHERE id = 1").get() as any;
check("5c. locked values = first 20, source auto, n 20",
  near(locked.lab_mean, first20.mean) && near(locked.lab_sd, first20.sd) && locked.lab_basis_n === 20 && locked.lab_basis_source === "auto");
db.prepare("UPDATE qc_results SET voided_at = '2026-10-08' WHERE id = ?").run(evals[0].id);
const afterVoid = resolveBasis(db, LAB, 1)!;
check("5d. voiding an early run does not move the locked mean", near(afterVoid.mean, first20.mean) && afterVoid.persisted);
db.prepare("UPDATE qc_control_lots SET lab_mean = 1.0, lab_sd = 0.2, lab_basis_source = 'manual' WHERE id = 1").run();
const relock = lockEstablishedIfDue(db, LAB, 1);
const manualKept = db.prepare("SELECT lab_mean, lab_basis_source FROM qc_control_lots WHERE id = 1").get() as any;
check("5e. lock is idempotent and never overwrites a persisted basis", relock === null && manualKept.lab_mean === 1.0 && manualKept.lab_basis_source === "manual");

// 6. Plymouth shape: the same 10 runs on each basis
const ten = runs.slice(10, 20);
const ids10 = ten.map((_, k) => 100 + k);
const onMfr = westgardRulesAt(ten, ids10, 9, 1.29, 0.35, 10, 7).map(v => v.rule_code);
const onLab = westgardRulesAt(ten, ids10, 9, first20.mean, first20.sd, 10, 7).map(v => v.rule_code);
check("6. Plymouth shape: 10-x fires on the manufacturer basis, in control on the lab's own",
  onMfr.includes("10-x") && onLab.length === 0, `mfr=[${onMfr}] lab=[${onLab}]`);

// 7. a real shift the manufacturer SD hides
const shifted = first20.mean + 3.2 * first20.sd;
const s7lab = westgardRulesAt([...runs.slice(0, 5), shifted], [1, 2, 3, 4, 5, 6], 5, first20.mean, first20.sd, 10, 7).map(v => v.rule_code);
const s7mfr = westgardRulesAt([...runs.slice(0, 5), shifted], [1, 2, 3, 4, 5, 6], 5, 1.29, 0.35, 10, 7).map(v => v.rule_code);
check("7. a +3.2 SD run is 1-3s on the lab basis and nothing on the manufacturer basis",
  s7lab.includes("1-3s") && s7mfr.length === 0, `value ${shifted.toFixed(3)} lab=[${s7lab}] mfr=[${s7mfr}]`);

// 8. chart basis == next run's basis
db.prepare("UPDATE qc_control_lots SET lab_mean = NULL, lab_sd = NULL, lab_basis_source = NULL, lab_basis_n = NULL WHERE id = 1").run();
const chartBasis = resolveBasis(db, LAB, 1)!;
const nextId = add(25, 1.08);
const nextEval = evaluateQcRun(db, LAB, 1, nextId, 10, 7);
check("8. the chart's basis is exactly the basis that judges the next run",
  !!nextEval.basis && near(chartBasis.mean, nextEval.basis.mean) && near(chartBasis.sd, nextEval.basis.sd) && chartBasis.source === nextEval.basis.source,
  `${chartBasis.label}`);

// 9-10. per-lab establishing-period policy ('range' = pass/fail on the
// manufacturer's published range until the lab has its own mean and SD)
const mfrBasis = computeBasis(MFR, runs.slice(0, 9), cfg)!;
const RANGE = { low: 0.59, high: 1.99 };
const ten2 = runs.slice(0, 10), ids2 = ten2.map((_, k) => 200 + k);
const westgardMode = rulesForRun(ten2, ids2, 9, mfrBasis, RANGE, { establishN: 20, establishingRules: "westgard" }, 10, 7).map(v => v.rule_code);
const rangeMode = rulesForRun(ten2, ids2, 9, mfrBasis, RANGE, { establishN: 20, establishingRules: "range" }, 10, 7).map(v => v.rule_code);
const outside = rulesForRun([...ten2.slice(0, 9), 2.05], ids2, 9, mfrBasis, RANGE, { establishN: 20, establishingRules: "range" }, 10, 7).map(v => v.rule_code);
check("9a. establishing, 'westgard' policy: the low-running lab trips 10-x on the manufacturer mean", westgardMode.includes("10-x"), `[${westgardMode}]`);
check("9b. establishing, 'range' policy: the same run is inside the published range, no flag", rangeMode.length === 0, `[${rangeMode}]`);
check("9c. establishing, 'range' policy: 2.05 is outside 0.59-1.99, MFR-range rejection", outside.length === 1 && outside[0] === "MFR-range", `[${outside}]`);
const estBasis = computeBasis(MFR, runs.slice(0, 20), cfg)!;
const shifted2 = [...runs.slice(0, 5), first20.mean + 3.2 * first20.sd];
const afterEst = rulesForRun(shifted2, [1, 2, 3, 4, 5, 6], 5, estBasis, RANGE, { establishN: 20, establishingRules: "range" }, 10, 7).map(v => v.rule_code);
check("9d. once the lab's own numbers are established, the full rules apply even under 'range'", afterEst.includes("1-3s"), `[${afterEst}]`);
const noRange = rulesForRun(ten2, ids2, 9, mfrBasis, { low: null, high: null }, { establishN: 20, establishingRules: "range" }, 10, 7).map(v => v.rule_code);
check("10. 'range' policy on a lot with no published range falls back to the full rules", noRange.includes("10-x"), `[${noRange}]`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
