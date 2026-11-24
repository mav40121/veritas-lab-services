// BulkApproveDialog.tsx
//
// Approve several VeritaDC documents waiting on the signed-in person's own step (B13; server/policyDocumentControl.ts). The list is
// fixed when the dialog opens: what is signed is the version and step each row showed, and the server refuses a document that has
// moved since. One typed name and one password; each document gets its own signature. No bulk reject, on purpose.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Eye, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { BULK_APPROVE_MAX } from "@shared/policyNotices";

export interface BulkApproveItem {
  document_id: number;
  title: string;
  doc_number?: string | null;
  version_id: number;
  version_label?: string | null;
  step_id: number;
  step_name: string;
  step_order: number;
  total_steps: number;
  is_major_revision?: boolean;
  delegator_name?: string | null;
}

interface Result { documentId: number; title: string | null; ok: boolean; status: string | null; nextStep: string | null; code: string | null; message: string | null }

const plural = (n: number) => `${n} ${n === 1 ? "document" : "documents"}`;

/** Render it only while it is open: it takes its list once, from `items` as they were then. */
export function BulkApproveDialog({ labId, items, signerName, onView, onClose }: {
  labId: number;
  items: BulkApproveItem[];
  signerName: string;
  onView: (documentId: number) => void;
  onClose: () => void;
}) {
  const [shown] = useState(items);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [typedName, setTypedName] = useState(signerName);
  const [password, setPassword] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const all = shown.length > 0 && picked.size === Math.min(shown.length, BULK_APPROVE_MAX);

  const sign = useMutation({
    mutationFn: async () => {
      setProblem(null);
      const res = await apiRequest("POST", `/api/labs/${labId}/veritapolicy/approvals/bulk`, {
        typedSignature: typedName.trim(),
        password,
        items: shown.filter((i) => picked.has(i.document_id)).map((i) => ({ documentId: i.document_id, versionId: i.version_id, stepId: i.step_id })),
      });
      return (await res.json()) as { results: Result[]; signed: number; refused: number };
    },
    onSuccess: (body) => {
      setPassword("");
      setResults(body.results);
      queryClient.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritapolicy/documents`] });
      queryClient.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritapolicy/pending-reviews`] });
    },
    // Said in the dialog, not a toast: a toast would still be up beside the results of the next try.
    onError: (e) => setProblem(`Nothing was signed. ${apiErrorMessage(e, "Try again.")}`),
  });

  const toggle = (id: number) => setPicked((p) => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id); else if (next.size < BULK_APPROVE_MAX) next.add(id);
    return next;
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !sign.isPending) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{results ? "What happened" : "Approve several documents"}</DialogTitle>
        </DialogHeader>
        {results ? (
          <>
            <p className="text-sm" data-testid="bulk-summary">
              {plural(results.filter((r) => r.ok).length)} signed{results.some((r) => !r.ok) ? `, ${results.filter((r) => !r.ok).length} not signed` : ""}.
            </p>
            <ul className="divide-y border rounded-md min-w-0" data-testid="bulk-results">
              {results.map((r) => (
                <li key={r.documentId} className="p-2 flex items-start gap-2 text-sm" data-testid={`bulk-result-${r.documentId}`}>
                  {r.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-400" /> : <XCircle size={15} className="mt-0.5 shrink-0 text-red-700 dark:text-red-400" />}
                  <span className="min-w-0">
                    <span className="font-medium">{r.title ?? `Document ${r.documentId}`}</span>
                    <span className="block text-xs text-muted-foreground">
                      {r.ok ? (r.status === "approved" ? "Signed. It is now approved." : `Signed. Next step: ${r.nextStep ?? "the next reviewer"}.`) : `Not signed. ${r.message ?? ""}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button onClick={onClose} data-testid="bulk-done">Close</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Read each document before you approve it. Your typed name and a hash of each document's version are recorded as your
              electronic signature on each one, the same as approving them one at a time.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={all} onCheckedChange={() => setPicked(all ? new Set() : new Set(shown.slice(0, BULK_APPROVE_MAX).map((i) => i.document_id)))} data-testid="bulk-all" />
              Select all ({shown.length})
            </label>
            <ul className="divide-y border rounded-md min-w-0 max-h-[40vh] overflow-y-auto" data-testid="bulk-list">
              {shown.map((i) => (
                <li key={i.document_id} className="p-2 flex items-start gap-2">
                  <Checkbox className="mt-0.5" checked={picked.has(i.document_id)} onCheckedChange={() => toggle(i.document_id)} aria-label={`Approve ${i.title}`} data-testid={`bulk-pick-${i.document_id}`} />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">
                      {i.doc_number && <span className="mr-2 font-mono text-xs text-muted-foreground">{i.doc_number}</span>}
                      {i.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {i.version_label ? `v${i.version_label}, ` : ""}step {i.step_order} of {i.total_steps}: {i.step_name}
                      {i.is_major_revision ? ". Major revision" : ""}
                      {i.delegator_name ? `. Standing in for ${i.delegator_name}` : ""}
                    </span>
                  </span>
                  <Button size="sm" variant="ghost" className="h-7 shrink-0" onClick={() => onView(i.document_id)} aria-label={`View ${i.title}`}><Eye size={13} /></Button>
                </li>
              ))}
            </ul>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs" htmlFor="bulk-name">Type your full name</Label>
                <Input id="bulk-name" value={typedName} onChange={(e) => setTypedName(e.target.value)} data-testid="bulk-name" />
              </div>
              <div>
                <Label className="text-xs" htmlFor="bulk-password">Your password (21 CFR Part 11 re-auth)</Label>
                <Input id="bulk-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="bulk-password" />
              </div>
            </div>
            {problem && <p className="text-sm text-red-700 dark:text-red-400" role="alert" data-testid="bulk-problem">{problem}</p>}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onClose} disabled={sign.isPending}>Cancel</Button>
              <Button onClick={() => sign.mutate()} disabled={sign.isPending || picked.size === 0 || typedName.trim().length < 2 || !password} data-testid="bulk-sign">
                {sign.isPending && <Loader2 className="animate-spin mr-1" size={14} />}
                {picked.size ? `Approve ${plural(picked.size)}` : "Approve"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
