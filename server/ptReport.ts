// server/ptReport.ts
//
// The VeritaPT period report (B11, 2026-11-24): one laboratory's month, quarter or year, on screen, as a PDF and as Excel, all
// from ptPeriodReport. What each part counts:
//   Events due         events whose due date is in the period, on time or late from the dates entered (shared/ptEvents.ts)
//   Results by status  results whose event date is in the period, through ptResultCounts (server/ptSummary.ts), the function the
//                      compliance digest's VeritaPT line counts with, so the two can't disagree
//   Acceptable rate    acceptable / graded, graded being acceptable or unacceptable; ungraded and not yet graded sit beside it
//   Open reviews       events of the period with a status back and no review of what they hold now, as of the day it is made
//   Two of three       the flags as of the period's last day (server/ptTrends.ts)
// Read by any member but a limited Staff login. It is a report, not a form: nothing on it is signed.
import type { Express } from "express";
import { PT_SUBMISSION_LABEL, ptReviewOpen, type PtSubmission } from "@shared/ptEvents";
import { ptPeriod, type PtPeriod, type PtReport } from "@shared/ptReport";
import { ptEventsOfLab, ptStaffOwn, ptToday, type PtDeps } from "./ptEvents";
import { ptResultCounts } from "./ptSummary";
import { ptTrendsForLab } from "./ptTrends";

export function ptPeriodReport(sqlite: any, labId: number, period: PtPeriod): PtReport {
  const inPeriod = (d: string | null | undefined) => !!d && d >= period.start && d <= period.end;
  const events = ptEventsOfLab(sqlite, labId);
  const due = events.filter((e) => inPeriod(e.due_date)).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)) || a.name.localeCompare(b.name));
  const counts = Object.fromEntries(Object.keys(PT_SUBMISSION_LABEL).map((k) => [k, due.filter((e) => e.submission === k).length])) as Record<PtSubmission, number>;
  const c = ptResultCounts(sqlite, labId, period.start, period.end);
  const results = events.flatMap((e) => e.results).filter((r) => inPeriod(r.event_date));
  const tally = (nameOf: (r: (typeof results)[number]) => string) => {
    const by = new Map<string, { name: string; unacceptable: number; ungraded: number }>();
    for (const r of results) {
      if (r.status !== "unacceptable" && r.status !== "ungraded") continue;
      const row = by.get(nameOf(r)) ?? { name: nameOf(r), unacceptable: 0, ungraded: 0 };
      row[r.status]++;
      by.set(row.name, row);
    }
    return Array.from(by.values()).sort((a, b) => b.unacceptable - a.unacceptable || b.ungraded - a.ungraded || a.name.localeCompare(b.name));
  };
  const mine = events.filter((e) => e.results.some((r) => inPeriod(r.event_date)));
  return {
    period, as_of: ptToday(sqlite, labId),
    due: { total: due.length, counts, events: due.map((e) => ({ event: e.name, program: e.program, due_date: e.due_date!, submitted_date: e.submitted_date, submission: e.submission })) },
    results: { ...c, acceptable_rate: c.graded ? Math.round((c.acceptable / c.graded) * 1000) / 10 : null },
    by_analyte: tally((r) => r.analyte), by_department: tally((r) => r.department),
    open_reviews: mine.filter(ptReviewOpen).sort((a, b) => a.event_date.localeCompare(b.event_date)).map((e) => ({ event: e.name, program: e.program, event_date: e.event_date, state: e.review.state, open_evaluations: e.open_evaluations })),
    open_evaluations: results.filter((r) => r.evaluation_open).length,
    two_of_three: ptTrendsForLab(sqlite, labId, period.end).trends.filter((t) => t.state !== "OK").map((t) => ({ analyte: t.analyte, state: t.state as "AT-RISK" | "WATCH", last3: t.last3 })),
  };
}

export function registerPtReportRoutes(app: Express, deps: PtDeps & { markLabReportingLocks: (labId: number) => void }) {
  const { sqlite, authMiddleware, labScopeMiddleware, hasPTAccess, licenseCtxFromReq, markLabReportingLocks } = deps;
  const open = (req: any, res: any): PtReport | null => {
    if (!hasPTAccess(req.user, req.scope?.lab)) { res.status(403).json({ error: "VeritaPT™ subscription required" }); return null; }
    if (ptStaffOwn(sqlite(), req)) { res.status(403).json({ error: "A staff login reads the event list only.", code: "STAFF_OWN_ONLY" }); return null; }
    const period = ptPeriod(req.query.period);
    if (!period) { res.status(400).json({ error: "Pick a month, a quarter or a year." }); return null; }
    return ptPeriodReport(sqlite(), req.scope.labId, period);
  };
  const lab = (req: any) => ({ labName: req.scope.lab?.lab_name || null, clia: req.scope.lab?.clia_number || null });

  app.get("/api/labs/:labId/pt/report", authMiddleware, labScopeMiddleware, (req: any, res: any) => {
    const report = open(req, res);
    if (report) res.json(report);
  });

  app.get("/api/labs/:labId/pt/report/export.xlsx", authMiddleware, labScopeMiddleware, async (req: any, res: any) => {
    const report = open(req, res);
    if (!report) return;
    const { buildPtReportWorkbook } = await import("./ptReportExport");
    const { applyLicenseToExcelJS } = await import("./licenseStamp");
    const buf = await buildPtReportWorkbook(report, lab(req), (wb) => applyLicenseToExcelJS(wb, licenseCtxFromReq(req, "VeritaPT™")));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="VeritaPT_Report_${report.period.value}.xlsx"`);
    res.send(buf);
  });

  // The PDF goes out through the shared token store (GET /api/pdf/:token), as every PDF here does.
  app.get("/api/labs/:labId/pt/report/pdf", authMiddleware, labScopeMiddleware, async (req: any, res: any) => {
    const report = open(req, res);
    if (!report) return;
    try {
      const { generatePtReportPDF } = await import("./ptReportPdf");
      const { storePdfToken } = await import("./pdfTokens");
      const pdf = await generatePtReportPDF(report, lab(req), licenseCtxFromReq(req, "VeritaPT™"));
      const filename = `VeritaPT_Report_${report.period.value}.pdf`;
      const token = storePdfToken(pdf, filename);
      markLabReportingLocks(req.scope.labId);
      res.json({ token, filename });
    } catch (err: any) {
      console.error("[pt/report/pdf] failed:", err?.message || err);
      res.status(500).json({ error: "PDF generation failed" });
    }
  });
}
