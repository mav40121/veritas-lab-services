// VeritaMaintain monthly record review (Michael 2026-11-04, Q161 = 1). The medical director or a designee named in a signed Letter of Delegation reviews each instrument and
// temperature unit for a month and signs with a typed name and password. A problem the records show needs a corrective action before it can be signed. An entry added after
// signing shows up as added after the review. Server: server/maintainRecordReview.ts.
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useCanRecord } from "@/components/SubscriptionBanner";
import { useLabRoute } from "@/hooks/useLabRoute";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClipboardCheck, FileSpreadsheet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { labDayOf } from "@/lib/labDate";

type ReviewItem = {
  key: string; type: "equipment" | "temp_unit" | "stain_manual"; id: number; name: string; detail: string | null; retired: boolean;
  problems: string[]; notes: string[]; entries_after_review: number; summary?: { unit_type?: string; stain_rows?: number };
  review: { typed_signature: string; capacity_label: string; signed_at: string; corrective_action: string | null; problems: string[]; summary: { notes?: string[] } } | null;
};
type ReviewMonth = { month: string; can_review: boolean; capacity_label: string | null; items: ReviewItem[]; counts: { total: number; reviewed: number; open: number } };

const thisMonth = () => new Date().toLocaleDateString("en-CA").slice(0, 7);
const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
};

