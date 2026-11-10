// scripts/verify-lot-expiry-saved.mts
//
// Receipt for BUG-158 (2026-11-10). A finished lot-to-lot study saved its two lot numbers but kept the expiration
// dates only in a draft, and nothing showed them; the PT/INR form's Module 3 Old Lot Expiration was never saved.
// Checks, with made-up lots and values:
//   A. buildLotToLotPayload saves both expiration dates for Run Study as well as Save Draft, and Edit reads them back.
//   B. buildPtCoagPayload saves Module 3's old-lot expiration (Run Study and Save Draft); a skipped Module 3 saves none.
//   C. studyLotRows: the rows the results page and the PDF print, for each case (both, number only, date only, none,
//      PT/INR with and without Module 3, other study types, junk data).
//   D. The PDF's Supporting Data page prints them (lot-to-lot and PT/INR), escaped, and page 1 doesn't change.
// With OUT=<dir> it also writes the two PDFs there to look at.
// Run: rm -f .tmp-lotexp.db && DB_PATH=.tmp-lotexp.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx scripts/verify-lot-expiry-saved.mts
import fs from "node:fs";
import path from "node:path";
import { buildLotToLotPayload, readStudyForms, lotRows } from "../client/src/lib/studyFormPayload";
import { buildPtCoagPayload } from "../client/src/lib/ptCoagPayload";
import { computeStudyResults } from "../client/src/lib/studyResults";
import { studyLotRows } from "../shared/studyLotRows";
import { buildLotToLotHTML, buildPTCoagHTML, generatePDFBuffer, getBrowser } from "../server/pdfReport";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── A: lot-to-lot ──
const pairs: Array<[number, number]> = [[100, 101], [120, 119], [140, 142], [160, 158], [180, 181]];
const grid = lotRows(5, "Normal").map((r, i) => ({ ...r, currentLot: pairs[i][0], newLot: pairs[i][1] }));
const lotForm = (over: Record<string, unknown> = {}) => ({
  sampleType: "normal" as const, currentLotNum: "CUR-MU-158", currentLotExp: "2027-01-31", newLotNum: "NEW-MU-158", newLotExp: "2027-06-30",
  analyte: "Made-up Glucose", units: "mg/dL", numSpecimens: 5, data: grid, dataAbnormal: [], ...over,
});
const runSaved: any = buildLotToLotPayload(lotForm()).dataPoints;
const draftSaved: any = buildLotToLotPayload(lotForm(), { draft: true }).dataPoints;
check("A1. Run Study saves both lot expiration dates", runSaved.currentLotExp === "2027-01-31" && runSaved.newLotExp === "2027-06-30", JSON.stringify(runSaved));
check("A2. ... and Save Draft saves the same shape", same(runSaved, draftSaved));
check("A3. ... the lot numbers, pairs and cohort are saved as before", runSaved.currentLot === "CUR-MU-158" && runSaved.newLot === "NEW-MU-158" && runSaved.data.length === 5 && runSaved.data.every((d: any) => d.cohort === "Normal"));
const lotRow: any = { id: 1, studyType: "lot_to_lot", testName: "Made-up Glucose", instrument: "Made-up Analyzer", analyst: "Made-up Analyst", date: "2026-11-10",
  cliaAllowableError: 0.1, teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel: "Lab-defined",
  dataPoints: JSON.stringify(runSaved), instruments: JSON.stringify(["Made-up Analyzer"]), status: "pass", createdAt: "2026-11-10T00:00:00Z" };
const back: any = (readStudyForms(lotRow) as any).lot_to_lot;
check("A4. Edit of the finished study reads both dates back", back?.currentLotExp === "2027-01-31" && back?.newLotExp === "2027-06-30", JSON.stringify({ c: back?.currentLotExp, n: back?.newLotExp }));
const blankSaved: any = buildLotToLotPayload(lotForm({ currentLotExp: "", newLotExp: "" })).dataPoints;
check("A5. A study with no dates entered saves them blank, and Edit reads blank", blankSaved.currentLotExp === "" && (readStudyForms({ ...lotRow, dataPoints: JSON.stringify(blankSaved) }) as any).lot_to_lot?.newLotExp === "");

