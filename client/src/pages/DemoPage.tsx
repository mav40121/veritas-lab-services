import { useState, useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Calculator, TrendingDown, TrendingUp, DollarSign,
  Users, BarChart3, Grid3X3, Activity, ChevronDown,
} from "lucide-react";
import { API_BASE } from "@/lib/queryClient";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip as RechartsTooltip, ReferenceArea, Legend,
} from "recharts";

// ── Shared constants ──────────────────────────────────────────────────────────

const BENCHMARKS: Record<string, { label: string; low: number; high: number }> = {
  community: { label: "Community Hospital (200K-500K billables/yr)", low: 0.15, high: 0.22 },
  trauma: { label: "Large Trauma Center (750K-1.5M billables/yr)", low: 0.09, high: 0.13 },
  reference: { label: "Reference Lab (2M+ billables/yr)", low: 0.06, high: 0.09 },
  other: { label: "Other/Unknown", low: 0, high: 0 },
};

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface ProductivityMonth {
  id: number;
  account_id: number;
  year: number;
  month: number;
  billable_tests: number | null;
  productive_hours: number | null;
  non_productive_hours: number | null;
  overtime_hours: number | null;
  total_ftes: number | null;
  facility_type: string;
  notes: string | null;
}

interface HourlyDataItem {
  study_id: number;
  week_number: number;
  day_of_week: number;
  hour_slot: number;
  metric_type: string;
  value: number;
}

interface StaffingStudy {
  id: number;
  name: string;
  department: string;
  status: string;
}

// ── Section navigation ────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "calculator", label: "Calculator" },
  { id: "tracker", label: "Tracker" },
  { id: "staffing", label: "Staffing" },
];

function SectionNav({ active }: { active: string }) {
  return (
    <nav className="fixed right-4 top-1/2 -translate-y-1/2 z-40 hidden md:flex flex-col gap-2">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          onClick={() => document.getElementById(`section-${s.id}`)?.scrollIntoView({ behavior: "smooth" })}
          className="group flex items-center gap-2 transition-all"
          title={s.label}
        >
          <span className={`text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity ${active === s.id ? "!opacity-100 text-[#01696F]" : "text-muted-foreground"}`}>
            {s.label}
          </span>
          <span className={`w-2.5 h-2.5 rounded-full border-2 transition-all ${active === s.id ? "bg-[#01696F] border-[#01696F] scale-125" : "border-muted-foreground/40 hover:border-[#01696F]"}`} />
        </button>
      ))}
    </nav>
  );
}

// ── Calculator helpers ────────────────────────────────────────────────────────

function getBand(ratio: number, low: number, high: number): "green" | "yellow" | "red" {
  if (ratio >= low && ratio <= high) return "green";
  if (ratio < low) return "green";
  const margin = (high - low) * 0.25;
  if (ratio <= high + margin) return "yellow";
  return "red";
}

function GaugeBar({ ratio, low, high }: { ratio: number; low: number; high: number }) {
  const minVal = Math.min(low * 0.4, ratio * 0.8);
  const maxVal = Math.max(high * 1.8, ratio * 1.2);
  const range = maxVal - minVal;
  const pctLow = ((low - minVal) / range) * 100;
  const pctHigh = ((high - minVal) / range) * 100;
  const pctRatio = Math.max(0, Math.min(100, ((ratio - minVal) / range) * 100));
  const band = getBand(ratio, low, high);
  const markerColor = band === "green" ? "#16a34a" : band === "yellow" ? "#ca8a04" : "#dc2626";

  return (
    <div className="relative w-full h-10 mt-4 mb-6">
      <div className="absolute inset-0 rounded-full bg-muted overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-emerald-200 dark:bg-emerald-900/40" style={{ width: `${Math.max(0, pctLow)}%` }} />
        <div className="absolute inset-y-0 bg-emerald-200 dark:bg-emerald-900/40" style={{ left: `${pctLow}%`, width: `${pctHigh - pctLow}%` }} />
        <div className="absolute inset-y-0 bg-yellow-200 dark:bg-yellow-900/30" style={{ left: `${pctHigh}%`, width: "5%" }} />
        <div className="absolute inset-y-0 bg-red-200 dark:bg-red-900/30" style={{ left: `${pctHigh + 5}%`, right: 0 }} />
      </div>
      <div className="absolute top-0 bottom-0 flex flex-col items-center" style={{ left: `${pctRatio}%`, transform: "translateX(-50%)" }}>
        <div className="w-1 flex-1 rounded-full" style={{ backgroundColor: markerColor }} />
        <div className="text-xs font-bold mt-1" style={{ color: markerColor }}>{ratio.toFixed(3)}</div>
      </div>
      <div className="absolute -bottom-5 text-[10px] text-muted-foreground" style={{ left: `${pctLow}%`, transform: "translateX(-50%)" }}>{low.toFixed(2)}</div>
      <div className="absolute -bottom-5 text-[10px] text-muted-foreground" style={{ left: `${pctHigh}%`, transform: "translateX(-50%)" }}>{high.toFixed(2)}</div>
    </div>
  );
}

