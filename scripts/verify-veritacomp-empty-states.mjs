// scripts/verify-veritacomp-empty-states.mjs
//
// Receipt for the VeritaComp New-Assessment empty-state UX fix (scorecard sev1,
// 2026-07-10). The dialog previously dead-ended: zero active employees left Save
// disabled with no explanation, and a technical program with zero method groups
// rendered an empty form with Save still enabled (a saveable but meaningless
// assessment). This adds two guidance banners and gates Save on the method-group
// case.
//
//   node scripts/verify-veritacomp-empty-states.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaCompAppPage.tsx"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// Zero-employees banner + guidance to the Employees tab.
ok("no-employees banner gated on activeEmployees.length === 0",
  /activeEmployees\.length === 0 &&[\s\S]{0,400}No active employees in this lab/.test(src));
ok("no-employees banner points to the Employees tab",
  /No active employees in this lab[\s\S]{0,300}Employees<\/strong> tab/.test(src));

// Zero-method-groups banner + Rebuild-from-VeritaMap guidance.
ok("no-method-groups banner gated on technical + 0 method groups",
  /program\.type === "technical" && \(program\.methodGroups\?\.length \?\? 0\) === 0 &&[\s\S]{0,400}no method groups/.test(src));
ok("no-method-groups banner surfaces Rebuild from VeritaMap",
  /no method groups[\s\S]{0,400}Rebuild from VeritaMap \(lab-wide\)/.test(src));

// Save is gated so a technical program with 0 method groups cannot save.
ok("Save disabled includes the technical zero-method-groups guard",
  /disabled=\{!employeeId \|\| creating[\s\S]{0,160}program\.type === "technical" && \(program\.methodGroups\?\.length \?\? 0\) === 0\)\}/.test(src));

// The two dead-end conditions are handled with no em dashes in the new copy.
const added = (src.match(/No active employees in this lab[\s\S]{0,900}Rebuild from VeritaMap \(lab-wide\)/) || [""])[0];
ok("new guidance copy has no em dashes", !added.includes("—"));

console.log(fails === 0 ? "\n=== VERITACOMP EMPTY STATES: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
