// client/src/components/CarriedOverPanel.tsx
//
// History a document brought with it from the lab's prior system (server/veritadcBulkLoad.ts). Shown on the document view
// and on the inspector link. It says plainly that the people on the face page signed in the prior system, never in
// VeritaAssure, and opens their signature face page in a sandboxed frame.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, FileClock, Loader2 } from "lucide-react";
import { carriedOverNotice } from "@shared/policyCarriedOver";

export interface CarriedRecord {
  source_system: string;
  source_number: string;
  source_version: string | null;
  title_as_exported: string | null;
  effective_date: string | null;
  last_approval_or_review: string | null;
  next_review_due: string | null;
  author: string | null;
  approval_rows: number;
  review_rows: number;
  version_count: number;
  source_manual: string | null;
  also_filed_in: string[];
  has_face_page: boolean;
  has_original: boolean;
  original_filename: string | null;
  converted_from: string | null;
  loaded_at: string;
  loaded_by: string | null;
  owner_name: string | null;
  is_current_version: boolean;
}

export function CarriedOverPanel({
  carried,
  title,
  facePageUrl,
  originalUrl,
  headers,
  fmtDate,
}: {
  carried: CarriedRecord;
  title: string;
  facePageUrl: string;
  originalUrl?: string;
  headers?: Record<string, string>;
  fmtDate: (s: string | null | undefined) => string;
}) {
  const [faceHtml, setFaceHtml] = useState("");
  const [faceOpen, setFaceOpen] = useState(false);
  const [faceLoading, setFaceLoading] = useState(false);
  const [problem, setProblem] = useState("");

  // A different document opened in the same dialog starts closed.
  useEffect(() => {
    setFaceHtml("");
    setFaceOpen(false);
    setProblem("");
  }, [facePageUrl]);

  const toggleFacePage = async () => {
    if (faceOpen) return setFaceOpen(false);
    setFaceOpen(true);
    if (faceHtml) return;
    setFaceLoading(true);
    setProblem("");
    try {
      const res = await fetch(facePageUrl, { headers });
      if (!res.ok) throw new Error("not available");
      setFaceHtml(await res.text());
    } catch {
      setFaceOpen(false);
      setProblem("The signature face page could not be opened.");
    } finally {
      setFaceLoading(false);
    }
  };

  const downloadOriginal = async () => {
    if (!originalUrl) return;
    setProblem("");
    try {
      const res = await fetch(originalUrl, { headers });
      if (!res.ok) throw new Error("not available");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = carried.original_filename || "original";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setProblem("The original file could not be downloaded.");
    }
  };

  const signatures = carried.approval_rows + carried.review_rows;
  const rows: [string, string][] = [
    ["Document number", carried.source_number],
    ...(carried.source_version ? ([["Version", carried.source_version]] as [string, string][]) : []),
    ["Effective date", carried.effective_date ? fmtDate(carried.effective_date) : "Not stated"],
    ["Last approval or review", carried.last_approval_or_review ? fmtDate(carried.last_approval_or_review) : `None stated in ${carried.source_system}`],
    ["Next review due when carried over", carried.next_review_due ? fmtDate(carried.next_review_due) : `None set in ${carried.source_system}`],
    ...(carried.author ? ([["Author", carried.author]] as [string, string][]) : []),
    [
      "Signatures on the face page",
      signatures === 0 ? "None listed" : `${carried.approval_rows} approval, ${carried.review_rows} periodic review`,
    ],
    ...(carried.source_manual ? ([[`Filed in ${carried.source_system} under`, carried.source_manual]] as [string, string][]) : []),
    ...(carried.also_filed_in.length ? ([["Also filed there under", carried.also_filed_in.join("; ")]] as [string, string][]) : []),
    ...(carried.title_as_exported && carried.title_as_exported !== title
      ? ([[`Title in ${carried.source_system}`, carried.title_as_exported]] as [string, string][])
      : []),
  ];

  return (
    <div className="rounded border bg-muted/30 p-2 text-xs space-y-2" data-testid="carried-over-panel">
      <div className="font-medium flex items-center gap-1">
        <FileClock size={14} /> Carried over from {carried.source_system}
      </div>
      <p data-testid="carried-over-notice">{carriedOverNotice(carried.source_system)}</p>
      {!carried.is_current_version && (
        <p className="text-muted-foreground">
          This history belongs to version {carried.source_version}. Later versions carry their own signatures in VeritaDC&trade;.
        </p>
      )}
      <dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground">
        Loaded into VeritaDC&trade; on {fmtDate(carried.loaded_at)}
        {carried.loaded_by ? ` by ${carried.loaded_by}` : ""}
        {carried.owner_name ? `. Document owner: ${carried.owner_name}` : ""}.
        {carried.converted_from &&
          ` The ${carried.source_system} file was .${carried.converted_from}, so it was converted for VeritaDC™ and the original is kept.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {carried.has_face_page && (
          <Button size="sm" variant="outline" className="h-7" onClick={toggleFacePage} data-testid="carried-face-page-button">
            {faceLoading ? <Loader2 size={12} className="mr-1 animate-spin" /> : <FileClock size={12} className="mr-1" />}
            {faceOpen ? "Hide signature face page" : "Open signature face page"}
          </Button>
        )}
        {carried.has_original && originalUrl && (
          <Button size="sm" variant="outline" className="h-7" onClick={downloadOriginal} data-testid="carried-original-button">
            <Download size={12} className="mr-1" /> Download original
          </Button>
        )}
      </div>
      {problem && <p className="text-red-700 dark:text-red-400">{problem}</p>}
      {faceOpen && faceHtml && (
        <iframe
          title={`Signature face page: ${title}`}
          srcDoc={faceHtml}
          sandbox=""
          className="w-full h-[60vh] border rounded bg-white"
          data-testid="carried-face-page-frame"
        />
      )}
    </div>
  );
}
