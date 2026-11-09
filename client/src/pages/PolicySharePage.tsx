// PolicySharePage.tsx
//
// The public page behind a VeritaDC document share link (/policy/:token; server/policyShareLinks.ts). No login: someone
// outside the lab, such as nursing, reads one document's current approved version. The server decides what the link
// shows at each read, so a newly approved revision shows here on the same link, and a revoked link, an unknown one, or a
// document with no approved version right now all read the same not-active message. Rendered without the site's
// navigation (App.tsx), never indexed (useSEO robots plus the server's X-Robots-Tag), and GA never loads on it.

import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, Loader2, XCircle } from "lucide-react";
import { labLocaleDate } from "@/lib/labDate";
import { useSEO } from "@/hooks/useSEO";

export const SHARE_LINK_NOT_ACTIVE = "This link is not active. Contact the laboratory.";

interface ShareMeta {
  lab_name: string | null;
  clia_number: string | null;
  doc_number: string | null;
  title: string;
  version: string | null;
  effective_date: string | null;
  approved_date: string | null;
}

type Viewer =
  | { kind: "loading" }
  | { kind: "pdf" | "image"; url: string; tampered: boolean }
  | { kind: "html"; html: string; tampered: boolean }
  | { kind: "gone" }
  | { kind: "error" };

const fmt = (s: string | null) => (s ? labLocaleDate(s) || s : "Not stated");

// The document's own HTML (Word converted, or an HTML or text file) is shown in a sandboxed frame with no scripts, so
// nothing in a document can run on this site. Links in it open in a new tab.
const frameDoc = (html: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;color:#28251D;background:#fff;margin:16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #d0d0d0;padding:4px;vertical-align:top}</style></head><body>${html}</body></html>`;

function NotActive() {
  return (
    <Card data-testid="share-not-active">
      <CardContent className="p-6 flex items-start gap-2">
        <XCircle size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="font-medium">{SHARE_LINK_NOT_ACTIVE}</div>
      </CardContent>
    </Card>
  );
}

export default function PolicySharePage() {
  const [, params] = useRoute("/policy/:token");
  const token = params?.token || "";
  const api = `/api/public/policy-share/${encodeURIComponent(token)}`;

  const { data, isLoading, isError } = useQuery<ShareMeta | null>({
    queryKey: ["public-policy-share", token],
    queryFn: async () => {
      const r = await fetch(api, { cache: "no-store" });
      // Read the body even when it is the not-active answer, so the request completes.
      if (r.status === 404) { await r.text().catch(() => ""); return null; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: !!token,
    retry: false,
    // Each read counts as a view, so the page reads once.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });

  useSEO({
    title: data?.title ? `${data.title} | ${data.lab_name || "Laboratory"}` : "Shared document | VeritaDC™",
    description: "A laboratory document shared through VeritaDC™.",
    robots: "noindex, nofollow",
  });

  const [viewer, setViewer] = useState<Viewer>({ kind: "loading" });
  useEffect(() => {
    if (!data) return;
    let objectUrl = "";
    let cancelled = false;
    setViewer({ kind: "loading" });
    (async () => {
      try {
        const r = await fetch(`${api}/file`, { cache: "no-store" });
        if (!r.ok) {
          await r.text().catch(() => "");
          if (!cancelled) setViewer({ kind: r.status === 404 ? "gone" : "error" });
          return;
        }
        const ctype = r.headers.get("Content-Type") || "";
        const tampered = r.headers.get("X-VeritaPolicy-Tamper") === "yes";
        if (ctype.includes("application/json")) {
          const body = await r.json();
          if (!cancelled) setViewer({ kind: "html", html: String(body.html || ""), tampered: tampered || !!body.tampered });
          return;
        }
        objectUrl = URL.createObjectURL(await r.blob());
        if (!cancelled) setViewer({ kind: ctype.startsWith("image/") ? "image" : "pdf", url: objectUrl, tampered });
      } catch {
        if (!cancelled) setViewer({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data, api]);

  let body: JSX.Element;
  if (!token || data === null || viewer.kind === "gone") {
    body = <NotActive />;
  } else if (isLoading) {
    body = (
      <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="animate-spin" size={14} /> Loading...
      </div>
    );
  } else if (isError || !data) {
    body = (
      <Card>
        <CardContent className="p-6 text-sm">This document could not be loaded right now. Try again in a few minutes.</CardContent>
      </Card>
    );
  } else {
    const tampered = (viewer.kind === "pdf" || viewer.kind === "image" || viewer.kind === "html") && viewer.tampered;
    body = (
      <div className="space-y-4">
        <header className="space-y-1">
          <div className="text-sm text-muted-foreground" data-testid="share-lab">
            {data.lab_name || "Laboratory"}
            {data.clia_number && <> · CLIA {data.clia_number}</>}
          </div>
          <h1 className="text-2xl font-bold leading-tight break-words" data-testid="share-title">{data.title}</h1>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm pt-1" data-testid="share-facts">
            {data.doc_number && (
              <div><dt className="inline text-muted-foreground">Document </dt><dd className="inline font-medium" data-testid="share-doc-number">{data.doc_number}</dd></div>
            )}
            <div><dt className="inline text-muted-foreground">Version </dt><dd className="inline font-medium" data-testid="share-version">{data.version || "Not stated"}</dd></div>
            <div><dt className="inline text-muted-foreground">Effective </dt><dd className="inline font-medium">{fmt(data.effective_date)}</dd></div>
            {data.approved_date && (
              <div><dt className="inline text-muted-foreground">Approved </dt><dd className="inline font-medium">{fmt(data.approved_date)}</dd></div>
            )}
          </dl>
        </header>
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="share-note">
          This link always shows the laboratory's current approved version. Printed copies are uncontrolled.
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={`${api}/file?download=1`} download data-testid="share-download">
              <Download size={14} className="mr-1" /> Download
            </a>
          </Button>
        </div>
        {tampered && (
          <div className="rounded-md border border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200 p-2 text-sm" data-testid="share-tamper">
            This file does not match the copy that was approved. Contact the laboratory before relying on it.
          </div>
        )}
        {viewer.kind === "loading" ? (
          <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="animate-spin" size={14} /> Loading the document...
          </div>
        ) : viewer.kind === "error" ? (
          <div className="rounded-md border p-4 text-sm" data-testid="share-viewer-error">The document could not be shown here. Use Download to open it.</div>
        ) : viewer.kind === "image" ? (
          <img src={viewer.url} alt={data.title} className="max-w-full mx-auto border rounded-md bg-white" data-testid="share-viewer-image" />
        ) : viewer.kind === "pdf" ? (
          <iframe src={viewer.url} title={data.title} className="w-full h-[75vh] border rounded-md bg-white" data-testid="share-viewer-pdf" />
        ) : viewer.kind === "html" ? (
          <iframe
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={frameDoc(viewer.html)}
            title={data.title}
            className="w-full h-[75vh] border rounded-md bg-white"
            data-testid="share-viewer-html"
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {body}
        <footer className="border-t pt-3 text-xs text-muted-foreground">
          Shared through VeritaAssure&reg; / VeritaDC&trade;
        </footer>
      </main>
    </div>
  );
}
