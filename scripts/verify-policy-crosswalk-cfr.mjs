// scripts/verify-policy-crosswalk-cfr.mjs
//
// BUG-013 follow-up (Michael Q51/Q52, 2026-10-09): the "Accreditor Crosswalk" printed at the end of every
// VeritaPolicy document lists CFR sections from server/veritapolicyMasterList.ts. On 2026-10-09, 3 of its 523
// citations named sections that do not exist (21 CFR 640.3, 640.27, 42 CFR 493.1107). This check fails if any
// crosswalk citation names a section that is not in scripts/data/ecfr_sections_<date>.json, which
// scripts/policy-cfr/build_ecfr_sections.py builds from the eCFR (it refuses sections the eCFR does not have).
// It also self-tests that a made-up section is caught.
// Run: node scripts/verify-policy-crosswalk-cfr.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const secFile = readdirSync(join(ROOT, "scripts", "data")).filter((f) => /^ecfr_sections_.*\.json$/.test(f)).sort().pop();
const known = JSON.parse(readFileSync(join(ROOT, "scripts", "data", secFile), "utf8")).sections;
const src = readFileSync(join(ROOT, "server", "veritapolicyMasterList.ts"), "utf8");
const rows = [...src.matchAll(/"policy_id":\s*"(\d+)"[\s\S]*?"cfr_citations":\s*"([^"]*)"/g)].map((m) => ({ id: m[1], cites: m[2] }));
const key = (c) => { const m = /(\d+)\s*CFR\s*(?:Part\s*)?(\d+)(?:\.(\d+[a-z]?))?/.exec(c); return m ? `${m[1]} CFR ${m[2]}${m[3] ? "." + m[3] : ""}` : null; };
const problem = (c) => { const k = key(c); return !k ? "unparsed" : known[k] ? null : "section not in the eCFR list"; };

let fails = 0, total = 0;
for (const r of rows) for (const c of r.cites.split(";").map((x) => x.trim()).filter(Boolean)) {
  total++;
  const p = problem(c);
  if (p) { fails++; console.log(`FAIL  policy ${r.id} | ${c} | ${p}`); }
}
const bites = problem("42 CFR 493.1107") !== null && problem("21 CFR 640.27") !== null && problem("42 CFR 493.1105") === null;
console.log(`${bites ? "PASS" : "FAIL"}  self-test: 42 CFR 493.1107 and 21 CFR 640.27 are caught, 42 CFR 493.1105 passes`);
console.log(`${total - fails} of ${total} crosswalk citations in ${rows.length} policies name a section in the eCFR (${secFile}).`);
console.log(fails === 0 && bites ? "ALL PASS" : `${fails + (bites ? 0 : 1)} FAILURE(S)`);
process.exit(fails === 0 && bites ? 0 : 1);
