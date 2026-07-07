import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { useSEO } from "@/hooks/useSEO";
import { authHeaders } from "@/lib/auth";
import { ChevronLeft, ListChecks, GitCompare, Download, ArrowUpDown, Unlink } from "lucide-react";

type LinearityStatus = "covered" | "review" | "missing" | "exempt";
type CoverageRow = {
  instrumentTestId: number; specialty: string; analyte: string; instrument: string;
  linearityExemptMultical: boolean; linearityExemptNoncal: boolean; linearityRequired: boolean;
  linearityStatus: LinearityStatus; studyIds: number[]; verdict: string; signed: boolean;
};
type MethodComparisonRow = { analyte: string; instruments: string[]; hasStudy: boolean; studyId: number | null; verdict: string; signed: boolean };
type UnmappedStudy = { id: number; testName: string; studyType: string; instrument: string; date: string; verdict: string; signed: boolean; coverageAnalyte: string };
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
  unmappedStudies: UnmappedStudy[];
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

const isFail = (verdict: string) => /fail/i.test(verdict || "");

const UNMAPPED_TYPE_LABEL: Record<string, string> = {
  method_comparison: "Correlation / Method Comparison",
  correlation: "Correlation / Method Comparison",
  cal_ver: "Calibration Verification / Linearity",
  linearity: "Calibration Verification / Linearity",
};
const unmappedTypeLabel = (t: string) => UNMAPPED_TYPE_LABEL[t] || t;

// A row is "covered" when a study exists, but a study that FAILED did not verify
// the method, so it must not read as green. A documented failure is a SOLID red
// chip (heavier alarm); "Missing" (no study on file at all) stays a hollow red
// OUTLINE (a gap to fill), so the two never read as the same badge.
function linearityBadge(r: CoverageRow) {
  if (r.linearityStatus === "covered" && isFail(r.verdict)) {
    return <Badge variant="destructive" className="text-[10px]">Failed</Badge>;
  }
  return statusBadge(r.linearityStatus);
}

type SortKey = "analyte" | "instrument" | "status";
type SortState = { key: SortKey | null; dir: "asc" | "desc" };

