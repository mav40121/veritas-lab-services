// SendSystemDocumentDialog.tsx
//
// In the organization's repository lab: send a document's approved version to laboratories (B1; server/policySharedDocuments.ts), all
// of them, a roll-up group, or by name. Each gets its own draft. Nothing takes effect anywhere until that laboratory approves it.

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, Loader2, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiErrorMessage, apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";

interface Target { lab_id: number; lab_name: string; clia_number: string | null; state: string; has_version: boolean; waiting: boolean; can_send: boolean; why: string | null }
interface Targets {
  document: { id: number; title: string; doc_number: string | null; approved_label: string | null; revision_in_progress: boolean };
  organization_name: string | null; labs: Target[]; groups: Array<{ id: number; name: string; kind: string; lab_ids: number[] }>;
}
interface SendResult { lab_id: number; lab_name: string; outcome: "sent" | "revision" | "waiting" | "already" | "refused"; message: string }

export function SendSystemDocumentDialog({ labId, documentId, onClose }: { labId: number; documentId: number; onClose: () => void }) {
  const key = `/api/labs/${labId}/veritapolicy/shared/masters/${documentId}/targets`;
  const { data, isLoading, isError } = useQuery<Targets>({ queryKey: [key], queryFn: getQueryFn({ on401: "throw" }), refetchOnMount: "always", retry: false });
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const labs = data?.labs ?? [];
  const open = useMemo(() => new Set(labs.filter((l) => l.can_send).map((l) => l.lab_id)), [labs]);
  const pick = (ids: number[]) => setPicked(new Set(ids.filter((id) => open.has(id))));
  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/labs/${labId}/veritapolicy/shared/masters/${documentId}/send`, { labIds: [...picked] })).json(),
    onSuccess: (body: { results: SendResult[] }) => {
      setResults(body.results);
      queryClient.invalidateQueries({ queryKey: [key] });
      queryClient.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritapolicy/shared/masters`] });
    },
    onError: (e) => setError(apiErrorMessage(e, "It couldn't be sent. Try again.")),
  });
  const version = data?.document.approved_label ?? null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" data-testid="send-system-document">
        <DialogHeader><DialogTitle>{data ? `Send ${data.document.doc_number ? `${data.document.doc_number} ` : ""}${data.document.title}` : "Send to laboratories"}</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-2"><Loader2 className="animate-spin" size={14} /> Loading...</div>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground p-2">The laboratories couldn't be loaded.</p>
        ) : results ? (
          <ul className="divide-y border rounded-md text-sm" data-testid="send-results">
            {results.map((r) => (
              <li key={r.lab_id} className="p-2 flex items-start gap-2">
                {r.outcome === "refused" ? <XCircle size={15} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" /> : r.outcome === "waiting" || r.outcome === "already" ? <Clock size={15} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" /> : <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                <span className="min-w-0"><span className="font-medium">{r.lab_name}</span><span className="block text-xs text-muted-foreground">{r.message}</span></span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {version ? <>Sends approved version <span className="font-medium text-foreground">{version}</span>{data.document.revision_in_progress ? ", not the revision in progress" : ""}. Each laboratory gets its own draft, in its own manual and on its own route. Nothing takes effect until that laboratory approves it, and no signature is carried.</> : "Only an approved version can be sent. Finish this document's approval first."}
            </p>
            {version && (
              <>
                <div className="flex flex-wrap gap-1.5 text-xs" data-testid="send-groups">
                  <Button size="sm" variant="outline" className="h-7" onClick={() => pick(labs.map((l) => l.lab_id))} data-testid="send-all">All ({open.size})</Button>
                  {data.groups.map((g) => <Button key={g.id} size="sm" variant="outline" className="h-7" onClick={() => pick(g.lab_ids)} data-testid={`send-group-${g.id}`}>{g.name} ({g.lab_ids.filter((id) => open.has(id)).length})</Button>)}
                  {picked.size > 0 && <Button size="sm" variant="ghost" className="h-7" onClick={() => setPicked(new Set())}>Clear</Button>}
                </div>
                <ul className="divide-y border rounded-md text-sm max-h-[45vh] overflow-y-auto" data-testid="send-labs">
                  {labs.length === 0 && <li className="p-2 text-muted-foreground">{data.organization_name ?? "Your system"} has no laboratories to send to yet.</li>}
                  {labs.map((l) => (
                    <li key={l.lab_id} className="p-2">
                      <label className={`flex items-start gap-2 ${l.can_send ? "cursor-pointer" : "opacity-70"}`}>
                        <input type="checkbox" className="mt-1" checked={picked.has(l.lab_id)} disabled={!l.can_send} onChange={() => toggle(l.lab_id)} data-testid={`send-lab-${l.lab_id}`} />
                        <span className="min-w-0"><span className="font-medium">{l.lab_name}</span>{l.clia_number && <span className="ml-2 text-xs text-muted-foreground">{l.clia_number}</span>}{l.why && <span className="block text-xs text-muted-foreground">{l.why}</span>}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {error && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{results ? "Close" : "Cancel"}</Button>
          {!results && version && <Button onClick={() => { setError(null); send.mutate(); }} disabled={picked.size === 0 || send.isPending} data-testid="send-go">{send.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Send size={14} className="mr-1.5" />} Send to {picked.size || ""} {picked.size === 1 ? "laboratory" : "laboratories"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
