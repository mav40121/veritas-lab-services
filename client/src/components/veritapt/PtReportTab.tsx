// The VeritaPT period report (B11, 2026-11-24; server/ptReport.ts, shared/ptReport.ts): a month, a quarter or a year.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { labTodayIso } from "@/lib/labDate";
import { downloadPdfToken } from "@/lib/utils";
import { PT_REVIEW_LABEL, PT_STATUS_LABEL, PT_SUBMISSION_LABEL, type PtSubmission } from "@shared/ptEvents";
import { PT_FLAG_LABEL, ptLast3Text, ptRateText, ptRateWords, type PtReport } from "@shared/ptReport";
import { ptDownload, ptRequest, ptSelectClass } from "./ptUi";

type Kind = "month" | "quarter" | "year";

function Section({ title, heads, rows, none, testid }: { title: string; heads: string[]; rows: ReactNode[][]; none: string; testid: string }) {
  return (
    <section className="space-y-2" data-testid={testid}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">{none}</p> : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-xs" style={{ minWidth: heads.length > 3 ? 560 : 320 }}>
            <thead><tr className="text-muted-foreground border-b bg-muted/40">{heads.map((h) => <th key={h} className="text-left py-2 px-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-border/50">{r.map((c, j) => <td key={j} className="py-1.5 px-2">{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function PtReportTab({ labId }: { labId: number }) {
  const { toast } = useToast();
  const today = labTodayIso(), thisYear = Number(today.slice(0, 4));
  const [kind, setKind] = useState<Kind>("quarter");
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(today.slice(5, 7));
  const [quarter, setQuarter] = useState(String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1));
  const [busy, setBusy] = useState<string | null>(null);
  const period = kind === "month" ? `${year}-${month}` : kind === "quarter" ? `${year}-Q${quarter}` : String(year);
  const url = `/api/labs/${labId}/pt/report?period=${period}`;
  const { data: r, isLoading, error } = useQuery<PtReport>({ queryKey: [url], queryFn: () => ptRequest(url), refetchOnMount: "always", retry: false });

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try { await fn(); } catch (e: any) { toast({ title: `Could not make the ${what}`, description: e.message, variant: "destructive" }); } finally { setBusy(null); }
  };
  const pdf = () => run("PDF", async () => { const { token, filename } = await ptRequest(`/api/labs/${labId}/pt/report/pdf?period=${period}`); downloadPdfToken(token, filename); });
  const excel = () => run("Excel file", () => ptDownload(`/api/labs/${labId}/pt/report/export.xlsx?period=${period}`, `VeritaPT_Report_${period}.xlsx`));

  return (
    <Card data-testid="pt-report">
      <CardHeader className="py-4 px-4 border-b">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="text-base font-semibold" data-testid="pt-report-title">Report: {r?.period.label ?? period}</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!r || !!busy} onClick={pdf} data-testid="pt-report-pdf"><FileText size={14} className="mr-1.5" />{busy === "PDF" ? "Preparing..." : "PDF"}</Button>
            <Button size="sm" variant="outline" disabled={!r || !!busy} onClick={excel} data-testid="pt-report-excel"><Download size={14} className="mr-1.5" />{busy === "Excel file" ? "Preparing..." : "Excel"}</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <select className={ptSelectClass} value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Period" data-testid="pt-report-kind"><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option></select>
          {kind === "month" && <select className={ptSelectClass} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" data-testid="pt-report-month">{Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => <option key={m} value={m}>{new Date(Date.UTC(2026, Number(m) - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })}</option>)}</select>}
          {kind === "quarter" && <select className={ptSelectClass} value={quarter} onChange={(e) => setQuarter(e.target.value)} aria-label="Quarter" data-testid="pt-report-quarter">{["1", "2", "3", "4"].map((q) => <option key={q} value={q}>Q{q}</option>)}</select>}
          <select className={ptSelectClass} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" data-testid="pt-report-year">{Array.from({ length: 8 }, (_, i) => thisYear + 1 - i).map((y) => <option key={y} value={y}>{y}</option>)}</select>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {!r ? <p className="py-8 text-center text-sm text-muted-foreground">{isLoading ? "Loading..." : error ? (error as Error).message : ""}</p> : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="pt-report-tiles">
              {([[ptRateText(r.results), "Acceptable rate"], [r.results.unacceptable, PT_STATUS_LABEL.unacceptable], [r.results.ungraded, PT_STATUS_LABEL.ungraded], [r.results.not_graded, PT_STATUS_LABEL.not_graded], [r.due.total, "Events due"], [r.open_reviews.length, "Open reviews"]] as Array<[ReactNode, string]>).map(([v, l]) => (
                <div key={l} className="rounded-lg border p-3 text-center"><div className={`font-bold ${typeof v === "string" && v.length > 8 ? "text-sm" : "text-2xl"}`}>{v}</div><div className="text-xs text-muted-foreground mt-1">{l}</div></div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground" data-testid="pt-report-rate-words">{ptRateWords(r.results)}</p>
            <Section testid="pt-report-due" title={`Events due: ${(["on_time", "late", "not_recorded", "not_due"] as PtSubmission[]).map((k) => `${r.due.counts[k]} ${PT_SUBMISSION_LABEL[k].toLowerCase()}`).join(", ")}`} heads={["Event", "Program", "Due", "Submitted", "Submission"]} rows={r.due.events.map((e) => [e.event, e.program, e.due_date, e.submitted_date ?? "", PT_SUBMISSION_LABEL[e.submission]])} none="No event has a due date in this period." />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Section testid="pt-report-analyte" title="Unacceptable and ungraded, by analyte" heads={["Analyte", "Unacceptable", "Ungraded"]} rows={r.by_analyte.map((a) => [a.name, a.unacceptable, a.ungraded])} none="None." />
              <Section testid="pt-report-department" title="Unacceptable and ungraded, by department" heads={["Department", "Unacceptable", "Ungraded"]} rows={r.by_department.map((a) => [a.name, a.unacceptable, a.ungraded])} none="None." />
            </div>
            <Section testid="pt-report-open" title={`Open reviews, as of ${r.as_of}`} heads={["Event", "Program", "Event date", "Review", "Evaluations open"]} rows={r.open_reviews.map((e) => [e.event, e.program, e.event_date, PT_REVIEW_LABEL[e.state], e.open_evaluations])} none="Every event of this period with a status back is reviewed." />
            <Section testid="pt-report-trends" title={`Two of three, as of ${r.period.end}`} heads={["Analyte", "Flag", "Last three graded results"]} rows={r.two_of_three.map((t) => [t.analyte, PT_FLAG_LABEL[t.state], ptLast3Text(t.last3)])} none="No analyte is at risk or on watch." />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