// ── Productivity helpers ──────────────────────────────────────────────────────

function pmRatio(pm: ProductivityMonth): number | null {
  if (!pm.productive_hours || !pm.billable_tests || pm.billable_tests === 0) return null;
  return pm.productive_hours / pm.billable_tests;
}

function pmOtPct(pm: ProductivityMonth): number | null {
  if (!pm.overtime_hours || !pm.productive_hours) return null;
  return (pm.overtime_hours / pm.productive_hours) * 100;
}

function pmProductivePct(pm: ProductivityMonth): number | null {
  if (!pm.productive_hours || pm.non_productive_hours == null) return null;
  return (pm.productive_hours / (pm.productive_hours + pm.non_productive_hours)) * 100;
}

// ── Staffing helpers ──────────────────────────────────────────────────────────

function hourLabel(h: number): string {
  if (h === 0) return "12-1 AM";
  if (h < 12) return `${h}-${h + 1} AM`;
  if (h === 12) return "12-1 PM";
  return `${h - 12}-${h - 11} PM`;
}

function DemoHeatmap({ data, title }: { data: number[][]; title: string }) {
  const maxVal = Math.max(1, ...data.flat());
  return (
    <div>
      <h4 className="text-sm font-semibold mb-2">{title}</h4>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left border" style={{ backgroundColor: "#01696F10" }}>Hour</th>
              {DAY_NAMES.map(d => <th key={d} className="px-2 py-1 text-center border min-w-[50px]" style={{ backgroundColor: "#01696F10" }}>{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 24 }, (_, h) => (
              <tr key={h}>
                <td className="px-2 py-0.5 border text-muted-foreground whitespace-nowrap">{hourLabel(h)}</td>
                {DAY_NAMES.map((_, d) => {
                  const val = data[h]?.[d] ?? 0;
                  const intensity = val / maxVal;
                  const bg = `rgba(1, 105, 111, ${intensity * 0.8})`;
                  return (
                    <td key={d} className="border text-center px-2 py-0.5" style={{ backgroundColor: bg, color: intensity > 0.5 ? "white" : "inherit" }}>
                      {val > 0 ? val.toFixed(0) : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Interactive Productivity Calculator
// ══════════════════════════════════════════════════════════════════════════════

function CalculatorSection() {
  const [productiveHours, setProductiveHours] = useState<string>("");
  const [billableTests, setBillableTests] = useState<string>("");
  const [facilityType, setFacilityType] = useState<string>("community");
  const [hourlyRate, setHourlyRate] = useState<string>("35");
  const [estimateFromFTE, setEstimateFromFTE] = useState(false);
  const [ftes, setFtes] = useState<string>("");
  const [productivePct, setProductivePct] = useState<number>(85);

  const estimatedHours = useMemo(() => {
    if (!estimateFromFTE || !ftes) return null;
    return parseFloat(ftes) * 2080 / 12 * (productivePct / 100);
  }, [estimateFromFTE, ftes, productivePct]);

  const effectiveHours = estimateFromFTE ? estimatedHours : (productiveHours ? parseFloat(productiveHours) : null);
  const tests = billableTests ? parseInt(billableTests) : null;

  const result = useMemo(() => {
    if (!effectiveHours || !tests || tests === 0) return null;
    const ratio = effectiveHours / tests;
    const benchmark = BENCHMARKS[facilityType];
    const midpoint = benchmark.low && benchmark.high ? (benchmark.low + benchmark.high) / 2 : null;
    const band = benchmark.low && benchmark.high ? getBand(ratio, benchmark.low, benchmark.high) : null;
    const targetHours = midpoint ? midpoint * tests : null;
    const hoursDiff = targetHours ? effectiveHours - targetHours : null;
    const fteDiff = hoursDiff ? hoursDiff / (2080 / 12 * 0.85) : null;
    const rate = parseFloat(hourlyRate) || 35;
    const annualSavings = hoursDiff ? Math.abs(hoursDiff) * 12 * rate : null;
    const isOutperforming = hoursDiff != null && hoursDiff < 0;
    return { ratio, band, midpoint, targetHours, hoursDiff, fteDiff, annualSavings, isOutperforming };
  }, [effectiveHours, tests, facilityType, hourlyRate]);

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg" style={{ color: "#01696F" }}>Your Numbers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label>Facility Type</Label>
            <Select value={facilityType} onValueChange={setFacilityType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(BENCHMARKS).map(([key, b]) => (
                  <SelectItem key={key} value={key}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={estimateFromFTE} onCheckedChange={setEstimateFromFTE} />
            <Label className="text-sm cursor-pointer" onClick={() => setEstimateFromFTE(!estimateFromFTE)}>
              Estimate from FTEs
            </Label>
          </div>

          {estimateFromFTE ? (
            <div className="space-y-4 p-4 rounded-lg bg-muted/50">
              <div className="space-y-1.5">
                <Label>Number of FTEs</Label>
                <Input type="number" placeholder="e.g. 15" value={ftes} onChange={e => setFtes(e.target.value)} min={0} step={0.5} />
              </div>
              <div className="space-y-1.5">
                <Label>Productive % ({productivePct}%)</Label>
                <input type="range" min={70} max={95} value={productivePct} onChange={e => setProductivePct(parseInt(e.target.value))} className="w-full accent-[#01696F]" />
                <div className="flex justify-between text-xs text-muted-foreground"><span>70%</span><span>95%</span></div>
              </div>
              {estimatedHours != null && (
                <div className="text-sm p-2 rounded bg-background border">
                  Estimated productive hours/month: <span className="font-bold">{estimatedHours.toFixed(0)}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Monthly Productive Hours</Label>
              <Input type="number" placeholder="e.g. 5200" value={productiveHours} onChange={e => setProductiveHours(e.target.value)} min={0} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Monthly Billable Tests</Label>
            <Input type="number" placeholder="e.g. 36000" value={billableTests} onChange={e => setBillableTests(e.target.value)} min={0} />
          </div>

          <div className="space-y-1.5">
            <Label>Average Hourly Labor Rate ($)</Label>
            <Input type="number" placeholder="35" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} min={0} step={0.5} />
          </div>
        </CardContent>
      </Card>

      <Card className={result ? "border-2" : ""} style={result ? { borderColor: "#01696F40" } : {}}>
        <CardHeader>
          <CardTitle className="text-lg" style={{ color: "#01696F" }}>Your Scorecard</CardTitle>
        </CardHeader>
        <CardContent>
          {!result ? (
            <div className="text-center text-muted-foreground py-12">
              <Calculator size={40} className="mx-auto mb-3 opacity-50" />
              <p>Enter your numbers to see your productivity scorecard</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="text-center p-6 rounded-xl" style={{ backgroundColor: "#01696F10" }}>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Productivity Ratio</div>
                <div className="text-5xl font-bold font-mono" style={{
                  color: result.band === "green" ? "#16a34a" : result.band === "yellow" ? "#ca8a04" : "#dc2626"
                }}>
                  {result.ratio.toFixed(3)}
                </div>
                <div className="text-sm text-muted-foreground mt-1">productive hours per billable test</div>
              </div>

              {facilityType !== "other" && BENCHMARKS[facilityType] && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    Benchmark: {BENCHMARKS[facilityType].label}
                  </div>
                  <GaugeBar ratio={result.ratio} low={BENCHMARKS[facilityType].low} high={BENCHMARKS[facilityType].high} />
                  <div className="flex items-center gap-2 mt-6 text-xs">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Efficient</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" /> Approaching Target</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Overstaffed</span>
                  </div>
                </div>
              )}

              {facilityType === "other" && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">All benchmark ranges:</div>
                  {Object.entries(BENCHMARKS).filter(([k]) => k !== "other").map(([key, b]) => (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{b.label.split("(")[0].trim()}</span>
                      <span className="font-mono">{b.low.toFixed(2)} - {b.high.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}

              {result.targetHours != null && result.hoursDiff != null && (
                <div className="space-y-3 pt-3 border-t">
                  {result.isOutperforming ? (
                    <>
                      <div className="flex items-start gap-3">
                        <TrendingDown size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                        <div className="text-sm">
                          <strong className="text-emerald-600">Outperforming benchmark.</strong> Your lab uses{" "}
                          <strong>{Math.abs(result.hoursDiff).toFixed(0)}</strong> fewer productive hours/month
                          than the <strong>{result.midpoint?.toFixed(3)}</strong> midpoint
                          {result.fteDiff ? <>, equivalent to roughly <strong>{Math.abs(result.fteDiff).toFixed(1)}</strong> FTEs of efficiency</> : null}.
                        </div>
                      </div>
                      {result.annualSavings != null && result.annualSavings > 0 && (
                        <div className="flex items-start gap-3">
                          <DollarSign size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                          <div className="text-sm">
                            Your efficiency advantage: <strong className="text-lg text-emerald-600">${result.annualSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr</strong> in labor savings vs. benchmark
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-start gap-3">
                        <TrendingDown size={18} className="mt-0.5 shrink-0" style={{ color: "#01696F" }} />
                        <div className="text-sm">
                          At a <strong>{result.midpoint?.toFixed(3)}</strong> ratio, your lab would need{" "}
                          <strong>{Math.abs(result.hoursDiff).toFixed(0)}</strong> fewer productive hours/month
                          {result.fteDiff ? <>, roughly <strong>{Math.abs(result.fteDiff).toFixed(1)}</strong> FTEs</> : null}.
                        </div>
                      </div>
                      {result.annualSavings != null && result.annualSavings > 0 && (
                        <div className="flex items-start gap-3">
                          <DollarSign size={18} className="mt-0.5 shrink-0" style={{ color: "#01696F" }} />
                          <div className="text-sm">
                            Annual savings potential: <strong className="text-lg">${result.annualSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr</strong>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Productivity Tracker (read-only, Riverside data)
// ══════════════════════════════════════════════════════════════════════════════

function TrackerSection() {
  const [months, setMonths] = useState<ProductivityMonth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/demo/productivity-months`)
      .then(r => r.ok ? r.json() : [])
      .then(setMonths)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sorted = useMemo(() =>
    [...months].sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month)),
    [months]
  );

  const currentMonth = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const currentRatio = currentMonth ? pmRatio(currentMonth) : null;

  const ytdData = useMemo(() => {
    const cy = currentMonth?.year ?? 2026;
    return sorted.filter(m => m.year === cy);
  }, [sorted, currentMonth]);

  const ytdAvg = useMemo(() => {
    const vals = ytdData.map(m => pmRatio(m)).filter((v): v is number => v != null);
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }, [ytdData]);

  const yoyChange = useMemo(() => {
    if (!currentMonth) return null;
    const cy = currentMonth.year;
    const lastYearData = sorted.filter(m => m.year === cy - 1);
    if (lastYearData.length === 0) return null;
    const lyVals = lastYearData.map(m => pmRatio(m)).filter((v): v is number => v != null);
    const lyAvg = lyVals.length > 0 ? lyVals.reduce((s, v) => s + v, 0) / lyVals.length : null;
    if (!lyAvg || !ytdAvg) return null;
    return ((ytdAvg - lyAvg) / lyAvg) * 100;
  }, [sorted, currentMonth, ytdAvg]);

  const currentOT = currentMonth ? pmOtPct(currentMonth) : null;

  const chartData = useMemo(() => {
    return sorted.map(m => ({
      label: `${MONTH_NAMES[m.month]} ${m.year}`,
      ratio: pmRatio(m),
    }));
  }, [sorted]);

  const facilityBenchmark = currentMonth ? BENCHMARKS[currentMonth.facility_type] : BENCHMARKS.community;

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading productivity data...</div>;
  }

  if (months.length === 0) {
    return <div className="text-center py-12 text-muted-foreground">No demo productivity data available.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Facility banner */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ backgroundColor: "#01696F10" }}>
        <Activity size={18} style={{ color: "#01696F" }} />
        <div>
          <div className="font-semibold text-sm" style={{ color: "#01696F" }}>Riverside Regional Medical Center</div>
          <div className="text-xs text-muted-foreground">15 months of productivity data, {sorted[0] && `${FULL_MONTHS[sorted[0].month]} ${sorted[0].year}`} to {currentMonth && `${FULL_MONTHS[currentMonth.month]} ${currentMonth.year}`}</div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Current Ratio</div>
            <div className="text-3xl font-bold font-mono mt-1" style={{ color: "#01696F" }}>
              {currentRatio != null ? currentRatio.toFixed(3) : "-"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {currentMonth ? `${FULL_MONTHS[currentMonth.month]} ${currentMonth.year}` : "No data"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">YTD Average</div>
            <div className="text-3xl font-bold font-mono mt-1" style={{ color: "#01696F" }}>
              {ytdAvg != null ? ytdAvg.toFixed(3) : "-"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{currentMonth?.year ?? ""} year-to-date</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Year-over-Year</div>
            <div className="text-3xl font-bold font-mono mt-1 flex items-center gap-1" style={{
              color: yoyChange != null && yoyChange < 0 ? "#16a34a" : yoyChange != null && yoyChange > 0 ? "#dc2626" : "#01696F"
            }}>
              {yoyChange != null ? (
                <>{yoyChange < 0 ? <TrendingDown size={18} /> : <TrendingUp size={18} />}{Math.abs(yoyChange).toFixed(1)}%</>
              ) : "-"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {yoyChange != null && yoyChange < 0 ? "Improving (lower is better)" : yoyChange != null ? "Increasing" : "Prior year data needed"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">OT %</div>
            <div className="text-3xl font-bold font-mono mt-1" style={{ color: "#01696F" }}>
              {currentOT != null ? currentOT.toFixed(1) + "%" : "-"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Overtime as % of productive</div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      {chartData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Productivity Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 10, right: 30, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                <RechartsTooltip formatter={(v: number) => v?.toFixed(4)} />
                <Legend />
                {facilityBenchmark && (
                  <ReferenceArea y1={facilityBenchmark.low} y2={facilityBenchmark.high} fill="#01696F" fillOpacity={0.08} label={{ value: "Benchmark", fontSize: 10, fill: "#01696F" }} />
                )}
                <Line type="monotone" dataKey="ratio" stroke="#01696F" strokeWidth={2} dot={{ r: 4 }} name="Productivity Ratio" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ backgroundColor: "#01696F10" }}>
                  <th className="text-left px-3 py-2 font-medium">Period</th>
                  <th className="text-right px-3 py-2 font-medium">Billable Tests</th>
                  <th className="text-right px-3 py-2 font-medium">Prod. Hours</th>
                  <th className="text-right px-3 py-2 font-medium">Ratio</th>
                  <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">OT %</th>
                  <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Prod. %</th>
                  <th className="text-right px-3 py-2 font-medium hidden md:table-cell">FTEs</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((pm, i) => {
                  const r = pmRatio(pm);
                  const ot = pmOtPct(pm);
                  const pp = pmProductivePct(pm);
                  return (
                    <tr key={pm.id} className={`border-b ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                      <td className="px-3 py-2 font-medium">{FULL_MONTHS[pm.month]} {pm.year}</td>
                      <td className="px-3 py-2 text-right font-mono">{pm.billable_tests?.toLocaleString() ?? "-"}</td>
                      <td className="px-3 py-2 text-right font-mono">{pm.productive_hours?.toLocaleString() ?? "-"}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold" style={{ color: "#01696F" }}>{r != null ? r.toFixed(4) : "-"}</td>
                      <td className="px-3 py-2 text-right font-mono hidden sm:table-cell">{ot != null ? ot.toFixed(1) + "%" : "-"}</td>
                      <td className="px-3 py-2 text-right font-mono hidden sm:table-cell">{pp != null ? pp.toFixed(1) + "%" : "-"}</td>
                      <td className="px-3 py-2 text-right font-mono hidden md:table-cell">{pm.total_ftes ?? "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Staffing Analyzer (read-only, Riverside data)
// ══════════════════════════════════════════════════════════════════════════════

function StaffingSection() {
  const [study, setStudy] = useState<StaffingStudy | null>(null);
  const [data, setData] = useState<HourlyDataItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/demo/staffing-study`)
      .then(r => r.ok ? r.json() : null)
      .then(result => {
        if (result) {
          setStudy(result.study);
          setData(result.data || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const avgReceived = useMemo(() => {
    const grid: number[][] = Array.from({ length: 24 }, () => Array(7).fill(0));
    const counts: number[][] = Array.from({ length: 24 }, () => Array(7).fill(0));
    for (const d of data) {
      if (d.metric_type === "received") {
        grid[d.hour_slot][d.day_of_week] += d.value;
        counts[d.hour_slot][d.day_of_week]++;
      }
    }
    return grid.map((row, h) => row.map((val, di) => counts[h][di] > 0 ? val / counts[h][di] : 0));
  }, [data]);

  const avgVerified = useMemo(() => {
    const grid: number[][] = Array.from({ length: 24 }, () => Array(7).fill(0));
    const counts: number[][] = Array.from({ length: 24 }, () => Array(7).fill(0));
    for (const d of data) {
      if (d.metric_type === "verified") {
        grid[d.hour_slot][d.day_of_week] += d.value;
        counts[d.hour_slot][d.day_of_week]++;
      }
    }
    return grid.map((row, h) => row.map((val, di) => counts[h][di] > 0 ? val / counts[h][di] : 0));
  }, [data]);

  const staffGrid = useMemo(() => {
    const grid: number[][] = Array.from({ length: 24 }, () => Array(7).fill(0));
    for (const d of data) {
      if (d.metric_type === "staffing") {
        grid[d.hour_slot][d.day_of_week] = d.value;
      }
    }
    return grid;
  }, [data]);

  const stats = useMemo(() => {
    const totalWeekly = avgReceived.flat().reduce((s, v) => s + v, 0);
    let peakHour = 0, peakVal = 0, lowHour = 0, lowVal = Infinity;
    const hourTotals = Array(24).fill(0);
    const dayTotals = Array(7).fill(0);
    for (let h = 0; h < 24; h++) {
      for (let d = 0; d < 7; d++) {
        hourTotals[h] += avgReceived[h][d];
        dayTotals[d] += avgReceived[h][d];
      }
      if (hourTotals[h] > peakVal) { peakVal = hourTotals[h]; peakHour = h; }
      if (hourTotals[h] < lowVal && hourTotals[h] > 0) { lowVal = hourTotals[h]; lowHour = h; }
    }
    const peakDay = dayTotals.indexOf(Math.max(...dayTotals));
    const avgDaily = totalWeekly / 7;
    return { totalWeekly, peakHour, lowHour, peakDay, avgDaily };
  }, [avgReceived]);

  const recommended = useMemo(() => {
    let bestRatio = Infinity;
    for (let h = 0; h < 24; h++) {
      for (let d = 0; d < 7; d++) {
        const staff = staffGrid[h][d];
        const verified = avgVerified[h][d];
        if (staff > 0 && verified > 0) {
          const r = verified / staff;
          if (r > 0 && r < bestRatio) bestRatio = r;
        }
      }
    }
    const target = bestRatio < Infinity ? bestRatio : 15;
    return avgReceived.map(row => row.map(val => val > 0 ? Math.ceil(val / target) : 0));
  }, [avgReceived, avgVerified, staffGrid]);

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading staffing data...</div>;
  }

  if (!study) {
    return <div className="text-center py-12 text-muted-foreground">No demo staffing data available.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Study banner */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ backgroundColor: "#01696F10" }}>
        <Grid3X3 size={18} style={{ color: "#01696F" }} />
        <div>
          <div className="font-semibold text-sm" style={{ color: "#01696F" }}>{study.name}</div>
          <div className="text-xs text-muted-foreground">{study.department} - Riverside Regional Medical Center</div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="pt-4 text-center">
          <div className="text-xs text-muted-foreground">Weekly Volume</div>
          <div className="text-xl font-bold font-mono" style={{ color: "#01696F" }}>{stats.totalWeekly.toFixed(0)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-xs text-muted-foreground">Peak Hour</div>
          <div className="text-xl font-bold font-mono" style={{ color: "#01696F" }}>{hourLabel(stats.peakHour)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-xs text-muted-foreground">Lowest Hour</div>
          <div className="text-xl font-bold font-mono" style={{ color: "#01696F" }}>{hourLabel(stats.lowHour)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-xs text-muted-foreground">Peak Day</div>
          <div className="text-xl font-bold font-mono" style={{ color: "#01696F" }}>{DAY_NAMES[stats.peakDay]}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-xs text-muted-foreground">Avg Daily</div>
          <div className="text-xl font-bold font-mono" style={{ color: "#01696F" }}>{stats.avgDaily.toFixed(0)}</div>
        </CardContent></Card>
      </div>

      {/* Heatmaps */}
      <DemoHeatmap data={avgReceived} title="Average Samples Received (Heatmap)" />
      <DemoHeatmap data={avgVerified} title="Average Samples Verified (Heatmap)" />

      {/* Staffing vs Demand */}
      <div>
        <h4 className="text-sm font-semibold mb-2">Staffing vs Demand Comparison</h4>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left border" style={{ backgroundColor: "#01696F10" }}>Hour</th>
                {DAY_NAMES.map(d => (
                  <th key={d} className="px-2 py-1 text-center border min-w-[80px]" style={{ backgroundColor: "#01696F10" }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 24 }, (_, h) => (
                <tr key={h}>
                  <td className="px-2 py-0.5 border text-muted-foreground whitespace-nowrap">{hourLabel(h)}</td>
                  {DAY_NAMES.map((_, d) => {
                    const verified = avgVerified[h][d];
                    const staff = staffGrid[h][d];
                    const perStaff = staff > 0 ? (verified / staff).toFixed(1) : "-";
                    let bg = "";
                    if (staff > 0 && verified > 0) {
                      const r = verified / staff;
                      if (r > 20) bg = "bg-red-100 dark:bg-red-900/30";
                      else if (r < 5 && staff > 1) bg = "bg-blue-100 dark:bg-blue-900/30";
                    }
                    return (
                      <td key={d} className={`px-1 py-0.5 border text-center ${bg}`}>
                        <div className="text-[10px] text-muted-foreground">{verified > 0 ? verified.toFixed(0) : "-"} / {staff || "-"}</div>
                        <div className="font-medium">{perStaff}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-4 mt-2 text-xs">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border" /> Understaffed (high demand)</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-100 border" /> Overstaffed (low demand)</span>
        </div>
      </div>

      {/* Recommended Staffing */}
      <div>
        <h4 className="text-sm font-semibold mb-2">Recommended Staffing Grid</h4>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left border" style={{ backgroundColor: "#01696F10" }}>Hour</th>
                {DAY_NAMES.map(d => <th key={d} className="px-2 py-1 text-center border min-w-[50px]" style={{ backgroundColor: "#01696F10" }}>{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 24 }, (_, h) => (
                <tr key={h}>
                  <td className="px-2 py-0.5 border text-muted-foreground whitespace-nowrap">{hourLabel(h)}</td>
                  {DAY_NAMES.map((_, d) => {
                    const rec = recommended[h][d];
                    const curr = staffGrid[h][d];
                    const diff = rec - curr;
                    return (
                      <td key={d} className={`border text-center px-2 py-0.5 ${diff > 0 ? "bg-red-50 dark:bg-red-900/20" : diff < 0 ? "bg-emerald-50 dark:bg-emerald-900/20" : ""}`}>
                        {rec > 0 ? rec : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN DEMO PAGE
// ══════════════════════════════════════════════════════════════════════════════

export default function DemoPage() {
  const [activeSection, setActiveSection] = useState("calculator");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id.replace("section-", "");
            setActiveSection(id);
          }
        }
      },
      { threshold: 0.3 }
    );

    for (const s of SECTIONS) {
      const el = document.getElementById(`section-${s.id}`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen">
      <SectionNav active={activeSection} />

      {/* Hero Section */}
      <section className="relative py-16 sm:py-24 px-4 text-center overflow-hidden" style={{ backgroundColor: "#01696F" }}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 50%, white 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 text-sm font-medium px-4 py-1.5 rounded-full mb-6 bg-white/15 text-white/90">
            <BarChart3 size={14} />
            Interactive Live Demo
          </div>
          <h1 className="font-serif text-3xl sm:text-5xl font-bold text-white mb-4">
            See VeritaOps{"\u2122"} in Action
          </h1>
          <p className="text-lg sm:text-xl text-white/80 max-w-2xl mx-auto mb-8">
            Built by a lab operations consultant. Designed for labs like yours.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => document.getElementById(`section-${s.id}`)?.scrollIntoView({ behavior: "smooth" })}
                className="px-4 py-2 rounded-full text-sm font-medium bg-white/15 text-white hover:bg-white/25 transition-colors"
              >
                {s.id === "calculator" && <Calculator size={14} className="inline mr-1.5" />}
                {s.id === "tracker" && <BarChart3 size={14} className="inline mr-1.5" />}
                {s.id === "staffing" && <Grid3X3 size={14} className="inline mr-1.5" />}
                {s.label}
              </button>
            ))}
          </div>
          <div className="mt-8">
            <ChevronDown size={24} className="mx-auto text-white/50 animate-bounce" />
          </div>
        </div>
      </section>

      {/* Mobile Section Nav */}
      <div className="sticky top-0 z-30 md:hidden bg-background/95 backdrop-blur border-b">
        <div className="flex justify-center gap-1 px-4 py-2">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => document.getElementById(`section-${s.id}`)?.scrollIntoView({ behavior: "smooth" })}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${activeSection === s.id ? "bg-[#01696F] text-white" : "bg-muted text-muted-foreground"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Section 1: Calculator */}
      <section id="section-calculator" className="py-12 sm:py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 text-sm font-medium px-3 py-1 rounded-full mb-4" style={{ backgroundColor: "#01696F15", color: "#01696F" }}>
              <Calculator size={14} />
              Module 1: Productivity Calculator
            </div>
            <h2 className="font-serif text-2xl sm:text-3xl font-bold mb-3">Instant Lab Productivity Scorecard</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Enter your lab's numbers to instantly benchmark against industry standards. Try it now, no account needed.
            </p>
          </div>
          <CalculatorSection />
        </div>
      </section>

      <div className="h-px mx-auto max-w-5xl" style={{ background: "linear-gradient(to right, transparent, #01696F30, transparent)" }} />

      {/* Section 2: Tracker */}
      <section id="section-tracker" className="py-12 sm:py-16 px-4 bg-muted/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 text-sm font-medium px-3 py-1 rounded-full mb-4" style={{ backgroundColor: "#01696F15", color: "#01696F" }}>
              <BarChart3 size={14} />
              Module 2: Productivity Tracker
            </div>
            <h2 className="font-serif text-2xl sm:text-3xl font-bold mb-3">Track Productivity Over Time</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Real demo data from Riverside Regional Medical Center showing 15 months of improvement, from 0.191 down to 0.144.
            </p>
          </div>
          <TrackerSection />
        </div>
      </section>

      <div className="h-px mx-auto max-w-5xl" style={{ background: "linear-gradient(to right, transparent, #01696F30, transparent)" }} />

      {/* Section 3: Staffing */}
      <section id="section-staffing" className="py-12 sm:py-16 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 text-sm font-medium px-3 py-1 rounded-full mb-4" style={{ backgroundColor: "#01696F15", color: "#01696F" }}>
              <Grid3X3 size={14} />
              Module 3: By-Hour Staffing Analyzer
            </div>
            <h2 className="font-serif text-2xl sm:text-3xl font-bold mb-3">Optimize Staffing by the Hour</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              See the full analysis: heatmaps, staffing-vs-demand grids, and recommended staffing levels.
            </p>
          </div>
          <StaffingSection />
        </div>
      </section>


    </div>
  );
}
