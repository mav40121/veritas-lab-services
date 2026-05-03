import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GitMerge, AlertTriangle, ChevronRight } from "lucide-react";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders, getUser } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useIsReadOnly } from "@/components/SubscriptionBanner";

interface DueSoonRow {
  id: number;
  correlation_group_id: number | null;
  correlation_method: string | null;
  signoff_date: string | null;
  next_due: string | null;
  pass_fail: string | null;
  test_a_id: number;
  test_a_analyte: string;
  test_a_map_id: number;
  test_a_map_name: string;
  test_a_instrument: string | null;
  test_b_id: number;
  test_b_analyte: string;
  test_b_map_id: number;
  test_b_map_name: string;
  test_b_instrument: string | null;
}

interface DueSoonGroup {
  groupId: number | null; // null = ungrouped, treat each item as its own row
  rows: DueSoonRow[];
  earliestDue: string | null; // ISO YYYY-MM-DD or null
  status: "overdue" | "due_soon" | "upcoming" | "not_signed";
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const dateOnly = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const [y, m, d] = dateOnly.split("-");
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y.slice(2)}`;
}

function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function statusOf(row: DueSoonRow): "overdue" | "due_soon" | "upcoming" | "not_signed" {
  if (!row.signoff_date) return "not_signed";
  if (!row.next_due) return "upcoming";
  const due = new Date(row.next_due).getTime();
  const now = Date.now();
  const days = (due - now) / 86400_000;
  if (days < 0) return "overdue";
  if (days < 30) return "due_soon";
  return "upcoming";
}

function statusRank(s: DueSoonGroup["status"]): number {
  return s === "overdue" ? 0 : s === "not_signed" ? 1 : s === "due_soon" ? 2 : 3;
}

function statusBadge(s: DueSoonGroup["status"]): { label: string; className: string } {
  switch (s) {
    case "overdue":
      return { label: "Overdue", className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" };
    case "not_signed":
      return { label: "Not signed", className: "bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300" };
    case "due_soon":
      return { label: "Due soon", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" };
    case "upcoming":
      return { label: "Upcoming", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" };
  }
}

interface SignoffDialogState {
  open: boolean;
  groupId: number | null; // null = single pair
  singlePairId: number | null;
  pairCount: number;
  preview: string; // human description
}

export function CorrelationsDueSoonWidget({
  windowDays = 60,
  className = "",
}: {
  windowDays?: number;
  className?: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const readOnly = useIsReadOnly("veritamap");

  const { data: rows = [], isLoading } = useQuery<DueSoonRow[]>({
    queryKey: [`/api/veritamap/correlations/due-soon`, windowDays],
    queryFn: async () => {
      const r = await fetch(
        `${API_BASE}/api/veritamap/correlations/due-soon?days=${windowDays}`,
        { headers: authHeaders() }
      );
      if (!r.ok) throw new Error("Failed to load due-soon correlations");
      return r.json();
    },
  });

  // Group by correlation_group_id (null = treat each item individually)
  const groups: DueSoonGroup[] = useMemo(() => {
    const byGroup: Record<number, DueSoonRow[]> = {};
    const ungrouped: DueSoonRow[] = [];
    for (const r of rows) {
      if (r.correlation_group_id == null) ungrouped.push(r);
      else {
        const gid = r.correlation_group_id;
        if (!byGroup[gid]) byGroup[gid] = [];
        byGroup[gid].push(r);
      }
    }
    const out: DueSoonGroup[] = [];
    for (const gidStr of Object.keys(byGroup)) {
      const groupId = parseInt(gidStr, 10);
      const gr = byGroup[groupId];
      let worst: DueSoonGroup["status"] = "upcoming";
      for (const row of gr) {
        const s = statusOf(row);
        if (statusRank(s) < statusRank(worst)) worst = s;
      }
      const earliestDue =
        gr.map((row) => row.next_due).filter((x): x is string => !!x).sort()[0] ?? null;
      out.push({ groupId, rows: gr, earliestDue, status: worst });
    }
    for (const r of ungrouped) {
      out.push({
        groupId: null,
        rows: [r],
        earliestDue: r.next_due,
        status: statusOf(r),
      });
    }
    out.sort((a, b) => {
      const sa = statusRank(a.status);
      const sb = statusRank(b.status);
      if (sa !== sb) return sa - sb;
      const da = a.earliestDue ?? "9999-12-31";
      const db = b.earliestDue ?? "9999-12-31";
      return da < db ? -1 : da > db ? 1 : 0;
    });
    return out;
  }, [rows]);

  const overdueCount = groups.filter((g) => g.status === "overdue").length;
  const dueSoonCount = groups.filter((g) => g.status === "due_soon").length;

  // Sign-off dialog state
  const [dlg, setDlg] = useState<SignoffDialogState>({
    open: false,
    groupId: null,
    singlePairId: null,
    pairCount: 0,
    preview: "",
  });
  const [signoffDate, setSignoffDate] = useState("");
  const [signoffName, setSignoffName] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [nextDueDirty, setNextDueDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function openSignoff(group: DueSoonGroup) {
    const u = getUser();
    setSignoffDate("");
    setSignoffName(u?.name ?? "");
    setNextDue("");
    setNextDueDirty(false);
    if (group.groupId != null) {
      setDlg({
        open: true,
        groupId: group.groupId,
        singlePairId: null,
        pairCount: group.rows.length,
        preview: `Group #${group.groupId} - ${group.rows.length} pair${group.rows.length === 1 ? "" : "s"}`,
      });
    } else {
      const r = group.rows[0];
      setDlg({
        open: true,
        groupId: null,
        singlePairId: r.id,
        pairCount: 1,
        preview: `${r.test_a_analyte} <-> ${r.test_b_analyte}`,
      });
    }
  }

  function onSignoffDateChange(v: string) {
    setSignoffDate(v);
    if (v && !nextDueDirty) setNextDue(addMonthsISO(v, 6));
    if (v && !signoffName) {
      const u = getUser();
      if (u?.name) setSignoffName(u.name);
    }
  }

  async function submitSignoff() {
    if (!signoffDate) {
      toast({ title: "Sign-off date required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const u = getUser();
      const body = {
        signoff_date: signoffDate,
        signoff_by_user_id: u?.id ?? null,
        signoff_by_name: signoffName || u?.name || null,
        next_due: nextDue || null,
      };
      let r: Response;
      if (dlg.groupId != null) {
        r = await fetch(
          `${API_BASE}/api/veritamap/correlations/group/${dlg.groupId}/signoff`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify(body),
          }
        );
      } else if (dlg.singlePairId != null) {
        // Single ungrouped pair: fetch the pair to get test ids, then upsert
        const pair = rows.find((x) => x.id === dlg.singlePairId);
        if (!pair) {
          toast({ title: "Pair not found", variant: "destructive" });
          setSubmitting(false);
          return;
        }
        r = await fetch(`${API_BASE}/api/veritamap/correlations`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            test_a_id: pair.test_a_id,
            test_b_id: pair.test_b_id,
            ...body,
          }),
        });
      } else {
        setSubmitting(false);
        return;
      }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast({ title: "Sign-off failed", description: data.error || "Server error", variant: "destructive" });
        return;
      }
      toast({
        title: "Sign-off recorded",
        description: dlg.groupId != null
          ? `Group #${dlg.groupId} - ${data.pair_count ?? dlg.pairCount} pairs updated`
          : "Pair updated",
      });
      setDlg({ ...dlg, open: false });
      qc.invalidateQueries({ queryKey: [`/api/veritamap/correlations/due-soon`, windowDays] });
      // Also invalidate any open map detail queries so badges refresh
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/veritamap/maps/") });
    } catch {
      toast({ title: "Sign-off failed", description: "Network error. Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  // Hide entirely when nothing's loading and nothing's due
  if (!isLoading && groups.length === 0) return null;

  return (
    <>
      <Card className={className}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <GitMerge size={16} className="text-primary" />
                Correlations due soon
                {overdueCount > 0 && (
                  <Badge className="ml-1 bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-0">
                    {overdueCount} overdue
                  </Badge>
                )}
                {dueSoonCount > 0 && (
                  <Badge className="ml-1 bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-0">
                    {dueSoonCount} due soon
                  </Badge>
                )}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Cross-map correlation pairs needing sign-off (next-due within {windowDays} days or overdue).
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-16 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {groups.map((g, idx) => {
                const badge = statusBadge(g.status);
                const headRow = g.rows[0];
                const otherCount = g.rows.length - 1;
                return (
                  <div
                    key={g.groupId != null ? `g${g.groupId}` : `s${headRow.id}-${idx}`}
                    className="border border-border rounded p-3 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge.className}`}>
                            {badge.label}
                          </span>
                          {g.groupId != null && (
                            <Badge variant="outline" className="text-[10px]">
                              Group #{g.groupId} - {g.rows.length} pair{g.rows.length === 1 ? "" : "s"}
                            </Badge>
                          )}
                          {g.earliestDue && (
                            <span className="text-xs text-muted-foreground">
                              Next due {formatShortDate(g.earliestDue)}
                            </span>
                          )}
                          {g.rows.some((r) => r.pass_fail === "Fail") && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-red-700 dark:text-red-300">
                              <AlertTriangle size={10} /> Has failure
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 space-y-0.5 text-xs">
                          <Link href={`/veritamap-app/${headRow.test_a_map_id}`} className="hover:text-primary">
                            <span className="font-medium">{headRow.test_a_analyte}</span>
                            <span className="text-muted-foreground"> on {headRow.test_a_map_name}</span>
                          </Link>
                          <div className="text-muted-foreground flex items-center gap-1">
                            <ChevronRight size={11} />
                            <Link href={`/veritamap-app/${headRow.test_b_map_id}`} className="hover:text-primary">
                              <span className="font-medium text-foreground">{headRow.test_b_analyte}</span>
                              <span> on {headRow.test_b_map_name}</span>
                            </Link>
                          </div>
                          {otherCount > 0 && (
                            <div className="text-[11px] text-muted-foreground italic">
                              + {otherCount} more pair{otherCount === 1 ? "" : "s"} in this group
                            </div>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs shrink-0"
                        disabled={readOnly}
                        title={readOnly ? "Resubscribe to sign off correlations" : undefined}
                        onClick={() => openSignoff(g)}
                      >
                        Sign off{g.groupId != null ? " group" : ""}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dlg.open} onOpenChange={(v) => { if (!v) setDlg({ ...dlg, open: false }); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sign off correlation{dlg.pairCount > 1 ? " group" : ""}</DialogTitle>
            <DialogDescription>{dlg.preview}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Sign-off date</Label>
              <Input
                type="date"
                value={signoffDate}
                onChange={(e) => onSignoffDateChange(e.target.value)}
              />
              <div className="text-[10px] text-muted-foreground">
                Drives next-due (sign-off + 6 mo). All {dlg.pairCount} pair{dlg.pairCount === 1 ? "" : "s"} get the same date.
              </div>
            </div>
            <div className="space-y-1">
              <Label>Signed off by</Label>
              <Input
                value={signoffName}
                onChange={(e) => setSignoffName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Next due</Label>
              <Input
                type="date"
                value={nextDue}
                onChange={(e) => { setNextDue(e.target.value); setNextDueDirty(true); }}
              />
              {signoffDate && !nextDueDirty && (
                <div className="text-[10px] text-muted-foreground">Auto from sign-off. Override if needed.</div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg({ ...dlg, open: false })} disabled={submitting}>Cancel</Button>
            <Button onClick={submitSignoff} disabled={submitting || !signoffDate}>
              {submitting ? "Saving..." : "Record sign-off"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
