// scripts/fix-veritapolicy-orphan-tags-phase1.mts
//
// Phase 1 of the orphan triage (2026-07-27): tag 10 accreditor standards onto
// the existing policies that already cover them but were not cited. The 21 raw
// TAG candidates from scope-veritapolicy-orphans.mts were eyeballed; these 10
// are the clean ones, the other 11 (false/borderline) went to Phase 2. Anchors
// each edit on the unique policy_name so a shared citation string cannot
// mis-route an edit. Idempotent.
//
// Run: npx tsx scripts/fix-veritapolicy-orphan-tags-phase1.mts
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "server/veritapolicyMasterList.ts";

type Edit = { policy: string; field: "tjc_citations" | "cap_citations"; add: string };
const EDITS: Edit[] = [
  // TJC
  { policy: "Accreditation Body Notification Policy", field: "tjc_citations", add: "APR.01.03.01" },
  { policy: "Public Concern Reporting Policy", field: "tjc_citations", add: "APR.09.01.01" },
  { policy: "Non-Retaliation and Whistleblower Policy", field: "tjc_citations", add: "APR.09.02.01" },
  { policy: "Unsuccessful Proficiency Testing Response Policy", field: "tjc_citations", add: "APR.10.03.01" },
  { policy: "Infection Prevention and Standard Precautions Policy", field: "tjc_citations", add: "IC.02.04.01" },
  { policy: "Sentinel Event Investigation Policy", field: "tjc_citations", add: "LD.03.09.01" },
  // CAP
  { policy: "Reference Laboratory Selection and Oversight Policy", field: "cap_citations", add: "GEN.41350" },
  { policy: "Infection Prevention and Standard Precautions Policy", field: "cap_citations", add: "GEN.74000" },
  { policy: "Coagulation Testing QC and Specimen Collection Policy", field: "cap_citations", add: "HEM.36860" },
  { policy: "Maternal Serum Marker Prenatal Screening Order Policy", field: "cap_citations", add: "CHM.32300" },
];

let text = readFileSync(FILE, "utf8");
let applied = 0, skipped = 0;

for (const e of EDITS) {
  const nameAnchor = `"policy_name": "${e.policy}"`;
  const ni = text.indexOf(nameAnchor);
  if (ni < 0) throw new Error(`policy not found: ${e.policy}`);
  if (text.indexOf(nameAnchor, ni + 1) !== -1) throw new Error(`policy_name not unique: ${e.policy}`);

  const fieldAnchor = `"${e.field}": "`;
  const fi = text.indexOf(fieldAnchor, ni);
  if (fi < 0) throw new Error(`field ${e.field} not found for ${e.policy}`);
  const valStart = fi + fieldAnchor.length;
  const valEnd = text.indexOf('"', valStart);
  const oldVal = text.slice(valStart, valEnd);

  const have = new Set(oldVal.split(";").map(s => s.trim()));
  if (have.has(e.add)) { console.log(`skip (present): ${e.policy} ${e.field} ${e.add}`); skipped++; continue; }
  const newVal = oldVal ? `${oldVal}; ${e.add}` : e.add;
  text = text.slice(0, valStart) + newVal + text.slice(valEnd);
  console.log(`add: ${e.policy}  ${e.field} += ${e.add}`);
  applied++;
}

writeFileSync(FILE, text, "utf8");
console.log(`\nApplied ${applied}, skipped ${skipped}. Wrote ${FILE}.`);
