// scripts/remove-veritamap-mayo.mjs
//
// Per Michael (2026-07-10): the Mayo Clinic critical-values feature never worked
// as intended, so remove it from VeritaMap. Keep the Mayo reference LINK in the
// VeritaMap Resources tab, and keep the lab's ability to record its own critical
// values (relabeled to plain "Critical Low/High"). This strips: the ModuleHowToCard
// Mayo promise copy (5 pages, identical), the dead MAYO_CRITICAL_VALUES lookup table
// + its import, the "(Mayo... starting point)" Excel headers/note, and the stale
// Instructions-sheet Mayo/phantom-column lines. Idempotent per string.
//
//   node scripts/remove-veritamap-mayo.mjs

import { readFileSync, writeFileSync } from "node:fs";

let total = 0;
function sub(file, pairs) {
  let src = readFileSync(file, "utf8");
  let n = 0;
  for (const [from, to] of pairs) {
    const before = src;
    src = src.split(from).join(to);
    if (before !== src) n += before.split(from).length - 1;
  }
  writeFileSync(file, src);
  console.log(`${file}: ${n} replacement(s)`);
  total += n;
}

// ── ModuleHowToCard copy, identical across the 5 VeritaMap pages ──────────────
const WHAT_FROM =
  "FDA classification, suggested critical values (from Mayo Clinic Laboratories, for your MEC to review and adopt), and fields for the reference intervals and AMR your lab will verify and enter per 42 CFR 493.1253.";
const WHAT_TO =
  "FDA classification, and fields for the critical values, reference intervals, and AMR your lab will verify and enter per 42 CFR 493.1253.";
const STEP_FROM =
  "Review the Mayo Clinic Laboratories starting-point critical values with your Medical Executive Committee; record the MEC-adopted values.";
const STEP_TO =
  "Record your facility's MEC-adopted critical values for each analyte, if your lab chooses to track them here.";
for (const p of ["VeritaMapAppPage", "VeritaMapBuildPage", "VeritaMapLabwidePage", "VeritaMapMapPage", "VeritaMapResourcesPage"]) {
  sub(`client/src/pages/${p}.tsx`, [[WHAT_FROM, WHAT_TO], [STEP_FROM, STEP_TO]]);
}
// One code comment on the Map page.
sub("client/src/pages/VeritaMapMapPage.tsx", [["MEC review of critical values (Mayo Clinic", "MEC review of critical values (MEC"]]);

// ── server/veritamapData.ts: delete the dead table + fix the Instructions sheet ──
{
  const file = "server/veritamapData.ts";
  let src = readFileSync(file, "utf8");
  const before0 = src;
  // Remove the "Mayo critical values" comment + the whole MAYO_CRITICAL_VALUES block.
  src = src.replace(
    /\/\/ Mayo critical values, units - keyed by analyte \(lowercase\)\n\nexport const MAYO_CRITICAL_VALUES: Record<string, \{ low\?: string; high\?: string; units\?: string \}> = \{[\s\S]*?\n\};\n\n/,
    "",
  );
  const removedTable = before0 !== src;
  // Instructions-sheet fixes (remove Mayo + the phantom-column descriptions).
  const pairs = [
    ['  ["• Columns L-N: Critical values from Mayo Clinic Laboratories (low, high, units) for guidance."],\n', ""],
    ['• Columns O-R (blue): Lab fill-in columns for YOUR laboratory\'s critical values and AMR.', '• Critical Low / Critical High: your laboratory\'s MEC-adopted critical value thresholds (lab-entered; blank until you enter them).'],
    ['3. Lab Fill-In Columns (Blue Background)', '3. Lab Fill-In Columns'],
    ['Critical values shown in the Critical Low and Critical High columns are from the Mayo Clinic Laboratories DLMP Critical Values list as a STARTING POINT.', 'Critical Low and Critical High record your facility\'s MEC-adopted critical value thresholds; they are blank until your laboratory enters them.'],
    ['Your facility\'s Medical Executive Committee (MEC) is responsible for reviewing these starting-point values, approving the final critical value policy for your laboratory, and recording the MEC-approved values.', 'Your facility\'s Medical Executive Committee (MEC) is responsible for approving the critical value policy for your laboratory and recording the MEC-approved values.'],
  ];
  let n = removedTable ? 1 : 0;
  for (const [from, to] of pairs) { const b = src; src = src.split(from).join(to); if (b !== src) n += b.split(from).length - 1; }
  writeFileSync(file, src);
  console.log(`${file}: ${n} change(s) (table removed: ${removedTable})`);
  total += n;
}

// ── server/routes.ts: drop the import + relabel the export headers/note ──────────
sub("server/routes.ts", [
  ["  MAYO_CRITICAL_VALUES, UNITS_LOOKUP, REFERENCE_RANGES, AMR_LOOKUP,", "  UNITS_LOOKUP, REFERENCE_RANGES, AMR_LOOKUP,"],
  ['"Critical Low (Mayo Clinic Laboratories starting point)", "Critical High (Mayo Clinic Laboratories starting point)",', '"Critical Low", "Critical High",'],
  ["Critical values from Mayo Clinic Laboratories are a STARTING POINT. The Medical Executive Committee reviews and adopts the facility's critical values; this column records that review.", "The Medical Executive Committee reviews and adopts the facility's critical values; this column records those values."],
]);

console.log(`\nTotal: ${total} change(s).`);
