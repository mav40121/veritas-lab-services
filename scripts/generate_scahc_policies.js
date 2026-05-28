/**
 * Phase 1 — one-time job: emit all 58 VeritaPolicy templates as
 * SCAHC-formatted DOCX files using their facility template scaffold.
 *
 * Reads:  server/policyTemplates/lab_overlays/scahc_tagged.docx  (template scaffold)
 *         server/policyTemplates/data/<NNN>_<slug>.json           (each VeritaPolicy template)
 *         server/veritapolicyMasterList.ts                        (for citations / accreditor crosswalk)
 *
 * Writes: C:\Users\veril\OneDrive\Desktop\Lab\Verita Products\SCAHC_Policies_Bundle_<date>.zip
 *
 * Each DOCX inside the zip is the SCAHC scaffold with these tags filled:
 *   {policy_name}    -- title cell + footer
 *   {tjc_reference}  -- master list tjc_citations
 *   {purpose}        -- template purpose field
 *   {policy_text}    -- joined policy_statements (numbered, soft-break separated)
 *   {procedure_text} -- joined procedure_steps (numbered, soft-break separated)
 *
 * SCAHC boilerplate (disclaimer, responsibility, education, approval,
 * references heading, header logo) is preserved unchanged. Effective /
 * Review / Approval dates stay blank for the director to fill.
 *
 * Run: node scripts/generate_scahc_policies.js
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import JSZip from "jszip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, "..");

const TEMPLATE_PATH = path.join(REPO, "server", "policyTemplates", "lab_overlays", "scahc_tagged.docx");
const DATA_DIR     = path.join(REPO, "server", "policyTemplates", "data");
const MASTER_LIST  = path.join(REPO, "server", "veritapolicyMasterList.ts");

const TODAY = new Date().toISOString().slice(0, 10);
const OUT_ZIP = `C:\\Users\\veril\\OneDrive\\Desktop\\Lab\\Verita Products\\SCAHC_Policies_Bundle_${TODAY}.zip`;

// SCAHC lab context. Phase 2 will pull these from the labs row at request time.
const SCAHC = {
  lab_name: "San Carlos Apache Healthcare Corporation",
  // John's actual CLIA isn't in agent memory; placeholder. The director fills
  // dates manually anyway; the CLIA only flows into TJC/CAP filtering if we
  // tracked accreditation flags, which we don't here. Phase 2 fixes this.
  clia: "Pending",
  // SCAHC's chosen accreditor for the crosswalk; flagged to John for confirmation.
  accreditors: { tjc: true, cap: false, cola: false, aabb: false },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// docxtemplater inserts \n as a soft line-break (<w:br/>). That gives us
// list-looking output without having to use loop-tag syntax in the scaffold.
function joinNumbered(items, lab) {
  return (items || []).map((s, i) => `${i + 1}. ${sub(s, lab)}`).join("\n");
}

function fillTagsForPolicy(tmpl, masterRow, lab) {
  // Filter the master list TJC citations to whichever accreditors SCAHC is under.
  const tjcRef = (lab.accreditors.tjc && masterRow?.tjc_citations) || "";
  return {
    policy_name:   tmpl.policy_name || "",
    tjc_reference: tjcRef || "Not applicable",
    purpose:       sub(tmpl.purpose, lab) || "",
    policy_text:   joinNumbered(tmpl.policy_statements, lab) || "",
    procedure_text: joinNumbered(tmpl.procedure_steps, lab) || "",
    references:    buildReferences(tmpl, masterRow, lab),
  };
}

// Build the REFERENCES section content for the SCAHC scaffold. Format:
//   Federal Regulations:
//     1. <citation>: <label>
//     2. ...
//
//   Verbatim Excerpts:
//     <citation>
//     "<verbatim text>"
//
//     <citation>
//     "<verbatim text>"
//
//   Accreditor Crosswalk:
//     CFR:  <citations from master list>
//     TJC:  <citations>
//     CAP:  <citations>
//     COLA: <citations>
//     AABB: <citations>
//
// Uses \n soft line breaks (docxtemplater linebreaks: true). No em-dashes.
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
      // Wrap verbatim in quotes; preserve as one line (docxtemplater handles
      // wrapping at paragraph width in Word).
      lines.push(`  "${(b.verbatim || "").replace(/\s+/g, " ").trim()}"`);
      lines.push("");
    });
  }

  // Accreditor crosswalk from master list. Show every accreditor the lab is
  // under, plus CFR always (universal).
  const cw = [];
  if (masterRow?.cfr_citations) cw.push(`  CFR:  ${masterRow.cfr_citations}`);
  if (lab.accreditors.tjc  && masterRow?.tjc_citations)  cw.push(`  TJC:  ${masterRow.tjc_citations}`);
  if (lab.accreditors.cap  && masterRow?.cap_citations)  cw.push(`  CAP:  ${masterRow.cap_citations}`);
  if (lab.accreditors.cola && masterRow?.cola_citations) cw.push(`  COLA: ${masterRow.cola_citations}`);
  if (lab.accreditors.aabb && masterRow?.aabb_citations) cw.push(`  AABB: ${masterRow.aabb_citations}`);
  if (cw.length > 0) {
    lines.push("Accreditor Crosswalk:");
    lines.push(...cw);
  }

  return lines.length > 0 ? lines.join("\n") : "No federal regulation citations recorded for this policy.";
}

function generateOne(tmpl, masterRow, lab) {
  const buf = fs.readFileSync(TEMPLATE_PATH);
  const zip = new PizZip(buf);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true, // honor \n in tag values as soft line breaks
  });
  doc.render(fillTagsForPolicy(tmpl, masterRow, lab));
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Loading master list from ${MASTER_LIST}`);
  const master = loadMasterList();
  console.log(`Master list: ${master.length} policies`);
  console.log(`Lab context: ${SCAHC.lab_name}  (accreditors: ${Object.keys(SCAHC.accreditors).filter((k) => SCAHC.accreditors[k]).join(", ") || "(none flagged)"})`);
  console.log();

  const bundle = new JSZip();
  let added = 0;
  let skipped = 0;
  const errors = [];

  for (const row of master) {
    const pid = row.policy_id;
    const tmplPath = findTemplate(pid);
    if (!tmplPath) { skipped += 1; errors.push(`#${pid}: no template file`); continue; }
    const tmpl = JSON.parse(fs.readFileSync(tmplPath, "utf-8"));
    try {
      const buf = generateOne(tmpl, row, SCAHC);
      const safeSlug = (tmpl.slug || tmpl.policy_name.toLowerCase().replace(/[^a-z0-9]+/g, "_")).slice(0, 60);
      const filename = `SCAHC_${String(pid).padStart(3, "0")}_${safeSlug}.docx`;
      bundle.file(filename, buf);
      added += 1;
      process.stdout.write(".");
    } catch (e) {
      skipped += 1;
      errors.push(`#${pid} ${tmpl.policy_name}: ${e.message}`);
      process.stdout.write("F");
    }
  }
  process.stdout.write("\n\n");

  // README inside the zip
  const readme = [
    `SCAHC Laboratory Policy Bundle`,
    `Generated: ${TODAY}`,
    ``,
    `This bundle contains ${added} laboratory policies formatted using SCAHC's`,
    `facility policy template. Each file is a Word document that retains SCAHC's`,
    `header (logo and "POLICIES & PROCEDURES" line), footer (page numbers),`,
    `identity-table fields, and standard boilerplate sections (disclaimer,`,
    `responsibility, education, approval/responsibility).`,
    ``,
    `What's filled in for you:`,
    `  - Policy Name (identity table + footer)`,
    `  - TJC Reference (from VeritaAssure master list, when applicable)`,
    `  - PURPOSE`,
    `  - POLICY (numbered list)`,
    `  - PROCEDURE (numbered list)`,
    ``,
    `What you fill in:`,
    `  - Effective Date`,
    `  - Review Date`,
    `  - Approval Date`,
    `  - Owner (currently set to "Laboratory" by SCAHC's template)`,
    `  - References / Attachments / Appendix section at the end`,
    ``,
    `These are STARTERS, not adopted policies. Review and edit each one to`,
    `match SCAHC's actual procedures, then route through your Policy and`,
    `Procedure Committee for approval.`,
    ``,
    `Source: VeritaAssure (TM) | VeritaPolicy (TM)  https://www.veritaslabservices.com`,
  ].join("\r\n");
  bundle.file(`README_${TODAY}.txt`, readme);

  fs.mkdirSync(path.dirname(OUT_ZIP), { recursive: true });
  const zipBuf = await bundle.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  fs.writeFileSync(OUT_ZIP, zipBuf);

  console.log(`Wrote ${OUT_ZIP}`);
  console.log(`  ${added} policies bundled, ${skipped} skipped, ${(zipBuf.length / 1024).toFixed(1)} KB total`);
  if (errors.length) {
    console.log(`\nIssues:`);
    for (const e of errors) console.log(`  - ${e}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
