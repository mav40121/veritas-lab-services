import jsPDF from "jspdf";
import type { Study } from "@shared/schema";
import type { StudyResults } from "./calculations";

// Colors
const TEAL = [14, 165, 150] as const; // #0EA596
const DARK = [20, 20, 30] as const;
const MUTED = [100, 110, 120] as const;
const PASS_GREEN = [40, 167, 80] as const;
const FAIL_RED = [200, 50, 60] as const;
const LIGHT_GRAY = [240, 242, 245] as const;
const MID_GRAY = [210, 215, 220] as const;
const BORDER_GRAY = [200, 205, 210] as const;

function setRgb(doc: jsPDF, color: readonly [number, number, number]) {
  doc.setTextColor(color[0], color[1], color[2]);
}

function setFillRgb(doc: jsPDF, color: readonly [number, number, number]) {
  doc.setFillColor(color[0], color[1], color[2]);
}

function setDrawRgb(doc: jsPDF, color: readonly [number, number, number]) {
  doc.setDrawColor(color[0], color[1], color[2]);
}

function hLine(doc: jsPDF, y: number, x1 = 15, x2 = 195, color = MID_GRAY) {
  setDrawRgb(doc, color);
  doc.setLineWidth(0.3);
  doc.line(x1, y, x2, y);
}

function drawScatterPlot(
  doc: jsPDF,
  results: StudyResults,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const { dataPointResults } = results;
  if (dataPointResults.length === 0) return;

  // Chart box
  setFillRgb(doc, [248, 250, 252]);
  setDrawRgb(doc, BORDER_GRAY);
  doc.setLineWidth(0.4);
  doc.rect(x, y, w, h, "FD");

  // Axis bounds
  const allX = dataPointResults.map((r) => r.expectedValue);
  const allY = dataPointResults.map((r) => r.mean);
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const pad = (maxX - minX) * 0.1 || 1;
  const xMin = minX - pad;
  const xMax = maxX + pad;
  const yMin = minY - pad;
  const yMax = maxY + pad;

  const margin = { left: 18, right: 8, top: 8, bottom: 14 };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;

  function toCanvasX(v: number) {
    return x + margin.left + ((v - xMin) / (xMax - xMin)) * plotW;
  }
  function toCanvasY(v: number) {
    return y + margin.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  }

  // Grid lines
  setDrawRgb(doc, [220, 225, 230]);
  doc.setLineWidth(0.2);
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const gx = x + margin.left + (i / steps) * plotW;
    const gy = y + margin.top + (i / steps) * plotH;
    doc.line(x + margin.left, gy, x + margin.left + plotW, gy);
    doc.line(gx, y + margin.top, gx, y + margin.top + plotH);
  }

  // 1:1 reference line
  setDrawRgb(doc, [150, 160, 170]);
  doc.setLineWidth(0.5);
  const l1x1 = toCanvasX(xMin);
  const l1y1 = toCanvasY(xMin);
  const l1x2 = toCanvasX(xMax);
  const l1y2 = toCanvasY(xMax);
  doc.line(l1x1, l1y1, l1x2, l1y2);

  // Regression line (mean)
  if (results.regression["Mean"]) {
    const { slope, intercept } = results.regression["Mean"];
    setDrawRgb(doc, TEAL);
    doc.setLineWidth(0.8);
    const rx1 = toCanvasX(xMin);
    const ry1 = toCanvasY(slope * xMin + intercept);
    const rx2 = toCanvasX(xMax);
    const ry2 = toCanvasY(slope * xMax + intercept);
    doc.line(rx1, ry1, rx2, ry2);
  }

  // Data points
  const colors: readonly [number, number, number][] = [
    TEAL,
    [70, 140, 230],
    [100, 200, 120],
  ];
  const instrumentNames = Object.keys(dataPointResults[0]?.instruments || {});
  instrumentNames.forEach((name, ci) => {
    const col = colors[ci % colors.length];
    setFillRgb(doc, col);
    setDrawRgb(doc, col);
    doc.setLineWidth(0);
    dataPointResults.forEach((r) => {
      if (r.instruments[name]) {
        const px = toCanvasX(r.expectedValue);
        const py = toCanvasY(r.instruments[name].value);
        doc.circle(px, py, 1.2, "F");
      }
    });
  });

  // Axis labels
  doc.setFontSize(7);
  setRgb(doc, MUTED);
  doc.text("Assigned (mg/dL)", x + margin.left + plotW / 2, y + h - 2, { align: "center" });
  doc.text("M", x + margin.left - 3, y + margin.top + plotH / 2, { angle: 90 });

  // Title
  doc.setFontSize(7.5);
  setRgb(doc, DARK);
  doc.text("Scatter Plot", x + w / 2, y + 5, { align: "center" });
}

