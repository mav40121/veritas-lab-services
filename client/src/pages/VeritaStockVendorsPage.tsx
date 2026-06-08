// VeritaStockVendorsPage.tsx
//
// Vendor directory for VeritaStock (PR 2 of the 6-PR vendor management
// build). Lists the lab's vendors with name, account #, ordering pattern,
// and contact count. Add/edit dialog for vendor fields. Per-vendor
// expand row shows the contacts editor (name + role + email/phone +
// add/remove). Lab-scoped via useActiveLabId; reads /api/labs/:labId/
// veritastock/vendors from PR 1.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Plus, Trash2, Pencil, ChevronDown, ChevronRight, Users, Upload,
} from "lucide-react";

interface Vendor {
  id: number;
  lab_id: number;
  name: string;
  account_number: string | null;
  po_number: string | null;
  ordering_pattern: string | null;
  ordering_email: string | null;
  ordering_phone: string | null;
  ordering_fax: string | null;
  ordering_portal_url: string | null;
  order_tracking_url: string | null;
  notes: string | null;
  status: string;
  contact_count?: number;
}

interface VendorContact {
  id: number;
  vendor_id: number;
  contact_name: string;
  contact_role: string | null;
  title: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  region: string | null;
  notes: string | null;
  sort_order: number;
}

