// Receipt for LHF-2 buildCoverageReportRows (server/coverageReport.ts): the
// three-way join (menu x VeritaCheck coverage x PT) that drives the Coverage
// Report export. Imports the REAL function via tsx.
import { buildCoverageReportRows } from "../server/coverageReport.ts";

const input = {
  analytes: [
    { analyte: "Glucose", specialty: "Chemistry", complexity: "MODERATE", department: "Chemistry", instrument: "Siemens Atellica CH 930", last_cal_ver: "2026-06-01" },
    { analyte: "Sodium",  specialty: "Chemistry", complexity: "MODERATE", department: "Chemistry", instrument: "Siemens Atellica CH 930" },
    { analyte: "Lipase",  specialty: "Chemistry", complexity: "MODERATE", department: "Chemistry", instrument: "Roche cobas" },
    { analyte: "Vitamin D", specialty: "Immunoassay", complexity: "HIGH", department: "Immunoassay", instrument: "Atellica CI 1900" },
  ],
  coverageRows: [
    { analyte: "Glucose", instrument: "Siemens Atellica CH 930", linearityStatus: "covered" },
    { analyte: "Sodium",  instrument: "Some Other Analyzer",     linearityStatus: "review" }, // analyte-only fallback
    { analyte: "Vitamin D", instrument: "Atellica CI 1900",       linearityStatus: "exempt" },
  ],
  methodComparisons: [
    { analyte: "Glucose", hasStudy: true },
    { analyte: "Sodium",  hasStudy: false },
  ],
  ptCoverage: [
    { analyteName: "Glucose", status: "enrolled" },
    { analyteName: "Lipase",  status: "aaa_covered" },
    { analyteName: "Vitamin D", status: "waived" },
  ],
};

const rows = buildCoverageReportRows(input);
const by = Object.fromEntries(rows.map((r) => [r.analyte, r]));
let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = got === want; console.log(`${ok?"PASS":"FAIL"}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`); ok?pass++:fail++; };

check("row count", rows.length, 4);
check("Glucose linearity Covered (analyte+instrument match)", by["Glucose"].linearityStatus, "Covered");
check("Glucose method comp Done", by["Glucose"].methodCompStatus, "Done");
check("Glucose PT Enrolled", by["Glucose"].ptStatus, "Enrolled");
check("Sodium linearity Review (analyte-only fallback)", by["Sodium"].linearityStatus, "Review");
check("Sodium method comp Needed", by["Sodium"].methodCompStatus, "Needed");
check("Sodium PT Not enrolled (no pt row)", by["Sodium"].ptStatus, "Not enrolled");
check("Lipase linearity Missing (no coverage row)", by["Lipase"].linearityStatus, "Missing");
check("Lipase method comp Not applicable", by["Lipase"].methodCompStatus, "Not applicable");
check("Lipase PT Alt. assessment", by["Lipase"].ptStatus, "Alt. assessment");
check("Vitamin D linearity Not required (exempt)", by["Vitamin D"].linearityStatus, "Not required");
check("Vitamin D PT Waived", by["Vitamin D"].ptStatus, "Waived");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
