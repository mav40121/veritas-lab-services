// scripts/render-ptinr-narrative-pdf.mts
//
// Artifact receipt for BUG-161: renders the real PT/INR PDF (generatePDFBuffer, the route's builder) for made-up studies
// saved as the form saves them, and a PNG of page 1's HTML, so the narrative can be looked at. Writes to OUT:
//   ptinr-m1-only.pdf / .png   Module 1 only (the SCAHC shape)
//   ptinr-m3-15.pdf / .png     Module 3 alone at 15%
// Run: rm -f .tmp-ptinr-render.db && OUT=<dir> DB_PATH=.tmp-ptinr-render.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx scripts/render-ptinr-narrative-pdf.mts
import fs from "node:fs";
import path from "node:path";
import { db } from "../server/db";
import { buildPTCoagHTML, generatePDFBuffer, getBrowser } from "../server/pdfReport";
import { studyRowToClient } from "../server/studyPdf";
import { computeStudyResults } from "../client/src/lib/studyResults";
import { buildPtCoagPayload } from "../client/src/lib/ptCoagPayload";

const OUT = process.env.OUT || ".";
fs.mkdirSync(OUT, { recursive: true });
const sqlite = (db as any).$client;
const insert = sqlite.prepare(`INSERT INTO studies (user_id, created_by_user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at,
  tea_is_percentage, tea_unit, clia_absolute_floor, clia_absolute_unit, clia_preset_label)
  VALUES (1, 1, 'PT', @instrument, 'Made-up Analyst', '2026-11-10', 'pt_coag', @tea, @points, @instruments, 'pass', '2026-11-10T00:00:00Z', 1, '%', NULL, NULL, 'ALT/SGPT (±15% or ±6 U/L)')`);
const NORMALS = [11.4, 11.8, 12.1, 11.9, 12.3, 11.6, 12.0, 11.7, 12.2, 11.5, 12.4, 11.8, 12.0, 11.9, 12.1, 11.7, 12.2, 11.6, 12.3, 11.8];
const rows = () => Array.from({ length: 20 }, (_, i) => ({ id: `S${String(i + 1).padStart(5, "0")}`, x: null as number | null, y: null as number | null }));
const pairs = (r: ReturnType<typeof rows>, f: number) => { r.forEach((row, i) => { row.x = 11 + i * 0.6; row.y = +((11 + i * 0.6) * f).toFixed(2); }); return r; };
const form = (m3: boolean) => ({
  instrument1: { name: "Made-up CA-660", reagentLot: "LOT-NEW", reagentExp: "2027-06-30", isi: 0.97, ptRILow: 10, ptRIHigh: 14, inrRILow: 0.9, inrRIHigh: 1.2, ptValues: [...NORMALS] as (number | null)[] },
  addlInstruments: [], instrument2Name: "Made-up CA-660 Backup",
  module2Rows: rows(), module2TEa: 0.2,
  skipModule3: false, module3Rows: m3 ? pairs(rows(), 1.03) : rows(), module3TEa: 0.15, oldLotNum: "LOT-OLD",
});
const browser = await getBrowser();
for (const [name, m3] of [["ptinr-m1-only", false], ["ptinr-m3-15", true]] as const) {
  const f = form(m3);
  const id = Number(insert.run({ instrument: f.instrument1.name, tea: f.module2TEa, points: JSON.stringify(buildPtCoagPayload(f).dataPoints), instruments: JSON.stringify([f.instrument1.name, f.instrument2Name]) }).lastInsertRowid);
  const study = studyRowToClient(sqlite.prepare("SELECT * FROM studies WHERE id = ?").get(id));
  const results = computeStudyResults(study) as any;
  const pdf = await generatePDFBuffer(study, results, "22D0000161");
  fs.writeFileSync(path.join(OUT, `${name}.pdf`), pdf);
  const page = await browser.newPage();
  await page.setViewport({ width: 816, height: 1056 });
  await page.setContent(buildPTCoagHTML(study, results), { waitUntil: "networkidle0" });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  await page.close();
  console.log(`${name}: pdf ${pdf.length} bytes, starts ${pdf.subarray(0, 5).toString()}`);
}
await browser.close();
process.exit(0);
