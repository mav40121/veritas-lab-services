import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, CheckCircle2, Lock, ClipboardList, ChevronRight,
} from "lucide-react";

interface ViolationRow {
  id: number;
  rule_code: string;
  severity: "warning" | "rejection";
  detail: string | null;
  evaluated_at: string;
}
interface CARow {
  id: number;
  action_taken: string;
  status: string;
  taken_at: string;
}
interface RecentResult {
  id: number;
  control_lot_id: number;
  analyte: string;
  lot_number: string;
  level: string;
  instrument: string | null;
  result_value: number;
  result_date: string;
  run_time: string | null;
  accepted_for_reporting: number;
  violations: ViolationRow[];
  corrective_actions: CARow[];
}

type StatusFilter = "any" | "with_violation" | "missing_ca";
type DateFilter = "7d" | "30d" | "all";

function dateNDaysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function severityColor(severity: string): string {
  return severity === "rejection"
    ? "bg-red-500/10 text-red-700 border-red-500/20"
    : "bg-amber-500/10 text-amber-700 border-amber-500/20";
}

// Group results by control_lot_id so each analyte/lot is rendered as a
// section header followed by its rows. Preserves the newest-first order
// from the server (groups appear in order of their most-recent result).
function groupByLot(rows: RecentResult[]): Array<{ key: string; analyte: string; lot_number: string; level: string; rows: RecentResult[] }> {
  const seen: Record<number, { key: string; analyte: string; lot_number: string; level: string; rows: RecentResult[] }> = {};
  const order: number[] = [];
  for (const r of rows) {
    if (!seen[r.control_lot_id]) {
      seen[r.control_lot_id] = { key: String(r.control_lot_id), analyte: r.analyte, lot_number: r.lot_number, level: r.level, rows: [] };
      order.push(r.control_lot_id);
    }
    seen[r.control_lot_id].rows.push(r);
  }
  return order.map(id => seen[id]);
}

