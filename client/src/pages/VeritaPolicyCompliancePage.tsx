// VeritaPolicyCompliancePage.tsx
//
// Phase 6A of the MediaLab functional mirror. Read-only compliance
// dashboard for owners / admins / active members. Surfaces per-manual
// coverage, overdue + due-soon policies, attestation rates per staff,
// pending-review by step. Phase 6B will add the cron-fired email
// reminders + auto-expire.

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { VeritaPolicyTabs } from "@/components/VeritaPolicyTabs";
import { apiRequest, queryClient, getQueryFn, API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  ArrowLeft,
  AlertTriangle,
  Clock,
  ShieldCheck,
  FileText,
  Link as LinkIcon,
  Copy,
  Download,
  Trash2,
} from "lucide-react";

interface ManualRow {
  manual_id: number | null;
  manual_name: string;
  total: number;
  approved: number;
  in_review: number;
  draft: number;
  expired: number;
  overdue: number;
  due_soon: number;
}

interface OverdueRow {
  id: number;
  title: string;
  next_review_date: string | null;
  manual_name: string | null;
}

interface UserAttestRow {
  user_id: number;
  user_name: string | null;
  email: string;
  pending: number;
  completed: number;
  total: number;
}

interface PendingReviewRow {
  id: number;
  title: string;
  manual_name: string | null;
  updated_at: string;
  pending_step_name: string | null;
  pending_step_role: string | null;
  pending_step_order: number | null;
  pending_total_steps: number;
}

interface Compliance {
  headline: {
    approved_total: number;
    in_review_total: number;
    draft_total: number;
    expired_total: number;
    doc_total: number;
  };
  perManual: ManualRow[];
  overdueList: OverdueRow[];
  dueSoonList: OverdueRow[];
  perUserAttest: UserAttestRow[];
  pendingReviewList: PendingReviewRow[];
}

function fmtDate(s: string | null): string {
  if (!s) return "-";
  try {
    return new Date(s).toLocaleDateString();
  } catch {
    return s;
  }
}

function pct(n: number, d: number): string {
  if (!d) return "-";
  return `${Math.round((100 * n) / d)}%`;
}

interface SurveyorLink {
  id: number;
  token: string;
  label: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  use_count: number;
  last_used_at: string | null;
}

