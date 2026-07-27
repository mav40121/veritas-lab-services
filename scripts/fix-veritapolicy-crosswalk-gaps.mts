// scripts/fix-veritapolicy-crosswalk-gaps.mts
//
// One-shot data fix for the crosswalk gaps found by
// scripts/audit-veritapolicy-crosswalk.mts (2026-07-27). Adds each of the 12
// TJC standards to its same-named policy's tjc_citations, adds IM.02.02.03 to
// the Health Information Management Policy (its description already reads "data
// capture, transmission, and retention"), and corrects the 493.927 (General
// Immunology) mis-citation on the Manual Hematology QC Policy to 493.941
// (Hematology). Two catalog entries were malformed ("QSA.13.08.01 EP2",
// "QSA.21.02.01 / QSA.21.04.01"); the clean standards are added instead.
//
// Anchors every edit on the unique policy_name, then edits the first matching
// citation field after it, so a shared citation string can never mis-route an
// edit. Idempotent: a standard already present is skipped.
//
// Run: npx tsx scripts/fix-veritapolicy-crosswalk-gaps.mts
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "server/veritapolicyMasterList.ts";

type Edit =
  | { policy: string; field: "tjc_citations"; add: string[] }
  | { policy: string; field: "cfr_citations"; replace: [string, string] };

const EDITS: Edit[] = [
  // 12 TJC name-match tagging gaps.
  { policy: "Hand-off Communication Policy", field: "tjc_citations", add: ["DC.03.01.01"] },
  { policy: "Emergency Operations Plan", field: "tjc_citations", add: ["EM.01.01.01"] },
  { policy: "Environment of Care Management Plan", field: "tjc_citations", add: ["EC.01.01.01"] },
  { policy: "Staff Performance Evaluation Policy", field: "tjc_citations", add: ["HR.01.07.01"] },
  { policy: "LIS Validation and Verification Policy", field: "tjc_citations", add: ["IM.02.02.05"] },
  { policy: "Performance Improvement Plan", field: "tjc_citations", add: ["PI.01.01.01"] },
  { policy: "Reagent Management Policy", field: "tjc_citations", add: ["QSA.02.13.01"] },
  { policy: "Histocompatibility Mixed Lymphocyte Culture Policy", field: "tjc_citations", add: ["QSA.12.06.01"] },
  { policy: "Cell Exchange Program Policy", field: "tjc_citations", add: ["QSA.12.07.01"] },
  { policy: "Electron Microscope Safety Policy", field: "tjc_citations", add: ["QSA.13.05.01"] },
  { policy: "Mohs Surgery Frozen Section Policy", field: "tjc_citations", add: ["QSA.13.08.01"] }, // was "QSA.13.08.01 EP2"
  { policy: "Virology Laboratory QC Policy", field: "tjc_citations", add: ["QSA.21.02.01", "QSA.21.04.01"] }, // was joined "/"
  // IM.02.02.03 -> the HIM policy that covers data capture/transmission/retention.
  { policy: "Health Information Management Policy", field: "tjc_citations", add: ["IM.02.02.03"] },
  // Mis-citation: 493.927 is General Immunology, not Hematology (CLAUDE.md 5). Hematology is 493.941.
  { policy: "Manual Hematology QC Policy", field: "cfr_citations", replace: ["42 CFR 493.927", "42 CFR 493.941"] },
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

  let newVal = oldVal;
  if (e.field === "tjc_citations") {
    const have = new Set(oldVal.split(";").map(s => s.trim()));
    const toAdd = e.add.filter(s => !have.has(s));
    if (toAdd.length === 0) { console.log(`skip (already present): ${e.policy} <- ${e.add.join(", ")}`); skipped++; continue; }
    newVal = oldVal + "; " + toAdd.join("; ");
    console.log(`add: ${e.policy}  tjc += ${toAdd.join(", ")}`);
  } else {
    const [from, to] = e.replace;
    if (!oldVal.includes(from)) { console.log(`skip (target absent): ${e.policy} ${from}`); skipped++; continue; }
    if (oldVal.includes(to)) { console.log(`skip (already has ${to}): ${e.policy}`); skipped++; continue; }
    newVal = oldVal.replace(from, to);
    console.log(`fix: ${e.policy}  cfr ${from} -> ${to}`);
  }

  text = text.slice(0, valStart) + newVal + text.slice(valEnd);
  applied++;
}

writeFileSync(FILE, text, "utf8");
console.log(`\nApplied ${applied} edits, skipped ${skipped}. Wrote ${FILE}.`);
