// scripts/verify-library-count-copy.mjs
// The VeritaMap help text gives the library's size in words ("the library of 277 analyzers and 35 manual procedures",
// "more than 300 instruments and manual procedures"). Those numbers are written into the pages, so they can drift
// when the library changes (2026-11-14: two repeated Abbott entries came out and the text still said 279). This reads
// the library and every client page and fails when a page's numbers don't match it.
// Analyzers = every entry outside the "Manual Procedures" category; manual procedures = that category.
//   node scripts/verify-library-count-copy.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lib = JSON.parse(fs.readFileSync(path.join(ROOT, "client/src/lib/fdaInstrumentData.json"), "utf8"));
const total = Object.keys(lib).length;
const manual = Object.values(lib).filter((v) => v.category === "Manual Procedures").length;
const analyzers = total - manual;
console.log(`library: ${total} entries = ${analyzers} analyzers + ${manual} manual procedures`);

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) files.push(p);
  }
};
walk(path.join(ROOT, "client/src"));

let failures = 0, found = 0;
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  const rel = path.relative(ROOT, f).replace(/\\/g, "/");
  for (const m of text.matchAll(/library of (\d+) analyzers and (\d+) manual procedures/g)) {
    found++;
    const ok = Number(m[1]) === analyzers && Number(m[2]) === manual;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${rel}: "${m[0]}"${ok ? "" : `  :: library has ${analyzers} and ${manual}`}`);
  }
  for (const m of text.matchAll(/[Mm]ore than (\d+) instruments and manual procedures/g)) {
    found++;
    const ok = total > Number(m[1]);
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${rel}: "${m[0]}"${ok ? "" : `  :: library has ${total}`}`);
  }
}
if (!found) { failures++; console.log("FAIL  no library count found in client/src (the phrases this checks may have been reworded)"); }
console.log(failures ? `\n${failures} FAIL` : `\nALL PASS (${found} places)`);
process.exit(failures ? 1 : 0);
