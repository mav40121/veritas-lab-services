// scripts/render-redington-policy-mock.ts
//
// Mock for Michael's review (Q127 = 1, 2026-10-12): the stock Specimen Collection Policy (005) rendered in the
// Redington-Fairview house format (server/veritapolicyHouseFormats.ts buildRedingtonFairviewDocument), before the
// format is switched on for lab 34. Writes the .docx (and a PDF via Word when available) to the path given.
// Run: npx tsx scripts/render-redington-policy-mock.ts "<out.docx>"
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The template loader resolves server/policyTemplates/data from the working directory, so run from the repo root.
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const { generatePolicyDocxBuffer } = await import("../server/veritapolicyDocx");
const { VERITAPOLICY_MASTER_LIST } = await import("../server/veritapolicyMasterList");

const out = process.argv[2];
if (!out) { console.error("usage: render-redington-policy-mock.ts <out.docx>"); process.exit(2); }
// Same crosswalk the download route builds: the master-list row, filtered to the lab's accreditor (Redington is CAP).
const row: any = (VERITAPOLICY_MASTER_LIST as any[]).find((p) => String(p.policy_id) === "5");
const crosswalk: any = {};
if (row?.cfr_citations) crosswalk.cfr = row.cfr_citations;
if (row?.cap_citations) crosswalk.cap = row.cap_citations;
console.log("master row 5:", row?.policy_name, "| CAP:", row?.cap_citations ?? "(none)");
const buf = await generatePolicyDocxBuffer(
  "5",
  { lab_name: "Redington-Fairview General Hospital", clia_number: "20D0090507" },
  crosswalk,
  undefined,
  { format: "redington_fairview", draftDate: "2026-10-12", department: "Phlebotomy" },
);
if (!buf) { console.error("template 005 not found"); process.exit(1); }
fs.writeFileSync(out, buf);
console.log(`Wrote ${out} (${buf.length} bytes)`);
