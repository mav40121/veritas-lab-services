// VeritaStockRecallsPage.tsx
//
// VeritaStock recall tracker (2026-10-08). One page, two views:
//   - list: every recall / product notification / device correction case for
//     the active location, open first, overdue flagged
//   - case (?case=<id>): intake details, stock on hand with the recalled lot
//     numbers across every location, pull stock by lot, files, notices to the
//     notification list, closeout checklist, sign-off, close, history
// Server: server/stockRecalls.ts (/api/labs/:labId/veritastock/recalls/*). The
// server enforces every gate (checklist, sign-off, close); this page mirrors.
// Copy rule: no lab wording anywhere on this page (VeritaStock is general
// supply inventory).

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft, Plus, ShieldAlert, Mail, Users, Trash2, Download, Upload, CheckCircle2, Circle,
  PackageX, Pencil, Send, Lock, History,
} from "lucide-react";

const NOTICE_TYPES = [
  { value: "recall", label: "Recall" },
  { value: "product_notification", label: "Product Notification" },
  { value: "device_correction", label: "Device Correction" },
  { value: "other", label: "Other" },
];

interface ChecklistItem { key: string; label: string; done: boolean }
interface RecallCase {
  id: number;
  notice_type: string;
  notice_type_label: string;
  notice_date: string | null;
  vendor: string;
  product: string;
  recall_number: string | null;
  lot_numbers: string[];
  details: string | null;
  assigned_user_id: number | null;
  assigned_name: string | null;
  opened_on: string;
  due_date: string;
  status: "open" | "closed";
  affected_summary: string | null;
  corrective_action: string | null;
  vendor_response_sent_on: string | null;
  vendor_response_not_required: number;
  intake_notified_at: string | null;
  closeout_notified_at: string | null;
  signoff_name: string | null;
  signoff_at: string | null;
  closed_at: string | null;
  checklist: ChecklistItem[];
  checklist_done: number;
  checklist_total: number;
  ready_for_signoff: boolean;
  ready_to_close: boolean;
  overdue: boolean;
  days_overdue: number;
}
interface LotMatch {
  source: "lot" | "item"; lot_id: number | null; item_id: number; item_name: string; catalog_number: string | null;
  item_vendor: string | null; vendor_matches: boolean; lot_number: string; expiration_date: string | null;
  quantity: number; unit: string | null; lab_id: number; lab_name: string; storage_location: string | null;
}
interface RecallDoc { id: number; kind: string; original_filename: string; download_name: string; file_size: number; uploaded_at: string }
interface RecallEvent { id: number; action: string; detail: string | null; created_at: string; user_name: string | null }
interface Recipient { id: number; name: string | null; email: string; role: string | null; active: number }
interface Assignee { id: number; name: string; email: string; role: string }
interface CaseDetail extends RecallCase {
  documents: RecallDoc[];
  events: RecallEvent[];
  matches: LotMatch[];
  recipients: Recipient[];
}

const localToday = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the viewer's timezone
const fmtDate = (ymd: string | null | undefined) => {
  if (!ymd) return "";
  const d = new Date(ymd.length === 10 ? ymd + "T12:00:00" : ymd);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};
const fmtWhen = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

async function api(path: string, init?: RequestInit & { json?: unknown }) {
  const headers: Record<string, string> = { ...authHeaders() };
  let body = init?.body;
  if (init?.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(init.json); }
  const r = await fetch(`${API_BASE}${path}`, { ...init, headers, body });
  let data: any = null;
  try { data = await r.json(); } catch { /* empty */ }
  // A non-JSON 200 (e.g. the app shell served for an unknown route) must not
  // reach the components as null.
  if (r.ok && data === null) throw new Error("The server returned an unexpected response. Reload and try again.");
  if (!r.ok) {
    const missing = Array.isArray(data?.missing) && data.missing.length ? ` Still open: ${data.missing.join("; ")}.` : "";
    throw new Error((data?.error || `Request failed (${r.status})`) + missing);
  }
  return data;
}

