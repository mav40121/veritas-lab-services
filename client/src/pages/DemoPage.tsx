import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle2, AlertTriangle, XCircle, ChevronRight, FlaskConical,
  ClipboardList, MapPin, ArrowRight, Play, BarChart3, Shield,
  FileText, ExternalLink, ChevronDown, ChevronUp, Info
} from "lucide-react";

// ─── Demo Data ────────────────────────────────────────────────────────────────

const LAB_NAME = "Riverside Regional Medical Center";

const demoTests = [
  {
    id: 1,
    analyte: "Glucose",
    specialty: "Chemistry",
    complexity: "Moderate",
    cfrSection: "493.1255",
    calVerStatus: "PASS",
    calVerDate: "2026-02-10",
    calVerDue: "2026-08-10",
    methodCompStatus: "PASS",
    methodCompDate: "2025-11-01",
    precisionStatus: "PASS",
    precisionDate: "2025-11-01",
    scanCompliance: 95,
    gap: null,
    color: "green",
  },
  {
    id: 2,
    analyte: "Hemoglobin",
    specialty: "Hematology",
    complexity: "Moderate",
    cfrSection: "493.1255",
    calVerStatus: "OVERDUE",
    calVerDate: "2025-09-15",
    calVerDue: "2026-03-15",
    methodCompStatus: "PASS",
    methodCompDate: "2025-10-20",
    precisionStatus: "PASS",
    precisionDate: "2025-10-20",
    scanCompliance: 68,
    gap: "Calibration verification overdue — last performed 6 months ago. CLIA §493.1255 requires verification at least every 6 months.",
    color: "red",
  },
  {
    id: 3,
    analyte: "Prothrombin Time (PT)",
    specialty: "Coagulation",
    complexity: "Moderate",
    cfrSection: "493.1255",
    calVerStatus: "PASS",
    calVerDate: "2026-01-22",
    calVerDue: "2026-07-22",
    methodCompStatus: "NOT DONE",
    methodCompDate: null,
    precisionStatus: "PASS",
    precisionDate: "2025-12-05",
    scanCompliance: 74,
    gap: "Method comparison not documented. Required when a new analyzer was placed in service per CLIA §493.1213.",
    color: "amber",
  },
  {
    id: 4,
    analyte: "Creatinine",
    specialty: "Chemistry",
    complexity: "Moderate",
    cfrSection: "493.1255",
    calVerStatus: "PASS",
    calVerDate: "2026-03-01",
    calVerDue: "2026-09-01",
    methodCompStatus: "PASS",
    methodCompDate: "2025-12-15",
    precisionStatus: "PASS",
    precisionDate: "2025-12-15",
    scanCompliance: 92,
    gap: null,
    color: "green",
  },
  {
    id: 5,
    analyte: "Urine hCG",
    specialty: "Urinalysis",
    complexity: "Waived",
    cfrSection: "493.15",
    calVerStatus: "N/A",
    calVerDate: null,
    calVerDue: null,
    methodCompStatus: "N/A",
    methodCompDate: null,
    precisionStatus: "N/A",
    precisionDate: null,
    scanCompliance: 88,
    gap: null,
    color: "green",
  },
];

const scanQuestions = [
  { id: 1, text: "Written QC policy documented and current?", answer: true },
  { id: 2, text: "Proficiency testing enrolled for all regulated analytes?", answer: true },
  { id: 3, text: "Personnel records include CLIA-required competency assessments?", answer: false },
  { id: 4, text: "Calibration verification performed within required intervals?", answer: false },
  { id: 5, text: "Method comparison on file for all analyzers?", answer: false },
  { id: 6, text: "Patient test management SOP current within 2 years?", answer: true },
  { id: 7, text: "Director signature on all required policies?", answer: true },
  { id: 8, text: "Corrective action log maintained?", answer: true },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "PASS") return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
      <CheckCircle2 size={11} /> PASS
    </span>
  );
  if (status === "OVERDUE") return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-2 py-0.5">
      <XCircle size={11} /> OVERDUE
    </span>
  );
  if (status === "NOT DONE") return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
      <AlertTriangle size={11} /> NOT DONE
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted rounded px-2 py-0.5">
      N/A
    </span>
  );
}

