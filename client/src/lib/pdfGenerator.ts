import jsPDF from "jspdf";
import type { Study } from "@shared/schema";
import type { StudyResults, CalVerResults, MethodCompResults } from "./calculations";

// ─── Palette ──────────────────────────────────────────────────────────────────
const TEAL        = [14, 165, 150]  as const;
const DARK        = [20, 20, 30]    as const;
const MUTED       = [100, 110, 120] as const;
const PASS_GREEN  = [40, 167, 80]   as const;
const FAIL_RED    = [200, 50, 60]   as const;
const LIGHT_GRAY  = [240, 242, 245] as const;
const MID_GRAY    = [210, 215, 220] as const;
const BORDER_GRAY = [200, 205, 210] as const;
const WHITE       = [255, 255, 255] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const setRgb      = (doc: jsPDF, c: readonly [number,number,number]) => doc.setTextColor(c[0],c[1],c[2]);
const setFillRgb  = (doc: jsPDF, c: readonly [number,number,number]) => doc.setFillColor(c[0],c[1],c[2]);
const setDrawRgb  = (doc: jsPDF, c: readonly [number,number,number]) => doc.setDrawColor(c[0],c[1],c[2]);

function hLine(doc: jsPDF, y: number, x1=15, x2=195, color=MID_GRAY) {
  setDrawRgb(doc, color);
  doc.setLineWidth(0.3);
  doc.line(x1, y, x2, y);
}

function sectionTitle(doc: jsPDF, text: string, y: number, pw: number) {
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  setRgb(doc, DARK);
  doc.text(text, pw / 2, y, { align: "center" });
}

function tableHeader(
  doc: jsPDF,
  cols: string[],
  colX: number[],
  y: number,
  contentW: number,
  margin: number,
  rightAlignFrom = 1
) {
  setFillRgb(doc, LIGHT_GRAY);
  doc.rect(margin, y - 3, contentW, 6, "F");
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  setRgb(doc, MUTED);
  cols.forEach((col, i) => {
    doc.text(col, colX[i], y, { align: i >= rightAlignFrom ? "right" : "left" });
  });
}

// ─── Charts (shared scatter / recovery / bland-altman inline renderers) ───────
function drawScatterPlot(
  doc: jsPDF,
  title: string,
  xLabel: string,
  yLabel: string,
  series: { name: string; points: {x:number; y:number}[] }[],
  showIdentity: boolean,
  x: number, y: number, w: number, h: number
) {
  setFillRgb(doc, [248,250,252]);
  setDrawRgb(doc, BORDER_GRAY);
  doc.setLineWidth(0.4);
  doc.rect(x, y, w, h, "FD");

  const allX = series.flatMap(s => s.points.map(p => p.x));
  const allY = series.flatMap(s => s.points.map(p => p.y));
  if (allX.length === 0) return;
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const minY = Math.min(...allY), maxY = Math.max(...allY);
  const padX = (maxX - minX) * 0.1 || 1;
  const padY = (maxY - minY) * 0.1 || 1;
  const xMin = minX - padX, xMax = maxX + padX;
  const yMin = minY - padY, yMax = maxY + padY;

  const ml=18, mr=8, mt=8, mb=14;
  const pw = w - ml - mr, ph = h - mt - mb;
  const cx = (v: number) => x + ml + ((v - xMin) / (xMax - xMin)) * pw;
  const cy = (v: number) => y + mt + ph - ((v - yMin) / (yMax - yMin)) * ph;

  setDrawRgb(doc, [220,225,230]); doc.setLineWidth(0.2);
  for (let i=0;i<=4;i++) {
    doc.line(x+ml, y+mt+(i/4)*ph, x+ml+pw, y+mt+(i/4)*ph);
    doc.line(x+ml+(i/4)*pw, y+mt, x+ml+(i/4)*pw, y+mt+ph);
  }

  if (showIdentity) {
    setDrawRgb(doc, [150,160,170]); doc.setLineWidth(0.5);
    doc.line(cx(xMin), cy(xMin), cx(xMax), cy(xMax));
  }

  const colors: [number,number,number][] = [[14,165,150], [70,140,230], [100,200,120]];
  series.forEach(({ points }, ci) => {
    const col = colors[ci % colors.length];
    setFillRgb(doc, col); setDrawRgb(doc, col); doc.setLineWidth(0);
    points.forEach(p => doc.circle(cx(p.x), cy(p.y), 1.2, "F"));
  });

  doc.setFontSize(7); setRgb(doc, MUTED);
  doc.text(xLabel, x+ml+pw/2, y+h-2, { align: "center" });
  doc.text(yLabel, x+ml-3, y+mt+ph/2, { angle: 90 });
  doc.setFontSize(7.5); setRgb(doc, DARK);
  doc.text(title, x+w/2, y+5, { align: "center" });
}

