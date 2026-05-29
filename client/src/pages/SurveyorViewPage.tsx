// SurveyorViewPage.tsx
//
// Phase 8 of the MediaLab functional mirror. Public read-only view that a
// surveyor opens via a signed link without authentication. Lists every
// approved policy for the lab, lets the surveyor view each one inline
// with the signature timeline visible. Token validation + expiry +
// revocation enforced server-side; the page just renders the response.

import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, FileText, ShieldCheck, XCircle, Eye } from "lucide-react";

interface SurveyorDoc {
  id: number;
  title: string;
  description: string | null;
  effective_date: string | null;
  next_review_date: string | null;
  review_interval_months: number;
  current_version_number: number | null;
  current_file_format: string | null;
  manual_name: string | null;
}

interface SurveyorListResponse {
  lab: { lab_name: string | null; clia_number: string | null } | null;
  documents: SurveyorDoc[];
}

interface Signoff {
  id: number;
  action: string;
  comment: string | null;
  typed_signature: string;
  signed_document_hash: string;
  signed_at: string;
  user_name: string | null;
  step_name: string | null;
  step_order: number | null;
}

function fmtDate(s: string | null): string {
  if (!s) return "-";
  try {
    return new Date(s).toLocaleDateString();
  } catch {
    return s;
  }
}

