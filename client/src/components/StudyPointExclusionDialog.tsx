// client/src/components/StudyPointExclusionDialog.tsx
//
// 2026-06-09 (Michael L feedback). Per-point exclusion dialog for
// VeritaCheck studies. Opens from the StudyResultsPage when the
// director wants to mark a data point as excluded (transcription
// error, specimen issue, known interference) without redoing the
// whole study.
//
// Excluded points stay in the data array; they're hidden from the
// regression but visible in the dialog with strikethrough + reason.
//
// 2026-06-15 (Phase 2): excluding a point now recomputes and persists the
// verdict in place. If an exclusion flips the verdict FAIL -> PASS the server
// returns 422 { requiresVerdictJustification }, and the director must record a
// justification (the pre-exclusion FAIL is retained in the audit trail).
//
// Endpoint contract:
//   POST /api/studies/:id/points/:idx/exclude  body { reason, justification? }
//   POST /api/studies/:id/points/:idx/include
//
// Gated server-side on lifecycle_state !== 'finalized'.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { authHeaders } from "@/lib/auth";
import { API_BASE } from "@/lib/queryClient";

export interface StudyPoint {
  expectedValue?: number | null;
  instrumentValues?: Record<string, number | null>;
  value?: number | null; // legacy precision shape
  excluded?: boolean;
  exclusion_reason?: string | null;
}

export interface StudyForExclusion {
  id: number;
  testName: string;
  studyType: string;
  lifecycle_state?: string;
  dataPoints: StudyPoint[];
  instruments?: string[];
}

