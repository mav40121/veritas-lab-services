// scripts/verify-header-row-height.mjs
//
// Receipt for parking-lot #44: long Excel column headers were clipped, cutting
// CFR citations mid-string.
//
// CLAUDE.md §6 asks for "row height 20" AND "wrap text". Those conflict for any
// header wider than its column: 20pt shows about one line of Calibri 11, so a
// two-line header loses its tail in print and in PDF. On the live VeritaMap
// export that printed "Reference Range Attestation (42 CFR" with "493.1253)"
// missing, which leaves the column not saying which requirement it attests to.
// Cell VALUES were never wrong; this is the printed header only.
//
// Asserts the height helper against the REAL header/width pairs the exports
// ship, and that a single-line sheet is untouched at the §6 baseline of 20.
//
// Run: node scripts/verify-header-row-height.mjs

import { readFileSync } from "fs";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

// Mirror of the shipped helper (server/routes.ts headerRowHeight).
function headerRowHeight(headers, colWidths) {
  const LINE_PT = 14, PAD_PT = 6, BASELINE = 20;
  let maxLines = 1;
  for (let i = 0; i < headers.length; i++) {
    const text = String(headers[i] ?? "");
    const usable = Math.max(1, Math.floor((colWidths[i] ?? 12) * 0.95));
    maxLines = Math.max(maxLines, Math.ceil(text.length / usable));
  }
  return Math.max(BASELINE, maxLines * LINE_PT + PAD_PT);
}

console.log("\nCase 1: single-line headers are untouched (every export that was already fine)");
{
  const h = ["Analyte", "Units", "Status"];
  const w = [22, 20, 18];
  check("returns the §6 baseline of 20", headerRowHeight(h, w) === 20, `got ${headerRowHeight(h, w)}`);
}
{
  // A header exactly at the usable width must NOT trigger a second line.
  const w = 20, usable = Math.floor(w * 0.95); // 19
  const h = ["x".repeat(usable)];
  check(`a header exactly filling the usable width (${usable} ch @ w${w}) stays one line`,
    headerRowHeight(h, [w]) === 20, `got ${headerRowHeight(h, [w])}`);
  const h2 = ["x".repeat(usable + 1)];
  check("one character past it wraps to two lines",
    headerRowHeight(h2, [w]) === 34, `got ${headerRowHeight(h2, [w])}`);
}

console.log("\nCase 2: the REAL headers that were being cut on production now fit");
{
  // Exact header text and column width from the shipped VeritaMap export.
  const cases = [
    ["Reference Range Attestation (42 CFR 493.1253)", 24],
    ["AMR Attestation (42 CFR 493.1253, per instrument)", 24],
    ["Last Correlation / Method Comparison Date", 30],
  ];
  for (const [text, w] of cases) {
    const usable = Math.floor(w * 0.95);
    const needed = Math.ceil(text.length / usable);
    const got = headerRowHeight([text], [w]);
    const fits = got >= needed * 14;
    check(`"${text.slice(0, 34)}..." (${text.length}ch @ w${w}) gets ${needed} lines of room`,
      fits, `height ${got} < ${needed} lines`);
    check(`  ...and that is taller than the old fixed 20`, got > 20, `got ${got}`);
  }
}

console.log("\nCase 3: height scales with the WORST header, not the first or the last");
{
  const headers = ["A", "Reference Range Attestation (42 CFR 493.1253)", "B"];
  const widths = [10, 24, 10];
  const alone = headerRowHeight([headers[1]], [widths[1]]);
  check("a long header in the middle still drives the height",
    headerRowHeight(headers, widths) === alone, `${headerRowHeight(headers, widths)} vs ${alone}`);
}
{
  check("a missing colWidth falls back to a sane default rather than dividing by zero",
    headerRowHeight(["Some Header Text"], []) > 0);
  check("a zero colWidth does not divide by zero or return Infinity",
    Number.isFinite(headerRowHeight(["Some Header Text"], [0])));
  check("an empty header list returns the baseline", headerRowHeight([], []) === 20);
}

console.log("\nCase 4: shipped source -- the clipping exports call the helper");
{
  const src = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const calls = (src.match(/headerRow\.height = headerRowHeight\(headers, colWidths\);/g) || []).length;
  check("all 3 measured-clipping exports call headerRowHeight", calls === 3, `found ${calls}`);
  check("the helper is defined once", (src.match(/function headerRowHeight\(/g) || []).length === 1);
  check("the helper still floors at the §6 baseline of 20", /const BASELINE = 20;/.test(src));
  // The exports that measured clean keep their literal 20; the helper would
  // return 20 for them anyway, so leaving them alone keeps the diff honest.
  check("exports that did not clip were left alone",
    (src.match(/headerRow\.height = 20;/g) || []).length > 0);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
