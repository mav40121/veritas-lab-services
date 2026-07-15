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
  linearityExemptMultical: boolean; linearityExemptNoncal: boolean; linearityExemptWaived: boolean; linearityExemptOther: string; linearityRequired: boolean;
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

// The Method-comparisons table has its own columns (Analyte / Instruments /
// Study / Verdict) and its own sort state, independent of the Cal Ver table above
// so clicking one never reorders the other. Distinct testid prefix (cov-mc-sort-)
// keeps the two header sets from colliding in the DOM.
type McSortKey = "analyte" | "instruments" | "study" | "verdict";
type McSortState = { key: McSortKey | null; dir: "asc" | "desc" };
function McSortTh({ label, k, sort, setSort, className }: { label: string; k: McSortKey; sort: McSortState; setSort: (u: (s: McSortState) => McSortState) => void; className?: string }) {
  const active = sort.key === k;
  return (
    <th className={`py-2 px-3 font-medium ${className || ""}`}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }))} data-testid={`cov-mc-sort-${k}`}>
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
  const [mcSpecialty, setMcSpecialty] = useState("all");
  const [mcStatus, setMcStatus] = useState("attention"); // attention = missing + documented FAIL
  const [sort, setSort] = useState<SortState>({ key: null, dir: "asc" }); // null = server order (specialty, status, analyte)
  const [mcSort, setMcSort] = useState<McSortState>({ key: null, dir: "asc" }); // null = default order (missing first, then studies on file)
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
    mutationFn: (b: { instrumentTestId: number; multical: boolean; noncal: boolean; waived: boolean; otherReason: string }) =>
      apiRequest("PATCH", `${coverageUrl}/exemption`, b),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [coverageUrl] }),
    onError: () => toast({ title: "Could not update the exemption", variant: "destructive" }),
  });
  // Send the full exemption state on every change; the caller supplies one changed
  // field and the rest come from the row so a checkbox toggle never wipes another.
  const applyExempt = (r: CoverageRow, patch: Partial<{ multical: boolean; noncal: boolean; waived: boolean; otherReason: string }>) =>
    exemptMut.mutate({
      instrumentTestId: r.instrumentTestId,
      multical: patch.multical ?? r.linearityExemptMultical,
      noncal: patch.noncal ?? r.linearityExemptNoncal,
      waived: patch.waived ?? r.linearityExemptWaived,
      otherReason: patch.otherReason ?? r.linearityExemptOther,
    });
  const setExempt = (r: CoverageRow, which: "multical" | "noncal" | "waived", checked: boolean) =>
    applyExempt(r, { [which]: checked });

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
  // Split the name-mismatch studies into a "still needs alignment" queue and an
  // "already aligned" set so an aligned study drops out of the to-do list but
  // stays reviewable (and clearable) under a collapsed section.
  const needAlignStudies = useMemo(() => (data?.unmappedStudies || []).filter((u) => !u.coverageAnalyte), [data]);
  const alignedStudies = useMemo(() => (data?.unmappedStudies || []).filter((u) => u.coverageAnalyte), [data]);
  const renderUnmappedRow = (u: any) => (
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
            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600">Aligned &rarr; {u.coverageAnalyte}</Badge>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" data-testid={`cov-align-clear-${u.id}`} disabled={alignMut.isPending} onClick={() => alignMut.mutate({ studyId: u.id, analyte: "" })}>Clear</Button>
          </div>
        ) : (
          <Select value="" onValueChange={(v) => alignMut.mutate({ studyId: u.id, analyte: v })}>
            <SelectTrigger className="h-8 w-[240px] text-xs" data-testid={`cov-align-select-${u.id}`}><SelectValue placeholder="Align to…" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {mapAnalyteOptions.map((a: any) => <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </td>
    </tr>
  );
  const renderUnmappedTable = (rows: any[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted-foreground border-b border-border">
          <th className="py-2 px-3 font-medium">Study</th><th className="py-2 px-3 font-medium">Type</th>
          <th className="py-2 px-3 font-medium">Instrument</th><th className="py-2 px-3 font-medium">Date</th>
          <th className="py-2 px-3 font-medium">Verdict</th><th className="py-2 px-3 font-medium">Align to map analyte</th>
        </tr></thead>
        <tbody>{rows.map(renderUnmappedRow)}</tbody>
      </table>
    </div>
  );

  const specialties = useMemo(() => Array.from(new Set((data?.rows || []).map((r) => r.specialty))).sort(), [data]);
  // Method-comparison rows carry no specialty of their own; derive it from the
  // cal-ver rows (every map analyte appears there) so the MC section can filter
  // by specialty the same way the Cal Ver / Linearity section does.
  const analyteSpecialty = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of data?.rows || []) if (!m.has(r.analyte)) m.set(r.analyte, r.specialty);
    return m;
  }, [data]);
  const mcSpecialties = useMemo(() => {
    const set = new Set<string>();
    for (const m of data?.methodComparisons || []) { const sp = analyteSpecialty.get(m.analyte); if (sp) set.add(sp); }
    return Array.from(set).sort();
  }, [data, analyteSpecialty]);
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

  const mcRows = useMemo(() => {
    let base = data?.methodComparisons || [];
    if (mcSpecialty !== "all") base = base.filter((m) => analyteSpecialty.get(m.analyte) === mcSpecialty);
    if (mcStatus === "attention") base = base.filter((m) => !m.hasStudy || isFail(m.verdict));
    else if (mcStatus === "missing") base = base.filter((m) => !m.hasStudy);
    else if (mcStatus === "onfile") base = base.filter((m) => m.hasStudy && !isFail(m.verdict));
    else if (mcStatus === "fail") base = base.filter((m) => m.hasStudy && isFail(m.verdict));
    // Default (unsorted) order: gaps first, then studies on file — the original layout.
    if (!mcSort.key) return base.filter((m) => !m.hasStudy).concat(base.filter((m) => m.hasStudy));
    // Study column sorts by state: missing (0) < documented FAIL (1) < study on file (2).
    const studyRank = (m: MethodComparisonRow) => (!m.hasStudy ? 0 : isFail(m.verdict) ? 1 : 2);
    const val = (m: MethodComparisonRow): string | number => {
      switch (mcSort.key) {
        case "instruments": return m.instruments.join(", ").toLowerCase();
        case "study": return studyRank(m);
        case "verdict": return (m.verdict || "").toLowerCase();
        default: return m.analyte.toLowerCase();
      }
    };
    return base.slice().sort((a, b) => {
      const va = val(a), vb = val(b);
      let c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      if (c === 0) c = a.analyte.localeCompare(b.analyte); // stable tiebreak by analyte
      return mcSort.dir === "asc" ? c : -c;
    });
  }, [data, mcSort, mcSpecialty, mcStatus, analyteSpecialty]);

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
        <Tile label="Linearity not required" value={String(s.linearityExempt)} sub="3+ cal, not calibratable, waived, or other" />
        <Tile label="Analyte x instrument combos" value={String(s.combos)} sub={`${s.instruments} instruments`} />
      </div>

      {/* Method comparisons */}
      <div className="flex items-center gap-2 mb-2">
        <GitCompare size={16} className="text-primary" />
        <h2 className="font-semibold">Method comparisons ({mcMissing} missing)</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-3">An analyte reported off two or more instruments needs the instruments correlated.</p>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Select value={mcSpecialty} onValueChange={setMcSpecialty}>
          <SelectTrigger className="w-52 h-8 text-xs" data-testid="mc-specialty-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All specialties</SelectItem>
            {mcSpecialties.map((sp) => <SelectItem key={sp} value={sp}>{sp}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={mcStatus} onValueChange={setMcStatus}>
          <SelectTrigger className="w-48 h-8 text-xs" data-testid="mc-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="attention">Needs attention</SelectItem>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="missing">Missing</SelectItem>
            <SelectItem value="onfile">On file</SelectItem>
            <SelectItem value="fail">Failed</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{mcRows.length} shown</span>
      </div>
      <Card className="mb-8"><CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground border-b border-border">
              <McSortTh label="Analyte" k="analyte" sort={mcSort} setSort={setMcSort} />
              <McSortTh label="Instruments" k="instruments" sort={mcSort} setSort={setMcSort} />
              <McSortTh label="Study" k="study" sort={mcSort} setSort={setMcSort} />
              <McSortTh label="Verdict" k="verdict" sort={mcSort} setSort={setMcSort} />
            </tr></thead>
            <tbody>
              {mcRows.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted-foreground text-sm">Nothing matches this filter.</td></tr>}
              {mcRows.map((m) => (
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
        Required per analyte and instrument, unless the method uses 3 or more calibrators (the calibration verifies the range), the analyzer cannot be calibrated (e.g. a blood-gas analyzer), the test is CLIA-waived or qualitative (no linearity to verify), or another documented reason applies. Check a box, or type an "Other" reason, to drop it from the required set.
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
              <th className="py-2 px-3 font-medium text-center">Waived (not rqd)</th><th className="py-2 px-3 font-medium">Other</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-muted-foreground text-sm">Nothing matches this filter.</td></tr>}
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
                  <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={r.linearityExemptWaived} onCheckedChange={(v) => setExempt(r, "waived", !!v)} data-testid={`cov-waived-${r.instrumentTestId}`} />
                  </td>
                  <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      key={`other-${r.instrumentTestId}-${r.linearityExemptOther}`}
                      defaultValue={r.linearityExemptOther}
                      placeholder="reason…"
                      data-testid={`cov-other-${r.instrumentTestId}`}
                      className="h-7 w-36 rounded border border-border bg-background px-2 text-xs"
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r.linearityExemptOther || "")) applyExempt(r, { otherReason: v }); }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent></Card>

      {/* Studies to align: verification work on file that matches no map analyte by name */}
      {(data.unmappedStudies?.length ?? 0) > 0 && (
        <>
          <div className="flex items-center gap-2 mb-2 mt-8">
            <Unlink size={16} className="text-primary" />
            <h2 className="font-semibold">Studies to align</h2>
            <Badge variant="outline" className={`text-[10px] ${unalignedCount > 0 ? "border-amber-500/40 text-amber-600" : "border-emerald-500/40 text-emerald-600"}`}>
              {unalignedCount > 0 ? `${unalignedCount} need${unalignedCount === 1 ? "s" : ""} alignment` : "All aligned"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            These verification studies don't match a VeritaMap analyte by name (for example, a study titled "AST" versus the map's "Aspartate aminotransferase (AST)"), so Coverage can't credit them automatically. Align each to the analyte it satisfies; the study keeps its own name and Coverage credits it once the instrument also matches.
          </p>
          {needAlignStudies.length > 0 && (
            <Card className="mb-4"><CardContent className="p-0">
              {renderUnmappedTable(needAlignStudies)}
            </CardContent></Card>
          )}
          {alignedStudies.length > 0 && (
            <details className="mb-8">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground mb-2">
                {needAlignStudies.length > 0
                  ? `Show ${alignedStudies.length} aligned stud${alignedStudies.length === 1 ? "y" : "ies"}`
                  : `${alignedStudies.length} aligned stud${alignedStudies.length === 1 ? "y" : "ies"} (review or clear)`}
              </summary>
              <Card className="mt-2"><CardContent className="p-0">
                {renderUnmappedTable(alignedStudies)}
              </CardContent></Card>
            </details>
          )}
        </>
      )}
    </div>
  );
}
