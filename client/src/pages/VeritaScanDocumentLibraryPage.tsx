// VeritaScan™ Evidence Library (Phase A, 2026-06-02)
//
// URL-pointers-only document library per the locked architectural decision
// (see project_veritascan_url_pointers_only memory entry). No file uploads.
// The lab links external URLs (SharePoint, Drive, OneDrive, network share,
// etc.) and VeritaScan stores only metadata + the URL.
//
// Phase A scope:
//   - Library table (filter by type, search by title/description)
//   - Add document modal (title, type, display label, external URL,
//     storage provider, version, effective date, review due date)
//   - Edit document drawer with archive action
//   - Settings tab for per-type review-window defaults
//
// Phase B (checklist linking) and Phase C (Inspection Proof view) ship
// separately. The detail drawer carries a placeholder "Linked checklist
// items" section that Phase B fills in.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { authHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ExternalLink, Archive, Pencil, Plus, Search } from "lucide-react";

const API_BASE = "";

const DOC_TYPES = [
  { value: "policy",            label: "Policy" },
  { value: "procedure",         label: "Procedure" },
  { value: "training_record",   label: "Training Record" },
  { value: "competency",        label: "Competency Assessment" },
  { value: "validation_study",  label: "Validation Study" },
  { value: "equipment_log",     label: "Equipment Log" },
  { value: "regulatory_record", label: "Regulatory Record" },
  { value: "other",             label: "Other" },
] as const;

const STORAGE_PROVIDERS = [
  { value: "sharepoint",     label: "SharePoint" },
  { value: "google_drive",   label: "Google Drive" },
  { value: "onedrive",       label: "OneDrive" },
  { value: "network_share",  label: "Network Share" },
  { value: "dropbox",        label: "Dropbox" },
  { value: "box",            label: "Box" },
  { value: "internal_url",   label: "Internal URL" },
  { value: "other",          label: "Other" },
] as const;

const DOC_TYPE_LABEL_MAP = Object.fromEntries(DOC_TYPES.map(t => [t.value, t.label]));

interface LabDocument {
  id: number;
  lab_id: number;
  title: string;
  description: string | null;
  document_type: string;
  display_label: string | null;
  external_url: string;
  storage_provider: string | null;
  version: string | null;
  status: string;
  superseded_by_document_id: number | null;
  effective_date: string | null;
  review_due_date: string | null;
  linked_at: string;
  linked_by_user_id: number;
}

interface TypeDefault {
  document_type: string;
  default_review_days: number | null;
}

function humanizeType(value: string): string {
  return DOC_TYPE_LABEL_MAP[value] || value;
}

function reviewStatus(due: string | null): { tone: "ok" | "amber" | "red" | "none"; label: string } {
  if (!due) return { tone: "none", label: "No review set" };
  const dueDate = new Date(due + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysOut = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysOut < 0) return { tone: "red", label: `${-daysOut} day${daysOut === -1 ? "" : "s"} overdue` };
  if (daysOut <= 30) return { tone: "amber", label: `Due in ${daysOut} day${daysOut === 1 ? "" : "s"}` };
  return { tone: "ok", label: `Due ${due}` };
}

