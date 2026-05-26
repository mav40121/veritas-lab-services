import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Lock, FlaskConical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ModuleHowToCard } from "@/components/ModuleHowToCard";

interface ControlLot {
  id: number;
  analyte: string;
  level: string;
  lot_number: string;
  manufacturer: string | null;
  mfr_mean: number;
  mfr_sd: number;
  mfr_sd_interval: number;
  mfr_range_low: number | null;
  mfr_range_high: number | null;
  expiration_date: string | null;
  status: string;
}

interface ViolationRow {
  id: number;
  qc_result_id: number;
  rule_code: string;
  severity: "warning" | "rejection";
  detail: string | null;
  related_result_ids: string | null;
  evaluated_at: string;
}

interface CorrectiveActionRow {
  id: number;
  qc_result_id: number;
  qc_rule_violation_id: number | null;
  action_taken: string;
  taken_by_user_id: number;
  taken_at: string;
  status: string;
  follow_up_notes: string | null;
  nce_reference: string | null;
}

interface ResultRow {
  id: number;
  control_lot_id: number;
  instrument: string | null;
  result_value: number;
  result_date: string;
  run_time: string | null;
  operator_user_id: number | null;
  comment: string | null;
  accepted_for_reporting: number;
  created_at: string;
  violations: ViolationRow[];
  corrective_actions: CorrectiveActionRow[];
}

// Submit-time response that surfaces violations + the corrective-action gate
// for the in-the-moment workflow. Mirrors the POST /api/labs/:id/qc/results
// response shape from server/routes.ts Phase 1A.
interface SubmitResponse {
  ok: boolean;
  result_id: number;
  violations: ViolationRow[];
  requires_corrective_action: boolean;
}

