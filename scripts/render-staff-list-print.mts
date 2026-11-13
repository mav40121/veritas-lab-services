// scripts/render-staff-list-print.mts
//
// Print check for the VeritaStaff staff list workbook (server/staffListExport.ts): builds it from made-up rows with the
// real license stamp and writes it to OUT, for Excel to print to PDF (scripts are run with a scratch DB_PATH because
// the competency module loads the database). No database rows are read or written.
// Run: DB_PATH=.tmp-render.db OUT=<dir> npx tsx scripts/render-staff-list-print.mts
import fs from "node:fs";
import { buildStaffListWorkbook } from "../server/staffListExport";
import { applyLicenseToExcelJS } from "../server/licenseStamp";

const OUT = process.env.OUT || ".";
const rows = [
  { last_name: "Adams", first_name: "Ben", middle_initial: "M", title: "Lead MLS", roles: "TC (Hematology); TP", complexity: "Moderate", performs_testing: true, competency: "Current" as const, next_due: "2027-05-01", hire_date: "2018-06-01" },
  { last_name: "Clark", first_name: "Cy", middle_initial: "", title: "Supervisor", roles: "GS", complexity: "Waived", performs_testing: false, competency: "" as const, next_due: "", hire_date: "2015-02-02" },
  { last_name: "Okonkwo-Fitzgerald", first_name: "Marisol", middle_initial: "J", title: "Medical Laboratory Scientist, Blood Bank Lead", roles: "TS (Immunohematology); TS (Chemistry); TP", complexity: "High", performs_testing: true, competency: "Overdue" as const, next_due: "2026-10-01", hire_date: "2012-04-16" },
  { last_name: "Zulu", first_name: "Amy", middle_initial: "", title: "MLS", roles: "TP; TS (entire lab)", complexity: "High", performs_testing: true, competency: "Due Soon" as const, next_due: "2026-12-01", hire_date: "2020-01-15" },
];
const buf = await buildStaffListWorkbook(
  { labName: "Made-up Gardner Regional Medical Center Laboratory", clia: "22D7790015", today: "2026-11-13", rows },
  (wb) => applyLicenseToExcelJS(wb, { licensee: "Made-up Gardner Regional Medical Center Laboratory", email: "someone.with.a.long.address@made-up-hospital.org", issueDate: "2026-11-13", productName: "VeritaStaff™" } as any),
);
fs.writeFileSync(`${OUT}/staff_list_render.xlsx`, buf);
console.log(`wrote ${OUT}/staff_list_render.xlsx (${buf.length} bytes)`);
