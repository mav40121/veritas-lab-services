import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gauge, Lock, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { summarizeRollup, badModules } from "@/lib/readinessRollup";

interface ModuleReadiness {
  key: string; label: string; status: "ok" | "attention" | "overdue"; overdue: number; due_soon: number; total: number; headline: string;
}
interface Readiness {
  lab_id: number; lab_name: string | null; clia_number: string | null;
  modules: ModuleReadiness[];
  overall: { modules_total: number; modules_ok: number; attention_items: number; overdue_items: number; status: "ok" | "attention" | "overdue" };
}

const SUITE_PLANS = ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "clinic", "waived", "community", "hospital", "large_hospital", "enterprise"];

function statusColor(s: string) {
  if (s === "overdue") return "text-red-700 dark:text-red-300";
  if (s === "attention") return "text-amber-700 dark:text-amber-300";
  return "text-emerald-700 dark:text-emerald-300";
}
function StatusIcon({ s, className = "h-4 w-4" }: { s: string; className?: string }) {
  if (s === "overdue") return <XCircle className={`${className} text-red-600`} />;
  if (s === "attention") return <AlertTriangle className={`${className} text-amber-600`} />;
  return <CheckCircle2 className={`${className} text-emerald-600`} />;
}
function statusLabel(s: string) { return s === "overdue" ? "Action needed" : s === "attention" ? "Due soon" : "On track"; }

