// client/src/components/StudyFindingPanel.tsx
//
// On a VeritaCheck study: the VeritaResponse findings opened from it, and, when its result is FAIL, "Open a finding" for
// someone who can edit VeritaResponse (B6, 2026-11-24; server/inspectionAssign.ts). A FAIL overridden to PASS
// is stored as a pass, so it isn't offered. Nothing is opened by itself.

import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClipboardList } from "lucide-react";
import { API_BASE, responseErrorText } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useLabRoute } from "@/hooks/useLabRoute";
import { useIsReadOnly } from "@/components/SubscriptionBanner";

interface StudyFindings {
  failed: boolean;
  canOpen: boolean;
  findings: Array<{ id: number; finding_number: string | null; status: string; created_at: string }>;
}
const STATUS_WORDS: Record<string, string> = { open: "Open", drafting: "Drafting", submitted: "Submitted", accepted: "Accepted", rejected_resubmit: "Resubmit", closed: "Closed" };

export function StudyFindingPanel({ labId, studyId, studyStatus, archived }: { labId: number; studyId: number; studyStatus: string; archived?: boolean }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const labRoute = useLabRoute();
  const responseReadOnly = useIsReadOnly("veritaresponse");
  const [confirming, setConfirming] = useState(false);
  const url = `/api/labs/${labId}/studies/${studyId}/findings`;
  const { data } = useQuery<StudyFindings>({
    queryKey: [url, studyStatus], // the status is part of the key, so an override or a re-run reads the answer again
    refetchOnMount: "always",
    queryFn: async () => {
      const res = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    retry: false,
  });
  const open = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/studies/${studyId}/open-finding`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: "{}" });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        if (body.code === "FINDING_EXISTS") return { id: Number(body.finding_id) };
        throw new Error(body.error || "Could not open a finding");
      }
      if (!res.ok) throw new Error(await responseErrorText(res, "Could not open a finding"));
      return res.json() as Promise<{ id: number }>;
    },
    onSuccess: (f) => {
      qc.invalidateQueries({ queryKey: [url] });
      setConfirming(false);
      navigate(labRoute(`/veritaresponse/${f.id}`));
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Finding not opened", description: e.message }),
  });
  if (!data) return null;
  const openOne = data.findings.some((f) => f.status !== "closed" && f.status !== "accepted");
  const offer = data.failed && data.canOpen && !responseReadOnly && !archived && !openOne;
  if (!offer && data.findings.length === 0) return null;
  return (
    <div className="mt-3 flex items-center gap-3 flex-wrap" data-testid="study-finding-panel">
      {offer && (
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)} data-testid="study-open-finding">
          <ClipboardList size={13} className="mr-1" />Open a finding
        </Button>
      )}
      {data.findings.length > 0 ? (
        <span className="text-xs text-muted-foreground">
          VeritaResponse™:{" "}
          {data.findings.map((f, i) => (
            <span key={f.id}>
              {i > 0 && ", "}
              <Link href={labRoute(`/veritaresponse/${f.id}`)} className="text-primary hover:underline" data-testid={`study-finding-${f.id}`}>
                finding {f.finding_number || `#${f.id}`}
              </Link>{" "}
              ({STATUS_WORDS[f.status] ?? f.status})
            </span>
          ))}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Records this FAIL in VeritaResponse™ as an internal event, linked to this study.</span>
      )}
      {confirming && (
        <Dialog open onOpenChange={(o) => { if (!o) setConfirming(false); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Open a finding?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">This creates a VeritaResponse™ internal event (NCE) that names this study and links back to it. The study is not changed.</p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button size="sm" onClick={() => open.mutate()} disabled={open.isPending} data-testid="study-open-finding-confirm">{open.isPending ? "Opening…" : "Open a finding"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