export default function VeritaStockRecallsPage() {
  const labId = useActiveLabId();
  const search = useSearch();
  const [, navigate] = useLocation();
  const caseId = Number(new URLSearchParams(search).get("case")) || null;
  const base = labId ? `/api/labs/${labId}/veritastock/recalls` : null;
  const pagePath = labId ? `/labs/${labId}/veritastock/recalls` : "/veritastock";
  const [listOpen, setListOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  return (
    <div className="container-default py-8 max-w-6xl mx-auto px-4">
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          {caseId ? (
            <Link href={pagePath} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
              <ArrowLeft size={12} /> All recalls
            </Link>
          ) : (
            <Link href={labId ? `/labs/${labId}/veritastock` : "/veritastock"} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
              <ArrowLeft size={12} /> Back to VeritaStock
            </Link>
          )}
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert size={20} className="text-primary" />
            Recalls
          </h1>
          {!caseId && (
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              Log a vendor recall, product notification or device correction once. VeritaStock finds the stock carrying those lot numbers at every location, sets the due date, emails your notification list, and holds the case open until every closeout step is done and signed off.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setListOpen(true)} disabled={!labId} data-testid="recall-notification-list-button">
            <Users size={14} className="mr-1.5" /> Notification list
          </Button>
          <Button onClick={() => setNewOpen(true)} disabled={!labId} data-testid="new-recall-button">
            <Plus size={14} className="mr-1.5" /> New recall
          </Button>
        </div>
      </div>

      {!labId ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Choose a location to see its recalls.</CardContent></Card>
      ) : caseId ? (
        <CaseView base={base!} caseId={caseId} />
      ) : (
        <CaseList base={base!} onOpen={(id) => navigate(`${pagePath}?case=${id}`)} />
      )}

      {base && <RecipientsDialog base={base} open={listOpen} onOpenChange={setListOpen} />}
      {base && (
        <CaseFormDialog
          base={base}
          open={newOpen}
          onOpenChange={setNewOpen}
          onCreated={(id) => { setNewOpen(false); navigate(`${pagePath}?case=${id}`); }}
        />
      )}
    </div>
  );
}

// ── List ──────────────────────────────────────────────────────────────────
function CaseList({ base, onOpen }: { base: string; onOpen: (id: number) => void }) {
  const [filter, setFilter] = useState<"open" | "closed" | "all">("open");
  const { data, isLoading, error } = useQuery<{ today: string; cases: RecallCase[] }>({
    queryKey: [base, "list"],
    queryFn: () => api(`${base}?today=${localToday()}`),
  });
  const cases = (data?.cases || []).filter((c) => filter === "all" || c.status === filter);
  const openN = (data?.cases || []).filter((c) => c.status === "open").length;
  const overdueN = (data?.cases || []).filter((c) => c.overdue).length;

  if (error) return <Card><CardContent className="p-6 text-sm text-destructive">{(error as Error).message}</CardContent></Card>;
  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="inline-flex rounded-md border overflow-hidden text-sm" role="tablist">
          {(["open", "closed", "all"] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 capitalize ${filter === f ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{f}</button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">{openN} open{overdueN > 0 && <>, <span className="text-red-600 dark:text-red-400 font-medium">{overdueN} overdue</span></>}</span>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Vendor / product</th>
                <th className="px-3 py-2">Recall #</th>
                <th className="px-3 py-2">Opened</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Assigned</th>
                <th className="px-3 py-2">Checklist</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Loading...</td></tr>}
              {!isLoading && cases.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  {filter === "open" ? "No open recalls. Use New recall when a vendor notice arrives." : "No recalls here yet."}
                </td></tr>
              )}
              {cases.map((c) => (
                <tr key={c.id} className="border-t hover:bg-muted/40 cursor-pointer" onClick={() => onOpen(c.id)} data-testid={`recall-row-${c.id}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{c.notice_type_label}</td>
                  <td className="px-3 py-2"><div className="font-medium">{c.vendor}</div><div className="text-muted-foreground">{c.product}</div></td>
                  <td className="px-3 py-2 whitespace-nowrap">{c.recall_number || ""}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(c.opened_on)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {fmtDate(c.due_date)}
                    {c.overdue && <Badge variant="destructive" className="ml-2">{c.days_overdue}d overdue</Badge>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{c.assigned_name || <span className="text-muted-foreground">Unassigned</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{c.checklist_done}/{c.checklist_total}</td>
                  <td className="px-3 py-2">{c.status === "closed" ? <Badge variant="secondary">Closed</Badge> : <Badge variant="outline">Open</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── New / edit case form ──────────────────────────────────────────────────
function CaseFormDialog({ base, open, onOpenChange, onCreated, existing }: {
  base: string; open: boolean; onOpenChange: (o: boolean) => void;
  onCreated?: (id: number) => void; existing?: RecallCase;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const vendorsUrl = base.replace(/\/recalls$/, "/vendors");
  const { data: assignees = [] } = useQuery<Assignee[]>({ queryKey: [base, "assignees"], queryFn: () => api(`${base}/assignees`), enabled: open });
  const { data: recipients = [] } = useQuery<Recipient[]>({ queryKey: [base, "recipients"], queryFn: () => api(`${base}/recipients`), enabled: open && !existing });
  const { data: vendors = [] } = useQuery<{ id: number; name: string }[]>({ queryKey: [vendorsUrl], queryFn: () => api(vendorsUrl).catch(() => []), enabled: open });
  const [f, setF] = useState({ notice_type: "recall", notice_date: "", vendor: "", product: "", recall_number: "", lot_numbers: "", details: "", assigned_user_id: "", due_date: "" });
  const [file, setFile] = useState<File | null>(null);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const activeRecipients = recipients.filter((r) => r.active);

  useEffect(() => {
    if (!open) return;
    setFile(null); setNotify(true);
    setF(existing ? {
      notice_type: existing.notice_type, notice_date: existing.notice_date || "", vendor: existing.vendor, product: existing.product,
      recall_number: existing.recall_number || "", lot_numbers: existing.lot_numbers.join("\n"), details: existing.details || "",
      assigned_user_id: existing.assigned_user_id ? String(existing.assigned_user_id) : "", due_date: existing.due_date,
    } : { notice_type: "recall", notice_date: "", vendor: "", product: "", recall_number: "", lot_numbers: "", details: "", assigned_user_id: "", due_date: "" });
  }, [open, existing]);

  const set = (k: keyof typeof f) => (e: any) => setF((p) => ({ ...p, [k]: e?.target ? e.target.value : e }));

  const submit = async () => {
    if (!f.vendor.trim() || !f.product.trim()) { toast({ title: "Vendor and product are required", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const payload: any = {
        notice_type: f.notice_type, notice_date: f.notice_date || null, vendor: f.vendor, product: f.product,
        recall_number: f.recall_number, lot_numbers: f.lot_numbers, details: f.details,
        assigned_user_id: f.assigned_user_id ? Number(f.assigned_user_id) : null,
      };
      if (existing) {
        if (f.due_date) payload.due_date = f.due_date;
        await api(`${base}/${existing.id}`, { method: "PUT", json: payload });
        toast({ title: "Case updated" });
        qc.invalidateQueries({ queryKey: [base] });
        onOpenChange(false);
        return;
      }
      if (f.due_date) payload.due_date = f.due_date;
      payload.local_date = localToday();
      const created = await api(base, { method: "POST", json: payload });
      let note = `Due ${fmtDate(created.due_date)}.`;
      if (file) {
        const fd = new FormData();
        fd.append("kind", "notice");
        fd.append("file", file);
        try { await api(`${base}/${created.id}/documents`, { method: "POST", body: fd }); }
        catch (e: any) { note += ` The notice file did not upload (${e.message}); add it on the case.`; }
      }
      if (notify && (activeRecipients.length > 0 || payload.assigned_user_id)) {
        try { const n = await api(`${base}/${created.id}/notify`, { method: "POST", json: { stage: "intake", local_date: localToday() } }); note += ` Emailed ${n.sent_to.length} ${n.sent_to.length === 1 ? "person" : "people"}.`; }
        catch (e: any) { note += ` The email did not go out (${e.message}); send it from the case.`; }
      }
      toast({ title: "Recall logged", description: note });
      qc.invalidateQueries({ queryKey: [base] });
      onCreated?.(created.id);
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{existing ? "Edit recall details" : "New recall"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Type of notification</Label>
            <Select value={f.notice_type} onValueChange={set("notice_type")}>
              <SelectTrigger data-testid="recall-type"><SelectValue /></SelectTrigger>
              <SelectContent>{NOTICE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="rc-notice-date">Date of notice</Label>
            <Input id="rc-notice-date" type="date" value={f.notice_date} onChange={set("notice_date")} />
          </div>
          <div>
            <Label htmlFor="rc-vendor">Manufacturer / vendor</Label>
            <Input id="rc-vendor" list="rc-vendor-list" value={f.vendor} onChange={set("vendor")} data-testid="recall-vendor" />
            <datalist id="rc-vendor-list">{vendors.map((v) => <option key={v.id} value={v.name} />)}</datalist>
          </div>
          <div>
            <Label htmlFor="rc-recall-no">Recall number</Label>
            <Input id="rc-recall-no" value={f.recall_number} onChange={set("recall_number")} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="rc-product">Product(s)</Label>
            <Input id="rc-product" value={f.product} onChange={set("product")} placeholder="What is being recalled" data-testid="recall-product" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="rc-lots">Lot numbers</Label>
            <Textarea id="rc-lots" rows={2} value={f.lot_numbers} onChange={set("lot_numbers")} placeholder="One per line, or separated by commas" data-testid="recall-lots" />
            <p className="text-xs text-muted-foreground mt-1">Matched against stock at every location you can see. Spaces, dashes and capitals are ignored.</p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="rc-details">Recall details</Label>
            <Textarea id="rc-details" rows={3} value={f.details} onChange={set("details")} />
          </div>
          <div>
            <Label>Assigned manager</Label>
            <Select value={f.assigned_user_id || "none"} onValueChange={(v) => setF((p) => ({ ...p, assigned_user_id: v === "none" ? "" : v }))}>
              <SelectTrigger data-testid="recall-assignee"><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {assignees.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="rc-due">Due date</Label>
            <Input id="rc-due" type="date" value={f.due_date} onChange={set("due_date")} />
            {!existing && <p className="text-xs text-muted-foreground mt-1">Leave blank for the next business day (Friday rolls to Monday).</p>}
          </div>
          {!existing && (
            <>
              <div className="sm:col-span-2">
                <Label htmlFor="rc-file">Vendor notice (scan or PDF)</Label>
                <Input id="rc-file" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
              <div className="sm:col-span-2 flex items-start gap-2">
                <Checkbox id="rc-notify" checked={notify} onCheckedChange={(v) => setNotify(!!v)} />
                <Label htmlFor="rc-notify" className="font-normal leading-snug">
                  Email the notification list and the assigned manager now, with the notice attached
                  <span className="block text-xs text-muted-foreground">
                    {activeRecipients.length > 0 ? `${activeRecipients.length} on the list.` : "The list is empty; only the assigned manager will be emailed. Add people under Notification list."}
                  </span>
                </Label>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy} data-testid="recall-save">{busy ? "Saving..." : existing ? "Save" : "Log recall"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Notification list ─────────────────────────────────────────────────────
function RecipientsDialog({ base, open, onOpenChange }: { base: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery<Recipient[]>({ queryKey: [base, "recipients"], queryFn: () => api(`${base}/recipients`), enabled: open });
  const [n, setN] = useState({ name: "", email: "", role: "" });
  const refresh = () => qc.invalidateQueries({ queryKey: [base, "recipients"] });
  const add = async () => {
    try { await api(`${base}/recipients`, { method: "POST", json: n }); setN({ name: "", email: "", role: "" }); refresh(); }
    catch (e: any) { toast({ title: "Could not add", description: e.message, variant: "destructive" }); }
  };
  const toggle = async (r: Recipient) => { await api(`${base}/recipients/${r.id}`, { method: "PUT", json: { active: !r.active } }).catch(() => {}); refresh(); };
  const remove = async (r: Recipient) => {
    if (!window.confirm(`Remove ${r.name || r.email} from the notification list?`)) return;
    await api(`${base}/recipients/${r.id}`, { method: "DELETE" }).catch(() => {}); refresh();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Notification list</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Everyone here is emailed when a recall is logged (with the vendor notice attached) and again when the action taken is recorded. The assigned manager is always included.</p>
        <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
          {rows.length === 0 && <div className="p-3 text-sm text-muted-foreground">No one yet.</div>}
          {rows.map((r) => (
            <div key={r.id} className="p-2.5 flex items-center gap-3 text-sm">
              <Checkbox checked={!!r.active} onCheckedChange={() => toggle(r)} aria-label="Receives notices" />
              <div className="flex-1 min-w-0">
                <div className={`font-medium truncate ${r.active ? "" : "text-muted-foreground line-through"}`}>{r.name || r.email}</div>
                <div className="text-xs text-muted-foreground truncate">{r.email}{r.role ? ` · ${r.role}` : ""}</div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => remove(r)} aria-label="Remove"><Trash2 size={14} /></Button>
            </div>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_1.3fr_1fr_auto] items-end">
          <div><Label htmlFor="rr-name">Name</Label><Input id="rr-name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></div>
          <div><Label htmlFor="rr-email">Email</Label><Input id="rr-email" type="email" value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} data-testid="recipient-email" /></div>
          <div><Label htmlFor="rr-role">Role (optional)</Label><Input id="rr-role" value={n.role} onChange={(e) => setN({ ...n, role: e.target.value })} /></div>
          <Button onClick={add} disabled={!n.email.trim()} data-testid="recipient-add"><Plus size={14} className="mr-1" />Add</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Case view ─────────────────────────────────────────────────────────────
function CaseView({ base, caseId }: { base: string; caseId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = [base, "case", caseId];
  const { data: c, error, isLoading } = useQuery<CaseDetail>({ queryKey: key, queryFn: () => api(`${base}/${caseId}?today=${localToday()}`) });
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: [base] });

  const run = async (label: string, fn: () => Promise<any>, ok?: (r: any) => string) => {
    setBusy(label);
    try { const r = await fn(); if (ok) toast({ title: ok(r) }); refresh(); }
    catch (e: any) { toast({ title: "Not done", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;
  if (error || !c) return <Card><CardContent className="p-6 text-sm text-destructive">{(error as Error)?.message || "Recall not found"}</CardContent></Card>;
  const closed = c.status === "closed";

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <Badge variant="outline">{c.notice_type_label}</Badge>
                {closed ? <Badge variant="secondary"><Lock size={11} className="mr-1" />Closed {fmtDate(c.closed_at)}</Badge>
                  : c.overdue ? <Badge variant="destructive">{c.days_overdue}d overdue</Badge> : <Badge>Open</Badge>}
              </div>
              <h2 className="text-xl font-semibold break-words">{c.vendor}: {c.product}</h2>
              <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
                <div><dt className="text-xs text-muted-foreground">Recall number</dt><dd>{c.recall_number || "None"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Date of notice</dt><dd>{fmtDate(c.notice_date) || "Not entered"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Opened</dt><dd>{fmtDate(c.opened_on)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Due</dt><dd className={c.overdue ? "text-red-600 dark:text-red-400 font-medium" : ""}>{fmtDate(c.due_date)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Assigned manager</dt><dd>{c.assigned_name || "Unassigned"}</dd></div>
                <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-muted-foreground">Lot numbers</dt><dd className="break-words">{c.lot_numbers.length ? c.lot_numbers.join(", ") : "None entered"}</dd></div>
              </dl>
              {c.details && <p className="mt-3 text-sm whitespace-pre-wrap">{c.details}</p>}
            </div>
            {!closed && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}><Pencil size={13} className="mr-1.5" />Edit</Button>
                <Button size="sm" variant="ghost" onClick={async () => {
                  if (!window.confirm("Delete this case? Use this only for a case logged by mistake.")) return;
                  await run("delete", () => api(`${base}/${c.id}`, { method: "DELETE" }), () => "Case deleted");
                  window.history.back();
                }} aria-label="Delete case"><Trash2 size={14} /></Button>
              </div>
            )}
          </div>
          {!closed && (
            <div className="mt-4 flex items-center gap-3 flex-wrap text-sm border-t pt-3">
              <Mail size={14} className="text-muted-foreground" />
              {c.intake_notified_at ? <span>Notification list emailed {fmtWhen(c.intake_notified_at)}.</span> : <span className="text-amber-700 dark:text-amber-400">The notification list has not been emailed about this case.</span>}
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("intake", () => api(`${base}/${c.id}/notify`, { method: "POST", json: { stage: "intake" } }), (r) => `Emailed ${r.sent_to.length} ${r.sent_to.length === 1 ? "person" : "people"}`)} data-testid="send-intake-notice">
                <Send size={13} className="mr-1.5" />{c.intake_notified_at ? "Send again" : "Send now"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!closed && <StockCard base={base} c={c} onDone={refresh} />}
      <ClosedStockSummary c={c} />
      <FilesCard base={base} c={c} onDone={refresh} />
      <CloseoutCard base={base} c={c} busy={busy} run={run} />
      <HistoryCard events={c.events} />

      <CaseFormDialog base={base} open={editOpen} onOpenChange={setEditOpen} existing={c} />
    </div>
  );
}

function StockCard({ base, c, onDone }: { base: string; c: CaseDetail; onDone: () => void }) {
  const { toast } = useToast();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const rowKey = (m: LotMatch) => `${m.item_id}:${m.lot_id ?? "item"}`;
  const remove = async (m: LotMatch) => {
    const q = Number(qty[rowKey(m)] ?? m.quantity);
    if (!(q > 0)) { toast({ title: "Enter a quantity", variant: "destructive" }); return; }
    if (!m.vendor_matches && !window.confirm(`${m.item_name} is listed under ${m.item_vendor || "no vendor"}, not ${c.vendor}. Remove it anyway?`)) return;
    setBusyKey(rowKey(m));
    try {
      const r = await api(`${base}/${c.id}/remove-stock`, { method: "POST", json: { item_id: m.item_id, lot_id: m.lot_id, qty: q } });
      toast({ title: `Removed ${r.removed.qty} ${m.unit || ""} of lot ${m.lot_number}`, description: `Written off as recalled at ${m.lab_name}.` });
      onDone();
    } catch (e: any) { toast({ title: "Not removed", description: e.message, variant: "destructive" }); }
    finally { setBusyKey(null); }
  };
  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="font-semibold flex items-center gap-2 mb-1"><PackageX size={16} />Stock on hand with these lot numbers</h3>
        <p className="text-xs text-muted-foreground mb-3">Every location you can see. Removing stock writes off that exact lot with the reason "recalled", so it shows in the waste report.</p>
        {c.lot_numbers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lot numbers on this case. Add them with Edit to search your stock.</p>
        ) : c.matches.length === 0 ? (
          <p className="text-sm">None found. No stock carrying {c.lot_numbers.length === 1 ? "this lot number" : "these lot numbers"} is on hand.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="py-1.5 pr-3">Location</th><th className="py-1.5 pr-3">Item</th><th className="py-1.5 pr-3">Lot</th><th className="py-1.5 pr-3">Expires</th><th className="py-1.5 pr-3 text-right">On hand</th><th className="py-1.5">Remove</th></tr>
              </thead>
              <tbody>
                {c.matches.map((m) => (
                  <tr key={rowKey(m)} className="border-t align-top">
                    <td className="py-2 pr-3"><div>{m.lab_name}</div>{m.storage_location && <div className="text-xs text-muted-foreground">{m.storage_location}</div>}</td>
                    <td className="py-2 pr-3">
                      <div>{m.item_name}</div>
                      <div className="text-xs text-muted-foreground">{[m.catalog_number, m.item_vendor].filter(Boolean).join(" · ")}</div>
                      {!m.vendor_matches && <Badge variant="outline" className="mt-1 border-amber-500 text-amber-700 dark:text-amber-400">Check vendor</Badge>}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{m.lot_number}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(m.expiration_date)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{m.quantity} {m.unit || ""}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-1.5">
                        <Input className="h-8 w-20" type="number" min={0} step="any" value={qty[rowKey(m)] ?? String(m.quantity)} onChange={(e) => setQty({ ...qty, [rowKey(m)]: e.target.value })} aria-label="Quantity to remove" />
                        <Button size="sm" variant="destructive" disabled={busyKey !== null} onClick={() => remove(m)} data-testid={`remove-stock-${m.item_id}`}>{busyKey === rowKey(m) ? "..." : "Remove"}</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ClosedStockSummary({ c }: { c: CaseDetail }) {
  const removed = useMemo(() => c.events.filter((e) => e.action === "stock_removed").map((e) => { try { return JSON.parse(e.detail || "{}"); } catch { return {}; } }), [c.events]);
  if (removed.length === 0) return null;
  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="font-semibold mb-2">Stock removed on this case</h3>
        <ul className="text-sm space-y-1">
          {removed.map((d: any, i: number) => <li key={i}>{d.item_name}, lot {d.lot_number}: {d.qty} {d.unit || ""}{d.lab_name ? ` at ${d.lab_name}` : ""}</li>)}
        </ul>
      </CardContent>
    </Card>
  );
}

function FilesCard({ base, c, onDone }: { base: string; c: CaseDetail; onDone: () => void }) {
  const { toast } = useToast();
  const [kind, setKind] = useState("notice");
  const [uploading, setUploading] = useState(false);
  const closed = c.status === "closed";
  const KIND_LABEL: Record<string, string> = { notice: "Vendor notice", vendor_response: "Vendor paperwork", other: "Other" };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    const fd = new FormData(); fd.append("kind", kind); fd.append("file", file);
    try { await api(`${base}/${c.id}/documents`, { method: "POST", body: fd }); toast({ title: "File added" }); onDone(); }
    catch (e: any) { toast({ title: "Upload failed", description: e.message, variant: "destructive" }); }
    finally { setUploading(false); }
  };
  const download = async (d: RecallDoc) => {
    const r = await fetch(`${API_BASE}${base}/${c.id}/documents/${d.id}`, { headers: authHeaders() });
    if (!r.ok) { toast({ title: "Download failed", variant: "destructive" }); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a"); a.href = url; a.download = d.download_name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const del = async (d: RecallDoc) => {
    if (!window.confirm(`Remove ${d.original_filename}?`)) return;
    await api(`${base}/${c.id}/documents/${d.id}`, { method: "DELETE" }).catch((e) => toast({ title: "Not removed", description: e.message, variant: "destructive" }));
    onDone();
  };
  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="font-semibold mb-1">Files</h3>
        <p className="text-xs text-muted-foreground mb-3">Downloads of the vendor notice are named manufacturer first, so they sort by vendor in a shared folder.</p>
        {c.documents.length === 0 ? <p className="text-sm text-muted-foreground mb-3">No files yet.</p> : (
          <ul className="divide-y border rounded-md mb-3">
            {c.documents.map((d) => (
              <li key={d.id} className="p-2.5 flex items-center gap-3 text-sm">
                <Badge variant="outline" className="shrink-0">{KIND_LABEL[d.kind] || d.kind}</Badge>
                <span className="flex-1 min-w-0 truncate" title={d.download_name}>{d.download_name}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(d.uploaded_at)}</span>
                <Button size="icon" variant="ghost" onClick={() => download(d)} aria-label="Download"><Download size={14} /></Button>
                {!closed && <Button size="icon" variant="ghost" onClick={() => del(d)} aria-label="Remove"><Trash2 size={14} /></Button>}
              </li>
            ))}
          </ul>
        )}
        {!closed && (
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-48 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="notice">Vendor notice</SelectItem>
                <SelectItem value="vendor_response">Vendor paperwork</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <label className="inline-flex">
              <input type="file" className="sr-only" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} disabled={uploading} data-testid="recall-file-input" />
              <span className={`inline-flex items-center rounded-md border px-3 h-9 text-sm cursor-pointer hover:bg-muted ${uploading ? "opacity-50" : ""}`}><Upload size={14} className="mr-1.5" />{uploading ? "Uploading..." : "Add file"}</span>
            </label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CloseoutCard({ base, c, busy, run }: { base: string; c: CaseDetail; busy: string | null; run: (l: string, fn: () => Promise<any>, ok?: (r: any) => string) => Promise<void> }) {
  const closed = c.status === "closed";
  const [f, setF] = useState({ affected_summary: "", corrective_action: "", vendor_response_sent_on: "", vendor_response_not_required: false });
  useEffect(() => {
    setF({ affected_summary: c.affected_summary || "", corrective_action: c.corrective_action || "", vendor_response_sent_on: c.vendor_response_sent_on || "", vendor_response_not_required: !!c.vendor_response_not_required });
  }, [c.affected_summary, c.corrective_action, c.vendor_response_sent_on, c.vendor_response_not_required]);
  const dirty = f.affected_summary !== (c.affected_summary || "") || f.corrective_action !== (c.corrective_action || "")
    || f.vendor_response_sent_on !== (c.vendor_response_sent_on || "") || f.vendor_response_not_required !== !!c.vendor_response_not_required;
  const prepDone = c.checklist.filter((i) => ["affected", "corrective_action", "vendor_response", "vendor_paperwork"].includes(i.key)).every((i) => i.done);
  const resetsWarning = (c.signoff_at || c.closeout_notified_at) && dirty;
  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="font-semibold mb-3">Closeout</h3>
        <div className="grid gap-5 md:grid-cols-[1fr_280px]">
          <div className="space-y-3">
            <div>
              <Label htmlFor="co-affected">What is or was affected</Label>
              <Textarea id="co-affected" rows={3} value={f.affected_summary} disabled={closed} onChange={(e) => setF({ ...f, affected_summary: e.target.value })} data-testid="closeout-affected" />
            </div>
            <div>
              <Label htmlFor="co-action">Corrective action taken</Label>
              <Textarea id="co-action" rows={3} value={f.corrective_action} disabled={closed} onChange={(e) => setF({ ...f, corrective_action: e.target.value })} data-testid="closeout-action" />
            </div>
            <div className="flex items-end gap-4 flex-wrap">
              <div>
                <Label htmlFor="co-vendor-date">Vendor response sent on</Label>
                <Input id="co-vendor-date" type="date" className="w-44" value={f.vendor_response_sent_on} disabled={closed || f.vendor_response_not_required} onChange={(e) => setF({ ...f, vendor_response_sent_on: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox id="co-na" checked={f.vendor_response_not_required} disabled={closed} onCheckedChange={(v) => setF({ ...f, vendor_response_not_required: !!v })} />
                <Label htmlFor="co-na" className="font-normal">No vendor response or paperwork required</Label>
              </div>
            </div>
            {!closed && (
              <div className="flex items-center gap-3 flex-wrap">
                <Button size="sm" disabled={!dirty || busy !== null} onClick={() => run("save", () => api(`${base}/${c.id}`, { method: "PUT", json: { ...f, vendor_response_sent_on: f.vendor_response_not_required ? null : (f.vendor_response_sent_on || null) } }), () => "Closeout saved")} data-testid="closeout-save">Save closeout</Button>
                {resetsWarning && <span className="text-xs text-amber-700 dark:text-amber-400">Saving a change resets the closeout email and the sign-off; both will need to be redone.</span>}
              </div>
            )}
          </div>
          <div>
            <ul className="space-y-1.5 text-sm mb-4" data-testid="closeout-checklist">
              {c.checklist.map((i) => (
                <li key={i.key} className="flex items-start gap-2">
                  {i.done ? <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" /> : <Circle size={16} className="text-muted-foreground shrink-0 mt-0.5" />}
                  <span className={i.done ? "" : "text-muted-foreground"}>{i.label}</span>
                </li>
              ))}
            </ul>
            {c.closeout_notified_at && <p className="text-xs text-muted-foreground mb-1">Closeout emailed {fmtWhen(c.closeout_notified_at)}.</p>}
            {c.signoff_at && <p className="text-xs text-muted-foreground mb-2">Signed off by {c.signoff_name} {fmtWhen(c.signoff_at)}.</p>}
            {!closed && (
              <div className="flex flex-col gap-2">
                <Button size="sm" variant="outline" disabled={!prepDone || dirty || busy !== null} onClick={() => run("closeout", () => api(`${base}/${c.id}/notify`, { method: "POST", json: { stage: "closeout" } }), (r) => `Closeout emailed to ${r.sent_to.length} ${r.sent_to.length === 1 ? "person" : "people"}`)} data-testid="send-closeout-notice">
                  <Send size={13} className="mr-1.5" />{c.closeout_notified_at ? "Resend closeout email" : "Email the action taken"}
                </Button>
                <Button size="sm" variant="outline" disabled={!c.ready_for_signoff || !!c.signoff_at || dirty || busy !== null} onClick={() => run("signoff", () => api(`${base}/${c.id}/signoff`, { method: "POST" }), () => "Signed off")} data-testid="signoff-button">
                  Manager sign-off
                </Button>
                <Button size="sm" disabled={!c.ready_to_close || dirty || busy !== null} onClick={() => { if (window.confirm("Close this case? It becomes read-only.")) run("close", () => api(`${base}/${c.id}/close`, { method: "POST" }), () => "Case closed"); }} data-testid="close-case-button">
                  <Lock size={13} className="mr-1.5" />Close case
                </Button>
                {!c.ready_to_close && <p className="text-xs text-muted-foreground">The case can close once every item above is checked.</p>}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const EVENT_LABEL: Record<string, string> = {
  opened: "Case opened", updated: "Case updated", file_added: "File added", file_removed: "File removed",
  stock_removed: "Stock removed", intake_notice_sent: "Notification list emailed", closeout_notice_sent: "Action taken emailed",
  signed_off: "Signed off", closed: "Case closed", overdue_reminder: "Overdue reminder sent",
};
function eventSummary(e: RecallEvent): string {
  let d: any = null;
  try { d = e.detail ? JSON.parse(e.detail) : null; } catch { return e.detail || ""; }
  if (!d) return "";
  switch (e.action) {
    case "stock_removed": return `${d.item_name}, lot ${d.lot_number}: ${d.qty} ${d.unit || ""}${d.lab_name ? ` at ${d.lab_name}` : ""}`;
    case "file_added": case "file_removed": return d.filename || "";
    case "intake_notice_sent": case "closeout_notice_sent": return `${(d.to || []).length} recipient${(d.to || []).length === 1 ? "" : "s"}${d.attachments ? `, ${d.attachments} attachment${d.attachments === 1 ? "" : "s"}` : ""}`;
    case "updated": return [(d.fields || []).join(", "), d.signoff_cleared ? "sign-off reset" : "", d.closeout_notice_cleared ? "closeout email reset" : ""].filter(Boolean).join("; ");
    case "opened": return `due ${fmtDate(d.due_date)}`;
    case "overdue_reminder": return `${d.days_overdue} days overdue, to ${d.to}`;
    default: return "";
  }
}
function HistoryCard({ events }: { events: RecallEvent[] }) {
  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="font-semibold flex items-center gap-2 mb-3"><History size={16} />History</h3>
        <ol className="space-y-1.5 text-sm">
          {events.slice().reverse().map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="text-xs text-muted-foreground whitespace-nowrap w-32 shrink-0 pt-0.5">{fmtWhen(e.created_at)}</span>
              <span><span className="font-medium">{EVENT_LABEL[e.action] || e.action}</span>{eventSummary(e) ? `: ${eventSummary(e)}` : ""}{e.user_name ? <span className="text-muted-foreground"> ({e.user_name})</span> : null}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
