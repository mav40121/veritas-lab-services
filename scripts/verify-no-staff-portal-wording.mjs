// scripts/verify-no-staff-portal-wording.mjs
//
// Parking lot #101 (Michael 2026-10-14: "there is no staff portal anymore"). Since 2026-10-09 (#1548) staff sign in to
// the same VeritaAssure app with their own staff login, and setup is locked for them. Customer-facing copy says "staff
// seats" (pricing) and "staff login" (access), never "Staff Portal". This fails if the phrase is back anywhere a
// customer can read it: client pages, server messages, emails, PDFs and spreadsheets, shared copy. Code comments and
// SQL comments are ignored; identifiers such as staff_portal or StaffPortalPage have no space, so they never match.
//
// Run: node scripts/verify-no-staff-portal-wording.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DIRS = ["client/src", "server", "shared"];
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules") walk(p); }
    else if (/\.(ts|tsx|js|mjs)$/.test(n)) files.push(p);
  }
};
for (const d of DIRS) walk(join(ROOT, d));

const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))      // block comments, keep line numbers
  .split("\n")
  .map((line) => {
    if (/^\s*--/.test(line)) return "";                                // SQL comments inside template strings
    const i = line.search(/(^|[^:"'`])\/\/(?!\/)/);                    // line comments, not https://
    return i >= 0 ? line.slice(0, i + 1) : line;
  });

const hits = [];
for (const f of files) {
  stripComments(readFileSync(f, "utf8")).forEach((line, i) => {
    if (/staff portal/i.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 140)}`);
  });
}
for (const h of hits) console.log(`FAIL  ${h}`);
console.log(hits.length === 0 ? `PASS  no customer-facing "Staff Portal" in ${files.length} files` : `\n${hits.length} FAILED`);

// The check must bite.
const planted = stripComments('const a = "Set up your Staff Portal access"; // fine here');
const bites = planted.some((l) => /staff portal/i.test(l)) && !stripComments("// Staff Portal in a comment").some((l) => /staff portal/i.test(l));
console.log(`${bites ? "PASS" : "FAIL"}  self-test: a string is caught, a comment is not`);
process.exit(hits.length === 0 && bites ? 0 : 1);
