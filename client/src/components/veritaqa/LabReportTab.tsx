// client/src/components/veritaqa/LabReportTab.tsx
//
// One laboratory's report across all of its quality indicators: a month, a quarter or a year (B15; server/labQualityReport.ts).
// The PDF and the workbook print the same numbers.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE, responseErrorText } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { downloadPdfToken } from "@/lib/utils";
import { labTodayIso } from "@/lib/labDate";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, FileText } from "lucide-react";
import { MONTH_SHORT, trimNumber, valueText, type PeriodKind, type PeriodResult } from "@shared/qualityIndicators";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const selectCls = "h-9 rounded-md border border-input bg-background px-2 text-sm";
export const RESULT_COLOR: Record<string, string> = {
  Met: "text-[#437A22] dark:text-green-300", Missed: "text-[#A12C7B] dark:text-pink-300", Watch: "text-[#964219] dark:text-amber-300", "No entry": "text-muted-foreground", "Not judged": "text-muted-foreground",
};
const resultColor = (t: string) => {
  if (RESULT_COLOR[t]) return RESULT_COLOR[t];
  const m = /^Met (\d+) of (\d+)$/.exec(t);
  return m ? (m[1] === m[2] ? RESULT_COLOR.Met : RESULT_COLOR.Watch) : "";
};
const statusColor = (s: string | null) => (s === "green" ? RESULT_COLOR.Met : s === "yellow" ? RESULT_COLOR.Watch : s === "red" ? RESULT_COLOR.Missed : "");

interface Month { month: number; value: number | null; value_text: string; volume: number | null; numerator: number | null; denominator: number | null; status: "green" | "yellow" | "red" | null; due: boolean; notes: string | null; root_cause: string | null; corrective_action: string | null; findings: { link_id: number; label: string }[] }
interface Row { metric_id: number; name: string; unit: string; target_text: string; organization: string | null; off_since: string | null; inactive: boolean; months: Month[]; period: PeriodResult | null; period_text: string; result_text: string }
interface Report { period: { label: string; kind: PeriodKind; months: number[] }; counts: { indicators: number; with_entries: number; no_entry: number }; sections: { title: string; account_wide: boolean; departments: { name: string; rows: Row[] }[] }[] }

/** The months, quarters and years a report is picked by, shared with the report across laboratories. */
export function PeriodPicker({ value, onChange, kinds }: { value: { period: PeriodKind; year: number; month: number; quarter: number }; onChange: (v: { period: PeriodKind; year: number; month: number; quarter: number }) => void; kinds: [PeriodKind, string][] }) {
  const thisYear = Number(labTodayIso().slice(0, 4));
  const years = Array.from({ length: 6 }, (_, i) => thisYear + 1 - i);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Period" className={selectCls} value={value.period} onChange={(e) => onChange({ ...value, period: e.target.value as PeriodKind })} data-testid="qa-report-period">
        {kinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {value.period === "quarter" && (
        <select aria-label="Quarter" className={selectCls} value={value.quarter} onChange={(e) => onChange({ ...value, quarter: Number(e.target.value) })} data-testid="qa-report-quarter">
          {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Quarter {q}</option>)}
        </select>
      )}
      {(value.period === "month" || value.period === "ytd") && (
        <select aria-label={value.period === "ytd" ? "Through" : "Month"} className={selectCls} value={value.month} onChange={(e) => onChange({ ...value, month: Number(e.target.value) })} data-testid="qa-report-month">
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{value.period === "ytd" ? `Through ${m}` : m}</option>)}
        </select>
      )}
      <select aria-label="Year" className={selectCls} value={value.year} onChange={(e) => onChange({ ...value, year: Number(e.target.value) })} data-testid="qa-report-year">
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}

export const firstPeriod = (): { period: PeriodKind; year: number; month: number; quarter: number } => {
  const [y, m] = labTodayIso().split("-").map(Number);
  return { period: "month", year: y, month: m, quarter: Math.ceil(m / 3) };
};

