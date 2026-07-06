import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { useSEO } from "@/hooks/useSEO";
import { ChevronLeft, ListChecks, GitCompare } from "lucide-react";

type LinearityStatus = "covered" | "review" | "missing" | "exempt";
type CoverageRow = {
  instrumentTestId: number; specialty: string; analyte: string; instrument: string;
  linearityExemptMultical: boolean; linearityExemptNoncal: boolean; linearityRequired: boolean;
  linearityStatus: LinearityStatus; studyIds: number[]; verdict: string; signed: boolean;
};
type MethodComparisonRow = { analyte: string; instruments: string[]; hasStudy: boolean; studyId: number | null; verdict: string; signed: boolean };
type Coverage = {
  hasMap: boolean;
  summary: {
    combos: number; instruments: number; analytes: number; studies: number;
    linearityRequired: number; linearityCovered: number; linearityReview: number; linearityMissing: number; linearityExempt: number;
    methodComparisonsNeeded: number; methodComparisonsDone: number;
    bySpecialty: { specialty: string; combos: number; required: number; covered: number; review: number; missing: number; exempt: number }[];
  };
  rows: CoverageRow[];
  methodComparisons: MethodComparisonRow[];
};

function statusBadge(s: LinearityStatus) {
  const map: Record<LinearityStatus, string> = {
    covered: "border-emerald-500/40 text-emerald-600",
    review: "border-amber-500/40 text-amber-600",
    missing: "border-red-500/40 text-red-600",
    exempt: "border-muted-foreground/30 text-muted-foreground",
  };
  const label = { covered: "Covered", review: "Review", missing: "Missing", exempt: "Not required" }[s];
  return <Badge variant="outline" className={`text-[10px] ${map[s]}`}>{label}</Badge>;
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  const c = tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "bad" ? "text-red-600" : "text-foreground";
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${c}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </CardContent></Card>
  );
}

