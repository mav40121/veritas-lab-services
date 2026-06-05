// DocumentLinkDialog
//
// Shared linker for the URL-pointer document model added in PR C of the
// VeritaComp customer-blockers wave (2026-06-05). Two surfaces use this
// component identically:
//
//   1. VeritaComp NewAssessmentDialog / Assessments tab -> per-element
//      evidence documents (quiz scans, observation notes, QC records).
//   2. VeritaStaff EmployeeDetailView -> per-employee credentials
//      (state licenses, ASCP cards, diplomas, CE certificates).
//
// Per VeritaScan's locked URL-pointer architecture (2026-06-02), this
// dialog never accepts file bytes. The lab keeps the file in their own
// SharePoint/Drive/OneDrive and pastes the share URL here. We store
// metadata + URL only. This is what keeps VeritaAssure HIPAA-free.
//
// The doc_type select is configurable via the docTypes prop so the two
// surfaces can present their own allowlist (the server enforces the
// allowlist on POST).

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type DocLinkPayload = {
  docType: string;
  title: string;
  url: string;
  storageProvider: string;
  expirationDate: string;
};

export type DocTypeOption = { value: string; label: string };

const STORAGE_PROVIDERS: DocTypeOption[] = [
  { value: "sharepoint", label: "SharePoint" },
  { value: "onedrive", label: "OneDrive" },
  { value: "google_drive", label: "Google Drive" },
  { value: "dropbox", label: "Dropbox" },
  { value: "box", label: "Box" },
  { value: "other", label: "Other" },
];

export function DocumentLinkDialog({
  open,
  onOpenChange,
  title: dialogTitle,
  docTypes,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  docTypes: DocTypeOption[];
  onSubmit: (payload: DocLinkPayload) => Promise<void>;
}) {
  const [docType, setDocType] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [storageProvider, setStorageProvider] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setDocType(""); setTitle(""); setUrl(""); setStorageProvider(""); setExpirationDate(""); setError(null);
  }

  async function handleSubmit() {
    setError(null);
    if (!docType) { setError("Pick a document type."); return; }
    if (!url.trim()) { setError("Paste the URL to the linked file."); return; }
    if (!/^https?:\/\//i.test(url.trim())) { setError("URL must start with http:// or https://"); return; }
    setSubmitting(true);
    try {
      await onSubmit({
        docType,
        title: title.trim(),
        url: url.trim(),
        storageProvider,
        expirationDate: expirationDate.trim(),
      });
      reset();
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message || "Failed to link document.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <p className="text-xs text-muted-foreground">
            Link a document by URL. VeritaAssure does not upload or store file content; your file stays in your own SharePoint, Drive, OneDrive, or similar.
          </p>
          <div>
            <Label className="text-xs">Type *</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
              <SelectContent>
                {docTypes.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Title</Label>
            <Input placeholder="e.g. 2026 Chemistry Quiz, Pearson" value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">URL *</Label>
            <Input placeholder="https://..." value={url} onChange={e => setUrl(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Storage</Label>
              <Select value={storageProvider} onValueChange={setStorageProvider}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  {STORAGE_PROVIDERS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Expiration</Label>
              <Input type="date" value={expirationDate} onChange={e => setExpirationDate(e.target.value)} />
            </div>
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }} disabled={submitting}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Saving..." : "Link"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const COMP_DOC_TYPES: DocTypeOption[] = [
  { value: "quiz_scan", label: "Quiz scan" },
  { value: "observation_notes", label: "Observation notes" },
  { value: "qc_record", label: "QC record" },
  { value: "pt_report", label: "PT report" },
  { value: "blind_sample_record", label: "Blind sample record" },
  { value: "evidence_other", label: "Other evidence" },
];

export const STAFF_DOC_TYPES: DocTypeOption[] = [
  { value: "license", label: "State license" },
  { value: "diploma", label: "Diploma" },
  { value: "certification", label: "Certification" },
  { value: "training_certificate", label: "Training certificate" },
  { value: "ascp_card", label: "ASCP card" },
  { value: "ce_credit", label: "CE credit" },
  { value: "other", label: "Other" },
];

// Helper used by both surfaces to render an expiration badge / status.
export function expirationStatus(expirationDate?: string | null): { label: string; tone: "active" | "due_soon" | "expired" | "none" } {
  if (!expirationDate) return { label: "", tone: "none" };
  const now = new Date();
  const exp = new Date(expirationDate);
  if (Number.isNaN(exp.getTime())) return { label: "", tone: "none" };
  const days = Math.floor((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { label: `Expired ${expirationDate}`, tone: "expired" };
  if (days <= 30) return { label: `Expires ${expirationDate}`, tone: "due_soon" };
  return { label: `Expires ${expirationDate}`, tone: "active" };
}
