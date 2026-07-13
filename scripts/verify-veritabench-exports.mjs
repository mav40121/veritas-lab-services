// scripts/verify-veritabench-exports.mjs
//
// Receipt for the VeritaBench Excel-export batch (2026-07-12):
//   #9  the productivity + staffing Excel exports resolved lab identity from the
//       account-owner users row (person-name fallback, wrong lab for a secondary
//       lab). Now resolve the SELECTED lab from the labs table (like the Leverage
//       PDF), falling back through users.clia_lab_name, never to users.name.
//   #11 8+ em-dash escapes in the customer-facing Excel About cells. All removed.
//   #21 the staffing Averages sheet had no real auto-filter (Sec 6). Added.
//
//   node scripts/verify-veritabench-exports.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "server/veritabench.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// #9 identity from labs, both export routes (identical block -> 2 occurrences)
ok("#9 exports resolve the selected lab from the labs table (both routes)",
  (src.match(/const idLabRow = idLabId != null\s*\n\s*\? sqlite\.prepare\("SELECT lab_name, clia_number FROM labs WHERE id = \?"\)/g) || []).length === 2);
ok("#9 labName prefers labs.lab_name then users.clia_lab_name (no users.name fallback)",
  (src.match(/const labName = idLabRow\?\.lab_name \|\| ownerRow\?\.clia_lab_name \|\| "Laboratory";/g) || []).length === 2);
ok("#9 cliaNumber prefers labs.clia_number then users.clia_number",
  (src.match(/const cliaNumber = idLabRow\?\.clia_number \|\| ownerRow\?\.clia_number \|\| "Not on file";/g) || []).length === 2);
ok("#9 the old person-name identity fallback is gone",
  !/ownerRow\?\.clia_lab_name \|\| ownerRow\?\.name \|\| "Laboratory"/.test(src));
ok("#9 the identity users SELECT no longer pulls the person's name column",
  !/SELECT clia_lab_name, clia_number, name FROM users WHERE id = \?/.test(src));

// #11 no em-dash escapes remain
const esc = String.fromCharCode(92) + "u2014";
ok("#11 no em-dash (\\u2014) escape remains in veritabench.ts", !src.includes(esc));
ok("#11 no literal em-dash char remains in veritabench.ts", !src.includes("—"));

// #21 staffing Averages auto-filter
ok("#21 the staffing Averages sheet sets a real auto-filter",
  /wsAvg\.autoFilter = \{ from: "A1", to: "O25" \};/.test(src));

console.log(fails === 0 ? "\n=== VERITABENCH EXPORTS: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