function drawRecoveryPlot(
  doc: jsPDF,
  assignedVals: number[],
  recoveries: number[],
  cliaError: number,
  x: number, y: number, w: number, h: number
) {
  setFillRgb(doc, [248,250,252]);
  setDrawRgb(doc, BORDER_GRAY);
  doc.setLineWidth(0.4);
  doc.rect(x, y, w, h, "FD");
  if (recoveries.length === 0) return;

  const cliaPercent = cliaError * 100;
  const upper = 100 + cliaPercent, lower = 100 - cliaPercent;
  const minR = Math.min(...recoveries, lower-2), maxR = Math.max(...recoveries, upper+2);
  const minX = Math.min(...assignedVals), maxX = Math.max(...assignedVals);
  const padX = (maxX - minX) * 0.1 || 1;

  const ml=18, mr=8, mt=8, mb=14;
  const pw = w-ml-mr, ph = h-mt-mb;
  const cx = (v: number) => x+ml+((v-(minX-padX))/(maxX-minX+2*padX))*pw;
  const cy = (v: number) => y+mt+ph-((v-minR)/(maxR-minR))*ph;

  setDrawRgb(doc, [220,225,230]); doc.setLineWidth(0.2);
  for (let i=0;i<=4;i++) doc.line(x+ml, y+mt+(i/4)*ph, x+ml+pw, y+mt+(i/4)*ph);

  // CLIA band
  setFillRgb(doc, [240,248,240]); doc.setLineWidth(0);
  doc.rect(x+ml, cy(upper), pw, cy(lower)-cy(upper), "F");

  setDrawRgb(doc, [150,160,170]); doc.setLineWidth(0.4);
  doc.line(x+ml, cy(100), x+ml+pw, cy(100));
  setDrawRgb(doc, [220,80,80]); doc.setLineWidth(0.5);
  doc.line(x+ml, cy(upper), x+ml+pw, cy(upper));
  doc.line(x+ml, cy(lower), x+ml+pw, cy(lower));

  setDrawRgb(doc, TEAL); setFillRgb(doc, TEAL); doc.setLineWidth(0.8);
  for (let i=1;i<recoveries.length;i++) {
    doc.line(cx(assignedVals[i-1]), cy(recoveries[i-1]), cx(assignedVals[i]), cy(recoveries[i]));
  }
  recoveries.forEach((r,i) => doc.circle(cx(assignedVals[i]), cy(r), 1.2, "F"));

  doc.setFontSize(7); setRgb(doc, MUTED);
  doc.text("Assigned Value", x+ml+pw/2, y+h-2, { align: "center" });
  doc.text("% Rec", x+ml-3, y+mt+ph/2, { angle: 90 });
  doc.setFontSize(7.5); setRgb(doc, DARK);
  doc.text("Percent Recovery", x+w/2, y+5, { align: "center" });
}

function drawBlandAltman(
  doc: jsPDF,
  points: { avg: number; pctDiff: number }[],
  cliaError: number,
  meanBias: number,
  x: number, y: number, w: number, h: number
) {
  setFillRgb(doc, [248,250,252]);
  setDrawRgb(doc, BORDER_GRAY);
  doc.setLineWidth(0.4);
  doc.rect(x, y, w, h, "FD");
  if (points.length === 0) return;

  const cliaPercent = cliaError * 100;
  const allY = points.map(p => p.pctDiff);
  const minY = Math.min(...allY, -cliaPercent-2), maxY = Math.max(...allY, cliaPercent+2);
  const allX = points.map(p => p.avg);
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const padX = (maxX - minX) * 0.1 || 1;

  const ml=18, mr=8, mt=8, mb=14;
  const pw = w-ml-mr, ph = h-mt-mb;
  const cx = (v: number) => x+ml+((v-minX+padX)/(maxX-minX+2*padX))*pw;
  const cy = (v: number) => y+mt+ph-((v-minY)/(maxY-minY))*ph;

  setDrawRgb(doc, [220,225,230]); doc.setLineWidth(0.2);
  for (let i=0;i<=4;i++) doc.line(x+ml, y+mt+(i/4)*ph, x+ml+pw, y+mt+(i/4)*ph);

  setDrawRgb(doc, [150,160,170]); doc.setLineWidth(0.4);
  doc.line(x+ml, cy(0), x+ml+pw, cy(0));
  setDrawRgb(doc, [100,180,100]); doc.setLineWidth(0.5);
  doc.line(x+ml, cy(meanBias), x+ml+pw, cy(meanBias)); // mean bias line
  setDrawRgb(doc, [220,80,80]); doc.setLineWidth(0.5);
  doc.line(x+ml, cy(cliaPercent), x+ml+pw, cy(cliaPercent));
  doc.line(x+ml, cy(-cliaPercent), x+ml+pw, cy(-cliaPercent));

  setFillRgb(doc, TEAL); doc.setLineWidth(0);
  points.forEach(p => doc.circle(cx(p.avg), cy(p.pctDiff), 1.2, "F"));

  doc.setFontSize(7); setRgb(doc, MUTED);
  doc.text("Mean of Methods", x+ml+pw/2, y+h-2, { align: "center" });
  doc.text("% Diff", x+ml-3, y+mt+ph/2, { angle: 90 });
  doc.setFontSize(7.5); setRgb(doc, DARK);
  doc.text("Bland-Altman", x+w/2, y+5, { align: "center" });
}

