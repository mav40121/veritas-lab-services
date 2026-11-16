import { useState, useEffect } from "react";
import { Link, useSearch } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gauge, Lock, CheckCircle2, AlertTriangle, XCircle, Newspaper } from "lucide-react";
import { summarizeRollup, badModules, groupsInRollup, filterRollupByGroup, groupSections, ROLLUP_GROUP_KIND_LABEL } from "@/lib/readinessRollup";
import { RollupGroupsDialog, type RollupGroupsData } from "@/components/RollupGroupsDialog";

interface ModuleReadiness {
  key: string; label: string; status: "ok" | "attention" | "overdue"; overdue: number; due_soon: number; total: number; headline: string;
}
interface Readiness {
  lab_id: number; lab_name: string | null; clia_number: string | null;
  // System/Organization entity (Phase 1): set when the lab belongs to an org.
  organization_id?: number | null; organization_name?: string | null;
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
  // Per-system overview: the lab switcher links each org's "Network overview"
  // entry in with ?org=<id>, so the command center can scope to that one system.
  const search = useSearch();
  const orgFilter = (() => {
    const n = Number(new URLSearchParams(search).get("org"));
    return Number.isInteger(n) && n > 0 ? n : null;
  })();

  const [data, setData] = useState<Readiness | null>(null);
  const [rollup, setRollup] = useState<Readiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Roll-up groups (Michael 2026-11-16, Phase 1): named groups of labs (a region, a consultant's labs) the command center
  // can be cut to or broken out by. The server sends only groups the reader runs or owns, cut to the labs they see.
  const [groupsData, setGroupsData] = useState<RollupGroupsData>({ groups: [], can_build: { personal: { lab_ids: [] }, organizations: [] } });
  const [groupFilter, setGroupFilter] = useState<"all" | "none" | number>("all");
  const [breakout, setBreakout] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  async function loadGroups() {
    try {
      const gRes = await fetch(`${API_BASE}/api/rollup-groups`, { headers: authHeaders() });
      if (gRes.ok) setGroupsData(await gRes.json());
    } catch { /* groups are an extra; the roll-up stands without them */ }
  }

  async function load() {
    if (!activeLabId) return;
    setLoading(true);
    try {
      const [rRes, rollRes] = await Promise.all([
        fetch(`${API_BASE}/api/labs/${activeLabId}/readiness`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/readiness/rollup`, { headers: authHeaders() }),
        loadGroups(),
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
        {/* Compliance digest (Q281 = 1, PR 4): the same plan allowlist as this page; any member may be in an issue's audience. */}
        <Button asChild size="sm" variant="outline" className="ml-auto" data-testid="readiness-digest-link">
          <Link href={`/labs/${activeLabId}/digest`}><Newspaper className="h-4 w-4 mr-1.5" />Compliance Digest</Link>
        </Button>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>Refresh</Button>
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
        // When the switcher links in with ?org=<id>, scope the roll-up to that
        // organization's sites so the command center shows just that system, not
        // every lab the user is on. No filter = the full roll-up (unchanged).
        const scopedRollup = orgFilter != null ? rollup.filter(l => (l.organization_id ?? null) === orgFilter) : rollup;
        const isMultiLab = scopedRollup.length > 1;
        // Lab groups: those holding a lab of this roll-up. A group filter cuts the summary, the feed and the heatmap to that
        // group; "By group" breaks the heatmap out with subtotals per group. A filter left over from another view is ignored.
        const shownGroups = groupsInRollup(scopedRollup as any, groupsData.groups);
        const activeGroup = typeof groupFilter === "number" ? shownGroups.find(g => g.id === groupFilter) ?? null : null;
        const noneCount = shownGroups.length ? filterRollupByGroup(scopedRollup as any, shownGroups, "none").length : 0;
        const effectiveFilter: "all" | "none" | number = groupFilter === "none" && noneCount > 0 ? "none" : activeGroup ? activeGroup.id : "all";
        const viewRollup = effectiveFilter === "all" ? scopedRollup : filterRollupByGroup(scopedRollup as any, shownGroups, effectiveFilter);
        const s = isMultiLab && viewRollup.length ? summarizeRollup(viewRollup as any) : null;
        const sections = breakout && effectiveFilter === "all" ? groupSections(scopedRollup as any, shownGroups) : [];
        const canGroup = groupsData.groups.length > 0 || groupsData.can_build.personal.lab_ids.length > 1 || groupsData.can_build.organizations.some(o => o.lab_ids.length > 1);
        const labNames = new Map(rollup.map(l => [l.lab_id, l.lab_name || l.clia_number || `Lab ${l.lab_id}`]));
        // Name the network after its organization when the roll-up is one org.
        const rollupOrgNames = Array.from(new Set(scopedRollup.map(l => l.organization_name).filter(Boolean))) as string[];
        const networkTitle = activeGroup ? `Group readiness: ${activeGroup.name}`
          : effectiveFilter === "none" ? "Labs not in a group"
          : rollupOrgNames.length === 1 ? `Network readiness: ${rollupOrgNames[0]}` : "Network readiness";
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
        // One heatmap row (the same row whether or not the heatmap is broken out by group).
        const labRow = (l: any, keyPrefix: string) => {
          const byKey = new Map(((l.modules || []) as any[]).map(m => [m.key, m]));
          return (
            <tr key={`${keyPrefix}${l.lab_id}`} className="border-b last:border-b-0">
              <td className="py-2 pr-2 font-medium sticky left-0 bg-card">
                <Link href={`/labs/${l.lab_id}/readiness`} className="hover:underline">{l.lab_name || l.clia_number || `Lab ${l.lab_id}`}</Link>
              </td>
              <td className="py-2 px-2"><span className="inline-flex items-center gap-1.5"><StatusIcon s={l.overall.status} /> <span className={statusColor(l.overall.status)}>{statusLabel(l.overall.status)}</span></span></td>
              {(s?.cols || []).map(c => {
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
        };

        // Lab groups bar: pick a group, or break the heatmap out by group; Manage groups opens the editor.
        const inScope = new Set(scopedRollup.map(l => l.lab_id));
        const groupBar = isMultiLab && canGroup && (
          <div className="flex flex-wrap items-center gap-2" data-testid="rollup-group-bar">
            <span className="text-sm font-medium">Lab groups</span>
            {shownGroups.length > 0 && (
              <>
                <select aria-label="Show a group" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={String(effectiveFilter)}
                  onChange={e => { const v = e.target.value; setGroupFilter(v === "all" || v === "none" ? v : Number(v)); if (v !== "all") setBreakout(false); }}
                  data-testid="rollup-group-filter">
                  <option value="all">All labs ({scopedRollup.length})</option>
                  {shownGroups.map(g => <option key={g.id} value={g.id}>{g.name} ({g.lab_ids.filter(id => inScope.has(id)).length})</option>)}
                  {noneCount > 0 && <option value="none">Not in a group ({noneCount})</option>}
                </select>
                <div className="inline-flex rounded-md border overflow-hidden" role="group" aria-label="Heatmap layout">
                  <button type="button" aria-pressed={!breakout} className={`px-3 h-9 text-sm ${!breakout ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                    onClick={() => setBreakout(false)} data-testid="rollup-view-labs">All labs</button>
                  <button type="button" aria-pressed={breakout} className={`px-3 h-9 text-sm border-l ${breakout ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                    onClick={() => { setBreakout(true); setGroupFilter("all"); }} data-testid="rollup-view-groups">By group</button>
                </div>
              </>
            )}
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setManageOpen(true)} data-testid="rollup-manage-groups">
              {groupsData.groups.length ? "Manage groups" : "Group labs"}
            </Button>
          </div>
        );

        const networkView = s && (
          <div className="space-y-4">
            {groupBar}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{networkTitle}</CardTitle></CardHeader>
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
                    {sections.length ? sections.map(sec => (
                      <tbody key={sec.group ? `g${sec.group.id}` : "none"} data-testid={sec.group ? `rollup-group-section-${sec.group.id}` : "rollup-group-section-none"}>
                        <tr>
                          <td colSpan={2 + s.cols.length} className="py-2 px-2 bg-muted/60 border-y">
                            <span className="font-semibold text-sm">{sec.group ? sec.group.name : "Not in a group"}</span>
                            {sec.group && <span className="ml-2 text-xs rounded border bg-background px-1.5 py-0.5">{ROLLUP_GROUP_KIND_LABEL[sec.group.kind] || "Group"}</span>}
                            <span className="ml-3 text-xs text-muted-foreground" data-testid="rollup-group-subtotal">
                              {sec.summary.ready}/{sec.summary.sites} ready · {sec.summary.overdueSites} action needed · {sec.summary.totalOverdue} overdue {sec.summary.totalOverdue === 1 ? "item" : "items"} · {sec.summary.readinessPct}% readiness
                            </span>
                          </td>
                        </tr>
                        {sec.labs.map(l => labRow(l, sec.group ? `g${sec.group.id}-` : "n-"))}
                      </tbody>
                    )) : (
                      <tbody>{s.rows.map(l => labRow(l, ""))}</tbody>
                    )}
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  One login, every site. Click any lab to open it. Each lab's readiness is computed from its own module data.
                  {sections.length ? " A lab in two groups shows in both." : ""}
                </p>
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
              {canGroup && (
                <RollupGroupsDialog open={manageOpen} onOpenChange={setManageOpen} data={groupsData} labNames={labNames} onChanged={loadGroups} />
              )}
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
