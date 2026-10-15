// scripts/verify-calver-correlation.mts
//
// Calibration Verification + Correlation (cal_ver_correlation; Michael 2026-10-15, Q12 = 2, Q13 = 1), plus BUG-060
// (signing a study did not re-stamp the VeritaMap dates). Checks:
//   1. study 1769's data (2 analyzers): cal ver PASS 10/10, correlation PASS 5/5, overall PASS
//   2. study 499's data (3 analyzers): cal ver FAIL 11/12 (Instrument 3 at L3, +11.8%), correlation PASS 8/8, overall FAIL
//   3. report page 1 (499): both verdicts in key statistics, both determinations with 493.1255(b)(3) and 493.1281(a),
//      the failing analyzer named, the material and "not patient specimens", one signature block
//   4. a named material prints instead of the default wording
//   5. absolute TEa (in-memory fixture): Bland-Altman and errors in units, never a percent of 400
//   6. real stampMapDatesFromStudies on an in-memory map: an unsigned passing combined study stamps the correlation date
//      only; once signed it also stamps the cal ver date (both analyzers credited)
//   7. server source: computeStudyStatus has a cal_ver_correlation branch that runs both the cal_ver and the
//      method_comparison rule; signing (finalizeStudyRowInPlace) re-stamps the map (BUG-060)
//   8. client source: the study type is offered, needs two analyzers, and is computed with calculateCalVerCorrelation
// Usage: npx tsx scripts/verify-calver-correlation.mts
import fs from "node:fs";
import Database from "better-sqlite3";
import { buildCalVerCorrelationHTML } from "../server/pdfReport";
import { stampMapDatesFromStudies } from "../server/veritacheckCoverage";
import { calculateCalVerCorrelation, type DataPoint } from "../client/src/lib/calculations";

let fails = 0;
const check = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
const src = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf-8");

function run(names: string[], rows: number[][], tea: number, pct: boolean, floor: number | null) {
  const dp: DataPoint[] = rows.map((r, i) => ({ level: i + 1, expectedValue: r[0], instrumentValues: Object.fromEntries(names.map((n, k) => [n, r[k + 1]])) } as any));
  return { dp, res: calculateCalVerCorrelation(dp, names, tea, pct, floor) };
}
function html(testName: string, names: string[], dp: DataPoint[], res: any, tea: number, pct: boolean, unit: string, floor: number | null, material?: string) {
  const study: any = { testName, studyType: "cal_ver_correlation", instrument: names.join(", "), instruments: JSON.stringify(names), analyst: "QA", date: "2026-10-15",
    cliaAllowableError: tea, teaIsPercentage: pct ? 1 : 0, tea_is_percentage: pct ? 1 : 0, teaUnit: unit, tea_unit: unit, cliaAbsoluteFloor: floor, clia_absolute_floor: floor,
    dataPoints: JSON.stringify(dp), status: res.overallPass ? "pass" : "fail", material };
  const h = buildCalVerCorrelationHTML(study, res);
  return { h, page1: h.split("Continued from page 1")[0] };
}

// 1 + 2: the two saved studies' data.
const A = run(["ATELLICA 2 Run 1", "ATELLICA 2 Run 2"], [[0.3, 0.31, 0.29], [7, 7.37, 7.37], [13.8, 14.25, 14.21], [20.5, 20.88, 20.91], [27.3, 27.22, 27.11]], 0.1, true, 0.2);
check("1. study 1769 data: cal ver PASS 10/10, correlation PASS 5/5, overall PASS",
  A.res.calVer.overallPass && A.res.calVer.passCount === 10 && A.res.calVer.totalCount === 10 && !!A.res.correlation?.overallPass && A.res.correlation?.passCount === 5 && A.res.correlation?.totalCount === 5 && A.res.overallPass && A.res.primary === "ATELLICA 2 Run 1");
