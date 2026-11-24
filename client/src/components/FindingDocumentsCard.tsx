// client/src/components/FindingDocumentsCard.tsx
//
// The VeritaDC documents linked to a VeritaResponse finding, and suggested SOPs (B8, 2026-11-24;
// server/inspectionLinks.ts, shared/sopSuggest.ts). A suggestion says why it is one and is linked only when someone links it.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Plus, Search, X } from "lucide-react";
import { API_BASE, responseErrorText } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { LinkedDocDialog, docFlag, docLabel, type LinkedDoc } from "@/components/LinkedDcDocument";

const FLAG_CLASS = "text-[10px] border text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700";

export function FindingDocumentsCard({ labId, findingId, savedAt, readOnly, onChanged }: { labId: number; findingId: string | number; savedAt: string | null; readOnly: boolean; onChanged?: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [opened, setOpened] = useState<LinkedDoc | null>(null);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const base = `/api/labs/${labId}/findings/${findingId}`;
  const getJson = async (path: string) => {
    const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(await responseErrorText(res, "Could not load the documents"));
    return res.json();
  };
  const linked = useQuery<{ documents: Array<LinkedDoc & { link_id: number }> }>({ queryKey: [`${base}/documents`], refetchOnMount: "always", queryFn: () => getJson(`${base}/documents`) });
  // Suggestions come from the finding as saved, so a save reads them again.
  const options = useQuery<{ suggested: Array<LinkedDoc & { reasons: string[] }>; documents: LinkedDoc[] }>({
    queryKey: [`${base}/document-options`, savedAt ?? "", search.trim()],
    enabled: !readOnly,
    placeholderData: (prev) => prev,
    refetchOnMount: "always",
    queryFn: () => getJson(`${base}/document-options?q=${encodeURIComponent(search.trim())}`),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: [`${base}/documents`] });
    qc.invalidateQueries({ queryKey: [`${base}/document-options`] });
    onChanged?.();
  };
  const link = useMutation({
    mutationFn: async (documentId: number) => {
      const res = await fetch(`${API_BASE}${base}/documents`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ document_id: documentId }) });
      if (!res.ok) throw new Error(await responseErrorText(res, "Could not link that document"));
      return res.json();
    },
    onSuccess: () => { toast({ title: "Document linked" }); refresh(); },
    onError: (e: Error) => toast({ variant: "destructive", title: "Document not linked", description: e.message }),
  });
  const unlink = useMutation({
    mutationFn: async (linkId: number) => {
      const res = await fetch(`${API_BASE}${base}/documents/${linkId}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error(await responseErrorText(res, "Could not remove that link"));
      return res.json();
    },
    onSuccess: refresh,
    onError: (e: Error) => toast({ variant: "destructive", title: "Link not removed", description: e.message }),
  });
  const docs = linked.data?.documents ?? [];
  const suggested = options.data?.suggested ?? [];
  const row = (d: LinkedDoc, right: React.ReactNode, reasons?: string[]) => (
    <div key={d.document_id} className="rounded-md border border-border p-2.5 text-sm flex items-start gap-2">
      <FileText size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <button type="button" className="text-left font-medium text-teal-700 dark:text-teal-400 hover:underline break-words" onClick={() => setOpened(d)} data-testid={`finding-doc-open-${d.document_id}`}>{docLabel(d)}</button>
        <div className="flex flex-wrap items-center gap-1.5">
          {docFlag(d) && <Badge variant="outline" className={FLAG_CLASS}>{docFlag(d)}</Badge>}
          {d.revision_in_progress && <span className="text-[11px] text-muted-foreground">A revision is in progress</span>}
          {reasons && <span className="text-[11px] text-muted-foreground">{reasons.join(". ")}.</span>}
        </div>
      </div>
      {right}
    </div>
  );
  if (readOnly && docs.length === 0) return null;
  return (
    <Card data-testid="finding-documents">
      <CardHeader className="py-3 px-4 border-b"><CardTitle className="text-base font-semibold">VeritaDC™ documents</CardTitle></CardHeader>
      <CardContent className="p-4 space-y-3">
        {docs.length === 0 ? <p className="text-sm text-muted-foreground">No documents linked yet.</p> : (
          <div className="space-y-1.5">
            {docs.map((d) => row(d, readOnly ? null : (
              <button type="button" className="text-muted-foreground hover:text-foreground" title="Remove this link" onClick={() => unlink.mutate(d.link_id)} disabled={unlink.isPending} data-testid={`finding-doc-unlink-${d.document_id}`}><X size={14} /></button>
            )))}
          </div>
        )}
        {!readOnly && suggested.length > 0 && (
          <div className="space-y-1.5" data-testid="finding-doc-suggestions">
            <div className="text-xs font-medium text-muted-foreground">Suggested SOPs. Nothing is linked until you link it.</div>
            {suggested.map((d) => row(d, (
              <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => link.mutate(d.document_id)} disabled={link.isPending} data-testid={`finding-doc-link-${d.document_id}`}>Link</Button>
            ), d.reasons))}
          </div>
        )}
        {!readOnly && (adding ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your documents by title, number or description" className="h-9 pl-8 text-sm" data-testid="finding-doc-search" />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {(options.data?.documents ?? []).map((d) => row(d, (
                <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => link.mutate(d.document_id)} disabled={link.isPending}>Link</Button>
              )))}
              {options.data && options.data.documents.length === 0 && <p className="text-xs text-muted-foreground italic py-3 text-center">No documents match.</p>}
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setSearch(""); }}>Done</Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="finding-doc-add"><Plus size={13} className="mr-1" />Link a document</Button>
        ))}
      </CardContent>
      {opened && <LinkedDocDialog labId={labId} doc={opened} onClose={() => setOpened(null)} />}
    </Card>
  );
}