// ─── Shared: document header ──────────────────────────────────────────────────
function pdfHeader(doc: jsPDF, study: Study, pw: number, margin: number): number {
  let y = 14;
  // Left: VeritaCheck logo
  doc.setFontSize(18); doc.setFont("helvetica","bold"); setRgb(doc, TEAL);
  doc.text("VeritaCheck®", margin, y);
  doc.setFontSize(7.5); doc.setFont("helvetica","normal"); setRgb(doc, MUTED);
  doc.text("by Veritas Lab Services · veritaslabservices.com", margin, y+5);
  // Right: instrument only on top line
  doc.setFontSize(8); doc.setFont("helvetica","normal"); setRgb(doc, MUTED);
  doc.text(`Instrument: ${study.instrument}`, pw-margin, y+5, { align: "right" });
  // Title on its own line below
  y += 10; hLine(doc, y); y += 5;
  const typeLabel = study.studyType === "cal_ver" ? "Calibration Verification / Linearity" : "Correlation / Method Comparison";
  doc.setFontSize(12); doc.setFont("helvetica","bold"); setRgb(doc, DARK);
  doc.text(`${typeLabel} — ${study.testName}`, pw/2, y, { align: "center" });
  y += 7; hLine(doc, y); y += 5;
  return y;
}

// ─── Shared: evaluation + verdict box ────────────────────────────────────────
function pdfEvalSection(doc: jsPDF, results: StudyResults, study: Study, y: number, pw: number, margin: number, contentW: number): number {
  hLine(doc, y); y += 6;
  doc.setFontSize(11); doc.setFont("helvetica","bold"); setRgb(doc, DARK);
  doc.text("Evaluation of Results", pw/2, y, { align: "center" }); y += 5;
  doc.setFontSize(7.5); doc.setFont("helvetica","normal"); setRgb(doc, DARK);
  const lines = doc.splitTextToSize(results.summary, contentW);
  doc.text(lines, margin, y);
  y += lines.length * 4 + 4;

  const boxColor = results.overallPass ? PASS_GREEN : FAIL_RED;
  setFillRgb(doc, boxColor);
  doc.roundedRect(margin, y-4, contentW, 10, 2, 2, "F");
  doc.setFontSize(9); doc.setFont("helvetica","bold"); setRgb(doc, WHITE);
  const cliaP = (study.cliaAllowableError*100).toFixed(1);
  const verdict = results.overallPass
    ? `PASS — ${results.passCount}/${results.totalCount} results within TEa of ±${cliaP}%`
    : `FAIL — ${results.passCount}/${results.totalCount} results within TEa of ±${cliaP}%`;
  doc.text(verdict, pw/2, y+2, { align: "center" });
  y += 16;
  return y;
}

// ─── Shared: page footer bar — writes footer + page numbers on ALL pages ─────
function pdfPageFooter(doc: jsPDF, pw: number, margin: number) {
  const pageH = doc.internal.pageSize.height;
  const cw = pw - 2*margin;
  const totalPages = (doc.internal as any).pages.length - 1;
  const savedPage = (doc as any).getCurrentPageInfo().pageNumber;
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    hLine(doc, pageH-12);
    doc.setFontSize(5.5); setRgb(doc, [160,160,160] as [number,number,number]);
    doc.text("VeritaCheck is a statistical tool for qualified laboratory professionals. Results require interpretation by a licensed laboratory director and do not constitute medical advice.", margin, pageH-16, { maxWidth: cw });
    doc.setFontSize(6.5); setRgb(doc, MUTED);
    doc.text(`VeritaCheck by Veritas Lab Services · veritaslabservices.com · Generated ${new Date().toLocaleDateString()}`, margin, pageH-8);
    doc.text(`Page ${p}`, pw-margin, pageH-8, { align: "right" });
  }
  doc.setPage(savedPage);
}

