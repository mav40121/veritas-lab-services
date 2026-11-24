// server/ptReportExport.ts: the VeritaPT period report as a workbook (server/ptReport.ts), in the frame server/ptEventsExport.ts uses.
import { PT_REVIEW_LABEL, PT_STATUS_LABEL, PT_SUBMISSION_LABEL, type PtSubmission } from "@shared/ptEvents";
import { PT_FLAG_LABEL, ptLast3Text, ptRateText, type PtReport } from "@shared/ptReport";
import { buildPtWorkbook } from "./ptEventsExport";

export function buildPtReportWorkbook(r: PtReport, lab: { labName: string | null; clia: string | null }, applyLicense: (wb: any) => void): Promise<Buffer> {
  const sides = (["on_time", "late", "not_recorded", "not_due"] as PtSubmission[]).map((k) => [`Events due: ${PT_SUBMISSION_LABEL[k].toLowerCase()}`, r.due.counts[k]]);
  return buildPtWorkbook({
    title: `VeritaPT™ Report, ${r.period.label}`, labName: lab.labName, clia: lab.clia,
    about: [
      { heading: "About this workbook", lines: [`Proficiency testing recorded by this laboratory for ${r.period.label} (${r.period.start} to ${r.period.end}), made ${r.as_of}.`, "It reports what was recorded in VeritaPT™. It does not grade a result or replace the program's own report. Review of proficiency testing results belongs to the laboratory director or designee."] },
      { heading: "How to use this workbook", lines: ["Start with the Summary sheet. Events Due lists the events whose due date is in the period; a submission reads on time or late only when both dates were entered. By Analyte and By Department list unacceptable and ungraded results. Open Reviews and the evaluations are as of the day this workbook was made. Two of Three is as of the period's last day."] },
      { heading: "What it covers and where it comes from", lines: ["Results count by their event date. The acceptable rate is acceptable divided by graded, where graded is acceptable plus unacceptable; ungraded and not yet graded results are shown beside it and are never in it. Department is the VeritaMap® department of the analyzers that run the analyte."] },
      { heading: "Coverage gaps", lines: ["If your laboratory needs a column or view not represented here, please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision."] },
    ],
    sheets: [
      {
        name: "Summary", columns: [["Measure", 52], ["Value", 20]],
        rows: [
          ["Events due in the period", r.due.total], ...sides,
          [`Results: ${PT_STATUS_LABEL.acceptable.toLowerCase()}`, r.results.acceptable], [`Results: ${PT_STATUS_LABEL.unacceptable.toLowerCase()}`, r.results.unacceptable],
          ["Results: graded (acceptable or unacceptable)", r.results.graded], ["Acceptable rate (acceptable / graded)", ptRateText(r.results)],
          [`Beside the rate: ${PT_STATUS_LABEL.ungraded.toLowerCase()}`, r.results.ungraded], [`Beside the rate: ${PT_STATUS_LABEL.not_graded.toLowerCase()}`, r.results.not_graded],
          [`Open reviews as of ${r.as_of}`, r.open_reviews.length], [`Ungraded results with no laboratory evaluation as of ${r.as_of}`, r.open_evaluations],
          [`Analytes at risk as of ${r.period.end}`, r.two_of_three.filter((t) => t.state === "AT-RISK").length], [`Analytes on watch as of ${r.period.end}`, r.two_of_three.filter((t) => t.state === "WATCH").length],
        ],
      },
      { name: "Events Due", columns: [["Event", 30], ["Program", 36], ["Due Date", 13], ["Submitted Date", 14], ["Submission", 30]], rows: r.due.events.map((e) => [e.event, e.program, e.due_date, e.submitted_date, PT_SUBMISSION_LABEL[e.submission]]) },
      { name: "By Analyte", columns: [["Analyte", 34], ["Unacceptable", 14], ["Ungraded", 14]], rows: r.by_analyte.map((a) => [a.name, a.unacceptable, a.ungraded]) },
      { name: "By Department", columns: [["Department", 34], ["Unacceptable", 14], ["Ungraded", 14]], rows: r.by_department.map((a) => [a.name, a.unacceptable, a.ungraded]) },
      { name: "Open Reviews", columns: [["Event", 30], ["Program", 36], ["Event Date", 13], ["Review", 22], ["Evaluations Open", 14]], rows: r.open_reviews.map((e) => [e.event, e.program, e.event_date, PT_REVIEW_LABEL[e.state], e.open_evaluations]) },
      { name: "Two of Three", columns: [["Analyte", 30], ["Flag", 46], ["Last Three Graded Results", 70]], rows: r.two_of_three.map((t) => [t.analyte, PT_FLAG_LABEL[t.state], ptLast3Text(t.last3)]) },
    ],
  }, applyLicense);
}