export default function ReadinessDashboardPage() {
  const { user, isLoggedIn } = useAuth();
  const activeLabId = useActiveLabId();
  const hasPlanAccess = !!user && SUITE_PLANS.includes(user.plan);

  const [data, setData] = useState<Readiness | null>(null);
  const [rollup, setRollup] = useState<Readiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  async function load() {
    if (!activeLabId) return;
    setLoading(true);
    try {
      const [rRes, rollRes] = await Promise.all([
        fetch(`${API_BASE}/api/labs/${activeLabId}/readiness`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/readiness/rollup`, { headers: authHeaders() }),
      ]);
      if (!rRes.ok) throw new Error(`readiness ${rRes.status}`);
      setData(await rRes.json());
      setRollup(rollRes.ok ? await rollRes.json() : []);
      setError(false);
    } catch (e) {
      console.error("Failed to load readiness:", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess && activeLabId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, hasPlanAccess, activeLabId]);

  if (!isLoggedIn) {
    return <div className="container max-w-2xl mx-auto py-12 px-4"><Card><CardContent className="py-10 text-center"><Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" /><h2 className="text-lg font-semibold mb-1">Sign in to view Readiness</h2><Button asChild className="mt-3"><Link href="/login">Sign in</Link></Button></CardContent></Card></div>;
  }
  if (!hasPlanAccess) {
    return <div className="container max-w-2xl mx-auto py-12 px-4"><Card><CardContent className="py-10 text-center"><Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" /><h2 className="text-lg font-semibold mb-1">Readiness requires a subscription</h2><p className="text-sm text-muted-foreground mb-4">A single inspection-readiness view across your compliance modules.</p><Button asChild><Link href="/pricing">See plans</Link></Button></CardContent></Card></div>;
  }
  if (!activeLabId) {
    return <div className="container max-w-2xl mx-auto py-12 px-4"><Card><CardContent className="py-10 text-center"><p className="text-sm text-muted-foreground">Select a lab to view readiness.</p></CardContent></Card></div>;
  }

  const overall = data?.overall;
  const overallStatus = overall?.status || "ok";

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4">
      <div className="mb-6 flex items-center gap-2">
        <Gauge className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Inspection Readiness</h1>
        <Button size="sm" variant="outline" className="ml-auto" onClick={load} disabled={loading}>Refresh</Button>
      </div>

      {loading ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading readiness...</CardContent></Card>
      ) : error ? (
        <Card><CardContent className="py-8 text-center"><p className="text-destructive font-medium mb-2">Couldn't load readiness.</p><Button size="sm" variant="outline" onClick={load}>Retry</Button></CardContent></Card>
      ) : data ? (() => {
        // Multi-lab (System-tier) accounts land on the NETWORK command center
        // first — a regional owner covering many sites wants the roll-up, not
        // one lab's cards. The active lab's own detail follows below. Single-lab
        // accounts see only their lab's detail (no roll-up), order unchanged.
        const isMultiLab = rollup.length > 1;
        const s = isMultiLab ? summarizeRollup(rollup as any) : null;
        const cellBg = (st: string) =>
          st === "overdue" ? "bg-red-500/15 text-red-700 dark:text-red-300"
          : st === "attention" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";

        // Active-lab detail: overall banner + per-module cards for the lab
        // selected in the switcher.
        const activeLabDetail = (
          <>
            <div className={`rounded-xl border p-4 mb-4 ${overallStatus === "overdue" ? "border-red-300/60 bg-red-50 dark:bg-red-950/30 dark:border-red-900/40" : overallStatus === "attention" ? "border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/40" : "border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900/40"}`}>
              <div className="flex items-center gap-3 flex-wrap">
                <StatusIcon s={overallStatus} className="h-6 w-6" />
                <div>
                  <div className={`text-base font-semibold ${statusColor(overallStatus)}`}>
                    {overallStatus === "overdue" ? "Action needed" : overallStatus === "attention" ? "Items due soon" : "Inspection-ready"}
                    {data.lab_name ? `: ${data.lab_name}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {overall?.modules_ok}/{overall?.modules_total} modules on track · {overall?.overdue_items} overdue · {(overall?.attention_items ?? 0) - (overall?.overdue_items ?? 0)} due soon
                  </div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              {data.modules.map(m => (
                <Card key={m.key}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StatusIcon s={m.status} />
                        <span className="font-medium text-sm">{m.label}</span>
                      </div>
                      <Badge variant="outline" className={m.status === "overdue" ? "bg-red-500/10 text-red-700 border-red-500/20" : m.status === "attention" ? "bg-amber-500/10 text-amber-700 border-amber-500/20" : "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"}>{statusLabel(m.status)}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-2">{m.headline}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        );

        // Network command center (System tier / multi-lab): summary band, a
        // worst-first "where to look" action feed, and a site x domain heatmap.
        // Everything click-throughs to the lab.
        const networkView = s && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Network readiness</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                  <div><div className="text-2xl font-bold">{s.ready}/{s.sites}</div><div className="text-xs text-muted-foreground">sites ready</div></div>
                  <div><div className={`text-2xl font-bold ${s.attention ? statusColor("attention") : ""}`}>{s.attention}</div><div className="text-xs text-muted-foreground">need attention</div></div>
                  <div><div className={`text-2xl font-bold ${s.overdueSites ? statusColor("overdue") : ""}`}>{s.overdueSites}</div><div className="text-xs text-muted-foreground">action needed</div></div>
                  <div><div className={`text-2xl font-bold ${s.totalOverdue ? statusColor("overdue") : ""}`}>{s.totalOverdue}</div><div className="text-xs text-muted-foreground">overdue items</div></div>
                  <div className="ml-auto text-right"><div className="text-2xl font-bold">{s.readinessPct}%</div><div className="text-xs text-muted-foreground">network readiness</div></div>
                </div>
              </CardContent>
            </Card>

            {s.feed.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Where to look first</CardTitle></CardHeader>
                <CardContent className="space-y-1.5">
                  {s.feed.map(l => (
                    <Link key={l.lab_id} href={`/labs/${l.lab_id}/readiness`} className="flex items-center gap-3 rounded-md border p-2 hover:bg-secondary transition-colors">
                      <StatusIcon s={l.overall.status} />
                      <span className="font-medium text-sm min-w-0 truncate">{l.lab_name || l.clia_number || `Lab ${l.lab_id}`}</span>
                      <span className="flex flex-wrap justify-end gap-1 ml-auto">
                        {badModules(l as any).map(m => (
                          <span key={m.key} className={`text-xs px-1.5 py-0.5 rounded ${cellBg(m.status)}`}>
                            {m.label}{m.overdue ? ` · ${m.overdue} overdue` : m.due_soon ? ` · ${m.due_soon} due soon` : ""}
                          </span>
                        ))}
                      </span>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">All labs</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-auto max-h-[70vh]">
                  <table className="w-full text-sm border-separate border-spacing-0">
                    <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-muted text-left text-xs text-muted-foreground border-b">
                      <tr>
                        <th className="py-2 pr-2 sticky left-0 z-30 bg-muted">Lab</th>
                        <th className="py-2 px-2 whitespace-nowrap">Status</th>
                        {s.cols.map(c => (<th key={c.key} className="py-2 px-2 whitespace-nowrap">{c.label}</th>))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.map(l => {
                        const byKey = new Map((l.modules || []).map(m => [m.key, m]));
                        return (
                          <tr key={l.lab_id} className="border-b last:border-b-0">
                            <td className="py-2 pr-2 font-medium sticky left-0 bg-card">
                              <Link href={`/labs/${l.lab_id}/readiness`} className="hover:underline">{l.lab_name || l.clia_number || `Lab ${l.lab_id}`}</Link>
                            </td>
                            <td className="py-2 px-2"><span className="inline-flex items-center gap-1.5"><StatusIcon s={l.overall.status} /> <span className={statusColor(l.overall.status)}>{statusLabel(l.overall.status)}</span></span></td>
                            {s.cols.map(c => {
                              const m = byKey.get(c.key) as any;
                              if (!m) return <td key={c.key} className="py-1.5 px-1.5 text-center text-muted-foreground">-</td>;
                              const n = m.overdue || m.due_soon || 0;
                              return (
                                <td key={c.key} className="py-1.5 px-1.5">
                                  <div className={`text-center rounded px-1.5 py-1 text-xs font-medium ${cellBg(m.status)}`} title={`${m.label}: ${statusLabel(m.status)}`}>{m.status === "ok" ? "OK" : n}</div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-3">One login, every site. Click any lab to open it. Each lab's readiness is computed from its own module data.</p>
              </CardContent>
            </Card>
          </div>
        );

        // Multi-lab: network first, then the active site's detail below a heading.
        // Single-lab: just the active lab's detail (no roll-up).
        if (isMultiLab) {
          return (
            <>
              {networkView}
              <div className="mt-8 mb-3">
                <h2 className="text-lg font-semibold">Active site: {data.lab_name || `Lab ${data.lab_id}`}</h2>
                <p className="text-xs text-muted-foreground">The lab selected in the switcher. Switch sites in the top bar, or click any lab above.</p>
              </div>
              {activeLabDetail}
            </>
          );
        }
        return activeLabDetail;
      })() : null}
    </div>
  );
}
