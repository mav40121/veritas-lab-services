// The two-of-three flags by analyte, each with its full history (B11, 2026-11-24; server/ptTrends.ts). Every flagged analyte is
// listed, and the rest can be opened too.
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export interface PtTrendView {
  analyte: string;
  state: string;
  fails_in_last_3: number;
  history: Array<{ event_date: string; event: string | null; pass_fail: string; state: string | null }>;
}

const DOT: Record<string, string> = { "AT-RISK": "bg-red-500", WATCH: "bg-amber-500", OK: "bg-emerald-500" };
const GRADE: Record<string, string> = { pass: "Acceptable", fail: "Unacceptable", ungraded: "Ungraded, not counted" };

export function PtTrendHistoryTable({ trend }: { trend: PtTrendView }) {
  return (
    <div className="overflow-x-auto mt-1 rounded border border-border bg-background" data-testid={`pt-trend-history-${trend.analyte}`}>
      <table className="w-full text-xs">
        <thead><tr className="text-muted-foreground border-b bg-muted/40"><th className="text-left py-1 px-2 font-medium">Event date</th><th className="text-left py-1 px-2 font-medium">Event</th><th className="text-left py-1 px-2 font-medium">Result</th><th className="text-left py-1 px-2 font-medium">Flag after it</th></tr></thead>
        <tbody>
          {trend.history.map((h, i) => (
            <tr key={i} className="border-b border-border/50 text-foreground">
              <td className="py-1 px-2 whitespace-nowrap">{h.event_date.slice(0, 10)}</td><td className="py-1 px-2">{h.event ?? ""}</td><td className="py-1 px-2">{GRADE[h.pass_fail] ?? h.pass_fail}</td><td className="py-1 px-2">{h.state ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendRow({ t }: { t: PtTrendView }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="text-xs">
      <button type="button" className="flex items-center gap-2 text-left" aria-expanded={open} onClick={() => setOpen(!open)} data-testid={`pt-trend-${t.analyte}`}>
        <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${DOT[t.state] ?? "bg-muted-foreground"}`} />
        <span className="font-medium">{t.analyte}</span>
        <span className="text-muted-foreground">{t.fails_in_last_3} fail(s) in last 3</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && <PtTrendHistoryTable trend={t} />}
    </li>
  );
}

export function PtTrendList({ trends }: { trends: PtTrendView[] }) {
  const [all, setAll] = useState(false);
  const flagged = trends.filter((t) => t.state !== "OK"), rest = trends.filter((t) => t.state === "OK");
  return (
    <div className="mt-3 space-y-2" data-testid="pt-trend-list">
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 items-start">{flagged.map((t) => <TrendRow key={t.analyte} t={t} />)}</ul>
      {rest.length > 0 && (
        <>
          <button type="button" className="text-xs text-muted-foreground underline hover:no-underline" onClick={() => setAll(!all)} data-testid="pt-trend-all">
            {all ? "Hide the other analytes" : `Show the ${rest.length} other ${rest.length === 1 ? "analyte" : "analytes"}, all OK`}
          </button>
          {all && <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 items-start">{rest.map((t) => <TrendRow key={t.analyte} t={t} />)}</ul>}
        </>
      )}
    </div>
  );
}
