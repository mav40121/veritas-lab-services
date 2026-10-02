// VeritaCEU — lab-wide Continuing Education dashboard (phase 1)
//
// Promotes CE from the per-employee card inside VeritaStaff to a first-class
// surface: every active staffer's cycle status at a glance, so a lead can see
// who is behind. Reads the lab-wide roster summary (same cycle math as the
// per-employee card, ASCP CMP 36 points / 3-year default). Logging a credit
// still happens on the employee's VeritaStaff detail (linked per row).
//
// Backend: GET /api/labs/:labId/veritaceu/roster-summary (server/routes.ts).

import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { useToast } from "@/hooks/use-toast";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { GraduationCap, Lock, ChevronRight, ArrowUpDown, ExternalLink, Plus, Pencil, Archive, RotateCcw } from "lucide-react";
import { FREE_CE_PROVIDERS, CE_CATEGORY_ORDER, FREE_CE_TIP } from "@/lib/freeCeProviders";

interface RosterRow {
  employeeId: number;
  name: string;
  title: string | null;
  profileId: number | null;
  earned: number;
  required: number;
  cycleMonths: number;
  remaining: number;
  pct: number;
  met: boolean;
  inCycleCount: number;
  totalEntries: number;
  lastActivityDate: string | null;
}
interface RosterSummary {
  required: number;
  cycleMonths: number;
  employeeCount: number;
  metCount: number;
  shortCount: number;
  roster: RosterRow[];
}
interface CeProfile {
  id: number;
  name: string;
  required_credits: number;
  cycle_months: number;
  is_default: number;
  status: string;
  assignedCount?: number;
}

type SortKey = "status" | "name";
type Tab = "status" | "directory" | "requirements";