export default function VeritaPolicyCompliancePage() {
  const activeLabId = useActiveLabId();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<Compliance>({
    queryKey: [`/api/labs/${activeLabId}/veritapolicy/compliance`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!activeLabId,
    refetchInterval: 60000,
  });

  const { data: linksData } = useQuery<{ links: SurveyorLink[] }>({
    queryKey: [`/api/labs/${activeLabId}/veritapolicy/surveyor-links`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!activeLabId,
  });
  const links = linksData?.links || [];

  const [createOpen, setCreateOpen] = useState(false);
  const [createLabel, setCreateLabel] = useState("");
  const [createDays, setCreateDays] = useState("14");

  const createLinkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/labs/${activeLabId}/veritapolicy/surveyor-links`,
        { label: createLabel.trim() || undefined, expiresInDays: Number(createDays) || 14 }
      );
      return res.json();
    },
    onSuccess: async (body: any) => {
      try {
        await navigator.clipboard.writeText(body.url);
        toast({ title: "Link copied", description: body.url });
      } catch {
        toast({ title: "Link created", description: body.url });
      }
      setCreateOpen(false);
      setCreateLabel("");
      setCreateDays("14");
      queryClient.invalidateQueries({
        queryKey: [`/api/labs/${activeLabId}/veritapolicy/surveyor-links`],
      });
    },
    onError: (err: any) =>
      toast({ title: "Create failed", description: String(err?.message || err), variant: "destructive" }),
  });

  const revokeLinkMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest(
        "DELETE",
        `/api/labs/${activeLabId}/veritapolicy/surveyor-links/${id}`
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Link revoked" });
      queryClient.invalidateQueries({
        queryKey: [`/api/labs/${activeLabId}/veritapolicy/surveyor-links`],
      });
    },
    onError: (err: any) =>
      toast({ title: "Revoke failed", description: String(err?.message || err), variant: "destructive" }),
  });

  const copyLink = async (token: string) => {
    const url = `${window.location.origin}/surveyor/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: url });
    } catch {
      toast({ title: "Could not copy; URL:", description: url });
    }
  };

  if (!activeLabId) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card>
          <CardContent className="p-6">
            Pick a lab from the lab switcher to view the compliance dashboard.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <Card>
          <CardContent className="p-6 flex items-center gap-2 text-muted-foreground">
            <Loader2 className="animate-spin" size={14} /> Loading...
          </CardContent>
        </Card>
      </div>
    );
  }

  const { headline, perManual, overdueList, dueSoonList, perUserAttest, pendingReviewList } = data;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <VeritaPolicyTabs active="compliance" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Compliance Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Per-manual coverage, overdue policies, pending reviews, and attestation rates for
            this lab. Numbers refresh every minute. Phase 6B will add cron-fired email
            reminders and auto-expire.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* MediaLab parity #39 item 3: xlsx export. Hands the surveyor a
              workbook of the same numbers shown on this page so they can
              filter/sort it themselves. */}
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!activeLabId) return;
              const r = await fetch(
                `${API_BASE}/api/labs/${activeLabId}/veritapolicy/compliance/xlsx`,
                { headers: authHeaders() }
              );
              if (!r.ok) return;
              const blob = await r.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `VeritaPolicy_Compliance_${new Date().toISOString().split("T")[0]}.xlsx`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={14} className="mr-1" /> Export xlsx
          </Button>
          <Link href={`/labs/${activeLabId}/veritapolicy-app/my-policies`}>
            <Button variant="outline" size="sm">
              <ArrowLeft size={14} className="mr-1" /> My Policies
            </Button>
          </Link>
        </div>
      </div>

      {/* Headline tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Total</div>
            <div className="text-2xl font-bold">{headline.doc_total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-emerald-700 uppercase">Approved</div>
            <div className="text-2xl font-bold text-emerald-700">
              {headline.approved_total}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-amber-700 uppercase">In review</div>
            <div className="text-2xl font-bold text-amber-700">
              {headline.in_review_total}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-700 uppercase">Draft</div>
            <div className="text-2xl font-bold text-slate-700">{headline.draft_total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-red-700 uppercase">Expired</div>
            <div className="text-2xl font-bold text-red-700">{headline.expired_total}</div>
          </CardContent>
        </Card>
      </div>

      {/* Overdue policies */}
      {overdueList.length > 0 && (
        <Card className="border-red-300 bg-red-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-700" />
              Overdue policies ({overdueList.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {overdueList.map((d) => (
                <li key={d.id} className="flex justify-between gap-3">
                  <span className="font-medium">{d.title}</span>
                  <span className="text-xs text-red-700">
                    {d.manual_name && <span className="mr-2 text-muted-foreground">{d.manual_name}</span>}
                    next review {fmtDate(d.next_review_date)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Due-soon policies */}
      {dueSoonList.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock size={16} className="text-amber-700" /> Due in the next 30 days (
              {dueSoonList.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {dueSoonList.map((d) => (
                <li key={d.id} className="flex justify-between gap-3">
                  <span className="font-medium">{d.title}</span>
                  <span className="text-xs text-amber-700">
                    {d.manual_name && <span className="mr-2 text-muted-foreground">{d.manual_name}</span>}
                    next review {fmtDate(d.next_review_date)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Per-manual coverage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText size={16} /> Per-manual coverage
          </CardTitle>
        </CardHeader>
        <CardContent>
          {perManual.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No manuals with policies yet. Head to{" "}
              <Link
                href={`/labs/${activeLabId}/veritapolicy-app/my-policies`}
                className="underline"
              >
                My Policies
              </Link>{" "}
              to upload your first.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Manual</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                    <th className="py-2 pr-3 text-right">Approved</th>
                    <th className="py-2 pr-3 text-right">In review</th>
                    <th className="py-2 pr-3 text-right">Draft</th>
                    <th className="py-2 pr-3 text-right">Overdue</th>
                    <th className="py-2 pr-3 text-right">Due soon</th>
                    <th className="py-2 pr-3 text-right">% approved</th>
                  </tr>
                </thead>
                <tbody>
                  {perManual.map((m) => (
                    <tr key={`${m.manual_id ?? "none"}`} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 font-medium">{m.manual_name}</td>
                      <td className="py-2 pr-3 text-right">{m.total}</td>
                      <td className="py-2 pr-3 text-right text-emerald-700">{m.approved}</td>
                      <td className="py-2 pr-3 text-right text-amber-700">{m.in_review}</td>
                      <td className="py-2 pr-3 text-right text-muted-foreground">{m.draft}</td>
                      <td
                        className={`py-2 pr-3 text-right ${
                          m.overdue > 0 ? "text-red-700 font-semibold" : "text-muted-foreground"
                        }`}
                      >
                        {m.overdue}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right ${
                          m.due_soon > 0 ? "text-amber-700 font-medium" : "text-muted-foreground"
                        }`}
                      >
                        {m.due_soon}
                      </td>
                      <td className="py-2 pr-3 text-right">{pct(m.approved, m.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending review by step */}
      {pendingReviewList.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck size={16} /> Pending review ({pendingReviewList.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {pendingReviewList.map((d) => (
                <li key={d.id} className="flex justify-between gap-3">
                  <div>
                    <span className="font-medium">{d.title}</span>
                    {d.manual_name && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        in {d.manual_name}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {d.pending_step_name ? (
                      <>
                        step {d.pending_step_order} of {d.pending_total_steps}: {d.pending_step_name}
                      </>
                    ) : (
                      "(no pending step)"
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Surveyor public links */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <LinkIcon size={16} /> Surveyor public links
            </span>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              Create link
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-2">
            Generate a signed URL a surveyor can use to browse approved policies without
            authentication. Auto-expires after the window you pick. Revoke any time. Audit
            captures every hit.
          </p>
          {links.length === 0 ? (
            <div className="text-sm text-muted-foreground">No surveyor links yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Label</th>
                    <th className="py-2 pr-3">Created</th>
                    <th className="py-2 pr-3">Expires</th>
                    <th className="py-2 pr-3 text-right">Uses</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((l) => {
                    const isRevoked = !!l.revoked_at;
                    const isExpired = !isRevoked && new Date(l.expires_at).getTime() < Date.now();
                    return (
                      <tr key={l.id} className="border-b last:border-b-0">
                        <td className="py-2 pr-3 font-medium">{l.label || "(no label)"}</td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {fmtDate(l.created_at)}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {fmtDate(l.expires_at)}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {l.use_count}
                          {l.last_used_at && (
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              (last {fmtDate(l.last_used_at)})
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {isRevoked ? (
                            <span className="text-xs text-red-700">revoked</span>
                          ) : isExpired ? (
                            <span className="text-xs text-zinc-500">expired</span>
                          ) : (
                            <span className="text-xs text-emerald-700">active</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right space-x-1">
                          {!isRevoked && !isExpired && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => copyLink(l.token)}
                            >
                              <Copy size={12} className="mr-1" /> Copy
                            </Button>
                          )}
                          {!isRevoked && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-600 hover:text-red-700"
                              onClick={() => {
                                if (
                                  confirm(`Revoke this surveyor link? The URL stops working.`)
                                )
                                  revokeLinkMutation.mutate(l.id);
                              }}
                            >
                              <Trash2 size={12} className="mr-1" /> Revoke
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create surveyor link</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Label (optional, helps you track which visit)</Label>
              <Input
                value={createLabel}
                onChange={(e) => setCreateLabel(e.target.value)}
                placeholder="e.g., CAP visit Q3 2026"
              />
            </div>
            <div>
              <Label className="text-xs">Expires in</Label>
              <Input
                type="number"
                min={1}
                max={90}
                value={createDays}
                onChange={(e) => setCreateDays(e.target.value)}
              />
              <div className="text-[10px] text-muted-foreground mt-1">
                1 to 90 days. Default 14.
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createLinkMutation.mutate()}
              disabled={createLinkMutation.isPending}
            >
              {createLinkMutation.isPending && (
                <Loader2 className="animate-spin mr-1" size={14} />
              )}
              Create + copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-user attestation rate */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attestation rates per staff</CardTitle>
        </CardHeader>
        <CardContent>
          {perUserAttest.length === 0 ? (
            <div className="text-sm text-muted-foreground">No active lab members.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Staff</th>
                    <th className="py-2 pr-3 text-right">Pending</th>
                    <th className="py-2 pr-3 text-right">Completed</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                    <th className="py-2 pr-3 text-right">% complete</th>
                  </tr>
                </thead>
                <tbody>
                  {perUserAttest.map((u) => (
                    <tr key={u.user_id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{u.user_name || u.email}</div>
                        {u.user_name && (
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        )}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right ${
                          u.pending > 0 ? "text-amber-700 font-medium" : "text-muted-foreground"
                        }`}
                      >
                        {u.pending}
                      </td>
                      <td className="py-2 pr-3 text-right text-emerald-700">{u.completed}</td>
                      <td className="py-2 pr-3 text-right">{u.total}</td>
                      <td className="py-2 pr-3 text-right">{pct(u.completed, u.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
