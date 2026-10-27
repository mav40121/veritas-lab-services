// client/src/pages/VeritaCompByInstrumentPage.tsx
//
// "By instrument" index (2026-10-13, Michael Q154 = 2): every instrument on the lab's VeritaMap maps with how many
// assigned people are signed off on it (per-method sign-off), ready to sign, or overdue. Click through to VeritaCompInstrumentPage. Read-only; not linked from the
// VeritaComp landing until it is turned on.
//   GET /api/labs/:labId/competency/by-instrument
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Row { instrumentId: number; instrumentName: string; department: string | null; complexity: string | null; people: number; signed: number; ready: number; overdue: number; groupId?: number | null; groupMembers?: Array<{ id: number; name: string }> | null; }

export default function VeritaCompByInstrumentPage() {
  const activeLabId = useActiveLabId();
  const url = activeLabId ? `/api/labs/${activeLabId}/competency/by-instrument` : null;
  const { data, isLoading, error } = useQuery<{ instruments: Row[] }>({
    queryKey: [url ?? "no-lab"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`Failed to load (${r.status})`);
      return r.json();
    },
    enabled: !!url,
  });
  const labRoute = (p: string) => (activeLabId ? `/labs/${activeLabId}${p}` : p);
  const rows = data?.instruments || [];
  const depts = Array.from(new Set(rows.map((r) => r.department || "Other")));

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <Link href={labRoute("/veritacomp-app")} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ChevronLeft size={14} /> VeritaComp&trade;
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Competency by instrument</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Each instrument on your VeritaMap&reg;, with the people assigned to it in VeritaStaff&trade; and how many are signed off on it.
        </p>
      </div>
      {isLoading && <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>}
      {error && <div className="text-sm text-red-600">Could not load instruments.</div>}
      {data && rows.length === 0 && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No instruments on your VeritaMap&reg; yet.</CardContent></Card>
      )}
      {depts.map((dept) => (
        <div key={dept} className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{dept}</div>
          {rows.filter((r) => (r.department || "Other") === dept).map((r) => {
            const done = r.people > 0 && r.signed === r.people;
            return (
              <Link key={r.instrumentId} href={labRoute(`/veritacomp-app/instrument/${r.instrumentId}`)} data-testid="instrument-row"
                className="flex items-center justify-between gap-3 rounded-md border p-3 hover:border-primary/40 transition-colors">
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">{r.instrumentName}{r.groupMembers?.length ? <Badge className="text-[9px] bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300" data-testid="group-badge">GROUP</Badge> : null}</div>
                  <div className="text-[11px] text-muted-foreground">{r.groupMembers?.length ? `${r.groupMembers.map((m) => m.name).join(", ")} \u00b7 ` : ""}{r.complexity || "Complexity not set"}</div>
                </div>
                <div className="flex items-center gap-2">
                  {r.people === 0 ? (
                    <span className="text-xs text-muted-foreground">No one assigned</span>
                  ) : (
                    <>
                      {r.overdue > 0 && <Badge className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">{r.overdue} overdue</Badge>}
                      {r.ready > 0 && <Badge className="text-[10px] bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300" data-testid="instrument-ready">{r.ready} ready to sign</Badge>}
                      <Badge className={`text-[10px] ${done ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"}`} data-testid="instrument-progress">
                        {r.signed} of {r.people} signed
                      </Badge>
                    </>
                  )}
                  <ChevronRight size={16} className="text-muted-foreground" />
                </div>
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}
