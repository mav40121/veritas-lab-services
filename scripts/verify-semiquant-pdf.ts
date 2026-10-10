// scripts/verify-semiquant-pdf.ts
//
// Receipt for BUG-022 (Troy Regional, Rachel Hermosilla 2026-10-10: "In the website, the Sample by Sample Detail
// data is there, however, once you download the report and print it, it will show undefined.").
// Renders REAL PDFs with the server generator (generatePDFBuffer, the /api/generate-pdf path) from results built
// by the REAL client calculators (calculateSemiQuant / calculateQualitative), then reads the PDF text with
// PyMuPDF. Synthetic dipstick-style data; no lab data.
//   1. Semi-quantitative: the Sample-by-Sample Detail shows each sample's grades, never "undefined" or "NaN".
//   2. Semi-quantitative: the status column reads Exact / +-1 / +-2 from the grade difference.
//   3. Semi-quantitative: the threshold reads ">=80%", not ">=0.8%".
//   4. Qualitative: the threshold reads ">=90%", not ">=0.9%".
// Run (from repo root): node_modules/.bin/tsx scripts/verify-semiquant-pdf.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateSemiQuant, calculateQualitative } from "../client/src/lib/calculations";
import { generatePDFBuffer } from "../server/pdfReport";

let fails = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`); if (!ok) fails++; };
const dir = mkdtempSync(join(tmpdir(), "bug022-"));
const textOf = (buf: Buffer, name: string) => {
  const f = join(dir, name); writeFileSync(f, buf);
  return execFileSync("python", ["-c", "import fitz,sys; d=fitz.open(sys.argv[1]); sys.stdout.reconfigure(encoding='utf-8'); print(''.join(p.get_text() for p in d))", f], { encoding: "utf-8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
};
const study = (id: number, testName: string, dataPoints: any) => ({
  id, userId: 1, testName, instrument: "Reference Analyzer, Comparison Analyzer", analyst: "QA", date: "2026-10-10",
  studyType: "method_comparison", cliaAllowableError: 0, dataPoints: JSON.stringify(dataPoints),
  instruments: JSON.stringify(["Reference Analyzer", "Comparison Analyzer"]), status: "completed", createdAt: new Date().toISOString(),
} as any);

async function main() {
  // Semi-quantitative: 6 samples on a urine-glucose style scale; one exact pair, then +-1 and +-2 differences.
  const scale = ["Normal", "30", "50", "70", "100", "150"];
  const pairs: [string, string][] = [["Normal", "Normal"], ["30", "30"], ["50", "70"], ["70", "70"], ["100", "150"], ["30", "70"]];
  const sqPoints = pairs.map(([ref, comp], i) => ({ level: i + 1, expectedValue: null, instrumentValues: { "Comparison Analyzer": null }, expectedCategory: ref, instrumentCategories: { "Comparison Analyzer": comp } }));
  const sq = calculateSemiQuant(sqPoints as any, ["Comparison Analyzer"], scale, 0.8);
  const sqText = textOf(await generatePDFBuffer(study(9001, "UR Glucose", { assayType: "semi_quantitative", gradeScale: scale, passThreshold: 0.8, points: sqPoints }), sq), "semiquant.pdf");
  const detail = sqText.slice(sqText.indexOf("Sample-by-Sample Detail"));
  check("1. semi-quant detail has no 'undefined' or 'NaN'", sqText.includes("Sample-by-Sample Detail") && !/undefined|NaN/.test(detail), (detail.match(/undefined|NaN/g) || []).join(",") || "clean");
  check("1. semi-quant detail lists each sample's reference and comparison grades", /S3\s+50\s+70/.test(detail) && /S5\s+100\s+150/.test(detail), detail.replace(/\s+/g, " ").slice(0, 160));
  check("2. status reads Exact / ±1 / ±2 from the grade difference", /S1\s+Normal\s+Normal\s+Exact/.test(detail) && /S3\s+50\s+70\s+±1/.test(detail) && /S6\s+30\s+70\s+±2/.test(detail));
  check("3. semi-quant threshold reads ≥80%, not ≥0.8%", /≥80%/.test(sqText) && !/≥0\.8%/.test(sqText), (sqText.match(/≥[0-9.]+%/g) || []).join(" "));

  // Qualitative: Pos / Neg
  const qPairs: [string, string][] = [["Neg", "Neg"], ["Pos", "Pos"], ["Neg", "Neg"], ["Pos", "Neg"], ["Neg", "Neg"]];
  const qPoints = qPairs.map(([ref, comp], i) => ({ level: i + 1, expectedValue: null, instrumentValues: { "Comparison Analyzer": null }, expectedCategory: ref, instrumentCategories: { "Comparison Analyzer": comp } }));
  const q = calculateQualitative(qPoints as any, ["Comparison Analyzer"], ["Pos", "Neg"], 0.9);
  const qText = textOf(await generatePDFBuffer(study(9002, "UR Nitrite", { assayType: "qualitative", categories: ["Pos", "Neg"], passThreshold: 0.9, points: qPoints }), q), "qual.pdf");
  check("4. qualitative threshold reads ≥90%, not ≥0.9%", /≥90%/.test(qText) && !/≥0\.9%/.test(qText), (qText.match(/≥[0-9.]+%/g) || []).join(" "));

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