// ── B: PT/INR Module 3 ──
const NORMALS = [11.4, 11.8, 12.1, 11.9, 12.3, 11.6, 12.0, 11.7, 12.2, 11.5, 12.4, 11.8, 12.0, 11.9, 12.1, 11.7, 12.2, 11.6, 12.3, 11.8];
const ptRows = (filled: boolean) => Array.from({ length: 20 }, (_, i) => ({ id: `S${String(i + 1).padStart(5, "0")}`, x: filled ? 11 + i * 0.6 : null, y: filled ? +((11 + i * 0.6) * 1.03).toFixed(2) : null }));
const ptForm = (over: Record<string, unknown> = {}) => ({
  instrument1: { name: "Made-up CA-660", reagentLot: "LOT-NEW-158", reagentExp: "2027-06-30", isi: 0.97, ptRILow: 10, ptRIHigh: 14, inrRILow: 0.9, inrRIHigh: 1.2, ptValues: [...NORMALS] as (number | null)[] },
  addlInstruments: [], instrument2Name: "Made-up CA-660 Backup", module2Rows: ptRows(false), module2TEa: 0.2,
  skipModule3: false, module3Rows: ptRows(true), module3TEa: 0.15, oldLotNum: "LOT-OLD-158", oldLotExp: "2026-12-31", ...over,
});
const ptRun: any = buildPtCoagPayload(ptForm() as any).dataPoints;
const ptDraft: any = buildPtCoagPayload(ptForm() as any, { draft: true }).dataPoints;
check("B1. Run Study saves Module 3's old-lot expiration", ptRun.module3?.oldLotExp === "2026-12-31" && ptRun.module3?.oldLot === "LOT-OLD-158", JSON.stringify(ptRun.module3 && { oldLot: ptRun.module3.oldLot, oldLotExp: ptRun.module3.oldLotExp }));
check("B2. ... and so does Save Draft", ptDraft.module3?.oldLotExp === "2026-12-31");
check("B3. A skipped Module 3 saves no module (and so no date)", buildPtCoagPayload(ptForm({ skipModule3: true }) as any).dataPoints.module3 === null);
check("B4. The rest of the saved shape is unchanged (reagent lot and expiration, Module 3 pairs)", ptRun.reagentLot === "LOT-NEW-158" && ptRun.reagentExp === "2027-06-30" && ptRun.module3.newLot === "LOT-NEW-158" && ptRun.module3.data.length === 20);

// ── C: the rows printed ──
const rowsOf = (studyType: string, dp: unknown) => studyLotRows({ studyType, dataPoints: typeof dp === "string" ? dp : JSON.stringify(dp) });
check("C1. lot-to-lot: Current Lot and New Lot, each with its expiration", same(rowsOf("lot_to_lot", runSaved), [["Current Lot", "CUR-MU-158 (exp 2027-01-31)"], ["New Lot", "NEW-MU-158 (exp 2027-06-30)"]]), JSON.stringify(rowsOf("lot_to_lot", runSaved)));
check("C2. A study saved before this fix (numbers, no dates) prints the numbers alone", same(rowsOf("lot_to_lot", { ...runSaved, currentLotExp: undefined, newLotExp: undefined }), [["Current Lot", "CUR-MU-158"], ["New Lot", "NEW-MU-158"]]));
check("C3. A date with no lot number reads 'Not entered (exp ...)'", same(rowsOf("lot_to_lot", { ...runSaved, newLot: "", currentLot: "" }), [["Current Lot", "Not entered (exp 2027-01-31)"], ["New Lot", "Not entered (exp 2027-06-30)"]]));
check("C4. Nothing entered prints no rows", rowsOf("lot_to_lot", { ...blankSaved, currentLot: "", newLot: "" }).length === 0);
check("C5. PT/INR with Module 3: the old lot and its date, and the new lot with the reagent's date", same(rowsOf("pt_coag", ptRun), [["Module 3 Old Lot", "LOT-OLD-158 (exp 2026-12-31)"], ["Module 3 New Lot", "LOT-NEW-158 (exp 2027-06-30)"]]), JSON.stringify(rowsOf("pt_coag", ptRun)));
check("C6. PT/INR with Module 3 skipped prints no lot rows", rowsOf("pt_coag", buildPtCoagPayload(ptForm({ skipModule3: true }) as any).dataPoints).length === 0);
check("C7. Other study types and junk saved data print no rows", rowsOf("precision", runSaved).length === 0 && rowsOf("lot_to_lot", "not json").length === 0 && rowsOf("lot_to_lot", "[1,2]").length === 0 && studyLotRows({ studyType: "lot_to_lot", dataPoints: null }).length === 0);

