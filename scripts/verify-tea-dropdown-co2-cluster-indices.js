#!/usr/bin/env node
// verify-tea-dropdown-co2-cluster-indices.js
//
// Companion to PR #537 (preset label on report) and the Tier 2 dropdown
// dividers shipped in this PR. The Tier 2 fix relies on hard-coded indices
// (positions 8 and 9 = Carbon Dioxide and pCO2; positions 6 and 7 = BNP and
// proBNP) being stable in CLIA_PRESETS. If anyone reorders the array, the
// separators land at the wrong rows and the customer-reported adjacency-slip
// regression re-opens silently. This script pins the indices.
//
// What it verifies:
//   1. CLIA_PRESETS[6] is BNP and carries ±30%
//   2. CLIA_PRESETS[7] is proBNP and carries ±30%
//   3. CLIA_PRESETS[8] is Carbon Dioxide / Serum CO2 / Bicarbonate and
//      carries ±20% with NO absolute floor
//   4. CLIA_PRESETS[9] is pCO2, Blood Gas Analyzer and carries ±8% with
//      absolute floor 5 mm Hg
//   5. CLIA_PRESETS[10] is Blood Gas pO2 (immediately below pCO2 — the
//      bottom of the adjacency cluster)
//
// If any of these fail, the hard-coded SelectSeparator positions in
// VeritaCheckPage.tsx (~line 2820) need re-checking before this script can
// pass. The comment block at the SelectSeparator site cross-references this
// script.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const source = fs.readFileSync(
  path.join(__dirname, "..", "client", "src", "pages", "VeritaCheckPage.tsx"),
  "utf8"
);

// Extract CLIA_PRESETS array. The array is declared as:
//   const CLIA_PRESETS = [
//     { label: "...", value: ..., cfr: "..." },
//     ...
//   ];
// Locate the opening bracket and parse each row's label + value + absoluteFloor.

const arrayMatch = source.match(/const CLIA_PRESETS[^=]*=\s*\[([\s\S]*?)\];/);
if (!arrayMatch) {
  console.error("FAIL  could not locate CLIA_PRESETS array in VeritaCheckPage.tsx");
  process.exit(1);
}

// Parse line-by-line: every preset row is a single line beginning with `{ label:`.
// Comment blocks (// ...) span their own lines and never start with `{ label:`.
// Each row is self-contained, so a per-line regex avoids the "lazy match
// crosses into next row's absoluteFloor" bug that a multi-line regex would
// hit.
const rows = [];
for (const line of arrayMatch[1].split("\n")) {
  const lineRowRegex = /\{\s*label:\s*"([^"]+)",\s*value:\s*([0-9.]+)(?:[^}]*?absoluteFloor:\s*([0-9.]+))?/;
  const m = line.match(lineRowRegex);
  if (!m) continue;
  rows.push({
    label: m[1],
    value: parseFloat(m[2]),
    absoluteFloor: m[3] ? parseFloat(m[3]) : null,
  });
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? " -- " + detail : "")); }
}
function approxEq(a, b) { return Math.abs(a - b) < 1e-9; }

// Sanity: at least 80 presets parsed (the dropdown spans positions 0-80).
check("parsed >= 80 presets", rows.length >= 80, `got ${rows.length}`);

// 1. BNP at position 6.
check("CLIA_PRESETS[6] is BNP", rows[6]?.label.includes("BNP") && !rows[6]?.label.startsWith("proBNP"),
  `got "${rows[6]?.label}"`);
check("CLIA_PRESETS[6] is ±30%", approxEq(rows[6]?.value, 0.30));

// 2. proBNP at position 7.
check("CLIA_PRESETS[7] is proBNP", rows[7]?.label.startsWith("proBNP"),
  `got "${rows[7]?.label}"`);
check("CLIA_PRESETS[7] is ±30%", approxEq(rows[7]?.value, 0.30));

// 3. Carbon Dioxide / Serum CO2 / Bicarbonate at position 8.
check("CLIA_PRESETS[8] is Carbon Dioxide / Serum CO2 / Bicarbonate",
  rows[8]?.label.includes("Carbon Dioxide") && rows[8]?.label.includes("Serum CO2") && rows[8]?.label.includes("Bicarbonate"),
  `got "${rows[8]?.label}"`);
check("CLIA_PRESETS[8] is ±20%", approxEq(rows[8]?.value, 0.20));
check("CLIA_PRESETS[8] has NO absolute floor", rows[8]?.absoluteFloor === null,
  `got absoluteFloor=${rows[8]?.absoluteFloor}`);

// 4. pCO2, Blood Gas Analyzer at position 9.
check("CLIA_PRESETS[9] is pCO2, Blood Gas Analyzer",
  rows[9]?.label.startsWith("pCO2"),
  `got "${rows[9]?.label}"`);
check("CLIA_PRESETS[9] is ±8%", approxEq(rows[9]?.value, 0.08));
check("CLIA_PRESETS[9] has absolute floor 5 (mm Hg)",
  rows[9]?.absoluteFloor === 5,
  `got absoluteFloor=${rows[9]?.absoluteFloor}`);

// 5. Blood Gas pO2 at position 10 — the immediate-below row that completes
// the adjacency cluster. If a future reorder pushes pO2 out of position 10
// the maintainer should re-check whether the Tier 2 separators still cover
// the right rows.
check("CLIA_PRESETS[10] is Blood Gas pO2 (cluster sentinel)",
  rows[10]?.label.includes("Blood Gas pO2"),
  `got "${rows[10]?.label}"`);

// 6. Confirm SelectSeparator placement in source matches the indices above.
// Look for the comment block and the two SelectSeparator lines.
const sepBlock = source.match(/\{CLIA_PRESETS\.slice\(0,\s*8\)[^]*?<SelectSeparator[^]*?CLIA_PRESETS\[8\][^]*?<SelectSeparator[^]*?CLIA_PRESETS\[9\][^]*?CLIA_PRESETS\.slice\(10,\s*37\)/);
check("VeritaCheckPage.tsx renders separators around positions 8 and 9",
  !!sepBlock,
  "expected slice(0, 8) ... SelectSeparator ... CLIA_PRESETS[8] ... SelectSeparator ... CLIA_PRESETS[9] ... slice(10, 37)");

console.log("");
console.log(`SUMMARY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
