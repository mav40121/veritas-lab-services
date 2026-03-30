import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CheckCircle2, AlertTriangle, MapPin, ClipboardList, FlaskConical,
  ArrowRight, Shield, Users, Award,
  ChevronDown, ChevronUp, Activity, Info, FileText, Download
} from "lucide-react";
import { API_BASE } from "@/lib/queryClient";
import { SCAN_ITEMS, DOMAINS, DOMAIN_COLORS, STATUS_COLORS, type ScanStatus } from "@/lib/veritaScanData";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, ReferenceLine, Legend, Tooltip as RechartsTooltip
} from "recharts";

interface DemoData {
  maps: any[];
  scans: any[];
  studies: any[];
  cumsumTrackers: any[];
}

interface CompetencyData {
  programs: any[];
  employees: any[];
  assessments: any[];
}

export default function DemoLabPage() {
  const [data, setData] = useState<DemoData | null>(null);
  const [competencyData, setCompetencyData] = useState<CompetencyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("veritacheck");
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [expandedStudy, setExpandedStudy] = useState<number | null>(null);
  const [showFullScan, setShowFullScan] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/demo/data`).then((r) => r.json()),
      fetch(`${API_BASE}/api/demo/competency`).then((r) => r.json()).catch(() => null),
    ]).then(([demoData, compData]) => {
      setData(demoData);
      setCompetencyData(compData);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      next.has(domain) ? next.delete(domain) : next.add(domain);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading demo lab...</div>
      </div>
    );
  }

  const map = data?.maps?.[0];
  const scan = data?.scans?.[0];
  const studies = data?.studies || [];
  const cumsumTrackers = data?.cumsumTrackers || [];

  // Build scan item map
  const scanItemMap: Record<number, any> = {};
  if (scan?.items) {
    for (const item of scan.items) {
      scanItemMap[item.item_id] = item;
    }
  }

  // Scan stats
  const totalItems = 168;
  const assessedItems = Object.values(scanItemMap).filter((i: any) => i.status !== "Not Assessed").length;
  const compliantItems = Object.values(scanItemMap).filter((i: any) => i.status === "Compliant").length;
  const readinessPct = Math.round((compliantItems / totalItems) * 100);
  const readinessColor = readinessPct >= 80 ? "text-emerald-500" : readinessPct >= 50 ? "text-amber-500" : "text-red-500";
  const readinessBg = readinessPct >= 80 ? "bg-emerald-500" : readinessPct >= 50 ? "bg-amber-500" : "bg-red-500";
  const remainingItems = totalItems - compliantItems;

  const tabConfig = [
    { id: "veritacheck", label: "VeritaCheck\u2122", icon: FlaskConical },
    { id: "veritamap", label: "VeritaMap\u2122", icon: MapPin },
    { id: "veritascan", label: "VeritaScan\u2122", icon: ClipboardList },
    { id: "veritacomp", label: "VeritaComp\u2122", icon: Award },
    { id: "veritastaff", label: "VeritaStaff\u2122", icon: Users },
  ];

  const typeLabel: Record<string, string> = {
    method_comparison: "Method Comparison",
    cal_ver: "Calibration Verification",
    precision: "Accuracy & Precision",
    lot_to_lot: "Lot-to-Lot",
    pt_coag: "PT/Coag",
    qc_range: "QC Range",
  };

  // Compute study statistics for inline results
  function computeStudyStats(study: any) {
    const dp = study.data_points ? JSON.parse(study.data_points) : [];
    const instruments = study.instruments ? JSON.parse(study.instruments) : [];
    const primary = instruments[0];
    const comparison = instruments[1];
    if (!primary || !comparison || dp.length === 0) return null;

    const xs = dp.map((p: any) => p.instrumentValues?.[primary] ?? 0);
    const ys = dp.map((p: any) => p.instrumentValues?.[comparison] ?? 0);
    const n = xs.length;
    if (n < 2) return null;

    const xMean = xs.reduce((a: number, b: number) => a + b, 0) / n;
    const yMean = ys.reduce((a: number, b: number) => a + b, 0) / n;
    const sxx = xs.reduce((s: number, x: number) => s + (x - xMean) ** 2, 0);
    const syy = ys.reduce((s: number, y: number) => s + (y - yMean) ** 2, 0);
    const sxy = xs.reduce((s: number, x: number, i: number) => s + (x - xMean) * (ys[i] - yMean), 0);

    const slope = sxx === 0 ? 1 : sxy / sxx;
    const intercept = yMean - slope * xMean;
    const rSquared = sxx === 0 || syy === 0 ? 1 : (sxy ** 2) / (sxx * syy);

    const biases = xs.map((x: number, i: number) => ys[i] - x);
    const meanBias = biases.reduce((a: number, b: number) => a + b, 0) / n;
    const pctDiffs = xs.map((x: number, i: number) => x === 0 ? 0 : ((ys[i] - x) / x) * 100);
    const meanPctDiff = pctDiffs.reduce((a: number, b: number) => a + b, 0) / n;

    const tea = study.clia_allowable_error;

    const rows = dp.map((p: any, i: number) => {
      const pVal = p.instrumentValues?.[primary] ?? 0;
      const cVal = p.instrumentValues?.[comparison] ?? 0;
      const bias = cVal - pVal;
      const pctDiff = pVal === 0 ? 0 : ((cVal - pVal) / pVal) * 100;
      const pass = Math.abs(bias) <= tea;
      return { level: i + 1, primary: pVal, comparison: cVal, bias: Math.round(bias * 1000) / 1000, pctDiff: Math.round(pctDiff * 100) / 100, pass };
    });

    const scatterData = dp.map((p: any) => ({
      x: p.instrumentValues?.[primary] ?? 0,
      y: p.instrumentValues?.[comparison] ?? 0,
    }));

    return {
      n, slope, intercept, rSquared, meanBias, meanPctDiff, tea,
      rows, scatterData, primary, comparison,
      allPass: rows.every((r: any) => r.pass),
    };
  }

  function downloadStudyPdf(studyId: number) {
    window.open(`${API_BASE}/api/demo/studies/${studyId}/pdf`, "_blank");
  }

  function downloadMapExcel() {
    window.open(`${API_BASE}/api/demo/map/excel`, "_blank");
  }

  function downloadCompetencyPdf() {
    window.open(`${API_BASE}/api/demo/competency/pdf`, "_blank");
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        {/* STICKY DEMO BANNER */}
        <div style={{ background: "#006064" }} className="text-white sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Shield size={16} />
              VeritaAssure&#8482; Live Demo - Riverside Regional Medical Center | This is a fully interactive demo with real data.
            </div>
            <Button asChild size="sm" className="bg-white text-[#006064] hover:bg-white/90 font-semibold border-0">
              <Link href="/login">Start Free Trial <ArrowRight size={14} className="ml-1" /></Link>
            </Button>
          </div>
        </div>

        {/* PAGE HEADER */}
        <div className="border-b bg-card">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 text-center">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">See VeritaAssure&#8482; in Action</h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl mx-auto">
              Explore a live lab environment. Every chart, report, and result below is generated by the actual VeritaAssure system.
            </p>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {/* TAB NAVIGATION */}
          <div className="flex flex-wrap gap-2 mb-6 border-b border-border">
            {tabConfig.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    relative flex items-center gap-1.5 px-4 py-3 rounded-t-lg text-sm font-medium transition-all
                    ${isActive
                      ? "bg-[#006064] text-white shadow-md -mb-px z-10"
                      : "bg-card text-muted-foreground border border-b-0 border-border hover:bg-secondary/60 hover:text-foreground"
                    }
                  `}
                >
                  <Icon size={14} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* ═══════════════ TAB 1: VERITACHECK ═══════════════ */}
          {activeTab === "veritacheck" && (
            <div className="space-y-6">
              <div className="border-l-4 border-[#006064] pl-5 mb-2">
                <p className="text-lg sm:text-xl font-bold text-foreground leading-snug">
                  Riverside Regional has completed 2 method comparison studies for their chemistry department.
                </p>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  Below, you can explore the full results, Deming regression, bias analysis, and CLIA pass/fail evaluation, exactly as they appear in the compliance record. VeritaCheck&#8482; runs every EP study required for CLIA and CAP compliance: method comparison, calibration verification/linearity, accuracy, precision, lot-to-lot verification, and QC range establishment. Each study generates a compliant PDF report with full statistical tables.
                </p>
              </div>

              {/* Study cards */}
              <div className="grid sm:grid-cols-2 gap-4">
                {studies.map((study: any) => {
                  const isExpanded = expandedStudy === study.id;
                  const stats = computeStudyStats(study);
                  const instruments = study.instruments ? JSON.parse(study.instruments) : [];

                  return (
                    <Card key={study.id} className={`overflow-hidden ${isExpanded ? "sm:col-span-2" : ""}`}>
                      <CardHeader className="py-3 px-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-sm font-semibold">{study.test_name}</CardTitle>
                            <div className="text-xs text-muted-foreground mt-1">
                              {typeLabel[study.study_type] || study.study_type}
                            </div>
                          </div>
                          <Badge className="pass-badge shrink-0">
                            <CheckCircle2 size={10} className="mr-1" /> PASS
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="py-3 px-4 border-t space-y-3">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div><span className="text-muted-foreground">Primary:</span> {instruments[0]}</div>
                          <div><span className="text-muted-foreground">Comparison:</span> {instruments[1]}</div>
                          <div><span className="text-muted-foreground">Date:</span> {study.date}</div>
                          <div><span className="text-muted-foreground">Analyst:</span> {study.analyst}</div>
                          <div><span className="text-muted-foreground">CLIA TEa:</span> {study.clia_allowable_error} {study.test_name === "Sodium" ? "mmol/L" : "mmol/L"}</div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            variant={isExpanded ? "default" : "outline"}
                            className="text-xs h-7"
                            onClick={() => setExpandedStudy(isExpanded ? null : study.id)}
                          >
                            {isExpanded ? <ChevronUp size={11} className="mr-1" /> : <ChevronDown size={11} className="mr-1" />}
                            {isExpanded ? "Collapse Results" : "View Full Results"}
                          </Button>
                          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => downloadStudyPdf(study.id)}>
                            <Download size={11} className="mr-1" /> Download PDF Report
                          </Button>
                        </div>

                        {/* INLINE EXPANDED RESULTS */}
                        {isExpanded && stats && (
                          <div className="space-y-4 pt-3 border-t">
                            {/* Summary stats */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                              {[
                                { label: "n", value: stats.n },
                                { label: "Mean Bias", value: stats.meanBias.toFixed(3) },
                                { label: "Mean % Diff", value: stats.meanPctDiff.toFixed(2) + "%" },
                                { label: "Deming Slope", value: stats.slope.toFixed(4) },
                                { label: "Intercept", value: stats.intercept.toFixed(3) },
                                { label: "r\u00B2", value: stats.rSquared.toFixed(4) },
                              ].map((s) => (
                                <div key={s.label} className="bg-muted/50 rounded-lg p-2 text-center">
                                  <div className="text-[10px] text-muted-foreground uppercase">{s.label}</div>
                                  <div className="text-sm font-mono font-bold">{s.value}</div>
                                </div>
                              ))}
                            </div>

                            {/* Scatter plot */}
                            <Card>
                              <CardContent className="pt-4">
                                <div className="text-xs font-semibold mb-2">Regression Scatter Plot</div>
                                <ResponsiveContainer width="100%" height={300}>
                                  <ScatterChart margin={{ top: 10, right: 30, bottom: 20, left: 10 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" dataKey="x" name={stats.primary} label={{ value: stats.primary, position: "bottom", offset: 0, style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                                    <YAxis type="number" dataKey="y" name={stats.comparison} label={{ value: stats.comparison, angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                                    <RechartsTooltip formatter={(value: number) => value.toFixed(1)} />
                                    <Legend />
                                    <ReferenceLine
                                      segment={[
                                        { x: Math.min(...stats.scatterData.map((d: any) => d.x)), y: Math.min(...stats.scatterData.map((d: any) => d.x)) },
                                        { x: Math.max(...stats.scatterData.map((d: any) => d.x)), y: Math.max(...stats.scatterData.map((d: any) => d.x)) },
                                      ]}
                                      stroke="#999"
                                      strokeDasharray="5 5"
                                      label={{ value: "Identity", position: "end", fontSize: 9 }}
                                    />
                                    <Scatter name="Samples" data={stats.scatterData} fill="#0e8a82" r={4} />
                                  </ScatterChart>
                                </ResponsiveContainer>
                              </CardContent>
                            </Card>

                            {/* Data table */}
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-muted-foreground border-b">
                                    <th className="text-left py-1.5 pr-3">#</th>
                                    <th className="text-right py-1.5 pr-3">Primary</th>
                                    <th className="text-right py-1.5 pr-3">Comparison</th>
                                    <th className="text-right py-1.5 pr-3">Bias</th>
                                    <th className="text-right py-1.5 pr-3">% Diff</th>
                                    <th className="text-center py-1.5">Pass/Fail</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {stats.rows.map((row: any) => (
                                    <tr key={row.level} className="border-b border-border/50">
                                      <td className="py-1.5 pr-3">{row.level}</td>
                                      <td className="py-1.5 pr-3 text-right font-mono">{row.primary}</td>
                                      <td className="py-1.5 pr-3 text-right font-mono">{row.comparison}</td>
                                      <td className="py-1.5 pr-3 text-right font-mono">{row.bias}</td>
                                      <td className="py-1.5 pr-3 text-right font-mono">{row.pctDiff}%</td>
                                      <td className="py-1.5 text-center">
                                        <Badge className={row.pass ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}>
                                          {row.pass ? "PASS" : "FAIL"}
                                        </Badge>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* CTA */}
              <div className="rounded-xl p-6 text-center" style={{ background: "#006064" }}>
                <p className="text-white font-medium">
                  Ready to run your own studies? VeritaCheck&#8482; works with your instruments and your data.
                </p>
                <Button asChild size="sm" className="mt-3 bg-white text-[#006064] hover:bg-white/90 font-semibold">
                  <Link href="/login">Start Free Trial <ArrowRight size={14} className="ml-1" /></Link>
                </Button>
              </div>

              {/* CUMSUM section */}
              {cumsumTrackers.length > 0 && (
                <div className="mt-2">
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Activity size={16} /> CUMSUM Trackers
                  </h3>
                  {cumsumTrackers.map((tracker: any) => (
                    <Card key={tracker.id}>
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-sm">{tracker.instrument_name} - {tracker.analyte}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{tracker.entries?.length || 0} lot changes tracked</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-mono font-bold text-primary">
                              CumSum: {tracker.entries?.length ? tracker.entries[tracker.entries.length - 1].cumsum : 0} sec
                            </div>
                            <Badge className="pass-badge text-[10px] mt-1">
                              {tracker.entries?.length ? tracker.entries[tracker.entries.length - 1].verdict : "N/A"}
                            </Badge>
                          </div>
                        </div>
                        {tracker.entries?.length > 0 && (
                          <div className="mt-3 overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-muted-foreground border-b">
                                  <th className="text-left py-1 pr-3">Year</th>
                                  <th className="text-left py-1 pr-3">Lot Change</th>
                                  <th className="text-right py-1 pr-3">Old Mean</th>
                                  <th className="text-right py-1 pr-3">New Mean</th>
                                  <th className="text-right py-1 pr-3">Diff</th>
                                  <th className="text-right py-1 pr-3">CumSum</th>
                                  <th className="text-right py-1">Verdict</th>
                                </tr>
                              </thead>
                              <tbody>
                                {tracker.entries.map((entry: any) => (
                                  <tr key={entry.id} className="border-b border-border/50">
                                    <td className="py-1.5 pr-3">{entry.year}</td>
                                    <td className="py-1.5 pr-3">{entry.lot_label}</td>
                                    <td className="py-1.5 pr-3 text-right font-mono">{entry.old_lot_geomean?.toFixed(1)}</td>
                                    <td className="py-1.5 pr-3 text-right font-mono">{entry.new_lot_geomean?.toFixed(1)}</td>
                                    <td className="py-1.5 pr-3 text-right font-mono">{entry.difference?.toFixed(1)}</td>
                                    <td className="py-1.5 pr-3 text-right font-mono font-bold">{entry.cumsum?.toFixed(1)}</td>
                                    <td className="py-1.5 text-right">
                                      <Badge className="pass-badge text-[10px]">{entry.verdict}</Badge>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══════════════ TAB 2: VERITAMAP ═══════════════ */}
          {activeTab === "veritamap" && (
            <div className="space-y-5">
              <div className="border-l-4 border-[#006064] pl-5 mb-2">
                <p className="text-lg sm:text-xl font-bold text-foreground leading-snug">
                  Riverside Regional's laboratory has been fully mapped - 11 analyzers and 2 manual methods across the Chemistry, Hematology, and Blood Bank departments.
                </p>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  When building your lab in VeritaMap&#8482;, you select your instruments from a database of 190+ FDA-cleared analyzers. VeritaMap&#8482; queries the FDA test complexity database and presents every approved test for that instrument. You toggle the tests your lab performs, and VeritaMap&#8482; builds your complete test menu, with CLIA complexity, reference ranges, critical values, and AMR populated automatically from Mayo Clinic Laboratories published data. The result is a living map of your laboratory that is always survey-ready.
                </p>
              </div>
              {map ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">{map.name}</h3>
                      <p className="text-sm text-muted-foreground">{map.instruments?.length || 0} instruments &middot; {map.tests?.length || 0} analytes mapped</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={downloadMapExcel}>
                      <Download size={14} className="mr-1" /> Download Excel Export
                    </Button>
                  </div>

                  <div className="grid gap-3">
                    {(map.instruments || []).map((inst: any) => (
                      <Card key={inst.id} className="overflow-hidden">
                        <CardHeader className="py-3 px-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <CardTitle className="text-sm font-semibold">{inst.instrument_name}</CardTitle>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="outline" className="text-xs">{inst.role}</Badge>
                                <span className="text-xs text-muted-foreground">{inst.category}</span>
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground">{inst.tests?.length || 0} tests</span>
                          </div>
                        </CardHeader>
                        {inst.tests?.length > 0 && (
                          <CardContent className="py-2 px-4 border-t">
                            <div className="flex flex-wrap gap-1.5">
                              {inst.tests.map((t: any) => (
                                <Badge key={t.analyte} variant="secondary" className="text-xs">
                                  {t.analyte}
                                  <span className="ml-1 text-[9px] opacity-60">{t.complexity}</span>
                                </Badge>
                              ))}
                            </div>
                          </CardContent>
                        )}
                      </Card>
                    ))}
                  </div>

                  {map.intelligence && (
                    <div className="border-l-4 border-[#006064] bg-card rounded-r-lg p-4">
                      <div className="flex items-start gap-2">
                        <Info size={16} className="text-primary mt-0.5 shrink-0" />
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          VeritaMap&#8482; identified <strong className="text-foreground">
                          {Object.entries(map.intelligence as Record<string, any>).filter(([, v]: [string, any]) => v.correlationRequired).length} analytes
                          </strong> requiring correlation studies across Riverside Regional's instruments.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center text-muted-foreground py-12">No map data available</div>
              )}

              <div className="rounded-xl p-6 text-center" style={{ background: "#006064" }}>
                <p className="text-white font-medium">Map your lab's instruments and tests in minutes.</p>
                <Button asChild size="sm" className="mt-3 bg-white text-[#006064] hover:bg-white/90 font-semibold">
                  <Link href="/login">Start Free Trial <ArrowRight size={14} className="ml-1" /></Link>
                </Button>
              </div>
            </div>
          )}

          {/* ═══════════════ TAB 3: VERITASCAN ═══════════════ */}
          {activeTab === "veritascan" && (
            <div className="space-y-5">
              <div className="border-l-4 border-[#006064] pl-5 mb-2">
                <p className="text-lg sm:text-xl font-bold text-foreground leading-snug">
                  Riverside Regional's inspection readiness checklist has been completed across all major TJC and CAP domains.
                </p>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  VeritaScan&#8482; walks through 168 standards drawn from TJC and CAP requirements, tracks completion status by domain, and flags items that need attention before a surveyor arrives. The checklist exports to Excel for documentation and evidence gathering. Below is Riverside Regional's current readiness snapshot.
                </p>
              </div>
              {scan ? (
                <>
                  {/* Readiness hero */}
                  <div className="text-center py-6">
                    <div className={`text-6xl font-bold ${readinessColor}`}>{readinessPct}%</div>
                    <div className="text-sm text-muted-foreground mt-1 font-medium">Inspection-Ready</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {compliantItems} of {totalItems} items compliant, {remainingItems} items remaining
                    </div>
                    <div className="max-w-md mx-auto mt-3">
                      <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full ${readinessBg} rounded-full transition-all`} style={{ width: `${readinessPct}%` }} />
                      </div>
                    </div>
                  </div>

                  {/* Domain breakdown */}
                  <div className="space-y-2">
                    {DOMAINS.map((domain) => {
                      const domainItems = SCAN_ITEMS.filter((i) => i.domain === domain);
                      const domainCompliant = domainItems.filter((i) => scanItemMap[i.id]?.status === "Compliant").length;
                      const domainPct = Math.round((domainCompliant / domainItems.length) * 100);
                      const isExpanded = expandedDomains.has(domain);
                      const hasVcItems = domainItems.some((i) => scanItemMap[i.id]?.completion_source === "veritacheck_auto");

                      // Show items based on showFullScan toggle
                      const visibleItems = showFullScan ? domainItems : domainItems.slice(0, 3);

                      return (
                        <Card key={domain} className="overflow-hidden">
                          <button
                            className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-secondary/30 transition-colors"
                            onClick={() => toggleDomain(domain)}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <Badge className={`text-xs shrink-0 ${DOMAIN_COLORS[domain]}`}>{domain}</Badge>
                              {hasVcItems && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary/10 text-primary border border-primary/20 shrink-0">VC</span>
                                  </TooltipTrigger>
                                  <TooltipContent>Auto-completed items from VeritaCheck&#8482;</TooltipContent>
                                </Tooltip>
                              )}
                              <span className="text-xs text-muted-foreground shrink-0">
                                {domainCompliant}/{domainItems.length} compliant
                              </span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className={`text-xs font-semibold ${domainPct >= 80 ? "text-emerald-600" : domainPct >= 50 ? "text-amber-600" : "text-red-600"}`}>
                                {domainPct}%
                              </span>
                              <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${domainPct >= 80 ? "bg-emerald-500" : domainPct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                                  style={{ width: `${domainPct}%` }}
                                />
                              </div>
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </div>
                          </button>
                          {isExpanded && (
                            <div className="border-t divide-y">
                              {visibleItems.map((item) => {
                                const saved = scanItemMap[item.id];
                                const status: ScanStatus = saved?.status || "Not Assessed";
                                const isAutoCompleted = saved?.completion_source === "veritacheck_auto";

                                return (
                                  <div key={item.id} className="px-4 py-2.5 flex items-start gap-3">
                                    <div className="flex-1 min-w-0">
                                      <div className="text-xs leading-relaxed">{item.question}</div>
                                      <div className="text-[10px] text-muted-foreground mt-0.5">
                                        TJC: {item.tjc} &middot; CAP: {item.cap} &middot; {item.cfr}
                                      </div>
                                      {saved?.notes && (
                                        <div className="text-[10px] text-muted-foreground mt-0.5 italic">{saved.notes}</div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {isAutoCompleted && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary/10 text-primary border border-primary/20">
                                              VC
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent side="left" className="max-w-xs">
                                            <p className="text-xs font-medium">Auto-completed by VeritaCheck&#8482;</p>
                                            <p className="text-xs text-muted-foreground mt-0.5">{saved?.completion_note}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      )}
                                      <Badge className={`text-[10px] ${STATUS_COLORS[status]}`}>
                                        {status}
                                      </Badge>
                                    </div>
                                  </div>
                                );
                              })}
                              {!showFullScan && domainItems.length > 3 && (
                                <div className="px-4 py-2 text-center">
                                  <button
                                    className="text-xs text-primary hover:underline"
                                    onClick={(e) => { e.stopPropagation(); setShowFullScan(true); }}
                                  >
                                    Show all {domainItems.length} items
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="text-center text-muted-foreground py-12">No scan data available</div>
              )}

              <div className="rounded-xl p-6 text-center" style={{ background: "#006064" }}>
                <p className="text-white font-medium">Know where you stand before the surveyor arrives.</p>
                <Button asChild size="sm" className="mt-3 bg-white text-[#006064] hover:bg-white/90 font-semibold">
                  <Link href="/login">Start Free Trial <ArrowRight size={14} className="ml-1" /></Link>
                </Button>
              </div>
            </div>
          )}

          {/* ═══════════════ TAB 4: VERITACOMP ═══════════════ */}
          {activeTab === "veritacomp" && (
            <div className="space-y-5">
              <div className="border-l-4 border-[#006064] pl-5 mb-2">
                <p className="text-lg sm:text-xl font-bold text-foreground leading-snug">
                  Riverside Regional has documented annual competency for Jennifer Martinez, MLS(ASCP), in the Chemistry department.
                </p>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  Every element required by CLIA, from direct observation of patient test performance to problem-solving assessment, is captured here with supporting documentation fields that satisfy TJC and CAP surveyor expectations. Element 6 includes a scored quiz appended directly to the competency record. VeritaComp&#8482; manages all three CLIA competency types: technical, waived, and non-technical.
                </p>
              </div>

              {competencyData?.assessments?.length ? (
                <>
                  {competencyData.assessments.map((assessment: any) => (
                    <Card key={assessment.id}>
                      <CardHeader className="py-4 px-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-base font-semibold">{assessment.employee_name}</CardTitle>
                            <div className="text-sm text-muted-foreground">{assessment.employee_title}</div>
                          </div>
                          <Badge className="pass-badge">
                            <CheckCircle2 size={10} className="mr-1" /> PASS
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="py-3 px-4 border-t space-y-4">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div><span className="text-muted-foreground">Assessment Type:</span> Annual</div>
                          <div><span className="text-muted-foreground">Date:</span> {assessment.assessment_date}</div>
                          <div><span className="text-muted-foreground">Evaluator:</span> {assessment.evaluator_name}, {assessment.evaluator_title}</div>
                          <div><span className="text-muted-foreground">Program:</span> {assessment.program_name}</div>
                        </div>

                        {/* 6-element summary */}
                        <div>
                          <div className="text-xs font-semibold mb-2">6 CLIA Competency Elements</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-muted-foreground border-b">
                                  <th className="text-left py-1.5 pr-3">#</th>
                                  <th className="text-left py-1.5 pr-3">Element</th>
                                  <th className="text-left py-1.5 pr-3">Evidence</th>
                                  <th className="text-left py-1.5 pr-3">Date</th>
                                  <th className="text-center py-1.5">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(assessment.items || []).map((item: any, idx: number) => (
                                  <tr key={item.id || idx} className="border-b border-border/50">
                                    <td className="py-1.5 pr-3">{item.method_number || idx + 1}</td>
                                    <td className="py-1.5 pr-3">{item.item_label}</td>
                                    <td className="py-1.5 pr-3 text-muted-foreground">{item.evidence}</td>
                                    <td className="py-1.5 pr-3">{item.date_met}</td>
                                    <td className="py-1.5 text-center">
                                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px]">
                                        {item.passed ? "PASS" : "FAIL"}
                                      </Badge>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Quiz results */}
                        <div className="bg-muted/50 rounded-lg p-3">
                          <div className="text-xs font-semibold mb-1">Element 6: Problem-Solving Quiz</div>
                          <div className="text-xs text-muted-foreground">
                            Quiz ID: Q-AU5800-001, 2 questions, Score: 100%, Date: 2026-01-18
                          </div>
                        </div>

                        <Button size="sm" variant="outline" onClick={downloadCompetencyPdf}>
                          <Download size={14} className="mr-1" /> Download Competency PDF
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </>
              ) : (
                <div className="text-center text-muted-foreground py-12">No competency data available</div>
              )}

              <div className="rounded-xl p-6 text-center" style={{ background: "#006064" }}>
                <p className="text-white font-medium">Document competency the way surveyors expect to see it.</p>
                <Button asChild size="sm" className="mt-3 bg-white text-[#006064] hover:bg-white/90 font-semibold">
                  <Link href="/login">Start Free Trial <ArrowRight size={14} className="ml-1" /></Link>
                </Button>
              </div>
            </div>
          )}

          {/* ═══════════════ TAB 5: VERITASTAFF ═══════════════ */}
          {activeTab === "veritastaff" && (
            <div className="space-y-5">
              <div className="border-l-4 border-[#006064] pl-5 mb-2">
                <p className="text-lg sm:text-xl font-bold text-foreground leading-snug">
                  Riverside Regional's personnel records are fully loaded across all CLIA-defined roles.
                </p>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  VeritaStaff&#8482; tracks CLIA role assignments (Laboratory Director, Technical Consultant, Technical Supervisor, General Supervisor, Testing Personnel), qualification requirements by complexity level, and competency timelines for every employee. You always know who is current, who is due, and who is overdue, before the surveyor asks.
                </p>
              </div>

              <Card>
                <CardContent className="pt-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-muted-foreground border-b text-xs">
                          <th className="text-left py-2 pr-4">Name</th>
                          <th className="text-left py-2 pr-4">Title</th>
                          <th className="text-left py-2 pr-4">CLIA Role</th>
                          <th className="text-left py-2 pr-4">Hire Date</th>
                          <th className="text-center py-2">Competency Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { name: "Jennifer Martinez", title: "MLS(ASCP)", role: "Testing Personnel", hire: "2020-03-15", status: "Current" },
                          { name: "Robert Chen", title: "MT(ASCP)", role: "Testing Personnel", hire: "2018-06-01", status: "Current" },
                          { name: "Sarah Williams", title: "MLT(ASCP)", role: "Testing Personnel", hire: "2022-01-10", status: "Current" },
                          { name: "David Nguyen", title: "MLS(ASCP)", role: "Technical Supervisor", hire: "2019-09-20", status: "Current" },
                        ].map((emp) => (
                          <tr key={emp.name} className="border-b border-border/50">
                            <td className="py-2.5 pr-4 font-medium">{emp.name}</td>
                            <td className="py-2.5 pr-4 text-muted-foreground">{emp.title}</td>
                            <td className="py-2.5 pr-4">{emp.role}</td>
                            <td className="py-2.5 pr-4 text-muted-foreground">{emp.hire}</td>
                            <td className="py-2.5 text-center">
                              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs">
                                {emp.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <div className="rounded-xl p-6 text-center" style={{ background: "#006064" }}>
                <p className="text-white font-medium">Keep your personnel records survey-ready.</p>
                <Button asChild size="sm" className="mt-3 bg-white text-[#006064] hover:bg-white/90 font-semibold">
                  <Link href="/login">Start Free Trial <ArrowRight size={14} className="ml-1" /></Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
