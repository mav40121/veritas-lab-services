// Open findings across labs (Sanford program B2, 2026-11-24): reached from the Inspection Readiness roll-up, for a system's
// owner or admin only (the server refuses anyone else). The rows are every open VeritaResponse finding in exactly the labs
// that roll-up shows this person; the lab group and accreditor filters only take rows away. A row opens the finding in its
// own lab, where that lab's own rules apply.
import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ListChecks, Lock } from "lucide-react";
import { groupsInRollup, type RollupGroupRef, type RollupLab } from "@/lib/readinessRollup";
import { accreditorLabel, filterFindings, labsForFilter, FINDING_STATUS_LABEL, type SystemFindingLab, type SystemFindingRow } from "@/lib/systemFindings";

const SHOW_FIRST = 300;
const selectCls = "h-9 rounded-md border border-input bg-background px-2 text-sm max-w-full";

export default function SystemFindingsPage() {
  const { isLoggedIn } = useAuth();
  const activeLabId = useActiveLabId();
  const params = new URLSearchParams(useSearch());
  const orgParam = Number(params.get("org"));
  const organizationId = Number.isInteger(orgParam) && orgParam > 0 ? orgParam : null;
  const groupParam = params.get("group");

  const [labs, setLabs] = useState<SystemFindingLab[]>([]);
  const [rows, setRows] = useState<SystemFindingRow[]>([]);
  const [groups, setGroups] = useState<RollupGroupRef[]>([]);
  const [group, setGroup] = useState<"all" | "none" | number>(groupParam === "none" ? "none" : Number(groupParam) > 0 ? Number(groupParam) : "all");
  const [accreditor, setAccreditor] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "refused" | "error">("loading");
  const [refusal, setRefusal] = useState("");

  async function load() {
    setState("loading");
    try {
      const [fRes, gRes] = await Promise.all([
        fetch(`${API_BASE}/api/readiness/rollup/findings`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/rollup-groups`, { headers: authHeaders() }).catch(() => null),
      ]);
      const body = await fRes.json().catch(() => ({}));
      if (fRes.status === 403) { setRefusal(body?.error || ""); setState("refused"); return; }
      if (!fRes.ok) throw new Error(`findings ${fRes.status}`);
      setLabs(body.labs || []);
      setRows(body.findings || []);
      if (gRes?.ok) setGroups((await gRes.json()).groups || []);
      setState("ready");
    } catch (e) {
      console.error("Failed to load findings across labs:", e);
      setState("error");
    }
  }
  useEffect(() => {
    if (isLoggedIn) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  const back = `/labs/${activeLabId}/readiness${organizationId != null ? `?org=${organizationId}` : ""}`;
  if (!isLoggedIn) {
    return <div className="container max-w-2xl mx-auto py-12 px-4"><Card><CardContent className="py-10 text-center"><Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" /><h2 className="text-lg font-semibold mb-1">Sign in to view findings across labs</h2><Button asChild className="mt-3"><Link href="/login">Sign in</Link></Button></CardContent></Card></div>;
  }

  // A filter left over from another view (a group that holds none of these labs) reads as All labs, as the roll-up does.
  const scoped = labsForFilter(labs, groups, { organizationId, group: "all" });
  const shownGroups = groupsInRollup(scoped as unknown as RollupLab[], groups);
  const noneCount = shownGroups.length ? labsForFilter(scoped, shownGroups, { organizationId: null, group: "none" }).length : 0;
  const effectiveGroup = group === "none" ? (noneCount > 0 ? "none" : "all") : typeof group === "number" && shownGroups.some((g) => g.id === group) ? group : "all";
  const inGroup = filterFindings(rows, labs, shownGroups, { organizationId, group: effectiveGroup, accreditor: null });
  const accreditors = [...new Set(inGroup.map(accreditorLabel))].sort();
  const effectiveAccreditor = accreditor != null && accreditors.includes(accreditor) ? accreditor : null;
  const shown = effectiveAccreditor == null ? inGroup : inGroup.filter((r) => accreditorLabel(r) === effectiveAccreditor);
  const pastDue = shown.filter((r) => r.past_due).length;
  const labCount = new Set(shown.map((r) => r.lab_id)).size;
  const orgName = organizationId != null ? scoped.find((l) => l.organization_name)?.organization_name : null;
  const inScope = new Set(scoped.map((l) => l.lab_id));

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4">
      <div className="mb-6">
        <Button asChild size="sm" variant="ghost" className="-ml-2 mb-2" data-testid="system-findings-back"><Link href={back}><ArrowLeft className="h-4 w-4 mr-1.5" />Inspection Readiness</Link></Button>
        <div className="flex items-center gap-2">
          <ListChecks className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Open findings across labs</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Every open VeritaResponse™ finding in the {scoped.length} {scoped.length === 1 ? "laboratory" : "laboratories"} of your readiness roll-up{orgName ? ` (${orgName})` : ""}. Open a row to work on it in its own lab.
        </p>
      </div>

      {state === "loading" ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading findings...</CardContent></Card>
      ) : state === "refused" ? (
        <Card><CardContent className="py-10 text-center" data-testid="system-findings-refused"><Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" /><p className="text-sm">{refusal || "This list is for the owner or an admin of a system of laboratories."}</p></CardContent></Card>
      ) : state === "error" ? (
        <Card><CardContent className="py-8 text-center"><p className="text-destructive font-medium mb-2">Couldn't load the findings.</p><Button size="sm" variant="outline" onClick={load}>Retry</Button></CardContent></Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {shownGroups.length > 0 && (
              <select aria-label="Lab group" className={selectCls} value={String(effectiveGroup)} data-testid="system-findings-group"
                onChange={(e) => { const v = e.target.value; setGroup(v === "all" || v === "none" ? v : Number(v)); setShowAll(false); }}>
                <option value="all">All labs ({scoped.length})</option>
                {shownGroups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.lab_ids.filter((id) => inScope.has(id)).length})</option>)}
                {noneCount > 0 && <option value="none">Not in a group ({noneCount})</option>}
              </select>
            )}
            <select aria-label="Accreditor" className={selectCls} value={effectiveAccreditor ?? ""} data-testid="system-findings-accreditor"
              onChange={(e) => { setAccreditor(e.target.value || null); setShowAll(false); }}>
              <option value="">All accreditors</option>
              {accreditors.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <span className="text-sm text-muted-foreground" data-testid="system-findings-summary">
              {shown.length} open in {labCount} {labCount === 1 ? "lab" : "labs"}, {pastDue} past due
            </span>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[70vh]">
                <table className="w-full text-sm" style={{ minWidth: 680 }}>
                  <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-muted text-left text-xs text-muted-foreground border-b">
                    <tr>
                      <th className="py-2.5 px-4">Lab</th>
                      <th className="py-2.5 pr-4">Accreditor</th>
                      <th className="py-2.5 pr-4">Finding</th>
                      <th className="py-2.5 pr-4">Due</th>
                      <th className="py-2.5 pr-4">Status</th>
                    </tr>
                  </thead>
                  <tbody data-testid="system-findings-rows">
                    {shown.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-muted-foreground">No open findings{effectiveGroup !== "all" || effectiveAccreditor ? " for these filters" : ""}.</td></tr>}
                    {(showAll ? shown : shown.slice(0, SHOW_FIRST)).map((f) => (
                      <tr key={f.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/20">
                        <td className="py-2.5 px-4 font-medium">
                          <Link href={`/labs/${f.lab_id}/veritaresponse/${f.id}`} className="hover:underline">{f.lab_name || `Lab ${f.lab_id}`}</Link>
                        </td>
                        <td className="py-2.5 pr-4">{accreditorLabel(f)}</td>
                        <td className="py-2.5 pr-4 text-xs text-muted-foreground">{[f.finding_number, f.standard_ref].filter(Boolean).join(" · ") || "-"}</td>
                        <td className={`py-2.5 pr-4 text-xs whitespace-nowrap ${f.past_due ? "text-red-700 dark:text-red-300 font-semibold" : f.past_target ? "text-amber-700 dark:text-amber-300 font-medium" : "text-muted-foreground"}`}>
                          {f.due_date ? `${f.due_date}${f.past_due ? ", past due" : f.past_target ? ", past target" : ""}` : "No deadline"}
                        </td>
                        <td className="py-2.5 pr-4"><Badge variant="outline" className="text-xs whitespace-nowrap">{FINDING_STATUS_LABEL[f.status] || f.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!showAll && shown.length > SHOW_FIRST && (
                <div className="p-3 text-center border-t text-sm text-muted-foreground">
                  Showing the first {SHOW_FIRST} of {shown.length}. <Button size="sm" variant="outline" className="ml-2" onClick={() => setShowAll(true)}>Show all</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
