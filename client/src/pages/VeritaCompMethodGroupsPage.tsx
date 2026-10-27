// client/src/pages/VeritaCompMethodGroupsPage.tsx
//
// VeritaComp settings: method groups (2026-10-14, Michael Q166/Q168 = 1; mock approved). The lab's one list of which
// analyzers share a competency. Every analyzer is its own method until the lab groups it; VeritaComp only suggests
// (same make and model family on VeritaMap) and never groups on its own. A group needs one complexity and no manual
// methods (shared/competencyGrouping.ts, re-checked on the server). Splitting a group keeps each analyzer's sign-offs.
//   GET/POST /api/labs/:labId/competency/method-groups, PUT/DELETE .../:groupId, POST .../keep-separate
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, Loader2 } from "lucide-react";
import { groupProblem, suggestGroupName } from "@shared/competencyGrouping";
import { labLocaleDate } from "@/lib/labDate";

interface Inst { id: number; name: string; category: string | null; complexity: string; manual: boolean; people: number; groupId: number | null; }
interface Group { id: number; name: string; members: Inst[]; people: number; createdAt: string; createdBy: string | null; }
interface Suggestion { key: string; members: Inst[]; reason: string; }
interface Data { instruments: Inst[]; groups: Group[]; suggestions: Suggestion[]; }

const cx = (c: string) => (c ? c.charAt(0) + c.slice(1).toLowerCase() : "");

