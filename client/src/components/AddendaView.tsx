// AddendaView.tsx
//
// A laboratory's own addenda to a system document, shown under it in the same view and in print order (B1;
// server/policySharedDocuments.ts). Each is a VeritaDC document of its own, read through the same route as any other, so the
// server decides which version this reader gets. Used on My Documents, My sign-offs, the inspector's link and a share link.
// AddendaNotice is the shorter form where the document opens from another module or an approval: it says how many there are, and
// each opens in place at its approved version.

import { useEffect, useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { addendaSentence } from "@shared/systemDocuments";

export interface AddendumView {
  key: string | number;
  title: string;
  version: string | null;
  url: string;
  // Shown beside the title, for example that it is still a draft.
  note?: string | null;
}

// The document's own HTML shows in a frame with no scripts, so nothing in a document can run in the app.
const frameDoc = (html: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;color:#28251D;background:#fff;margin:16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}td,th{vertical-align:top}</style></head><body>${html}</body></html>`;

type Shown = { kind: "loading" } | { kind: "pdf"; url: string } | { kind: "image"; url: string } | { kind: "html"; html: string } | { kind: "error" };

function Addendum({ a, n, headers }: { a: AddendumView; n: number; headers?: Record<string, string> }) {
  const [shown, setShown] = useState<Shown>({ kind: "loading" });
  const [tampered, setTampered] = useState(false);
  useEffect(() => {
    let url = "", cancelled = false;
    setShown({ kind: "loading" });
    setTampered(false);
    (async () => {
      try {
        const res = await fetch(a.url, { headers });
        const type = res.headers.get("Content-Type") || "";
        if (!res.ok) throw new Error("not shown");
        if (res.headers.get("X-VeritaPolicy-Tamper") === "yes") setTampered(true);
        if (type.includes("application/json")) {
          const body = await res.json();
          if (cancelled) return;
          if (body.tampered) setTampered(true);
          setShown({ kind: "html", html: String(body.html || "") });
        } else {
          url = URL.createObjectURL(await res.blob());
          if (!cancelled) setShown({ kind: type.startsWith("image/") ? "image" : "pdf", url });
        }
      } catch {
        if (!cancelled) setShown({ kind: "error" });
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.url]);
  return (
    <section className="rounded-md border min-w-0" data-testid={`addendum-${a.key}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b bg-muted/40 px-3 py-1.5 text-sm">
        <Paperclip size={13} className="shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">Site addendum {n}</span>
        <span className="font-medium min-w-0 [overflow-wrap:anywhere]">{a.title}</span>
        {a.version && <span className="text-xs text-muted-foreground">version {a.version}</span>}
        {a.note && <span className="text-xs text-amber-800 dark:text-amber-300">{a.note}</span>}
      </div>
      {tampered && <div className="px-3 py-1.5 text-xs text-red-800 dark:text-red-300">The file on disk does not match the copy that was uploaded. Do not rely on it.</div>}
      {shown.kind === "loading" ? (
        <div className="p-4 flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="animate-spin" size={14} /> Loading...</div>
      ) : shown.kind === "error" ? (
        <p className="p-4 text-sm text-muted-foreground">This addendum couldn't be shown here.</p>
      ) : shown.kind === "image" ? (
        <img src={shown.url} alt={a.title} className="max-w-full mx-auto bg-white" />
      ) : shown.kind === "pdf" ? (
        <iframe src={shown.url} title={a.title} className="w-full h-[50vh] bg-white" />
      ) : (
        <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={frameDoc(shown.html)} title={a.title} className="w-full h-64 resize-y bg-white" data-testid={`addendum-html-${a.key}`} />
      )}
    </section>
  );
}

export function AddendaNotice({ addenda, headers }: { addenda: AddendumView[]; headers?: Record<string, string> }) {
  const [open, setOpen] = useState<Array<string | number>>([]);
  if (addenda.length === 0) return null;
  return (
    <div className="rounded-md border px-3 py-2 space-y-2 min-w-0" data-testid="addenda-notice">
      <p className="text-sm flex items-center gap-2"><Paperclip size={13} className="shrink-0 text-muted-foreground" /> {addendaSentence(addenda.length)}</p>
      <ul className="space-y-2 min-w-0">
        {addenda.map((a, i) => {
          const shown = open.includes(a.key);
          return (
            <li key={a.key} className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <span className="min-w-0 [overflow-wrap:anywhere]">{a.title}</span>
                {a.version && <span className="text-xs text-muted-foreground">version {a.version}</span>}
                <button
                  type="button" aria-expanded={shown} className="text-xs font-medium text-primary hover:underline"
                  onClick={() => setOpen(shown ? open.filter((k) => k !== a.key) : [...open, a.key])} data-testid={`addendum-open-${a.key}`}
                >
                  {shown ? "Close" : "Open"}
                </button>
              </div>
              {shown && <Addendum a={a} n={i + 1} headers={headers} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function AddendaView({ addenda, headers }: { addenda: AddendumView[]; headers?: Record<string, string> }) {
  if (addenda.length === 0) return null;
  return (
    <div className="space-y-2 min-w-0" data-testid="addenda-view">
      {addenda.map((a, i) => <Addendum key={a.key} a={a} n={i + 1} headers={headers} />)}
    </div>
  );
}
