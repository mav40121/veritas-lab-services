import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CheckCircle2, AlertTriangle, MapPin, ClipboardList, FlaskConical,
  ChevronRight, ArrowRight, BarChart3, Shield, ExternalLink,
  ChevronDown, ChevronUp, Activity, Beaker, Info
} from "lucide-react";
import { API_BASE } from "@/lib/queryClient";
import { SCAN_ITEMS, DOMAINS, DOMAIN_COLORS, STATUS_COLORS, type ScanDomain, type ScanStatus } from "@/lib/veritaScanData";

interface DemoData {
  maps: any[];
  scans: any[];
  studies: any[];
  cumsumTrackers: any[];
}

export default function DemoLabPage() {
  const [data, setData] = useState<DemoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("veritamap");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [expandedStudy, setExpandedStudy] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/demo/data`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const blockAction = () => setShowUpgradeModal(true);

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      next.has(domain) ? next.delete(domain) : next.add(domain);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
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
  const completionPct = Math.round((assessedItems / totalItems) * 100);
  const compliancePct = assessedItems > 0 ? Math.round((compliantItems / assessedItems) * 100) : 0;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        {/* Demo Banner */}
        <div className="bg-gradient-to-r from-teal-600 to-amber-500 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Shield size={16} />
              You're viewing the VeritaAssure&#8482; demo lab &mdash; Riverside Regional Medical Center
            </div>
            <Button asChild size="sm" variant="secondary" className="bg-white text-teal-700 hover:bg-white/90 font-semibold">
              <Link href="/login">Start Free Trial <ArrowRight size={14} className="ml-1" /></Link>
            </Button>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {/* Tab Interface */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3 mb-6">
              <TabsTrigger value="veritamap" className="flex items-center gap-1.5">
                <MapPin size={14} /> VeritaMap&#8482;
              </TabsTrigger>
              <TabsTrigger value="veritascan" className="flex items-center gap-1.5">
                <ClipboardList size={14} /> VeritaScan&#8482;
              </TabsTrigger>
              <TabsTrigger value="veritacheck" className="flex items-center gap-1.5">
                <FlaskConical size={14} /> VeritaCheck&#8482;
              </TabsTrigger>
            </TabsList>

            {/* ─── VeritaMap Tab ─────────────────────────────────── */}
            <TabsContent value="veritamap">
              {map ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold">{map.name}</h2>
                      <p className="text-sm text-muted-foreground">{map.instruments?.length || 0} instruments &middot; {map.tests?.length || 0} analytes mapped</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={blockAction}>
                      <MapPin size={13} className="mr-1" /> Add Instrument
                    </Button>
                  </div>

                  {/* Intelligence Banner */}
                  {map.intelligence && (
                    <div className="rounded-xl border-2 border-red-200 dark:border-red-900/60 bg-gradient-to-br from-red-50 to-amber-50/30 dark:from-red-950/30 dark:to-amber-950/10 p-4 shadow-sm">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle size={16} className="text-red-600" />
                        <span className="font-semibold text-sm text-red-700 dark:text-red-400">Compliance Intelligence</span>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {Object.entries(map.intelligence as Record<string, any>).filter(([, v]: [string, any]) => v.correlationRequired).map(([analyte, info]: [string, any]) => (
                          <div key={analyte} className="bg-white/70 dark:bg-white/5 rounded-lg p-3 border border-red-100 dark:border-red-900/30">
                            <div className="font-medium text-sm">{analyte}</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {info.instruments.length} instruments &mdash; correlation study required (42 CFR &sect;493.1213)
                            </div>
                            <div className="mt-2">
                              <Button size="sm" variant="link" className="h-auto p-0 text-xs text-primary" onClick={blockAction}>
                                <FlaskConical size={10} className="mr-1" /> Run Study &rarr;
                              </Button>
                            </div>
                          </div>
                        ))}
                        {Object.entries(map.intelligence as Record<string, any>).filter(([, v]: [string, any]) => v.calVerRequired && !v.isWaived).slice(0, 4).map(([analyte]: [string, any]) => (
                          <div key={`cv-${analyte}`} className="bg-white/70 dark:bg-white/5 rounded-lg p-3 border border-amber-100 dark:border-amber-900/30">
                            <div className="font-medium text-sm">{analyte}</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Calibration verification required every 6 months (42 CFR &sect;493.1255)
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Instruments */}
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
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-12">No map data available</div>
              )}
            </TabsContent>

            {/* ─── VeritaScan Tab ─────────────────────────────── */}
            <TabsContent value="veritascan">
              {scan ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold">{scan.name}</h2>
                      <p className="text-sm text-muted-foreground">{totalItems} items &middot; {completionPct}% assessed</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={blockAction}>Export to Excel</Button>
                  </div>

                  {/* Progress */}
                  <div className="grid grid-cols-3 gap-3">
                    <Card>
                      <CardContent className="py-4 text-center">
                        <div className="text-2xl font-bold text-primary">{completionPct}%</div>
                        <div className="text-xs text-muted-foreground">Assessed</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="py-4 text-center">
                        <div className="text-2xl font-bold text-emerald-600">{compliancePct}%</div>
                        <div className="text-xs text-muted-foreground">Compliant</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="py-4 text-center">
                        <div className="text-2xl font-bold text-amber-600">{totalItems - assessedItems}</div>
                        <div className="text-xs text-muted-foreground">Remaining</div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Domains */}
                  <div className="space-y-2">
                    {DOMAINS.map((domain) => {
                      const domainItems = SCAN_ITEMS.filter((i) => i.domain === domain);
                      const domainCompliant = domainItems.filter((i) => scanItemMap[i.id]?.status === "Compliant").length;
                      const domainAssessed = domainItems.filter((i) => scanItemMap[i.id]?.status && scanItemMap[i.id]?.status !== "Not Assessed").length;
                      const isExpanded = expandedDomains.has(domain);

                      return (
                        <Card key={domain} className="overflow-hidden">
                          <button
                            className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-secondary/30 transition-colors"
                            onClick={() => toggleDomain(domain)}
                          >
                            <div className="flex items-center gap-3">
                              <Badge className={`text-xs ${DOMAIN_COLORS[domain]}`}>{domain}</Badge>
                              <span className="text-xs text-muted-foreground">
                                {domainCompliant}/{domainItems.length} compliant
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500 rounded-full transition-all"
                                  style={{ width: `${(domainAssessed / domainItems.length) * 100}%` }}
                                />
                              </div>
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </div>
                          </button>
                          {isExpanded && (
                            <div className="border-t divide-y">
                              {domainItems.map((item) => {
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
                                            <button className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors">
                                              VC
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="left" className="max-w-xs">
                                            <p className="text-xs font-medium">Auto-completed by VeritaCheck&#8482;</p>
                                            <p className="text-xs text-muted-foreground mt-0.5">{saved?.completion_note}</p>
                                            <p className="text-xs text-primary mt-1 cursor-pointer" onClick={blockAction}>Click to view study &rarr;</p>
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
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-12">No scan data available</div>
              )}
            </TabsContent>

            {/* ─── VeritaCheck Tab ────────────────────────────── */}
            <TabsContent value="veritacheck">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold">VeritaCheck&#8482; Studies</h2>
                    <p className="text-sm text-muted-foreground">{studies.length} completed studies</p>
                  </div>
                  <Button size="sm" onClick={blockAction}>
                    <FlaskConical size={13} className="mr-1" /> Run New Study
                  </Button>
                </div>

                {studies.map((study: any) => {
                  const isExpanded = expandedStudy === study.id;
                  const typeLabel: Record<string, string> = {
                    method_comparison: "Method Comparison",
                    cal_ver: "Calibration Verification",
                    precision: "Accuracy & Precision",
                    lot_to_lot: "Lot-to-Lot",
                    pt_coag: "PT/Coag",
                    qc_range: "QC Range",
                  };

                  return (
                    <Card key={study.id}>
                      <button
                        className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-secondary/30 transition-colors"
                        onClick={() => setExpandedStudy(isExpanded ? null : study.id)}
                      >
                        <div>
                          <div className="font-medium text-sm">{study.test_name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {typeLabel[study.study_type] || study.study_type} &middot; {study.instrument} &middot; {study.date}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                            <CheckCircle2 size={10} className="mr-1" /> PASS
                          </Badge>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </div>
                      </button>
                      {isExpanded && (
                        <CardContent className="border-t pt-3">
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div><span className="text-muted-foreground">Analyst:</span> {study.analyst}</div>
                            <div><span className="text-muted-foreground">Date:</span> {study.date}</div>
                            <div><span className="text-muted-foreground">Instruments:</span> {JSON.parse(study.instruments || "[]").join(", ")}</div>
                            <div><span className="text-muted-foreground">TEa:</span> {(study.clia_allowable_error * 100).toFixed(1)}%</div>
                          </div>
                          <div className="mt-3">
                            <Button size="sm" variant="outline" onClick={blockAction}>
                              <ExternalLink size={11} className="mr-1" /> View Full Results
                            </Button>
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  );
                })}

                {/* CUMSUM section */}
                {cumsumTrackers.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <Activity size={16} /> CUMSUM Trackers
                    </h3>
                    {cumsumTrackers.map((tracker: any) => (
                      <Card key={tracker.id}>
                        <CardContent className="py-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium text-sm">{tracker.instrument_name} &mdash; {tracker.analyte}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">{tracker.entries?.length || 0} lot changes tracked</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-mono font-bold text-primary">
                                CumSum: {tracker.entries?.length ? tracker.entries[tracker.entries.length - 1].cumsum : 0} sec
                              </div>
                              <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 mt-1">
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
                                        <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">{entry.verdict}</Badge>
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
            </TabsContent>
          </Tabs>
        </div>

        {/* Upgrade Modal */}
        <Dialog open={showUpgradeModal} onOpenChange={setShowUpgradeModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Ready to build your own lab?</DialogTitle>
              <DialogDescription>
                This is the VeritaAssure&#8482; demo. Sign up free to map your own instruments,
                run real studies, and track your inspection readiness.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 mt-4">
              <Button asChild className="w-full bg-primary hover:bg-primary/90 font-semibold">
                <Link href="/login">Start Free Trial <ArrowRight size={14} className="ml-1" /></Link>
              </Button>
              <Button variant="outline" onClick={() => setShowUpgradeModal(false)}>
                Continue Exploring Demo
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