export default function VeritaQCDailyReviewPage() {
  const { user, isLoggedIn } = useAuth();
  const activeLabId = useActiveLabId();

  const hasPlanAccess = !!user && [
    "annual", "professional", "lab", "complete",
    "veritamap", "veritascan", "veritacomp",
    "waived", "community", "hospital", "large_hospital", "enterprise",
  ].includes(user.plan);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("any");
  const [dateFilter, setDateFilter] = useState<DateFilter>("30d");
  const [results, setResults] = useState<RecentResult[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!activeLabId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("limit", "200");
      if (dateFilter === "7d") params.set("since", dateNDaysAgoIso(7));
      else if (dateFilter === "30d") params.set("since", dateNDaysAgoIso(30));
      const res = await fetch(
        `${API_BASE}/api/labs/${activeLabId}/qc/recent?${params.toString()}`,
        { headers: authHeaders() },
      );
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch (err) {
      console.error("Failed to load recent QC:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess && activeLabId) load();
  }, [isLoggedIn, hasPlanAccess, activeLabId, statusFilter, dateFilter]);

  if (!isLoggedIn) {
    return (
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <Card>
          <CardContent className="py-10 text-center">
            <Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <h2 className="text-lg font-semibold mb-1">Sign in to review QC</h2>
            <Button asChild><Link href="/login">Sign in</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (!hasPlanAccess) {
    return (
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <Card>
          <CardContent className="py-10 text-center">
            <Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <h2 className="text-lg font-semibold mb-1">VeritaQC&#8482; requires a subscription</h2>
            <Button asChild><Link href="/pricing">See plans</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (!activeLabId) {
    return (
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">Select a lab to review QC.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const groups = groupByLot(results);
  const entryHref = `/labs/${activeLabId}/veritaqc-app`;

  // Summary counters surface the "what should I look at first" answer.
  const totalRejections = results.reduce(
    (n, r) => n + r.violations.filter(v => v.severity === "rejection").length, 0);
  const missingCA = results.filter(r =>
    r.violations.some(v => v.severity === "rejection") && r.corrective_actions.length === 0
  ).length;

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4">
      <div className="mb-6 flex items-center gap-2">
        <ClipboardList className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">VeritaQC&#8482; Daily Review</h1>
        <Badge variant="outline" className="ml-2 text-xs">Phase 1 preview</Badge>
        <div className="ml-auto">
          <Button asChild variant="outline" size="sm">
            <Link href={entryHref}>Entry page</Link>
          </Button>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="py-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Date range</div>
              <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Status</div>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">All results</SelectItem>
                  <SelectItem value="with_violation">With any rule fired</SelectItem>
                  <SelectItem value="missing_ca">Missing corrective action</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 grid grid-cols-2 gap-2 sm:gap-3 text-center">
              <div className="rounded-md border border-border bg-muted/50 px-3 py-2">
                <div className="text-xl font-bold tabular-nums">{totalRejections}</div>
                <div className="text-xs text-muted-foreground">Rejection-rule fires in window</div>
              </div>
              <div className={`rounded-md border px-3 py-2 ${missingCA > 0 ? "border-red-500/30 bg-red-500/5" : "border-border bg-muted/50"}`}>
                <div className={`text-xl font-bold tabular-nums ${missingCA > 0 ? "text-red-700" : ""}`}>{missingCA}</div>
                <div className="text-xs text-muted-foreground">Missing corrective action</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading...</CardContent></Card>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600 mb-2" />
            <p className="text-sm text-muted-foreground">
              No results match these filters. Try widening the date range or status.
            </p>
          </CardContent>
        </Card>
      ) : (
        groups.map(g => (
          <Card key={g.key} className="mb-3">
            <CardHeader className="py-3">
              <CardTitle className="text-base flex items-center gap-2">
                {g.analyte}
                <Badge variant="outline" className="text-xs">Lot {g.lot_number}</Badge>
                <Badge variant="outline" className="text-xs">{g.level}</Badge>
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {g.rows.length} run{g.rows.length === 1 ? "" : "s"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground border-b">
                    <tr>
                      <th className="py-2 pr-2">Date</th>
                      <th className="py-2 pr-2">Value</th>
                      <th className="py-2 pr-2">Instrument</th>
                      <th className="py-2 pr-2">Rules</th>
                      <th className="py-2 pr-2">CA</th>
                      <th className="py-2 pr-2">Accepted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map(r => {
                      const hasRej = r.violations.some(v => v.severity === "rejection");
                      const needsCA = hasRej && r.corrective_actions.length === 0;
                      return (
                        <tr key={r.id} className={`border-b last:border-b-0 ${needsCA ? "bg-red-500/5" : ""}`}>
                          <td className="py-2 pr-2">{r.result_date}</td>
                          <td className="py-2 pr-2 font-mono">{r.result_value}</td>
                          <td className="py-2 pr-2 text-muted-foreground">{r.instrument || "-"}</td>
                          <td className="py-2 pr-2">
                            {r.violations.length === 0 ? (
                              <span className="text-xs text-muted-foreground">none</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {r.violations.map(v => (
                                  <Badge key={v.id} variant="outline" className={severityColor(v.severity)} title={v.detail || ""}>
                                    {v.rule_code}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-xs">
                            {r.corrective_actions.length > 0 ? (
                              <span className="text-muted-foreground">
                                {r.corrective_actions.length} action{r.corrective_actions.length === 1 ? "" : "s"}
                              </span>
                            ) : needsCA ? (
                              <span className="inline-flex items-center gap-1 text-red-700 font-medium">
                                <AlertTriangle className="h-3 w-3" /> missing
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="py-2 pr-2">
                            {r.accepted_for_reporting === 1 ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <span className="text-xs text-amber-700">excluded</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex justify-end">
                <Button asChild variant="ghost" size="sm" className="text-xs">
                  <Link href={entryHref}>
                    Open lot in entry page <ChevronRight className="h-3 w-3 ml-1" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