export default function VeritaCompMethodGroupsPage() {
  const activeLabId = useActiveLabId();
  const readOnly = useIsReadOnly("veritacomp");
  const { toast } = useToast();
  const qc = useQueryClient();
  const url = activeLabId ? `/api/labs/${activeLabId}/competency/method-groups` : null;
  const { data, isLoading, error } = useQuery<Data>({
    queryKey: [url ?? "no-lab"],
    queryFn: async () => { const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); },
    enabled: !!url,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<number[]>([]);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<Record<number, string>>({});
  useEffect(() => {
    const n: Record<string, string> = {};
    for (const s of data?.suggestions || []) n[s.key] = suggestGroupName(s.members.map((m) => m.name));
    setNames(n);
  }, [data?.suggestions]);

  const call = async (key: string, method: string, path: string, body?: any, done?: string) => {
    setBusy(key);
    try {
      const r = await fetch(`${API_BASE}/api/labs/${activeLabId}/competency/method-groups${path}`, { method, headers: { "Content-Type": "application/json", ...authHeaders() }, body: body === undefined ? undefined : JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (done) toast({ title: done });
      qc.invalidateQueries();
      return true;
    } catch (e: any) {
      toast({ title: "Could not save", description: String(e?.message || e), variant: "destructive" });
      return false;
    } finally { setBusy(null); }
  };

  const free = (data?.instruments || []).filter((i) => i.groupId == null && !i.manual);
  const pickedInsts = free.filter((i) => picked.includes(i.id));
  const pickProblem = useMemo(() => (pickedInsts.length ? groupProblem(pickedInsts) : null), [pickedInsts]);
  const depts = Array.from(new Set(free.map((i) => i.category || "Other")));
  const labRoute = (p: string) => (activeLabId ? `/labs/${activeLabId}${p}` : p);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <Link href={labRoute("/veritacomp-app")} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ChevronLeft size={14} /> VeritaComp&trade;
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Method groups</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Each analyzer is its own method until you group it. Group analyzers only when staff need no new or unique skills to move between them; one competency and one sign-off then cover the whole group.
        </p>
      </div>
      {isLoading && <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>}
      {error && <div className="text-sm text-red-600">Could not load method groups.</div>}
      {data && (
        <>
          <Card data-testid="suggested-groups"><CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between"><span className="font-semibold text-sm">Suggested ({data.suggestions.length})</span><span className="text-[11px] text-muted-foreground">Same make and model family on your VeritaMap&trade;</span></div>
            {data.suggestions.length === 0 && <p className="text-xs text-muted-foreground">No suggestions right now.</p>}
            {data.suggestions.map((s) => (
              <div key={s.key} className="rounded-md border p-2.5 flex items-center justify-between gap-3 flex-wrap" data-testid="suggestion">
                <div className="min-w-[220px]">
                  <div className="text-sm font-medium">{s.members.map((m) => m.name).join(" + ")}</div>
                  <div className="text-[11px] text-muted-foreground">{s.members[0].category || "Other"} &middot; {cx(s.members[0].complexity)} &middot; {s.reason}</div>
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Input className="h-8 text-xs w-48" value={names[s.key] || ""} onChange={(e) => setNames((p) => ({ ...p, [s.key]: e.target.value }))} data-testid="suggestion-name" />
                    <Button size="sm" disabled={busy != null} data-testid="group-these"
                      onClick={() => call(s.key, "POST", "", { name: names[s.key], instrumentIds: s.members.map((m) => m.id) }, `Grouped ${names[s.key]}`)}>
                      {busy === s.key && <Loader2 className="animate-spin mr-1" size={12} />} Group these
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy != null} data-testid="keep-separate"
                      onClick={() => call(`k${s.key}`, "POST", "/keep-separate", { instrumentIds: s.members.map((m) => m.id) }, "Kept separate")}>Keep separate</Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent></Card>

          <Card data-testid="lab-groups"><CardContent className="p-4 space-y-2">
            <span className="font-semibold text-sm">Your groups ({data.groups.length})</span>
            {data.groups.length === 0 && <p className="text-xs text-muted-foreground">No groups yet. Every analyzer is its own method.</p>}
            {data.groups.map((g) => (
              <div key={g.id} className="rounded-md border p-2.5 flex items-center justify-between gap-3 flex-wrap" data-testid="lab-group">
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">{g.name} <Badge className="text-[10px] bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300">GROUP</Badge></div>
                  <div className="text-[11px] text-muted-foreground">{g.members.map((m) => m.name).join(", ")} &middot; {g.members[0]?.category || "Other"} &middot; {cx(g.members[0]?.complexity || "")} &middot; {g.people} {g.people === 1 ? "person" : "people"}{g.createdBy ? ` · grouped ${labLocaleDate(g.createdAt)} by ${g.createdBy}` : ""}</div>
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-2">
                    {renaming[g.id] !== undefined ? (
                      <>
                        <Input className="h-8 text-xs w-44" value={renaming[g.id]} onChange={(e) => setRenaming((p) => ({ ...p, [g.id]: e.target.value }))} data-testid="rename-input" />
                        <Button size="sm" disabled={busy != null} onClick={async () => { if (await call(`r${g.id}`, "PUT", `/${g.id}`, { name: renaming[g.id] }, "Renamed")) setRenaming((p) => { const n = { ...p }; delete n[g.id]; return n; }); }} data-testid="rename-save">Save</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setRenaming((p) => ({ ...p, [g.id]: g.name }))} data-testid="rename-group">Rename</Button>
                    )}
                    <Button size="sm" variant="outline" disabled={busy != null} data-testid="split-group"
                      onClick={() => { if (window.confirm(`Split "${g.name}"? Each analyzer becomes its own method again; every sign-off already made stays on each analyzer.`)) call(`s${g.id}`, "DELETE", `/${g.id}`, undefined, `Split ${g.name}`); }}>Split</Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent></Card>

          {!readOnly && (
            <Card data-testid="make-group"><CardContent className="p-4 space-y-2">
              <span className="font-semibold text-sm">Make a group</span>
              {depts.map((d) => (
                <div key={d}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mt-1">{d}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {free.filter((i) => (i.category || "Other") === d).map((i) => (
                      <label key={i.id} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="checkbox" className="w-3.5 h-3.5" checked={picked.includes(i.id)} data-testid="pick-instrument"
                          onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i.id] : p.filter((x) => x !== i.id)))} />
                        <span>{i.name}</span><span className="text-muted-foreground">{cx(i.complexity)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {pickProblem && pickedInsts.length >= 2 && <p className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1.5" data-testid="group-problem">Can't group: {pickProblem}</p>}
              <div className="flex items-center gap-2 flex-wrap">
                <Input className="h-8 text-xs w-56" placeholder="Group name, e.g. the analyzer model" value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="new-group-name" />
                <Button size="sm" disabled={busy != null || pickedInsts.length < 2 || !!pickProblem || !newName.trim()} data-testid="create-group"
                  onClick={async () => { if (await call("new", "POST", "", { name: newName, instrumentIds: picked }, `Grouped ${newName}`)) { setPicked([]); setNewName(""); } }}>Create group</Button>
                <span className="text-[11px] text-muted-foreground">Manual methods (manual differential, tube method, microscopy) are not listed: they keep their own competency.</span>
              </div>
            </CardContent></Card>
          )}
        </>
      )}
    </div>
  );
}
