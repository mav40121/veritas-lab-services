// Every proficiency testing event of every enrolled program (B11, 2026-11-24; server/ptEvents.ts, shared/ptEvents.ts). The
// Excel file is cut and sorted by the same functions as this list.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { labTodayIso } from "@/lib/labDate";
import { PT_STATUSES, PT_STATUS_LABEL, PT_SUBMISSION_LABEL, filterPtEvents, sortPtEvents, type PtEvent, type PtEventFilters } from "@shared/ptEvents";
import { PtStatusBadges, ptDownload, ptRequest, ptSelectClass } from "./ptUi";

export interface PtEventList {
  events: PtEvent[];
  programs: Array<{ key: string; label: string }>;
  analytes: string[];
  departments: string[];
  can_edit: boolean;
  own_only: boolean;
  today: string;
}

export function usePtEvents(labId: number | null) {
  const url = `/api/labs/${labId}/pt/events`;
  return useQuery<PtEventList>({ queryKey: [url], queryFn: () => ptRequest(url), enabled: !!labId, refetchOnMount: "always", retry: false });
}

const COLUMNS: Array<[string, string | null]> = [["Event", "event"], ["Program", "program"], ["Analytes", null], ["Event date", "date"], ["Due", "due"], ["Submitted", null], ["Status", "status"]];

export function PtEventsTab({ labId, onOpen }: { labId: number; onOpen: (resultId: number) => void }) {
  const { toast } = useToast();
  const { data, isLoading, error } = usePtEvents(labId);
  const [f, setF] = useState<PtEventFilters>({});
  const [downloading, setDownloading] = useState(false);
  const set = (k: keyof PtEventFilters) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value || undefined }));
  const events = data?.events ?? [];
  const shown = useMemo(() => sortPtEvents(filterPtEvents(events, f), f.sort, f.dir), [events, f]);
  const sort = f.sort ?? "date", dir = f.dir ?? (sort === "date" ? "desc" : "asc");
  const sortBy = (key: string) => setF((p) => ({ ...p, sort: key, dir: sort === key ? (dir === "asc" ? "desc" : "asc") : key === "date" ? "desc" : "asc" }));

  const download = async () => {
    setDownloading(true);
    try {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
      await ptDownload(`/api/labs/${labId}/pt/events/export.xlsx${qs.toString() ? `?${qs}` : ""}`, `VeritaPT_Events_${labTodayIso()}.xlsx`);
    } catch (e: any) {
      toast({ title: "Could not download the event list", description: e.message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card data-testid="pt-events">
      <CardHeader className="py-4 px-4 border-b">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="text-base font-semibold">Events of every enrolled program</CardTitle>
          {!data?.own_only && (
            <Button size="sm" variant="outline" onClick={download} disabled={downloading || shown.length === 0} data-testid="pt-events-export">
              <Download size={14} className="mr-1.5" />{downloading ? "Preparing..." : "Export to Excel"}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2 pt-2" data-testid="pt-events-filters">
          <select className={ptSelectClass} value={f.program ?? ""} onChange={set("program")} aria-label="Program" data-testid="pt-filter-program">
            <option value="">All programs</option>
            {(data?.programs ?? []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <select className={ptSelectClass} value={f.analyte ?? ""} onChange={set("analyte")} aria-label="Analyte" data-testid="pt-filter-analyte">
            <option value="">All analytes</option>
            {(data?.analytes ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className={ptSelectClass} value={f.department ?? ""} onChange={set("department")} aria-label="Department" data-testid="pt-filter-department">
            <option value="">All departments</option>
            {(data?.departments ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className={ptSelectClass} value={f.status ?? ""} onChange={set("status")} aria-label="Status" data-testid="pt-filter-status">
            <option value="">All statuses</option>
            {PT_STATUSES.map((s) => <option key={s} value={s}>{PT_STATUS_LABEL[s]}</option>)}
          </select>
          <label className="text-[10px] text-muted-foreground flex flex-col">Event date from
            <Input type="date" className="h-8 text-xs w-[140px]" value={f.from ?? ""} onChange={set("from")} data-testid="pt-filter-from" />
          </label>
          <label className="text-[10px] text-muted-foreground flex flex-col">to
            <Input type="date" className="h-8 text-xs w-[140px]" value={f.to ?? ""} onChange={set("to")} data-testid="pt-filter-to" />
          </label>
          <span className="text-xs text-muted-foreground pb-2" data-testid="pt-events-count">{shown.length} of {events.length} {events.length === 1 ? "event" : "events"}</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm" style={{ minWidth: 820 }}>
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-muted">
              <tr className="text-muted-foreground border-b text-xs">
                {COLUMNS.map(([label, key]) => (
                  <th key={label} className="text-left py-2.5 px-3 font-medium" aria-sort={key === sort ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                    {key ? (
                      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => sortBy(key)} data-testid={`pt-sort-${key}`}>
                        {label}{key === sort && (dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                      </button>
                    ) : label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.key} className="border-b border-border/50 align-top" data-testid="pt-event-row">
                  <td className="py-2.5 px-3">
                    {data?.own_only
                      ? <span className="font-medium">{e.name}</span>
                      : <button type="button" className="text-left font-medium text-[#006064] dark:text-teal-400 hover:underline" onClick={() => onOpen(e.id)} data-testid={`pt-event-open-${e.id}`}>{e.name}</button>}
                    <div className="text-[11px] text-muted-foreground">{e.results.length} {e.results.length === 1 ? "result" : "results"}</div>
                  </td>
                  <td className="py-2.5 px-3 text-xs">{e.program}</td>
                  <td className="py-2.5 px-3 text-xs max-w-[220px]">{e.analytes.join(", ")}<div className="text-[11px] text-muted-foreground">{e.departments.join(", ")}</div></td>
                  <td className="py-2.5 px-3 text-xs whitespace-nowrap">{e.event_date}</td>
                  <td className="py-2.5 px-3 text-xs whitespace-nowrap">{e.due_date ?? ""}</td>
                  <td className="py-2.5 px-3 text-xs">
                    {e.submitted_date ?? ""}
                    {(e.submission === "late" || e.submission === "not_recorded") && <div className={e.submission === "late" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}>{PT_SUBMISSION_LABEL[e.submission]}</div>}
                  </td>
                  <td className="py-2.5 px-3"><PtStatusBadges counts={e.counts} />{e.open_evaluations > 0 && !data?.own_only && <div className="text-[11px] mt-1 text-amber-700 dark:text-amber-400" data-testid="pt-open-evaluations">{e.open_evaluations} {e.open_evaluations === 1 ? "evaluation" : "evaluations"} open</div>}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={COLUMNS.length} className="py-8 text-center text-muted-foreground text-sm">
                  {isLoading ? "Loading events..." : error ? (error as Error).message : events.length ? "No events match these filters." : "No events recorded yet. Use Record PT Event to add the first one."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