export default function SurveyorViewPage() {
  const [, params] = useRoute("/surveyor/:token");
  const token = params?.token || "";

  const { data, isLoading, error } = useQuery<SurveyorListResponse>({
    queryKey: [`/api/surveyor/${token}/policies`],
    queryFn: async () => {
      const res = await fetch(`/api/surveyor/${token}/policies`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Link not valid");
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  const [viewDoc, setViewDoc] = useState<SurveyorDoc | null>(null);
  const [viewHtml, setViewHtml] = useState<string>("");
  const [viewPdfUrl, setViewPdfUrl] = useState<string>("");
  const [viewTampered, setViewTampered] = useState(false);
  const [viewSignoffs, setViewSignoffs] = useState<Signoff[]>([]);
  const [viewLoading, setViewLoading] = useState(false);

  const openView = async (doc: SurveyorDoc) => {
    setViewDoc(doc);
    setViewHtml("");
    setViewPdfUrl("");
    setViewTampered(false);
    setViewSignoffs([]);
    setViewLoading(true);
    try {
      fetch(`/api/surveyor/${token}/policies/${doc.id}/signoffs`)
        .then((r) => r.json())
        .then((b) => setViewSignoffs(b?.signoffs || []))
        .catch(() => {});
      if (doc.current_file_format === "pdf") {
        const res = await fetch(`/api/surveyor/${token}/policies/${doc.id}/render`);
        if (!res.ok) throw new Error("Render failed");
        if (res.headers.get("X-VeritaPolicy-Tamper") === "yes") setViewTampered(true);
        const blob = await res.blob();
        setViewPdfUrl(URL.createObjectURL(blob));
      } else {
        const res = await fetch(`/api/surveyor/${token}/policies/${doc.id}/render`);
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || "Render failed");
        setViewHtml(body.html || "");
        if (body.tampered) setViewTampered(true);
      }
    } catch (err: any) {
      // best-effort
    } finally {
      setViewLoading(false);
    }
  };

  const closeView = () => {
    if (viewPdfUrl) URL.revokeObjectURL(viewPdfUrl);
    setViewDoc(null);
    setViewHtml("");
    setViewPdfUrl("");
    setViewTampered(false);
    setViewSignoffs([]);
  };

  if (!token) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card>
          <CardContent className="p-6">No surveyor token in URL.</CardContent>
        </Card>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card>
          <CardContent className="p-6 flex items-center gap-2 text-muted-foreground">
            <Loader2 className="animate-spin" size={14} /> Loading...
          </CardContent>
        </Card>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card className="border-red-300 bg-red-50/40">
          <CardContent className="p-6">
            <div className="font-medium text-red-900 mb-2">Link unavailable</div>
            <div className="text-sm text-muted-foreground">
              The surveyor link may have expired, been revoked, or never existed. Please ask the
              lab to generate a fresh link.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { lab, documents } = data;
  const byManual = new Map<string, SurveyorDoc[]>();
  documents.forEach((d) => {
    const key = d.manual_name || "Unassigned";
    if (!byManual.has(key)) byManual.set(key, []);
    byManual.get(key)!.push(d);
  });

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Surveyor view</h1>
        <p className="text-sm text-muted-foreground">
          {lab?.lab_name && (
            <>
              <span className="font-medium">{lab.lab_name}</span>
              {lab.clia_number && <> · CLIA {lab.clia_number}</>}
              <span className="mx-2">·</span>
            </>
          )}
          {documents.length} approved {documents.length === 1 ? "policy" : "policies"}.
          Read-only access scoped to this link. Powered by VeritaAssure&trade; / VeritaPolicy&trade;.
        </p>
      </div>

      {documents.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No approved policies are visible through this link yet.
          </CardContent>
        </Card>
      ) : (
        Array.from(byManual.entries()).map(([manualName, docs]) => (
          <Card key={manualName}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {manualName}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  ({docs.length} {docs.length === 1 ? "policy" : "policies"})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {docs.map((d) => (
                  <li key={d.id} className="py-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{d.title}</div>
                      {d.description && (
                        <div className="text-xs text-muted-foreground">{d.description}</div>
                      )}
                      <div className="text-[10px] text-muted-foreground">
                        v{d.current_version_number} {d.current_file_format?.toUpperCase()} ·
                        effective {fmtDate(d.effective_date)} · next review {fmtDate(d.next_review_date)}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openView(d)}>
                      <Eye size={12} className="mr-1" /> View
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}

      {viewDoc && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-background rounded shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="text-lg font-bold">{viewDoc.title}</h2>
                {viewDoc.description && (
                  <p className="text-xs text-muted-foreground">{viewDoc.description}</p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={closeView}>
                Close
              </Button>
            </div>
            {viewTampered && (
              <div className="rounded border border-red-300 bg-red-50 text-red-900 p-2 text-xs mb-2">
                <div className="font-medium flex items-center gap-1">
                  <XCircle size={14} /> Tamper warning
                </div>
                <div>
                  The file on disk does not match the hash captured at upload. This is an
                  integrity anomaly the lab should investigate.
                </div>
              </div>
            )}
            {viewSignoffs.length > 0 && (
              <div className="rounded border bg-muted/30 p-2 text-xs space-y-1 mb-2">
                <div className="font-medium flex items-center gap-1">
                  <ShieldCheck size={14} /> Signature history ({viewSignoffs.length})
                </div>
                <ol className="space-y-1">
                  {viewSignoffs.map((s) => (
                    <li key={s.id} className="flex items-start gap-2 leading-snug">
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] uppercase border ${
                          s.action === "approved"
                            ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                            : s.action === "recertified"
                            ? "bg-sky-100 text-sky-900 border-sky-300"
                            : "bg-red-100 text-red-900 border-red-300"
                        }`}
                      >
                        {s.action}
                      </span>
                      <span className="flex-1">
                        <span className="font-medium">
                          {s.typed_signature || s.user_name}
                        </span>
                        {s.step_name && (
                          <span className="text-muted-foreground"> on {s.step_name}</span>
                        )}
                        <span className="text-muted-foreground"> at {fmtDate(s.signed_at)}</span>
                        {s.comment && (
                          <div className="italic text-muted-foreground">{s.comment}</div>
                        )}
                        <div className="text-[10px] font-mono text-muted-foreground break-all">
                          sha256: {s.signed_document_hash?.slice(0, 24)}…
                        </div>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {viewLoading ? (
              <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="animate-spin" size={14} /> Loading...
              </div>
            ) : viewPdfUrl ? (
              <iframe
                src={viewPdfUrl}
                title={viewDoc.title}
                className="w-full h-[70vh] border"
              />
            ) : (
              <div
                className="prose prose-sm max-w-none border rounded p-4 bg-white"
                dangerouslySetInnerHTML={{ __html: viewHtml }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
