/**
 * Quality moat for VeritaPolicy templates.
 *
 * Asserts two structural invariants that protect against silent drift between
 * the master list and the per-policy JSON templates:
 *
 *   1. Every row in server/veritapolicyMasterList.ts has a matching JSON
 *      template at server/policyTemplates/data/<padded-id>_<slug>.json.
 *
 *   2. Every CFR citation that appears in a template's cfr_text_blocks is
 *      also named in the corresponding master list row's cfr_citations
 *      column. Catches the case where a template introduces a verbatim CFR
 *      section but the master list row does not advertise the citation,
 *      which makes the Accreditor Crosswalk in the DOCX understate the
 *      regulatory scope.
 *
 * Exits non-zero on any failure. Safe to land in CI later.
 *
 * Run:  node scripts/verify-veritapolicy-template-integrity.js
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "server", "policyTemplates", "data");
const MASTER_LIST_PATH = path.join(REPO_ROOT, "server", "veritapolicyMasterList.ts");

function loadMasterList() {
  const text = fs.readFileSync(MASTER_LIST_PATH, "utf-8");
  const m = text.match(/export const VERITAPOLICY_MASTER_LIST:[^=]*=\s*(\[[\s\S]*?\]);\s*$/m);
  if (!m) throw new Error("Could not parse master list array");
  return JSON.parse(m[1]);
}

function findTemplatePath(policyId) {
  const padded = String(policyId).padStart(3, "0");
  const entries = fs.readdirSync(DATA_DIR).filter((f) => !fs.statSync(path.join(DATA_DIR, f)).isDirectory());
  return entries.find((f) => f.startsWith(padded + "_") && f.endsWith(".json")) || null;
}

// Normalize a citation by stripping ALL trailing subsection / paragraph
// qualifiers down to the base regulation paragraph. e.g.
// "29 CFR 1910.1030(f)(3)" -> "29 CFR 1910.1030". Catches the case where
// the template cites a specific subsection that the master list lists at
// the parent section level (still considered "named").
function normalizeCitation(c) {
  let s = String(c).trim();
  // Strip every trailing (xxx) qualifier, including nested ones like (f)(3),
  // ranges like (a)-(z), and stray trailing dashes / commas / semicolons.
  while (/\([^)]+\)|[-,;\s]+$/.test(s)) {
    const before = s;
    s = s.replace(/[-,;\s]+$/, "").trim();
    s = s.replace(/\([^)]+\)\s*$/, "").trim();
    if (s === before) break;
  }
  return s;
}

function citationsInMasterRow(row) {
  return String(row.cfr_citations || "")
    .split(";")
    .map((s) => normalizeCitation(s))
    .filter(Boolean);
}

function main() {
  const master = loadMasterList();
  console.log(`Master list: ${master.length} rows`);
  console.log(`Templates dir: ${DATA_DIR}`);

  const failuresCheck1 = [];
  const failuresCheck2 = [];

  for (const row of master) {
    const pid = row.policy_id;
    const tmplName = findTemplatePath(pid);
    if (!tmplName) {
      failuresCheck1.push({ pid, name: row.policy_name });
      continue;
    }

    const tmplPath = path.join(DATA_DIR, tmplName);
    let tmpl;
    try {
      tmpl = JSON.parse(fs.readFileSync(tmplPath, "utf-8"));
    } catch (e) {
      failuresCheck1.push({ pid, name: row.policy_name, error: `JSON parse failed: ${e.message}` });
      continue;
    }

    const masterCitations = citationsInMasterRow(row);
    const templateCfrs = (tmpl.cfr_text_blocks || []).map((b) => normalizeCitation(b.citation));
    const orphans = templateCfrs.filter((c) => !masterCitations.includes(c));
    if (orphans.length > 0) {
      failuresCheck2.push({ pid, name: row.policy_name, orphans });
    }
  }

  console.log("");
  console.log("=== Check 1: every master list row has a matching template file ===");
  if (failuresCheck1.length === 0) {
    console.log(`  PASS  (${master.length}/${master.length} rows have templates)`);
  } else {
    console.log(`  FAIL  (${failuresCheck1.length} missing)`);
    for (const f of failuresCheck1) console.log(`    #${f.pid} ${f.name}${f.error ? "  -- " + f.error : ""}`);
  }

  console.log("");
  console.log("=== Check 2: every template CFR text block is named in master list cfr_citations ===");
  if (failuresCheck2.length === 0) {
    console.log(`  PASS  (0 orphaned CFR text blocks across ${master.length} templates)`);
  } else {
    console.log(`  FAIL  (${failuresCheck2.length} templates have orphaned CFR text blocks)`);
    for (const f of failuresCheck2) {
      console.log(`    #${f.pid} ${f.name}`);
      for (const o of f.orphans) console.log(`      orphan: ${o}`);
    }
  }

  console.log("");
  if (failuresCheck1.length === 0 && failuresCheck2.length === 0) {
    console.log(`OVERALL: PASS`);
    process.exit(0);
  } else {
    console.log(`OVERALL: FAIL  (${failuresCheck1.length + failuresCheck2.length} issues)`);
    process.exit(1);
  }
}

main();
