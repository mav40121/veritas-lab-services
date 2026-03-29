import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CheckCircle2, AlertTriangle, MapPin, ClipboardList, FlaskConical,
  ArrowRight, Shield, ExternalLink,
  ChevronDown, ChevronUp, Activity, Info, FileText, Eye
} from "lucide-react";
import { API_BASE } from "@/lib/queryClient";
import { SCAN_ITEMS, DOMAINS, DOMAIN_COLORS, STATUS_COLORS, type ScanStatus } from "@/lib/veritaScanData";

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
  const completionPct = Math.round((assessedItems / totalItems) * 100);
  const compliancePct = assessedItems > 0 ? Math.round((compliantItems / assessedItems) * 100) : 0;
  const remainingItems = totalItems - compliantItems;

  // Readiness score — compliant items as % of total
  const readinessPct = Math.round((compliantItems / totalItems) * 100);
  const readinessColor = readinessPct >= 80 ? "text-emerald-500" : readinessPct >= 50 ? "text-amber-500" : "text-red-500";
  const readinessBg = readinessPct >= 80 ? "bg-emerald-500" : readinessPct >= 50 ? "bg-amber-500" : "bg-red-500";

  // Count analytes requiring correlation
  const correlationAnalytes = map?.intelligence
    ? Object.entries(map.intelligence as Record<string, any>).filter(([, v]: [string, any]) => v.correlationRequired).length
    : 0;

  const tabConfig = [
    { id: "veritamap", label: "VeritaMap\u2122", desc: "Regulatory Mapping", icon: MapPin },
    { id: "veritascan", label: "VeritaScan\u2122", desc: "Inspection Readiness", icon: ClipboardList },
    { id: "veritacheck", label: "VeritaCheck\u2122", desc: "EP Studies", icon: FlaskConical },
  ];

  const typeLabel: Record<string, string> = {
    method_comparison: "Method Comparison",
    cal_ver: "Calibration Verification",
    precision: "Accuracy & Precision",
    lot_to_lot: "Lot-to-Lot",
    pt_coag: "PT/Coag",
    qc_range: "QC Range",
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        {/* ═══════════════════════════════════════════════════════════
            BANNER — Solid dark teal, no gradient
            ═══════════════════════════════════════════════════════════ */}
        <div style={{ background: "#006064" }} className="text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Shield size={16} />
              You're viewing the VeritaAssure&#8482; demo lab &mdash; Riverside Regional Medical Center
            </div>
            <Button asChild size="sm" className="bg-white text-[#006064] hover:bg-white/90 font-semibold border-0">
              <Link href="/login">Start Free Trial <ArrowRight size={14} className="ml-1" /></Link>
            </Button>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            CONTEXT HEADER — Orientation section
            ═══════════════════════════════════════════════════════════ */}
        <div className="border-b bg-card">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 text-center">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">The VeritaAssure&#8482; Suite &mdash; Live Demo</h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl mx-auto">
              Explore how Riverside Regional Medical Center uses all three tools together. Click each tab to see the full workflow.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                <MapPin size={12} />
                {map?.instruments?.length || 13} Instruments Mapped
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                <ClipboardList size={12} />
                {totalItems} Compliance Items Tracked
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                <FlaskConical size={12} />
                {studies.length} Studies Completed
              </span>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {/* ═══════════════════════════════════════════════════════════
              TABS — Redesigned with clear active/inactive states
              ═══════════════════════════════════════════════════════════ */}
          <div className="flex gap-2 mb-6 border-b border-border">
            {tabConfig.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    relative flex flex-col items-center px-5 py-3 rounded-t-lg text-sm font-medium transition-all
                    ${isActive
                      ? "bg-[#006064] text-white shadow-md -mb-px z-10"
                      : "bg-card text-muted-foreground border border-b-0 border-border hover:bg-secondary/60 hover:text-foreground"
                    }
                  `}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon size={14} />
                    <span>{tab.label}</span>
                  </div>
                  <span className={`text-[10px] mt-0.5 ${isActive ? "text-white/70" : "text-muted-foreground/70"}`}>
                    {tab.desc}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ═══════════════════════════════════════════════════════════
              VERITAMAP TAB
              ═══════════════════════════════════════════════════════════ */}
          {activeTab === "veritamap" && (
            <div className="space-y-5">
              {/* Narrative intro callout */}
              <div className="border-l-4 border-[#006064] bg-card rounded-r-lg p-4">
                <div className="flex items-start gap-2">
                  <Info size={16} className="text-primary mt-0.5 shrink-0" />
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    VeritaMap identified <strong className="text-foreground">{correlationAnalytes} analytes</strong> requiring correlation studies across Riverside Regional's instruments. {studies.length} correlation studies have already been completed and auto-verified in VeritaScan. {Math.max(0, correlationAnalytes - studies.length)} are pending &mdash; click "Run Study" on any analyte to see how VeritaCheck pre-populates the study.
                  </p>
                </div>
              </div>

              {map ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold">{map.name}</h2>
                      <p className="text-sm text-muted-foreground">{map.instruments?.length || 0} instruments &middot; {map.tests?.length || 0} analytes mapped</p>
                    </div>
                    {/* Read-only badge instead of Add Instrument button */}
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
                      <Eye size={12} />
                      Read-only demo &mdash; <button onClick={blockAction} className="text-primary hover:underline font-semibold">Sign up to build your own map</button>
                    </div>
                  </div>

                  {/* Intelligence Banner */}
                  {map.intelligence && (
                    <div className="rounded-xl border-2 border-red-200 dark:border-red-900/60 bg-gradient-to-br from-red-50 to-red-50/30 dark:from-red-950/30 dark:to-red-950/10 p-4 shadow-sm">
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
                          <div key={`cv-${analyte}`} className="bg-white/70 dark:bg-white/5 rounded-lg p-3 border border-primary/20 dark:border-primary/30">
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
                </>
              ) : (
                <div className="text-center text-muted-foreground py-12">No map data available</div>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════
              VERITASCAN TAB
              ═══════════════════════════════════════════════════════════ */}
          {activeTab === "veritascan" && (
            <>
              {scan ? (
                <div className="space-y-5">
                  {/* Readiness hero */}
                  <div className="text-center py-6">
                    <div className={`text-6xl font-bold ${readinessColor}`}>{readinessPct}%</div>
                    <div className="text-sm text-muted-foreground mt-1 font-medium">Inspection-Ready</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {compliantItems} of {totalItems} items compliant &middot; {remainingItems} items remaining
                    </div>
                    {/* Readiness bar */}
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
                      const domainAssessed = domainItems.filter((i) => scanItemMap[i.id]?.status && scanItemMap[i.id]?.status !== "Not Assessed").length;
                      const domainPct = Math.round((domainCompliant / domainItems.length) * 100);
                      const isExpanded = expandedDomains.has(domain);
                      const hasVcItems = domainItems.some((i) => scanItemMap[i.id]?.completion_source === "veritacheck_auto");

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
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════
              VERITACHECK TAB — Results dashboard
              ═══════════════════════════════════════════════════════════ */}
          {activeTab === "veritacheck" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold">VeritaCheck&#8482; Studies</h2>
                <p className="text-sm text-muted-foreground">{studies.length} completed studies &mdash; EP verification & validation</p>
              </div>

              {/* Study cards */}
              <div className="grid sm:grid-cols-2 gap-4">
                {studies.map((study: any) => {
                  const isExpanded = expandedStudy === study.id;

                  return (
                    <Card key={study.id} className="overflow-hidden">
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
                      <CardContent className="py-3 px-4 border-t space-y-2">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div><span className="text-muted-foreground">Instrument:</span> {study.instrument}</div>
                          <div><span className="text-muted-foreground">Date:</span> {study.date}</div>
                          <div><span className="text-muted-foreground">Analyst:</span> {study.analyst}</div>
                          <div><span className="text-muted-foreground">TEa:</span> {study.clia_allowable_error ? `${(study.clia_allowable_error * 100).toFixed(1)}%` : "N/A"}</div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" variant="outline" className="text-xs h-7" onClick={blockAction}>
                            <FileText size={11} className="mr-1" /> View Report
                          </Button>
                          <Button size="sm" variant="outline" className="text-xs h-7" onClick={blockAction}>
                            <ExternalLink size={11} className="mr-1" /> Full Results
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Run Study CTA */}
              <Card className="border-dashed border-2 border-primary/30 bg-primary/5">
                <CardContent className="py-6 text-center">
                  <FlaskConical size={24} className="mx-auto text-primary mb-2" />
                  <h3 className="text-sm font-semibold mb-1">Run a New EP Study</h3>
                  <p className="text-xs text-muted-foreground mb-3 max-w-sm mx-auto">
                    Method comparison, calibration verification, precision, lot-to-lot &mdash; all CLIA-compliant with automated reporting.
                  </p>
                  <Button size="sm" onClick={blockAction} className="bg-[#006064] hover:bg-[#00494d] text-white font-semibold">
                    Run Study <ArrowRight size={14} className="ml-1" />
                  </Button>
                </CardContent>
              </Card>

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
                            <div className="font-medium text-sm">{tracker.instrument_name} &mdash; {tracker.analyte}</div>
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
        </div>

        {/* ═══════════════════════════════════════════════════════════
            UPGRADE MODAL — Clean conversion prompt
            ═══════════════════════════════════════════════════════════ */}
        <Dialog open={showUpgradeModal} onOpenChange={setShowUpgradeModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Ready to build your own lab?</DialogTitle>
              <DialogDescription>
                This is a read-only demo of Riverside Regional Medical Center's compliance setup. Sign up free to map your own instruments, run real EP studies, and track your inspection readiness.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 mt-4">
              <Button asChild className="w-full font-semibold" style={{ background: "#006064" }}>
                <Link href="/login">Start Free Trial <ArrowRight size={14} className="ml-1" /></Link>
              </Button>
              <Button variant="outline" onClick={() => setShowUpgradeModal(false)}>
                Keep Exploring
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
