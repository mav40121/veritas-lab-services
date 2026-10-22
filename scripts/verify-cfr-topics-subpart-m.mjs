// scripts/verify-cfr-topics-subpart-m.mjs
//
// The VeritaPolicy "What this means in plain English" box (server/veritapolicyDocx.ts) reads
// server/cfrTopicsInOurWords.ts, generated from the Master Citation Index. Through v0.11 the index's
// 42 CFR 493 Subpart M rows carried a neighboring section's heading and had the moderate/high
// complexity labels swapped, so a policy citing 493.1449 (technical supervisor qualifications) said
// "tech consultant qualifications". Fixed in master v0.12 (Michael Q1 = 1, 2026-10-21).
//
// Pins every corrected cite to its eCFR heading (title 42 as of 2026-10-01, structure API), and
// pins the plain-English bullets of policy 103 (Personnel Qualifications), which cites six of them.
// Usage: node scripts/verify-cfr-topics-subpart-m.mjs [path to a cfrTopicsInOurWords.ts]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.argv[2] || path.join(ROOT, "server", "cfrTopicsInOurWords.ts");
const text = fs.readFileSync(SRC, "utf8");
const T = Object.fromEntries([...text.matchAll(/^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)].map((m) => [m[1], m[2]]));
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  :: ${detail}`}`); if (!ok) fails++; };

// [section, eCFR heading, must match, must not match]
const MC = /\bMC\b|moderate/i, HC = /\bHC\b|high/i;
const CASES = [
  ["493.1357", "Standard; laboratory director qualifications (PPM)", [/PPM/, /director/i, /qualif/i], []],
  ["493.1403", "Condition: moderate complexity; laboratory director", [MC, /director/i, /condition/i], [HC]],
  ["493.1405", "Standard; Laboratory director qualifications (moderate)", [MC, /director/i, /qualif/i], [HC]],
  ["493.1407", "Standard; Laboratory director responsibilities (moderate)", [MC, /director/i, /responsib/i], [HC]],
  ["493.1411", "Standard; Technical consultant qualifications", [/consultant/i, /qualif/i], [/supervisor/i]],
  ["493.1413", "Standard; Technical consultant responsibilities", [/consultant/i, /responsib/i], [/supervisor/i]],
  ["493.1415", "Condition: moderate complexity; clinical consultant", [/clinical consultant/i, MC], [HC]],
  ["493.1417", "Standard; Clinical consultant qualifications (moderate)", [/clinical consultant/i, /qualif/i, MC], [/duties/i, HC]],
  ["493.1441", "Condition: high complexity; laboratory director", [HC, /director/i, /condition/i], [MC]],
  ["493.1443", "Standard; Laboratory director qualifications (high)", [HC, /director/i, /qualif/i], [MC]],
  ["493.1445", "Standard; Laboratory director responsibilities (high)", [HC, /director/i, /responsib/i], [MC]],
  ["493.1449", "Standard; Technical supervisor qualifications", [/supervisor/i, /qualif/i], [/consultant/i]],
  ["493.1451", "Standard: Technical supervisor responsibilities", [/supervisor/i, /responsib/i], [/consultant/i, MC]],
  ["493.1455", "Standard; Clinical consultant qualifications (high)", [/clinical consultant/i, /qualif/i, HC], [MC]],
  ["493.1487", "Condition: high complexity; testing personnel", [/testing personnel/i, /condition/i, HC], [/qualif/i]],
  ["493.1489", "Standard; Testing personnel qualifications (high)", [/testing personnel/i, /qualif/i, HC], [/duties/i]],
];
for (const [sec, heading, must, mustNot] of CASES) {
  const v = T[`42 CFR §${sec}`];
  const ok = v !== undefined && must.every((re) => re.test(v)) && !mustNot.some((re) => re.test(v));
  check(`${sec} reads as "${heading}"`, ok, JSON.stringify(v));
}
check("no em dashes in the topic map", !text.includes("—"));

// Customer-facing: policy 103's plain-English bullets, built the way veritapolicyDocx.ts builds them.
const tmpl = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "policyTemplates", "data", "103_personnel_qualifications.json"), "utf8"));
const norm = (raw) => raw.replace(/\s*\([a-z0-9]+\)(\([a-z0-9]+\))*\s*$/i, "").trim().replace(/^(\d+ CFR)\s+(\d)/, "$1 §$2");
const seen = new Set(); const bullets = {};
for (const b of tmpl.cfr_text_blocks || []) { const k = norm(b.citation || ""); if (k && !seen.has(k)) { seen.add(k); if (T[k]) bullets[k] = T[k]; } }
const want = {
  "42 CFR §493.1487": "HC testing personnel condition",
  "42 CFR §493.1441": "HC lab director condition",
  "42 CFR §493.1405": "MC director qualifications",
  "42 CFR §493.1445": "HC director responsibilities",
  "42 CFR §493.1451": "technical supervisor responsibilities (high complexity)",
  "42 CFR §493.1489": "HC testing personnel qualifications",
};
for (const [k, v] of Object.entries(want)) check(`policy 103 plain-English bullet for ${k.replace("42 CFR §", "")}: "${v}"`, bullets[k] === v, JSON.stringify(bullets[k]));

console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