function severityColor(severity: string): string {
  return severity === "rejection"
    ? "bg-red-500/10 text-red-700 border-red-500/20"
    : "bg-amber-500/10 text-amber-700 border-amber-500/20";
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function VeritaQCAppPage() {
  const { user, isLoggedIn } = useAuth();
  const isReadOnly = useIsReadOnly("veritaqc");
  const activeLabId = useActiveLabId();
  const { toast } = useToast();

  // Explicit allowlist per CLAUDE.md §8 / VeritaLabAppPage canonical pattern.
  // VeritaQC is part of the VeritaAssure suite; mirror the same plan set.
  const hasPlanAccess = !!user && [
    "annual", "professional", "lab", "complete",
    "veritamap", "veritascan", "veritacomp",
    "waived", "community", "hospital", "large_hospital", "enterprise",
  ].includes(user.plan);

  const [lots, setLots] = useState<ControlLot[]>([]);
  const [loadingLots, setLoadingLots] = useState(true);
  const [selectedLotId, setSelectedLotId] = useState<number | null>(null);

  const [results, setResults] = useState<ResultRow[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);

  // Entry form state
  const [formValue, setFormValue] = useState("");
  const [formDate, setFormDate] = useState(todayIsoDate());
  const [formInstrument, setFormInstrument] = useState("");
  const [formRunTime, setFormRunTime] = useState("");
  const [formComment, setFormComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Corrective-action modal state. Driven by the requires_corrective_action
  // flag in the POST response. Modal cannot be dismissed without a CA filed.
  const [caModalOpen, setCaModalOpen] = useState(false);
  const [caForResultId, setCaForResultId] = useState<number | null>(null);
  const [caForViolation, setCaForViolation] = useState<ViolationRow | null>(null);
  const [caActionTaken, setCaActionTaken] = useState("");
  const [caExcludeFromBaseline, setCaExcludeFromBaseline] = useState(true);
  const [caFollowUp, setCaFollowUp] = useState("");
  const [caSubmitting, setCaSubmitting] = useState(false);

  async function loadLots() {
    if (!activeLabId) return;
    setLoadingLots(true);
    try {
      const res = await fetch(`${API_BASE}/api/labs/${activeLabId}/qc/lots`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setLots(data.lots || []);
        if (data.lots && data.lots.length > 0 && selectedLotId === null) {
          const firstActive = data.lots.find((l: ControlLot) => l.status === "active") || data.lots[0];
          setSelectedLotId(firstActive.id);
        }
      }
    } catch (err) {
      console.error("Failed to load lots:", err);
    } finally {
      setLoadingLots(false);
    }
  }

  async function loadResults(lotId: number) {
    if (!activeLabId) return;
    setLoadingResults(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/labs/${activeLabId}/qc/results?control_lot_id=${lotId}&limit=20`,
        { headers: authHeaders() },
      );
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch (err) {
      console.error("Failed to load results:", err);
    } finally {
      setLoadingResults(false);
    }
  }

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess && activeLabId) loadLots();
  }, [isLoggedIn, hasPlanAccess, activeLabId]);

  useEffect(() => {
    if (selectedLotId) loadResults(selectedLotId);
  }, [selectedLotId, activeLabId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeLabId || !selectedLotId) {
      toast({ title: "Pick a control lot before submitting", variant: "destructive" });
      return;
    }
    const valueNum = Number(formValue);
    if (!formValue || Number.isNaN(valueNum)) {
      toast({ title: "Result value must be a number", variant: "destructive" });
      return;
    }
    if (!formDate) {
      toast({ title: "Result date required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/labs/${activeLabId}/qc/results`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          control_lot_id: selectedLotId,
          result_value: valueNum,
          result_date: formDate,
          instrument: formInstrument || null,
          run_time: formRunTime || null,
          comment: formComment || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: err.error || "Submit failed", variant: "destructive" });
        return;
      }
      const data: SubmitResponse = await res.json();
      // Clear the form so the tech doesn't re-submit the same value
      setFormValue("");
      setFormComment("");
      // Reload the table so the new row shows up at the top
      await loadResults(selectedLotId);
      if (data.requires_corrective_action) {
        const firstRejection = data.violations.find(v => v.severity === "rejection") || null;
        setCaForResultId(data.result_id);
        setCaForViolation(firstRejection);
        setCaActionTaken("");
        setCaExcludeFromBaseline(true);
        setCaFollowUp("");
        setCaModalOpen(true);
      } else if (data.violations.length > 0) {
        toast({
          title: `Warning: ${data.violations.map(v => v.rule_code).join(", ")}`,
          description: "Logged. Review at monthly attestation.",
        });
      } else {
        toast({ title: "Result logged", description: "No Westgard rules fired." });
      }
    } catch (err: any) {
      toast({ title: err.message || "Submit failed", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCaSubmit() {
    if (!activeLabId || !caForResultId) return;
    if (!caActionTaken.trim()) {
      toast({ title: "Describe the corrective action before saving", variant: "destructive" });
      return;
    }
    setCaSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/labs/${activeLabId}/qc/corrective-actions`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          qc_result_id: caForResultId,
          qc_rule_violation_id: caForViolation?.id || null,
          action_taken: caActionTaken.trim(),
          follow_up_notes: caFollowUp || null,
          exclude_from_baseline: caExcludeFromBaseline,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: err.error || "Corrective action save failed", variant: "destructive" });
        return;
      }
      toast({ title: "Corrective action filed" });
      setCaModalOpen(false);
      setCaForResultId(null);
      setCaForViolation(null);
      if (selectedLotId) await loadResults(selectedLotId);
    } catch (err: any) {
      toast({ title: err.message || "Save failed", variant: "destructive" });
    } finally {
      setCaSubmitting(false);
    }
  }

  // ── Render gates ─────────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <Card>
          <CardContent className="py-10 text-center">
            <Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <h2 className="text-lg font-semibold mb-1">Sign in to use VeritaQC&#8482;</h2>
            <p className="text-sm text-muted-foreground mb-4">
              VeritaQC tracks daily quality-control results, evaluates Westgard rules,
              and captures corrective actions in the moment.
            </p>
            <Button asChild><Link href="/login">Sign in</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hasPlanAccess) {
    return (
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <Card>
          <CardContent className="py-10 text-center">
            <Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <h2 className="text-lg font-semibold mb-1">VeritaQC&#8482; requires a subscription</h2>
            <p className="text-sm text-muted-foreground mb-4">
              VeritaQC is part of the VeritaAssure suite. Upgrade your plan to log QC
              results, evaluate Westgard rules, and run monthly review attestations.
            </p>
            <Button asChild><Link href="/pricing">See plans</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!activeLabId) {
    return (
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">Select a lab to start logging QC.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedLot = lots.find(l => l.id === selectedLotId) || null;

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4">
      <div className="mb-6 flex items-center gap-2">
        <FlaskConical className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">VeritaQC&#8482;</h1>
        <Badge variant="outline" className="ml-2 text-xs">Phase 1 preview</Badge>
        <div className="ml-auto">
          <Button asChild variant="outline" size="sm">
            <Link href={`/labs/${activeLabId}/veritaqc-app/review`}>Daily review</Link>
          </Button>
        </div>
      </div>

      <ModuleHowToCard
        moduleKey="veritaqc"
        moduleName="VeritaQC™"
        whatItDoes="VeritaQC replaces the daily QC binder. A technologist logs a control result, the system evaluates Westgard multi-rules (1-2s, 1-3s, 2-2s, R-4s, 4-1s, plus configurable N-x bias and N-T trend) against the lab's cumulative baseline, and either accepts the run or holds it for a required corrective action. The daily review feed surfaces every result across every lot with a triage filter for results that fired a rejection but have no corrective action filed. Month end produces a one-page PDF with the Levey-Jennings chart, the violation log, the corrective actions, and the signature attestation block."
        howToUse={[
          "Add your control lots once: analyte, lot number, manufacturer mean and SD, SD interval.",
          "Each shift, log control results as you run them. The system shows you the Westgard decision in real time.",
          "When a rejection rule fires, file the required corrective action in the same screen before the run is released.",
          "At month end, open the Daily Review page for each lot, generate the monthly PDF, sign the attestation block.",
          "File the PDF in your QC binder or attach to your LIS record. Records retained per 42 CFR 493.1105.",
        ]}
      />

      {loadingLots ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading control lots...</CardContent></Card>
      ) : lots.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground mb-2">No control lots yet for this lab.</p>
            <p className="text-xs text-muted-foreground">
              Ask an admin to seed a lot (POST /api/admin/qc-seed) or contact{" "}
              <a href="mailto:info@veritaslabservices.com" className="text-primary hover:underline">
                info@veritaslabservices.com
              </a>{" "}
              to onboard. Phase 1B is tech-entry only; lot management lands in a later phase.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-base">Control lot</CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedLotId ? String(selectedLotId) : ""}
                onValueChange={(v) => setSelectedLotId(Number(v))}
              >
                <SelectTrigger><SelectValue placeholder="Pick a lot..." /></SelectTrigger>
                <SelectContent>
                  {lots.map(lot => (
                    <SelectItem key={lot.id} value={String(lot.id)}>
                      {lot.analyte} &middot; Lot {lot.lot_number} ({lot.level})
                      {lot.status !== "active" ? ` [${lot.status}]` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedLot && (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted-foreground">
                  <div><span className="font-medium text-foreground">Mfr mean:</span> {selectedLot.mfr_mean}</div>
                  <div><span className="font-medium text-foreground">Mfr SD:</span> {selectedLot.mfr_sd}</div>
                  <div><span className="font-medium text-foreground">SD interval:</span> &plusmn;{selectedLot.mfr_sd_interval}</div>
                  <div>
                    <span className="font-medium text-foreground">Exp:</span>{" "}
                    {selectedLot.expiration_date || "n/a"}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-base">Log a QC result</CardTitle>
            </CardHeader>
            <CardContent>
              {isReadOnly && (
                <p className="mb-3 text-xs text-amber-700 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5">
                  Read-only access on this lab. Submit is disabled until the
                  subscription is renewed.
                </p>
              )}
              <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="qc-value">Result value <span className="text-red-600">*</span></Label>
                  <Input
                    id="qc-value"
                    type="number"
                    step="any"
                    value={formValue}
                    onChange={(e) => setFormValue(e.target.value)}
                    placeholder="e.g. 102.3"
                    required
                    disabled={isReadOnly}
                  />
                </div>
                <div>
                  <Label htmlFor="qc-date">Result date <span className="text-red-600">*</span></Label>
                  <Input
                    id="qc-date"
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    required
                    disabled={isReadOnly}
                  />
                </div>
                <div>
                  <Label htmlFor="qc-instrument">Instrument</Label>
                  <Input
                    id="qc-instrument"
                    value={formInstrument}
                    onChange={(e) => setFormInstrument(e.target.value)}
                    placeholder="e.g. Atellica IM 1300"
                    disabled={isReadOnly}
                  />
                </div>
                <div>
                  <Label htmlFor="qc-runtime">Run time</Label>
                  <Input
                    id="qc-runtime"
                    type="time"
                    value={formRunTime}
                    onChange={(e) => setFormRunTime(e.target.value)}
                    disabled={isReadOnly}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="qc-comment">Comment</Label>
                  <Textarea
                    id="qc-comment"
                    value={formComment}
                    onChange={(e) => setFormComment(e.target.value)}
                    placeholder="Optional context (reagent lot, calibrator lot, troubleshooting note)"
                    rows={2}
                    disabled={isReadOnly}
                  />
                </div>
                <div className="sm:col-span-2 flex justify-end">
                  <Button type="submit" disabled={submitting || isReadOnly}>
                    {submitting ? "Submitting..." : "Submit result"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent results (last 20)</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingResults ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : results.length === 0 ? (
                <p className="text-sm text-muted-foreground">No results logged for this lot yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground border-b">
                      <tr>
                        <th className="py-2 pr-2">Date</th>
                        <th className="py-2 pr-2">Value</th>
                        <th className="py-2 pr-2">Instrument</th>
                        <th className="py-2 pr-2">Rules fired</th>
                        <th className="py-2 pr-2">CA filed</th>
                        <th className="py-2 pr-2">Accepted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map(r => (
                        <tr key={r.id} className="border-b last:border-b-0">
                          <td className="py-2 pr-2">{r.result_date}</td>
                          <td className="py-2 pr-2 font-mono">{r.result_value}</td>
                          <td className="py-2 pr-2 text-muted-foreground">{r.instrument || "-"}</td>
                          <td className="py-2 pr-2">
                            {r.violations.length === 0 ? (
                              <span className="text-xs text-muted-foreground">none</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {r.violations.map(v => (
                                  <Badge key={v.id} variant="outline" className={severityColor(v.severity)}>
                                    {v.rule_code}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-xs text-muted-foreground">
                            {r.corrective_actions.length > 0
                              ? `${r.corrective_actions.length} action${r.corrective_actions.length === 1 ? "" : "s"}`
                              : "-"}
                          </td>
                          <td className="py-2 pr-2">
                            {r.accepted_for_reporting === 1 ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="accepted" />
                            ) : (
                              <span className="text-xs text-amber-700">excluded</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={caModalOpen} onOpenChange={(open) => { if (!open && caForResultId) return; setCaModalOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Corrective action required
            </DialogTitle>
            <DialogDescription>
              A Westgard rejection rule fired on this result. Document the action you
              took before this dialog can close.
            </DialogDescription>
          </DialogHeader>
          {caForViolation && (
            <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3 text-sm">
              <div className="font-semibold text-red-700">{caForViolation.rule_code}</div>
              <div className="text-xs text-red-700/80 mt-0.5">{caForViolation.detail}</div>
            </div>
          )}
          <div className="space-y-3">
            <div>
              <Label htmlFor="ca-action">What did you do? <span className="text-red-600">*</span></Label>
              <Textarea
                id="ca-action"
                value={caActionTaken}
                onChange={(e) => setCaActionTaken(e.target.value)}
                placeholder="e.g. Repeated control; same result. Recalibrated and reran; in range. Reagent OK, no maintenance change."
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="ca-followup">Follow-up notes</Label>
              <Textarea
                id="ca-followup"
                value={caFollowUp}
                onChange={(e) => setCaFollowUp(e.target.value)}
                placeholder="Optional: outcome of the action, who reviewed, NCE filed elsewhere"
                rows={2}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={caExcludeFromBaseline}
                onChange={(e) => setCaExcludeFromBaseline(e.target.checked)}
                className="mt-1"
              />
              <span>
                Exclude this run from the QC baseline (recommended when the cause
                was instrument or reagent, not the lot itself; keeps future Westgard
                evaluations clean).
              </span>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={handleCaSubmit} disabled={caSubmitting || !caActionTaken.trim()}>
              {caSubmitting ? "Saving..." : "File corrective action"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