export function StudyPointExclusionDialog({
  open, onOpenChange, study, onUpdated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  study: StudyForExclusion;
  onUpdated: () => void;
}) {
  const { toast } = useToast();
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [reasonOpenIndex, setReasonOpenIndex] = useState<number | null>(null);
  const [reasonText, setReasonText] = useState<string>("");
  // Phase 2: the FAIL -> PASS verdict-justification step. When the server
  // refuses an exclusion that would flip the verdict, we capture the per-point
  // reason and prompt for a director-level justification, then re-submit both.
  const [verdictJustifyIndex, setVerdictJustifyIndex] = useState<number | null>(null);
  const [verdictJustifyText, setVerdictJustifyText] = useState<string>("");
  const [pendingReason, setPendingReason] = useState<string>("");

  // Reset on open/close.
  useEffect(() => {
    if (!open) {
      setBusyIndex(null);
      setReasonOpenIndex(null);
      setReasonText("");
      setVerdictJustifyIndex(null);
      setVerdictJustifyText("");
      setPendingReason("");
    }
  }, [open]);

  const isLocked = study.lifecycle_state === "finalized";
  const comparisonName = (study.instruments && study.instruments[1]) || (study.instruments && study.instruments[0]) || "";

  async function postPointAction(idx: number, action: "exclude" | "include", reason?: string, justification?: string) {
    setBusyIndex(idx);
    try {
      const r = await fetch(`${API_BASE}/api/studies/${study.id}/points/${idx}/${action}`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: action === "exclude" ? JSON.stringify({ reason, justification }) : "{}",
      });
      // 422 = the exclusion flips the verdict FAIL -> PASS and needs a
      // director-level justification. Open that step rather than erroring.
      if (r.status === 422) {
        const body = await r.json().catch(() => ({}));
        if (body?.requiresVerdictJustification) {
          setPendingReason(reason || "");
          setReasonOpenIndex(null);
          setVerdictJustifyIndex(idx);
          setVerdictJustifyText("");
          return;
        }
        throw new Error(body?.error || `HTTP 422`);
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      toast({
        title: action === "exclude" ? "Point excluded" : "Point restored",
        description: action === "exclude"
          ? (justification
              ? `Verdict updated to PASS; the original FAIL and your justification are retained in the audit trail.`
              : `The study verdict was recomputed without point ${idx + 1}.`)
          : `Point ${idx + 1} is back in the study; the verdict was recomputed.`,
      });
      onUpdated();
      setReasonOpenIndex(null);
      setReasonText("");
      setVerdictJustifyIndex(null);
      setVerdictJustifyText("");
      setPendingReason("");
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setBusyIndex(null);
    }
  }

  function startExclude(idx: number) {
    setReasonOpenIndex(idx);
    setReasonText("");
  }

  function fmtNum(v: number | null | undefined, digits = 3) {
    if (v == null || !Number.isFinite(v)) return "-";
    return Number(v).toFixed(digits);
  }

  const isMethodComp = study.studyType === "method_comparison" || study.studyType === "correlation";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="point-exclusion-dialog">
        <DialogHeader>
          <DialogTitle>Manage data points</DialogTitle>
          <DialogDescription>
            Exclude a point from the study (e.g. transcription error, specimen issue, known interference).
            Excluded points stay on the record with the reason you provide and the study verdict is recomputed;
            the surveyor sees the full audit trail. The lab director or designee remains the source of truth for any exclusion.
          </DialogDescription>
        </DialogHeader>

        {isLocked && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200" data-testid="point-exclusion-locked">
            This study is signed off and locked. To change an exclusion, use the amendment workflow.
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left p-2 font-semibold">#</th>
                {isMethodComp && <th className="text-right p-2 font-semibold">Expected</th>}
                <th className="text-right p-2 font-semibold">{isMethodComp ? "Measured" : "Value"}</th>
                <th className="text-left p-2 font-semibold">Status / Reason</th>
                <th className="text-right p-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {study.dataPoints.map((p, idx) => {
                const excluded = p.excluded === true;
                const measured = isMethodComp
                  ? p.instrumentValues?.[comparisonName] ?? null
                  : (p.value ?? null);
                const rowClass = excluded
                  ? "border-b border-border opacity-50 line-through"
                  : "border-b border-border";
                return (
                  <tr key={idx} className={rowClass} data-testid={`exclusion-row-${idx}`}>
                    <td className="p-2 font-mono text-muted-foreground">{idx + 1}</td>
                    {isMethodComp && (
                      <td className="p-2 text-right font-mono">{fmtNum(p.expectedValue ?? null)}</td>
                    )}
                    <td className="p-2 text-right font-mono">{fmtNum(measured)}</td>
                    <td className="p-2 text-xs">
                      {excluded
                        ? <span className="text-amber-700 dark:text-amber-300 not-italic">Excluded: {p.exclusion_reason || "no reason recorded"}</span>
                        : <span className="text-muted-foreground">In study</span>}
                    </td>
                    <td className="p-2 text-right">
                      {!isLocked && (
                        excluded ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyIndex === idx}
                            onClick={() => postPointAction(idx, "include")}
                            data-testid={`exclusion-include-${idx}`}
                          >
                            Restore
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyIndex === idx}
                            onClick={() => startExclude(idx)}
                            data-testid={`exclusion-exclude-${idx}`}
                          >
                            Exclude
                          </Button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
              {study.dataPoints.length === 0 && (
                <tr><td colSpan={isMethodComp ? 5 : 4} className="p-4 text-center text-sm text-muted-foreground">No data points on this study.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {reasonOpenIndex !== null && verdictJustifyIndex === null && (
          <div className="border border-border rounded-md p-3 bg-card mt-3" data-testid="exclusion-reason-form">
            <Label htmlFor="exclusion-reason" className="text-xs">
              Reason for excluding point {reasonOpenIndex + 1}
            </Label>
            <Input
              id="exclusion-reason"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="e.g. transcription error, specimen issue, known interference"
              className="mt-1"
              data-testid="exclusion-reason-input"
            />
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="ghost" size="sm" onClick={() => { setReasonOpenIndex(null); setReasonText(""); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!reasonText.trim() || busyIndex === reasonOpenIndex}
                onClick={() => postPointAction(reasonOpenIndex, "exclude", reasonText.trim())}
                data-testid="exclusion-reason-submit"
              >
                Exclude point
              </Button>
            </div>
          </div>
        )}

        {verdictJustifyIndex !== null && (
          <div className="border border-amber-400 rounded-md p-3 bg-amber-50 dark:bg-amber-950/20 mt-3" data-testid="verdict-justify-form">
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-1">
              This exclusion changes the verdict from FAIL to PASS
            </div>
            <p className="text-xs text-amber-900 dark:text-amber-200 mb-2">
              Record why point {verdictJustifyIndex + 1} is excluded from the determination. The laboratory director or
              designee owns this decision. The original FAIL and this justification are retained in the audit trail.
            </p>
            <Label htmlFor="verdict-justify" className="text-xs">Verdict change justification (required)</Label>
            <Textarea
              id="verdict-justify"
              value={verdictJustifyText}
              onChange={(e) => setVerdictJustifyText(e.target.value)}
              placeholder="e.g. Point is a confirmed clotted-specimen outlier; repeat within criteria. Director-approved exclusion."
              rows={3}
              className="mt-1"
              data-testid="verdict-justify-input"
            />
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="ghost" size="sm" onClick={() => { setVerdictJustifyIndex(null); setVerdictJustifyText(""); setPendingReason(""); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!verdictJustifyText.trim() || busyIndex === verdictJustifyIndex}
                onClick={() => postPointAction(verdictJustifyIndex, "exclude", pendingReason, verdictJustifyText.trim())}
                data-testid="verdict-justify-submit"
              >
                Exclude and record FAIL to PASS justification
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
