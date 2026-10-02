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
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Lock, ChevronRight, ArrowUpDown, ExternalLink } from "lucide-react";
import { FREE_CE_PROVIDERS, CE_CATEGORY_ORDER, FREE_CE_TIP } from "@/lib/freeCeProviders";

interface RosterRow {
  employeeId: number;
  name: string;
  title: string | null;
  earned: number;
  required: number;
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

type SortKey = "status" | "name";

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

  const [shortOnly, setShortOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [tab, setTab] = useState<"status" | "directory">("status");

  const summaryQuery = useQuery<RosterSummary>({
    queryKey: [`/api/labs/${labId}/veritaceu/roster-summary`],
    enabled: !!labId && hasPlanAccess,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritaceu/roster-summary`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load CE roster (${res.status})`);
      return res.json();
    },
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
      </div>

      {tab === "directory" && <FreeCeDirectory />}

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
