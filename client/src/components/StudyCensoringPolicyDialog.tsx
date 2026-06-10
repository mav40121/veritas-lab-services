// client/src/components/StudyCensoringPolicyDialog.tsx
//
// 2026-06-09 (overnight session 8/11, Q1 Censoring Level 2):
// Per-study censoring policy selector. Director chooses how the
// stat math treats censored (<X / >Y) results.
//
// Endpoint contract:
//   POST /api/studies/:id/censoring-policy  body { policy }

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { authHeaders } from "@/lib/auth";
import { API_BASE } from "@/lib/queryClient";

type Policy = "exclude" | "substitute_lld" | "substitute_lld_half";

const OPTIONS: Array<{ value: Policy; label: string; description: string }> = [
  { value: "exclude", label: "Exclude (default)", description: "Skip censored points from stat math. Most defensible; bias and precision below the threshold are not characterized." },
  { value: "substitute_lld_half", label: "Substitute LLD/2 (Helsel)", description: "Use half the censoring threshold for the math. Common in clinical chemistry and environmental work." },
  { value: "substitute_lld", label: "Substitute LLD", description: "Use the censoring threshold itself for the math. Conservative imputation." },
];

export function StudyCensoringPolicyDialog({
  open, onOpenChange, studyId, currentPolicy, onUpdated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studyId: number;
  currentPolicy?: string | null;
  onUpdated: () => void;
}) {
  const { toast } = useToast();
  const [policy, setPolicy] = useState<Policy>("exclude");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      const c = (currentPolicy as Policy) || "exclude";
      setPolicy(["exclude", "substitute_lld", "substitute_lld_half"].includes(c) ? c : "exclude");
    }
  }, [open, currentPolicy]);

  async function save() {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/studies/${studyId}/censoring-policy`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ policy }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      toast({ title: "Censoring policy updated" });
      onUpdated();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Could not update policy", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="censoring-policy-dialog">
        <DialogHeader>
          <DialogTitle>Censoring policy</DialogTitle>
          <DialogDescription>
            How should censored results (e.g. {"<17"} for an ethanol below detection limit) be handled in the
            stat math? Default is Exclude (skip from regression / SD). Substitute options apply an imputed
            value per CLSI / Helsel guidance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer hover:bg-muted/40" data-testid={`policy-${opt.value}`}>
              <input
                type="radio"
                name="censoring-policy"
                value={opt.value}
                checked={policy === opt.value}
                onChange={() => setPolicy(opt.value)}
                className="mt-1"
              />
              <div>
                <div className="text-sm font-semibold">{opt.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
              </div>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy} data-testid="policy-save">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
