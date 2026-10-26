// scripts/verify-correlation-run-details.mts
//
// Correlation run details (2026-10-26): reagent lot, calibrator lot and date run per analyzer, plus specimen type,
// units and comment, on Correlation / Method Comparison and Calibration Verification + Correlation. Builds the real
// report HTML with the same calculation the results page runs and checks:
//   1. parse/serialize: blanks dropped, a bad date dropped, nothing entered -> null
//   2. display rows follow the study's analyzer order and read "Reagent lot X; calibrator lot Y; run Z"
//   3. the Method Comparison report prints each row in Supporting Data, after the director's review (not on page 1)
//   4. HTML in a lot number is escaped, never injected
//   5. a study with no run details prints none of the new rows
//   6. precision (not a correlation type) is unaffected: no analyzer run rows
// Usage: npx tsx scripts/verify-correlation-run-details.mts
import { buildMethodCompHTML } from "../server/pdfReport";
import { calculateMethodComparison, type DataPoint } from "../client/src/lib/calculations";
import { parseRunDetails, serializeRunDetails, runDetailRows, hasRunDetails } from "../shared/studyRunDetails";

let fails = 0;
const check = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  :: ${detail}`}`); if (!ok) fails++; };

// 1. parse / serialize
check("1a. nothing entered stores nothing", serializeRunDetails({ specimenType: "  ", instruments: { A: { reagentLot: "", dateRun: "" } } }) === null);
const ser = serializeRunDetails({ specimenType: " Serum ", instruments: { A: { reagentLot: " 64489UD00 ", dateRun: "2026-10-20" }, B: { calibratorLot: "C2210", dateRun: "10/21/2026" } } });
check("1b. blanks trimmed, a non-ISO date dropped", ser === JSON.stringify({ specimenType: "Serum", instruments: { A: { reagentLot: "64489UD00", dateRun: "2026-10-20" }, B: { calibratorLot: "C2210" } } }), String(ser));
check("1c. bad JSON reads as none", parseRunDetails("{not json") === null);
check("1d. only the two correlation types carry run details", hasRunDetails("method_comparison") && hasRunDetails("cal_ver_correlation") && !hasRunDetails("precision") && !hasRunDetails("cal_ver"));

// 2. rows
const FRED = "Fred, Roche cobas 8000 (c702 module)", BARNEY = "Barney, Roche cobas 8000 (c702 module)";
const details = JSON.stringify({
  specimenType: "Lithium heparin plasma",
  instruments: {
    [BARNEY]: { reagentLot: "<b>64489UD00</b> exp 06 Apr 2027", calibratorLot: "C2210", dateRun: "2026-10-21" },
    [FRED]: { reagentLot: "64490UD00", dateRun: "2026-10-20" },
  },
});
const rows = runDetailRows({ runDetails: details, resultUnits: "mmol/L", comment: "Split samples, run within 2 hours" }, [FRED, BARNEY]);
check("2a. rows in study order: specimen, units, Fred, Barney, comment",
  JSON.stringify(rows.map((r) => r[0])) === JSON.stringify(["Specimen Type", "Units", FRED, BARNEY, "Comment"]), JSON.stringify(rows));
check("2b. analyzer line reads naturally", rows[2][1] === "Reagent lot 64490UD00; run 2026-10-20" && rows[3][1] === "Reagent lot <b>64489UD00</b> exp 06 Apr 2027; calibrator lot C2210; run 2026-10-21", JSON.stringify(rows.slice(2, 4)));

// 3-5. report
const data = [[120, 122], [130, 128], [140, 143]];
function build(runDetails: string | null, extra: Record<string, unknown> = {}) {
  const names = [FRED, BARNEY];
  const dp: DataPoint[] = data.map((r, i) => ({ level: i + 1, expectedValue: null, instrumentValues: { [FRED]: r[0], [BARNEY]: r[1] } } as any));
  const mapped: DataPoint[] = dp.map((d: any) => ({ ...d, expectedValue: d.instrumentValues[FRED], instrumentValues: { [BARNEY]: d.instrumentValues[BARNEY] } }));
  const results = calculateMethodComparison(mapped, [BARNEY], 4, false, null);
  const study: any = {
    testName: "Sodium", studyType: "method_comparison", instrument: names.join(", "), instruments: JSON.stringify(names),
    analyst: "Michael Veri", date: "2026-10-21", cliaAllowableError: 4, teaIsPercentage: 0, tea_is_percentage: 0,
    teaUnit: "mmol/L", tea_unit: "mmol/L", dataPoints: dp, status: "pass", runDetails, ...extra,
  };
  return buildMethodCompHTML(study, results as any);
}
const html = build(details, { resultUnits: "mmol/L", comment: "Split samples, run within 2 hours" });
const supportIdx = html.indexOf("Supporting Data &amp; User Specifications");
const reviewIdx = html.indexOf("Accepted for patient testing"); // the director review block (directorReviewHTML)
const support = html.slice(supportIdx);
check("3a. the Supporting Data section comes after the director's review", reviewIdx > 0 && supportIdx > reviewIdx, `review ${reviewIdx}, support ${supportIdx}`);
check("3b. Supporting Data prints specimen type, units, both analyzers and the comment",
  ["Lithium heparin plasma", "mmol/L", "Reagent lot 64490UD00; run 2026-10-20", "calibrator lot C2210; run 2026-10-21", "Split samples, run within 2 hours"].every((t) => support.includes(t)));
check("3c. the run details are not on page 1", !html.slice(0, reviewIdx).includes("64490UD00"));
check("4. HTML in a lot number is escaped", support.includes("&lt;b&gt;64489UD00&lt;/b&gt;") && !support.includes("<b>64489UD00</b>"));
const none = build(null);
check("5. no run details prints none of the new rows", !none.includes("Specimen Type") && !none.includes("Reagent lot"));
check("6. precision rows are unaffected (no analyzer run lines for other types)", runDetailRows({ runDetails: null, resultUnits: null, comment: null }).length === 0);

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
