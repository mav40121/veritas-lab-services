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
//
// BUG-029 (2026-10-11): the competency sections too. 493.1235 is one sentence with no
// paragraphs, so any 493.1235(x) citation fails. Paragraph trees from the eCFR text:
//   493.1407 (e)(1)-(14), (e)(3)(i)-(iii), (e)(4)(i)-(iv); 493.1445 (e)(1)-(15), same sub-items;
//   493.1413 (b)(1)-(9), (b)(8)(i)-(vi); 493.1451 (b)(1)-(9), (b)(8)(i)-(vi), (c)(1)-(6).
//
// BUG-035 (2026-10-11): 493.1251 (procedure manual). Paragraphs from the eCFR text: (a); (b)(1)-(14); (c); (d)
// approval, signature and date by the director before use; (e). The policy template's signature footnote cited
// (b)(13) (the result-reporting system) for an "annual review" CLIA does not set; VeritaScan 75 cited (b)(9)
// (method limitations) and 76 cited (c) (manufacturer instructions).
// Run: node scripts/verify-cfr-paragraph-citations.mjs

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const VALID = {
  "493.1253": new Set(["", "(a)", "(b)", "(b)(1)", "(b)(1)(i)", "(b)(1)(i)(A)", "(b)(1)(i)(B)", "(b)(1)(i)(C)", "(b)(1)(ii)",
    "(b)(2)", "(b)(2)(i)", "(b)(2)(ii)", "(b)(2)(iii)", "(b)(2)(iv)", "(b)(2)(v)", "(b)(2)(vi)", "(b)(2)(vii)", "(b)(3)", "(c)"]),
  "493.1281": new Set(["", "(a)", "(b)", "(b)(1)", "(b)(2)", "(b)(3)", "(b)(4)", "(b)(5)", "(c)"]),
  "493.1235": new Set([""]),
  "493.1251": new Set(["", "(a)", "(b)", ...Array.from({ length: 14 }, (_, i) => `(b)(${i + 1})`), "(c)", "(d)", "(e)"]),
};
const roman = ["i", "ii", "iii", "iv", "v", "vi"];
const directorParas = (n) => ["", "(a)", "(b)", "(c)", "(c)(1)", "(c)(2)", "(d)", "(e)", ...Array.from({ length: n }, (_, i) => `(e)(${i + 1})`),
  "(e)(3)(i)", "(e)(3)(ii)", "(e)(3)(iii)", "(e)(4)(i)", "(e)(4)(ii)", "(e)(4)(iii)", "(e)(4)(iv)"];
const supervisorParas = (withC) => ["", "(a)", "(b)", ...Array.from({ length: 9 }, (_, i) => `(b)(${i + 1})`), ...roman.map((r) => `(b)(8)(${r})`),
  ...(withC ? ["(c)", ...Array.from({ length: 6 }, (_, i) => `(c)(${i + 1})`)] : [])];
VALID["493.1407"] = new Set(directorParas(14));
VALID["493.1445"] = new Set(directorParas(15));
VALID["493.1413"] = new Set(supervisorParas(false));
VALID["493.1451"] = new Set(supervisorParas(true));
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
  for (const m of s.matchAll(/493\.(1253|1281|1235|1251|1407|1413|1445|1451)((?:\([a-zA-Z0-9-]+\))*)/g)) {
    seen++;
    if (!VALID[`493.${m[1]}`].has(m[2])) bad.push(`${path.relative(ROOT, f)}: 493.${m[1]}${m[2]}`);
  }
}
ok(`every 493.1253 / 1281 / 1235 / 1251 / 1407 / 1413 / 1445 / 1451 citation names a real paragraph (${seen} checked)`, bad.length === 0, bad.slice(0, 8).join("; "));

const scan = fs.readFileSync(path.join(ROOT, "client", "src", "lib", "veritaScanData.ts"), "utf8");
const cfrOf = (id) => (scan.match(new RegExp(`\\{ id: ${id},[^\\n]*?cfr: "([^"]*)"`)) || [])[1];
const want = { 26: "42 CFR §493.1253(b)(1)(i)(A)", 27: "42 CFR §493.1253(b)(1)(i)(A)", 28: "42 CFR §493.1253(b)(1)(i)(A)", 29: "42 CFR §493.1281(a)",
  30: "42 CFR §493.1253(b)(1)(i)(B)", 31: "42 CFR §493.1253(b)(1)(i)(C)", 32: "42 CFR §493.1253(b)(1)(i)(A)", 85: "42 CFR §493.1253(b)(2)", 89: "42 CFR §493.1253(b)(1)(i)(C)" };