// ─── Shared: signature block — always anchored to bottom of page 1 ───────────
// Call this AFTER all content is written. It switches to page 1, places the
// signature at the fixed bottom position, then returns to the last page.
function pdfSignatureBlock(doc: jsPDF, study: Study, _y: number, pw: number, margin: number, contentW: number): number {
  const lastPage = (doc.internal as any).pages.length - 1;
  const pageH = doc.internal.pageSize.height;
  const sigY = pageH - 42; // fixed: above the footer disclaimer
  // Switch to page 1 to place signature
  doc.setPage(1);
  doc.setFontSize(9); doc.setFont("helvetica","bold"); setRgb(doc, DARK);
  doc.text("Accepted by:", margin, sigY);
  const lineY = sigY + 9;
  hLine(doc, lineY, margin, margin + contentW * 0.55);
  hLine(doc, lineY, pw - margin - contentW * 0.28, pw - margin);
  doc.setFontSize(7.5); setRgb(doc, MUTED); doc.setFont("helvetica","normal");
  doc.text("Signature / Name & Title", margin, lineY + 4);
  doc.text("Date", pw - margin - contentW * 0.28, lineY + 4);
  // Return to last page so subsequent calls render correctly
  doc.setPage(lastPage);
  return lineY + 12;
}

// ─── Shared: supporting data page (page 2) ───────────────────────────────────
function pdfSupportingPage(doc: jsPDF, study: Study, instrumentNames: string[], pw: number, margin: number, contentW: number) {
  doc.addPage();
  let y = 20;
  const halfW = (contentW - 6) / 2;

  doc.setFontSize(11); doc.setFont("helvetica","bold"); setRgb(doc, DARK);
  doc.text("Supporting Data & User Specifications", pw/2, y, { align: "center" }); y += 8;
  hLine(doc, y); y += 6;

  const cliaP = (study.cliaAllowableError*100).toFixed(1);
  // Map CFR section from study's stored cfr field, fall back to §493 Subpart I
  // The cfr field is stored on the study from the preset selection
  const storedCfr: string = (study as any).cfr || "";
  let cfrCitation = storedCfr || "42 CFR §493 Subpart I";
  const cfrSectionMap: { [key: string]: string } = {
    "42 CFR §493.931": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/subject-group-ECFRefb3c9d811d8641/section-493.931",
    "42 CFR §493.933": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/subject-group-ECFRefb3c9d811d8641/section-493.933",
    "42 CFR §493.935": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/subject-group-ECFRefb3c9d811d8641/section-493.935",
    "42 CFR §493.941": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/subject-group-ECFRefb3c9d811d8641/section-493.941",
  };
  const cfrUrl = cfrSectionMap[cfrCitation] || "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I";

  // Two-column layout: specs left, supporting right
  doc.setFontSize(8); doc.setFont("helvetica","bold"); setRgb(doc, DARK);
  doc.text("User's Specifications", margin, y);
  doc.text("Supporting Data", margin+halfW+6, y);
  y += 5;

  const specs = [
    ["Study Type", study.studyType === "cal_ver" ? "Calibration Verification / Linearity" : "Correlation / Method Comparison"],
    ["Test Name", study.testName],
    ["CLIA Total Allowable Error", `±${cliaP}%`],
    ["CLIA CFR Reference", cfrCitation],
    ["Allowable Systematic Error", `±${cliaP}%`],
  ];
  const supporting = [
    ["Analyst", study.analyst],
    ["Date", study.date],
    ["Instrument(s)", study.instrument],
    ["Test Methods", instrumentNames.join(", ")],
    ["Generated by", "VeritaCheck · Veritas Lab Services"],
  ];

  doc.setFontSize(7.5);
  for (let i = 0; i < Math.max(specs.length, supporting.length); i++) {
    if (specs[i]) {
      setRgb(doc, MUTED); doc.setFont("helvetica","normal");
      doc.text(specs[i][0], margin, y);
      if (specs[i][0] === "CLIA CFR Reference") {
        setRgb(doc, [0, 120, 130]); doc.setFont("helvetica","bold");
        doc.text(specs[i][1], margin+halfW-2, y, { align: "right" });
        const tw = doc.getTextWidth(specs[i][1]);
        doc.link(margin+halfW-2-tw, y-3, tw, 4.5, { url: cfrUrl });
        doc.setFont("helvetica","normal");
      } else {
        setRgb(doc, DARK);
        doc.text(specs[i][1], margin+halfW-2, y, { align: "right" });
      }
    }
    if (supporting[i]) {
      setRgb(doc, MUTED); doc.setFont("helvetica","normal");
      doc.text(supporting[i][0], margin+halfW+6, y);
      setRgb(doc, DARK);
      doc.text(supporting[i][1], pw-margin, y, { align: "right" });
    }
    y += 5;
  }

  y += 6; hLine(doc, y);
  pdfPageFooter(doc, pw, margin);
}