export function MonthlyRecordReviewPanel({ labId }: { labId: number }) {
  const { toast } = useToast();
  const canRecord = useCanRecord();
  const labRoute = useLabRoute();
  const base = `${API_BASE}/api/labs/${labId}/maintain-reviews`;
  // Open on last month: that's the one there is to review.
  const [month, setMonth] = useState(shiftMonth(thisMonth(), -1));
  const [data, setData] = useState<ReviewMonth | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [signing, setSigning] = useState(false);
  const [action, setAction] = useState("");
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function load(m = month) {
    setLoading(true);
    try {
      const r = await fetch(`${base}?month=${m}`, { headers: authHeaders() });
      if (r.ok) {
        const j: ReviewMonth = await r.json();
        setData(j);
        setPicked(new Set(j.items.filter((i) => !i.review).map((i) => i.key)));
      }
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [labId, month]);

  const open = data?.items.filter((i) => !i.review) ?? [];
  const chosen = open.filter((i) => picked.has(i.key));
  const needsAction = chosen.some((i) => i.problems.length > 0);
  const toggle = (key: string) => setPicked((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  async function sign() {
    if (needsAction && !action.trim()) { toast({ title: "Record the corrective action for the problems shown", variant: "destructive" }); return; }
    if (typed.trim().length < 2) { toast({ title: "Type your full name to sign", variant: "destructive" }); return; }
    if (!password) { toast({ title: "Enter your password to sign", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const r = await fetch(base, {
        method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ month, items: chosen.map((i) => ({ type: i.type, id: i.id })), typed_signature: typed.trim(), password, corrective_action: action.trim() || null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast({ title: j.error || "Could not sign the review", variant: "destructive" }); return; }
      toast({ title: `Review signed for ${j.reviewed} record${j.reviewed === 1 ? "" : "s"}` });
      setSigning(false); setAction(""); setTyped(""); setPassword("");
      await load();
    } finally { setSaving(false); }
  }

  async function download() {
    setDownloading(true);
    try {
      const r = await fetch(`${base}/report.xlsx?month=${month}`, { headers: authHeaders() });
      if (!r.ok) { toast({ title: "Could not build the report", variant: "destructive" }); return; }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `VeritaMaintain_Monthly_Review_${month}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally { setDownloading(false); }
  }

  return (
    <Card className="mt-4" data-testid="monthly-review-panel">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-primary" /> Monthly record review</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setMonth(shiftMonth(month, -1))}>Previous</Button>
          <span className="text-sm font-medium" data-testid="review-month">{month}</span>
          <Button size="sm" variant="outline" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth()}>Next</Button>
          <Button size="sm" variant="outline" onClick={download} disabled={downloading} data-testid="review-report">
            <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />{downloading ? "Building..." : "Report (Excel)"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">The medical director or designee reviews each record at least monthly and records corrective action for any problem found.</p>
        {data && !data.can_review && (
          <p className="text-xs text-amber-800 dark:text-amber-300 mb-3" data-testid="review-cant-sign">
            Only the medical director, or someone named in a signed Letter of Delegation for this review, can sign. Set that up under{" "}
            <Link href={labRoute("/veritastaff-app?tab=delegations")} className="underline">VeritaStaff™ Delegations</Link>.
          </p>
        )}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="review-empty">No instruments or temperature units to review for this month.</p>
        ) : (
          <>
            <div className="text-sm font-medium mb-2" data-testid="review-count">{data.counts.reviewed} of {data.counts.total} records reviewed for {month}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="review-table">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground border-b">
                    <th className="py-2 pr-2 w-6"></th>
                    <th className="py-2 pr-2">Record</th>
                    <th className="py-2 pr-2">What the records show</th>
                    <th className="py-2">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((i) => (
                    <tr key={i.key} className="border-b last:border-0 align-top" data-testid={`review-row-${i.key}`}>
                      <td className="py-2 pr-2">
                        {!i.review && data.can_review && (
                          <input type="checkbox" aria-label={`Include ${i.name}`} checked={picked.has(i.key)} onChange={() => toggle(i.key)} data-testid={`review-pick-${i.key}`} />
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <div className="font-medium">{i.name}</div>
                        <div className="text-xs text-muted-foreground">{i.type === "equipment" ? "Instrument" : i.type === "stain_manual" ? "Stain log" : i.summary?.unit_type === "humidity" ? "Humidity log" : "Temperature log"}{i.detail ? ` · ${i.detail}` : ""}{i.retired ? " · retired" : ""}</div>
                        {i.type === "stain_manual" ? (
                          <Link href={labRoute(`/equipment-app/stain-log?view=manual&month=${month}`)} className="text-xs underline" data-testid={`review-stain-link-${i.key}`}>Open the manual stain log</Link>
                        ) : i.type === "equipment" && i.summary?.stain_rows ? (
                          <Link href={labRoute(`/equipment-app/stain-log?instrument=${i.id}&month=${month}`)} className="text-xs underline" data-testid={`review-stain-link-${i.key}`}>Open the stain log</Link>
                        ) : null}
                      </td>
                      <td className="py-2 pr-2 text-xs">
                        {(i.review ? i.review.problems : i.problems).map((p) => <div key={p} className="font-medium text-red-700 dark:text-red-400">{p}</div>)}
                        <div className="text-muted-foreground">{(i.review?.summary?.notes ?? i.notes).join(" · ")}</div>
                        {i.entries_after_review > 0 && (
                          <div className="font-medium text-amber-800 dark:text-amber-300" data-testid={`review-after-${i.key}`}>{i.entries_after_review} added after this review was signed</div>
                        )}
                      </td>
                      <td className="py-2 text-xs">
                        {i.review ? (
                          <div className="text-green-800 dark:text-green-300">
                            <div className="font-medium">Reviewed {labDayOf(i.review.signed_at)}</div>
                            <div>{i.review.typed_signature}, {i.review.capacity_label}</div>
                            {i.review.corrective_action && <div className="text-foreground mt-0.5 whitespace-pre-wrap">Corrective action: {i.review.corrective_action}</div>}
                          </div>
                        ) : <span className="font-medium text-amber-800 dark:text-amber-300">Not reviewed</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.can_review && open.length > 0 && (
              <div className="flex justify-end mt-3">
                <Button size="sm" onClick={() => setSigning(true)} disabled={!canRecord || chosen.length === 0} data-testid="review-open-sign">Sign review ({chosen.length})</Button>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={signing} onOpenChange={setSigning}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sign the {month} review</DialogTitle>
            <DialogDescription>You are signing as {data?.capacity_label}, for {chosen.length} record{chosen.length === 1 ? "" : "s"}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 min-w-0">
            {needsAction && (
              <div data-testid="review-problems">
                <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">These need a corrective action:</p>
                <ul className="text-xs list-disc pl-4 mb-2">
                  {chosen.filter((i) => i.problems.length).map((i) => <li key={i.key}>{i.name}: {i.problems.join("; ")}</li>)}
                </ul>
                <Label htmlFor="rv-action">Corrective action <span className="text-red-600">*</span></Label>
                <Textarea id="rv-action" rows={3} value={action} onChange={(e) => setAction(e.target.value)} placeholder="What was done, and any impact on patient testing" data-testid="review-action" />
              </div>
            )}
            <div><Label htmlFor="rv-name">Type your full name to sign <span className="text-red-600">*</span></Label><Input id="rv-name" value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="review-name" /></div>
            <div><Label htmlFor="rv-pw">Password <span className="text-red-600">*</span></Label><Input id="rv-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="review-password" /></div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setSigning(false)} disabled={saving}>Cancel</Button>
            <Button onClick={sign} disabled={saving} data-testid="review-sign">{saving ? "Signing..." : "Sign review"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