export default function VeritaStockVendorsPage() {
  const activeLabId = useActiveLabId();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const listUrl = activeLabId ? `/api/labs/${activeLabId}/veritastock/vendors` : null;
  const { data: vendors = [], refetch } = useQuery<Vendor[]>({
    queryKey: [listUrl ?? "no-vendors-url"],
    queryFn: async () => {
      if (!listUrl) return [];
      const r = await fetch(`${API_BASE}${listUrl}`, { headers: authHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!listUrl,
  });

  const filtered = vendors.filter((v) =>
    !search.trim() ||
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    (v.account_number || "").toLowerCase().includes(search.toLowerCase()),
  );

  const onAddClick = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const onEditClick = (v: Vendor) => {
    setEditing(v);
    setEditorOpen(true);
  };

  const onDelete = async (v: Vendor) => {
    if (!activeLabId) return;
    if (!window.confirm(`Delete vendor "${v.name}" and all its contacts? This cannot be undone.`)) return;
    await fetch(`${API_BASE}/api/labs/${activeLabId}/veritastock/vendors/${v.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    qc.invalidateQueries({ queryKey: [listUrl] });
  };

  return (
    <div className="container-default py-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <Link href={activeLabId ? `/labs/${activeLabId}/veritastock` : "/veritastock"} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
            <ArrowLeft size={12} /> Back to VeritaStock
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users size={20} className="text-primary" />
            Vendor Directory
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-vendor account numbers, ordering channels, and contact tracks. The Order PDF auto-fills its cover page from these records so a generated order is actionable on receipt.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)} disabled={!activeLabId}>
            <Upload size={14} className="mr-1.5" /> Import xlsx
          </Button>
          <Button onClick={onAddClick} disabled={!activeLabId}>
            <Plus size={14} className="mr-1.5" /> Add Vendor
          </Button>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <Input
          placeholder="Search by name or account number"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="text-xs text-muted-foreground">
          {filtered.length} of {vendors.length}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {vendors.length === 0
              ? "No vendors yet. Click Add Vendor to enter one, or use the import path (PR 3) to bulk-load from an xlsx."
              : "No vendors match this search."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((v) => (
            <VendorRow
              key={v.id}
              vendor={v}
              expanded={expandedId === v.id}
              onToggle={() => setExpandedId(expandedId === v.id ? null : v.id)}
              onEdit={() => onEditClick(v)}
              onDelete={() => onDelete(v)}
              listUrl={listUrl ?? ""}
            />
          ))}
        </div>
      )}

      <VendorEditorDialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        vendor={editing}
        labId={activeLabId}
        onSaved={() => {
          setEditorOpen(false);
          refetch();
        }}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        labId={activeLabId}
        onCommitted={() => {
          setImportOpen(false);
          refetch();
        }}
      />
    </div>
  );
}

// Two-step xlsx import: file picker -> preview (dry-run) -> commit.
// The preview lets the director see what will be created vs. skipped
// before the write actually happens, so a wrong file selection
// doesn't pollute their directory.
function ImportDialog({
  open, onClose, labId, onCommitted,
}: {
  open: boolean;
  onClose: () => void;
  labId: number | null;
  onCommitted: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [committing, setCommitting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setFile(null);
      setPreview(null);
      setErr("");
    }
  }, [open]);

  const runPreview = async () => {
    if (!labId || !file) return;
    setPreviewing(true);
    setErr("");
    setPreview(null);
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`${API_BASE}/api/labs/${labId}/veritastock/vendors/import/preview`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    });
    setPreviewing(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || `HTTP ${r.status}`);
      return;
    }
    setPreview(await r.json());
  };

  const runCommit = async () => {
    if (!labId || !file) return;
    setCommitting(true);
    setErr("");
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`${API_BASE}/api/labs/${labId}/veritastock/vendors/import/commit`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    });
    setCommitting(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || `HTTP ${r.status}`);
      return;
    }
    onCommitted();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Vendors from xlsx</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Expected columns (case-insensitive header row): VENDOR, PO, ordering pattern, account, POINT OF CONTACT. Idempotent on commit: any vendor whose name already exists in this lab is skipped. Maximum file size 2 MB.
          </div>
          <div>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
              }}
              className="block text-sm"
            />
          </div>
          {file && !preview && (
            <Button onClick={runPreview} disabled={previewing || !labId}>
              {previewing ? "Parsing..." : "Run preview (dry run)"}
            </Button>
          )}
          {preview && (
            <div className="rounded border border-border p-3 space-y-2 text-sm">
              <div className="font-semibold">Preview</div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground">Parsed</div>
                  <div className="text-lg font-bold">{preview.summary.total_parsed}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Would create</div>
                  <div className="text-lg font-bold text-emerald-700">{preview.summary.would_create}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Would skip (duplicate)</div>
                  <div className="text-lg font-bold text-amber-700">{preview.summary.would_skip_duplicate}</div>
                </div>
              </div>
              {preview.parse_errors?.length > 0 && (
                <div className="text-xs text-red-700">
                  {preview.parse_errors.length} parse error(s). The bad rows will be skipped on commit.
                </div>
              )}
              <div className="max-h-60 overflow-y-auto rounded border border-border/40 text-xs">
                <table className="w-full">
                  <thead className="bg-secondary sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1">Vendor</th>
                      <th className="text-left px-2 py-1">Account</th>
                      <th className="text-left px-2 py-1">Contacts</th>
                      <th className="text-left px-2 py-1">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.vendors.slice(0, 50).map((v: any, i: number) => (
                      <tr key={`${v.name}-${i}`} className="border-t border-border/30">
                        <td className="px-2 py-1">{v.name}</td>
                        <td className="px-2 py-1 text-muted-foreground">{v.account_number || ""}</td>
                        <td className="px-2 py-1 text-muted-foreground">{v.contacts?.length ?? 0}</td>
                        <td className="px-2 py-1">
                          {v.action === "create" ? (
                            <span className="text-emerald-700">create</span>
                          ) : (
                            <span className="text-amber-700">skip (duplicate)</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {err && <div className="text-xs text-red-600">{err}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {preview && (
            <Button onClick={runCommit} disabled={committing || !file}>
              {committing ? "Committing..." : `Commit ${preview.summary.would_create} new vendor(s)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VendorRow({
  vendor, expanded, onToggle, onEdit, onDelete, listUrl,
}: {
  vendor: Vendor;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  listUrl: string;
}) {
  const activeLabId = useActiveLabId();
  const qc = useQueryClient();
  const detailUrl = activeLabId ? `/api/labs/${activeLabId}/veritastock/vendors/${vendor.id}` : null;

  const { data: detail } = useQuery<Vendor & { contacts: VendorContact[] }>({
    queryKey: [detailUrl ?? "no-vendor-detail"],
    queryFn: async () => {
      if (!detailUrl) throw new Error("no lab");
      const r = await fetch(`${API_BASE}${detailUrl}`, { headers: authHeaders() });
      if (!r.ok) throw new Error("fetch failed");
      return r.json();
    },
    enabled: expanded && !!detailUrl,
  });

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onToggle}
            className="text-muted-foreground hover:text-foreground p-1"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{vendor.name}</span>
              {vendor.account_number && (
                <span className="text-xs text-muted-foreground">Acct {vendor.account_number}</span>
              )}
              {vendor.ordering_pattern && (
                <Badge variant="outline" className="text-[10px]">{vendor.ordering_pattern}</Badge>
              )}
              {typeof vendor.contact_count === "number" && vendor.contact_count > 0 && (
                <Badge variant="outline" className="text-[10px] bg-secondary">
                  {vendor.contact_count} contact{vendor.contact_count === 1 ? "" : "s"}
                </Badge>
              )}
              {vendor.status === "archived" && (
                <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">archived</Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
              {vendor.po_number && <span>PO {vendor.po_number}</span>}
              {vendor.ordering_email && <span>{vendor.ordering_email}</span>}
              {vendor.ordering_phone && <span>{vendor.ordering_phone}</span>}
              {vendor.ordering_portal_url && (
                <a href={vendor.ordering_portal_url} target="_blank" rel="noopener noreferrer" className="hover:text-primary truncate max-w-[280px]">
                  {vendor.ordering_portal_url}
                </a>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 px-2">
            <Pencil size={12} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} className="h-7 px-2 text-destructive hover:text-destructive">
            <Trash2 size={12} />
          </Button>
        </div>

        {expanded && (
          <div className="mt-3 pl-7 border-t border-border/50 pt-3">
            <div className="text-xs font-semibold text-muted-foreground mb-2">Contacts</div>
            <ContactsEditor
              vendorId={vendor.id}
              labId={activeLabId}
              contacts={detail?.contacts ?? []}
              onChanged={() => {
                qc.invalidateQueries({ queryKey: [detailUrl] });
                qc.invalidateQueries({ queryKey: [listUrl] });
              }}
            />
            {vendor.notes && (
              <div className="mt-3">
                <div className="text-xs font-semibold text-muted-foreground mb-1">Notes</div>
                <div className="text-xs whitespace-pre-wrap text-foreground/80">{vendor.notes}</div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ContactsEditor({
  vendorId, labId, contacts, onChanged,
}: {
  vendorId: number;
  labId: number | null;
  contacts: VendorContact[];
  onChanged: () => void;
}) {
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<VendorContact | null>(null);

  const onDelete = async (c: VendorContact) => {
    if (!labId) return;
    if (!window.confirm(`Delete contact "${c.contact_name}"?`)) return;
    await fetch(`${API_BASE}/api/labs/${labId}/veritastock/vendors/${vendorId}/contacts/${c.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    onChanged();
  };

  return (
    <div className="space-y-2">
      {contacts.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">No contacts on file. Add one below.</div>
      ) : (
        contacts.map((c) => (
          <div key={c.id} className="flex items-center gap-2 text-xs rounded border border-border/40 px-2 py-1.5">
            <div className="flex-1 min-w-0">
              <div className="font-medium">
                {c.contact_name}
                {c.contact_role && <span className="text-muted-foreground ml-1.5">({c.contact_role})</span>}
              </div>
              <div className="text-muted-foreground flex gap-3 flex-wrap">
                {c.title && <span>{c.title}</span>}
                {c.email && <span>{c.email}</span>}
                {c.phone && <span>{c.phone}</span>}
                {c.mobile && <span>m {c.mobile}</span>}
                {c.region && <span>{c.region}</span>}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditing(c)} className="h-6 px-1.5">
              <Pencil size={10} />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDelete(c)} className="h-6 px-1.5 text-destructive hover:text-destructive">
              <Trash2 size={10} />
            </Button>
          </div>
        ))
      )}
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setNewOpen(true)} disabled={!labId}>
        <Plus size={11} /> Add contact
      </Button>

      <ContactEditorDialog
        open={newOpen || editing !== null}
        contact={editing}
        vendorId={vendorId}
        labId={labId}
        onClose={() => { setNewOpen(false); setEditing(null); }}
        onSaved={() => { setNewOpen(false); setEditing(null); onChanged(); }}
      />
    </div>
  );
}

function VendorEditorDialog({
  open, onClose, vendor, labId, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  vendor: Vendor | null;
  labId: number | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [orderingPattern, setOrderingPattern] = useState("");
  const [orderingEmail, setOrderingEmail] = useState("");
  const [orderingPhone, setOrderingPhone] = useState("");
  const [orderingFax, setOrderingFax] = useState("");
  const [orderingPortalUrl, setOrderingPortalUrl] = useState("");
  const [orderTrackingUrl, setOrderTrackingUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Reset form when dialog opens with a new context. useEffect (not
  // useState) so it re-fires when the user clicks Edit on a different
  // vendor row without unmounting the dialog component.
  useEffect(() => {
    if (open) {
      setName(vendor?.name ?? "");
      setAccountNumber(vendor?.account_number ?? "");
      setPoNumber(vendor?.po_number ?? "");
      setOrderingPattern(vendor?.ordering_pattern ?? "");
      setOrderingEmail(vendor?.ordering_email ?? "");
      setOrderingPhone(vendor?.ordering_phone ?? "");
      setOrderingFax(vendor?.ordering_fax ?? "");
      setOrderingPortalUrl(vendor?.ordering_portal_url ?? "");
      setOrderTrackingUrl(vendor?.order_tracking_url ?? "");
      setNotes(vendor?.notes ?? "");
      setStatus((vendor?.status as "active" | "archived") ?? "active");
      setErr("");
    }
  }, [open, vendor]);

  const onSave = async () => {
    if (!labId) return;
    if (!name.trim()) { setErr("Name is required"); return; }
    setSaving(true);
    setErr("");
    const body = {
      name: name.trim(),
      account_number: accountNumber.trim() || null,
      po_number: poNumber.trim() || null,
      ordering_pattern: orderingPattern.trim() || null,
      ordering_email: orderingEmail.trim() || null,
      ordering_phone: orderingPhone.trim() || null,
      ordering_fax: orderingFax.trim() || null,
      ordering_portal_url: orderingPortalUrl.trim() || null,
      order_tracking_url: orderTrackingUrl.trim() || null,
      notes: notes.trim() || null,
      status,
    };
    const url = vendor
      ? `${API_BASE}/api/labs/${labId}/veritastock/vendors/${vendor.id}`
      : `${API_BASE}/api/labs/${labId}/veritastock/vendors`;
    const r = await fetch(url, {
      method: vendor ? "PUT" : "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || `HTTP ${r.status}`);
      return;
    }
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{vendor ? "Edit Vendor" : "Add Vendor"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Labelled label="Vendor name (required)">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Labelled>
          <div className="grid grid-cols-2 gap-3">
            <Labelled label="Account number">
              <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="e.g. 2100035105" />
            </Labelled>
            <Labelled label="PO number">
              <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g. PO-00010395" />
            </Labelled>
          </div>
          <Labelled label="Ordering pattern">
            <Input
              value={orderingPattern}
              onChange={(e) => setOrderingPattern(e.target.value)}
              placeholder="as needed / standing order / threshold obligation / every 6 months"
            />
          </Labelled>
          <div className="grid grid-cols-2 gap-3">
            <Labelled label="Ordering email">
              <Input value={orderingEmail} onChange={(e) => setOrderingEmail(e.target.value)} placeholder="orders@vendor.com" />
            </Labelled>
            <Labelled label="Ordering phone">
              <Input value={orderingPhone} onChange={(e) => setOrderingPhone(e.target.value)} placeholder="e.g. 1-800-555-0100" />
            </Labelled>
            <Labelled label="Ordering fax">
              <Input value={orderingFax} onChange={(e) => setOrderingFax(e.target.value)} />
            </Labelled>
            <Labelled label="Ordering portal URL">
              <Input value={orderingPortalUrl} onChange={(e) => setOrderingPortalUrl(e.target.value)} placeholder="https://" />
            </Labelled>
          </div>
          <Labelled label="Order-tracking URL">
            <Input value={orderTrackingUrl} onChange={(e) => setOrderTrackingUrl(e.target.value)} placeholder="https://" />
          </Labelled>
          <Labelled label="Notes">
            <textarea
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything quirky about ordering from this vendor (cutoff times, delivery quirks, contract references)."
            />
          </Labelled>
          <Labelled label="Status">
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as "active" | "archived")}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </Labelled>
          {err && <div className="text-xs text-red-600">{err}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={saving || !name.trim()}>
            {saving ? "Saving..." : vendor ? "Save changes" : "Add vendor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContactEditorDialog({
  open, onClose, contact, vendorId, labId, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  contact: VendorContact | null;
  vendorId: number;
  labId: number | null;
  onSaved: () => void;
}) {
  const [contactName, setContactName] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [region, setRegion] = useState("");
  const [notes, setNotes] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setContactName(contact?.contact_name ?? "");
      setContactRole(contact?.contact_role ?? "");
      setTitle(contact?.title ?? "");
      setPhone(contact?.phone ?? "");
      setMobile(contact?.mobile ?? "");
      setEmail(contact?.email ?? "");
      setRegion(contact?.region ?? "");
      setNotes(contact?.notes ?? "");
      setSortOrder(String(contact?.sort_order ?? 0));
      setErr("");
    }
  }, [open, contact]);

  const onSave = async () => {
    if (!labId) return;
    if (!contactName.trim()) { setErr("Contact name is required"); return; }
    setSaving(true);
    setErr("");
    const body = {
      contact_name: contactName.trim(),
      contact_role: contactRole.trim() || null,
      title: title.trim() || null,
      phone: phone.trim() || null,
      mobile: mobile.trim() || null,
      email: email.trim() || null,
      region: region.trim() || null,
      notes: notes.trim() || null,
      sort_order: Number(sortOrder) || 0,
    };
    const url = contact
      ? `${API_BASE}/api/labs/${labId}/veritastock/vendors/${vendorId}/contacts/${contact.id}`
      : `${API_BASE}/api/labs/${labId}/veritastock/vendors/${vendorId}/contacts`;
    const r = await fetch(url, {
      method: contact ? "PUT" : "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || `HTTP ${r.status}`);
      return;
    }
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "Add Contact"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Labelled label="Contact name (required)">
            <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </Labelled>
          <div className="grid grid-cols-2 gap-3">
            <Labelled label="Role">
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={contactRole}
                onChange={(e) => setContactRole(e.target.value)}
              >
                <option value="">Not specified</option>
                <option value="Sales rep">Sales rep</option>
                <option value="Customer service">Customer service</option>
                <option value="Tech support">Tech support</option>
                <option value="Orders inbox">Orders inbox</option>
                <option value="Account manager">Account manager</option>
                <option value="Contract services">Contract services</option>
                <option value="Other">Other</option>
              </select>
            </Labelled>
            <Labelled label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Account Executive" />
            </Labelled>
          </div>
          <Labelled label="Email">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </Labelled>
          <div className="grid grid-cols-2 gap-3">
            <Labelled label="Phone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Labelled>
            <Labelled label="Mobile">
              <Input value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </Labelled>
          </div>
          <Labelled label="Region or coverage">
            <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. AZ / NM / West region" />
          </Labelled>
          <Labelled label="Sort order">
            <Input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder="0 (default)" />
          </Labelled>
          <Labelled label="Notes">
            <textarea
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Labelled>
          {err && <div className="text-xs text-red-600">{err}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={saving || !contactName.trim()}>
            {saving ? "Saving..." : contact ? "Save changes" : "Add contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1">{label}</label>
      {children}
    </div>
  );
}
