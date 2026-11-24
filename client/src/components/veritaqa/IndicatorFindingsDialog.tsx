// client/src/components/veritaqa/IndicatorFindingsDialog.tsx
//
// VeritaResponse entries linked to one month of a quality indicator (B15; server/qualityFindings.ts). A link only: nothing is
// opened here.
import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { API_BASE, responseErrorText } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { X } from "lucide-react";
import { FINDING_STATUS_LABEL } from "@/lib/systemFindings";
import { findingTemplate } from "@shared/findingTypes";

export interface IndicatorFindingLink { link_id: number; entry_id: number; finding_id: number; label: string; status: string; source_type: string }
interface Option { id: number; label: string; source_type: string; status: string; due_date: string | null }

const about = (x: { source_type: string; status: string }) => [x.source_type && x.source_type !== "inspection" ? findingTemplate(x.source_type).label : "", FINDING_STATUS_LABEL[x.status] || x.status].filter(Boolean).join(", ");

export default function IndicatorFindingsDialog({ labId, entryId, title, links, readOnly, onChanged, onClose }: {
  labId: number; entryId: number; title: string; links: IndicatorFindingLink[]; readOnly: boolean; onChanged: () => Promise<void> | void; onClose: () => void;
}) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/labs/${labId}/veritaqa/pi/entries/${entryId}`;
  const options = useQuery<Option[]>({
    queryKey: [`${base}/finding-options`, q.trim(), links.map((l) => l.finding_id).join(",")], enabled: !readOnly, placeholderData: (p) => p, refetchOnMount: "always",
    queryFn: async () => {
      const r = await fetch(`${API_BASE}${base}/finding-options?q=${encodeURIComponent(q.trim())}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await responseErrorText(r, "Could not load this laboratory's findings"));
      return r.json();
    },
  });
  async function send(method: string, path: string, body?: unknown) {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}${path}`, { method, headers: { ...authHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) { toast({ title: "Not saved", description: await responseErrorText(r, "Try again."), variant: "destructive" }); return; }
      await onChanged();
    } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="qa-findings-dialog">
        <DialogHeader>
          <DialogTitle>Linked findings</DialogTitle>
          <DialogDescription>{title}. Linking opens nothing and changes neither record.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {links.length === 0 && <p className="text-sm text-muted-foreground">Nothing linked to this month.</p>}
          {links.map((l) => (
            <div key={l.link_id} className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/labs/${labId}/veritaresponse/${l.finding_id}`} className="font-medium text-teal-700 dark:text-teal-400 hover:underline break-words">{l.label}</Link>
                <div className="text-xs text-muted-foreground">{about(l)}</div>
              </div>
              {!readOnly && <button type="button" className="text-muted-foreground hover:text-foreground" title="Remove this link" disabled={busy} onClick={() => send("DELETE", `${base}/findings/${l.link_id}`)} data-testid={`qa-unlink-${l.finding_id}`}><X size={14} /></button>}
            </div>
          ))}
        </div>
        {!readOnly && (
          <div className="space-y-2 border-t pt-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this laboratory's VeritaResponse™ entries" className="h-9" data-testid="qa-finding-search" />
            <div className="max-h-56 overflow-y-auto space-y-1.5">
              {options.error ? <p className="text-sm text-destructive">{(options.error as Error).message}</p> : null}
              {(options.data || []).map((o) => (
                <div key={o.id} className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium break-words">{o.label}</div>
                    <div className="text-xs text-muted-foreground">{about(o)}{o.due_date ? `, due ${o.due_date}` : ""}</div>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 shrink-0" disabled={busy} onClick={() => send("POST", `${base}/findings`, { finding_id: o.id })} data-testid={`qa-link-${o.id}`}>Link</Button>
                </div>
              ))}
              {options.data && options.data.length === 0 && <p className="py-3 text-center text-xs italic text-muted-foreground">No VeritaResponse™ entries{q.trim() ? " match" : " to link"}.</p>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
