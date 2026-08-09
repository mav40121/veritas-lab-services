// Reusable per-module review scorecard generator (VeritaAssure site/code review).
// Reads a findings JSON and writes a styled xlsx per CLAUDE.md section 6.
// Env: MODULE, FINDINGS_JSON (path), OUT_XLSX, REVIEW_DATE, VERDICT (short paragraph)
import { readFileSync } from "node:fs";
const { default: ExcelJS } = await import("exceljs");

const MODULE = process.env.MODULE || "Module";
const FINDINGS = JSON.parse(readFileSync(process.env.FINDINGS_JSON, "utf8"));
const OUT = process.env.OUT_XLSX;
const REVIEW_DATE = process.env.REVIEW_DATE || "";
const VERDICT = process.env.VERDICT || "";

const TEAL = "FF01696F", TEALTINT = "FFE6F2F2", ALT = "FFEBF3F8", TXT = "FF28251D";
const SEV = {
  sev0_critical: { label: "SEV-0 CRITICAL", fill: "FFA12C7B" },
  high: { label: "HIGH", fill: "FFA12C7B" },
  medium: { label: "MEDIUM", fill: "FF964219" },
  low: { label: "LOW", fill: "FF7A7974" },
};
const rank = { sev0_critical: 0, high: 1, medium: 2, low: 3 };
FINDINGS.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));

const wb = new ExcelJS.Workbook();
wb.creator = "Perplexity Computer";
const ws = wb.addWorksheet(MODULE.slice(0, 28), { views: [{ state: "frozen", ySplit: 6, xSplit: 1 }] });

// Title bar
ws.mergeCells("A1:I1");
const t = ws.getCell("A1");
t.value = `VeritaAssure Review  ·  ${MODULE}`;
t.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
ws.getRow(1).height = 30;

ws.mergeCells("A2:I2");
const s = ws.getCell("A2");
const counts = ["sev0_critical", "high", "medium", "low"].map(k => `${SEV[k].label}: ${FINDINGS.filter(f => f.severity === k).length}`).join("    ");
s.value = `${REVIEW_DATE}    ${counts}    (all findings HELD, nothing shipped)`;
s.font = { name: "Calibri", size: 10, bold: true, color: { argb: TXT } };
s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEALTINT } };
s.alignment = { vertical: "middle", indent: 1 };
ws.getRow(2).height = 20;

ws.mergeCells("A3:I5");
const v = ws.getCell("A3");
v.value = "VERDICT: " + VERDICT;
v.font = { name: "Calibri", size: 10, color: { argb: TXT } };
v.alignment = { wrapText: true, vertical: "top", indent: 1 };

// Header row (row 6)
const HEAD = ["#", "Severity", "Lens", "Finding", "What the user / prospect / surveyor experiences", "Why it costs a sale or a client", "Evidence (file:line)", "Recommendation (HELD)", "Source / Confidence"];
const WIDTHS = [4, 14, 16, 30, 44, 40, 34, 46, 20];
const hr = ws.getRow(6);
HEAD.forEach((h, i) => {
  const c = hr.getCell(i + 1);
  c.value = h;
  c.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  c.alignment = { vertical: "middle", wrapText: true, indent: 1 };
  ws.getColumn(i + 1).width = WIDTHS[i];
});
hr.height = 26;

const border = { style: "thin", color: { argb: "FFD0D0D0" } };
FINDINGS.forEach((f, idx) => {
  const r = ws.getRow(7 + idx);
  const sev = SEV[f.severity] || SEV.low;
  const cells = [
    idx + 1,
    sev.label,
    f.dimension || f.lens || "",
    f.title || "",
    f.what_happens || "",
    f.why_it_matters || "",
    f.evidence || (f.file ? `${f.file}${f.line ? ":" + f.line : ""}` : ""),
    f.recommendation || "",
    `${f.source || "workflow"}${f.confidence ? " / " + f.confidence : ""}`,
  ];
  cells.forEach((val, i) => {
    const c = r.getCell(i + 1);
    c.value = val === null || val === undefined ? "" : val;
    c.font = { name: "Calibri", size: 10, color: { argb: TXT } };
    c.alignment = { vertical: "top", wrapText: true, indent: 1 };
    c.border = { top: border, bottom: border, left: border, right: border };
    if (idx % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALT } };
  });
  const sc = r.getCell(2);
  sc.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  sc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sev.fill } };
  sc.alignment = { vertical: "middle", horizontal: "center" };
});

ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: 9 } };
ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

await wb.xlsx.writeFile(OUT);
console.log(`WROTE ${OUT}  (${FINDINGS.length} findings)`);
