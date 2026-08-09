/**
 * Troy Regional Medical Center policy conversion.
 *
 * Same method as scripts/generate_scahc_policies.js, applied to Troy:
 * fill the VeritaPolicy JSON templates into Troy's OWN letterhead/format
 * (their ADM-01 sample, tagged as troy_tagged.docx).
 *
 * Reads:  <TROY>/policy_conversion/troy_tagged.docx        (Troy scaffold w/ {tags})
 *         server/policyTemplates/data/<NNN>_<slug>.json      (VeritaPolicy templates)
 *         server/veritapolicyMasterList.ts                   (accreditor crosswalk)
 *
 * Writes: <TROY>/policy_conversion/out/Troy_<NUM>_<slug>.docx  (one per policy)
 *
 * Troy is a Joint Commission hospital lab (CLIA + CMS + TJC). Static identity
 * fields (Department, Prepared/Reviewed/Approved By = Edward Benak MD, Owner,
 * Review=Annual, Applies To, Regulations) live in the scaffold, not here.
 *
 * Usage:
 *   node scripts/generate_troy_policies.js            # all applicable policies
 *   node scripts/generate_troy_policies.js --only 11  # single policy (pilot)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, "..");
const TROY = "C:\\Users\\veril\\OneDrive\\Desktop\\Lab\\Verita Products\\VLS Leads\\Troy Medical Center\\policy_conversion";

const TEMPLATE_PATH = path.join(TROY, "troy_tagged_v2.docx");
const DATA_DIR = path.join(REPO, "server", "policyTemplates", "data");
const MASTER_LIST = path.join(REPO, "server", "veritapolicyMasterList.ts");
const OUT_DIR = path.join(TROY, "out");

// Troy lab context. Dates use Troy's MM.DD.YYYY format; the director resets
// them at adoption. Effective/Review/Revision all = creation date, mirroring
// how Troy filled ADM-01.
const TROY_LAB = {
  lab_name: "Troy Regional Medical Center",
  accreditors: { tjc: true, cap: false, cola: false, aabb: false },
  effective_date: "07.30.26",
  review_date: "07.30.26",
  revision_date: "07.30.26",
  supersedes: "None. New policy.",
};

// Section -> Troy policy-number prefix (Michael chose the section-prefix scheme
// 2026-07-30). Covers all 9 master-list sections. The number after the prefix is
// the stable VeritaPolicy master policy_id (matches the pilot, LAB-011), so
// cross-references never break on revision.
const PREFIX_BY_SECTION = {
  Leadership: "ADM",
  Administration: "ADM",
  Quality: "QM",
  Safety: "SAF",
  Personnel: "HR",
  Testing: "LAB",
  Results: "LAB",
  "Specimen Management": "SPC",
  "Information Systems": "LIS",
  "Specialty Services": "SS",
};

function loadMasterList() {
  const text = fs.readFileSync(MASTER_LIST, "utf-8");
  const m = text.match(/export const VERITAPOLICY_MASTER_LIST:[^=]*=\s*(\[[\s\S]*?\]);\s*$/m);
  if (!m) throw new Error("Could not parse master list");
  return JSON.parse(m[1]);
}

function findTemplate(policyId) {
  const padded = String(policyId).padStart(3, "0");
  const match = fs.readdirSync(DATA_DIR)
    .filter((f) => !fs.statSync(path.join(DATA_DIR, f)).isDirectory())
    .find((f) => f.startsWith(padded + "_") && f.endsWith(".json"));
  return match ? path.join(DATA_DIR, match) : null;
}

function sub(s, lab) {
  return String(s || "").replace(/<<LAB_NAME>>/g, lab.lab_name);
}

function joinNumbered(items, lab) {
  return (items || []).map((s, i) => `${i + 1}. ${sub(s, lab)}`).join("\n");
}

function policyNumber(row) {
  const prefix = PREFIX_BY_SECTION[row.section] || "LAB";
  return `${prefix}-${String(row.policy_id).padStart(3, "0")}`;
}

function buildDefinitions(tmpl, lab) {
  const defs = tmpl.definitions || [];
  if (!defs.length) return "None specific to this policy.";
  return defs
    .map((d) => {
      const term = Array.isArray(d) ? d[0] : d.term;
      const def = Array.isArray(d) ? d[1] : d.definition;
      return `${term}: ${sub(def, lab)}`;
    })
    .join("\n");
}

function buildRegulatoryAuthority(tmpl, masterRow, lab) {
  const cfr = masterRow?.cfr_citations || (tmpl.cfr_text_blocks || []).map((b) => b.citation).join("; ");
  const tjc = lab.accreditors.tjc ? (masterRow?.tjc_citations || "") : "";
  const parts = [];
  if (cfr) parts.push(`the Clinical Laboratory Improvement Amendments (CLIA), 42 CFR Part 493 (${cfr})`);
  parts.push("CMS Conditions of Participation");
  if (tjc) parts.push(`applicable Joint Commission standards (${tjc})`);
  else parts.push("applicable Joint Commission standards");
  return `This policy is governed by ${parts.join("; ")}.`;
}

// Same references builder as SCAHC: Federal Regulations + Verbatim Excerpts +
// Accreditor Crosswalk, soft-line-break separated.
function buildReferences(tmpl, masterRow, lab) {
  const lines = [];
  const blocks = tmpl.cfr_text_blocks || [];
  if (blocks.length > 0) {
    lines.push("Federal Regulations:");
    blocks.forEach((b, i) => {
      const label = b.label ? `: ${b.label}` : "";
      lines.push(`  ${i + 1}. ${b.citation}${label}`);
    });
    lines.push("");
    lines.push("Verbatim Excerpts:");
    blocks.forEach((b) => {
      lines.push(`  ${b.citation}`);
      lines.push(`  "${(b.verbatim || "").replace(/\s+/g, " ").trim()}"`);
      lines.push("");
    });
  }
  const cw = [];
  if (masterRow?.cfr_citations) cw.push(`  CFR:  ${masterRow.cfr_citations}`);
  if (lab.accreditors.tjc && masterRow?.tjc_citations) cw.push(`  TJC:  ${masterRow.tjc_citations}`);
  if (cw.length > 0) {
    lines.push("Accreditor Crosswalk:");
    lines.push(...cw);
  }
  return lines.length > 0 ? lines.join("\n") : "No federal regulation citations recorded for this policy.";
}

function fillTags(tmpl, masterRow, lab) {
  return {
    policy_number: policyNumber(masterRow),
    policy_title: (tmpl.policy_name || "").replace(/\s*Policy$/i, ""),
    effective_date: lab.effective_date,
    review_date: lab.review_date,
    revision_date: lab.revision_date,
    supersedes: lab.supersedes,
    purpose: sub(tmpl.purpose, lab) || "",
    policy_text: joinNumbered(tmpl.policy_statements, lab) || "",
    scope: sub(tmpl.scope, lab) || "",
    regulatory_authority: buildRegulatoryAuthority(tmpl, masterRow, lab),
    definitions: buildDefinitions(tmpl, lab),
    procedure_text: joinNumbered(tmpl.procedure_steps, lab) || "See Policy Statement above.",
    references: buildReferences(tmpl, masterRow, lab),
  };
}

function generateOne(tmpl, masterRow, lab) {
  const buf = fs.readFileSync(TEMPLATE_PATH);
  const zip = new PizZip(buf);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.render(fillTags(tmpl, masterRow, lab));
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}

function main() {
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

  const master = loadMasterList();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let added = 0, skipped = 0;
  const errors = [];
  for (const row of master) {
    if (only && String(row.policy_id) !== String(only)) continue;
    const tmplPath = findTemplate(row.policy_id);
    if (!tmplPath) { skipped++; errors.push(`#${row.policy_id}: no template file`); continue; }
    const tmpl = JSON.parse(fs.readFileSync(tmplPath, "utf-8"));
    try {
      const buf = generateOne(tmpl, row, TROY_LAB);
      const slug = (tmpl.slug || tmpl.policy_name.toLowerCase().replace(/[^a-z0-9]+/g, "_")).slice(0, 60);
      // Filename MUST carry the VeritaPolicy master policy_id (3-digit) so the
      // admin bulk-upload parser (^[A-Za-z]+_(\d{1,3})_) keys each artifact to
      // the right policy. Troy's display number (e.g. LAB-011) lives INSIDE the
      // doc's Document Control table, not in the filename.
      const fname = `Troy_${String(row.policy_id).padStart(3, "0")}_${slug}.docx`;
      fs.writeFileSync(path.join(OUT_DIR, fname), buf);
      added++;
      console.log(`  OK  ${fname}`);
    } catch (e) {
      skipped++;
      errors.push(`#${row.policy_id} ${tmpl.policy_name}: ${e.message}`);
      console.log(`  FAIL #${row.policy_id}: ${e.message}`);
    }
  }
  console.log(`\n${added} written, ${skipped} skipped -> ${OUT_DIR}`);
  if (errors.length) { console.log("Issues:"); errors.forEach((e) => console.log("  - " + e)); }
}

main();
