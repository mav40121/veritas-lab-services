import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  Lock,
  Map as MapIcon,
  Layers,
  Link2,
  Search,
  ChevronRight,
} from "lucide-react";

interface LabwideAnalyte {
  test_id: number;
  map_id: number;
  map_name: string;
  analyte: string;
  specialty: string | null;
  complexity: string | null;
  department: string | null;
  instrument: string | null;
  last_cal_ver: string | null;
  last_method_comp: string | null;
  last_precision: string | null;
  last_sop_review: string | null;
  updated_at: string;
}

interface LabwideSourceMap {
  id: number;
  name: string;
  updated_at: string;
}

interface LabwideDuplicate {
  analyte_key: string;
  occurrences: Array<{ map_id: number; map_name: string; test_id: number }>;
}

interface LabwideResponse {
  analytes: LabwideAnalyte[];
  sourceMaps: LabwideSourceMap[];
  duplicates: LabwideDuplicate[];
  totals: { mapCount: number; analyteCount: number; departmentCount: number };
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "-";
  }
}

export default function VeritaMapLabwidePage() {
  const { isLoggedIn } = useAuth();
  const [, navigate] = useLocation();
  // Preserve active lab in navigation so clicking a row on the labwide
  // page doesn't bounce the user to their default lab via the legacy
  // /veritamap-app redirect.
  const activeLabId = useActiveLabId();
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [mapFilter, setMapFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<LabwideResponse>({
    queryKey: ["/api/veritamap/labwide"],
    enabled: isLoggedIn,
  });

  const dupSet = useMemo(() => {
    const s = new Set<string>();
    if (!data) return s;
    for (const d of data.duplicates) s.add(d.analyte_key);
    return s;
  }, [data]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    if (!data) return [];
    for (const a of data.analytes) {
      if (a.department) set.add(a.department);
    }
    return Array.from(set).sort();
  }, [data]);

  // Per-column sortable headers. Default is Analyte ascending. Date columns
  // use a "9999-12-31" sentinel for nulls so missing dates sort to the end
  // on ascending order.
  type LabwideSortField =
    | "analyte"
    | "department"
    | "specialty"
    | "complexity"
    | "map_name"
    | "instrument"
    | "last_cal_ver"
    | "last_method_comp"
    | "last_precision"
    | "last_sop_review";
  const [sortField, setSortField] = useState<LabwideSortField>("analyte");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const handleSort = (field: LabwideSortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  };

  const filtered = useMemo(() => {
    if (!data) return [] as LabwideAnalyte[];
    const q = search.trim().toLowerCase();
    const base = data.analytes.filter((a) => {
      if (departmentFilter !== "all" && (a.department ?? "") !== departmentFilter) return false;
      if (mapFilter !== "all" && String(a.map_id) !== mapFilter) return false;
      if (q) {
        const hay = `${a.analyte ?? ""} ${a.instrument ?? ""} ${a.specialty ?? ""} ${a.map_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const valueFor = (a: LabwideAnalyte, f: LabwideSortField): string => {
      switch (f) {
        case "analyte":          return (a.analyte ?? "").toLowerCase();
        case "department":       return (a.department ?? "").toLowerCase();
        case "specialty":        return (a.specialty ?? "").toLowerCase();
        case "complexity":       return (a.complexity ?? "").toLowerCase();
        case "map_name":         return (a.map_name ?? "").toLowerCase();
        case "instrument":       return (a.instrument ?? "").toLowerCase();
        case "last_cal_ver":     return a.last_cal_ver ?? "9999-12-31";
        case "last_method_comp": return a.last_method_comp ?? "9999-12-31";
        case "last_precision":   return a.last_precision ?? "9999-12-31";
        case "last_sop_review":  return a.last_sop_review ?? "9999-12-31";
      }
    };
    return [...base].sort((a, b) => {
      const av = valueFor(a, sortField);
      const bv = valueFor(b, sortField);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [data, search, departmentFilter, mapFilter, sortField, sortDir]);

  const LabwideSortHeader = ({ field, children, className }: { field: LabwideSortField; children: React.ReactNode; className?: string }) => {
    const isActive = sortField === field;
    return (
      <th
        className={`text-left font-medium px-3 py-2 cursor-pointer hover:text-[#01696F] select-none ${className ?? ""}`}
        onClick={() => handleSort(field)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          {isActive ? (
            <span className="text-xs text-[#01696F]">{sortDir === "asc" ? "▲" : "▼"}</span>
          ) : (
            <span className="text-xs text-muted-foreground/40">{"↕"}</span>
          )}
        </span>
      </th>
    );
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-4">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Sign in to access VeritaMap</h1>
          <p className="text-muted-foreground text-sm mb-6">
            VeritaMap requires an account. Sign in to continue.
          </p>
          <Button asChild>
            <Link href="/login">Sign In</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="justify-start -ml-2 text-muted-foreground h-7 text-xs px-2 mb-2"
          >
            <Link href={activeLabId ? `/labs/${activeLabId}/veritamap-app` : "/veritamap-app"}>
              <ArrowLeft size={12} className="mr-1" /> All Maps
            </Link>
          </Button>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">Whole-lab menu</h1>
            <Badge variant="outline" className="text-xs bg-primary/5 text-primary border-primary/20">
              Read-only
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Combined view of every analyte across all your maps. Use this to spot duplicates
            across departments and confirm full menu coverage without leaving your active map.
          </p>
        </div>

        {/* Toggle: show This map / Whole lab */}
        <div className="hidden sm:flex items-center gap-1 rounded-md border border-border bg-card p-0.5 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs px-3"
            onClick={() => navigate(activeLabId ? `/labs/${activeLabId}/veritamap-app` : "/veritamap-app")}
          >
            This map
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs px-3 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Whole lab
          </Button>
        </div>
      </div>

      {/* Totals */}
      {!isLoading && data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
                Maps
              </div>
              <div className="text-2xl font-bold tabular-nums flex items-center gap-1.5">
                <MapIcon size={16} className="text-primary" />
                {data.totals.mapCount}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
                Analytes
              </div>
              <div className="text-2xl font-bold tabular-nums">
                {data.totals.analyteCount}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
                Departments
              </div>
              <div className="text-2xl font-bold tabular-nums flex items-center gap-1.5">
                <Layers size={16} className="text-primary" />
                {data.totals.departmentCount}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
                Duplicates
              </div>
              <div className="text-2xl font-bold tabular-nums flex items-center gap-1.5">
                <Link2 size={16} className={dupSet.size > 0 ? "text-amber-600" : "text-muted-foreground"} />
                {dupSet.size}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search analyte, instrument, specialty, map…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
          <SelectTrigger className="w-full md:w-48 h-9 text-sm">
            <SelectValue placeholder="All departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={mapFilter} onValueChange={setMapFilter}>
          <SelectTrigger className="w-full md:w-48 h-9 text-sm">
            <SelectValue placeholder="All maps" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All maps</SelectItem>
            {data?.sourceMaps.map((m) => (
              <SelectItem key={m.id} value={String(m.id)}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 rounded bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && data && data.totals.mapCount === 0 && (
        <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
          <MapIcon size={36} className="text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold mb-1">No maps yet</h3>
          <p className="text-sm text-muted-foreground mb-5 max-w-xs mx-auto">
            Create a map to start tracking your test menu.
          </p>
          <Button asChild className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <Link href={activeLabId ? `/labs/${activeLabId}/veritamap-app` : "/veritamap-app"}>Go to All Maps</Link>
          </Button>
        </div>
      )}

      {!isLoading && data && data.totals.mapCount > 0 && filtered.length === 0 && (
        <div className="text-center py-12 border border-dashed border-border rounded-lg text-sm text-muted-foreground">
          No analytes match your filters.
        </div>
      )}

      {/* Table */}
      {!isLoading && filtered.length > 0 && (
        <TooltipProvider>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <LabwideSortHeader field="analyte">Analyte</LabwideSortHeader>
                  <LabwideSortHeader field="department">Department</LabwideSortHeader>
                  <LabwideSortHeader field="specialty">Specialty</LabwideSortHeader>
                  <LabwideSortHeader field="complexity">Complexity</LabwideSortHeader>
                  <LabwideSortHeader field="map_name">Source map</LabwideSortHeader>
                  <LabwideSortHeader field="instrument">Instrument</LabwideSortHeader>
                  <LabwideSortHeader field="last_cal_ver">Last cal ver</LabwideSortHeader>
                  <LabwideSortHeader field="last_method_comp">Last method comp</LabwideSortHeader>
                  <LabwideSortHeader field="last_precision">Last precision</LabwideSortHeader>
                  <LabwideSortHeader field="last_sop_review">Last SOP review</LabwideSortHeader>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const isDup = dupSet.has((a.analyte ?? "").toLowerCase().trim());
                  return (
                    <tr
                      key={`${a.map_id}:${a.test_id}`}
                      className="border-t border-border hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => navigate(activeLabId
                        ? `/labs/${activeLabId}/veritamap-app/${a.map_id}`
                        : `/veritamap-app/${a.map_id}`)}
                    >
                      <td className="px-3 py-2 font-medium">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate">{a.analyte}</span>
                          {isDup && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center text-amber-600">
                                  <Link2 size={12} />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                Same analyte appears in 2 or more maps. Consider linking via
                                method comparison so results stay aligned across departments.
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{a.department ?? "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{a.specialty ?? "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{a.complexity ?? "-"}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/veritamap-app/${a.map_id}`}
                          className="text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {a.map_name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{a.instrument ?? "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{formatDate(a.last_cal_ver)}</td>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{formatDate(a.last_method_comp)}</td>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{formatDate(a.last_precision)}</td>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{formatDate(a.last_sop_review)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <ChevronRight size={14} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TooltipProvider>
      )}

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          Showing {filtered.length} of {data?.totals.analyteCount ?? 0} analytes. Click any row to
          jump back to its source map.
        </p>
      )}
    </div>
  );
}
