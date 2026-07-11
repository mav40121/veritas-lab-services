// CredentialExpirationTile
//
// Wave F PR F3 (2026-06-06). Renders on the lab-scoped /labs/:labId/dashboard
// alongside CompetencyStatusTile. Four colored stat boxes (Expired,
// Expiring <=30d, Expiring 31-60d, Current) + an at-a-glance preview of the
// first five expired/expiring credentials, with a CTA to drill into the
// filtered employee list in VeritaStaff (?filter=expiring).
//
// Surveyors check credential currency alongside competency in the opening
// minutes of a survey. The pair of tiles puts both signals one click away.
//
// Shape mirrors CompetencyStatusTile so the customer's mental model of
// "dashboard tile -> drill into filtered list" stays consistent across the
// two compliance dimensions.

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, CheckCircle2, ChevronRight, BadgeCheck } from "lucide-react";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";

type CredentialStats = {
  expired: number;
  expiring30: number;
  expiring60: number;
  current: number;
  total: number;
  percentCurrent: number;
  expiringSample: Array<{
    docId: number;
    empId: number;
    name: string;
    docType: string;
    docTitle: string | null;
    expirationDate: string;
    daysRemaining: number;
  }>;
};

export function CredentialExpirationTile({ className = "" }: { className?: string }) {
  const activeLabId = useActiveLabId();
  const labRoute = useLabRoute();
  const url = activeLabId ? `/api/labs/${activeLabId}/staff/credentials-dashboard-stats` : null;
  const { data, isLoading, isError } = useQuery<CredentialStats>({
    queryKey: [url ?? "no-cred-dashboard-stats"],
    queryFn: async () => {
      if (!url) return { expired: 0, expiring30: 0, expiring60: 0, current: 0, total: 0, percentCurrent: 100, expiringSample: [] };
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      // Throw (not return zeros) so a broken endpoint surfaces as isError and a
      // distinct message, instead of a vanished tile that looks like "all current".
      if (!r.ok) throw new Error("credential dashboard stats unavailable");
      return r.json();
    },
    enabled: !!url,
  });

  if (!activeLabId) return null;
  if (isLoading) return null;
  if (isError) return (
    <Card className={className}>
      <CardContent className="py-4 text-sm text-muted-foreground flex items-center gap-2">
        <AlertTriangle size={16} className="text-amber-600" />
        Credential status is unavailable right now. Refresh to retry.
      </CardContent>
    </Card>
  );
  // Only render the tile if the lab has linked at least one credential with
  // an expiration_date. Otherwise the customer sees a tile screaming
  // "0 credentials" which is technically correct but useless noise.
  if (!data || data.total === 0) return null;

  const stats = [
    {
      label: "Expired",
      value: data.expired,
      icon: AlertTriangle,
      tone: "text-red-700 bg-red-500/10 border-red-500/30",
    },
    {
      label: "Expires in 30 days",
      value: data.expiring30,
      icon: Clock,
      tone: "text-amber-700 bg-amber-500/10 border-amber-500/30",
    },
    {
      label: "Expires in 60 days",
      value: data.expiring60,
      icon: Clock,
      tone: "text-yellow-700 bg-yellow-500/10 border-yellow-500/30",
    },
    {
      label: "Current",
      value: data.current,
      icon: CheckCircle2,
      tone: "text-emerald-700 bg-emerald-500/10 border-emerald-500/30",
    },
  ];

  return (
    <Card className={className}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BadgeCheck size={16} className="text-primary" />
            <h3 className="font-semibold">Credential Status</h3>
            <span className="text-xs text-muted-foreground">{data.total} credentials tracked</span>
            <Badge variant="outline" className="text-[10px]">{data.percentCurrent}% current</Badge>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={labRoute("/veritastaff-app?filter=expiring")}>
              View expiring list <ChevronRight size={12} className="ml-1" />
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
        {data.expiringSample.length > 0 && (
          <div className="border-t border-border pt-2 mt-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">First {data.expiringSample.length} expiring</div>
            <div className="space-y-0.5">
              {data.expiringSample.map(row => {
                const dayLabel = row.daysRemaining < 0
                  ? `Expired ${Math.abs(row.daysRemaining)}d ago`
                  : row.daysRemaining === 0
                    ? "Expires today"
                    : `Expires in ${row.daysRemaining}d`;
                return (
                  <div key={row.docId} className="text-xs flex items-center justify-between gap-2">
                    <Link href={labRoute(`/veritastaff-app/${row.empId}`)} className="text-primary hover:underline truncate">
                      {row.name}
                    </Link>
                    <span className="text-muted-foreground text-[10px] shrink-0">
                      {row.docTitle || row.docType} : {dayLabel}
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
