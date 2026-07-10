// scripts/verify-veritapolicy-med-server.mjs
//
// Receipt for the VeritaPolicy server MED batch (audit #8/#9, 2026-07-10):
//   #8 em-dashes shipped in the customer-facing Excel About sheets of both the
//      lab-scoped and legacy export routes (CLAUDE.md Sec 6 rule 6 + Sec 3).
//   #9 "Edit policy details" could not move a policy to Unassigned: the documents
//      PATCH used manual_id = COALESCE(?, manual_id), so the null the client sends
//      to clear the manual was ignored while the toast said "Saved".
//
//   node scripts/verify-veritapolicy-med-server.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routes = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// #8: the two VeritaPolicy About paragraphs no longer contain an em-dash (literal
// char or the — escape) in either export route.
const aboutLines = routes.split("\n").filter(l => /aboutBody\('(Sections:|Every laboratory)/.test(l));
ok("#8 found both VeritaPolicy About paragraphs in both routes (4 lines)", aboutLines.length === 4);
ok("#8 no em-dash char in any VeritaPolicy About paragraph", !aboutLines.some(l => l.includes("—")));
ok("#8 no \\u2014 escape in any VeritaPolicy About paragraph", !aboutLines.some(l => l.includes("\\u2014")));
ok("#8 the Sections list now uses a colon", aboutLines.some(l => /operations: Specimen Management/.test(l)));

// #9: documents PATCH now clears manual_id on an explicit null (provided-flag CASE)
ok("#9 manual_id update uses the provided-flag CASE (not COALESCE)",
  /manual_id = CASE WHEN \? = 1 THEN \? ELSE manual_id END/.test(routes));
ok("#9 no COALESCE(?, manual_id) remains on the documents PATCH",
  !/manual_id = COALESCE\(\?, manual_id\)/.test(routes));
ok("#9 the provided-flag param is passed (manualId !== undefined ? 1 : 0)",
  /manualId !== undefined \? 1 : 0/.test(routes));

console.log(fails === 0 ? "\n=== VERITAPOLICY MED SERVER BATCH: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
