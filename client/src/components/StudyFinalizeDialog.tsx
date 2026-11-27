// client/src/components/StudyFinalizeDialog.tsx
//
// 2026-06-09 (overnight session 5/11): Sign + Lock dialog for
// VeritaCheck studies. Mirrors the analyte sign dialog from
// VerificationAnalytesPanel. Locks lifecycle_state='draft' studies
// into lifecycle_state='finalized' after capturing a signature.
//
// B4 (2026-11-27, Q3 = 1): the signature is the full one (ESignatureForm): typed name, the signer's own password, the role the
// server says they sign as, and Accepted or Not accepted chosen. Only the medical director or a designee with the verify method
// duty signs; initials alone are refused.
//
// Endpoint contract:
//   GET  /api/labs/:labId/studies/:id/sign-as   who the signed-in person signs as
//   POST /api/studies/:id/finalize  body { signature, password, decision }

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { authHeaders } from "@/lib/auth";
import { API_BASE } from "@/lib/queryClient";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { ESignatureForm, postSignature, type SignAs } from "@/components/ESignatureForm";

/**
 * Who the signed-in person signs this study as (GET /api/labs/:labId/studies/:id/sign-as), read only when `enabled`. Signing is
 * decided by qualification, not edit access (B4 review), so a view-only login sees "Sign and lock" when this says they can sign.
 */
export function useStudySignAs(studyId: number, enabled = true): SignAs | null {
  const labId = useActiveLabId();
  const [value, setValue] = useState<SignAs | null>(null);
  useEffect(() => {
    if (!enabled || !labId || !studyId) { setValue(null); return; }
    let cancelled = false;
    fetch(`${API_BASE}/api/labs/${labId}/studies/${studyId}/sign-as`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setValue(j); })
      .catch(() => { if (!cancelled) setValue(null); });
    return () => { cancelled = true; };
  }, [enabled, labId, studyId]);
  return value;
}

export function StudyFinalizeDialog({
  open, onOpenChange, studyId, onFinalized,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studyId: number;
  onFinalized: () => void;
}) {
  const { toast } = useToast();
  const labId = useActiveLabId();
  const [signAs, setSignAs] = useState<SignAs | null>(null);

  useEffect(() => {
    if (!open) return;
    setSignAs(null);
    if (!labId) { setSignAs({ canSign: true, label: null, reason: null }); return; }
    let cancelled = false;
    fetch(`${API_BASE}/api/labs/${labId}/studies/${studyId}/sign-as`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setSignAs(j ?? { canSign: false, label: null, reason: "Could not check who can sign this study." }); })
      .catch(() => { if (!cancelled) setSignAs({ canSign: false, label: null, reason: "Could not check who can sign this study." }); });
    return () => { cancelled = true; };
  }, [open, labId, studyId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="study-finalize-dialog">
        <DialogHeader>
          <DialogTitle>Sign and lock study</DialogTitle>
          <DialogDescription>
            Signing off this study locks it from direct edits. To change anything after
            sign-off (e.g. exclude a newly identified outlier), use Amend to create a linked draft.
            The original stays in the audit trail and shows the signature. The medical director, or someone named in a
            signed Letter of Delegation for verifying test method performance, signs with their full name and own password.
          </DialogDescription>
        </DialogHeader>
        <ESignatureForm
          purpose="verification_study"
          signAs={signAs}
          withDecision
          submitLabel="Sign and lock"
          testId="study-sign"
          onSign={async (fields) => {
            const refused = await postSignature(`${API_BASE}/api/studies/${studyId}/finalize`, authHeaders(), fields);
            if (refused) return refused;
            toast({ title: "Study signed off and locked", description: "The study is now locked from direct edits. To change anything, use Amend." });
            onFinalized();
            onOpenChange(false);
            return null;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
