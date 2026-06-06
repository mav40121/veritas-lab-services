// DutyChangeTile
//
// Wave H PR H4 (2026-06-06). Renders on the lab-scoped
// /labs/:labId/dashboard alongside CompetencyStatusTile,
// CredentialExpirationTile, and ReassessmentTrackerTile. Surfaces the
// open duty-change reassessment queue: employees whose VeritaMap
// instrument assignment list grew without a follow-up duty-change
// competency_assessment.
//
// Per 42 CFR §493.1235(a) and TJC HR.01.06.01, an employee's testing
// duties changing triggers a reassessment. This tile is the at-a-glance
// reminder. Lazy auto-resolves on GET when a matching assessment lands;
// see server/routes.ts duty-change-events handler.

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight, ArrowUpRight } from "lucide-react";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";

type DutyChangeEvent = {
  id: number;
  employeeId: number;
  employeeName: string;
  instrumentId: number;
  instrumentName: string;
  serialNumber: string | null;
  nickname: string | null;
  category: string | null;
  detectedAt: string;
  daysOpen: number;
};

export function DutyChangeTile({ className = "" }: { className?: string }) {
  const activeLabId = useActiveLabId();
  const labRoute = useLabRoute();
  const url = activeLabId ? `/api/labs/${activeLabId}/staff/duty-change-events` : null;
  const { data: events = [], isLoading } = useQuery<DutyChangeEvent[]>({
    queryKey: [url ?? "no-duty-change"],
    queryFn: async () => {
      if (!url) return [];
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!url,
  });

  if (!activeLabId) return null;
  if (isLoading) return null;
  // Self-hide when no open events — same hide-when-clean pattern
  // CompetencyStatusTile + CredentialExpirationTile + ReassessmentTrackerTile use.
  if (events.length === 0) return null;

  // Group events by employee for the at-a-glance preview. One row per
  // employee with a chip listing the affected instrument(s).
  const byEmployee = new Map<number, { employeeName: string; instruments: string[]; maxDaysOpen: number }>();
  for (const e of events) {
    if (!byEmployee.has(e.employeeId)) {
      byEmployee.set(e.employeeId, { employeeName: e.employeeName, instruments: [], maxDaysOpen: 0 });
    }
    const g = byEmployee.get(e.employeeId)!;
    g.instruments.push(e.instrumentName);
    g.maxDaysOpen = Math.max(g.maxDaysOpen, e.daysOpen);
  }
  const groups = Array.from(byEmployee.values())
    .sort((a, b) => b.maxDaysOpen - a.maxDaysOpen)
    .slice(0, 5);

  const overdueCount = events.filter(e => e.daysOpen > 30).length;

  return (
    <Card className={className}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ArrowUpRight size={16} className="text-primary" />
            <h3 className="font-semibold">Duty-Change Reassessments</h3>
            <span className="text-xs text-muted-foreground">{events.length} open</span>
            {overdueCount > 0 && (
              <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-700 bg-red-500/5">
                {overdueCount} over 30 days
              </Badge>
            )}
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={labRoute("/veritacomp-app")}>
              Open VeritaComp <ChevronRight size={12} className="ml-1" />
            </Link>
          </Button>
        </div>
        <div className="border-t border-border pt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            First {groups.length} employee(s) needing reassessment
          </div>
          <div className="space-y-1">
            {groups.map(g => (
              <div key={g.employeeName} className="text-xs flex items-center justify-between gap-2">
                <div className="truncate">
                  <span className="font-medium">{g.employeeName}</span>
                  <span className="text-muted-foreground ml-2">
                    {g.instruments.slice(0, 3).join(", ")}
                    {g.instruments.length > 3 ? ` +${g.instruments.length - 3} more` : ""}
                  </span>
                </div>
                <span className={`text-[10px] shrink-0 ${g.maxDaysOpen > 30 ? "text-red-700 font-medium" : "text-muted-foreground"}`}>
                  {g.maxDaysOpen === 0 ? "today" : `${g.maxDaysOpen}d open`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
