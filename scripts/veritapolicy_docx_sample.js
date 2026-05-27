/**
 * VeritaPolicy DOCX sample generator (review mock).
 *
 * Thin wrapper around the canonical server-side generator. Run this to
 * produce a sample DOCX for any policy_id without standing up the server.
 *
 * Usage:
 *   npx tsx scripts/veritapolicy_docx_sample.js [policyId] [outputPath]
 *
 * Defaults to #110 → Desktop sample file. Pulls accreditor citations from
 * the master list and feeds them to the generator the same way the
 * lab-scoped route does in production.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const POLICY_ID = process.argv[2] || "110";
const OUT_PATH = process.argv[3] || "C:\\Users\\veril\\OneDrive\\Desktop\\Lab\\Verita Products\\VeritaPolicy_Sample_110_InfectionPrevention.docx";

// Riverside demo lab fixture per CLAUDE.md §7.
const LAB = { lab_name: "Riverside Regional Medical Center", clia_number: "22D0999999" };

async function main() {
  const { generatePolicyDocxBuffer, loadTemplate } = await import("../server/veritapolicyDocx.ts");
  const tmpl = loadTemplate(POLICY_ID);
  if (!tmpl) {
    console.error(`No template for policy_id=${POLICY_ID}`);
    process.exit(1);
  }
  console.log(`Loaded template #${POLICY_ID}: ${tmpl.policy_name}`);
  console.log(`  ${(tmpl.policy_statements||[]).length} statements, ${(tmpl.procedure_steps||[]).length} steps, ${(tmpl.definitions||[]).length} defs, ${(tmpl.cfr_text_blocks||[]).length} CFR blocks`);

  // Build crosswalk fixture: assume Riverside is TJC + CAP + COLA accredited
  // so the sample exercises the full crosswalk rendering path.
  const tsPath = path.join(REPO_ROOT, "server", "veritapolicyMasterList.ts");
  const mlText = fs.readFileSync(tsPath, "utf-8");
  const m = mlText.match(/export const VERITAPOLICY_MASTER_LIST:[^=]*=\s*(\[[\s\S]*?\]);\s*$/m);
  const masterRow = m ? JSON.parse(m[1]).find((r) => String(r.policy_id) === String(POLICY_ID)) : null;
  const crosswalk = masterRow ? {
    cfr:  masterRow.cfr_citations || undefined,
    tjc:  masterRow.tjc_citations || undefined,
    cap:  masterRow.cap_citations || undefined,
    cola: masterRow.cola_citations || undefined,
  } : null;
  if (crosswalk) {
    const cw = crosswalk;
    console.log(`Crosswalk fixture: CFR=${cw.cfr ? 'Y' : '-'}  TJC=${cw.tjc ? 'Y' : '-'}  CAP=${cw.cap ? 'Y' : '-'}  COLA=${cw.cola ? 'Y' : '-'}`);
  }

  const buf = await generatePolicyDocxBuffer(POLICY_ID, LAB, crosswalk);
  if (!buf) {
    console.error("Generator returned null");
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, buf);
  console.log(`Wrote ${OUT_PATH}  (${buf.length.toLocaleString()} bytes)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
