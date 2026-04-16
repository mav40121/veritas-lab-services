import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Calculator, TrendingDown, DollarSign, ArrowRight, Users } from "lucide-react";

const BENCHMARKS: Record<string, { label: string; low: number; high: number }> = {
  community: { label: "Community Hospital (200K-500K billables/yr)", low: 0.15, high: 0.22 },
  trauma: { label: "Large Trauma Center (750K-1.5M billables/yr)", low: 0.09, high: 0.13 },
  reference: { label: "Reference Lab (2M+ billables/yr)", low: 0.06, high: 0.09 },
  other: { label: "Other/Unknown", low: 0, high: 0 },
};

function getBand(ratio: number, low: number, high: number): "green" | "yellow" | "red" {
  // Lower ratio = more efficient. Below range = outperforming. Above range = overstaffed.
  if (ratio >= low && ratio <= high) return "green";
  if (ratio < low) return "green"; // below range = outperforming benchmark
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
      {/* Bar background */}
      <div className="absolute inset-0 rounded-full bg-muted overflow-hidden">
        {/* Green zone left (below range = outperforming) */}
        <div className="absolute inset-y-0 left-0 bg-emerald-200 dark:bg-emerald-900/40" style={{ width: `${Math.max(0, pctLow)}%` }} />
        {/* Green zone */}
        <div className="absolute inset-y-0 bg-emerald-200 dark:bg-emerald-900/40" style={{ left: `${pctLow}%`, width: `${pctHigh - pctLow}%` }} />
        {/* Yellow zone right */}
        <div className="absolute inset-y-0 bg-yellow-200 dark:bg-yellow-900/30" style={{ left: `${pctHigh}%`, width: "5%" }} />
        {/* Red zone right */}
        <div className="absolute inset-y-0 bg-red-200 dark:bg-red-900/30" style={{ left: `${pctHigh + 5}%`, right: 0 }} />
      </div>
      {/* Marker */}
      <div className="absolute top-0 bottom-0 flex flex-col items-center" style={{ left: `${pctRatio}%`, transform: "translateX(-50%)" }}>
        <div className="w-1 flex-1 rounded-full" style={{ backgroundColor: markerColor }} />
        <div className="text-xs font-bold mt-1" style={{ color: markerColor }}>{ratio.toFixed(3)}</div>
      </div>
      {/* Labels */}
      <div className="absolute -bottom-5 text-[10px] text-muted-foreground" style={{ left: `${pctLow}%`, transform: "translateX(-50%)" }}>{low.toFixed(2)}</div>
      <div className="absolute -bottom-5 text-[10px] text-muted-foreground" style={{ left: `${pctHigh}%`, transform: "translateX(-50%)" }}>{high.toFixed(2)}</div>
    </div>
  );
}

export default function ProductivityCalculatorPage() {
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
    // hoursDiff > 0 means you use MORE hours than benchmark (overstaffed, savings opportunity)
    // hoursDiff < 0 means you use FEWER hours than benchmark (outperforming)
    const annualSavings = hoursDiff ? Math.abs(hoursDiff) * 12 * rate : null;
    const isOutperforming = hoursDiff != null && hoursDiff < 0;

    return { ratio, band, midpoint, targetHours, hoursDiff, fteDiff, annualSavings, isOutperforming };
  }, [effectiveHours, tests, facilityType, hourlyRate]);

  return (
    <div className="min-h-[80vh] py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 text-sm font-medium px-3 py-1 rounded-full mb-4" style={{ backgroundColor: "#01696F15", color: "#01696F" }}>
            <Calculator size={14} />
            VeritaBench{"\u2122"} Quick Calculator
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold mb-3">Lab Productivity Scorecard</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Enter two numbers to instantly benchmark your lab's productivity against industry standards.
            No account required.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Input Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg" style={{ color: "#01696F" }}>Your Numbers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Facility Type */}
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

              {/* Toggle: Estimate from FTEs */}
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

          {/* Results Card */}
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
                  {/* Big Ratio Display */}
                  <div className="text-center p-6 rounded-xl" style={{ backgroundColor: "#01696F10" }}>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Productivity Ratio</div>
                    <div className="text-5xl font-bold font-mono" style={{
                      color: result.band === "green" ? "#16a34a" : result.band === "yellow" ? "#ca8a04" : "#dc2626"
                    }}>
                      {result.ratio.toFixed(3)}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      productive hours per billable test
                    </div>
                  </div>

                  {/* Gauge */}
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

                  {/* Projections */}
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

                  {/* CTA */}
                  <div className="p-4 rounded-lg text-center" style={{ backgroundColor: "#01696F10" }}>
                    <p className="text-sm font-medium mb-3">Track this over time with VeritaAssure{"\u2122"}</p>
                    <Button asChild style={{ backgroundColor: "#01696F" }} className="hover:opacity-90">
                      <Link href="/pricing">
                        <Users size={14} className="mr-2" />
                        View Plans
                        <ArrowRight size={14} className="ml-2" />
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
