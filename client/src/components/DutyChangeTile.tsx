// DutyChangeTile
//
// Wave H PR H4 (2026-06-06). Renders on the lab-scoped
// /labs/:labId/dashboard alongside CompetencyStatusTile,
// CredentialExpirationTile, and ReassessmentTrackerTile. Surfaces the
// open duty-change reevaluation queue: employees given a test system after
// their setup session without a follow-up duty-change competency_assessment.
//
// Reg anchor (corrected 2026-10-11, BUG-024): 42 CFR §493.1451(b)(9) (high
// complexity) and §493.1413(b)(9) (moderate): reevaluate before reporting
// patient results when test methodology or instrumentation changes. TJC
// HR.01.06.01 mirrors. Lazy auto-resolves on GET when a matching assessment
// lands; see server/routes.ts duty-change-events handler.
//
// BUG-024 (Michael Q72/Q74, 2026-10-11): "Show all" lists every person, and an
// owner or admin can close a person's open items as not a duty change (a test
// system they already ran that was missing from the record), with a required
// reason that is stored on each item and in the audit log.

import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ChevronRight, ArrowUpRight } from "lucide-react";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { useMemberships } from "@/hooks/useMemberships";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

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

const CLOSE_REASONS = [
  "Already performed this test system; it was missing from the record",
  "Recorded at setup: existing duty",
  "Other",
] as const;

type Group = { employeeId: number; employeeName: string; instruments: string[]; eventIds: number[]; maxDaysOpen: number };

export function DutyChangeTile({ className = "" }: { className?: string }) {
  const activeLabId = useActiveLabId();
  const labRoute = useLabRoute();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: memberships } = useMemberships();
  const membership = activeLabId ? memberships?.find((m) => m.labId === activeLabId) : undefined;
  const canClose = membership?.role === "owner" || membership?.role === "admin";
  const [showAll, setShowAll] = useState(false);
  const [closing, setClosing] = useState<Group | null>(null);
  const [choice, setChoice] = useState<string>(CLOSE_REASONS[0]);
  const [other, setOther] = useState("");
  const [saving, setSaving] = useState(false);
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

  // One row per employee with the affected test system(s).
  const byEmployee = new Map<number, Group>();
  for (const e of events) {
    if (!byEmployee.has(e.employeeId)) {
      byEmployee.set(e.employeeId, { employeeId: e.employeeId, employeeName: e.employeeName, instruments: [], eventIds: [], maxDaysOpen: 0 });
    }
    const g = byEmployee.get(e.employeeId)!;
    g.instruments.push(e.instrumentName);
    g.eventIds.push(e.id);
    g.maxDaysOpen = Math.max(g.maxDaysOpen, e.daysOpen);
  }
  const allGroups = Array.from(byEmployee.values()).sort((a, b) => b.maxDaysOpen - a.maxDaysOpen);
  const groups = showAll ? allGroups : allGroups.slice(0, 5);
  const overdueCount = events.filter(e => e.daysOpen > 30).length;
  const reason = choice === "Other" ? other.trim() : choice;

  const submitClose = async () => {
    if (!closing || !reason) return;
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/api/labs/${activeLabId}/staff/duty-change-events/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ eventIds: closing.eventIds, reason }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Could not close these items");
      toast({ title: `Closed ${j.closed} item${j.closed === 1 ? "" : "s"} for ${closing.employeeName}`, description: reason });
      setClosing(null);
      setOther("");
      setChoice(CLOSE_REASONS[0]);
      qc.invalidateQueries({ queryKey: [url ?? "no-duty-change"] });
    } catch (e: any) {
      toast({ title: "Not closed", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={className} data-testid="duty-change-tile">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ArrowUpRight size={16} className="text-primary" />
            <h3 className="font-semibold">Duty-Change Reassessments</h3>
            <span className="text-xs text-muted-foreground" data-testid="duty-change-open-count">{events.length} open</span>
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
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {showAll ? `All ${allGroups.length} employee(s) needing reassessment` : `First ${groups.length} of ${allGroups.length} employee(s) needing reassessment`}
            </div>
            {allGroups.length > 5 && (
              <button type="button" className="text-[10px] text-primary hover:underline" data-testid="duty-change-show-all" onClick={() => setShowAll(!showAll)}>
                {showAll ? "Show first 5" : "Show all"}
              </button>
            )}
          </div>
          <div className="space-y-1">
            {groups.map(g => (
              <div key={g.employeeId} className="text-xs flex items-center justify-between gap-2" data-testid="duty-change-row">
                <div className="truncate">
                  <span className="font-medium">{g.employeeName}</span>
                  <span className="text-muted-foreground ml-2">
                    {g.instruments.slice(0, 3).join(", ")}
                    {g.instruments.length > 3 ? ` +${g.instruments.length - 3} more` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-[10px] ${g.maxDaysOpen > 30 ? "text-red-700 font-medium" : "text-muted-foreground"}`}>
                    {g.maxDaysOpen === 0 ? "today" : `${g.maxDaysOpen}d open`}
                  </span>
                  {canClose && (
                    <button type="button" className="text-[10px] text-primary hover:underline" data-testid="duty-change-close-open"
                      title="Close these items as not a change in duties, with a reason" onClick={() => setClosing(g)}>
                      Not a change
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
      <Dialog open={!!closing} onOpenChange={(o) => { if (!o) setClosing(null); }}>
        <DialogContent data-testid="duty-change-close-dialog">
          <DialogHeader>
            <DialogTitle>Not a change in duties</DialogTitle>
            <DialogDescription>
              {closing ? `${closing.employeeName}: ${closing.instruments.length} test system${closing.instruments.length === 1 ? "" : "s"} (${closing.instruments.join(", ")}).` : ""}
              {" "}A test system added after setup normally needs a reassessment before the person reports patient results on it. Close these only if they are not a change in duties. The reason is kept on each item and in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 text-sm">
            {CLOSE_REASONS.map((r, i) => (
              <label key={r} className="flex items-start gap-2 cursor-pointer">
                <input type="radio" name="duty-change-close-reason" className="mt-1" checked={choice === r} onChange={() => setChoice(r)} data-testid={`duty-change-close-reason-${i}`} />
                <span>{r}</span>
              </label>
            ))}
            {choice === "Other" && (
              <Input className="mt-2" placeholder="Reason a surveyor will read" value={other} onChange={(e) => setOther(e.target.value)} data-testid="duty-change-close-other" />
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClosing(null)}>Cancel</Button>
            <Button disabled={!reason || saving} onClick={submitClose} data-testid="duty-change-close-save">
              {saving ? "Closing..." : "Close as not a change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