export default function VeritaCeuAppPage() {
  const labId = useActiveLabId();
  const labRoute = useLabRoute();
  const { user } = useAuth();

  // Explicit allowlist per CLAUDE.md §8; mirrors server hasStaffAccess (CE
  // rides on the VeritaStaff subscription).
  const hasPlanAccess = !!user && [
    "annual", "professional", "lab", "complete",
    "veritamap", "veritascan", "veritacomp",
    "clinic", "waived", "community", "hospital", "large_hospital", "enterprise",
  ].includes(user.plan);

  const { toast } = useToast();
  const qc = useQueryClient();
  const isReadOnly = useIsReadOnly("veritastaff");
  const [shortOnly, setShortOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [tab, setTab] = useState<Tab>("status");

  const rosterKey = `/api/labs/${labId}/veritaceu/roster-summary`;
  const profilesKey = `/api/labs/${labId}/veritaceu/requirement-profiles`;

  const summaryQuery = useQuery<RosterSummary>({
    queryKey: [rosterKey],
    enabled: !!labId && hasPlanAccess,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}${rosterKey}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load CE roster (${res.status})`);
      return res.json();
    },
  });

  const profilesQuery = useQuery<CeProfile[]>({
    queryKey: [profilesKey],
    enabled: !!labId && hasPlanAccess,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}${profilesKey}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load requirement profiles (${res.status})`);
      return res.json();
    },
  });
  const activeProfiles = (profilesQuery.data || []).filter((p) => p.status === "active");

  const assignMutation = useMutation({
    mutationFn: async ({ employeeId, profileId }: { employeeId: number; profileId: number | null }) => {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritaceu/employees/${employeeId}/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ profileId }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error || "Assign failed"); }
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [rosterKey] }); qc.invalidateQueries({ queryKey: [profilesKey] }); },
    onError: (e: Error) => toast({ title: "Could not assign profile", description: e.message, variant: "destructive" }),
  });

  if (user && !hasPlanAccess) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
            <h1 className="text-xl font-semibold">VeritaCEU</h1>
            <p className="text-sm text-muted-foreground">
              Continuing-education tracking is part of VeritaStaff™. Add VeritaStaff to track CE cycles across your team.
            </p>
            <Button asChild variant="outline"><Link href="/veritastaff">View plans</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const data = summaryQuery.data;
  const roster = (data?.roster || [])
    .filter((r) => (shortOnly ? !r.met : true))
    .sort((a, b) =>
      sortKey === "name"
        ? a.name.localeCompare(b.name)
        : (a.met === b.met ? a.pct - b.pct : a.met ? 1 : -1) // short first, then lowest pct
    );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <GraduationCap className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">VeritaCEU</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Continuing-education cycle status across your team. ASCP CMP standard is 36 points every 3 years;
            log credits on each person&rsquo;s VeritaStaff&trade; record.
          </p>
        </div>
      </div>

      {/* Tab toggle */}
      <div className="flex gap-1 mb-5 border-b border-border">
        <button
          onClick={() => setTab("status")}
          className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${tab === "status" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Team status
        </button>
        <button
          onClick={() => setTab("directory")}
          className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${tab === "directory" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Find free CE
        </button>
        <button
          onClick={() => setTab("requirements")}
          className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${tab === "requirements" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Requirements
        </button>
      </div>

      {tab === "directory" && <FreeCeDirectory />}
      {tab === "requirements" && <RequirementsTab labId={labId} isReadOnly={isReadOnly} />}

      {tab === "status" && <>
      {/* Summary band */}
      {data && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <Card><CardContent className="py-4 text-center">
            <div className="text-2xl font-bold">{data.employeeCount}</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Staff</div>
          </CardContent></Card>
          <Card><CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-emerald-600">{data.metCount}</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Cycle met</div>
          </CardContent></Card>
          <Card><CardContent className="py-4 text-center">
            <div className={`text-2xl font-bold ${data.shortCount > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{data.shortCount}</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Short</div>
          </CardContent></Card>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={shortOnly} onChange={(e) => setShortOnly(e.target.checked)} />
          Show only staff who are short
        </label>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setSortKey(sortKey === "status" ? "name" : "status")}>
          <ArrowUpDown className="h-4 w-4 mr-1.5" />Sort: {sortKey === "status" ? "status" : "name"}
        </Button>
      </div>

      {summaryQuery.isLoading && (
        <div className="space-y-2">{[1, 2, 3, 4].map((n) => <div key={n} className="h-16 rounded-lg bg-muted/60 animate-pulse" />)}</div>
      )}
      {summaryQuery.isError && (
        <Card><CardContent className="py-6 text-sm text-destructive">Could not load the CE roster. {(summaryQuery.error as Error)?.message}</CardContent></Card>
      )}

      {data && roster.length === 0 && (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          {data.employeeCount === 0 ? "No active staff on this lab yet. Add people in VeritaStaff™." : "No staff match this filter."}
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {roster.map((r) => (
          <Link key={r.employeeId} href={labRoute(`/veritastaff-app/${r.employeeId}`)}>
            <Card className="hover:border-primary/40 transition-colors cursor-pointer">
              <CardContent className="py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{r.name}</span>
                      {r.title && <span className="text-xs text-muted-foreground truncate">{r.title}</span>}
                      {r.met
                        ? <Badge variant="outline" className="text-[10px] text-emerald-700 bg-emerald-500/10 border-emerald-500/30">Cycle met</Badge>
                        : <Badge variant="outline" className="text-[10px] text-amber-700 bg-amber-500/10 border-amber-500/30">{r.remaining} to go</Badge>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden max-w-xs">
                        <div className={`h-full ${r.met ? "bg-emerald-600" : "bg-primary"}`} style={{ width: `${r.pct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{r.earned} / {r.required}</span>
                    </div>
                    {r.lastActivityDate && (
                      <div className="text-[11px] text-muted-foreground mt-1">Last CE: {r.lastActivityDate}</div>
                    )}
                    {activeProfiles.length > 0 && (
                      <div className="mt-1.5" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                        <select
                          className="text-[11px] rounded border border-border bg-background text-foreground px-1.5 py-0.5 max-w-[16rem]"
                          value={r.profileId ?? ""}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onChange={(e) => { e.preventDefault(); e.stopPropagation(); assignMutation.mutate({ employeeId: r.employeeId, profileId: e.target.value ? Number(e.target.value) : null }); }}
                          disabled={isReadOnly}
                          title="CE requirement profile"
                        >
                          <option value="">Default requirement</option>
                          {activeProfiles.map((p) => (
                            <option key={p.id} value={p.id}>{p.name} ({p.required_credits}/{p.cycle_months}mo)</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      </>}
    </div>
  );
}

// ─── Free CE provider directory (phase 2, parking-lot #53) ───────────────────
// A curated "where to find free CE" reference, grouped by provider type. Static
// content from client/src/lib/freeCeProviders.ts. External links open in a new tab.
function FreeCeDirectory() {
  const groups = CE_CATEGORY_ORDER
    .map((cat) => ({ cat, items: FREE_CE_PROVIDERS.filter((p) => p.category === cat) }))
    .filter((g) => g.items.length > 0);
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Where your team can find free continuing education. Each source was free and P.A.C.E.-eligible at last
        review; open a provider for its current offerings.
      </p>
      {groups.map(({ cat, items }) => (
        <div key={cat}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{cat}</h2>
          <div className="space-y-2">
            {items.map((p) => (
              <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer" className="block">
                <Card className="hover:border-primary/40 transition-colors">
                  <CardContent className="py-3">
                    <div className="font-medium flex items-center gap-1.5">
                      {p.name}
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{p.description}</p>
                    {p.note && <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{p.note}</p>}
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground italic">{FREE_CE_TIP}</p>
    </div>
  );
}

// ─── Requirement profiles management (phase 4) ───────────────────────────────
// Create/edit/retire named CE requirements and set the lab default. Assignment to
// individual staff happens on the Team status tab.
interface ProfileFormState { name: string; required_credits: string; cycle_months: string; is_default: boolean; }

function RequirementsTab({ labId, isReadOnly }: { labId: number | null; isReadOnly: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/labs/${labId}/veritaceu/requirement-profiles`;
  const fullKey = `${key}?all`;
  const { data } = useQuery<CeProfile[]>({
    queryKey: [fullKey],
    enabled: !!labId,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}${key}?include_retired=1`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load profiles (${res.status})`);
      return res.json();
    },
  });
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<CeProfile | null>(null);
  const [form, setForm] = useState<ProfileFormState>({ name: "", required_credits: "36", cycle_months: "36", is_default: false });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: [fullKey] });
    qc.invalidateQueries({ queryKey: [key] });
    qc.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritaceu/roster-summary`] });
  };
  const createM = useMutation({
    mutationFn: async (b: any) => {
      const res = await fetch(`${API_BASE}${key}`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(b) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error || "Create failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Profile created" }); invalidateAll(); setAddOpen(false); },
    onError: (e: Error) => toast({ title: "Could not create profile", description: e.message, variant: "destructive" }),
  });
  const updateM = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: any }) => {
      const res = await fetch(`${API_BASE}${key}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error || "Update failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Profile updated" }); invalidateAll(); setEditItem(null); },
    onError: (e: Error) => toast({ title: "Could not update profile", description: e.message, variant: "destructive" }),
  });

  function openAdd() { setForm({ name: "", required_credits: "36", cycle_months: "36", is_default: false }); setAddOpen(true); }
  function openEdit(p: CeProfile) { setForm({ name: p.name, required_credits: String(p.required_credits), cycle_months: String(p.cycle_months), is_default: !!p.is_default }); setEditItem(p); }
  const body = () => ({ name: form.name.trim(), required_credits: Number(form.required_credits), cycle_months: Number(form.cycle_months), is_default: form.is_default });
  const formValid = !!form.name.trim() && Number(form.required_credits) > 0 && Number.isInteger(Number(form.cycle_months)) && Number(form.cycle_months) >= 1 && Number(form.cycle_months) <= 120;

  const profiles = data || [];
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-muted-foreground">
          CE requirement profiles. Assign one per person on the Team status tab; anyone unassigned uses the default (or ASCP CMP 36/3yr if there is none).
        </p>
        <Button size="sm" className="shrink-0" onClick={openAdd} disabled={isReadOnly}><Plus className="h-4 w-4 mr-1.5" />Add profile</Button>
      </div>
      {profiles.length === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          No profiles yet. The ASCP CMP standard (36 points every 3 years) applies to everyone until you add one.
        </CardContent></Card>
      )}
      <div className="space-y-2">
        {profiles.map((p) => (
          <Card key={p.id} className={p.status === "retired" ? "opacity-60" : undefined}>
            <CardContent className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{p.name}</span>
                  {!!p.is_default && <Badge variant="outline" className="text-[10px] text-primary border-primary/30">Default</Badge>}
                  {p.status === "retired" && <Badge variant="outline" className="text-[10px] text-muted-foreground">Retired</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {p.required_credits} credits every {p.cycle_months} months{typeof p.assignedCount === "number" ? ` · ${p.assignedCount} assigned` : ""}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => openEdit(p)} disabled={isReadOnly}><Pencil className="h-4 w-4" /></Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add requirement profile</DialogTitle>
            <DialogDescription>A named CE requirement you can assign to staff (e.g. ASCP CMP, a state license rule).</DialogDescription>
          </DialogHeader>
          <ProfileForm form={form} setForm={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => createM.mutate(body())} disabled={!formValid || createM.isPending}>{createM.isPending ? "Adding…" : "Add profile"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o) setEditItem(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit requirement profile</DialogTitle>
            <DialogDescription>
              {editItem?.status === "retired"
                ? "This profile is retired. Reactivate it to assign it again."
                : "Edit or retire this profile. Retiring moves its staff to the default requirement."}
            </DialogDescription>
          </DialogHeader>
          <ProfileForm form={form} setForm={setForm} />
          <DialogFooter className="flex sm:justify-between gap-2">
            <div>
              {editItem && editItem.status === "active" && (
                <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => updateM.mutate({ id: editItem.id, body: { status: "retired" } })} disabled={isReadOnly || updateM.isPending}><Archive className="h-4 w-4 mr-1.5" />Retire</Button>
              )}
              {editItem && editItem.status === "retired" && (
                <Button variant="outline" onClick={() => updateM.mutate({ id: editItem.id, body: { status: "active" } })} disabled={isReadOnly || updateM.isPending}><RotateCcw className="h-4 w-4 mr-1.5" />Reactivate</Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
              <Button onClick={() => editItem && updateM.mutate({ id: editItem.id, body: body() })} disabled={isReadOnly || !formValid || updateM.isPending}>{updateM.isPending ? "Saving…" : "Save"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileForm({ form, setForm }: { form: ProfileFormState; setForm: (f: ProfileFormState) => void }) {
  const set = (patch: Partial<ProfileFormState>) => setForm({ ...form, ...patch });
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="pf-name">Name <span className="text-destructive">*</span></Label>
        <Input id="pf-name" value={form.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. ASCP CMP, NY State License" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="pf-credits">Required credits <span className="text-destructive">*</span></Label>
          <Input id="pf-credits" type="number" min="1" value={form.required_credits} onChange={(e) => set({ required_credits: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="pf-cycle">Cycle (months) <span className="text-destructive">*</span></Label>
          <Input id="pf-cycle" type="number" min="1" max="120" value={form.cycle_months} onChange={(e) => set({ cycle_months: e.target.value })} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.is_default} onChange={(e) => set({ is_default: e.target.checked })} />
        Make this the lab default (applies to anyone not individually assigned)
      </label>
    </div>
  );
}
