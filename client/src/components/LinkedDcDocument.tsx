// client/src/components/LinkedDcDocument.tsx
//
// A VeritaDC document linked to a VeritaScan item or a VeritaResponse finding (B8, 2026-11-24;
// server/inspectionLinks.ts): how it stands today, and the document itself opened in the app. What opens is its current
// approved version, read through VeritaDC's own routes, so VeritaDC decides who reads it.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { API_BASE, responseErrorText } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useStaffDocScope } from "@/hooks/useStaffLogin";
import { REVISION_IN_PROGRESS_NOTE } from "@shared/policyApprovedVersion";
import { labLocaleDate } from "@/lib/labDate";
import { AddendaNotice } from "@/components/AddendaView";

export interface LinkedDoc {
  document_id: number;
  title: string;
  doc_number: string | null;
  next_review_date: string | null;
  state: "current" | "past_review" | "not_approved" | "archived";
  revision_in_progress: boolean;
  open_version_id: number | null;
  current_version_id: number | null;
  // The laboratory's addenda to a system document, each at its approved version. Absent when there are none.
  addenda?: { document_id: number; title: string; version_label: string | null; open_version_id: number }[];
}

export const docLabel = (d: LinkedDoc) => (d.doc_number ? `${d.doc_number} ${d.title}` : d.title);

/** The words a flagged document carries; null when it is current. */
export function docFlag(d: LinkedDoc): string | null {
  if (d.state === "past_review") return d.next_review_date ? `Past review, due ${labLocaleDate(d.next_review_date) || d.next_review_date}` : "Past review";
  if (d.state === "not_approved") return "Not approved";
  if (d.state === "archived") return "Archived, not in use";
  return null;
}

// The document's own HTML shows in a frame with no scripts, so nothing in a document can run in the app.
const frameDoc = (html: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;color:#28251D;background:#fff;margin:16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #d0d0d0;padding:4px;vertical-align:top}</style></head><body>${html}</body></html>`;

type Viewer = { kind: "loading" } | { kind: "pdf"; url: string } | { kind: "image"; url: string } | { kind: "html"; html: string } | { kind: "error"; message: string };

export function LinkedDocDialog({ labId, doc, onClose }: { labId: number; doc: LinkedDoc; onClose: () => void }) {
  const { ownOnly } = useStaffDocScope();
  const [viewer, setViewer] = useState<Viewer>({ kind: "loading" });
  const [tampered, setTampered] = useState(false);
  const openable = doc.open_version_id != null;
  useEffect(() => {
    if (!openable) return;
    let url = "", cancelled = false;
    setViewer({ kind: "loading" });
    (async () => {
      try {
        // The document's own render gives a Staff login the approved version, and everyone else the current one; another
        // version is asked for by its id.
        const path = ownOnly || doc.open_version_id === doc.current_version_id ? "render" : `versions/${doc.open_version_id}/render`;
        const res = await fetch(`${API_BASE}/api/labs/${labId}/veritapolicy/documents/${doc.document_id}/${path}`, { headers: authHeaders() });
        if (!res.ok) throw new Error(await responseErrorText(res, "The document could not be opened"));
        if (res.headers.get("X-VeritaPolicy-Tamper") === "yes") setTampered(true);
        const type = res.headers.get("Content-Type") || "";
        if (type.includes("application/json")) {
          const body = await res.json();
          if (cancelled) return;
          if (body.tampered) setTampered(true);
          setViewer({ kind: "html", html: String(body.html || "") });
        } else {
          url = URL.createObjectURL(await res.blob());
          if (!cancelled) setViewer({ kind: type.startsWith("image/") ? "image" : "pdf", url });
        }
      } catch (e: any) {
        if (!cancelled) setViewer({ kind: "error", message: e?.message || "The document could not be opened" });
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [labId, doc.document_id, doc.open_version_id, doc.current_version_id, ownOnly, openable]);
  const flag = docFlag(doc);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="linked-doc-dialog">
        <DialogHeader><DialogTitle>{docLabel(doc)}</DialogTitle></DialogHeader>
        {flag && <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200 px-3 py-2 text-sm" data-testid="linked-doc-flag">{flag}</div>}
        {doc.revision_in_progress && <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200 px-3 py-2 text-sm">{REVISION_IN_PROGRESS_NOTE}</div>}
        {tampered && <div className="rounded-md border border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200 px-3 py-2 text-sm">The file on disk does not match the copy that was uploaded. Do not rely on it.</div>}
        {openable && <AddendaNotice headers={authHeaders()} addenda={(doc.addenda ?? []).map((a) => ({
          key: a.document_id, title: a.title, version: a.version_label,
          url: `${API_BASE}/api/labs/${labId}/veritapolicy/documents/${a.document_id}/${ownOnly ? "render" : `versions/${a.open_version_id}/render`}`,
        }))} />}
        {!openable ? (
          <p className="text-sm text-muted-foreground py-6 text-center">This document has no approved version to open. Open it in VeritaDC™ to see where it stands.</p>
        ) : viewer.kind === "loading" ? (
          <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="animate-spin" size={14} /> Loading the document…</div>
        ) : viewer.kind === "error" ? (
          <p className="text-sm text-destructive py-6 text-center">{viewer.message}</p>
        ) : viewer.kind === "image" ? (
          <img src={viewer.url} alt={doc.title} className="max-w-full mx-auto border rounded-md bg-white" />
        ) : viewer.kind === "pdf" ? (
          <iframe src={viewer.url} title={doc.title} className="w-full h-[65vh] border rounded-md bg-white" />
        ) : (
          <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={frameDoc(viewer.html)} title={doc.title} className="w-full h-[65vh] border rounded-md bg-white" data-testid="linked-doc-html" />
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
