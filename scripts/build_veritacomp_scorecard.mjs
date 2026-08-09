// scripts/build_veritacomp_scorecard.mjs
//
// Builds VeritaComp_scorecard.xlsx: the consolidated triage of the 2026-07-09
// VeritaComp review (4 read-only agents: compliance-correctness, reliability +
// data-integrity, PDF-defensibility, first-impression/copy), after Claude
// verified each finding against the code. Status reflects what has shipped.
//
// Internal triage doc (not customer-facing), so no About sheet; brand styling
// per CLAUDE.md Section 6. Run from the repo: node scripts/build_veritacomp_scorecard.mjs
// Artifact lands in the user's Downloads.

import os from "node:os";
import path from "node:path";

const OUT = path.join(os.homedir(), "Downloads", "VeritaComp_scorecard.xlsx");

// severity: sev0 | HIGH | sev1 | sev2 | info
// status:   Shipped | Deploying | Resolved | Remaining | Downgraded
const F = [
  ["Security", "sev0", "quiz-results cross-tenant IDOR: POST/GET /api/veritacomp/quiz-results took quizId/assessmentId/employeeId from the body with no lab scope, so any writer could forge or read another lab's graded competency evidence.", "server/routes.ts ~20593 (POST), ~20633 (GET)", "Shipped", "PR #961 (live). Guarded via userCanAccessLabRow + same-lab check + negative-case verify."],
  ["Security", "HIGH", "Competency Sign & Complete posted to the legacy /api/competency/assessments/:id/sign, gated by program.user_id, so a multi-lab owner could sign into the wrong lab by a stale id.", "server/routes.ts ~19816; client signComplete", "Deploying", "PR #967. Added lab-scoped sign twin + client rewire + verify."],
  ["Security", "HIGH", "Legacy PUT /api/competency/assessments/:id is user_id-scoped. No client caller today, but a latent direct-API route for a multi-lab owner.", "server/routes.ts ~19702", "Remaining", "Follow-up: harden or retire the latent legacy PUT and sign routes (avoid duplicating the 90-line PUT body)."],
  ["Security", "info", "Legacy DELETE /api/competency/assessments/:id is user_id-scoped, BUT a lab-scoped delete twin exists and the client already uses it.", "server/routes.ts ~19791 vs ~20061", "Resolved", "No action; client is on the safe twin."],
  ["Reliability", "HIGH", "Three client mutations ignored res.ok and invalidated as if they worked: deleteAssessment, deactivate (employee), save (program rename). A locked-409 or foreign-404 looked successful.", "client/src/pages/VeritaCompAppPage.tsx (deleteAssessment/deactivate/save)", "Deploying", "PR #966. res.ok checks + destructive toast; added toast hook to the two tabs that lacked it."],
  ["PDF", "sev0", "Evaluator Sign-Off hardcoded 'Overall Determination: PASS' (green) regardless of the real verdict, so a FAILED competency record certified PASS above the signature.", "server/pdfReport.ts ~4717", "Deploying", "PR #965. Uses dynamic passLabel/passColor; blank shows a fill-in line."],
  ["PDF", "sev0", "Evaluator name/title/initials fell back to 'M. Veri' / 'Technical Consultant' / 'MV' when blank, stamping Michael's identity on other labs' records.", "server/pdfReport.ts ~4706", "Deploying", "PR #965. Fallback is now an empty fill-in line."],
  ["PDF", "sev1", "Evaluator Sign-Off is forced onto its own page by a page-break; page 1 carries only the employee acknowledgement. Section 5 wants the approval signature on page 1.", "server/pdfReport.ts ~4710", "Remaining", "Layout change: render the sign-off on page 1, element tables on pages 2+. Own PR (needs a rendered-PDF review)."],
  ["PDF", "sev1", "Evaluator title is free-text echoed (Moderate=TC / High=TS / Waived=GS not enforced); fallback hardwired a Moderate title.", "server/pdfReport.ts ~4325/4707", "Remaining", "Derive/flag expected title from competency_type."],
  ["PDF", "sev1", "PDF author metadata 'Perplexity Computer' is never set on any pdfReport.ts output (cross-cutting: VeritaCheck, VeritaComp, CMS 209, VeritaPT).", "server/pdfReport.ts generateCompetencyPDF ~4817", "Remaining", "Post-process the Puppeteer buffer through pdf-lib setAuthor. Cross-module fix."],
  ["PDF", "sev2", "'Lab Director or designee' instead of the standard 'medical director or designee'.", "server/pdfReport.ts 4328/4469/4498", "Remaining", "Copy fix."],
  ["Compliance", "sev1", "Initial competency modeled as hire + 90 days in the due-date engine, so an untrained tech reads 'compliant' for 90 days. CLIA says initial competency before testing.", "server/routes.ts ~22582 / ~22824", "Remaining", "Michael's regulatory call: due = hire/today, or an explicitly-labeled reminder window."],
  ["Compliance", "sev2", "ensureCompetencyScheduleMilestones projects all milestones from hire; can disagree with the completion-anchored recompute (two 'first annual due' values).", "server/routes.ts ~21739", "Remaining", "Seed only the six-month at hire; leave later milestones NULL for the completion-anchored PUT."],
  ["Compliance", "sev2", "Demo backfill overwrites el2_evidence by a global string match, so a real assessment matching the legacy default string gets demo text on boot.", "server/routes.ts ~1104", "Remaining", "Scope the UPDATE to the demo lab id; drop the content-match fallback. (Boot-migration hazard.)"],
  ["Compliance", "sev2", "Vestigial CLIA_METHODS constant carries the pre-fix 'review of QC records' Element-3 wording; unused but a trap for the next editor.", "client/src/pages/VeritaCompAppPage.tsx ~233", "Remaining", "Delete the dead constant."],
  ["Copy/Reg", "sev1", "Public page cites 42 CFR 493.1451 for the six elements while the app/PDF standardize on 493.1235. Inconsistent. 493.1451(b) is Technical-Supervisor duties (six procedures for high complexity); 493.1235 is the general standard.", "client/src/pages/VeritaCompPage.tsx 14/189 (and VeritaMapPage.tsx 15)", "Remaining", "Michael's regulatory call vs the Master Citation Index. NOT a blind swap. (Downgraded from the agent's sev0.)"],
  ["Copy/Reg", "info", "Agent flagged 'tracks next-due per the CLIA timeline' as fabricated. It is BACKED by the server schedule engine (staff_competency_schedules, completion-anchored recompute).", "server/routes.ts ~23718", "Downgraded", "Not fabricated. Verify only whether the roster surfaces it prominently."],
  ["UX", "sev1", "New-Assessment dialog dead-ends: zero employees -> Save disabled with no message; a technical program with zero method groups -> empty form but Save enabled.", "client/src/pages/VeritaCompAppPage.tsx ~2843/3384", "Remaining", "Inline empty-state guidance + link to the Employees tab / Rebuild-from-VeritaMap."],
  ["UX", "sev1", "'Rebuild from VeritaMap (lab-wide)' is the only path to seed method groups and it is buried on the Overview tab.", "client/src/pages/VeritaCompAppPage.tsx ~1415", "Remaining", "Surface the rebuild affordance inside the empty technical assessment body."],
  ["Sales", "sev1", "Two 'Work in Progress / Beta' banners + 'actively being developed' copy on a paid, live product marketed as 'Now Live' and 'citation-proof'. Mixed signal.", "VeritaCompAppPage.tsx 414/487; VeritaCompPage.tsx 143", "Remaining", "Michael's call: pick Beta or Live and say one thing."],
  ["Copy", "sev2", "Em dashes in user-facing strings (repo bans them in customer-facing copy).", "client/src/pages/VeritaCompAppPage.tsx 1939/1989", "Remaining", "Replace with colon/comma."],
];

