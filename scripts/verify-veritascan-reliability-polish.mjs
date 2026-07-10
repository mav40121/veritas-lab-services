// scripts/verify-veritascan-reliability-polish.mjs
//
// Receipt for the VeritaScan reliability + polish batch (scorecard #3,#4,#6,#8;
// 2026-07-10). Verifies: (3) the scan auto-save surfaces failures via a toast,
// (4) the Document Library renders distinct loading/error states instead of a
// blank "empty" table, (6) the library Excel opens on its About sheet, and
// (8) the public Document Library subtitle no longer contains an em-dash.
//
//   node scripts/verify-veritascan-reliability-polish.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

const scan = read("client/src/pages/VeritaScanScanPage.tsx");
const lib = read("client/src/pages/VeritaScanDocumentLibraryPage.tsx");
const xls = read("server/veritascanDocumentLibraryExcel.ts");

// #3 auto-save error feedback
ok("#3 ScanPage imports useToast", /import \{ useToast \} from "@\/hooks\/use-toast"/.test(scan));
ok("#3 ScanPage declares const { toast } = useToast()", /const \{ toast \} = useToast\(\)/.test(scan));
ok("#3 save onError shows a destructive toast (no longer a bare setSaveStatus)",
  /onError: \(\) => \{[\s\S]{0,220}toast\(\{[\s\S]{0,160}variant: "destructive"[\s\S]{0,40}\}\);[\s\S]{0,20}\}/.test(scan));

// #4 Document Library loading / error / empty are three distinct states
ok("#4 DocLib renders an explicit loading state", /docsQuery\.isLoading &&/.test(lib));
ok("#4 DocLib renders an explicit error state", /docsQuery\.isError && !docsQuery\.isLoading &&/.test(lib));
ok("#4 empty-state is gated on !loading && !error (not shown during load/error)",
  /!docsQuery\.isLoading && !docsQuery\.isError && docs\.length === 0/.test(lib));

// #8 em-dash removed from the public subtitle
ok("#8 no em-dash in the 'URLs only' subtitle", /URLs only\. Files stay/.test(lib) && !/URLs only —/.test(lib));

// #6 library Excel activates the About sheet on open
ok("#6 library Excel sets wb.views activeTab:0 before writeBuffer",
  /wb\.views = \[\{[\s\S]{0,120}activeTab: 0[\s\S]{0,60}\}\];\s*const buf = await wb\.xlsx\.writeBuffer/.test(xls));

console.log(fails === 0 ? "\n=== VERITASCAN RELIABILITY + POLISH: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
