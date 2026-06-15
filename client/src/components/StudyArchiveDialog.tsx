// client/src/components/StudyArchiveDialog.tsx
//
// 2026-06-15 (VeritaCheck Sign-Off / Amendment / Archive, Phase 1 PR 3):
// Archive / Restore dialog for VeritaCheck studies. Archiving hides a study
// from the active dashboard while keeping it in the audit trail; a reason is
// required. Restore returns it to the active dashboard. Superseded originals
// are auto-archived when their amendment is signed off; this dialog is the
// manual path for any study the director wants off the active list.
//
// Endpoint contract:
//   POST /api/studies/:id/archive    body { reason }   (reason required)
//   POST /api/studies/:id/unarchive  body {}
//
// Mirrors StudyFinalizeDialog's fetch + toast idiom exactly.

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { authHeaders } from "@/lib/auth";
import { API_BASE } from "@/lib/queryClient";

export function StudyArchiveDialog({
  open, onOpenChange, studyId, mode, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studyId: number;
  mode: "archive" | "unarchive";
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setReason(""); }, [open]);

  async function submit() {
    if (mode === "archive" && !reason.trim()) return;
    setBusy(true);
    try {
      const path = mode === "archive" ? "archive" : "unarchive";
      const r = await fetch(`${API_BASE}/api/studies/${studyId}/${path}`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: mode === "archive" ? JSON.stringify({ reason: reason.trim() }) : "{}",
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      toast({
        title: mode === "archive" ? "Study archived" : "Study restored",
        description: mode === "archive"
          ? "The study is hidden from the active dashboard. It stays in the audit trail and can be restored anytime."
          : "The study is back on the active dashboard.",
      });
      onDone();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: mode === "archive" ? "Could not archive" : "Could not restore",
        description: e.message,
        variant: "destructive",
      });
    } finally { setBusy(false); }
  }

  if (mode === "unarchive") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md" data-testid="study-unarchive-dialog">
          <DialogHeader>
            <DialogTitle>Restore study from archive</DialogTitle>
            <DialogDescription>
              This returns the study to the active dashboard. If it was superseded by an
              amendment, restoring it puts both the original and the amendment back on the
              active list. Use this only if the study was archived in error.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={busy} data-testid="study-unarchive-confirm">
              Restore from archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="study-archive-dialog">
        <DialogHeader>
          <DialogTitle>Archive study</DialogTitle>
          <DialogDescription>
            Archiving removes this study from the active dashboard. It is not deleted: it
            stays in the audit trail with the reason below and can be restored anytime.
            Record why you are archiving it (for example: superseded, entered in error,
            duplicate, study repeated).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="archive-reason" className="text-xs">Reason for archiving (required)</Label>
          <Textarea
            id="archive-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Superseded by repeat study after reagent lot change"
            rows={3}
            data-testid="study-archive-reason"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !reason.trim()} data-testid="study-archive-confirm">
            Archive study
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
