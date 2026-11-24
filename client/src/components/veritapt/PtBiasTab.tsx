// Bias and trend per analyte (B11, 2026-11-24; server/ptBiasRoutes.ts, shared/ptBias.ts). The server works out every number; the
// chart and the table beneath it show the same ones.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Flag } from "lucide-react";
import type { PtBias } from "@shared/ptBias";
import type { PtStatus } from "@shared/ptEvents";
import { PtTrendHistoryTable, PtTrendList, type PtTrendView } from "./PtTrendList";
import { PtStatusBadge, ptNum, ptRange, ptRequest, ptSelectClass } from "./ptUi";

type Point = PtBias & {
  id: number; event_key: string; event: string; event_date: string; program: string; your_result: number | null; peer_mean: number | null; peer_sd: number | null; peer_n: number | null;
  acceptable_low: number | null; acceptable_high: number | null; status: PtStatus; your_method: string | null;
};
interface FlagView { rule: "same_event" | "three_events"; text: string; event_keys: string[]; event?: string }
interface BiasData { analytes: Array<{ analyte: string; points: Point[]; flags: FlagView[]; trend: PtTrendView | null }>; event_flags: FlagView[]; rules: { same_event: string; three_events: string } }
type Measure = "percent" | "sdi";

const MEASURE: Record<Measure, { label: string; unit: string }> = { percent: { label: "Percent difference from the peer mean", unit: "%" }, sdi: { label: "SDI (difference in peer SDs)", unit: "" } };
const signed = (v: number | null, places = 2): string => (v == null ? "" : `${v > 0 ? "+" : ""}${v.toFixed(places)}`);
const NO_PEER = <span className="text-muted-foreground">no peer data</span>;

/** Round axis values that hold 0 and everything plotted. */
function axisTicks(values: number[]): number[] {
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values), span = hi - lo || 1;
  const rough = span / 4, mag = 10 ** Math.floor(Math.log10(rough)), n = rough / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const from = Math.floor(lo / step + 1e-9), to = Math.ceil(hi / step - 1e-9);
  return Array.from({ length: Math.max(to - from, 1) + 1 }, (_, i) => Number(((from + i) * step).toFixed(6)));
}

function FlagLine({ text }: { text: string }) {
  return <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300" data-testid="pt-bias-flag"><Flag size={14} className="mt-0.5 shrink-0" />{text}</p>;
}