for (const [id, c] of Object.entries(want)) ok(`VeritaScan item ${id} cites ${c}`, cfrOf(id) === c, cfrOf(id));
ok("VeritaScan cites 493.1213 (Condition: Toxicology) nowhere", !/493\.1213/.test(scan));
// BUG-029: the competency items.
const comp = { 58: "42 CFR §493.1445(e)(12) / §493.1407(e)(11)", 59: "42 CFR §493.1451(b)(9) / §493.1413(b)(9)", 60: "42 CFR §493.1451(b)(8)(i)-(vi) / §493.1413(b)(8)(i)-(vi)",
  61: "42 CFR §493.1235", 62: "42 CFR §493.1445(e)(13) / §493.1407(e)(12)", 63: "42 CFR §493.1235", 68: "42 CFR §493.1451(b)(8) / §493.1413(b)(8)", 69: "42 CFR §493.1445(e)(12) / §493.1407(e)(11)" };
for (const [id, c] of Object.entries(comp)) ok(`VeritaScan item ${id} cites ${c}`, cfrOf(id) === c, cfrOf(id));
// BUG-035: procedure manual items.
for (const [id, c] of Object.entries({ 75: "42 CFR §493.1251(d)", 76: "42 CFR §493.1251(a)" })) ok(`VeritaScan item ${id} cites ${c}`, cfrOf(id) === c, cfrOf(id));
const docx = fs.readFileSync(path.join(ROOT, "server", "veritapolicyDocx.ts"), "utf8");
ok("policy template signature block quotes 493.1251(d) and claims no annual review",
  docx.includes('42 CFR §493.1251(d): \\"Procedures and changes in procedures must be approved, signed, and dated by the current laboratory director before use.\\"')
    && !/at least annually|Annual review due|1251\(b\)\(13\)/.test(docx));
const tile = fs.readFileSync(path.join(ROOT, "client", "src", "components", "ComplianceScoreTile.tsx"), "utf8");
ok("compliance score tile: competency current and duty changes cite (b)(9); position descriptions (e)(15)/(e)(14); reassessments (e)(13)/(e)(12)",
  /competencyCurrent"[^}]*493\.1451\(b\)\(9\) \/ §493\.1413\(b\)\(9\)/.test(tile) && /dutyChangesResolved"[^}]*493\.1451\(b\)\(9\)/.test(tile)
    && /positionDescriptionsOnFile"[^}]*493\.1445\(e\)\(15\) \/ §493\.1407\(e\)\(14\)/.test(tile) && /reassessmentsResolved"[^}]*493\.1445\(e\)\(13\) \/ §493\.1407\(e\)\(12\)/.test(tile));
const pdf = fs.readFileSync(path.join(ROOT, "server", "pdfReport.ts"), "utf8");
ok("VeritaComp PDF: element anchors are 493.1451(b)(8)(i)-(vi) / 493.1413(b)(8)(i)-(vi)", /&sect;493\.1451\(b\)\(8\)\(\$\{\["i", "ii", "iii", "iv", "v", "vi"\]/.test(pdf) && !/493\.1235\(a\)/.test(pdf));

const guide = fs.readFileSync(path.join(ROOT, "client", "src", "pages", "StudyGuidePage.tsx"), "utf8");
ok("Study Guide: reportable range cites 493.1253(b)(1)(i)(C) (twice)", (guide.match(/493\.1253\(b\)\(1\)\(i\)\(C\)/g) || []).length === 2);
ok("Study Guide: correlation row cites 493.1281(a) and says twice a year", /§493\.1281\(a\)<\/a>/.test(guide) && /twice a year while two instruments or methods run the same test/.test(guide));
ok("Study Guide: no 'annually recommended' for correlation", !/annually recommended/.test(guide));
ok("Study Guide: precision cites 493.1253(b)(1)(i)(B) (table and card)", (guide.match(/493\.1253\(b\)\(1\)\(i\)\(B\)/g) || []).length === 2);
ok("Study Guide: reference range cites 493.1253(b)(1)(ii) (table and card), precision no longer does", (guide.match(/493\.1253\(b\)\(1\)\(ii\)/g) || []).length === 2 && /regulation="42 CFR §493\.1253\(b\)\(1\)\(ii\); CLSI EP28-A3c"/.test(guide));

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
