// The program's report on an event (B11, 2026-11-24; server/ptDocuments.ts).
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Download, Paperclip, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { labDayOf } from "@/lib/labDate";
import { PtError, ptDownload, ptRequest, usePtChanged } from "./ptUi";

export interface PtDocumentView { id: number; original_filename: string; file_size: number; mime_type: string; uploaded_at: string; uploaded_by: string | null }

export function PtDocuments({ labId, resultId, documents, canEdit }: { labId: number; resultId: number; documents: PtDocumentView[]; canEdit: boolean }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = usePtChanged(labId);
  const base = `/api/labs/${labId}/pt/events/${resultId}/documents`;
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const upload = (file: File) => run(async () => {
    const body = new FormData();
    body.append("file", file);
    const r = await ptRequest(base, { method: "POST", body });
    changed();
    if (r.phiWarning) toast({ title: "Possible patient information in this file", description: r.phiWarning, variant: "destructive", duration: 20000 });
  });
  return (
    <section className="space-y-2" data-testid="pt-documents">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Program's report</h3>
        {canEdit && (
          <>
            <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="hidden" data-testid="pt-document-input"
              onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) upload(file); }} />
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => input.current?.click()} data-testid="pt-document-add"><Paperclip size={12} className="mr-1" />{busy ? "Working..." : "Attach the report"}</Button>
          </>
        )}
      </div>
      {canEdit && <p className="text-xs text-muted-foreground" data-testid="pt-document-phi">PDF, PNG or JPG, up to 20 MB. A program's report can carry sample ids. VeritaAssure&reg; is not for patient information and doesn't read these files to check, so look before you attach one.</p>}
      {documents.length === 0 && <p className="text-xs text-muted-foreground">None attached.</p>}
      {documents.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-xs" data-testid={`pt-document-${d.id}`}>
          <span className="min-w-0 break-words">{d.original_filename} <span className="text-muted-foreground">({Math.max(1, Math.round(d.file_size / 1024))} KB), attached {labDayOf(d.uploaded_at)}{d.uploaded_by ? ` by ${d.uploaded_by}` : ""}</span></span>
          <span className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => run(() => ptDownload(`${base}/${d.id}`, d.original_filename))} data-testid={`pt-document-get-${d.id}`}><Download size={12} className="mr-1" />Download</Button>
            {canEdit && (
              <ConfirmDialog title="Remove this report?" message={`${d.original_filename} is removed from the event. The audit trail keeps its name and who attached it, not the file.`} confirmLabel="Remove" onConfirm={() => run(async () => { await ptRequest(`${base}/${d.id}`, { method: "DELETE" }); changed(); })}>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600 dark:text-red-400" aria-label={`Remove ${d.original_filename}`}><Trash2 size={12} /></Button>
              </ConfirmDialog>
            )}
          </span>
        </div>
      ))}
      <PtError error={error} />
    </section>
  );
}
