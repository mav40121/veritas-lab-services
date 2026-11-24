// ArchivedDocumentsDialog.tsx
//
// VeritaDC's archived documents, for editors (B13; server/policyDocumentControl.ts): open one, or restore it. A restored document
// comes back exactly as it was archived; restoring approves nothing.

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Archive, Eye, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";

export interface ArchivedDocument {
  id: number;
  title: string;
  doc_number: string | null;
  status: string;
  manual_path: string | null;
  archived_at: string;
  archived_by: string | null;
  next_review_date: string | null;
  current_version_label: string | null;
  current_file_format: string | null;
}

const STATUS_WORDS: Record<string, string> = { approved: "approved", in_review: "in review", draft: "a draft", expired: "approved, review overdue" };

export function ArchivedDocumentsDialog<T extends ArchivedDocument>({ labId, open, onClose, onView, fmtDate }: {
  labId: number;
  open: boolean;
  onClose: () => void;
  onView: (doc: T) => void;
  fmtDate: (s: string | null) => string;
}) {
  const { toast } = useToast();
  const key = `/api/labs/${labId}/veritapolicy/archived-documents`;
  const { data, isLoading, isError } = useQuery<{ documents: T[]; can_restore: boolean }>({
    queryKey: [key],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: open,
    refetchOnMount: "always",
    retry: false,
  });
  const [q, setQ] = useState("");
  const [confirming, setConfirming] = useState<number | null>(null);
  const restore = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/labs/${labId}/veritapolicy/documents/${id}/restore`)).json(),
    onSuccess: (body: any) => {
      setConfirming(null);
      queryClient.invalidateQueries({ queryKey: [key] });
      queryClient.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritapolicy/documents`] });
      queryClient.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritapolicy/pending-reviews`] });
      toast({ title: "Document restored", description: `It came back as ${STATUS_WORDS[body.status] ?? body.status}, the way it was archived. Nothing was approved again.` });
    },
    onError: (e) => toast({ title: "Not restored", description: apiErrorMessage(e, "Try again."), variant: "destructive" }),
  });
  const term = q.trim().toLowerCase();
  const rows = (data?.documents ?? []).filter((d) => !term || `${d.doc_number ?? ""} ${d.title} ${d.manual_path ?? ""}`.toLowerCase().includes(term));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Archive size={16} /> Archived documents</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Only people who can edit VeritaDC™ see these. Restoring puts a document back the way it was archived, with the same
          version, signatures and dates. It isn't approved again.
        </p>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-2"><Loader2 className="animate-spin" size={14} /> Loading...</div>
        ) : isError ? (
          <div className="text-sm text-muted-foreground p-2">Archived documents couldn't be loaded.</div>
        ) : (data?.documents ?? []).length === 0 ? (
          <div className="text-sm text-muted-foreground p-2" data-testid="archived-empty">Nothing has been archived in this lab.</div>
        ) : (
          <>
            {(data?.documents ?? []).length > 8 && <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search archived documents..." aria-label="Search archived documents" />}
            <ul className="divide-y border rounded-md min-w-0" data-testid="archived-list">
              {rows.map((d) => (
                <li key={d.id} className="p-2 space-y-2" data-testid={`archived-row-${d.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 basis-60">
                      <div className="text-sm font-medium">
                        {d.doc_number && <span className="mr-2 font-mono text-xs text-muted-foreground">{d.doc_number}</span>}
                        {d.title}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {d.current_version_label ? `v${d.current_version_label}, ` : ""}{STATUS_WORDS[d.status] ?? d.status} when archived on {fmtDate(d.archived_at)}
                        {d.archived_by ? ` by ${d.archived_by}` : ""}
                        {d.manual_path ? `. ${d.manual_path}` : ""}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => onView(d)} data-testid={`archived-open-${d.id}`}><Eye size={12} className="mr-1" /> Open</Button>
                      {data?.can_restore && confirming !== d.id && (
                        <Button size="sm" variant="outline" onClick={() => setConfirming(d.id)} data-testid={`archived-restore-${d.id}`}><RotateCcw size={12} className="mr-1" /> Restore</Button>
                      )}
                    </div>
                  </div>
                  {confirming === d.id && (
                    <div className="rounded border border-amber-300 bg-amber-50 text-amber-900 p-2 text-xs flex flex-wrap items-center justify-between gap-2 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                      <span className="min-w-0 flex-1 basis-56">
                        Restore it as {STATUS_WORDS[d.status] ?? d.status}? {d.status === "approved" || d.status === "expired" ? "Staff will read it as a procedure in use again, and owe the read-and-sign it was assigned." : "It goes back where it was in its route."}
                      </span>
                      <span className="flex gap-1.5">
                        <Button size="sm" onClick={() => restore.mutate(d.id)} disabled={restore.isPending} data-testid={`archived-restore-yes-${d.id}`}>
                          {restore.isPending && <Loader2 className="animate-spin mr-1" size={12} />} Restore
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
                      </span>
                    </div>
                  )}
                </li>
              ))}
              {rows.length === 0 && <li className="p-2 text-sm text-muted-foreground">No archived document matches.</li>}
            </ul>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