function Chart({ points, measure }: { points: Point[]; measure: Measure }) {
  const rows = points.map((p, i) => {
    const range = measure === "percent" ? p.range_percent : p.range_sdi;
    return { i, label: p.event, date: p.event_date, value: p[measure], range: range[0] != null && range[1] != null ? range : undefined, p };
  });
  if (!rows.some((r) => r.value != null)) return <p className="py-10 text-center text-sm text-muted-foreground" data-testid="pt-bias-nothing">{points.some((p) => p.peer_mean != null) ? "No result here has what this measure needs." : "No peer data entered for this analyte."}</p>;
  const u = MEASURE[measure].unit;
  const ticks = axisTicks(rows.flatMap((r) => [r.value, ...(r.range ?? [])]).filter((v): v is number => v != null));
  return (
    <div className="h-64 text-[#01696F] dark:text-teal-400" data-testid="pt-bias-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.12} />
          <XAxis dataKey="i" tickFormatter={(i) => rows[Number(i)]?.date ?? ""} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} minTickGap={24} />
          <YAxis width={48} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}${u}`} ticks={ticks} domain={[ticks[0], ticks[ticks.length - 1]]} interval={0} />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
          <Bar dataKey="range" barSize={22} radius={4} fill="hsl(var(--muted-foreground))" fillOpacity={0.22} isAnimationActive={false} activeBar={false} />
          <Line dataKey="value" type="linear" stroke="currentColor" strokeWidth={2} connectNulls={false} isAnimationActive={false} dot={{ r: 4, fill: "currentColor", stroke: "hsl(var(--card))", strokeWidth: 2 }} activeDot={{ r: 6, fill: "currentColor", stroke: "hsl(var(--card))", strokeWidth: 2 }} />
          <RechartsTooltip
            cursor={{ stroke: "hsl(var(--border))" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined;
              if (!row) return null;
              return (
                <div className="rounded-md border bg-popover text-popover-foreground px-3 py-2 text-xs shadow-md">
                  <div className="font-medium">{row.label}, {row.date}</div>
                  <div>Result {ptNum(row.p.your_result)}{row.p.peer_mean != null ? `, peer mean ${ptNum(row.p.peer_mean)}` : ""}</div>
                  <div>{row.value == null ? "No peer data" : `${signed(row.value)}${u}`}</div>
                  {row.range && <div className="text-muted-foreground">Program's range {signed(row.range[0] as number)}{u} to {signed(row.range[1] as number)}{u}</div>}
                </div>
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Every analyte's flag and its full history, numeric results or not, whether or not anything is flagged. */
function TrendCard({ trends }: { trends: PtTrendView[] }) {
  if (!trends.length) return null;
  return (
    <Card data-testid="pt-bias-trends">
      <CardHeader className="py-4 px-4 border-b"><CardTitle className="text-base font-semibold">Trend status by analyte, with its full history</CardTitle></CardHeader>
      <CardContent className="p-4 pt-1"><PtTrendList trends={trends} /></CardContent>
    </Card>
  );
}

export function PtBiasTab({ labId, trends }: { labId: number; trends: PtTrendView[] }) {
  const url = `/api/labs/${labId}/pt/bias`;
  const { data, isLoading, error } = useQuery<BiasData>({ queryKey: [url], queryFn: () => ptRequest(url), refetchOnMount: "always", retry: false });
  const [picked, setPicked] = useState("");
  const [measure, setMeasure] = useState<Measure>("percent");
  const analytes = data?.analytes ?? [];
  const flagged = useMemo(() => analytes.filter((a) => a.flags.length > 0), [analytes]);
  const current = analytes.find((a) => a.analyte === picked) ?? flagged[0] ?? analytes[0];
  if (!data || !current) {
    return (
      <div className="space-y-6">
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground" data-testid="pt-bias-empty">{isLoading ? "Loading..." : error ? (error as Error).message : "No numeric results recorded yet."}</CardContent></Card>
        <TrendCard trends={trends} />
      </div>
    );
  }
  const range = current.points.some((p) => (measure === "percent" ? p.range_percent : p.range_sdi).every((v) => v != null));
  return (
    <div className="space-y-6" data-testid="pt-bias">
      <Card>
        <CardHeader className="py-4 px-4 border-b"><CardTitle className="text-base font-semibold">Flags for review</CardTitle></CardHeader>
        <CardContent className="p-4 space-y-2">
          {flagged.length + data.event_flags.length === 0 && <p className="text-sm text-muted-foreground" data-testid="pt-bias-no-flags">No flags on the results entered.</p>}
          {data.event_flags.map((f, i) => <FlagLine key={`e${i}`} text={f.text} />)}
          {flagged.map((a) => a.flags.map((f, i) => <FlagLine key={`${a.analyte}${i}`} text={f.text} />))}
          <div className="text-xs text-muted-foreground space-y-1 pt-1" data-testid="pt-bias-rules">
            <p>{data.rules.same_event}</p>
            <p>{data.rules.three_events}</p>
            <p>A flag is a prompt to look. It isn't a finding about the method; what it means is the laboratory's to decide.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-4 px-4 border-b">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-base font-semibold">{current.analyte}: {MEASURE[measure].label}</CardTitle>
            <div className="flex flex-wrap gap-2">
              <select className={ptSelectClass} value={current.analyte} onChange={(e) => setPicked(e.target.value)} aria-label="Analyte" data-testid="pt-bias-analyte">
                {analytes.map((a) => <option key={a.analyte} value={a.analyte}>{a.analyte}{a.flags.length ? " (flag)" : ""}</option>)}
              </select>
              {(Object.keys(MEASURE) as Measure[]).map((m) => (
                <Button key={m} size="sm" variant={measure === m ? "default" : "outline"} className={`h-8 text-xs ${measure === m ? "bg-[#006064] hover:bg-[#004d50] text-white" : ""}`} aria-pressed={measure === m} onClick={() => setMeasure(m)} data-testid={`pt-bias-${m}`}>
                  {m === "percent" ? "Percent difference" : "SDI"}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <Chart points={current.points} measure={measure} />
          <p className="text-xs text-muted-foreground">{range ? "Each dot is one result. The gray bar behind it is the program's own acceptance range, where the event carries both ends of one." : "Each dot is one result. No event here carries the program's acceptance range."} A result with no peer data has no dot.</p>
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-xs" style={{ minWidth: 820 }} data-testid="pt-bias-table">
              <thead><tr className="text-muted-foreground border-b bg-muted/40">
                {["Event", "Date", "Result", "Peer mean", "Peer SD", "Difference", "Percent difference", "SDI", "Program's range", "Status"].map((h) => <th key={h} className="text-left py-2 px-2 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {current.points.map((p) => (
                  <tr key={p.id} className="border-b border-border/50" data-testid={`pt-bias-row-${p.id}`}>
                    <td className="py-1.5 px-2">{p.event}</td><td className="py-1.5 px-2 whitespace-nowrap">{p.event_date}</td><td className="py-1.5 px-2">{ptNum(p.your_result)}</td>
                    <td className="py-1.5 px-2">{p.peer_mean == null ? NO_PEER : ptNum(p.peer_mean)}</td><td className="py-1.5 px-2">{ptNum(p.peer_sd)}</td>
                    <td className="py-1.5 px-2">{p.difference == null ? NO_PEER : signed(p.difference, 6).replace(/\.?0+$/, "")}</td>
                    <td className="py-1.5 px-2">{p.difference == null ? NO_PEER : p.percent == null ? <span className="text-muted-foreground">peer mean is 0</span> : `${signed(p.percent)}%`}</td>
                    <td className="py-1.5 px-2">{p.difference == null ? NO_PEER : p.sdi == null ? <span className="text-muted-foreground">no peer SD</span> : signed(p.sdi)}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">{ptRange(p.acceptable_low, p.acceptable_high)}</td>
                    <td className="py-1.5 px-2"><PtStatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {current.trend && (
            <div>
              <h3 className="text-sm font-semibold">{current.analyte}: trend status by event</h3>
              <p className="text-xs text-muted-foreground">Per 42 CFR §493.2, unsatisfactory performance in two consecutive or two out of three testing events is unsuccessful participation.</p>
              <PtTrendHistoryTable trend={current.trend} />
            </div>
          )}
        </CardContent>
      </Card>
      <TrendCard trends={trends} />
    </div>
  );
}
