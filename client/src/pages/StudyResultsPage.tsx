import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { calculateStudy, type DataPoint } from "@/lib/calculations";
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
  const results = calculateStudy(rawDataPoints, instrumentNames, study.cliaAllowableError);

  const { dataPointResults, regression, overallPass, passCount, totalCount } = results;

  // Build chart data
  const scatterDataByInstrument = instrumentNames.map((name) => ({
    name,
    data: dataPointResults
      .filter((r) => r.instruments[name])
      .map((r) => ({
        x: r.expectedValue,
        y: r.instruments[name].value,
      })),
  }));

  const recoveryData = dataPointResults.map((r) => ({
    expected: r.expectedValue,
    recovery: parseFloat(r.pctRecovery.toFixed(2)),
    name: `L${r.level}`,
  }));

  const cliaPercent = (study.cliaAllowableError * 100).toFixed(1);
  const upperBound = 100 + parseFloat(cliaPercent);
  const lowerBound = 100 - parseFloat(cliaPercent);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground -ml-2">
              <Link href="/dashboard">
                <ArrowLeft size={14} className="mr-1" />
                Dashboard
              </Link>
            </Button>
          </div>
          <h1 className="text-xl font-bold">{study.testName}</h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-sm text-muted-foreground">{study.instrument}</span>
            <span className="text-sm text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground">{study.date}</span>
            <span className="text-sm text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground">Analyst: {study.analyst}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {overallPass ? (
            <Badge className="bg-green-500/10 text-green-400 border-green-500/30 border px-3 py-1 text-sm font-semibold">
              <CheckCircle2 size={14} className="mr-1.5" />
              PASS
            </Badge>
          ) : (
            <Badge className="bg-red-500/10 text-red-400 border-red-500/30 border px-3 py-1 text-sm font-semibold">
              <XCircle size={14} className="mr-1.5" />
              FAIL
            </Badge>
          )}
          <Button
            onClick={() => generatePDF(study, results)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
            data-testid="button-download-pdf"
          >
            <FileDown size={14} className="mr-1.5" />
            Download PDF
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Data Levels", value: dataPointResults.length },
          { label: "Results Passing", value: `${passCount} / ${totalCount}` },
          { label: "CLIA TEa", value: `±${cliaPercent}%` },
          { label: "Max % Recovery", value: `${results.maxPctRecovery.toFixed(1)}%` },
        ].map(({ label, value }) => (
          <Card key={label} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="text-lg font-bold">{value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid sm:grid-cols-2 gap-5 mb-6">
        {/* Scatter Plot */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Scatter Plot — Measured vs. Expected</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="x"
                  name="Expected"
                  type="number"
                  label={{ value: "Expected (mg/dL)", position: "insideBottom", offset: -5, fontSize: 10 }}
                />
                <YAxis
                  dataKey="y"
                  name="Measured"
                  type="number"
                  label={{ value: "Measured", angle: -90, position: "insideLeft", fontSize: 10 }}
                />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                <Legend />
                {/* 1:1 identity line */}
                {dataPointResults.length > 0 && (
                  <ReferenceLine
                    segment={[
                      { x: dataPointResults[0].expectedValue, y: dataPointResults[0].expectedValue },
                      {
                        x: dataPointResults[dataPointResults.length - 1].expectedValue,
                        y: dataPointResults[dataPointResults.length - 1].expectedValue,
                      },
                    ]}
                    stroke="#666"
                    strokeDasharray="4 2"
                    label={{ value: "1:1", fontSize: 9, fill: "#888" }}
                  />
                )}
                {scatterDataByInstrument.map(({ name, data }, idx) => (
                  <Scatter
                    key={name}
                    name={name}
                    data={data}
                    fill={CHART_COLORS[idx % CHART_COLORS.length]}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Percent Recovery */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Percent Recovery</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={recoveryData} margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="expected" label={{ value: "Expected", position: "insideBottom", offset: -5, fontSize: 10 }} />
                <YAxis
                  domain={[
                    Math.min(85, Math.floor(results.minPctRecovery - 2)),
                    Math.max(115, Math.ceil(results.maxPctRecovery + 2)),
                  ]}
                  label={{ value: "% Recovery", angle: -90, position: "insideLeft", fontSize: 10 }}
                />
                <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                <ReferenceLine y={100} stroke="#888" strokeDasharray="4 2" label={{ value: "100%", fontSize: 9, fill: "#888" }} />
                <ReferenceLine y={upperBound} stroke="#ef4444" strokeDasharray="4 2" label={{ value: `+${cliaPercent}%`, fontSize: 9, fill: "#ef4444" }} />
                <ReferenceLine y={lowerBound} stroke="#ef4444" strokeDasharray="4 2" label={{ value: `-${cliaPercent}%`, fontSize: 9, fill: "#ef4444" }} />
                <Line
                  type="monotone"
                  dataKey="recovery"
                  name="% Recovery"
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2}
                  dot={{ fill: CHART_COLORS[0], r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Statistical Analysis Table */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Statistical Analysis and Experimental Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Level</th>
                  <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Assigned</th>
                  <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Mean</th>
                  <th className="text-right py-2 pr-4 text-muted-foreground font-medium">% Rec</th>
                  <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Obs Err</th>
                  <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Pass?</th>
                  {instrumentNames.map((name) => (
                    <th key={name} className="text-right py-2 pr-4 text-muted-foreground font-medium">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataPointResults.map((r) => (
                  <tr key={r.level} className="border-b border-border/40">
                    <td className="py-2 pr-4 font-mono">L{r.level}</td>
                    <td className="text-right py-2 pr-4 font-mono">{r.expectedValue.toFixed(3)}</td>
                    <td className="text-right py-2 pr-4 font-mono">{r.mean.toFixed(3)}</td>
                    <td className="text-right py-2 pr-4 font-mono">{r.pctRecovery.toFixed(1)}</td>
                    <td className="text-right py-2 pr-4 font-mono">
                      {(r.obsErrorMean * 100).toFixed(2)}%
                    </td>
                    <td className="text-right py-2 pr-4">
                      <span className={r.passFailMean === "Pass" ? "pass-badge" : "fail-badge"}>
                        {r.passFailMean}
                      </span>
                    </td>
                    {instrumentNames.map((name) => (
                      <td key={name} className="text-right py-2 pr-4 font-mono">
                        {r.instruments[name]
                          ? r.instruments[name].value.toFixed(3)
                          : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Linearity / Regression Summary */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Linearity Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Comparison</th>
                  <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Slope</th>
                  <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Intercept</th>
                  <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Prop. Bias</th>
                  <th className="text-right py-2 pr-4 text-muted-foreground font-medium">R²</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(regression).map(([name, reg]) => (
                  <tr key={name} className="border-b border-border/40">
                    <td className="py-2 pr-4 font-medium">{name}</td>
                    <td className="text-right py-2 pr-4 font-mono">{reg.slope.toFixed(4)}</td>
                    <td className="text-right py-2 pr-4 font-mono">{reg.intercept.toFixed(4)}</td>
                    <td className="text-right py-2 pr-4 font-mono">
                      <span className={Math.abs(reg.proportionalBias) < study.cliaAllowableError ? "text-green-400" : "text-red-400"}>
                        {(reg.proportionalBias * 100).toFixed(2)}%
                      </span>
                    </td>
                    <td className="text-right py-2 pr-4 font-mono">{reg.r2.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Evaluation of Results */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Evaluation of Results</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">{results.summary}</p>
          <div className={`mt-4 p-3 rounded-lg border ${overallPass ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
            <div className="flex items-center gap-2">
              {overallPass ? (
                <CheckCircle2 size={16} className="text-green-400" />
              ) : (
                <XCircle size={16} className="text-red-400" />
              )}
              <span className={`text-sm font-semibold ${overallPass ? "text-green-400" : "text-red-400"}`}>
                Overall: {overallPass ? "PASS" : "FAIL"} — {passCount}/{totalCount} results within TEa of ±{cliaPercent}%
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* User Specs */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">User Specifications</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-xs">
            {[
              ["Allowable Total Error", `${cliaPercent}%`],
              ["Systematic Error Budget", "100%"],
              ["Allowable Systematic Error", `${cliaPercent}%`],
              ["Analyst", study.analyst],
              ["Date", study.date],
              ["Instruments", instrumentNames.join(", ")],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between py-1.5 border-b border-border/40">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium">{value}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="mt-6 flex gap-3 justify-end">
        <Button asChild variant="outline">
          <Link href="/study/new">Run Another Study</Link>
        </Button>
        <Button
          onClick={() => generatePDF(study, results)}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <FileDown size={14} className="mr-1.5" />
          Download PDF Report
        </Button>
      </div>
    </div>
  );
}
