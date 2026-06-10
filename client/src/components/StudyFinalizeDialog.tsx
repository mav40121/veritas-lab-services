// client/src/components/StudyFinalizeDialog.tsx
//
// 2026-06-09 (overnight session 5/11): Sign + Lock dialog for
// VeritaCheck studies. Mirrors the analyte sign dialog from
// VerificationAnalytesPanel. Locks lifecycle_state='draft' studies
// into lifecycle_state='finalized' after capturing a signature.
//
// Endpoint contract:
//   POST /api/studies/:id/finalize  body { signature }

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { authHeaders } from "@/lib/auth";
import { API_BASE } from "@/lib/queryClient";

export function StudyFinalizeDialog({
  open, onOpenChange, studyId, onFinalized,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studyId: number;
  onFinalized: () => void;
}) {
  const { toast } = useToast();
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setSignature(""); }, [open]);

  async function doFinalize() {
    if (!signature.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/studies/${studyId}/finalize`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ signature: signature.trim() }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      toast({
        title: "Study finalized and locked",
        description: "The study is now locked from direct edits. To change anything, use Amend.",
      });
      onFinalized();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Could not finalize", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="study-finalize-dialog">
        <DialogHeader>
          <DialogTitle>Sign and lock study</DialogTitle>
          <DialogDescription>
            Signing finalizes this study and locks it from direct edits. To change anything after
            finalize (e.g. exclude a newly identified outlier), use Amend to create a linked draft.
            The original stays in the audit trail and shows the signature.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="study-sig" className="text-xs">Signature (initials or full name)</Label>
          <Input
            id="study-sig"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="e.g. MV or Michael Veri"
            data-testid="study-sign-input"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={doFinalize} disabled={busy || !signature.trim()} data-testid="study-sign-confirm">
            Sign and lock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