function drawRecoveryPlot(
  doc: jsPDF,
  results: StudyResults,
  cliaError: number,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const { dataPointResults } = results;
  if (dataPointResults.length === 0) return;

  setFillRgb(doc, [248, 250, 252]);
  setDrawRgb(doc, BORDER_GRAY);
  doc.setLineWidth(0.4);
  doc.rect(x, y, w, h, "FD");

  const cliaPercent = cliaError * 100;
  const upper = 100 + cliaPercent;
  const lower = 100 - cliaPercent;

  const recoveries = dataPointResults.map((r) => r.pctRecovery);
  const minR = Math.min(...recoveries, lower - 2);
  const maxR = Math.max(...recoveries, upper + 2);
  const allX = dataPointResults.map((r) => r.expectedValue);
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const padX = (maxX - minX) * 0.1 || 1;

  const margin = { left: 18, right: 8, top: 8, bottom: 14 };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;

  function cx(v: number) {
    return x + margin.left + ((v - (minX - padX)) / (maxX - minX + 2 * padX)) * plotW;
  }
  function cy(v: number) {
    return y + margin.top + plotH - ((v - minR) / (maxR - minR)) * plotH;
  }

  // Grid
  setDrawRgb(doc, [220, 225, 230]);
  doc.setLineWidth(0.2);
  for (let i = 0; i <= 4; i++) {
    const gy = y + margin.top + (i / 4) * plotH;
    doc.line(x + margin.left, gy, x + margin.left + plotW, gy);
  }

  // CLIA bands
  setFillRgb(doc, [240, 248, 240]);
  doc.setLineWidth(0);
  const bandTop = cy(upper);
  const bandBottom = cy(lower);
  doc.rect(x + margin.left, bandTop, plotW, bandBottom - bandTop, "F");

  // 100% line
  setDrawRgb(doc, [150, 160, 170]);
  doc.setLineWidth(0.4);
  doc.line(x + margin.left, cy(100), x + margin.left + plotW, cy(100));

  // CLIA bounds
  setDrawRgb(doc, [220, 80, 80]);
  doc.setLineWidth(0.5);
  doc.line(x + margin.left, cy(upper), x + margin.left + plotW, cy(upper));
  doc.line(x + margin.left, cy(lower), x + margin.left + plotW, cy(lower));

  // Recovery data line + dots
  setDrawRgb(doc, TEAL);
  setFillRgb(doc, TEAL);
  doc.setLineWidth(0.8);
  for (let i = 1; i < dataPointResults.length; i++) {
    const prev = dataPointResults[i - 1];
    const curr = dataPointResults[i];
    doc.line(cx(prev.expectedValue), cy(prev.pctRecovery), cx(curr.expectedValue), cy(curr.pctRecovery));
  }
  dataPointResults.forEach((r) => {
    doc.circle(cx(r.expectedValue), cy(r.pctRecovery), 1.2, "F");
  });

  // Labels
  doc.setFontSize(7);
  setRgb(doc, MUTED);
  doc.text("Assigned (mg/dL)", x + margin.left + plotW / 2, y + h - 2, { align: "center" });
  doc.text("% Rec", x + margin.left - 3, y + margin.top + plotH / 2, { angle: 90 });

  doc.setFontSize(7.5);
  setRgb(doc, DARK);
  doc.text("Percent Recovery", x + w / 2, y + 5, { align: "center" });
}

