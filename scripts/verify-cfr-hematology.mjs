// scripts/verify-cfr-hematology.mjs
//
// Regression guard for the hematology CFR-section error. §493.927 is General
// Immunology; hematology PT acceptable-performance criteria live in §493.941
// (eCFR: "§493.941 Hematology (including routine hematology and coagulation)").
//
// On 2026-06-14 a sweep found "Hematology = §493.927" in 5 places (2
// customer-facing surfaces + 3 spec docs), all corrected to §493.941. The live
// PDF engine was already correct (it resolves via server/veritamapData.ts
// CFR_MAP). This guard fails if either regresses:
//   1. any source/doc file pairs "hematolog..." with 493.927 (the wrong claim)
//   2. CFR_MAP no longer maps Hematology -> §493.941
//
// Exit 1 on any failure so it can gate CI.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["client/src", "server", "docs"];
const TOP_FILES = ["CLAUDE.md", "STANDING_REQUIREMENTS.md"];

// "hematolog" within ~25 chars of "493.927", in either order. Catches
// "Hematology = §493.927", "Hematology 493.927", "493.927 ... hematology".
const BAD = [
  /hematolog[a-z]*[^A-Za-z0-9]{0,25}493\.927/i,
  /493\.927[^0-9][^A-Za-z0-9]{0,25}hematolog/i,
];

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== "node_modules") walk(p, acc); }
    else if (/\.(tsx?|jsx?|md)$/.test(name)) acc.push(p);
  }
  return acc;
}

const files = [...ROOTS.flatMap((r) => walk(r)), ...TOP_FILES];
const offenders = [];
for (const f of files) {
  let src;
  try { src = readFileSync(f, "utf8"); } catch { continue; }
  src.split(/\r?\n/).forEach((line, i) => {
    if (BAD.some((re) => re.test(line))) offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 120)}`);
  });
}

// CFR_MAP must still map Hematology -> §493.941.
let mapOk = false;
try {
  const vm = readFileSync("server/veritamapData.ts", "utf8");
  mapOk = /"Hematology":\s*"§493\.941"/.test(vm);
} catch {}

let failed = false;
if (offenders.length) {
  failed = true;
  console.log(`FAIL: ${offenders.length} place(s) still tie hematology to §493.927 (should be §493.941):`);
  for (const o of offenders) console.log("  " + o);
}
if (!mapOk) {
  failed = true;
  console.log('FAIL: server/veritamapData.ts CFR_MAP no longer maps "Hematology" -> "§493.941".');
}
if (failed) process.exit(1);
console.log(`PASS: no hematology/§493.927 conflation across ${files.length} files; CFR_MAP Hematology -> §493.941 intact.`);
