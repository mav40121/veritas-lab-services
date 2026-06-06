// ReassessmentTrackerTile
//
// Wave G PR G2 (2026-06-06). Surfaces the open reassessment queue on the
// lab dashboard: employees whose most recent competency assessment failed
// and who have not yet had a passing follow-up. Pairs visually with the
// CompetencyStatusTile (PR #562) and CredentialExpirationTile (PR #574).
//
// Per 42 CFR §493.1235(b)(7) and TJC HR.01.06.01, a failing assessment
// triggers a mandatory reassessment cycle. The lab director must track
// who owes a follow-up — that is what this tile does. 30-day window is
// the customary corrective-action window; longer counts as overdue.

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, ChevronRight, RefreshCw } from "lucide-react";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";

type ReassessmentStats = {
  awaiting: number;
  overdue: number;
  totalOpen: number;
  sample: Array<{
    employeeId: number;
    programId: number;
    employeeName: string;
    programName: string;
    failDate: string;
    daysSinceFail: number;
    bucket: "awaiting" | "overdue";
  }>;
};

export function ReassessmentTrackerTile({ className = "" }: { className?: string }) {
  const activeLabId = useActiveLabId();
  const labRoute = useLabRoute();
  const url = activeLabId ? `/api/labs/${activeLabId}/competency/reassessment-stats` : null;
  const { data, isLoading } = useQuery<ReassessmentStats>({
    queryKey: [url ?? "no-reassessment-stats"],
    queryFn: async () => {
      if (!url) return { awaiting: 0, overdue: 0, totalOpen: 0, sample: [] };
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!r.ok) return { awaiting: 0, overdue: 0, totalOpen: 0, sample: [] };
      return r.json();
    },
    enabled: !!url,
  });

  if (!activeLabId) return null;
  if (isLoading) return null;
  // Self-hide when no failing assessments are open. A lab with zero
  // open reassessments sees no tile noise — same hide-when-clean pattern
  // CompetencyStatusTile + CredentialExpirationTile use.
  if (!data || data.totalOpen === 0) return null;

  const stats = [
    {
      label: "Awaiting reassessment",
      value: data.awaiting,
      icon: Clock,
      tone: "text-amber-700 bg-amber-500/10 border-amber-500/30",
    },
    {
      label: "Overdue (>30 days)",
      value: data.overdue,
      icon: AlertTriangle,
      tone: "text-red-700 bg-red-500/10 border-red-500/30",
    },
  ];

  return (
    <Card className={className}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <RefreshCw size={16} className="text-primary" />
            <h3 className="font-semibold">Open Reassessments</h3>
            <span className="text-xs text-muted-foreground">{data.totalOpen} open</span>
            {data.overdue > 0 && (
              <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-700 bg-red-500/5">
                {data.overdue} overdue
              </Badge>
            )}
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={labRoute("/veritacomp-app")}>
              Open VeritaComp <ChevronRight size={12} className="ml-1" />
            </Link>
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {stats.map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} className={`rounded-md border px-3 py-2 ${s.tone}`}>
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Icon size={12} />
                  {s.label}
                </div>
                <div className="text-2xl font-bold leading-tight mt-0.5">{s.value}</div>
              </div>
            );
          })}
        </div>
        {data.sample.length > 0 && (
          <div className="border-t border-border pt-2 mt-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">First {data.sample.length} open</div>
            <div className="space-y-0.5">
              {data.sample.map(row => {
                const dayLabel = row.daysSinceFail === 0
                  ? "Failed today"
                  : `Failed ${row.daysSinceFail}d ago`;
                return (
                  <div key={`${row.employeeId}:${row.programId}`} className="text-xs flex items-center justify-between gap-2">
                    <Link href={labRoute(`/veritacomp-app/${row.programId}`)} className="text-primary hover:underline truncate">
                      {row.employeeName}
                    </Link>
                    <span className="text-muted-foreground text-[10px] shrink-0">
                      {row.programName} : {dayLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
