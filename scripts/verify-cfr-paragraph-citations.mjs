// scripts/verify-cfr-paragraph-citations.mjs
//
// Receipt for BUG-012 (2026-10-09): every citation of 42 CFR 493.1253 and 493.1281
// in the app names a paragraph that exists, and 493.1213 ("Condition: Toxicology")
// is never cited for verification or correlation work. The valid paragraph lists are
// copied from the eCFR text (2026-10-01 edition) fetched while fixing this bug:
//   493.1253: (a); (b)(1)(i)(A) accuracy, (B) precision, (C) reportable range;
//             (b)(1)(ii) reference intervals; (b)(2)(i)-(vii) establishment for
//             modified / non-FDA / no-spec systems; (b)(3) calibration and control; (c).
//   493.1281: (a) twice-a-year comparison of methods, instruments or sites;
//             (b)(1)-(5) results inconsistent with relevant criteria; (c) documentation.
// Also pins the nine VeritaScan items and the Study Guide rows that were wrong.
// Run: node scripts/verify-cfr-paragraph-citations.mjs

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const VALID = {
  "493.1253": new Set(["", "(a)", "(b)", "(b)(1)", "(b)(1)(i)", "(b)(1)(i)(A)", "(b)(1)(i)(B)", "(b)(1)(i)(C)", "(b)(1)(ii)",
    "(b)(2)", "(b)(2)(i)", "(b)(2)(ii)", "(b)(2)(iii)", "(b)(2)(iv)", "(b)(2)(v)", "(b)(2)(vi)", "(b)(2)(vii)", "(b)(3)", "(c)"]),
  "493.1281": new Set(["", "(a)", "(b)", "(b)(1)", "(b)(2)", "(b)(3)", "(b)(4)", "(b)(5)", "(c)"]),
};
let fails = 0;
const ok = (label, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  :: " + detail : ""}`); if (!cond) fails++; };

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx|json)$/.test(e.name)) files.push(p);
  }
})(path.join(ROOT, "client", "src"));
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|json)$/.test(e.name)) files.push(p);
  }
})(path.join(ROOT, "server"));

const bad = [];
let seen = 0;
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  for (const m of s.matchAll(/493\.(1253|1281)((?:\([a-zA-Z0-9]+\))*)/g)) {
    seen++;
    if (!VALID[`493.${m[1]}`].has(m[2])) bad.push(`${path.relative(ROOT, f)}: 493.${m[1]}${m[2]}`);
  }
}
ok(`every 493.1253 / 493.1281 citation names a real paragraph (${seen} checked)`, bad.length === 0, bad.slice(0, 5).join("; "));

const scan = fs.readFileSync(path.join(ROOT, "client", "src", "lib", "veritaScanData.ts"), "utf8");
const cfrOf = (id) => (scan.match(new RegExp(`\\{ id: ${id},[^\\n]*?cfr: "([^"]*)"`)) || [])[1];
const want = { 26: "42 CFR §493.1253(b)(1)(i)(A)", 27: "42 CFR §493.1253(b)(1)(i)(A)", 28: "42 CFR §493.1253(b)(1)(i)(A)", 29: "42 CFR §493.1281(a)",
  30: "42 CFR §493.1253(b)(1)(i)(B)", 31: "42 CFR §493.1253(b)(1)(i)(C)", 32: "42 CFR §493.1253(b)(1)(i)(A)", 85: "42 CFR §493.1253(b)(2)", 89: "42 CFR §493.1253(b)(1)(i)(C)" };
for (const [id, c] of Object.entries(want)) ok(`VeritaScan item ${id} cites ${c}`, cfrOf(id) === c, cfrOf(id));
ok("VeritaScan cites 493.1213 (Condition: Toxicology) nowhere", !/493\.1213/.test(scan));

const guide = fs.readFileSync(path.join(ROOT, "client", "src", "pages", "StudyGuidePage.tsx"), "utf8");
ok("Study Guide: reportable range cites 493.1253(b)(1)(i)(C) (twice)", (guide.match(/493\.1253\(b\)\(1\)\(i\)\(C\)/g) || []).length === 2);
ok("Study Guide: correlation row cites 493.1281(a) and says twice a year", /§493\.1281\(a\)<\/a>/.test(guide) && /twice a year while two instruments or methods run the same test/.test(guide));
ok("Study Guide: no 'annually recommended' for correlation", !/annually recommended/.test(guide));
ok("Study Guide: precision cites 493.1253(b)(1)(i)(B) (table and card)", (guide.match(/493\.1253\(b\)\(1\)\(i\)\(B\)/g) || []).length === 2);
ok("Study Guide: reference range cites 493.1253(b)(1)(ii) (table and card), precision no longer does", (guide.match(/493\.1253\(b\)\(1\)\(ii\)/g) || []).length === 2 && /regulation="42 CFR §493\.1253\(b\)\(1\)\(ii\); CLSI EP28-A3c"/.test(guide));

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