const N3 = ["Instrument 1", "Instrument 2", "Instrument 3"];
const B = run(N3, [[3.2, 3.2, 3.2, 3.2], [13.8, 14.3, 14.2, 13], [39, 41.4, 38.2, 43.6], [66, 66, 66, 66]], 0.1, true, 2.0);
const l3 = B.res.calVer.levelResults[2].instruments["Instrument 3"];
check("2. study 499 data: cal ver FAIL 11/12 (Instrument 3 at L3), correlation PASS 8/8, overall FAIL",
  !B.res.calVer.overallPass && B.res.calVer.passCount === 11 && B.res.calVer.totalCount === 12 && l3.passFail === "Fail"
  && !!B.res.correlation?.overallPass && B.res.correlation?.passCount === 8 && !B.res.overallPass, JSON.stringify({ cv: [B.res.calVer.passCount, B.res.calVer.totalCount], mc: [B.res.correlation?.passCount, B.res.correlation?.totalCount] }));

// 3: report page 1.
const b = html("lead", N3, B.dp, B.res, 0.1, true, "%", 2.0);
check("3. page 1: both verdicts, both determinations with their CFR, failing analyzer, material, one signature block",
  b.page1.includes("FAIL (11/12)") && b.page1.includes("PASS (8/8)") && b.page1.includes("Primary for the correlation")
  && /Calibration verification: each level on each analyzer was individually evaluated[^<]*42 CFR §493\.1255\(b\)\(3\)\)\. One or more levels did not satisfy this criterion \(Instrument 3\)/.test(b.page1)
  && /Correlation: each sample on each comparison analyzer was individually evaluated[^<]*42 CFR §493\.1281\(a\)\)\. All samples on every comparison analyzer satisfied this criterion\./.test(b.page1)
  && b.page1.includes("The comparison used calibration verification material with assigned values, not patient specimens.")
  && b.page1.includes("Final approval and clinical determination must be made by the laboratory director or designee.")
  && (b.page1.match(/Laboratory Director or Designee Review/gi) || []).length === 1);
const a = html("GC1 CREAT", ["ATELLICA 2 Run 1", "ATELLICA 2 Run 2"], A.dp, A.res, 0.1, true, "%", 0.2, "Bio-Rad Liquichek Linearity, lot 12345");
check("4. a named material prints instead of the default", a.page1.includes("The comparison used Bio-Rad Liquichek Linearity, lot 12345, not patient specimens.") && !a.page1.includes("material with assigned values"));

// 5: absolute TEa (in-memory fixture, not lab data).
const C = run(["Fred", "Barney"], [[118, 119, 120], [130, 128, 129], [142, 143, 141]], 4, false, null);
const c = html("Sodium", ["Fred", "Barney"], C.dp, C.res, 4, false, "mmol/L", null);
check("5. absolute TEa: Bland-Altman limits ±4 mmol/L, errors in units, no 400%",
  c.page1.includes("Bland-Altman (limits ±4 mmol/L)") && c.page1.includes("2.00 mmol/L") && !/±400|400%/.test(c.h) && C.res.overallPass);

