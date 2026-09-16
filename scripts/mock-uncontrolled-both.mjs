import fs from "node:fs";
import path from "node:path";
const REPO_ROOT = process.cwd();
const POLICY_ID = "110";
const LAB = { lab_name: "Riverside Regional Medical Center", clia_number: "22D0999999" };
const OUT_DIR = "C:/Users/veril/AppData/Local/Temp/claude/C--Users-veril/76f2cc96-752b-49d6-be5b-616759d60139/scratchpad";
const { generatePolicyDocxBuffer, loadTemplate } = await import("../server/veritapolicyDocx.ts");
const tmpl = loadTemplate(POLICY_ID);
if (!tmpl) { console.error("no template"); process.exit(1); }
const mlText = fs.readFileSync(path.join(REPO_ROOT, "server", "veritapolicyMasterList.ts"), "utf-8");
const m = mlText.match(/export const VERITAPOLICY_MASTER_LIST:[^=]*=\s*(\[[\s\S]*?\]);\s*$/m);
const row = m ? JSON.parse(m[1]).find((r) => String(r.policy_id) === POLICY_ID) : null;
const crosswalk = row ? { cfr: row.cfr_citations, tjc: row.tjc_citations, cap: row.cap_citations, cola: row.cola_citations } : null;

for (const uncontrolled of [false, true]) {
  const buf = await generatePolicyDocxBuffer(POLICY_ID, LAB, crosswalk, { uncontrolled });
  const out = path.join(OUT_DIR, `policy-${uncontrolled ? "ON" : "OFF"}.docx`);
  fs.writeFileSync(out, buf);
  console.log(`WROTE ${out} (${buf.length} bytes) uncontrolled=${uncontrolled}`);
}
console.log("policy:", tmpl.policy_name);