function ScanMeter({ score }: { score: number }) {
  const color = score >= 90 ? "bg-emerald-500" : score >= 75 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-semibold w-8 text-right">{score}%</span>
    </div>
  );
}

// ─── Main Demo Page ───────────────────────────────────────────────────────────

export default function DemoPage() {
  const [activeTest, setActiveTest] = useState<number | null>(null);
  const [showVeritaCheck, setShowVeritaCheck] = useState(false);
  const [showVeritaScan, setShowVeritaScan] = useState(false);
  const [activeStudy, setActiveStudy] = useState<"calver" | "methodcomp" | "precision" | null>(null);
  const [expandedGap, setExpandedGap] = useState<number | null>(null);

  const selectedTest = demoTests.find(t => t.id === activeTest);
  const gappedTests = demoTests.filter(t => t.gap);
  const passCount = demoTests.filter(t => t.color === "green").length;
  const scanScore = Math.round(scanQuestions.filter(q => q.answer).length / scanQuestions.length * 100);

  return (
    <div className="min-h-screen bg-background">

      {/* ── Hero Banner ── */}
      <section className="border-b border-border bg-gradient-to-br from-primary/8 via-transparent to-transparent">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5 font-medium">
            Interactive Product Demo
          </Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            See the Veritas Suite in action.
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mb-6 leading-relaxed">
            Follow a real compliance workflow for <strong>{LAB_NAME}</strong> — from test menu mapping, to flagged gaps, to running the actual EP studies, to an overall inspection readiness score.
          </p>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 text-sm font-medium">
              <MapPin size={14} className="text-primary" /> VeritaMap™ — Test Menu
            </div>
            <ArrowRight size={16} className="text-muted-foreground self-center" />
            <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 text-sm font-medium">
              <FlaskConical size={14} className="text-primary" /> VeritaCheck™ — EP Studies
            </div>
            <ArrowRight size={16} className="text-muted-foreground self-center" />
            <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 text-sm font-medium">
              <Shield size={14} className="text-primary" /> VeritaScan™ — Inspection Readiness
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-14">

        {/* ══════════════════════════════════════════════
            STEP 1 — VERITAMAP
        ══════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">1</div>
            <div>
              <h2 className="font-serif text-2xl font-bold flex items-center gap-2">
                <MapPin size={20} className="text-primary" /> VeritaMap™ — Test Menu Regulatory Map
              </h2>
              <p className="text-muted-foreground text-sm">Map every test to CLIA, TJC, and CAP requirements. Surface gaps instantly.</p>
            </div>
          </div>

          {/* Summary KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 mt-6">
            {[
              { label: "Tests Mapped", value: "5", icon: ClipboardList, color: "text-primary" },
              { label: "Fully Compliant", value: `${passCount}`, icon: CheckCircle2, color: "text-emerald-600" },
              { label: "Gaps Flagged", value: `${gappedTests.length}`, icon: AlertTriangle, color: "text-amber-600" },
              { label: "Overdue", value: "1", icon: XCircle, color: "text-red-600" },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className="text-center py-4">
                <Icon size={20} className={`${color} mx-auto mb-1`} />
                <div className={`text-2xl font-bold font-serif ${color}`}>{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </Card>
            ))}
          </div>

          {/* Test Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left">
                      <th className="px-4 py-3 font-semibold text-xs text-muted-foreground">ANALYTE</th>
                      <th className="px-4 py-3 font-semibold text-xs text-muted-foreground">SPECIALTY</th>
                      <th className="px-4 py-3 font-semibold text-xs text-muted-foreground">CFR</th>
                      <th className="px-4 py-3 font-semibold text-xs text-muted-foreground">CAL VER</th>
                      <th className="px-4 py-3 font-semibold text-xs text-muted-foreground">METHOD COMP</th>
                      <th className="px-4 py-3 font-semibold text-xs text-muted-foreground">PRECISION</th>
                      <th className="px-4 py-3 font-semibold text-xs text-muted-foreground">SCAN SCORE</th>
                      <th className="px-4 py-3 font-semibold text-xs text-muted-foreground">ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {demoTests.map((test, i) => (
                      <>
                        <tr
                          key={test.id}
                          className={`border-b border-border transition-colors cursor-pointer ${
                            activeTest === test.id ? "bg-primary/5" : "hover:bg-muted/30"
                          } ${test.color === "red" ? "bg-red-50/40 dark:bg-red-950/20" : test.color === "amber" ? "bg-amber-50/40 dark:bg-amber-950/20" : ""}`}
                          onClick={() => setActiveTest(activeTest === test.id ? null : test.id)}
                        >
                          <td className="px-4 py-3 font-semibold flex items-center gap-2">
                            {test.gap && <AlertTriangle size={13} className={test.color === "red" ? "text-red-500" : "text-amber-500"} />}
                            {test.analyte}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{test.specialty}</td>
                          <td className="px-4 py-3 text-muted-foreground font-mono text-xs">§{test.cfrSection}</td>
                          <td className="px-4 py-3"><StatusBadge status={test.calVerStatus} /></td>
                          <td className="px-4 py-3"><StatusBadge status={test.methodCompStatus} /></td>
                          <td className="px-4 py-3"><StatusBadge status={test.precisionStatus} /></td>
                          <td className="px-4 py-3 min-w-[120px]"><ScanMeter score={test.scanCompliance} /></td>
                          <td className="px-4 py-3">
                            {test.gap ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 border-primary/40 text-primary hover:bg-primary/10"
                                onClick={e => { e.stopPropagation(); setActiveTest(test.id); setShowVeritaCheck(true); setExpandedGap(test.id); }}
                              >
                                Fix Gap <ChevronRight size={11} className="ml-1" />
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">✓ Compliant</span>
                            )}
                          </td>
                        </tr>
                        {/* Expanded gap row */}
                        {expandedGap === test.id && test.gap && (
                          <tr key={`gap-${test.id}`} className="border-b border-border">
                            <td colSpan={8} className="px-4 py-3">
                              <div className={`rounded-lg border p-3 text-sm flex items-start gap-2 ${
                                test.color === "red" ? "border-red-200 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300" : "border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                              }`}>
                                <Info size={15} className="shrink-0 mt-0.5" />
                                <div>
                                  <strong className="font-semibold">Gap identified:</strong> {test.gap}
                                  <div className="mt-2 flex gap-2 flex-wrap">
                                    <Button size="sm" className="text-xs h-7 bg-primary text-primary-foreground" onClick={() => { setShowVeritaCheck(true); setActiveStudy(test.methodCompStatus === "NOT DONE" ? "methodcomp" : "calver"); }}>
                                      <FlaskConical size={11} className="mr-1" />
                                      Run {test.methodCompStatus === "NOT DONE" ? "Method Comparison" : "Cal Verification"} in VeritaCheck
                                    </Button>
                                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setExpandedGap(null)}>
                                      Dismiss
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <Info size={11} /> Click any row to expand details. Red rows require immediate action before your next inspection.
          </p>
        </section>

        {/* ══════════════════════════════════════════════
            TRANSITION CALLOUT
        ══════════════════════════════════════════════ */}
        <div className="relative rounded-xl border-2 border-primary/20 bg-primary/5 p-6 text-center">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-background px-3">
            <ArrowRight size={18} className="text-primary rotate-90" />
          </div>
          <p className="text-sm font-semibold text-primary mb-1">VeritaMap found 2 compliance gaps.</p>
          <p className="text-muted-foreground text-sm">
            Hemoglobin calibration verification is overdue. PT/INR method comparison is not on file.
            VeritaCheck runs the actual EP study and generates a CLIA-compliant PDF report — closing both gaps in minutes.
          </p>
          <Button
            size="sm"
            className="mt-4 bg-primary text-primary-foreground"
            onClick={() => { setShowVeritaCheck(true); setActiveStudy("calver"); }}
          >
            <FlaskConical size={13} className="mr-1.5" /> Run the Study in VeritaCheck
          </Button>
        </div>

        {/* ══════════════════════════════════════════════
            STEP 2 — VERITACHECK
        ══════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">2</div>
            <div>
              <h2 className="font-serif text-2xl font-bold flex items-center gap-2">
                <FlaskConical size={20} className="text-primary" /> VeritaCheck™ — EP Study Analysis
              </h2>
              <p className="text-muted-foreground text-sm">Enter your data. Get CLIA-compliant statistical analysis and a signed PDF report in minutes.</p>
            </div>
          </div>

          {/* Study type tabs */}
          <div className="flex gap-2 flex-wrap mt-6 mb-4">
            {[
              { id: "calver", label: "Calibration Verification", gap: true },
              { id: "methodcomp", label: "Correlation / Method Comparison", gap: true },
              { id: "precision", label: "Precision Verification (EP15)", gap: false },
            ].map(({ id, label, gap }) => (
              <button
                key={id}
                onClick={() => { setShowVeritaCheck(true); setActiveStudy(id as any); }}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                  activeStudy === id && showVeritaCheck
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                }`}
              >
                {label}
                {gap && <span className="ml-2 text-[10px] font-bold text-amber-600 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5">GAP</span>}
              </button>
            ))}
          </div>

          {/* Demo study panel */}
          {showVeritaCheck && activeStudy && (
            <Card className="border-primary/20">
              <CardHeader className="pb-2 border-b border-border bg-muted/30">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FlaskConical size={15} className="text-primary" />
                    {activeStudy === "calver" && "Calibration Verification — Hemoglobin"}
                    {activeStudy === "methodcomp" && "Correlation / Method Comparison — PT/INR"}
                    {activeStudy === "precision" && "Precision Verification (EP15) — Creatinine"}
                  </CardTitle>
                  <Badge variant="outline" className="text-primary border-primary/30">Demo Study</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4">

                {/* ── Cal Ver Demo ── */}
                {activeStudy === "calver" && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      5 calibrator levels run in duplicate. Results evaluated against manufacturer's stated allowable limits. CLIA §493.1255 requires verification every 6 months.
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Level</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Expected (g/dL)</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Observed (g/dL)</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">% Difference</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Allowable (±10%)</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { level: "L1", expected: 7.0, observed: 7.1, diff: 1.4 },
                            { level: "L2", expected: 10.5, observed: 10.3, diff: -1.9 },
                            { level: "L3", expected: 14.0, observed: 13.8, diff: -1.4 },
                            { level: "L4", expected: 17.5, observed: 17.8, diff: 1.7 },
                            { level: "L5", expected: 21.0, observed: 21.2, diff: 1.0 },
                          ].map(row => (
                            <tr key={row.level} className="border-t border-border">
                              <td className="px-3 py-2 font-mono font-semibold">{row.level}</td>
                              <td className="px-3 py-2">{row.expected.toFixed(1)}</td>
                              <td className="px-3 py-2">{row.observed.toFixed(1)}</td>
                              <td className="px-3 py-2 font-mono">{row.diff > 0 ? "+" : ""}{row.diff.toFixed(1)}%</td>
                              <td className="px-3 py-2 text-muted-foreground">± 10.0%</td>
                              <td className="px-3 py-2">
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
                                  <CheckCircle2 size={10} /> PASS
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-3">
                      <div>
                        <div className="font-bold text-emerald-700 dark:text-emerald-400 text-sm">Overall Result: PASS</div>
                        <div className="text-xs text-muted-foreground">All 5 levels within ±10% allowable variance. CLIA §493.1255 satisfied.</div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="text-xs h-7 gap-1.5">
                          <FileText size={12} /> View Sample PDF
                        </Button>
                        <Button asChild size="sm" className="text-xs h-7 bg-primary text-primary-foreground">
                          <Link href="/veritacheck">Run Your Study <ArrowRight size={11} className="ml-1" /></Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Method Comp Demo ── */}
                {activeStudy === "methodcomp" && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      20-patient comparison between reference method (Stago STA-R) and new analyzer (Stago STAR Max 3). Evaluated using Pearson correlation and bias analysis.
                    </p>
                    <div className="grid sm:grid-cols-3 gap-3 mb-2">
                      {[
                        { label: "Pearson r", value: "0.997", note: "Acceptable ≥ 0.975", pass: true },
                        { label: "Slope", value: "0.991", note: "Acceptable 0.90–1.10", pass: true },
                        { label: "Avg Bias", value: "+0.4 sec", note: "Within 10% TEa", pass: true },
                      ].map(({ label, value, note, pass }) => (
                        <div key={label} className="rounded-lg border border-border bg-card p-3 text-center">
                          <div className="text-xs text-muted-foreground mb-1">{label}</div>
                          <div className="text-xl font-bold font-serif text-foreground">{value}</div>
                          <div className="text-xs text-muted-foreground mt-1">{note}</div>
                          <div className={`mt-1.5 text-xs font-semibold ${pass ? "text-emerald-600" : "text-red-600"}`}>
                            {pass ? "✓ PASS" : "✗ FAIL"}
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Mini scatter viz */}
                    <div className="bg-muted/30 rounded-lg border border-border p-4">
                      <div className="text-xs font-semibold text-muted-foreground mb-2 text-center">Correlation Scatter — PT/INR (sec) · Reference vs New Method</div>
                      <svg viewBox="0 0 300 180" className="w-full max-w-sm mx-auto">
                        <line x1="30" y1="150" x2="280" y2="150" stroke="hsl(var(--border))" strokeWidth="1" />
                        <line x1="30" y1="150" x2="30" y2="10" stroke="hsl(var(--border))" strokeWidth="1" />
                        {/* regression line */}
                        <line x1="40" y1="138" x2="270" y2="22" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeDasharray="4,3" opacity="0.6" />
                        {/* identity */}
                        <line x1="40" y1="140" x2="270" y2="20" stroke="hsl(var(--muted-foreground))" strokeWidth="1" opacity="0.3" />
                        {/* data points */}
                        {[
                          [50,132],[65,118],[80,108],[95,95],[110,82],[125,70],[140,60],
                          [155,50],[165,44],[175,36],[190,28],[200,24],[215,20],[55,126],
                          [75,112],[100,90],[130,66],[160,48],[185,30],[210,22]
                        ].map(([x, y], i) => (
                          <circle key={i} cx={x} cy={y} r="3" fill="hsl(var(--primary))" opacity="0.75" />
                        ))}
                        <text x="155" y="165" textAnchor="middle" fontSize="8" fill="hsl(var(--muted-foreground))">Reference Method (sec)</text>
                        <text x="12" y="85" textAnchor="middle" fontSize="8" fill="hsl(var(--muted-foreground))" transform="rotate(-90,12,85)">New Method (sec)</text>
                        <text x="265" y="18" fontSize="7" fill="hsl(var(--primary))" fontWeight="bold">r=0.997</text>
                      </svg>
                    </div>
                    <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-3">
                      <div>
                        <div className="font-bold text-emerald-700 dark:text-emerald-400 text-sm">Overall Result: PASS</div>
                        <div className="text-xs text-muted-foreground">Methods correlate acceptably. New analyzer cleared for patient testing.</div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="text-xs h-7 gap-1.5">
                          <FileText size={12} /> View Sample PDF
                        </Button>
                        <Button asChild size="sm" className="text-xs h-7 bg-primary text-primary-foreground">
                          <Link href="/veritacheck">Run Your Study <ArrowRight size={11} className="ml-1" /></Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Precision Demo ── */}
                {activeStudy === "precision" && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      EP15 precision verification — 5 replicates/day × 5 days = 25 total results. Evaluated against manufacturer's claimed SD and CLIA TEa.
                    </p>
                    <div className="grid sm:grid-cols-4 gap-3">
                      {[
                        { label: "Mean", value: "1.02 mg/dL" },
                        { label: "SD (Total)", value: "0.031 mg/dL" },
                        { label: "CV", value: "3.0%" },
                        { label: "CLIA TEa", value: "±15% (CV)" },
                      ].map(({ label, value }) => (
                        <div key={label} className="rounded-lg border border-border bg-card p-3 text-center">
                          <div className="text-xs text-muted-foreground mb-1">{label}</div>
                          <div className="text-base font-bold font-serif">{value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="bg-muted/30 rounded-lg border border-border p-3">
                      <div className="text-xs font-semibold text-muted-foreground mb-2">ANOVA Breakdown</div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {[
                          { label: "Within-Run SD", value: "0.022" },
                          { label: "Between-Run SD", value: "0.018" },
                          { label: "Between-Day SD", value: "0.015" },
                        ].map(({ label, value }) => (
                          <div key={label}>
                            <div className="text-sm font-bold font-mono">{value}</div>
                            <div className="text-xs text-muted-foreground">{label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-3">
                      <div>
                        <div className="font-bold text-emerald-700 dark:text-emerald-400 text-sm">Overall Result: PASS</div>
                        <div className="text-xs text-muted-foreground">Observed CV 3.0% well within CLIA TEa of ±15%. Manufacturer claims verified.</div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="text-xs h-7 gap-1.5">
                          <FileText size={12} /> View Sample PDF
                        </Button>
                        <Button asChild size="sm" className="text-xs h-7 bg-primary text-primary-foreground">
                          <Link href="/veritacheck">Run Your Study <ArrowRight size={11} className="ml-1" /></Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {!showVeritaCheck && (
            <Card className="border-dashed border-2 border-border">
              <CardContent className="py-10 text-center">
                <FlaskConical size={32} className="text-primary mx-auto mb-3 opacity-60" />
                <p className="text-muted-foreground text-sm mb-4">Select a study type above or click "Fix Gap" in the VeritaMap table to see a demo study.</p>
                <Button size="sm" className="bg-primary text-primary-foreground" onClick={() => { setShowVeritaCheck(true); setActiveStudy("calver"); }}>
                  <Play size={13} className="mr-1.5" /> Launch Demo Study
                </Button>
              </CardContent>
            </Card>
          )}
        </section>

        {/* ══════════════════════════════════════════════
            TRANSITION CALLOUT 2
        ══════════════════════════════════════════════ */}
        <div className="relative rounded-xl border-2 border-primary/20 bg-primary/5 p-6 text-center">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-background px-3">
            <ArrowRight size={18} className="text-primary rotate-90" />
          </div>
          <p className="text-sm font-semibold text-primary mb-1">Studies complete. Gaps closed. Now — are you truly inspection-ready?</p>
          <p className="text-muted-foreground text-sm">
            VeritaScan scores your lab across 168 TJC, CAP, and CLIA checkpoints — identifying every remaining vulnerability before a surveyor does.
          </p>
          <Button size="sm" className="mt-4 bg-primary text-primary-foreground" onClick={() => setShowVeritaScan(true)}>
            <Shield size={13} className="mr-1.5" /> See Your Inspection Readiness Score
          </Button>
        </div>

        {/* ══════════════════════════════════════════════
            STEP 3 — VERITASCAN
        ══════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">3</div>
            <div>
              <h2 className="font-serif text-2xl font-bold flex items-center gap-2">
                <Shield size={20} className="text-primary" /> VeritaScan™ — Inspection Readiness
              </h2>
              <p className="text-muted-foreground text-sm">168 checkpoints across CLIA, TJC, and CAP. Know where you stand before a surveyor arrives.</p>
            </div>
          </div>

          {showVeritaScan ? (
            <div className="space-y-4 mt-6">
              {/* Score Card */}
              <div className="grid sm:grid-cols-3 gap-4">
                <Card className="sm:col-span-1 text-center py-6">
                  <div className="text-5xl font-bold font-serif text-amber-600 mb-1">{scanScore}%</div>
                  <div className="text-sm font-semibold text-muted-foreground">Inspection Readiness</div>
                  <div className="text-xs text-amber-600 mt-2 font-medium">Needs Attention</div>
                  <div className="mt-3 mx-4 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${scanScore}%` }} />
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">{scanQuestions.filter(q => q.answer).length} of {scanQuestions.length} items compliant</div>
                </Card>

                <Card className="sm:col-span-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground font-medium">Checklist — Sample Section (CLIA Quality Systems)</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-2">
                    {scanQuestions.map(q => (
                      <div key={q.id} className={`flex items-start gap-2.5 text-sm rounded-lg px-3 py-2 ${
                        q.answer ? "bg-emerald-50/60 dark:bg-emerald-950/20" : "bg-red-50/60 dark:bg-red-950/20"
                      }`}>
                        {q.answer
                          ? <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                          : <XCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                        }
                        <span className={q.answer ? "text-foreground" : "text-red-700 dark:text-red-400 font-medium"}>{q.text}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              <div className="rounded-xl border border-red-200 bg-red-50/60 dark:bg-red-950/20 dark:border-red-900 p-4">
                <div className="font-semibold text-red-700 dark:text-red-400 text-sm mb-1 flex items-center gap-2">
                  <AlertTriangle size={14} /> 3 Deficiencies Requiring Immediate Action
                </div>
                <ul className="text-sm text-red-700 dark:text-red-400 space-y-1 list-disc list-inside">
                  <li>Competency assessments missing from personnel files</li>
                  <li>Calibration verification not performed within required intervals (Hemoglobin — now corrected via VeritaCheck)</li>
                  <li>Method comparison not on file for PT/INR analyzer (now corrected via VeritaCheck)</li>
                </ul>
                <div className="mt-3 text-xs text-muted-foreground">
                  VeritaScan generates a prioritized action plan with specific CFR citations for each deficiency — ready to hand to your lab director.
                </div>
              </div>

              <div className="flex gap-3 flex-wrap">
                <Button asChild size="sm" className="bg-primary text-primary-foreground">
                  <Link href="/veritascan">Run Full 168-Point Scan <ArrowRight size={13} className="ml-1" /></Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/veritacheck">Start an EP Study <FlaskConical size={13} className="ml-1" /></Link>
                </Button>
              </div>
            </div>
          ) : (
            <Card className="border-dashed border-2 border-border mt-6">
              <CardContent className="py-10 text-center">
                <Shield size={32} className="text-primary mx-auto mb-3 opacity-60" />
                <p className="text-muted-foreground text-sm mb-4">Click below to see {LAB_NAME}'s inspection readiness score across 8 sample checkpoints.</p>
                <Button size="sm" className="bg-primary text-primary-foreground" onClick={() => setShowVeritaScan(true)}>
                  <Play size={13} className="mr-1.5" /> Show Readiness Score
                </Button>
              </CardContent>
            </Card>
          )}
        </section>

        {/* ══════════════════════════════════════════════
            FINAL CTA
        ══════════════════════════════════════════════ */}
        <section className="rounded-2xl bg-primary text-primary-foreground p-8 sm:p-10 text-center">
          <h2 className="font-serif text-2xl sm:text-3xl font-bold mb-3">Ready to run this for your lab?</h2>
          <p className="text-primary-foreground/80 max-w-xl mx-auto mb-6 text-sm leading-relaxed">
            VeritaCheck is live now. VeritaScan and VeritaMap are coming soon. Early adopters lock in $149/year before prices rise June 15.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90 font-semibold">
              <Link href="/veritacheck">Start with VeritaCheck — Free Study <ChevronRight size={16} className="ml-1" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10">
              <Link href="/study-guide">Which study do I need? <ExternalLink size={14} className="ml-1" /></Link>
            </Button>
          </div>
          <p className="text-xs text-primary-foreground/60 mt-4">No credit card required to run your first study.</p>
        </section>

      </div>
    </div>
  );
}
