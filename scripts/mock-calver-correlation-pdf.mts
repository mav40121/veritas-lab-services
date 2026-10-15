// scripts/mock-calver-correlation-pdf.mts
//
// Mock of the combined Calibration Verification / Linearity + Correlation / Method Comparison report (Michael 2026-10-15,
// Q12 = 2), rendered through the real PDF pipeline (generatePDFBuffer) from two saved studies' data:
//   - study 1769 (Michaels Lab, GC1 CREAT, 2 analyzers, 5 known levels, TEa 10% or 0.2 mg/dL)
//   - study 499 (lead, 3 analyzers, 4 known levels, TEa 10% or 2.0)
// Usage: npx tsx scripts/mock-calver-correlation-pdf.mts <outDir>
import fs from "node:fs";
import path from "node:path";
import { generatePDFBuffer } from "../server/pdfReport";
import { calculateCalVerCorrelation, type DataPoint } from "../client/src/lib/calculations";

const outDir = process.argv[2] || ".";
const cases = [
  { file: "mock_calcorr_1769.pdf", testName: "GC1 CREAT", names: ["ATELLICA 2 Run 1", "ATELLICA 2 Run 2"], tea: 0.1, floor: 0.2, unit: "%", lab: "Michaels Lab", clia: "55D5555555",
    rows: [[0.3, 0.31, 0.29], [7, 7.37, 7.37], [13.8, 14.25, 14.21], [20.5, 20.88, 20.91], [27.3, 27.22, 27.11]] },
  { file: "mock_calcorr_499.pdf", testName: "lead", names: ["Instrument 1", "Instrument 2", "Instrument 3"], tea: 0.1, floor: 2.0, unit: "%", lab: null, clia: undefined,
    rows: [[3.2, 3.2, 3.2, 3.2], [13.8, 14.3, 14.2, 13], [39, 41.4, 38.2, 43.6], [66, 66, 66, 66]] },
];

for (const c of cases) {
  const dp: DataPoint[] = c.rows.map((r, i) => ({ level: i + 1, expectedValue: r[0], instrumentValues: Object.fromEntries(c.names.map((n, k) => [n, r[k + 1]])) } as any));
  const results = calculateCalVerCorrelation(dp, c.names, c.tea, true, c.floor);
  const study: any = {
    id: 0, testName: c.testName, studyType: "cal_ver_correlation", instrument: c.names.join(", "), instruments: JSON.stringify(c.names),
    analyst: "Michael Veri", date: "2026-10-15", cliaAllowableError: c.tea, teaIsPercentage: 1, tea_is_percentage: 1, teaUnit: c.unit, tea_unit: c.unit,
    cliaAbsoluteFloor: c.floor, clia_absolute_floor: c.floor, dataPoints: JSON.stringify(dp), status: results.overallPass ? "pass" : "fail",
    _labName: c.lab,
  };
  const buf = await generatePDFBuffer(study, results, c.clia, ["TJC"]);
  const out = path.join(outDir, c.file);
  fs.writeFileSync(out, buf);
  console.log(`${c.file}: cal ver ${results.calVer.overallPass ? "PASS" : "FAIL"} ${results.calVer.passCount}/${results.calVer.totalCount}, correlation ${results.correlation?.overallPass ? "PASS" : "FAIL"} ${results.correlation?.passCount}/${results.correlation?.totalCount}, ${buf.length} bytes`);
}
process.exit(0);