// ── D: the PDF ──
const lotResults = computeStudyResults(lotRow) as any;
const lotHtml = buildLotToLotHTML(lotRow, lotResults);
const spec = (k: string, v: string) => `<span class="spec-label">${k}</span><span class="spec-value">${v}</span>`;
check("D1. Lot-to-lot PDF: the Supporting Data page lists both lots with their dates", lotHtml.includes(spec("Current Lot", "CUR-MU-158 (exp 2027-01-31)")) && lotHtml.includes(spec("New Lot", "NEW-MU-158 (exp 2027-06-30)")));
// Everything before the Supporting Data page's own div (the class name also appears in the stylesheet).
const page1 = (html: string) => { const at = html.indexOf(`<div class="supporting-page">`); return at < 0 ? "" : html.slice(0, at); };
check("D2. ... and not on page 1 (the director's review block stays where it was)", !page1(lotHtml).includes("(exp 2027-01-31)") && /Laboratory Director or Designee Review/i.test(page1(lotHtml)));
const oldShape = buildLotToLotHTML({ ...lotRow, dataPoints: JSON.stringify({ ...runSaved, currentLotExp: undefined, newLotExp: undefined }) }, lotResults);
check("D3. ... page 1 reads the same with or without the dates", page1(oldShape) === page1(lotHtml));
const tricky = buildLotToLotHTML({ ...lotRow, dataPoints: JSON.stringify({ ...runSaved, newLot: "N<1>&2" }) }, lotResults);
check("D4. ... a lot number is escaped on that page", tricky.includes(spec("New Lot", "N&lt;1&gt;&amp;2 (exp 2027-06-30)")));
const ptRow: any = { ...lotRow, id: 2, studyType: "pt_coag", testName: "PT", instrument: "Made-up CA-660", cliaAllowableError: 0.2, cliaPresetLabel: "Lab-defined",
  dataPoints: JSON.stringify(ptRun), instruments: JSON.stringify(["Made-up CA-660", "Made-up CA-660 Backup"]) };
const ptResults = computeStudyResults(ptRow) as any;
const ptHtml = buildPTCoagHTML(ptRow, ptResults);
check("D5. PT/INR PDF: the Supporting Data page lists Module 3's old lot with its date", ptHtml.includes(spec("Module 3 Old Lot", "LOT-OLD-158 (exp 2026-12-31)")) && ptHtml.includes(spec("Module 3 New Lot", "LOT-NEW-158 (exp 2027-06-30)")));

const OUT = process.env.OUT;
if (OUT) {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await getBrowser();
  for (const [name, row, res] of [["bug158-lot-to-lot", lotRow, lotResults], ["bug158-ptinr-m3", ptRow, ptResults]] as const) {
    const pdf = await generatePDFBuffer(row, res, "22D0000158");
    fs.writeFileSync(path.join(OUT, `${name}.pdf`), pdf);
    console.log(`wrote ${path.join(OUT, `${name}.pdf`)} (${pdf.length} bytes)`);
  }
  await browser.close();
}

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
