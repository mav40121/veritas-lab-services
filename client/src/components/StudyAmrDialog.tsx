// client/src/components/StudyAmrDialog.tsx
//
// 2026-06-09 (Michael L feedback). Set / clear the optional claimed AMR
// (Analytical Measurement Range) on a VeritaCheck study. The
// VeritaCheck PDF renders an "AMR Coverage Analysis" block when both
// low and high are set, showing how close the tested data points get
// to each AMR edge.
//
// Endpoint contract:
//   POST /api/studies/:id/amr  body { amr_low, amr_high, amr_units }
//
// Gated server-side on lifecycle_state !== 'finalized'. The dialog
// optimistically shows the locked state too.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export interface StudyForAmr {
  id: number;
  testName: string;
  studyType: string;
  lifecycle_state?: string;
  amrLow?: number | null;
  amrHigh?: number | null;
  amrUnits?: string | null;
  resultUnits?: string | null;
}

export function StudyAmrDialog({
  open, onOpenChange, study, onUpdated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  study: StudyForAmr;
  onUpdated: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [low, setLow] = useState<string>("");
  const [high, setHigh] = useState<string>("");
  const [units, setUnits] = useState<string>("");

  useEffect(() => {
    if (open) {
      setLow(study.amrLow != null ? String(study.amrLow) : "");
      setHigh(study.amrHigh != null ? String(study.amrHigh) : "");
      setUnits(study.amrUnits || study.resultUnits || "");
    }
  }, [open, study.amrLow, study.amrHigh, study.amrUnits, study.resultUnits]);

  const isLocked = study.lifecycle_state === "finalized";

  async function save(mode: "save" | "clear") {
    setBusy(true);
    try {
      const body = mode === "clear"
        ? { amr_low: null, amr_high: null, amr_units: null }
        : { amr_low: low === "" ? null : Number(low), amr_high: high === "" ? null : Number(high), amr_units: units.trim() || null };
      if (mode === "save") {
        if (body.amr_low === null && body.amr_high === null) {
          toast({ title: "Enter at least one value", description: "Provide both AMR low and high, or use Clear AMR.", variant: "destructive" });
          setBusy(false); return;
        }
        if (body.amr_low === null || body.amr_high === null) {
          toast({ title: "Both ends required", description: "Enter both AMR low AND high, or use Clear AMR.", variant: "destructive" });
          setBusy(false); return;
        }
        if (!Number.isFinite(body.amr_low) || !Number.isFinite(body.amr_high)) {
          toast({ title: "Numbers only", description: "AMR low and high must be numeric.", variant: "destructive" });
          setBusy(false); return;
        }
        if (body.amr_high <= body.amr_low) {
          toast({ title: "High must exceed low", description: "AMR high must be greater than AMR low.", variant: "destructive" });
          setBusy(false); return;
        }
      }
      const r = await fetch(`${API_BASE}/api/studies/${study.id}/amr`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${r.status}`);
      }
      toast({
        title: mode === "clear" ? "AMR cleared" : "AMR saved",
        description: mode === "clear"
          ? "Coverage analysis turned off."
          : `Coverage analysis active for ${body.amr_low} to ${body.amr_high}${units.trim() ? " " + units.trim() : ""}.`,
      });
      onUpdated();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="amr-dialog">
        <DialogHeader>
          <DialogTitle>Set Analytical Measurement Range (AMR)</DialogTitle>
          <DialogDescription>
            Optional. When set, the VeritaCheck PDF includes an AMR Coverage Analysis block showing
            how close the lowest and highest tested points come to each AMR edge. Leave blank to
            turn the analysis off.
          </DialogDescription>
        </DialogHeader>

        {isLocked && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200" data-testid="amr-locked">
            This study is finalized and locked. To change the AMR, use the amendment workflow.
          </div>
        )}

        <div className="space-y-3 mt-2">
          <div>
            <Label htmlFor="amr-low" className="text-xs">AMR low</Label>
            <Input
              id="amr-low"
              type="number"
              step="any"
              value={low}
              onChange={(e) => setLow(e.target.value)}
              disabled={isLocked}
              data-testid="amr-low-input"
            />
          </div>
          <div>
            <Label htmlFor="amr-high" className="text-xs">AMR high</Label>
            <Input
              id="amr-high"
              type="number"
              step="any"
              value={high}
              onChange={(e) => setHigh(e.target.value)}
              disabled={isLocked}
              data-testid="amr-high-input"
            />
          </div>
          <div>
            <Label htmlFor="amr-units" className="text-xs">Units (optional)</Label>
            <Input
              id="amr-units"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              placeholder={study.resultUnits || "e.g. mg/dL"}
              disabled={isLocked}
              data-testid="amr-units-input"
            />
          </div>
          <div className="text-xs text-muted-foreground border-t border-border pt-2">
            Verdict thresholds (per CLSI EP06 commentary): &ge;95% each end = fully exercised;
            90&ndash;94% = near-edge; &lt;90% = under-tested. Director or designee remains the source
            of truth for any AMR claim.
          </div>
        </div>

        <div className="flex justify-between items-center pt-3 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            disabled={isLocked || busy || (study.amrLow == null && study.amrHigh == null)}
            onClick={() => save("clear")}
            data-testid="amr-clear-button"
          >
            Clear AMR
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={isLocked || busy}
              onClick={() => save("save")}
              data-testid="amr-save-button"
            >
              Save AMR
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
