// scripts/verify-policy-cfr-quotes.mjs
//
// BUG-013 (Michael, Q46 = 1, 2026-10-09): every policy DOCX tells labs "The following federal
// regulation language is reproduced verbatim from the Code of Federal Regulations". This check
// holds every template quote (server/policyTemplates/data/*.json, cfr_text_blocks) to that:
// each quote must be the eCFR text at its citation, word for word. A long paragraph may be
// excerpted: pieces joined by " ... ", each piece found in the cited text, in order.
//
// The eCFR text comes from scripts/data/ecfr_policy_quotes_<date>.json, built by
// scripts/policy-cfr/rebuild_cfr_quotes.py from the eCFR versioner API (point-in-time edition).
// Em dashes are printed as hyphens (house copy rule) on both sides; no word may differ.
//
// Run: node scripts/verify-policy-cfr-quotes.mjs   (exit 1 on any non-verbatim quote)
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "server", "policyTemplates", "data");
const extractFile = readdirSync(join(ROOT, "scripts", "data")).filter((f) => /^ecfr_policy_quotes_.*\.json$/.test(f)).sort().pop();
const extract = JSON.parse(readFileSync(join(ROOT, "scripts", "data", extractFile), "utf8"));
const norm = (s) => String(s ?? "").replace(/\s*[—–]\s*/g, " - ").replace(/\s+/g, " ").trim();

/** null when the quote is verbatim at its citation, else the reason. */
export function quoteProblem(citation, quote) {
  const src = extract.text[citation];
  if (!src) return "citation has no eCFR text (does not exist, or not in the extract)";
  const text = norm(src);
  const pieces = norm(quote).split(" ... ").map((p) => p.trim()).filter(Boolean);
  if (!pieces.length) return "empty quote";
  let at = 0;
  for (const p of pieces) {
    const i = text.indexOf(p, at);
    if (i < 0) return `not in the eCFR text at this citation: "${p.slice(0, 90)}${p.length > 90 ? "..." : ""}"`;
    at = i + p.length;
  }
  return null;
}

let fails = 0, total = 0;
const failures = [];
for (const f of readdirSync(DATA).filter((x) => x.endsWith(".json")).sort()) {
  const d = JSON.parse(readFileSync(join(DATA, f), "utf8"));
  for (const b of d.cfr_text_blocks || []) {
    total++;
    const why = quoteProblem(b.citation, b.verbatim);
    if (why) { fails++; failures.push(`${f} | ${b.citation} | ${why}`); }
  }
}

// The check must bite: change one word of a passing quote and it has to fail.
let bites = false;
outer: for (const f of readdirSync(DATA).filter((x) => x.endsWith(".json")).sort()) {
  for (const b of JSON.parse(readFileSync(join(DATA, f), "utf8")).cfr_text_blocks || []) {
    if (!quoteProblem(b.citation, b.verbatim) && / must /.test(b.verbatim)) {
      bites = quoteProblem(b.citation, b.verbatim.replace(/ must /, " should ")) !== null;
      console.log(`${bites ? "PASS" : "FAIL"}  self-test: changing "must" to "should" in ${f} (${b.citation}) is caught`);
      break outer;
    }
  }
}

console.log(`eCFR extract: ${extractFile} (${extract.source})`);
for (const x of failures) console.log(`FAIL  ${x}`);
console.log(`\n${total - fails} of ${total} quotes are verbatim at their citation; ${fails} are not.`);
console.log(fails === 0 && bites ? "ALL PASS" : `${fails + (bites ? 0 : 1)} FAILURE(S)`);
process.exit(fails === 0 && bites ? 0 : 1);