// ─── Shared: user specs + signature (legacy shim — still used by Cal Ver) ─────
function pdfFooterSections(doc: jsPDF, study: Study, instrumentNames: string[], y: number, pw: number, margin: number, contentW: number) {
  pdfSignatureBlock(doc, study, y, pw, margin, contentW);
  pdfSupportingPage(doc, study, instrumentNames, pw, margin, contentW);
}

// ─── PDF: CALIBRATION VERIFICATION ───────────────────────────────────────────
function generateCalVerPDF(doc: jsPDF, study: Study, results: CalVerResults) {
  const pw = 215.9, margin = 15, contentW = pw - 2*margin;
  const instrumentNames: string[] = JSON.parse(study.instruments);
  let y = pdfHeader(doc, study, pw, margin);

  // Section title
  doc.setFontSize(13); doc.setFont("helvetica","bold"); setRgb(doc, DARK);
  doc.text("Calibration Verification / Linearity", margin, y); y += 6;

  // Charts
  const chartW = (contentW-6)/2, chartH = 55;
  const assignedVals = results.levelResults.map(r => r.assignedValue);
  const recoveries   = results.levelResults.map(r => r.pctRecovery);
  const scatterSeries = instrumentNames.map(name => ({
    name,
    points: results.levelResults.filter(r => r.instruments[name]).map(r => ({ x: r.assignedValue, y: r.instruments[name].value }))
  }));
  drawScatterPlot(doc, "Scatter Plot", "Assigned Value", "Measured", scatterSeries, true, margin, y, chartW, chartH);
  drawRecoveryPlot(doc, assignedVals, recoveries, study.cliaAllowableError, margin+chartW+6, y, chartW, chartH);
  y += chartH + 6;

  // Linearity table — wider label column to fit long instrument names
  hLine(doc, y); y += 4;
  sectionTitle(doc, "Linearity Summary", y, pw); y += 5;
  const linCols  = ["", "N", "Slope", "Intercept", "Prop. Bias", "R", "R²"];
  const linColX  = [margin, margin+52, margin+78, margin+113, margin+148, margin+168, margin+185];
  tableHeader(doc, linCols, linColX, y, contentW, margin);
  y += 7;
  doc.setFont("helvetica","normal"); setRgb(doc, DARK);
  doc.setFontSize(8);
  Object.entries(results.regression).forEach(([name, reg]) => {
    // Truncate name to fit in label column (max ~50mm at 8pt)
    const label = name.length > 28 ? name.substring(0, 26) + "…" : name;
    doc.text(label, linColX[0], y);
    doc.text(String(reg.n), linColX[1], y, { align: "right" });
    doc.text(reg.slope.toFixed(4), linColX[2], y, { align: "right" });
    doc.text(reg.intercept.toFixed(4), linColX[3], y, { align: "right" });
    const bc = Math.abs(reg.proportionalBias) < study.cliaAllowableError ? PASS_GREEN : FAIL_RED;
    setRgb(doc, bc);
    doc.text((reg.proportionalBias*100).toFixed(2)+"%", linColX[4], y, { align: "right" });
    setRgb(doc, DARK);
    doc.text(Math.sqrt(reg.r2).toFixed(4), linColX[5], y, { align: "right" });
    doc.text(reg.r2.toFixed(4), linColX[6], y, { align: "right" });
    y += 5;
  });
  doc.setFontSize(9);

  // Separator before statistical data
  y += 3; hLine(doc, y); y += 5;

  const pageH_cv = doc.internal.pageSize.height;
  const rowH_cv = 5;
  const nRows = results.levelResults.length;
  const evalH = 32;
  const sigH = 28;
  const footerH_cv = 28;
  // Section title + header + all rows + eval + sig — if won't fit, break first
  const spaceLeft_cv = pageH_cv - y - footerH_cv;
  const totalNeeded_cv = 12 + (nRows * rowH_cv) + evalH + sigH;
  if (totalNeeded_cv > spaceLeft_cv) { doc.addPage(); y = 20; }

  sectionTitle(doc, "Statistical Analysis and Experimental Results", y, pw); y += 5;
  const cols = ["", "Assigned", "Mean", "% Rec", "Obs Err", "Pass?", ...instrumentNames];
  const colW = contentW / cols.length;
  tableHeader(doc, cols, cols.map((_, i) => margin + i*colW + (i===0?2:colW-2)), y, contentW, margin);
  y += 7;
  doc.setFont("helvetica","normal");
  results.levelResults.forEach((r, ri) => {
    // Mid-table page break: only break if the remaining rows + eval won't fit
    const rowsLeft = nRows - ri;
    const remainingNeeded = (rowsLeft * rowH_cv) + evalH + sigH + footerH_cv;
    if (y + remainingNeeded > pageH_cv) { doc.addPage(); y = 20; }
    if (ri%2===0) { setFillRgb(doc, [250,251,253]); doc.rect(margin, y-3, contentW, 5, "F"); }
    setRgb(doc, DARK);
    const row = [
      `L${r.level}`,
      r.assignedValue.toFixed(3),
      r.mean.toFixed(3),
      r.pctRecovery.toFixed(1)+"%",
      (r.obsError*100).toFixed(2)+"%",
      r.passFailMean,
      ...instrumentNames.map(n => r.instruments[n] ? r.instruments[n].value.toFixed(3) : "—"),
    ];
    row.forEach((val, i) => {
      if (val === "Pass") setRgb(doc, PASS_GREEN);
      else if (val === "Fail") setRgb(doc, FAIL_RED);
      else setRgb(doc, DARK);
      doc.text(val, margin+i*colW+(i===0?2:colW-2), y, { align: i===0?"left":"right" });
    });
    y += 5;
  });

  y = pdfEvalSection(doc, results, study, y+4, pw, margin, contentW);
  y = pdfSignatureBlock(doc, study, y, pw, margin, contentW);
  pdfPageFooter(doc, pw, margin);
  pdfSupportingPage(doc, study, instrumentNames, pw, margin, contentW);
}