export default function VeritaScanDocumentLibraryPage() {
  const labId = useActiveLabId();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [filterType, setFilterType] = useState<string>("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<LabDocument | null>(null);

  const docsQuery = useQuery<LabDocument[]>({
    queryKey: [`/api/labs/${labId}/veritascan/documents`, filterType, includeArchived, searchQ],
    enabled: !!labId,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterType !== "all") params.set("type", filterType);
      if (includeArchived) params.set("include_archived", "1");
      if (searchQ.trim()) params.set("q", searchQ.trim());
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritascan/documents?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
      return res.json();
    },
  });

  const defaultsQuery = useQuery<TypeDefault[]>({
    queryKey: [`/api/labs/${labId}/veritascan/document-type-defaults`],
    enabled: !!labId,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritascan/document-type-defaults`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load defaults (${res.status})`);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, any>) => {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritascan/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Create failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Document added" });
      qc.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritascan/documents`] });
      setAddOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Could not add document", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Record<string, any> }) => {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritascan/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Update failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Document updated" });
      qc.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritascan/documents`] });
      setEditDoc(null);
    },
    onError: (err: Error) => {
      toast({ title: "Could not update document", description: err.message, variant: "destructive" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritascan/documents/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Archive failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Document archived" });
      qc.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritascan/documents`] });
      setEditDoc(null);
    },
    onError: (err: Error) => {
      toast({ title: "Could not archive document", description: err.message, variant: "destructive" });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async ({ type, days }: { type: string; days: number | null }) => {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritascan/document-type-defaults/${type}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ default_review_days: days }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Update default failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritascan/document-type-defaults`] });
      toast({ title: "Default updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not update default", description: err.message, variant: "destructive" });
    },
  });

  const docs = docsQuery.data || [];
  const defaults = defaultsQuery.data || [];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">VeritaScan™ Evidence Library</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Link external documents that satisfy your accreditation checklists. URLs only — files stay in your SharePoint, Drive, OneDrive, or network share.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} data-testid="button-add-document">
          <Plus size={14} className="mr-1.5" />Add Document
        </Button>
      </div>

      <Tabs defaultValue="library">
        <TabsList>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="settings">Review-Cadence Defaults</TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="mt-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <Search size={14} className="text-muted-foreground" />
                  <Input
                    placeholder="Search title / description"
                    value={searchQ}
                    onChange={e => setSearchQ(e.target.value)}
                    className="h-9 w-64"
                    data-testid="input-search-documents"
                  />
                </div>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="h-9 w-56"><SelectValue placeholder="All types" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {DOC_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={includeArchived} onChange={e => setIncludeArchived(e.target.checked)} />
                  Include archived
                </label>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left py-2 pr-3">Document</th>
                      <th className="text-left py-2 pr-3">Type</th>
                      <th className="text-left py-2 pr-3">Storage</th>
                      <th className="text-left py-2 pr-3">Version</th>
                      <th className="text-left py-2 pr-3">Effective</th>
                      <th className="text-left py-2 pr-3">Review</th>
                      <th className="text-left py-2 pr-3">Status</th>
                      <th className="text-right py-2 pr-3">Open</th>
                      <th className="text-right py-2 pr-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.length === 0 && (
                      <tr><td colSpan={9} className="text-center py-8 text-sm text-muted-foreground">
                        No documents yet. Click <strong>Add Document</strong> to link your first one.
                      </td></tr>
                    )}
                    {docs.map(doc => {
                      const rs = reviewStatus(doc.review_due_date);
                      return (
                        <tr key={doc.id} className="border-b border-border/40 hover:bg-muted/40">
                          <td className="py-2 pr-3">
                            <div className="font-medium">{doc.display_label || doc.title}</div>
                            {doc.display_label && doc.display_label !== doc.title && (
                              <div className="text-xs text-muted-foreground">{doc.title}</div>
                            )}
                          </td>
                          <td className="py-2 pr-3"><Badge variant="outline">{humanizeType(doc.document_type)}</Badge></td>
                          <td className="py-2 pr-3 text-xs">{doc.storage_provider ? (STORAGE_PROVIDERS.find(s => s.value === doc.storage_provider)?.label ?? doc.storage_provider) : "—"}</td>
                          <td className="py-2 pr-3 text-xs">{doc.version || "—"}</td>
                          <td className="py-2 pr-3 text-xs">{doc.effective_date || "—"}</td>
                          <td className="py-2 pr-3 text-xs">
                            <span className={
                              rs.tone === "red" ? "text-red-600 dark:text-red-400 font-medium"
                              : rs.tone === "amber" ? "text-amber-600 dark:text-amber-400 font-medium"
                              : "text-muted-foreground"
                            }>{rs.label}</span>
                          </td>
                          <td className="py-2 pr-3">
                            {doc.status === "active"
                              ? <Badge className="bg-green-500/10 text-green-400 border-green-500/30 border">Active</Badge>
                              : doc.status === "superseded"
                                ? <Badge variant="outline">Superseded</Badge>
                                : doc.status === "draft"
                                  ? <Badge variant="outline">Draft</Badge>
                                  : <Badge variant="outline" className="text-muted-foreground">Archived</Badge>}
                          </td>
                          <td className="py-2 pr-3 text-right">
                            <a href={doc.external_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-primary hover:underline text-xs" data-testid={`link-open-${doc.id}`}>
                              <ExternalLink size={12} className="mr-1" />Open
                            </a>
                          </td>
                          <td className="py-2 pr-3 text-right">
                            <Button variant="ghost" size="sm" onClick={() => setEditDoc(doc)} data-testid={`button-edit-${doc.id}`}>
                              <Pencil size={13} />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Per-Type Review-Cadence Defaults</CardTitle></CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-4">
                Set a default review window for each document type. New documents auto-fill the review-due date based on these defaults. Leave a field blank to disable the default for that type. Lab admins can still override on individual documents.
              </p>
              <div className="space-y-2">
                {DOC_TYPES.map(t => {
                  const current = defaults.find(d => d.document_type === t.value);
                  return (
                    <DefaultRow
                      key={t.value}
                      typeValue={t.value}
                      typeLabel={t.label}
                      initialDays={current?.default_review_days ?? null}
                      onSave={(days) => setDefaultMutation.mutate({ type: t.value, days })}
                    />
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AddDocumentDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={(body) => createMutation.mutate(body)}
        pending={createMutation.isPending}
      />

      {editDoc && (
        <EditDocumentDialog
          doc={editDoc}
          onClose={() => setEditDoc(null)}
          onSubmit={(body) => updateMutation.mutate({ id: editDoc.id, body })}
          onArchive={() => archiveMutation.mutate(editDoc.id)}
          pending={updateMutation.isPending || archiveMutation.isPending}
        />
      )}
    </div>
  );
}

function DefaultRow({ typeValue, typeLabel, initialDays, onSave }: {
  typeValue: string;
  typeLabel: string;
  initialDays: number | null;
  onSave: (days: number | null) => void;
}) {
  const [val, setVal] = useState<string>(initialDays !== null ? String(initialDays) : "");
  useEffect(() => { setVal(initialDays !== null ? String(initialDays) : ""); }, [initialDays]);
  const dirty = (initialDays ?? null) !== (val.trim() === "" ? null : Number(val));
  return (
    <div className="flex items-center gap-3">
      <Label className="text-sm w-48">{typeLabel}</Label>
      <Input
        type="number"
        min={0}
        max={3650}
        value={val}
        onChange={e => setVal(e.target.value)}
        className="h-8 w-32 text-sm"
        placeholder="days"
        data-testid={`input-default-${typeValue}`}
      />
      <span className="text-xs text-muted-foreground">days</span>
      <Button
        variant="outline"
        size="sm"
        disabled={!dirty}
        onClick={() => onSave(val.trim() === "" ? null : Number(val))}
        data-testid={`button-save-default-${typeValue}`}
      >
        Save
      </Button>
    </div>
  );
}

function AddDocumentDialog({ open, onClose, onSubmit, pending }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, any>) => void;
  pending: boolean;
}) {
  const [form, setForm] = useState({
    title: "",
    document_type: "policy",
    display_label: "",
    external_url: "",
    storage_provider: "",
    version: "",
    effective_date: "",
    review_due_date: "",
    description: "",
  });
  useEffect(() => {
    if (open) setForm({
      title: "", document_type: "policy", display_label: "", external_url: "",
      storage_provider: "", version: "", effective_date: "", review_due_date: "",
      description: "",
    });
  }, [open]);
  const canSubmit = form.title.trim() && form.external_url.trim();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Document</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Title *</Label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Critical Value Reporting Policy" data-testid="input-add-title" />
            </div>
            <div className="space-y-1">
              <Label>Document Type *</Label>
              <Select value={form.document_type} onValueChange={v => setForm({ ...form, document_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>External URL *</Label>
            <Input value={form.external_url} onChange={e => setForm({ ...form, external_url: e.target.value })} placeholder="https://yourorg.sharepoint.com/policies/critical-values.docx" data-testid="input-add-url" />
            <p className="text-xs text-muted-foreground">URL pointer to your document in SharePoint, Drive, OneDrive, or another store. VeritaAssure never stores the file itself.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Storage Provider</Label>
              <Select value={form.storage_provider || "none"} onValueChange={v => setForm({ ...form, storage_provider: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Pick one" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not specified</SelectItem>
                  {STORAGE_PROVIDERS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Display Label</Label>
              <Input value={form.display_label} onChange={e => setForm({ ...form, display_label: e.target.value })} placeholder="Override what appears in the library" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Version</Label>
              <Input value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} placeholder="3.2" />
            </div>
            <div className="space-y-1">
              <Label>Effective Date</Label>
              <Input type="date" value={form.effective_date} onChange={e => setForm({ ...form, effective_date: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Review Due</Label>
              <Input type="date" value={form.review_due_date} onChange={e => setForm({ ...form, review_due_date: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button
            onClick={() => onSubmit({
              ...form,
              storage_provider: form.storage_provider || null,
              display_label: form.display_label || null,
              version: form.version || null,
              effective_date: form.effective_date || null,
              review_due_date: form.review_due_date || null,
              description: form.description || null,
            })}
            disabled={!canSubmit || pending}
            data-testid="button-submit-add"
          >
            {pending ? "Adding..." : "Add Document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDocumentDialog({ doc, onClose, onSubmit, onArchive, pending }: {
  doc: LabDocument;
  onClose: () => void;
  onSubmit: (body: Record<string, any>) => void;
  onArchive: () => void;
  pending: boolean;
}) {
  const [form, setForm] = useState({
    title: doc.title,
    document_type: doc.document_type,
    display_label: doc.display_label || "",
    external_url: doc.external_url,
    storage_provider: doc.storage_provider || "",
    version: doc.version || "",
    effective_date: doc.effective_date || "",
    review_due_date: doc.review_due_date || "",
    description: doc.description || "",
    status: doc.status,
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Document</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Title</Label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Document Type</Label>
              <Select value={form.document_type} onValueChange={v => setForm({ ...form, document_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>External URL</Label>
            <Input value={form.external_url} onChange={e => setForm({ ...form, external_url: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Storage Provider</Label>
              <Select value={form.storage_provider || "none"} onValueChange={v => setForm({ ...form, storage_provider: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not specified</SelectItem>
                  {STORAGE_PROVIDERS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Display Label</Label>
              <Input value={form.display_label} onChange={e => setForm({ ...form, display_label: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Version</Label>
              <Input value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Effective Date</Label>
              <Input type="date" value={form.effective_date} onChange={e => setForm({ ...form, effective_date: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Review Due</Label>
              <Input type="date" value={form.review_due_date} onChange={e => setForm({ ...form, review_due_date: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </div>
          {/* Phase B placeholder */}
          <div className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
            Linked checklist items appear here once Phase B ships. For now, link manually in your QMS document.
          </div>
        </div>
        <DialogFooter className="justify-between">
          <Button variant="outline" onClick={onArchive} disabled={pending || doc.status === "archived"}>
            <Archive size={13} className="mr-1.5" />Archive
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button
              onClick={() => onSubmit({
                ...form,
                storage_provider: form.storage_provider || null,
                display_label: form.display_label || null,
                version: form.version || null,
                effective_date: form.effective_date || null,
                review_due_date: form.review_due_date || null,
                description: form.description || null,
              })}
              disabled={pending}
              data-testid="button-submit-edit"
            >
              {pending ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
