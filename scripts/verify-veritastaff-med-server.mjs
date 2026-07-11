// scripts/verify-veritastaff-med-server.mjs
//
// Receipt for the VeritaStaff server MED batch (audit #7 + #10, 2026-07-10):
//   #7 the staff bulk-import template shipped off-brand blue headers (FF1F4E78);
//      CLAUDE.md Sec 6 mandates teal 01696F, and the VeritaComp template already
//      uses it. Now teal.
//   #10 the CMS-209 PDF interpolated lab + employee fields without esc(), so a
//      name/address/qualifications value with & < > broke the federal-form layout.
//      Now every interpolated user field routes through the file's esc() helper.
//
//   node scripts/verify-veritastaff-med-server.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

const staffXlsx = read("server/staffBulkImport.ts");
const pdf = read("server/pdfReport.ts");

// #7 teal
ok("#7 staff import template header/title use teal 01696F", (staffXlsx.match(/FF01696F/g) || []).length >= 2);
ok("#7 no off-brand blue FF1F4E78 remains", !/FF1F4E78/.test(staffXlsx));

// #10 CMS-209 escaping
ok("#10 CMS-209 lab identity fields are esc()-wrapped",
  /Laboratory Name:<\/span> \$\{esc\(lab\.lab_name\)\}/.test(pdf) &&
  /CLIA Number:<\/span> \$\{esc\(lab\.clia_number\)\}/.test(pdf) &&
  /Address:<\/span> \$\{esc\(address\)\}/.test(pdf));
ok("#10 CMS-209 employee row fields are esc()-wrapped",
  /<td>\$\{esc\(r\.lastName\)\}<\/td>/.test(pdf) &&
  /<td>\$\{esc\(r\.firstName\)\}<\/td>/.test(pdf) &&
  /<td class="quals">\$\{esc\(r\.quals\)\}<\/td>/.test(pdf));
ok("#10 no raw (unescaped) ${r.lastName}/${r.quals}/${lab.lab_name} remain in the CMS-209 rows",
  !/<td>\$\{r\.lastName\}<\/td>/.test(pdf) && !/<td class="quals">\$\{r\.quals\}<\/td>/.test(pdf) &&
  !/Laboratory Name:<\/span> \$\{lab\.lab_name\}/.test(pdf));

console.log(fails === 0 ? "\n=== VERITASTAFF MED SERVER (#7+#10): PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
