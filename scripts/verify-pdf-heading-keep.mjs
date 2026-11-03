// scripts/verify-pdf-heading-keep.mjs
//
// CI guard: a PDF section heading never prints alone at the bottom of a page (Michael 2026-11-03, Q138 = 1). A live
// 14-method VeritaComp record printed "Competency by method" as the last line of page 1 with its table on page 2.
// Chromium keeps a heading with what follows only when the heading's CSS says break-after: avoid.
//
// Scans server/ and shared/ for PDF builders (a file that calls .pdf( or has an @page rule) and fails if any CSS rule
// whose selector ends in h2 lacks break-after: avoid. Email HTML (no .pdf( / @page) is out of scope.
// The rendered check for the record itself is scripts/verify-competency-record-heading-keep.mjs (+ .py).
// Run: node scripts/verify-pdf-heading-keep.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walk(p) : /\.(ts|mts|tsx)$/.test(d.name) ? [p] : [];
});
const files = ["server", "shared"].flatMap((d) => walk(path.join(ROOT, d)));
let failures = 0, rules = 0, pdfFiles = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  if (!/\.pdf\(|@page/.test(src)) continue;
  pdfFiles++;
  // A CSS rule: selector text (no braces/semicolons) ending in h2, then its declaration block, which may hold template
  // interpolations such as color:${TEAL}.
  for (const m of src.matchAll(/(^|[\n;}])([^{};\n$]*\bh2)\s*\{((?:\$\{[^}]*\}|[^}])*)\}/g)) {
    rules++;
    const line = src.slice(0, m.index + m[1].length).split("\n").length;
    const ok = /break-after\s*:\s*avoid/.test(m[3]);
    console.log(`${ok ? "PASS" : "FAIL"}  ${path.relative(ROOT, f)}:${line}  ${m[2].trim()} { ... }${ok ? "" : "  :: needs break-after: avoid; page-break-after: avoid;"}`);
    if (!ok) failures++;
  }
}
const found = rules > 0;
console.log(found ? "" : "FAIL  no PDF h2 rules found (the scan is broken)");
console.log(`${pdfFiles} PDF builder files, ${rules} h2 rules`);
console.log(failures || !found ? `${failures || 1} FAIL` : "ALL PASS");
process.exit(failures || !found ? 1 : 0);