export default function VeritaCheckCoveragePage() {
  useSEO({ title: "Coverage | VeritaCheck", description: "See what verification your map requires versus the studies you have." });
  const { toast } = useToast();
  const labRoute = useLabRoute();
  const labId = useActiveLabId();
  const [specialty, setSpecialty] = useState("all");
  const [status, setStatus] = useState("attention"); // attention = missing + review

  const coverageUrl = labId ? `/api/labs/${labId}/veritacheck/coverage` : null;
  const { data, isLoading } = useQuery<Coverage>({ queryKey: [coverageUrl], enabled: !!coverageUrl });

  const exemptMut = useMutation({
    mutationFn: (b: { instrumentTestId: number; multical: boolean; noncal: boolean }) =>
      apiRequest("PATCH", `${coverageUrl}/exemption`, b),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [coverageUrl] }),
    onError: () => toast({ title: "Could not update the exemption", variant: "destructive" }),
  });
  const setExempt = (r: CoverageRow, which: "multical" | "noncal", checked: boolean) =>
    exemptMut.mutate({
      instrumentTestId: r.instrumentTestId,
      multical: which === "multical" ? checked : r.linearityExemptMultical,
      noncal: which === "noncal" ? checked : r.linearityExemptNoncal,
    });

  const specialties = useMemo(() => Array.from(new Set((data?.rows || []).map((r) => r.specialty))).sort(), [data]);
  const rows = useMemo(() => {
    let r = data?.rows || [];
    if (specialty !== "all") r = r.filter((x) => x.specialty === specialty);
    if (status === "attention") r = r.filter((x) => x.linearityStatus === "missing" || x.linearityStatus === "review");
    else if (status !== "all") r = r.filter((x) => x.linearityStatus === status);
    return r;
  }, [data, specialty, status]);

  if (!labId) {
    return <div className="max-w-2xl mx-auto px-4 py-16 text-center text-muted-foreground">Pick a lab in the NavBar switcher to view coverage.</div>;
  }
  if (isLoading) return <div className="max-w-4xl mx-auto px-4 py-16 text-center text-muted-foreground">Loading coverage...</div>;
  if (!data?.hasMap) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="font-semibold mb-1">No VeritaMap yet</p>
        <p className="text-sm text-muted-foreground">Coverage compares your VeritaMap (the analytes and instruments you run) against your studies. Build your map in VeritaMap first, then this page fills in.</p>
      </div>
    );
  }

  const s = data.summary;
  const mcMissing = s.methodComparisonsNeeded - s.methodComparisonsDone;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <Link href={labRoute("/dashboard")} className="hover:text-primary inline-flex items-center gap-1"><ChevronLeft size={14} />My Studies</Link>
      </div>
      <h1 className="font-serif text-2xl font-bold mb-1">Coverage</h1>
      <p className="text-sm text-muted-foreground mb-6">
        What your VeritaMap requires versus the studies you have. {s.analytes} analytes across {s.instruments} instruments; {s.studies} studies on file.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Tile label="Method comparisons needed" value={`${s.methodComparisonsDone}/${s.methodComparisonsNeeded}`} sub={mcMissing ? `${mcMissing} missing` : "all done"} tone={mcMissing ? "bad" : "good"} />
        <Tile label="Cal Ver / Linearity required" value={`${s.linearityCovered}/${s.linearityRequired}`} sub={`${s.linearityMissing} missing, ${s.linearityReview} to review`} tone={s.linearityMissing ? "bad" : "good"} />
        <Tile label="Linearity not required" value={String(s.linearityExempt)} sub="3+ calibrators or not calibratable" />
        <Tile label="Analyte x instrument combos" value={String(s.combos)} sub={`${s.instruments} instruments`} />
      </div>

      {/* Method comparisons */}
      <div className="flex items-center gap-2 mb-2">
        <GitCompare size={16} className="text-primary" />
        <h2 className="font-semibold">Method comparisons ({mcMissing} missing)</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-3">An analyte reported off two or more instruments needs the instruments correlated.</p>
      <Card className="mb-8"><CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="py-2 px-3 font-medium">Analyte</th><th className="py-2 px-3 font-medium">Instruments</th>
              <th className="py-2 px-3 font-medium">Study</th><th className="py-2 px-3 font-medium">Verdict</th>
            </tr></thead>
            <tbody>
              {data.methodComparisons.filter((m) => !m.hasStudy).concat(data.methodComparisons.filter((m) => m.hasStudy)).map((m) => (
                <tr key={m.analyte} className="border-b border-border/60">
                  <td className="py-2 px-3">{m.analyte}</td>
                  <td className="py-2 px-3 text-muted-foreground text-xs">{m.instruments.join(", ")}</td>
                  <td className="py-2 px-3">{m.hasStudy
                    ? <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600">#{m.studyId}{m.signed ? " signed" : ""}</Badge>
                    : <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-600">Missing</Badge>}</td>
                  <td className="py-2 px-3 text-xs uppercase text-muted-foreground">{m.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent></Card>

      {/* Linearity coverage */}
      <div className="flex items-center gap-2 mb-2">
        <ListChecks size={16} className="text-primary" />
        <h2 className="font-semibold">Cal Ver / Linearity by analyte and instrument</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Required per analyte and instrument, unless the method uses 3 or more calibrators (the calibration verifies the range) or the analyzer cannot be calibrated (e.g. a blood-gas analyzer). Check the box to drop it from the required set.
      </p>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Select value={specialty} onValueChange={setSpecialty}>
          <SelectTrigger className="w-52 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All specialties</SelectItem>
            {specialties.map((sp) => <SelectItem key={sp} value={sp}>{sp}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="attention">Needs attention</SelectItem>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="missing">Missing</SelectItem>
            <SelectItem value="review">Review</SelectItem>
            <SelectItem value="covered">Covered</SelectItem>
            <SelectItem value="exempt">Not required</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{rows.length} shown</span>
      </div>
      <Card><CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="py-2 px-3 font-medium">Analyte</th><th className="py-2 px-3 font-medium">Instrument</th>
              <th className="py-2 px-3 font-medium">Status</th><th className="py-2 px-3 font-medium">Study</th>
              <th className="py-2 px-3 font-medium text-center">3+ cal</th><th className="py-2 px-3 font-medium text-center">Not calibratable</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground text-sm">Nothing matches this filter.</td></tr>}
              {rows.map((r) => (
                <tr key={r.instrumentTestId} className="border-b border-border/60" data-testid={`cov-row-${r.instrumentTestId}`}>
                  <td className="py-2 px-3">{r.analyte}</td>
                  <td className="py-2 px-3 text-muted-foreground text-xs">{r.instrument}</td>
                  <td className="py-2 px-3">{statusBadge(r.linearityStatus)}</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{r.studyIds.length ? r.studyIds.map((i) => `#${i}`).join(", ") : ""}</td>
                  <td className="py-2 px-3 text-center">
                    <Checkbox checked={r.linearityExemptMultical} onCheckedChange={(v) => setExempt(r, "multical", !!v)} data-testid={`cov-multical-${r.instrumentTestId}`} />
                  </td>
                  <td className="py-2 px-3 text-center">
                    <Checkbox checked={r.linearityExemptNoncal} onCheckedChange={(v) => setExempt(r, "noncal", !!v)} data-testid={`cov-noncal-${r.instrumentTestId}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </div>
  );
}
