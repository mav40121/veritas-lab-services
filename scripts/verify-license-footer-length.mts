// scripts/verify-license-footer-length.mts
//
// Receipt for the 255-character header and footer rule in shared/licenseExceljs.ts (2026-11-13). Excel opens a
// workbook whose header or footer is longer than 255 characters only in repair mode, and the repair drops it; the
// license stamp used to append its line to a sheet's own footer with no limit (the staff list download came to 282
// characters with an ordinary lab name and email). Cases:
//   1. A short footer and short licensee keep the full license line (licensee and email), as before.
//   2. A long sheet footer plus a long licensee and email stays within 255: the email goes first, the sheet's own
//      lab identity always stays, and the even-page footer matches.
//   3. A sheet with no footer gets the license footer with page numbers, within 255.
//   4. A demo lab keeps the sample-data mark in the footer even when nothing else fits.
//   5. A literal & in the licensee is written && (a lone & starts a header or footer code).
//   6. A footer already over 255 on its own is left as the sheet set it (nothing appended).
// Run: npx tsx scripts/verify-license-footer-length.mts
import ExcelJS from "exceljs";
import { applyLicenseToExcelJSWorkbook, HEADER_FOOTER_MAX } from "../shared/licenseExceljs";
import { SAMPLE_DATA_FOOTER } from "../shared/licenseText";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const identityFooter = (lab: string) => `&L&"Calibri,Regular"&9${lab}    CLIA: 22D0999990&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
const stamp = (footer: string | null, ctx: Record<string, unknown>) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data");
  ws.addRow(["x"]);
  if (footer !== null) ws.headerFooter.oddFooter = footer;
  applyLicenseToExcelJSWorkbook(wb, { issueDate: "2026-11-13", ...ctx } as any);
  return ws.headerFooter as any;
};

// 1.
const short = stamp(identityFooter("Lab A"), { licensee: "Lab A", email: "a@b.org" });
check("1. short: the full license line with licensee and email is appended", String(short.oddFooter).includes("Licensed to: Lab A (a@b.org) | Issued 2026-11-13 | Do not redistribute"), short.oddFooter);
check("1. short: within 255", String(short.oddFooter).length <= HEADER_FOOTER_MAX);

// 2.
const longLab = "Made-up Gardner Regional Medical Center Laboratory";
const long = stamp(identityFooter(longLab), { licensee: longLab, email: "someone.with.a.long.address@made-up-hospital-system.org" });
const f2 = String(long.oddFooter);
check("2. long: within 255", f2.length <= HEADER_FOOTER_MAX, `${f2.length}`);
check("2. long: the sheet's own lab identity stays", f2.includes(`${longLab}    CLIA: 22D0999990`));
check("2. long: the copyright line is still there", f2.includes("© 2026 Veritas Lab Services, LLC"));
check("2. long: the email is the first thing dropped", !f2.includes("someone.with.a.long.address"));
check("2. long: the even-page footer is the same", long.evenFooter === long.oddFooter);

// 3.
const none = stamp(null, { licensee: longLab, email: "someone.with.a.long.address@made-up-hospital-system.org" });
check("3. no footer: the license footer with page numbers, within 255", String(none.oddFooter).includes("&RPage &P of &N") && String(none.oddFooter).length <= HEADER_FOOTER_MAX, none.oddFooter);

// 4.
const tight = identityFooter("X".repeat(90)); // only the sample-data mark still fits after this
const demo = stamp(tight, { licensee: longLab, email: "someone.with.a.long.address@made-up-hospital-system.org", isDemo: true });
check("4. demo: the sample-data mark is in the footer", String(demo.oddFooter).includes(SAMPLE_DATA_FOOTER), demo.oddFooter);
check("4. demo: within 255", String(demo.oddFooter).length <= HEADER_FOOTER_MAX, `${String(demo.oddFooter).length}`);

// 5.
const amp = stamp(identityFooter("Lab B"), { licensee: "Lab B & Clinic", email: "b@c.org" });
check("5. a literal & in the licensee is written &&", String(amp.oddFooter).includes("Licensed to: Lab B && Clinic"), amp.oddFooter);

// 6.
const over = "&L" + "y".repeat(260);
const left = stamp(over, { licensee: "Lab C", email: "c@d.org" });
check("6. a footer already over 255 is left as the sheet set it", left.oddFooter === over);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
