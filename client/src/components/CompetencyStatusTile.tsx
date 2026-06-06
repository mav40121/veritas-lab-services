// CompetencyStatusTile
//
// PR E2 of the VeritaComp customer-blockers wave (2026-06-05). Renders on
// the lab-scoped /labs/:labId/dashboard. Four colored stat boxes (Overdue,
// Due <=30d, Due <=90d, Compliant) + an at-a-glance preview of the first
// five overdue employees, with a CTA to drill into the filtered employee
// list in VeritaStaff.
//
// Surveyors ask "show me who is overdue" within the first five minutes of a
// TJC visit. This tile makes that one click.

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, AlertTriangle, Clock, CheckCircle2, ChevronRight } from "lucide-react";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";

type CompetencyStats = {
  overdue: number;
  dueSoon30: number;
  dueSoon90: number;
  compliant: number;
  total: number;
  percentCompliant: number;
  overdueSample: Array<{ id: number; name: string; nextDue: string | null; reason: string }>;
};

export function CompetencyStatusTile({ className = "" }: { className?: string }) {
  const activeLabId = useActiveLabId();
  const labRoute = useLabRoute();
  const url = activeLabId ? `/api/labs/${activeLabId}/competency/dashboard-stats` : null;
  const { data, isLoading } = useQuery<CompetencyStats>({
    queryKey: [url ?? "no-comp-dashboard-stats"],
    queryFn: async () => {
      if (!url) return { overdue: 0, dueSoon30: 0, dueSoon90: 0, compliant: 0, total: 0, percentCompliant: 100, overdueSample: [] };
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!r.ok) return { overdue: 0, dueSoon30: 0, dueSoon90: 0, compliant: 0, total: 0, percentCompliant: 100, overdueSample: [] };
      return r.json();
    },
    enabled: !!url,
  });

  if (!activeLabId) return null;
  if (isLoading) return null;
  if (!data || data.total === 0) return null;

  const stats = [
    {
      label: "Overdue",
      value: data.overdue,
      icon: AlertTriangle,
      tone: "text-red-700 bg-red-500/10 border-red-500/30",
    },
    {
      label: "Due in 30 days",
      value: data.dueSoon30,
      icon: Clock,
      tone: "text-amber-700 bg-amber-500/10 border-amber-500/30",
    },
    {
      label: "Due in 90 days",
      value: data.dueSoon90,
      icon: Clock,
      tone: "text-yellow-700 bg-yellow-500/10 border-yellow-500/30",
    },
    {
      label: "Compliant",
      value: data.compliant,
      icon: CheckCircle2,
      tone: "text-emerald-700 bg-emerald-500/10 border-emerald-500/30",
    },
  ];

  return (
    <Card className={className}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-primary" />
            <h3 className="font-semibold">Competency Status</h3>
            <span className="text-xs text-muted-foreground">{data.total} testing personnel</span>
            <Badge variant="outline" className="text-[10px]">{data.percentCompliant}% compliant</Badge>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={labRoute("/veritastaff-app?filter=overdue")}>
              View overdue list <ChevronRight size={12} className="ml-1" />
            </Link>
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
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
        {data.overdueSample.length > 0 && (
          <div className="border-t border-border pt-2 mt-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">First {data.overdueSample.length} overdue</div>
            <div className="space-y-0.5">
              {data.overdueSample.map(emp => (
                <div key={emp.id} className="text-xs flex items-center justify-between gap-2">
                  <Link href={labRoute(`/veritastaff-app/${emp.id}`)} className="text-primary hover:underline truncate">
                    {emp.name}
                  </Link>
                  <span className="text-muted-foreground text-[10px] shrink-0">
                    {emp.nextDue ? `Due ${emp.nextDue}` : ""} {emp.reason ? `· ${emp.reason}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
