// client/src/components/EffectivenessPanel.tsx
//
// Effectiveness monitoring on a VeritaResponse finding. Wave C3 (2026-06-12) gave every plan of correction 30/60/90-day
// checkpoints anchored on its completion date, shown on the VeritaTrack worklist until recorded; "not effective"
// reopens a closed finding. Measured monitoring (Lifepoint ask, Michael 2026-11-19; shared/effectivenessMeasure.ts):
// the lab says what it audits, its target rate and its sample, and picks a schedule; each checkpoint records how many
// were audited and how many were compliant, and with a target set the server decides effective or not from those
// counts. Without a target it works as before (Effective / Not effective, counts optional).

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DEFAULT_SCHEDULE_KEY, MONITORING_SCHEDULES, complianceRate, measuredStatus, monitoringSummary, parseCounts,
} from "@shared/effectivenessMeasure";

interface EffCheck {
  id: number;
  interval_days: number;
  due_date: string;
  status: "pending" | "effective" | "not_effective";
  outcome_note: string | null;
  verified_at: string | null;
  verified_by: string | null;
  audited_count: number | null;
  compliant_count: number | null;
}

interface Props {
  activeLabId: number;
  finding: any;
  canEdit: boolean;
  onFindingChange: () => void;
}

const numOrBlank = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function EffectivenessPanel({ activeLabId, finding, canEdit, onFindingChange }: Props) {
  const { toast } = useToast();
  const findingId = finding.id;
  const completionDate: string | null = finding.completion_date || null;
  const target: number | null = finding.monitor_target_pct ? Number(finding.monitor_target_pct) : null;
  const [checks, setChecks] = useState<EffCheck[] | null>(null);
  const [checksError, setChecksError] = useState(false);
  const [busy, setBusy] = useState(false);
  // The plan form (start and Edit plan share it).
  const [measure, setMeasure] = useState<string>(finding.monitor_measure || "");
  const [targetText, setTargetText] = useState<string>(numOrBlank(finding.monitor_target_pct));
  const [sampleText, setSampleText] = useState<string>(numOrBlank(finding.monitor_sample));
  const [schedule, setSchedule] = useState<string>(DEFAULT_SCHEDULE_KEY);
  const [editingPlan, setEditingPlan] = useState(false);
  // Recording one checkpoint.
  const [recordTarget, setRecordTarget] = useState<{ check: EffCheck; status: "effective" | "not_effective" | null } | null>(null);
  const [auditedText, setAuditedText] = useState("");
  const [compliantText, setCompliantText] = useState("");
  const [noteText, setNoteText] = useState("");
  const base = `${API_BASE}/api/labs/${activeLabId}/findings/${findingId}`;

  useEffect(() => {
    setMeasure(finding.monitor_measure || "");
    setTargetText(numOrBlank(finding.monitor_target_pct));
    setSampleText(numOrBlank(finding.monitor_sample));
  }, [finding.monitor_measure, finding.monitor_target_pct, finding.monitor_sample]);

  const load = async () => {
    try {
      const r = await fetch(`${base}/effectiveness-checks`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`load ${r.status}`);
      setChecks(await r.json());
      setChecksError(false);
    } catch {
      setChecksError(true); // a failed load must not read as "no checkpoints yet"
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [findingId, activeLabId]);

  const planBody = () => ({ measure, target_pct: targetText.trim() === "" ? null : Number(targetText), sample: sampleText.trim() === "" ? null : Number(sampleText) });
  const call = async (method: string, path: string, body: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, data: await r.json().catch(() => ({})) as any };
  };

  const start = async () => {
    setBusy(true);
    try {
      const { ok, data } = await call("POST", "/effectiveness-checks/generate", { schedule, ...planBody() });
      if (ok) { setChecks(data.checks || []); setChecksError(false); onFindingChange(); }
      else toast({ variant: "destructive", title: "Could not start monitoring", description: data.error || "Please try again." });
    } finally { setBusy(false); }
  };

  const savePlan = async () => {
    setBusy(true);
    try {
      const { ok, data } = await call("PUT", "/effectiveness-plan", planBody());
      if (ok) { setEditingPlan(false); onFindingChange(); }
      else toast({ variant: "destructive", title: "Could not save the plan", description: data.error || "Please try again." });
    } finally { setBusy(false); }
  };

  const openRecord = (check: EffCheck, status: "effective" | "not_effective" | null) => {
    setAuditedText(""); setCompliantText(""); setNoteText("");
    setRecordTarget({ check, status });
  };

  // What the counts typed so far would record (null until they are valid).
  const counted = parseCounts(auditedText, compliantText);
  const countsGiven = auditedText.trim() !== "" || compliantText.trim() !== "";
  const outcome: "effective" | "not_effective" | null = target && counted.ok
    ? measuredStatus(counted.audited, counted.compliant, target)
    : recordTarget?.status ?? null;

  const submitRecord = async () => {
    if (!recordTarget || !outcome) return;
    if (countsGiven && !counted.ok) return;
    setBusy(true);
    try {
      const body: any = { status: outcome, outcome_note: noteText.trim() || null };
      if (counted.ok) { body.audited_count = counted.audited; body.compliant_count = counted.compliant; }
      const { ok, data } = await call("PUT", `/effectiveness-checks/${recordTarget.check.id}`, body);
      if (ok) {
        setRecordTarget(null);
        await load();
        if (data.reopened) onFindingChange();
      } else {
        toast({ variant: "destructive", title: "Could not record checkpoint", description: data.error || "Please try again." });
      }
    } catch {
      toast({ variant: "destructive", title: "Could not record checkpoint", description: "Check your connection and try again." });
    } finally { setBusy(false); }
  };

  const hasChecks = !!checks && checks.length > 0;
  const summary = hasChecks ? monitoringSummary(checks!, target) : "";
  const planFields = (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_7rem_7rem] gap-3" data-testid="eff-plan-fields">
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="eff-measure">What is audited</Label>
        <Input id="eff-measure" data-testid="eff-measure" value={measure} onChange={(e) => setMeasure(e.target.value)} className="h-9 text-sm"
          placeholder="For example: temperature logs with every reading recorded" disabled={!canEdit} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="eff-target">Target (%)</Label>
        <Input id="eff-target" data-testid="eff-target" inputMode="numeric" value={targetText} onChange={(e) => setTargetText(e.target.value)} className="h-9 text-sm" placeholder="e.g. 90" disabled={!canEdit} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="eff-sample">Sample per check</Label>
        <Input id="eff-sample" data-testid="eff-sample" inputMode="numeric" value={sampleText} onChange={(e) => setSampleText(e.target.value)} className="h-9 text-sm" placeholder="optional" disabled={!canEdit} />
      </div>
    </div>
  );

  return (
    <Card data-testid="eff-panel">
      <CardHeader className="py-3 px-4 border-b">
        <CardTitle className="text-base font-semibold">Effectiveness monitoring</CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          A plan of correction is not finished when it is signed. The lab checks that the corrective action held. Checkpoints are anchored on the completion date and appear on the VeritaTrack worklist until recorded. With a target set, each checkpoint's audited and compliant counts decide whether it met the target; a checkpoint below it reopens the finding. The measure and the target are the laboratory's choice.
        </p>
        {checksError && !hasChecks ? (
          <div className="flex items-center gap-3 text-sm">
            <AlertTriangle size={16} className="text-destructive shrink-0" />
            <span className="text-muted-foreground">Couldn't load the checkpoints.</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={load}>Retry</Button>
          </div>
        ) : !hasChecks ? (
          <div className="space-y-3">
            {planFields}
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Schedule</Label>
                <Select value={schedule} onValueChange={setSchedule} disabled={!canEdit}>
                  <SelectTrigger className="h-9 text-sm w-56" data-testid="eff-schedule"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONITORING_SCHEDULES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" className="h-9" data-testid="eff-start" onClick={start} disabled={busy || !canEdit || !completionDate}>
                Start monitoring
              </Button>
              {!completionDate && <span className="text-xs text-amber-700 dark:text-amber-400">Set a completion date above first.</span>}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-muted/50 p-2.5 text-sm" data-testid="eff-plan-summary">
              <div className="space-y-0.5">
                <div><span className="text-muted-foreground">Audits:</span> {finding.monitor_measure || <span className="text-muted-foreground">not set</span>}</div>
                <div>
                  <span className="text-muted-foreground">Target:</span> {target ? `${target}%` : <span className="text-muted-foreground">not set (each checkpoint is marked by hand)</span>}
                  {finding.monitor_sample ? <><span className="text-muted-foreground"> · Sample:</span> {finding.monitor_sample} per check</> : null}
                </div>
              </div>
              {canEdit && <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="eff-edit-plan" onClick={() => setEditingPlan(true)}>Edit plan</Button>}
            </div>
            {summary && <div className="text-sm font-medium" data-testid="eff-summary">{summary}</div>}
            {checks!.map((c) => {
              const overdue = c.status === "pending" && new Date(c.due_date) < new Date();
              const measured = c.audited_count != null && c.compliant_count != null;
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-md border p-2.5 text-sm" data-testid="eff-check">
                  <span className="font-medium w-16 shrink-0">{c.interval_days}-day</span>
                  <span className={`text-xs ${overdue ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"} w-28 shrink-0`}>Due {c.due_date}</span>
                  <div className="flex-1 min-w-[12rem]">
                    {c.status === "pending" ? (
                      <span className={`text-xs ${overdue ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{overdue ? "Overdue" : "Pending"}</span>
                    ) : (
                      <span className={`text-xs font-medium ${c.status === "effective" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`} data-testid="eff-check-result">
                        {measured ? `${c.compliant_count} of ${c.audited_count} compliant (${complianceRate(c.audited_count!, c.compliant_count!)}%). ` : ""}
                        {c.status === "effective" ? (measured && target ? "Met the target" : "Verified effective") : (measured && target ? "Below the target (finding reopened)" : "Not effective (finding reopened)")}
                        {c.verified_by ? ` by ${c.verified_by}` : ""}
                        {c.outcome_note ? `: ${c.outcome_note}` : ""}
                      </span>
                    )}
                  </div>
                  {c.status === "pending" && canEdit && (
                    target ? (
                      <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" data-testid={`eff-record-${c.interval_days}`} disabled={busy} onClick={() => openRecord(c, null)}>Record result</Button>
                    ) : (
                      <div className="flex gap-1 shrink-0">
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => openRecord(c, "effective")}>Effective</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-red-700 dark:text-red-400" disabled={busy} onClick={() => openRecord(c, "not_effective")}>Not effective</Button>
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}

        <Dialog open={editingPlan} onOpenChange={(o) => { if (!o) setEditingPlan(false); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Monitoring plan</DialogTitle></DialogHeader>
            {planFields}
            <p className="text-xs text-muted-foreground">Checkpoints already recorded keep the result they were given.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingPlan(false)} disabled={busy}>Cancel</Button>
              <Button onClick={savePlan} disabled={busy} data-testid="eff-save-plan">{busy ? "Saving..." : "Save plan"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!recordTarget} onOpenChange={(o) => { if (!o) setRecordTarget(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {target ? `Record the ${recordTarget?.check.interval_days}-day check`
                  : recordTarget?.status === "effective" ? `Verify effective at ${recordTarget?.check.interval_days} days`
                  : `Record recurrence at ${recordTarget?.check.interval_days} days`}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {finding.monitor_measure && <div className="text-xs text-muted-foreground">Audits: {finding.monitor_measure}</div>}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="eff-audited">Audited{target ? "" : " (optional)"}</Label>
                  <Input id="eff-audited" data-testid="eff-audited" inputMode="numeric" value={auditedText} onChange={(e) => setAuditedText(e.target.value)} className="h-9 text-sm"
                    placeholder={finding.monitor_sample ? String(finding.monitor_sample) : ""} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="eff-compliant">Compliant{target ? "" : " (optional)"}</Label>
                  <Input id="eff-compliant" data-testid="eff-compliant" inputMode="numeric" value={compliantText} onChange={(e) => setCompliantText(e.target.value)} className="h-9 text-sm" />
                </div>
              </div>
              <div className="text-sm" data-testid="eff-outcome">
                {countsGiven && !counted.ok ? (
                  <span className="text-amber-700 dark:text-amber-400">{counted.error}</span>
                ) : counted.ok ? (
                  <span>
                    {complianceRate(counted.audited, counted.compliant)}% compliant.{" "}
                    {target ? (
                      outcome === "effective"
                        ? <span className="font-medium text-emerald-700 dark:text-emerald-400">Meets the {target}% target.</span>
                        : <span className="font-medium text-red-700 dark:text-red-400">Below the {target}% target. Recording it reopens a closed finding.</span>
                    ) : null}
                  </span>
                ) : target ? (
                  <span className="text-muted-foreground">Enter how many were audited and how many were compliant.</span>
                ) : null}
              </div>
              <div className="space-y-1">
                <Label htmlFor="eff-note" className="text-xs">
                  {outcome === "not_effective" ? "What recurred?" : "What evidence shows the corrective action held?"}
                </Label>
                <Textarea id="eff-note" data-testid="eff-note" value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3}
                  placeholder="Optional but recommended for the surveyor-facing record. No patient names or record numbers." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRecordTarget(null)} disabled={busy}>Cancel</Button>
              <Button
                data-testid="eff-submit"
                onClick={submitRecord}
                disabled={busy || !outcome || (countsGiven && !counted.ok)}
                className={outcome === "not_effective" ? "bg-red-600 hover:bg-red-700 text-white" : ""}
              >
                {busy ? "Saving..." : outcome === "not_effective" ? "Record as not effective" : "Record"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
