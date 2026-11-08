// tests/integration/units-limit-rule.test.ts
//
// Receipt for Q239 = 1 (Michael 2026-11-08). Four presets store their criterion
// in units (Sodium ±4 mmol/L, Potassium ±0.3 mmol/L, Calcium ±1.0 mg/dL, pH
// ±0.04); precision and lot-to-lot read that number as a percent, so Sodium
// was judged at 400% CV. Boots the REAL routes against a throwaway SQLite DB
// (DB_PATH from the runner) with made-up studies and proves:
//   1. the stored verdict (computeStudyStatus) now reads a units criterion:
//      precision passes a level when 2 SD is within it; lot-to-lot compares the
//      differences in units; the old percent reading would have passed both
//   2. the screen's calculators agree with the stored verdict, including a
//      percent criterion's absolute floor (Glucose ±8% or ±6 mg/dL), which
//      the server applied and the screen did not
//   3. the boot recompute leaves saved units-criterion precision and lot-to-lot
//      rows as saved, and still corrects a percent row
//   4. GET /api/admin/veritacheck/units-limit-counts refuses without the
//      secret and answers counts, lab ids and preset names only
//   5. Q240 = 1 (same day): linearity (EP06) with a units limit passes when every
//      level's mean is within the limit of its assigned value and r² >= 0.95, on
//      the server and the screen; before, it was judged as 100% slope error, so
//      r² alone decided. A percent limit keeps the slope test. Saved units
//      linearity rows stay as saved, and the counts read includes them.
//
// Run: rm -f .tmp-units.db && DB_PATH=.tmp-units.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/units-limit-rule.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

// Made-up replicates with a chosen SD: mean m, alternating m ± d (sample SD just over d).
const reps = (m: number, d: number, n = 20) => Array.from({ length: n }, (_, i) => +(m + (i % 2 ? d : -d)).toFixed(4));
const sdOf = (v: number[]) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); };

