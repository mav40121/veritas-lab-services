// VeritaMaintain equipment: the types the screens share, and the small pieces they all use (files, a reason dialog, a document picker).
// Server: server/equipment.ts. Rules: shared/equipmentPm.ts.
import { useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { labDayOf } from "@/lib/labDate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Paperclip } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EQUIP_FILE_ACCEPT, EQUIP_FILE_KIND_LABEL, EQUIP_FILE_KINDS, EQUIP_FILE_MAX_MB, EQUIP_FILE_TYPES } from "@shared/equipmentPm";

export interface Equipment {
  id: number;
  instrument_name: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  location: string | null;
  pm_interval_days: number | null;
  next_due_date: string | null;
  status: string;
  notes: string | null;
  map_instrument_id?: number | null;
  maintenance_status: "overdue" | "due_soon" | "ok" | "none";
  placed_in_service_date?: string | null;
  removed_from_service_date?: string | null;
  removed_from_service_reason?: string | null;
  retired_at?: string | null;
  retired_by_name?: string | null;
  vendor_name?: string | null;
  service_contract?: string | null;
  ifu_url?: string | null;
  ifu_document_id?: number | null;
  moved_from_lab_name?: string | null;
  moved_to_lab_id?: number | null;
  moved_to_lab_name?: string | null;
  move_note?: string | null;
  out_of_service?: { id: number; down_from: string; reason: string } | null;
  awaiting_vendor_report?: number;
}

export interface EquipFile {
  id: number; event_id: number | null; kind: string; original_filename: string; file_size: number | null;
  uploaded_by_name: string | null; uploaded_at: string; removed_at: string | null; removed_by_name: string | null; removal_reason: string | null;
  carried_from_lab_name: string | null;
}

export interface MaintEvent {
  id: number; event_type: string; event_date: string; performed_by: string | null; next_due_date: string | null; notes: string | null; created_at: string;
  logged_by_user_id?: number | null; logged_by_name?: string | null; completes_pm?: number | null; pm_complete?: number | null; due_before?: string | null;
  cost?: number | null; by_vendor?: number | null; vendor_company?: string | null; vendor_technician?: string | null; vendor_report_attached?: number | null;
  correction_reason?: string | null; corrected_by_name?: string | null; corrected_at?: string | null;
  voided_at?: string | null; voided_by_name?: string | null; void_reason?: string | null; carried_from_lab_name?: string | null;
  files: EquipFile[]; earlier_versions: MaintEvent[];
}

export const equipmentApi = (labId: number | string) => `${API_BASE}/api/labs/${labId}/equipment`;

export async function sendJson(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const r = await fetch(url, { method, headers: { ...authHeaders(), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

export async function uploadFile(url: string, file: File, kind: string): Promise<{ ok: boolean; data: any }> {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", file);
  const r = await fetch(url, { method: "POST", headers: authHeaders(), body: fd });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

export async function downloadFile(url: string, filename: string): Promise<string | null> {
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) return (await r.json().catch(() => ({}))).error || "The file could not be downloaded";
  const href = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = href; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(href);
  return null;
}

const size = (n: number | null) => (n == null ? "" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Files on a record or an entry: download, and for an editor, remove with a reason. */
export function FileList({ files, base, canRemove, onChanged }: { files: EquipFile[]; base: string; canRemove: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [removing, setRemoving] = useState<EquipFile | null>(null);
  if (!files.length) return null;
  return (
    <ul className="space-y-1 mt-1">
      {files.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" data-testid={`equip-file-${f.id}`}>
          <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="font-medium">{EQUIP_FILE_KIND_LABEL[f.kind] ?? "File"}</span>
          {f.removed_at ? (
            <span className="text-muted-foreground"><span className="line-through">{f.original_filename}</span> removed {labDayOf(f.removed_at)}: {f.removal_reason}</span>
          ) : (
            <>
              <button
                type="button" className="underline text-primary break-all text-left inline-flex items-center gap-1"
                onClick={async () => { const err = await downloadFile(`${base}/${f.id}`, f.original_filename); if (err) toast({ title: err, variant: "destructive" }); }}
                data-testid={`equip-file-download-${f.id}`}
              ><Download className="h-3 w-3" />{f.original_filename}</button>
              <span className="text-muted-foreground">{[size(f.file_size), f.uploaded_by_name ? `added by ${f.uploaded_by_name}` : "", labDayOf(f.uploaded_at)].filter(Boolean).join(" · ")}</span>
              {canRemove && !f.carried_from_lab_name && <button type="button" className="text-muted-foreground hover:text-foreground underline" onClick={() => setRemoving(f)} data-testid={`equip-file-remove-${f.id}`}>Remove</button>}
            </>
          )}
        </li>
      ))}
      <ReasonDialog
        open={!!removing} title="Remove this file" confirmLabel="Remove file"
        description={`${removing?.original_filename ?? ""} is taken out of the record. The record keeps its name, who removed it and why.`}
        label="Why is it being removed" onClose={() => setRemoving(null)}
        onConfirm={async (reason) => {
          const r = await sendJson(`${base}/${removing!.id}/remove`, "POST", { reason });
          if (!r.ok) { toast({ title: r.data.error || "Could not remove the file", variant: "destructive" }); return false; }
          toast({ title: "File removed" }); onChanged(); return true;
        }}
      />
    </ul>
  );
}

/** Pick a kind and a file and send it. `onSent` gets the server's answer. */
export function AttachFile({ url, defaultKind = "service_report", onSent, testId }: { url: string; defaultKind?: string; onSent: (data: any) => void; testId?: string }) {
  const { toast } = useToast();
  const [kind, setKind] = useState(defaultKind);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function send() {
    if (!file) { toast({ title: "Choose a file", variant: "destructive" }); return; }
    if (file.size > EQUIP_FILE_MAX_MB * 1024 * 1024) { toast({ title: `The file is too large (the limit is ${EQUIP_FILE_MAX_MB} MB).`, variant: "destructive" }); return; }
    setBusy(true);
    try {
      const r = await uploadFile(url, file, kind);
      if (!r.ok) { toast({ title: r.data.error || "Could not attach the file", variant: "destructive" }); return; }
      toast({ title: "File attached", description: r.data.phiWarning || undefined, variant: r.data.phiWarning ? "destructive" : undefined });
      setFile(null); if (input.current) input.current.value = "";
      onSent(r.data);
    } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid={testId}>
      <div>
        <Label className="text-xs">Kind of file</Label>
        <select className="h-9 rounded-md border border-border bg-background px-2 text-sm block" value={kind} onChange={(e) => setKind(e.target.value)} data-testid={testId ? `${testId}-kind` : undefined}>
          {EQUIP_FILE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
      <div className="min-w-0 flex-1">
        <Label className="text-xs">File</Label>
        <Input ref={input} type="file" accept={EQUIP_FILE_ACCEPT} className="h-9 text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid={testId ? `${testId}-input` : undefined} />
      </div>
      <Button size="sm" variant="outline" onClick={send} disabled={busy || !file} data-testid={testId ? `${testId}-send` : undefined}>{busy ? "Attaching..." : "Attach"}</Button>
      <p className="w-full text-[11px] text-muted-foreground">{EQUIP_FILE_TYPES}, up to {EQUIP_FILE_MAX_MB} MB. No patient information.</p>
    </div>
  );
}

/** A confirmation that needs a reason. `onConfirm` answers true to close. Extra fields go in `children`. */
export function ReasonDialog({ open, title, description, label, confirmLabel, destructive, children, onConfirm, onClose, testId = "reason-dialog" }: {
  open: boolean; title: string; description: string; label: string; confirmLabel: string; destructive?: boolean; children?: React.ReactNode;
  onConfirm: (reason: string) => Promise<boolean>; onClose: () => void; testId?: string;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setReason(""); }, [open]);
  async function go() {
    if (!reason.trim()) { toast({ title: "Enter the reason", variant: "destructive" }); return; }
    setBusy(true);
    try { if (await onConfirm(reason.trim())) onClose(); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <div>
          <Label>{label} <span className="text-red-600">*</span></Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`${testId}-reason`} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={go} disabled={busy} data-testid={`${testId}-confirm`}>{busy ? "Saving..." : confirmLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface PickDoc { id: number; title: string; doc_number?: string | null; status: string }

/** One of the lab's VeritaDC documents, or none. The list loads when the picker is opened. */
export function DocumentPicker({ labId, value, valueLabel, onChange, testId }: { labId: number; value: number | null; valueLabel?: string | null; onChange: (id: number | null, doc?: PickDoc) => void; testId: string }) {
  const [docs, setDocs] = useState<PickDoc[] | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [label, setLabel] = useState<string | null>(valueLabel ?? null);
  useEffect(() => { setLabel(valueLabel ?? null); }, [valueLabel]);
  useEffect(() => {
    if (!open || docs) return;
    fetch(`${API_BASE}/api/labs/${labId}/veritapolicy/documents`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { documents: [] }))
      .then((j) => setDocs((j.documents || []) as PickDoc[]))
      .catch(() => setDocs([]));
  }, [open, docs, labId]);
  const q = search.trim().toLowerCase();
  const shown = (docs ?? []).filter((d) => !q || d.title.toLowerCase().includes(q) || String(d.doc_number || "").toLowerCase().includes(q)).slice(0, 50);
  const name = (d: PickDoc) => `${d.doc_number ? `${d.doc_number} ` : ""}${d.title}`;
  return (
    <div data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={value ? "" : "text-muted-foreground"} data-testid={`${testId}-value`}>{value ? label || `Document ${value}` : "None"}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen((o) => !o)} data-testid={`${testId}-open`}>{open ? "Close list" : value ? "Change" : "Choose"}</Button>
        {value ? <Button type="button" size="sm" variant="ghost" onClick={() => { onChange(null); setLabel(null); }} data-testid={`${testId}-clear`}>Remove</Button> : null}
      </div>
      {open && (
        <div className="mt-2">
          <Input placeholder="Search this lab's documents" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-sm" data-testid={`${testId}-search`} />
          <div className="max-h-40 overflow-y-auto border border-border rounded-md divide-y divide-border mt-1">
            {docs === null && <div className="p-2 text-xs text-muted-foreground">Loading documents...</div>}
            {docs !== null && shown.length === 0 && <div className="p-2 text-xs text-muted-foreground">No documents in VeritaDC™ match.</div>}
            {shown.map((d) => (
              <button type="button" key={d.id} className="w-full text-left p-2 text-sm hover:bg-muted/50" onClick={() => { onChange(d.id, d); setLabel(name(d)); setOpen(false); }} data-testid={`${testId}-doc-${d.id}`}>
                {name(d)} <span className="text-[11px] text-muted-foreground">{d.status.replace(/_/g, " ")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