// 6: the real map stamp on an in-memory map (table definitions copied from production).
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE veritamap_maps (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, instruments TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, lab_id INTEGER);
  CREATE TABLE veritamap_instruments (id INTEGER PRIMARY KEY AUTOINCREMENT, map_id INTEGER NOT NULL, instrument_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'Primary', category TEXT NOT NULL DEFAULT 'Chemistry', created_at TEXT NOT NULL, serial_number TEXT, nickname TEXT);
  CREATE TABLE veritamap_instrument_tests (id INTEGER PRIMARY KEY AUTOINCREMENT, instrument_id INTEGER NOT NULL, map_id INTEGER NOT NULL, analyte TEXT NOT NULL, specialty TEXT NOT NULL, complexity TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, linearity_exempt_multical INTEGER NOT NULL DEFAULT 0, linearity_exempt_noncal INTEGER NOT NULL DEFAULT 0, linearity_exempt_waived INTEGER NOT NULL DEFAULT 0, linearity_exempt_other TEXT, ifu_url TEXT, UNIQUE(instrument_id, analyte));
  CREATE TABLE veritamap_tests (id INTEGER PRIMARY KEY AUTOINCREMENT, map_id INTEGER NOT NULL, analyte TEXT NOT NULL, specialty TEXT NOT NULL, complexity TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, instrument_source TEXT, last_cal_ver TEXT, last_method_comp TEXT, last_precision TEXT, last_sop_review TEXT, notes TEXT, updated_at TEXT NOT NULL, cal_ver_na INTEGER NOT NULL DEFAULT 0, method_comp_na INTEGER NOT NULL DEFAULT 0, UNIQUE(map_id, analyte));
  CREATE TABLE studies (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER, test_name TEXT, instrument TEXT, study_type TEXT, status TEXT, lifecycle_state TEXT, date TEXT, finalized_at TEXT, coverage_analyte TEXT, archived_at TEXT);
  INSERT INTO veritamap_maps (id, user_id, name, created_at, updated_at, lab_id) VALUES (1, 1, 'Chem', '2026-10-01', '2026-10-01', 99);
  INSERT INTO veritamap_instruments (id, map_id, instrument_name, created_at, nickname) VALUES (1, 1, 'Roche cobas 8000 (c702 module)', '2026-10-01', 'Fred'), (2, 1, 'Roche cobas 8000 (c702 module)', '2026-10-01', 'Barney');
  INSERT INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity) VALUES (1, 1, 'Sodium', 'General Chemistry', 'MODERATE'), (2, 1, 'Sodium', 'General Chemistry', 'MODERATE');
  INSERT INTO veritamap_tests (map_id, analyte, specialty, complexity, updated_at) VALUES (1, 'Sodium', 'General Chemistry', 'MODERATE', '2026-10-01');
  INSERT INTO studies (id, lab_id, test_name, instrument, study_type, status, lifecycle_state, date) VALUES (1, 99, 'Sodium', 'Fred, Roche cobas 8000 (c702 module), Barney, Roche cobas 8000 (c702 module)', 'cal_ver_correlation', 'pass', 'completed', '2026-10-15');
  -- BUG-061: an abandoned unsigned draft for the same analyte and analyzers must not block the cal ver stamp.
  INSERT INTO studies (id, lab_id, test_name, instrument, study_type, status, lifecycle_state, date) VALUES (2, 99, 'Sodium', 'Fred, Roche cobas 8000 (c702 module), Barney, Roche cobas 8000 (c702 module)', 'cal_ver_correlation', 'fail', 'draft', '2026-10-14');
`);
const row = () => db.prepare("SELECT last_cal_ver, last_method_comp FROM veritamap_tests WHERE analyte = 'Sodium'").get() as any;
stampMapDatesFromStudies(db, 99);
const unsigned = row();
db.prepare("UPDATE studies SET lifecycle_state = 'finalized', finalized_at = '2026-10-15T15:00:00Z' WHERE id = 1").run();
stampMapDatesFromStudies(db, 99);
const signed = row();
check("6. map stamp: unsigned stamps the correlation date only; signed also stamps cal ver, even beside an unsigned draft (BUG-061)",
  unsigned.last_method_comp === "2026-10-15" && !unsigned.last_cal_ver && signed.last_cal_ver === "2026-10-15" && signed.last_method_comp === "2026-10-15",
  JSON.stringify({ unsigned, signed }));

// 7: server source.
const routes = src("server/routes.ts");
const branch = routes.slice(routes.indexOf('if (studyType === "cal_ver_correlation") {'), routes.indexOf('if (studyType === "cal_ver") {'));
const fin = routes.slice(routes.indexOf("function finalizeStudyRowInPlace("), routes.indexOf("function applyStudyFinalize("));
check("7. server: status runs the cal_ver AND method_comparison rules; signing re-stamps the map (BUG-060)",
  branch.includes('computeStudyStatus("cal_ver"') && branch.includes('computeStudyStatus("method_comparison"') && /cvStatus === "pass" && mcStatus === "pass"/.test(branch)
  && fin.includes('restampMapForStudy(studyRow, "finalize")') && /new Set\(\[[^\]]*"cal_ver_correlation"\]\)/.test(src("server/veritacheckCoverage.ts")));

// 8: client source.
const page = src("client/src/pages/VeritaCheckPage.tsx");
check("8. client: the type is offered, needs two analyzers, computed with calculateCalVerCorrelation",
  page.includes('<SelectItem value="cal_ver_correlation">Calibration Verification + Correlation (CLSI EP06 + EP09)</SelectItem>')
  && page.includes('studyType === "cal_ver_correlation" && instrumentNames.length < 2') && page.includes("calculateCalVerCorrelation(toNumericDataPoints(dataPoints)")
  && src("client/src/pages/StudyResultsPage.tsx").includes("calculateCalVerCorrelation(rawDataPoints as DataPoint[]"));

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