export default function LabReportTab({ labId }: { labId: number }) {
  const { toast } = useToast();
  const [pick, setPick] = useState(firstPeriod);
  const [busy, setBusy] = useState<string | null>(null);
  const base = `/api/labs/${labId}/veritaqa/pi/report`;
  const query = new URLSearchParams({ period: pick.period, year: String(pick.year), month: String(pick.month), quarter: String(pick.quarter) }).toString();
  const { data, error, isLoading } = useQuery<Report>({
    queryKey: [base, query], refetchOnMount: "always",
    queryFn: async () => {
      const r = await fetch(`${API_BASE}${base}?${query}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await responseErrorText(r, "Could not load the report"));
      return r.json();
    },
  });
  async function download(kind: "pdf" | "xlsx") {
    setBusy(kind);
    try {
      const r = await fetch(`${API_BASE}${base}/${kind}`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(pick) });
      if (!r.ok) { toast({ title: "Report failed", description: await responseErrorText(r, "Try again."), variant: "destructive" }); return; }
      const { token, filename } = await r.json();
      downloadPdfToken(token, filename);
    } finally { setBusy(null); }
  }
  const month = data?.period.kind === "month", year = data?.period.kind === "year";
  return (
    <div className="space-y-4" data-testid="qa-lab-report">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodPicker value={pick} onChange={setPick} kinds={[["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]]} />
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => download("pdf")} disabled={!data || busy != null} data-testid="qa-report-pdf"><FileText size={14} className="mr-1.5" />{busy === "pdf" ? "Making..." : "PDF"}</Button>
          <Button size="sm" variant="outline" onClick={() => download("xlsx")} disabled={!data || busy != null} data-testid="qa-report-xlsx"><Download size={14} className="mr-1.5" />{busy === "xlsx" ? "Making..." : "Excel"}</Button>
        </div>
      </div>
      {isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading the report...</p>
        : error ? <p role="alert" className="text-sm text-destructive">{(error as Error).message}</p>
        : data ? (
          <>
            <p className="text-sm" data-testid="qa-report-summary"><b>{data.period.label}</b>. {data.counts.indicators} {data.counts.indicators === 1 ? "indicator" : "indicators"}: {data.counts.with_entries} with an entry, {data.counts.no_entry} with no entry.</p>
            {data.sections.length === 0 && <p className="text-sm text-muted-foreground">No indicators yet.</p>}
            {data.sections.map((s) => (
              <Card key={s.title}>
                <CardHeader className="pb-2"><CardTitle className="text-base">{s.title}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {s.departments.map((d) => (
                    <div key={d.name}>
                      <h3 className="mb-1 font-sans text-sm font-semibold text-[#01696F] dark:text-teal-300">{d.name}</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full table-fixed text-sm" style={{ minWidth: year ? 1150 : 640 }}>
                          <colgroup>{(month ? [24, 14, 11, 11, 11, 29] : year ? [14.8, 9.2, ...Array(12).fill(5.1), 7, 7.8] : [28, 18, 11, 11, 11, 10.5, 10.5]).map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
                          <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                            <tr>
                              <th className="px-2 py-2">Indicator</th><th className="px-2 py-2">Target</th>
                              {month ? <><th className="px-2 py-2 text-right">Value</th><th className="px-2 py-2 text-right">Counted</th></> : data.period.months.map((m) => <th key={m} className="py-2 pl-1 pr-5 text-right">{MONTH_SHORT[m - 1]}</th>)}
                              {!month && <th className="px-2 py-2 text-right">Period total</th>}
                              <th className="px-2 py-2">Result</th>
                              {month && <th className="px-2 py-2">Notes and linked findings</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {d.rows.map((x) => {
                              const m = x.months[0];
                              return (
                                <tr key={x.metric_id} className="border-b align-top last:border-b-0" data-testid={`qa-report-row-${x.metric_id}`}>
                                  <td className="px-2 py-2 font-medium">{x.name}{x.organization && <div className="text-xs font-normal text-muted-foreground">{x.organization} indicator</div>}{x.off_since && <div className="text-xs font-normal text-muted-foreground">Turned off {x.off_since}</div>}</td>
                                  <td className="px-2 py-2 text-xs">{x.target_text}</td>
                                  {month ? (
                                    <>
                                      <td className="px-2 py-2 text-right font-mono">{m.value == null ? <span className="font-sans text-muted-foreground">No entry</span> : m.value_text}</td>
                                      <td className="px-2 py-2 text-right font-mono text-xs">{m.numerator != null ? (m.denominator != null ? `${m.numerator.toLocaleString()} / ${m.denominator.toLocaleString()}` : m.numerator.toLocaleString()) : m.volume != null ? `volume ${m.volume.toLocaleString()}` : ""}</td>
                                    </>
                                  ) : x.months.map((y) => <td key={y.month} className={`px-1 py-2 text-right font-mono ${year ? "text-xs" : ""} ${statusColor(y.status)}`} title={y.findings.map((f) => f.label).join("; ") || undefined}>{y.value == null ? (y.due ? <span className={`font-sans text-muted-foreground whitespace-nowrap ${year ? "text-[11px]" : "mr-4"}`}>No entry</span> : "") : <>{trimNumber(y.value)}<span aria-hidden="true" className="inline-block w-4 pl-0.5 text-left text-[11px] font-bold">{y.status === "yellow" ? "W" : y.status === "red" ? "M" : ""}{y.findings.length ? "*" : ""}</span>{(y.status === "yellow" || y.status === "red") && <span className="sr-only"> {y.status === "yellow" ? "Watch" : "Missed"}</span>}</>}</td>)}
                                  {!month && <td className="px-2 py-2 text-right font-mono font-semibold" title={x.period && x.period.denominator != null ? `${x.period.numerator} / ${x.period.denominator}` : undefined}>{x.period && x.period.value != null ? valueText(x.period.value, x.period.unit) : ""}</td>}
                                  <td className={`px-2 py-2 text-xs font-semibold whitespace-nowrap ${resultColor(x.result_text)}`}>{x.result_text}</td>
                                  {month && <td className="px-2 py-2 text-xs">{[m.notes, m.root_cause ? `Root cause: ${m.root_cause}` : "", m.corrective_action ? `Corrective action: ${m.corrective_action}` : "", m.findings.length ? `Linked: ${m.findings.map((f) => f.label).join("; ")}` : ""].filter(Boolean).map((t, i) => <div key={i}>{t}</div>)}</td>}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
            <p className="text-xs text-muted-foreground">
              {month ? "" : "W after a number is Watch, M is Missed; a number with no letter met its target, or has no target set. "}No entry: nothing was entered that month; it counts as neither met nor missed. Not judged: no single target applies. A period total comes only from numerators and denominators; values entered alone are listed by month and not averaged. * A VeritaResponse™ entry is linked to that month.
            </p>
          </>
        ) : null}
    </div>
  );
}
