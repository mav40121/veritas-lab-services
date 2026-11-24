// A VeritaDC document opened from a VeritaMaintain link (the IFU on a record, the SOP on a schedule), at its current approved version.
// The server decides the version (server/approvedDocumentView.ts). The document's own HTML shows in a sandboxed frame with no scripts.
import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/auth";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { REVISION_IN_PROGRESS_NOTE } from "@shared/policyApprovedVersion";

type About = { title?: string; doc_number?: string | null; version?: string | null; revision_in_progress?: boolean };
type View = { kind: "loading" } | { kind: "pdf" | "image"; url: string } | { kind: "html"; html: string } | { kind: "error"; message: string };

const frameDoc = (html: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;color:#28251D;background:#fff;margin:16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #d0d0d0;padding:4px;vertical-align:top}</style></head><body>${html}</body></html>`;

export function ApprovedDocumentDialog({ url, label, onClose }: { url: string | null; label: string; onClose: () => void }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [about, setAbout] = useState<About>({});

  useEffect(() => {
    if (!url) return;
    let objectUrl = "";
    let live = true;
    setView({ kind: "loading" });
    setAbout({});
    (async () => {
      try {
        const r = await fetch(url, { headers: authHeaders(), cache: "no-store" });
        const isJson = (r.headers.get("Content-Type") || "").includes("application/json");
        if (!r.ok) {
          const j = isJson ? await r.json().catch(() => ({})) : {};
          if (live) setView({ kind: "error", message: j.error || "The document could not be opened." });
          return;
        }
        if (isJson) {
          const j = await r.json();
          if (live) { setAbout(j); setView({ kind: "html", html: String(j.html || "") }); }
          return;
        }
        try { if (live) setAbout(JSON.parse(decodeURIComponent(r.headers.get("X-Document") || "%7B%7D"))); } catch { /* the title is a convenience */ }
        const blob = await r.blob();
        objectUrl = URL.createObjectURL(blob);
        if (live) setView({ kind: blob.type.startsWith("image/") ? "image" : "pdf", url: objectUrl });
      } catch {
        if (live) setView({ kind: "error", message: "The document could not be opened." });
      }
    })();
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);

  return (
    <Dialog open={!!url} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl" data-testid="approved-document-dialog">
        <DialogHeader>
          <DialogTitle>{about.title || label}</DialogTitle>
          <DialogDescription>
            {[about.doc_number, about.version ? `Version ${about.version}` : "", "Approved version from VeritaDC™"].filter(Boolean).join(" · ")}
          </DialogDescription>
        </DialogHeader>
        {about.revision_in_progress && <p className="text-xs text-amber-800 dark:text-amber-300" data-testid="approved-document-revision">{REVISION_IN_PROGRESS_NOTE}</p>}
        {view.kind === "loading" && <p className="text-sm text-muted-foreground py-6">Loading...</p>}
        {view.kind === "error" && <p className="text-sm text-red-700 dark:text-red-400 py-6" data-testid="approved-document-error">{view.message}</p>}
        {view.kind === "pdf" && <iframe src={view.url} title={about.title || label} className="w-full h-[65vh] rounded border bg-white" />}
        {view.kind === "image" && <img src={view.url} alt={about.title || label} className="max-w-full max-h-[65vh] mx-auto" />}
        {view.kind === "html" && <iframe sandbox="allow-popups" srcDoc={frameDoc(view.html)} title={about.title || label} className="w-full h-[65vh] rounded border bg-white" data-testid="approved-document-frame" />}
      </DialogContent>
    </Dialog>
  );
}
