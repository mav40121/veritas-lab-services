// scripts/render-sampson-policy-sample.mts
// Renders one stock policy in the Sampson Regional house format (REQ-019) to a .docx for review.
// Usage: npx tsx scripts/render-sampson-policy-sample.mts <policyId> <out.docx>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [policyId = "36", out = "sampson_policy.docx"] = process.argv.slice(2);
const outAbs = path.resolve(out);
process.chdir(ROOT);
const { generatePolicyDocxBuffer } = await import("../server/veritapolicyDocx");
const buf = await generatePolicyDocxBuffer(policyId, { lab_name: "Sampson Regional Medical Center", clia_number: "" }, null, undefined,
  { format: "sampson_regional", draftDate: new Date().toISOString().slice(0, 10) });
if (!buf) { console.error("no template", policyId); process.exit(2); }
fs.writeFileSync(outAbs, buf);
console.log("wrote", outAbs, buf.length, "bytes");