// Clickable column header for the Cal Ver / Linearity table. Click to sort, click
// again to reverse. Instrument sort is the main ask (group a lab's rows by analyzer).
function SortTh({ label, k, sort, setSort }: { label: string; k: SortKey; sort: SortState; setSort: (u: (s: SortState) => SortState) => void }) {
  const active = sort.key === k;
  return (
    <th className="py-2 px-3 font-medium">
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }))} data-testid={`cov-sort-${k}`}>
        {label}<ArrowUpDown size={11} className={active ? "text-foreground" : "opacity-40"} />
      </button>
    </th>
  );
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
  const [, navigate] = useLocation();
  const labId = useActiveLabId();
  const [specialty, setSpecialty] = useState("all");
  const [status, setStatus] = useState("attention"); // attention = missing + review + covered-but-failed
  const [sort, setSort] = useState<SortState>({ key: null, dir: "asc" }); // null = server order (specialty, status, analyte)
  const openStudy = (id?: number | null) => { if (id) navigate(labRoute(`/study/${id}/results`)); };
  const [exporting, setExporting] = useState(false);
  const downloadReport = async () => {
    if (exporting || !coverageUrl) return;
    setExporting(true);
    try {
      const res = await fetch(`${coverageUrl}/export`, { headers: authHeaders() });
      if (!res.ok) { toast({ title: "Coverage export failed", variant: "destructive" }); return; }
      const cd = res.headers.get("Content-Disposition") || "";
      const m = /filename="([^"]+)"/.exec(cd);
      const filename = m ? m[1] : `VeritaCheck_Coverage_${new Date().toISOString().split("T")[0]}.xlsx`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { toast({ title: "Coverage export failed", variant: "destructive" }); }
    finally { setExporting(false); }
  };

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

  // Align a study (whose name matches no map analyte) to the analyte it satisfies,
  // or clear it (analyte ""). Coverage then credits it without renaming the study.
  const alignMut = useMutation({
    mutationFn: (b: { studyId: number; analyte: string }) => apiRequest("POST", `${coverageUrl}/align`, b),
    onSuccess: (_r, b) => {
      queryClient.invalidateQueries({ queryKey: [coverageUrl] });
      toast({ title: b.analyte ? `Aligned to ${b.analyte}` : "Alignment cleared" });
    },
    onError: () => toast({ title: "Could not align the study", variant: "destructive" }),
  });
  // Distinct map analytes the director can align a study to (from the coverage rows
  // and method comparisons), sorted for the dropdown.
  const mapAnalyteOptions = useMemo(
    () => Array.from(new Set([...(data?.rows || []).map((r) => r.analyte), ...(data?.methodComparisons || []).map((m) => m.analyte)])).sort((a, b) => a.localeCompare(b)),
    [data],
  );
  const unalignedCount = useMemo(() => (data?.unmappedStudies || []).filter((u) => !u.coverageAnalyte).length, [data]);

  const specialties = useMemo(() => Array.from(new Set((data?.rows || []).map((r) => r.specialty))).sort(), [data]);
  const rows = useMemo(() => {
    let r = data?.rows || [];
    if (specialty !== "all") r = r.filter((x) => x.specialty === specialty);
    if (status === "attention") r = r.filter((x) => x.linearityStatus === "missing" || x.linearityStatus === "review" || (x.linearityStatus === "covered" && isFail(x.verdict)));
    else if (status !== "all") r = r.filter((x) => x.linearityStatus === status);
    if (sort.key) {
      const rank: Record<string, number> = { missing: 0, review: 1, covered: 2, exempt: 3 };
      r = r.slice().sort((a, b) => {
        let c = 0;
        if (sort.key === "instrument") c = (a.instrument || "").localeCompare(b.instrument || "") || a.analyte.localeCompare(b.analyte);
        else if (sort.key === "analyte") c = a.analyte.localeCompare(b.analyte);
        else c = (rank[a.linearityStatus] ?? 9) - (rank[b.linearityStatus] ?? 9) || a.analyte.localeCompare(b.analyte);
        return sort.dir === "asc" ? c : -c;
      });
    }
    return r;
  }, [data, specialty, status, sort]);

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
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h1 className="font-serif text-2xl font-bold mb-1">Coverage</h1>
        <Button variant="outline" size="sm" onClick={downloadReport} disabled={exporting} data-testid="button-coverage-export">
          <Download size={14} className="mr-2" />{exporting ? "Preparing..." : "Download report"}
        </Button>
      </div>
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
                <tr key={m.analyte} className={`border-b border-border/60 ${m.hasStudy ? "cursor-pointer hover:bg-muted/40" : ""}`} onClick={() => openStudy(m.studyId)} title={m.hasStudy ? "Open study" : undefined}>
                  <td className="py-2 px-3">{m.analyte}</td>
                  <td className="py-2 px-3 text-muted-foreground text-xs">{m.instruments.join(", ")}</td>
                  <td className="py-2 px-3">{m.hasStudy
                    ? (isFail(m.verdict)
                        ? <Badge variant="destructive" className="text-[10px]">#{m.studyId} FAIL</Badge>
                        : <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600">#{m.studyId}{m.signed ? " signed" : ""}</Badge>)
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
              <SortTh label="Analyte" k="analyte" sort={sort} setSort={setSort} />
              <SortTh label="Instrument" k="instrument" sort={sort} setSort={setSort} />
              <SortTh label="Status" k="status" sort={sort} setSort={setSort} />
              <th className="py-2 px-3 font-medium">Study</th>
              <th className="py-2 px-3 font-medium text-center">3+ cal</th><th className="py-2 px-3 font-medium text-center">Not calibratable</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground text-sm">Nothing matches this filter.</td></tr>}
              {rows.map((r) => (
                <tr key={r.instrumentTestId} className={`border-b border-border/60 ${r.studyIds.length ? "cursor-pointer hover:bg-muted/40" : ""}`} data-testid={`cov-row-${r.instrumentTestId}`} onClick={() => openStudy(r.studyIds[0])} title={r.studyIds.length ? "Open study" : undefined}>
                  <td className="py-2 px-3">{r.analyte}</td>
                  <td className="py-2 px-3 text-muted-foreground text-xs">{r.instrument}</td>
                  <td className="py-2 px-3">{linearityBadge(r)}</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{r.studyIds.length ? r.studyIds.map((i) => `#${i}`).join(", ") : ""}</td>
                  <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={r.linearityExemptMultical} onCheckedChange={(v) => setExempt(r, "multical", !!v)} data-testid={`cov-multical-${r.instrumentTestId}`} />
                  </td>
                  <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={r.linearityExemptNoncal} onCheckedChange={(v) => setExempt(r, "noncal", !!v)} data-testid={`cov-noncal-${r.instrumentTestId}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent></Card>

      {/* Unaligned studies — verification work on file that matches no map analyte */}
      {(data.unmappedStudies?.length ?? 0) > 0 && (
        <>
          <div className="flex items-center gap-2 mb-2 mt-8">
            <Unlink size={16} className="text-primary" />
            <h2 className="font-semibold">Unaligned studies ({unalignedCount}{unalignedCount !== data.unmappedStudies.length ? ` of ${data.unmappedStudies.length}` : ""})</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Verification studies on file whose name does not match any analyte on this lab's VeritaMap, so they are not credited to a coverage row above and the required point still reads Missing. Usually a naming difference (a study titled "AST" versus the map's "Aspartate aminotransferase (AST)") or a typo. Pick the map analyte each study satisfies to align it. The study keeps its own name; Coverage then credits it.
          </p>
          <Card className="mb-8"><CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 px-3 font-medium">Study</th><th className="py-2 px-3 font-medium">Type</th>
                  <th className="py-2 px-3 font-medium">Instrument</th><th className="py-2 px-3 font-medium">Date</th>
                  <th className="py-2 px-3 font-medium">Verdict</th><th className="py-2 px-3 font-medium">Align to map analyte</th>
                </tr></thead>
                <tbody>
                  {data.unmappedStudies.map((u) => (
                    <tr key={u.id} className={`border-b border-border/60 ${u.coverageAnalyte ? "bg-emerald-500/5" : ""}`} data-testid={`cov-unmapped-${u.id}`}>
                      <td className="py-2 px-3 cursor-pointer hover:underline" onClick={() => openStudy(u.id)} title="Open study">{u.testName}</td>
                      <td className="py-2 px-3 text-muted-foreground text-xs">{unmappedTypeLabel(u.studyType)}</td>
                      <td className="py-2 px-3 text-muted-foreground text-xs">{u.instrument}</td>
                      <td className="py-2 px-3 text-muted-foreground text-xs">{u.date}</td>
                      <td className="py-2 px-3">{isFail(u.verdict)
                        ? <Badge variant="destructive" className="text-[10px]">#{u.id} FAIL</Badge>
                        : <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600">#{u.id}{u.signed ? " signed" : ""}</Badge>}</td>
                      <td className="py-2 px-3">
                        {u.coverageAnalyte ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600">Aligned → {u.coverageAnalyte}</Badge>
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" data-testid={`cov-align-clear-${u.id}`} disabled={alignMut.isPending} onClick={() => alignMut.mutate({ studyId: u.id, analyte: "" })}>Clear</Button>
                          </div>
                        ) : (
                          <Select value="" onValueChange={(v) => alignMut.mutate({ studyId: u.id, analyte: v })}>
                            <SelectTrigger className="h-8 w-[240px] text-xs" data-testid={`cov-align-select-${u.id}`}><SelectValue placeholder="Align to…" /></SelectTrigger>
                            <SelectContent className="max-h-72">
                              {mapAnalyteOptions.map((a) => <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent></Card>
        </>
      )}
    </div>
  );
}