// ─── PDF: METHOD COMPARISON ───────────────────────────────────────────────────
function generateMethodCompPDF(doc: jsPDF, study: Study, results: MethodCompResults) {
  const pw = 215.9, margin = 15, contentW = pw - 2*margin;
  const instrumentNames: string[] = JSON.parse(study.instruments);
  const xRange = (results as any).xRange as { min: number; max: number } | undefined;
  const yRange = (results as any).yRange as { [name: string]: { min: number; max: number } } | undefined;
  let y = pdfHeader(doc, study, pw, margin);

  doc.setFontSize(13); doc.setFont("helvetica","bold"); setRgb(doc, DARK);
  doc.text("Correlation / Method Comparison", margin, y); y += 6;

  // Charts: correlation scatter + Bland-Altman
  const chartW = (contentW-6)/2, chartH = 55;
  const scatterSeries = instrumentNames.map(name => ({
    name,
    points: results.levelResults.filter(r => r.instruments[name]).map(r => ({ x: r.referenceValue, y: r.instruments[name].value }))
  }));
  drawScatterPlot(doc, "Correlation", "Reference Method", "Test Method", scatterSeries, true, margin, y, chartW, chartH);

  const firstInst = instrumentNames[0];
  const baData = results.levelResults
    .filter(r => r.instruments[firstInst])
    .map(r => ({ avg: (r.referenceValue + r.instruments[firstInst].value)/2, pctDiff: r.instruments[firstInst].pctDifference }));
  const meanBias = results.blandAltman[firstInst]?.pctMeanDiff ?? 0;
  drawBlandAltman(doc, baData, study.cliaAllowableError, meanBias, margin+chartW+6, y, chartW, chartH);
  y += chartH + 6;

  // Supporting statistics row (matches EP Evaluator layout)
  hLine(doc, y); y += 4;
  sectionTitle(doc, "Supporting Statistics", y, pw); y += 5;
  doc.setFont("helvetica","normal"); doc.setFontSize(8); setRgb(doc, DARK);
  const firstInstBA = results.blandAltman[firstInst];
  const firstInstReg = Object.entries(results.regression).find(([k]) => k.includes("Deming"))?.[1];
  const supportStats = [
    ["Corr Coef (R):", firstInstReg ? Math.sqrt(firstInstReg.r2).toFixed(4) : "—"],
    ["Bias:", firstInstBA ? firstInstBA.meanDiff.toFixed(3) : "—"],
    ["X Mean ± SD:", xRange ? `${((xRange.min+xRange.max)/2).toFixed(3)}` : "—"],
    ["Std Dev Diffs:", firstInstBA ? firstInstBA.sdDiff.toFixed(3) : "—"],
    ["Points (Plotted/Total):", `${results.levelResults.length}/${results.levelResults.length}`],
  ];
  // Build all stats into two columns of 3 rows each
  const allStats = [
    ...supportStats,
    ...(xRange ? [["X Result Range:", `${xRange.min.toFixed(3)} to ${xRange.max.toFixed(3)}`]] : []),
    ...instrumentNames.filter(n => yRange?.[n]).map(n => [`${n} Range:`, `${yRange![n].min.toFixed(3)} to ${yRange![n].max.toFixed(3)}`]),
  ];
  const colLabelX = margin, colValX = margin + 48, col2LabelX = margin + 100, col2ValX = margin + 148;
  const half = Math.ceil(allStats.length / 2);
  for (let i = 0; i < half; i++) {
    const left = allStats[i];
    const right = allStats[i + half];
    doc.setFont("helvetica","bold"); setRgb(doc, MUTED);
    doc.text(left[0], colLabelX, y + i*5);
    doc.setFont("helvetica","normal"); setRgb(doc, DARK);
    doc.text(left[1], colValX, y + i*5);
    if (right) {
      doc.setFont("helvetica","bold"); setRgb(doc, MUTED);
      doc.text(right[0], col2LabelX, y + i*5);
      doc.setFont("helvetica","normal"); setRgb(doc, DARK);
      doc.text(right[1], col2ValX, y + i*5);
    }
  }
  y += half * 5 + 4; doc.setFontSize(9);

  // Regression table — Deming + OLS with CIs
  hLine(doc, y); y += 4;
  sectionTitle(doc, "Regression Analysis", y, pw); y += 5;
  const regCols  = ["Method", "N", "Slope (95% CI)", "Intercept (95% CI)", "SEE", "Prop. Bias", "R", "R²"];
  const regColX  = [margin, margin+28, margin+55, margin+105, margin+148, margin+163, margin+178, margin+191];
  tableHeader(doc, regCols, regColX, y, contentW, margin);
  y += 7;
  doc.setFont("helvetica","normal"); setRgb(doc, DARK);
  Object.entries(results.regression).forEach(([name, reg]) => {
    // Shorten name: "CENTAUR SERUM vs. Reference (Deming)" -> "Deming"
    const shortName = name.includes("Deming") ? "Deming" : "OLS";
    doc.text(shortName, regColX[0], y);
    doc.text(String(reg.n), regColX[1], y, { align: "right" });
    // Slope with CI
    const slopeStr = reg.slopeLo !== undefined
      ? `${reg.slope.toFixed(4)} (${reg.slopeLo.toFixed(3)}-${reg.slopeHi!.toFixed(3)})`
      : reg.slope.toFixed(4);
    doc.text(slopeStr, regColX[2], y, { align: "right" });
    const intStr = reg.interceptLo !== undefined
      ? `${reg.intercept.toFixed(4)} (${reg.interceptLo.toFixed(3)}-${reg.interceptHi!.toFixed(3)})`
      : reg.intercept.toFixed(4);
    doc.text(intStr, regColX[3], y, { align: "right" });
    doc.text(reg.see.toFixed(4), regColX[4], y, { align: "right" });
    const bc = Math.abs(reg.proportionalBias) < study.cliaAllowableError ? PASS_GREEN : FAIL_RED;
    setRgb(doc, bc);
    doc.text((reg.proportionalBias*100).toFixed(2)+"%", regColX[5], y, { align: "right" });
    setRgb(doc, DARK);
    doc.text(Math.sqrt(reg.r2).toFixed(4), regColX[6], y, { align: "right" });
    doc.text(reg.r2.toFixed(4), regColX[7], y, { align: "right" });
    y += 5;
  });
  doc.setFontSize(7); setRgb(doc, [120,120,120]);
  doc.text("95% Confidence Intervals shown in parentheses (OLS only)", margin, y); y += 4;
  doc.setFontSize(9); setRgb(doc, DARK);

  y += 3; hLine(doc, y); y += 6;

  // Bland-Altman bias summary table
  sectionTitle(doc, "Bland-Altman Bias Summary", y, pw); y += 5;
  const baCols = ["Instrument", "Mean Bias", "Mean % Bias", "SD of Diff", "95% LoA Lower", "95% LoA Upper"];
  const baColX = [margin, margin+38, margin+75, margin+110, margin+145, margin+178];
  tableHeader(doc, baCols, baColX, y, contentW, margin);
  y += 7;
  doc.setFont("helvetica","normal"); setRgb(doc, DARK);
  Object.entries(results.blandAltman).forEach(([name, ba], bi) => {
    if (bi%2===0) { setFillRgb(doc, [250,251,253]); doc.rect(margin, y-3, contentW, 5, "F"); }
    setRgb(doc, DARK);
    doc.text(name, baColX[0], y);
    doc.text(ba.meanDiff.toFixed(4), baColX[1], y, { align: "right" });
    const bc = Math.abs(ba.pctMeanDiff) < study.cliaAllowableError*100 ? PASS_GREEN : FAIL_RED;
    setRgb(doc, bc);
    doc.text(ba.pctMeanDiff.toFixed(2)+"%", baColX[2], y, { align: "right" });
    setRgb(doc, DARK);
    doc.text(ba.sdDiff.toFixed(4), baColX[3], y, { align: "right" });
    doc.text(ba.loa_lower.toFixed(4), baColX[4], y, { align: "right" });
    doc.text(ba.loa_upper.toFixed(4), baColX[5], y, { align: "right" });
    y += 5;
  });

  // Always start level-by-level data on a new page
  // Only add page if level-by-level data won't fit — otherwise flow directly
  const pageH_mc = (doc as any).internal.pageSize.height;
  const rowH_mc = 4.2;
  const nRowsMC = results.levelResults.length;
  const evalH_mc = 32, sigH_mc = 28, footerH_mc = 28;
  const spaceLeftMC = pageH_mc - y - footerH_mc;
  const neededMC = 12 + (nRowsMC * rowH_mc) + evalH_mc + sigH_mc;
  if (neededMC > spaceLeftMC) { doc.addPage(); y = 20; }

  sectionTitle(doc, "Level-by-Level Comparison Results", y, pw); y += 5;
  // Fixed column positions: Level | Ref | Value | Bias | % Diff | Pass?
  const dataColX2 = [margin, margin+20, margin+60, margin+100, margin+135, margin+168];
  const dataHeaders2 = ["Level", "Reference", ...instrumentNames.flatMap(_ => ["Value", "Bias", "% Diff", "Pass?"])];
  // Print instrument name as sub-header spanning value/bias/pctdiff/pass columns
  doc.setFontSize(7); doc.setFont("helvetica","bold"); setRgb(doc, [100,100,100]);
  instrumentNames.forEach((n) => { doc.text(n, dataColX2[2], y, { align: "left" }); });
  y += 4;
  doc.setFontSize(9);
  tableHeader(doc, dataHeaders2, dataColX2, y, contentW, margin, 1);
  y += 7;
  doc.setFont("helvetica","normal");
  const pageH = 279; // letter page height mm
  const footerH = 68; // reserve space for eval section + signature + footer
  results.levelResults.forEach((r, ri) => {
    // Page break if needed
    if (y > pageH - footerH) {
      doc.addPage();
      y = 20;
      tableHeader(doc, dataHeaders2, dataColX2, y, contentW, margin, 1);
      y += 7;
      doc.setFont("helvetica","normal");
    }
    if (ri%2===0) { setFillRgb(doc, [250,251,253]); doc.rect(margin, y-3, contentW, 5, "F"); }
    setRgb(doc, DARK);
    const row: string[] = [
      `L${r.level}`,
      r.referenceValue.toFixed(3),
      ...instrumentNames.flatMap(n => r.instruments[n]
        ? [r.instruments[n].value.toFixed(3), r.instruments[n].difference.toFixed(3), r.instruments[n].pctDifference.toFixed(2)+"%", r.instruments[n].passFail]
        : ["—","—","—","—"]
      ),
    ];
    row.forEach((val, i) => {
      if (val === "Pass") setRgb(doc, PASS_GREEN);
      else if (val === "Fail") setRgb(doc, FAIL_RED);
      else setRgb(doc, DARK);
      doc.text(val, dataColX2[i], y, { align: i===0?"left":"right" });
    });
    y += 4.2;
  });

  y = pdfEvalSection(doc, results, study, y+4, pw, margin, contentW);
  y = pdfSignatureBlock(doc, study, y, pw, margin, contentW);
  pdfPageFooter(doc, pw, margin);
  pdfSupportingPage(doc, study, instrumentNames, pw, margin, contentW);
}

// ─── Public entry point ───────────────────────────────────────────────────────
export async function generatePDF(study: Study, results: StudyResults) {
  const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "portrait" });

  if (results.type === "cal_ver") {
    generateCalVerPDF(doc, study, results);
  } else {
    generateMethodCompPDF(doc, study, results);
  }

  const filename = `VeritaCheck_${study.studyType === "cal_ver" ? "CalVer" : "MethodComp"}_${study.testName.replace(/\s+/g,"_")}_${study.date}.pdf`;
  doc.save(filename);
}