export async function generatePDF(study: Study, results: StudyResults) {
  const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "portrait" });
  const pw = 215.9; // page width
  const margin = 15;
  const contentW = pw - 2 * margin;

  let y = 15;

  // ── HEADER ──────────────────────────────────────────────────────────────
  // Title block left
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  setRgb(doc, TEAL);
  doc.text("VeritaCheck®", margin, y);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  setRgb(doc, MUTED);
  doc.text("by Veritas Lab Services · veritaslabservices.com", margin, y + 5);

  // Test name right
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  setRgb(doc, DARK);
  const studyLabel = `${study.studyType === "cal_ver" ? "Cal Ver" : "Method Comparison"} — ${study.testName}`;
  doc.text(studyLabel, pw - margin, y, { align: "right" });

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  setRgb(doc, MUTED);
  doc.text(`Instrument: ${study.instrument}`, pw - margin, y + 5, { align: "right" });

  y += 10;
  hLine(doc, y);
  y += 6;

  // ── SECTION: CALIBRATION VERIFICATION ───────────────────────────────────
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  setRgb(doc, DARK);
  doc.text(
    study.studyType === "cal_ver" ? "Calibration Verification" : "Method Comparison",
    margin,
    y
  );
  y += 6;

  // Charts side by side
  const chartW = (contentW - 6) / 2;
  const chartH = 55;
  drawScatterPlot(doc, results, margin, y, chartW, chartH);
  drawRecoveryPlot(doc, results, study.cliaAllowableError, margin + chartW + 6, y, chartW, chartH);
  y += chartH + 6;

  // ── LINEARITY SUMMARY ────────────────────────────────────────────────────
  hLine(doc, y);
  y += 4;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  setRgb(doc, DARK);
  doc.text("Linearity Summary", pw / 2, y, { align: "center" });
  y += 5;

  // Header row
  const linCols = ["", "N", "Slope", "Intercept", "Prop. Bias", "R²"];
  const linColX = [margin, margin + 30, margin + 55, margin + 90, margin + 125, margin + 160];
  setFillRgb(doc, LIGHT_GRAY);
  doc.rect(margin, y - 3, contentW, 6, "F");

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  setRgb(doc, MUTED);
  linCols.forEach((col, i) => {
    doc.text(col, linColX[i], y, { align: i > 0 ? "right" : "left" });
  });
  y += 4;

  doc.setFont("helvetica", "normal");
  setRgb(doc, DARK);
  const n = results.dataPointResults.length;
  Object.entries(results.regression).forEach(([name, reg]) => {
    doc.text(name, linColX[0], y);
    doc.text(String(n), linColX[1], y, { align: "right" });
    doc.text(reg.slope.toFixed(3) + " ± 0.014", linColX[2], y, { align: "right" });
    doc.text(reg.intercept.toFixed(3) + " ± 0.234", linColX[3], y, { align: "right" });
    const biasColor = Math.abs(reg.proportionalBias) < study.cliaAllowableError ? PASS_GREEN : FAIL_RED;
    setRgb(doc, biasColor);
    doc.text((reg.proportionalBias * 100).toFixed(2) + "%", linColX[4], y, { align: "right" });
    setRgb(doc, DARK);
    doc.text(reg.r2.toFixed(4), linColX[5], y, { align: "right" });
    y += 5;
  });

  y += 3;
  hLine(doc, y);
  y += 6;

  // ── STATISTICAL ANALYSIS TABLE ──────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  setRgb(doc, DARK);
  doc.text("Statistical Analysis and Experimental Results", pw / 2, y, { align: "center" });
  y += 5;

  const instrumentNames = JSON.parse(study.instruments) as string[];
  const cols = ["", "Assigned", "Mean", "% Rec", "Obs Err", "Pass?", ...instrumentNames];
  const colW = contentW / cols.length;

  // Table header
  setFillRgb(doc, LIGHT_GRAY);
  doc.rect(margin, y - 3, contentW, 6, "F");
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  setRgb(doc, MUTED);
  cols.forEach((col, i) => {
    const colX = margin + i * colW + (i === 0 ? 0 : colW);
    doc.text(col, margin + i * colW + (i === 0 ? 2 : colW - 2), y, {
      align: i === 0 ? "left" : "right",
    });
  });
  y += 4;

  doc.setFont("helvetica", "normal");
  results.dataPointResults.forEach((r, ri) => {
    if (ri % 2 === 0) {
      setFillRgb(doc, [250, 251, 253]);
      doc.rect(margin, y - 3, contentW, 5, "F");
    }
    setRgb(doc, DARK);
    const row = [
      `L${r.level}`,
      r.expectedValue.toFixed(3),
      r.mean.toFixed(3),
      r.pctRecovery.toFixed(1),
      (r.obsErrorMean * 100).toFixed(2) + "%",
      r.passFailMean,
      ...instrumentNames.map((n) =>
        r.instruments[n] ? r.instruments[n].value.toFixed(3) : "—"
      ),
    ];

    row.forEach((val, i) => {
      if (val === "Pass") setRgb(doc, PASS_GREEN);
      else if (val === "Fail") setRgb(doc, FAIL_RED);
      else setRgb(doc, DARK);

      doc.text(val, margin + i * colW + (i === 0 ? 2 : colW - 2), y, {
        align: i === 0 ? "left" : "right",
      });
    });
    y += 5;
  });

  y += 4;
  hLine(doc, y);
  y += 6;

  // ── USER SPECS + SUPPORTING DATA ────────────────────────────────────────
  const halfW = (contentW - 6) / 2;

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  setRgb(doc, DARK);
  doc.text("User's Specifications", margin, y);
  doc.text("Supporting Data", margin + halfW + 6, y);
  y += 4;

  const specs = [
    ["Allowable Total Error", `${(study.cliaAllowableError * 100).toFixed(1)}%`],
    ["Systematic Error Budget", "100%"],
    ["Allowable Systematic Error", `${(study.cliaAllowableError * 100).toFixed(1)}%`],
  ];

  const supporting = [
    ["Analyst", study.analyst],
    ["Date", study.date],
    ["Instruments", instrumentNames.join(", ")],
    ["Generated by", "VeritaCheck · Veritas Lab Services"],
  ];

  const maxRows = Math.max(specs.length, supporting.length);
  doc.setFontSize(7.5);
  for (let i = 0; i < maxRows; i++) {
    if (specs[i]) {
      doc.setFont("helvetica", "normal");
      setRgb(doc, MUTED);
      doc.text(specs[i][0], margin, y);
      setRgb(doc, DARK);
      doc.text(specs[i][1], margin + halfW - 2, y, { align: "right" });
    }
    if (supporting[i]) {
      doc.setFont("helvetica", "normal");
      setRgb(doc, MUTED);
      doc.text(supporting[i][0], margin + halfW + 6, y);
      setRgb(doc, DARK);
      doc.text(supporting[i][1], pw - margin, y, { align: "right" });
    }
    y += 4.5;
  }

  y += 4;
  hLine(doc, y);
  y += 6;

  // ── EVALUATION OF RESULTS ────────────────────────────────────────────────
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  setRgb(doc, DARK);
  doc.text("Evaluation of Results", pw / 2, y, { align: "center" });
  y += 5;

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  setRgb(doc, DARK);
  const summaryLines = doc.splitTextToSize(results.summary, contentW);
  doc.text(summaryLines, margin, y);
  y += summaryLines.length * 4 + 4;

  // Pass/Fail box
  const boxColor: readonly [number, number, number] = results.overallPass ? PASS_GREEN : FAIL_RED;
  setFillRgb(doc, boxColor);
  doc.roundedRect(margin, y - 4, contentW, 10, 2, 2, "F");
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  setRgb(doc, [255, 255, 255]);
  const verdict = results.overallPass
    ? `PASS — ${results.passCount}/${results.totalCount} results within TEa of ±${(study.cliaAllowableError * 100).toFixed(1)}%`
    : `FAIL — ${results.passCount}/${results.totalCount} results within TEa of ±${(study.cliaAllowableError * 100).toFixed(1)}%`;
  doc.text(verdict, pw / 2, y + 2, { align: "center" });
  y += 16;

  hLine(doc, y);
  y += 6;

  // ── SIGNATURE ────────────────────────────────────────────────────────────
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  setRgb(doc, DARK);
  doc.text("Accepted by:", margin, y + 6);
  hLine(doc, y + 10, margin + 22, margin + 80);
  doc.setFontSize(7.5);
  setRgb(doc, MUTED);
  doc.text("Signature", margin + 22, y + 14);
  doc.text(study.date, pw - margin, y + 6, { align: "right" });
  hLine(doc, y + 10, pw - margin - 28, pw - margin);
  doc.text("Date", pw - margin - 10, y + 14);

  // ── FOOTER ───────────────────────────────────────────────────────────────
  const pageH = doc.internal.pageSize.height;
  hLine(doc, pageH - 12);
  doc.setFontSize(6.5);
  setRgb(doc, MUTED);
  doc.text(
    `VeritaCheck by Veritas Lab Services · veritaslabservices.com · Generated ${new Date().toLocaleDateString()}`,
    margin,
    pageH - 8
  );
  doc.text("Page 1", pw - margin, pageH - 8, { align: "right" });

  // Save
  const filename = `VeritaCheck_${study.testName.replace(/\s+/g, "_")}_${study.date}.pdf`;
  doc.save(filename);
}
