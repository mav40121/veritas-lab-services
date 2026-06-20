// client/src/pages/VeritaStockTrendsPage.tsx
//
// VeritaStock Valuation Trends: 6-month inventory value on hand by location,
// with monthly write-off (waste) dollars overlaid. Reads the cross-location
// rollup from /api/inventory/valuation-trend (owner + active memberships).
// The CFO view of the whole network in one frame.

import { useState, useEffect, useMemo } from "react";
import { Link, useParams } from "wouter";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw, Lock, TrendingDown } from "lucide-react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, Legend,
} from "recharts";

interface MonthCell { month: string; avg_value_on_hand: number; waste_value: number; waste_note: string | null; }
interface LocationSeries { lab_id: number; lab_name: string; monthly: MonthCell[]; }

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Per-location palette (teal-led, brand-forward). Cycles if more than 5.
const LOC_COLORS = ["#0F6E56", "#378ADD", "#7F77DD", "#BA7517", "#888780", "#1D9E75", "#D4537E"];
const WASTE_COLOR = "#E24B4A";

function ymLabel(ym: string): string {
  const parts = ym.split("-");
  const m = parseInt(parts[1], 10);
  return MONTH_NAMES[m - 1] || ym;
}
function usd(v: number): string { return "$" + Math.round(v).toLocaleString(); }

export default function VeritaStockTrendsPage() {
  const params = useParams();
  const labId = (params as any).labId as string | undefined;
  useSEO({
    title: "VeritaStock Valuation Trends",
    description: "Six-month inventory value on hand by location with monthly waste, for a multi-location supply network.",
  });

  const [months, setMonths] = useState<string[]>([]);
  const [locations, setLocations] = useState<LocationSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/inventory/valuation-trend`, { headers: authHeaders() });
      if (res.status === 403) { setLocked(true); setLoading(false); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMonths(data.months || []);
      setLocations(data.locations || []);
    } catch (e: any) {
      setError(e.message || "Failed to load trend");
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // One row per month: each location's value as a keyed series, plus total waste.
  const chartData = useMemo(() => {
    return months.map((ym, idx) => {
      const row: any = { month: ymLabel(ym) };
      let waste = 0;
      for (const loc of locations) {
        const cell = loc.monthly[idx];
        row[loc.lab_name] = cell ? cell.avg_value_on_hand : 0;
        waste += cell ? cell.waste_value : 0;
      }
      row.__waste = waste;
      return row;
    });
  }, [months, locations]);

  const kpis = useMemo(() => {
    const totals = chartData.map((r) => locations.reduce((s, l) => s + (r[l.lab_name] || 0), 0));
    const wastes = chartData.map((r) => r.__waste || 0);
    const avgValue = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
    const freed = totals.length >= 2 ? totals[0] - totals[totals.length - 1] : 0;
    const totalWaste = wastes.reduce((a, b) => a + b, 0);
    const currentWaste = wastes.length ? wastes[wastes.length - 1] : 0;
    return { avgValue, freed, totalWaste, currentWaste };
  }, [chartData, locations]);

  const backHref = labId ? `/labs/${labId}/veritastock` : "/veritastock";

  if (locked) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <Lock size={40} className="mx-auto text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">VeritaStock{"™"} Valuation Trends</h1>
        <p className="text-muted-foreground">VeritaStock requires an active subscription to view valuation trends.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <Link href={backHref}>
            <Button variant="ghost" size="sm" className="mb-2 -ml-2"><ArrowLeft size={14} className="mr-1.5" />Back to inventory</Button>
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: "#01696F" }}>Valuation Trends</h1>
          <p className="text-sm text-muted-foreground">Average inventory value on hand by location, with monthly write-offs, across the last six months.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="trends-refresh">
          <RefreshCw size={14} className="mr-1.5" />Refresh
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground">Loading valuation trends...</div>
      ) : error ? (
        <div className="text-center py-16 text-destructive">{error}</div>
      ) : chartData.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">No valuation history yet.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5" data-testid="trends-kpis">
            <div className="rounded-lg border p-4 bg-card/50">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Avg inventory value</div>
              <div className="text-2xl font-bold font-mono">{usd(kpis.avgValue)}</div>
              <div className="text-[11px] text-muted-foreground">6-month, all locations</div>
            </div>
            <div className="rounded-lg border p-4 bg-card/50">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Working capital freed</div>
              <div className="text-2xl font-bold font-mono" style={{ color: "#0F6E56" }}>{usd(kpis.freed)}</div>
              <div className="text-[11px] text-muted-foreground flex items-center gap-1"><TrendingDown size={11} />since the first month</div>
            </div>
            <div className="rounded-lg border p-4 bg-card/50">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Waste written off</div>
              <div className="text-2xl font-bold font-mono" style={{ color: "#A12C7B" }}>{usd(kpis.totalWaste)}</div>
              <div className="text-[11px] text-muted-foreground">6-month total</div>
            </div>
            <div className="rounded-lg border p-4 bg-card/50">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Current monthly waste</div>
              <div className="text-2xl font-bold font-mono" style={{ color: kpis.currentWaste > 0 ? "#A12C7B" : "#0F6E56" }}>{usd(kpis.currentWaste)}</div>
              <div className="text-[11px] text-muted-foreground">latest month</div>
            </div>
          </div>

          <div className="rounded-lg border p-4 mb-5">
            <div style={{ width: "100%", height: 360 }}>
              <ResponsiveContainer>
                <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="month" />
                  <YAxis yAxisId="left" tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                  <RechartsTooltip formatter={(v: any, n: any) => [usd(v as number), n === "__waste" ? "Waste $" : n]} />
                  <Legend formatter={(v) => (v === "__waste" ? "Waste $ (right axis)" : v)} />
                  {locations.map((loc, i) => (
                    <Bar key={loc.lab_id} yAxisId="left" dataKey={loc.lab_name} stackId="v" fill={LOC_COLORS[i % LOC_COLORS.length]} />
                  ))}
                  <Line yAxisId="right" type="monotone" dataKey="__waste" name="__waste" stroke={WASTE_COLOR} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-lg border overflow-x-auto" data-testid="trends-table">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ backgroundColor: "#01696F10" }}>
                  <th className="text-left px-3 py-2 font-medium">Location</th>
                  {months.map((m) => <th key={m} className="text-right px-3 py-2 font-medium">{ymLabel(m)}</th>)}
                </tr>
              </thead>
              <tbody>
                {locations.map((loc) => (
                  <tr key={loc.lab_id} className="border-b">
                    <td className="px-3 py-2 font-medium">{loc.lab_name}</td>
                    {loc.monthly.map((c) => (
                      <td key={c.month} className="px-3 py-2 text-right font-mono">
                        {usd(c.avg_value_on_hand)}
                        {c.waste_value > 0 && <div className="text-[10px]" style={{ color: "#A12C7B" }}>waste {usd(c.waste_value)}</div>}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr style={{ backgroundColor: "#01696F08" }}>
                  <td className="px-3 py-2 font-bold">System total</td>
                  {chartData.map((r, idx) => (
                    <td key={idx} className="px-3 py-2 text-right font-mono font-bold">
                      {usd(locations.reduce((s, l) => s + (r[l.lab_name] || 0), 0))}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