async function main() {
  const { db } = await import("../../server/db");
  const { computeStudyStatus, recomputeAllStudyStatuses, isUnitsRuleStudy, registerRoutes } = await import("../../server/routes");
  const { calculatePrecision, calculateLotToLot } = await import("../../client/src/lib/calculations");
  const sqlite = (db as any).$client;

  // ── 1 and 2: rule, server and screen ──
  const sodiumOk = [{ level: 1, levelName: "Level 1", values: reps(140, 1.5) }];   // 2 SD about 3.1 mmol/L, within 4
  const sodiumBad = [{ level: 1, levelName: "Level 1", values: reps(140, 2.5) }];  // 2 SD about 5.1 mmol/L; CV 1.8%
  const potassiumBad = [{ level: 1, levelName: "Level 1", values: reps(4.0, 0.2) }]; // 2 SD about 0.41 > 0.3; CV 5%
  const glucoseFloor = [{ level: 1, levelName: "Level 1", values: reps(30, 2.6) }]; // CV about 8.9% > 8%, 2 SD about 5.3 <= 6
  check("made-up Sodium SD is about 1.54", Math.abs(sdOf(sodiumOk[0].values) - 1.54) < 0.01, String(sdOf(sodiumOk[0].values)));

  const srv = (dp: unknown, tea: number, isPct: boolean, floor: number | null = null) =>
    computeStudyStatus("precision", JSON.stringify(dp), "[\"A\"]", tea, isPct, floor);
  const scr = (dp: any, tea: number, isPct: boolean, floor: number | null = null, unit = "mmol/L") =>
    calculatePrecision(dp, tea, "simple", { teaIsPercentage: isPct, absoluteFloor: floor, unit }).overallPass ? "pass" : "fail";

  check("precision Sodium ±4 mmol/L, 2 SD 3.1: pass on server and screen", srv(sodiumOk, 4, false) === "pass" && scr(sodiumOk, 4, false) === "pass");
  check("precision Sodium ±4 mmol/L, 2 SD 5.1: fail on server and screen", srv(sodiumBad, 4, false) === "fail" && scr(sodiumBad, 4, false) === "fail");
  check("precision Sodium, the old percent reading (400%) would have passed it", srv(sodiumBad, 4, true) === "pass");
  check("precision Potassium ±0.3 mmol/L, 2 SD 0.41: fail on server and screen", srv(potassiumBad, 0.3, false) === "fail" && scr(potassiumBad, 0.3, false) === "fail");
  check("precision Potassium, the old percent reading (30%) would have passed it", srv(potassiumBad, 0.3, true) === "pass");
  check("precision Glucose ±8% or ±6 mg/dL, CV 8.9% and 2 SD 5.3: pass on server and screen (the floor)",
    srv(glucoseFloor, 0.08, true, 6) === "pass" && scr(glucoseFloor, 0.08, true, 6, "mg/dL") === "pass");
  check("precision Glucose without the floor fails, so the floor is what passes it", srv(glucoseFloor, 0.08, true, null) === "fail");
  const prUnits = calculatePrecision(sodiumBad as any, 4, "simple", { teaIsPercentage: false, unit: "mmol/L" });
  check("precision summary states the limit in units, no 400.0%", prUnits.summary.includes("±4 mmol/L") && !prUnits.summary.includes("400.0%"), prUnits.summary);

  const lot = (pairs: Array<[number, number]>) => ({
    data: pairs.map(([c, n], i) => ({ specimenId: `S${i + 1}`, currentLot: c, newLot: n, cohort: "Normal" })), sampleType: "normal",
  });
  const lotOk = lot([[138, 139], [140, 141.5], [142, 143], [135, 134], [145, 146]]);      // all within 4 mmol/L
  const lotBad = lot([[138, 144], [140, 146], [142, 147], [135, 141], [145, 150]]);       // 5 to 6 mmol/L apart, about 4%
  const lotSrv = (d: any, tea: number, isPct: boolean) => computeStudyStatus("lot_to_lot", JSON.stringify(d), "[\"A\"]", tea, isPct, null);
  const lotScr = (d: any, tea: number, isPct: boolean) => calculateLotToLot(d.data, tea, d.sampleType, isPct, null, "mmol/L").overallPass ? "pass" : "fail";
  check("lot Sodium ±4 mmol/L, pairs within 1.5: pass on server and screen", lotSrv(lotOk, 4, false) === "pass" && lotScr(lotOk, 4, false) === "pass");
  check("lot Sodium ±4 mmol/L, pairs 5 to 6 apart: fail on server and screen", lotSrv(lotBad, 4, false) === "fail" && lotScr(lotBad, 4, false) === "fail");
  check("lot Sodium, the old percent reading (400%) would have passed it", lotSrv(lotBad, 4, true) === "pass");
  const lotRes = calculateLotToLot(lotBad.data as any, 4, "normal", false, null, "mmol/L");
  check("lot summary speaks in mmol/L, no 400.0%", lotRes.summary.includes("±4 mmol/L") && lotRes.summary.includes("Mean |Diff| = 5.60 mmol/L") && !lotRes.summary.includes("400.0%"), lotRes.summary);

  // ── 5: linearity (Q240 = 1) ──
  const { computeStudyResults } = await import("../../client/src/lib/studyResults");
  const lin = (means: number[], assigned = [110, 130, 150, 170]) => ({
    analyte: "Sodium", units: "mmol/L",
    levels: assigned.map((a, i) => ({ name: `L${i + 1}`, assigned_value: a, replicates: [means[i] - 0.5, means[i], means[i] + 0.5] })),
  });
  const linOk = lin([111, 131.5, 151, 172]);           // every level within 4 mmol/L
  const linSlope = lin([115.5, 136.5, 157.5, 178.5]);  // slope 1.05: 5.5 to 8.5 mmol/L off, r² 1
  const linOffset = lin([115, 135, 155, 175]);         // slope 1.00, a constant 5 mmol/L offset
  const linSrv = (d: any, tea: number, isPct: boolean) => computeStudyStatus("linearity", JSON.stringify(d), "[\"A\"]", tea, isPct, null);
  const linScr = (d: any, tea: number, isPct: number, unit = "mmol/L") => (computeStudyResults({
    id: 1, testName: "Sodium", studyType: "linearity", cliaAllowableError: tea, teaIsPercentage: isPct, teaUnit: isPct ? "%" : unit,
    cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, dataPoints: JSON.stringify(d), instruments: "[\"A\"]",
  } as any) as any);
  check("linearity Sodium ±4 mmol/L, every level within 4: pass on server and screen", linSrv(linOk, 4, false) === "pass" && linScr(linOk, 4, 0).overallPass === true);
  check("linearity Sodium ±4 mmol/L, slope 1.05: fail on server and screen", linSrv(linSlope, 4, false) === "fail" && linScr(linSlope, 4, 0).overallPass === false);
  check("linearity Sodium ±4 mmol/L, constant 5 mmol/L offset: fail on server and screen", linSrv(linOffset, 4, false) === "fail" && linScr(linOffset, 4, 0).overallPass === false);
  check("linearity Sodium, the old reading (slope error allowed to 100%, r² alone) would have passed both", linSrv(linSlope, 1.0, true) === "pass" && linSrv(linOffset, 1.0, true) === "pass");
  const linRes = linScr(linSlope, 4, 0);
  check("linearity summary speaks in mmol/L: 4 of 4 level means outside ±4 mmol/L, largest difference 8.500",
    linRes.summary.includes("4 of 4 level means differ from the assigned value by more than ±4 mmol/L") && linRes.summary.includes("largest difference 8.500 mmol/L"), linRes.summary);
  check("linearity percent limit keeps the slope test: Albumin ±8%, slope 1.05 pass and slope 1.10 fail, server and screen",
    linSrv(linSlope, 0.08, true) === "pass" && linScr(linSlope, 0.08, 1).overallPass === true
      && linSrv(lin([121, 143, 165, 187]), 0.08, true) === "fail" && linScr(lin([121, 143, 165, 187]), 0.08, 1).overallPass === false);

  // ── 3: the boot recompute leaves saved units rows alone ──
  const ins = sqlite.prepare(
    `INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, status, created_at, clia_preset_label)
     VALUES (1, ?, ?, 'Made-up Analyzer', 'made-up', '2026-11-08', ?, ?, ?, ?, ?, '["Made-up Analyzer"]', ?, '2026-11-08T00:00:00Z', ?)`
  );
  // Made-up lab ids 901 to 903 have no labs row on this throwaway DB; the counts read only groups by the number.
  sqlite.pragma("foreign_keys = OFF");
  const savedPrecision = Number(ins.run(901, "Sodium", "precision", 4, 0, "mmol/L", JSON.stringify(sodiumBad), "pass", "Sodium (±4 mmol/L)").lastInsertRowid);
  const savedLot = Number(ins.run(902, "Sodium", "lot_to_lot", 4, 0, "mmol/L", JSON.stringify(lotBad), "pass", "Sodium (±4 mmol/L)").lastInsertRowid);
  const savedOkLot = Number(ins.run(902, "Sodium", "lot_to_lot", 4, 0, "mmol/L", JSON.stringify(lotOk), "pass", "Sodium (±4 mmol/L)").lastInsertRowid);
  const percentRow = Number(ins.run(903, "Albumin", "precision", 0.08, 1, "%", JSON.stringify([{ level: 1, levelName: "Level 1", values: reps(4, 0.05) }]), "fail", "Albumin (±8%)").lastInsertRowid);
  const savedLin = Number(ins.run(904, "Sodium", "linearity", 4, 0, "mmol/L", JSON.stringify(linSlope), "pass", "Sodium (±4 mmol/L)").lastInsertRowid);
  sqlite.pragma("foreign_keys = ON");
  const status = (id: number) => (sqlite.prepare("SELECT status FROM studies WHERE id = ?").get(id) as any)?.status;
  check("isUnitsRuleStudy: units precision yes, percent precision no, units cal ver no",
    isUnitsRuleStudy({ studyType: "precision", teaIsPercentage: 0 }) && !isUnitsRuleStudy({ studyType: "precision", teaIsPercentage: 1 }) && !isUnitsRuleStudy({ studyType: "cal_ver", teaIsPercentage: 0 }));
  recomputeAllStudyStatuses();
  check("boot recompute leaves a saved units precision study as saved (pass)", status(savedPrecision) === "pass", status(savedPrecision));
  check("boot recompute leaves a saved units lot study as saved (pass)", status(savedLot) === "pass", status(savedLot));
  check("boot recompute still corrects a percent row (fail -> pass)", status(percentRow) === "pass", status(percentRow));
  check("isUnitsRuleStudy: units linearity yes, percent linearity no", isUnitsRuleStudy({ studyType: "linearity", teaIsPercentage: 0 }) && !isUnitsRuleStudy({ studyType: "linearity", teaIsPercentage: 1 }));
  check("boot recompute leaves a saved units linearity study as saved (pass)", status(savedLin) === "pass", status(savedLin));

  // ── 4: the counts read ──
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const noSecret = await fetch(`${base}/api/admin/veritacheck/units-limit-counts`);
  check("counts read refuses without the secret (403)", noSecret.status === 403, String(noSecret.status));
  const r = await fetch(`${base}/api/admin/veritacheck/units-limit-counts`, { headers: { "x-admin-secret": process.env.ADMIN_SECRET! } });
  const j: any = await r.json();
  check("counts read answers 200", r.status === 200, String(r.status));
  check("counts: 1 precision study, saved pass, would change pass -> fail",
    j.byType?.precision?.total === 1 && j.byType.precision.savedPass === 1 && j.byType.precision.wouldChange === 1 && j.byType.precision.passToFail === 1, JSON.stringify(j.byType?.precision));
  check("counts: 2 lot studies, 1 would change", j.byType?.lot_to_lot?.total === 2 && j.byType.lot_to_lot.wouldChange === 1 && j.byType.lot_to_lot.newRulePass === 1, JSON.stringify(j.byType?.lot_to_lot));
  check("counts by lab id: 901 has 1 changing, 902 has 1 of 2", j.byLab?.["901"]?.wouldChange === 1 && j.byLab?.["902"]?.total === 2 && j.byLab["902"].wouldChange === 1, JSON.stringify(j.byLab));
  check("counts: 1 linearity study, saved pass, would change pass -> fail, lab 904",
    j.byType?.linearity?.total === 1 && j.byType.linearity.savedPass === 1 && j.byType.linearity.passToFail === 1 && j.byLab?.["904"]?.wouldChange === 1, JSON.stringify(j.byType?.linearity));
  const text = JSON.stringify(j);
  check("counts read carries no study id, analyst or values", !text.includes(`"id"`) && !text.includes("made-up") && !text.includes("140") && !/"Sodium"(?! \()/.test(text), text);
  check("the counts read wrote nothing", status(savedPrecision) === "pass" && status(savedLot) === "pass" && status(savedOkLot) === "pass" && status(savedLin) === "pass");
  server.close();

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
