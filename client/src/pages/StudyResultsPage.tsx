import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import {
  calculateStudy,
  isCalVer,
  isMethodComp,
  type StudyResults,
  type CalVerResults,
  type MethodCompResults,
  type DataPoint,
} from "@/lib/calculations";
import type { Study } from "@shared/schema";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
  LineChart,
  Line,
  ResponsiveContainer,
} from "recharts";
import { FileDown, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { generatePDF } from "@/lib/pdfGenerator";

const CHART_COLORS = ["#2ecbc7", "#4f9ef5", "#67d967", "#f5a623", "#a78bfa"];

// ─── Shared header / pass-fail ────────────────────────────────────────────────
function StudyHeader({ study, results }: { study: Study; results: StudyResults }) {
  return (
    <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground -ml-2">
            <Link href="/dashboard">
              <ArrowLeft size={14} className="mr-1" />Dashboard
            </Link>
          </Button>
        </div>
        <h1 className="text-xl font-bold">{study.testName}</h1>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <Badge variant="outline" className="text-xs">
            {study.studyType === "cal_ver" ? "Calibration Verification" : "Method Comparison"}
          </Badge>
          <span className="text-sm text-muted-foreground">{study.instrument}</span>
          <span className="text-sm text-muted-foreground">·</span>
          <span className="text-sm text-muted-foreground">{study.date}</span>
          <span className="text-sm text-muted-foreground">·</span>
          <span className="text-sm text-muted-foreground">Analyst: {study.analyst}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {results.overallPass ? (
          <Badge className="bg-green-500/10 text-green-400 border-green-500/30 border px-3 py-1 text-sm font-semibold">
            <CheckCircle2 size={14} className="mr-1.5" />PASS
          </Badge>
        ) : (
          <Badge className="bg-red-500/10 text-red-400 border-red-500/30 border px-3 py-1 text-sm font-semibold">
            <XCircle size={14} className="mr-1.5" />FAIL
          </Badge>
        )}
        <Button
          onClick={() => generatePDF(study, results)}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
          data-testid="button-download-pdf"
        >
          <FileDown size={14} className="mr-1.5" />Download PDF
        </Button>
      </div>
    </div>
  );
}

function EvalBox({ results }: { results: StudyResults }) {
  const cliaPercent = (0).toFixed(1); // placeholder — not used directly here
  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Evaluation of Results</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-muted-foreground">{results.summary}</p>
        <div className={`mt-4 p-3 rounded-lg border ${results.overallPass ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
          <div className="flex items-center gap-2">
            {results.overallPass
              ? <CheckCircle2 size={16} className="text-green-400" />
              : <XCircle size={16} className="text-red-400" />}
            <span className={`text-sm font-semibold ${results.overallPass ? "text-green-400" : "text-red-400"}`}>
              Overall: {results.overallPass ? "PASS" : "FAIL"} — {results.passCount}/{results.totalCount} results within TEa
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function UserSpecs({ study, instrumentNames }: { study: Study; instrumentNames: string[] }) {
  const cliaPercent = (study.cliaAllowableError * 100).toFixed(1);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">User Specifications</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-xs">
          {[
            ["Study Type", study.studyType === "cal_ver" ? "Calibration Verification" : "Method Comparison"],
            ["CLIA Total Allowable Error", `±${cliaPercent}%`],
            ["Analyst", study.analyst],
            ["Date", study.date],
            ["Instruments / Methods", instrumentNames.join(", ")],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between py-1.5 border-b border-border/40">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── CALIBRATION VERIFICATION results ────────────────────────────────────────
function CalVerReport({ study, results }: { study: Study; results: CalVerResults }) {
  const { levelResults, regression } = results;
  const instrumentNames: string[] = JSON.parse(study.instruments);
  const cliaPercent = (study.cliaAllowableError * 100).toFixed(1);
  const upperBound = 100 + parseFloat(cliaPercent);
  const lowerBound = 100 - parseFloat(cliaPercent);

  const scatterData = instrumentNames.map((name) => ({
    name,
    data: levelResults.filter((r) => r.instruments[name]).map((r) => ({ x: r.assignedValue, y: r.instruments[name].value })),
  }));

  const recoveryData = levelResults.map((r) => ({
    expected: r.assignedValue,
    recovery: parseFloat(r.pctRecovery.toFixed(2)),
    name: `L${r.level}`,
  }));

  return (
    <>
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Data Levels", value: levelResults.length },
          { label: "Results Passing", value: `${results.passCount} / ${results.totalCount}` },
          { label: "CLIA TEa", value: `±${cliaPercent}%` },
          { label: "Max % Recovery", value: `${results.maxPctRecovery.toFixed(1)}%` },
        ].map(({ label, value }) => (
          <Card key={label}><CardContent className="p-4">
            <div className="text-lg font-bold">{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </CardContent></Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid sm:grid-cols-2 gap-5 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Scatter Plot — Measured vs. Assigned</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="x" name="Assigned" type="number" label={{ value: "Assigned Value", position: "insideBottom", offset: -10, fontSize: 10 }} />
                <YAxis dataKey="y" name="Measured" type="number" label={{ value: "Measured", angle: -90, position: "insideLeft", fontSize: 10 }} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                <Legend />
                {levelResults.length > 0 && (
                  <ReferenceLine
                    segment={[
                      { x: levelResults[0].assignedValue, y: levelResults[0].assignedValue },
                      { x: levelResults[levelResults.length - 1].assignedValue, y: levelResults[levelResults.length - 1].assignedValue },
                    ]}
                    stroke="#666" strokeDasharray="4 2"
                    label={{ value: "1:1", fontSize: 9, fill: "#888" }}
                  />
                )}
                {scatterData.map(({ name, data }, idx) => (
                  <Scatter key={name} name={name} data={data} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Percent Recovery (±TEa bounds)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={recoveryData} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="expected" label={{ value: "Assigned Value", position: "insideBottom", offset: -10, fontSize: 10 }} />
                <YAxis
                  domain={[Math.min(85, Math.floor(results.minPctRecovery - 2)), Math.max(115, Math.ceil(results.maxPctRecovery + 2))]}
                  label={{ value: "% Recovery", angle: -90, position: "insideLeft", fontSize: 10 }}
                />
                <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                <ReferenceLine y={100} stroke="#888" strokeDasharray="4 2" label={{ value: "100%", fontSize: 9, fill: "#888" }} />
                <ReferenceLine y={upperBound} stroke="#ef4444" strokeDasharray="4 2" label={{ value: `+${cliaPercent}%`, fontSize: 9, fill: "#ef4444" }} />
                <ReferenceLine y={lowerBound} stroke="#ef4444" strokeDasharray="4 2" label={{ value: `-${cliaPercent}%`, fontSize: 9, fill: "#ef4444" }} />
                <Line type="monotone" dataKey="recovery" name="% Recovery" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ fill: CHART_COLORS[0], r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Data table */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Statistical Analysis — Level-by-Level Results</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Level</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Assigned</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Mean Measured</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">% Recovery</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Obs Error</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Pass?</th>
                  {instrumentNames.map((n) => <th key={n} className="text-right py-2 pr-3 text-muted-foreground font-medium">{n}</th>)}
                </tr>
              </thead>
              <tbody>
                {levelResults.map((r) => (
                  <tr key={r.level} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-mono">L{r.level}</td>
                    <td className="text-right py-2 pr-3 font-mono">{r.assignedValue.toFixed(3)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{r.mean.toFixed(3)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{r.pctRecovery.toFixed(1)}%</td>
                    <td className="text-right py-2 pr-3 font-mono">{(r.obsError * 100).toFixed(2)}%</td>
                    <td className="text-right py-2 pr-3">
                      <span className={r.passFailMean === "Pass" ? "pass-badge" : "fail-badge"}>{r.passFailMean}</span>
                    </td>
                    {instrumentNames.map((n) => (
                      <td key={n} className="text-right py-2 pr-3 font-mono">
                        {r.instruments[n] ? r.instruments[n].value.toFixed(3) : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Linearity / Regression */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Linearity Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Comparison</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">N</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Slope</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Intercept</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Prop. Bias</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">R</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">R²</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(regression).map(([name, reg]) => (
                  <tr key={name} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-medium">{name}</td>
                    <td className="text-right py-2 pr-3 font-mono">{reg.n}</td>
                    <td className="text-right py-2 pr-3 font-mono">{reg.slope.toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{reg.intercept.toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">
                      <span className={Math.abs(reg.proportionalBias) < study.cliaAllowableError ? "text-green-400" : "text-red-400"}>
                        {(reg.proportionalBias * 100).toFixed(2)}%
                      </span>
                    </td>
                    <td className="text-right py-2 pr-3 font-mono">{Math.sqrt(reg.r2).toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{reg.r2.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ─── METHOD COMPARISON results ────────────────────────────────────────────────
function MethodCompReport({ study, results }: { study: Study; results: MethodCompResults }) {
  const { levelResults, regression, blandAltman } = results;
  const instrumentNames: string[] = JSON.parse(study.instruments);
  const cliaPercent = (study.cliaAllowableError * 100).toFixed(1);

  // Scatter: each test instrument vs reference
  const scatterData = instrumentNames.map((name) => ({
    name,
    data: levelResults.filter((r) => r.instruments[name]).map((r) => ({ x: r.referenceValue, y: r.instruments[name].value })),
  }));

  // Bland-Altman plot data: difference vs. average
  const baPlotData = instrumentNames.flatMap((name, idx) =>
    levelResults
      .filter((r) => r.instruments[name])
      .map((r) => ({
        avg: (r.referenceValue + r.instruments[name].value) / 2,
        diff: r.instruments[name].difference,
        pctDiff: r.instruments[name].pctDifference,
        instrument: name,
        color: CHART_COLORS[idx % CHART_COLORS.length],
      }))
  );

  const xRange = (results as any).xRange as { min: number; max: number } | undefined;
  const yRange = (results as any).yRange as { [name: string]: { min: number; max: number } } | undefined;

  return (
    <>
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Sample Levels", value: levelResults.length },
          { label: "Results Passing", value: `${results.passCount} / ${results.totalCount}` },
          { label: "CLIA TEa", value: `±${cliaPercent}%` },
          { label: "Instruments", value: instrumentNames.length + 1 },
        ].map(({ label, value }) => (
          <Card key={label}><CardContent className="p-4">
            <div className="text-lg font-bold">{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </CardContent></Card>
        ))}
      </div>

      {/* Result Ranges */}
      {xRange && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-muted-foreground">Reference Range: </span>
                <span className="font-mono">{xRange.min.toFixed(3)} – {xRange.max.toFixed(3)}</span>
              </div>
              {instrumentNames.map((n) => yRange?.[n] && (
                <div key={n}>
                  <span className="text-muted-foreground">{n} Range: </span>
                  <span className="font-mono">{yRange[n].min.toFixed(3)} – {yRange[n].max.toFixed(3)}</span>
                </div>
              ))}
              <div>
                <span className="text-muted-foreground">Points (Plotted/Total): </span>
                <span className="font-mono">{levelResults.length}/{levelResults.length}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <div className="grid sm:grid-cols-2 gap-5 mb-6">
        {/* Correlation scatter */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Correlation — Test vs. Reference Method</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="x" name="Reference" type="number" label={{ value: "Reference Method", position: "insideBottom", offset: -10, fontSize: 10 }} />
                <YAxis dataKey="y" name="Test" type="number" label={{ value: "Test Method", angle: -90, position: "insideLeft", fontSize: 10 }} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                <Legend />
                {levelResults.length > 0 && (
                  <ReferenceLine
                    segment={[
                      { x: levelResults[0].referenceValue, y: levelResults[0].referenceValue },
                      { x: levelResults[levelResults.length - 1].referenceValue, y: levelResults[levelResults.length - 1].referenceValue },
                    ]}
                    stroke="#666" strokeDasharray="4 2"
                    label={{ value: "1:1", fontSize: 9, fill: "#888" }}
                  />
                )}
                {scatterData.map(({ name, data }, idx) => (
                  <Scatter key={name} name={name} data={data} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Bland-Altman: % difference vs. average */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Bland-Altman — % Difference vs. Mean</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="avg" name="Mean" type="number" label={{ value: "Mean of Methods", position: "insideBottom", offset: -10, fontSize: 10 }} />
                <YAxis dataKey="pctDiff" name="% Diff" type="number" label={{ value: "% Difference", angle: -90, position: "insideLeft", fontSize: 10 }} />
                <Tooltip formatter={(v: number, name: string) => name === "% Diff" ? `${v.toFixed(2)}%` : v} cursor={{ strokeDasharray: "3 3" }} />
                <ReferenceLine y={0} stroke="#888" strokeDasharray="4 2" />
                <ReferenceLine y={parseFloat(cliaPercent)} stroke="#ef4444" strokeDasharray="4 2" label={{ value: `+${cliaPercent}%`, fontSize: 8, fill: "#ef4444" }} />
                <ReferenceLine y={-parseFloat(cliaPercent)} stroke="#ef4444" strokeDasharray="4 2" label={{ value: `-${cliaPercent}%`, fontSize: 8, fill: "#ef4444" }} />
                {instrumentNames.map((name, idx) => (
                  <Scatter
                    key={name}
                    name={name}
                    data={baPlotData.filter((d) => d.instrument === name)}
                    fill={CHART_COLORS[idx % CHART_COLORS.length]}
                  />
                ))}
                <Legend />
              </ScatterChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Data table — with Bias column */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Level-by-Level Comparison Results</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Level</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Reference</th>
                  {instrumentNames.map((n) => (
                    <th key={n} colSpan={4} className="text-center py-2 pr-3 text-muted-foreground font-medium border-l border-border/40">{n}</th>
                  ))}
                </tr>
                <tr className="border-b border-border/60 bg-muted/20">
                  <th className="py-1 pr-3" />
                  <th className="py-1 pr-3" />
                  {instrumentNames.map((n) => (
                    <>
                      <th key={`${n}-val`} className="text-right py-1 pr-3 text-muted-foreground font-normal border-l border-border/40">Value</th>
                      <th key={`${n}-bias`} className="text-right py-1 pr-3 text-muted-foreground font-normal">Bias</th>
                      <th key={`${n}-diff`} className="text-right py-1 pr-3 text-muted-foreground font-normal">% Diff</th>
                      <th key={`${n}-pf`} className="text-right py-1 pr-3 text-muted-foreground font-normal">Pass?</th>
                    </>
                  ))}
                </tr>
              </thead>
              <tbody>
                {levelResults.map((r) => (
                  <tr key={r.level} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-mono">L{r.level}</td>
                    <td className="text-right py-2 pr-3 font-mono">{r.referenceValue.toFixed(3)}</td>
                    {instrumentNames.map((n) => (
                      <>
                        <td key={`${n}-val`} className="text-right py-2 pr-3 font-mono border-l border-border/20">
                          {r.instruments[n] ? r.instruments[n].value.toFixed(3) : "—"}
                        </td>
                        <td key={`${n}-bias`} className="text-right py-2 pr-3 font-mono">
                          {r.instruments[n] ? r.instruments[n].difference.toFixed(3) : "—"}
                        </td>
                        <td key={`${n}-diff`} className="text-right py-2 pr-3 font-mono">
                          {r.instruments[n]
                            ? <span className={Math.abs(r.instruments[n].pctDifference) < study.cliaAllowableError * 100 ? "text-green-400" : "text-red-400"}>
                                {r.instruments[n].pctDifference.toFixed(2)}%
                              </span>
                            : "—"}
                        </td>
                        <td key={`${n}-pf`} className="text-right py-2 pr-3">
                          {r.instruments[n]
                            ? <span className={r.instruments[n].passFail === "Pass" ? "pass-badge" : "fail-badge"}>{r.instruments[n].passFail}</span>
                            : "—"}
                        </td>
                      </>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Regression summary — Deming + OLS with CI */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Regression Analysis</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Comparison</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">N</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Slope (95% CI)</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Intercept (95% CI)</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">SEE</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Prop. Bias</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">R</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">R²</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(regression).map(([name, reg]) => (
                  <tr key={name} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-medium">{name}</td>
                    <td className="text-right py-2 pr-3 font-mono">{reg.n}</td>
                    <td className="text-right py-2 pr-3 font-mono">
                      {reg.slopeLo !== undefined
                        ? <>{reg.slope.toFixed(4)}<br/><span className="text-muted-foreground">({reg.slopeLo.toFixed(3)} – {reg.slopeHi!.toFixed(3)})</span></>
                        : reg.slope.toFixed(4)}
                    </td>
                    <td className="text-right py-2 pr-3 font-mono">
                      {reg.interceptLo !== undefined
                        ? <>{reg.intercept.toFixed(4)}<br/><span className="text-muted-foreground">({reg.interceptLo.toFixed(3)} – {reg.interceptHi!.toFixed(3)})</span></>
                        : reg.intercept.toFixed(4)}
                    </td>
                    <td className="text-right py-2 pr-3 font-mono">{reg.see.toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">
                      <span className={Math.abs(reg.proportionalBias) < study.cliaAllowableError ? "text-green-400" : "text-red-400"}>
                        {(reg.proportionalBias * 100).toFixed(2)}%
                      </span>
                    </td>
                    <td className="text-right py-2 pr-3 font-mono">{Math.sqrt(reg.r2).toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{reg.r2.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2">95% Confidence Intervals shown in parentheses (OLS only)</p>
          </div>
        </CardContent>
      </Card>

      {/* Bland-Altman summary table */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Bland-Altman Bias Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Instrument</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Mean Bias</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Mean % Bias</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">SD of Diff</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">95% LoA Lower</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">95% LoA Upper</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(blandAltman).map(([name, ba]) => (
                  <tr key={name} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-medium">{name}</td>
                    <td className="text-right py-2 pr-3 font-mono">{ba.meanDiff.toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">
                      <span className={Math.abs(ba.pctMeanDiff) < study.cliaAllowableError * 100 ? "text-green-400" : "text-red-400"}>
                        {ba.pctMeanDiff.toFixed(2)}%
                      </span>
                    </td>
                    <td className="text-right py-2 pr-3 font-mono">{ba.sdDiff.toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{ba.loa_lower.toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{ba.loa_upper.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ─── Root page ────────────────────────────────────────────────────────────────
export default function StudyResults() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0");

  const { data: study, isLoading } = useQuery<Study>({
    queryKey: ["/api/studies", id],
    queryFn: () => apiRequest("GET", `/api/studies/${id}`).then((r) => r.json()),
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
      </div>
    );
  }

  if (!study) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 text-center">
        <p className="text-muted-foreground">Study not found.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/dashboard">Back to Dashboard</Link>
        </Button>
      </div>
    );
  }

  const instrumentNames: string[] = JSON.parse(study.instruments);
  const rawDataPoints: DataPoint[] = JSON.parse(study.dataPoints);
  const results = calculateStudy(rawDataPoints, instrumentNames, study.cliaAllowableError, study.studyType as "cal_ver" | "method_comparison");

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <StudyHeader study={study} results={results} />

      {isCalVer(results) && <CalVerReport study={study} results={results} />}
      {isMethodComp(results) && <MethodCompReport study={study} results={results} />}

      <EvalBox results={results} />
      <UserSpecs study={study} instrumentNames={instrumentNames} />

      <div className="mt-6 flex gap-3 justify-end">
        <Button asChild variant="outline">
          <Link href="/study/new">Run Another Study</Link>
        </Button>
        <Button
          onClick={() => generatePDF(study, results)}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <FileDown size={14} className="mr-1.5" />Download PDF Report
        </Button>
      </div>
    </div>
  );
}