const SEV_COLOR = { sev0: "A12C7B", HIGH: "A12C7B", sev1: "964219", sev2: "7A7974", info: "7A7974" };
const STATUS_COLOR = { Shipped: "437A22", Deploying: "437A22", Resolved: "437A22", Remaining: "964219", Downgraded: "7A7974" };

const { default: ExcelJS } = await import("exceljs");
const wb = new ExcelJS.Workbook();
wb.creator = "Perplexity Computer";
const ws = wb.addWorksheet("VeritaComp Review", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });

const cols = [
  { header: "#", key: "n", width: 4 },
  { header: "Area", key: "area", width: 13 },
  { header: "Severity", key: "sev", width: 10 },
  { header: "Finding", key: "finding", width: 70 },
  { header: "Location", key: "loc", width: 40 },
  { header: "Status", key: "status", width: 12 },
  { header: "Recommendation / Action", key: "rec", width: 56 },
];
ws.columns = cols;

// Header row
const hr = ws.getRow(1);
hr.height = 22;
hr.eachCell((c) => {
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
  c.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  c.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  c.border = { top: { style: "thin", color: { argb: "FFD0D0D0" } }, bottom: { style: "thin", color: { argb: "FFD0D0D0" } }, left: { style: "thin", color: { argb: "FFD0D0D0" } }, right: { style: "thin", color: { argb: "FFD0D0D0" } } };
});

F.forEach((row, i) => {
  const [area, sev, finding, loc, status, rec] = row;
  const r = ws.addRow({ n: i + 1, area, sev, finding, loc, status, rec });
  const even = i % 2 === 1;
  r.eachCell((c) => {
    c.font = { name: "Calibri", size: 10, color: { argb: "FF28251D" } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: even ? "FFEBF3F8" : "FFFFFFFF" } };
    c.border = { top: { style: "thin", color: { argb: "FFD0D0D0" } }, bottom: { style: "thin", color: { argb: "FFD0D0D0" } }, left: { style: "thin", color: { argb: "FFD0D0D0" } }, right: { style: "thin", color: { argb: "FFD0D0D0" } } };
  });
  r.getCell("sev").font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF" + (SEV_COLOR[sev] || "28251D") } };
  r.getCell("status").font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF" + (STATUS_COLOR[status] || "28251D") } };
});

ws.autoFilter = { from: "A1", to: "G1" };

await wb.xlsx.writeFile(OUT);
const shipped = F.filter((r) => ["Shipped", "Deploying", "Resolved"].includes(r[4])).length;
const remaining = F.filter((r) => r[4] === "Remaining").length;
console.log(`Wrote ${OUT}`);
console.log(`${F.length} findings: ${shipped} shipped/resolved, ${remaining} remaining, ${F.length - shipped - remaining} downgraded.`);
