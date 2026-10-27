// VeritaLab CLIA site registry tab (St. Charles REQ-072, 2026-10-14).
//
// One CLIA site = one lab. For the site in view this tab keeps what a multi-site CLIA coordinator
// otherwise keeps on a spreadsheet: points of contact, the lab director history with the date CMS
// was notified of each change, CLIA fee payments, and a test menu change log with the date CMS was
// notified. Server: server/veritalabRegistry.ts (/api/labs/:labId/veritalab/registry).
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit2, Trash2, Users, UserCheck, DollarSign, ListChecks } from "lucide-react";

type Row = Record<string, any>;
type Field = {
  key: string;
  label: string;
  type?: "text" | "date" | "number" | "select" | "checkbox" | "textarea";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
};

export const FEE_TYPE_LABELS: Record<string, string> = {
  certificate: "Certificate fee",
  compliance_survey: "Compliance survey fee",
  validation: "Validation fee",
  registration: "Registration fee",
  state_license: "State license fee",
  other: "Other",
};
const MENU_CHANGE_LABELS: Record<string, string> = {
  test_added: "Test added",
  test_removed: "Test removed",
  specialty_added: "Specialty added",
  specialty_removed: "Specialty removed",
  method_change: "Method or instrument change",
  complexity_change: "Complexity change",
  other: "Other",
};
const toOptions = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));

const fmtDate = (d?: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "");
const money = (n: any) => (n === null || n === undefined || n === "" ? "" : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

interface SectionDef {
  api: "contacts" | "directors" | "fees" | "menu-changes";
  listKey: string;
  title: string;
  noun: string;
  icon: any;
  empty: string;
  fields: Field[];
  render: (r: Row, today: string) => JSX.Element;
}

const SECTIONS: SectionDef[] = [
  {
    api: "contacts", listKey: "contacts", title: "Points of contact", noun: "contact", icon: Users,
    empty: "No contacts yet. Add the person CMS, the state, or your team should call about this site.",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "role", label: "Role", placeholder: "e.g. Site supervisor, POC coordinator" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "is_primary", label: "Primary contact for this site", type: "checkbox" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    render: (r) => (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-foreground">{r.name}</span>
        {r.is_primary ? <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20">Primary</Badge> : null}
        {r.role && <span>{r.role}</span>}
        {r.phone && <span>{r.phone}</span>}
        {r.email && <a className="text-primary underline" href={`mailto:${r.email}`}>{r.email}</a>}
      </div>
    ),
  },
  {
    api: "directors", listKey: "directors", title: "Lab director history", noun: "director", icon: UserCheck,
    empty: "No director history yet. Record the current laboratory director and each change, with the date CMS was notified.",
    fields: [
      { key: "director_name", label: "Laboratory director", required: true },
      { key: "credentials", label: "Credentials", placeholder: "e.g. MD, board certified in clinical pathology" },
      { key: "start_date", label: "Start date", type: "date", required: true },
      { key: "end_date", label: "End date (blank while current)", type: "date" },
      { key: "cms_notified_date", label: "Date CMS was notified", type: "date" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    render: (r, today) => {
      const current = !r.end_date || r.end_date >= today;
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-foreground">{r.director_name}</span>
          {r.credentials && <span>{r.credentials}</span>}
          <span>{fmtDate(r.start_date)} to {r.end_date ? fmtDate(r.end_date) : "present"}</span>
          {current && <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 border-emerald-500/20">Current</Badge>}
          {r.cms_notified_date
            ? <span>CMS notified {fmtDate(r.cms_notified_date)}</span>
            : <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/20">Not yet reported to CMS</Badge>}
        </div>
      );
    },
  },
  {
    api: "fees", listKey: "fees", title: "CLIA fee payments", noun: "fee", icon: DollarSign,
    empty: "No fees yet. Record each CLIA fee coupon or invoice with its due date, then the date it was paid.",
    fields: [
      { key: "fee_type", label: "Fee", type: "select", options: toOptions(FEE_TYPE_LABELS) },
      { key: "reference", label: "Invoice or coupon number" },
      { key: "amount", label: "Amount ($)", type: "number" },
      { key: "invoice_date", label: "Invoice date", type: "date" },
      { key: "due_date", label: "Due date", type: "date", required: true },
      { key: "paid_date", label: "Paid date", type: "date" },
      { key: "confirmation", label: "Payment confirmation" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    render: (r, today) => (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-foreground">{FEE_TYPE_LABELS[r.fee_type] || r.fee_type}</span>
        {r.amount !== null && r.amount !== undefined && <span>{money(r.amount)}</span>}
        {r.reference && <span>#{r.reference}</span>}
        <span>Due {fmtDate(r.due_date)}</span>
        {r.paid_date
          ? <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 border-emerald-500/20">Paid {fmtDate(r.paid_date)}</Badge>
          : r.due_date < today
            ? <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-600 border-red-500/20">Overdue</Badge>
            : <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/20">Unpaid</Badge>}
      </div>
    ),
  },
  {
    api: "menu-changes", listKey: "menu_changes", title: "Test menu changes", noun: "change", icon: ListChecks,
    empty: "No test menu changes yet. Record tests or specialties added or removed, with the date CMS was notified.",
    fields: [
      { key: "change_type", label: "Change", type: "select", options: toOptions(MENU_CHANGE_LABELS) },
      { key: "description", label: "What changed", required: true, placeholder: "e.g. Added hemoglobin A1c on the DCA Vantage" },
      { key: "change_date", label: "Date of change", type: "date", required: true },
      { key: "cms_notified_date", label: "Date CMS was notified", type: "date" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    render: (r) => (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{fmtDate(r.change_date)}</span>
        <span className="font-medium text-foreground">{MENU_CHANGE_LABELS[r.change_type] || r.change_type}</span>
        <span>{r.description}</span>
        {r.cms_notified_date
          ? <span>CMS notified {fmtDate(r.cms_notified_date)}</span>
          : <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/20">Not yet reported to CMS</Badge>}
      </div>
    ),
  },
];

export function SiteRegistryTab({ labId, isReadOnly }: { labId: number | null; isReadOnly: boolean }) {
  const { toast } = useToast();
  const [data, setData] = useState<Record<string, Row[]> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<{ section: SectionDef; row: Row | null } | null>(null);
  const [form, setForm] = useState<Row>({});
  const [saving, setSaving] = useState(false);
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const base = labId ? `${API_BASE}/api/labs/${labId}/veritalab/registry` : null;

  async function load() {
    if (!base) return;
    setLoadError(false);
    try {
      const r = await fetch(base, { headers: authHeaders() });
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
    } catch {
      setLoadError(true);
    }
  }
  useEffect(() => { setData(null); load(); }, [base]);

  function open(section: SectionDef, row: Row | null) {
    const init: Row = {};
    for (const f of section.fields) {
      const v = row ? row[f.key] : undefined;
      init[f.key] = f.type === "checkbox" ? !!v : v ?? (f.type === "select" ? f.options?.[0]?.value ?? "" : "");
    }
    setForm(init);
    setEditing({ section, row });
  }

  async function save() {
    if (!editing || !base) return;
    const missing = editing.section.fields.find((f) => f.required && !String(form[f.key] ?? "").trim());
    if (missing) { toast({ title: `${missing.label} is required`, variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body: Row = {};
      for (const f of editing.section.fields) body[f.key] = f.type === "checkbox" ? !!form[f.key] : (form[f.key] === "" ? null : form[f.key]);
      const url = editing.row ? `${base}/${editing.section.api}/${editing.row.id}` : `${base}/${editing.section.api}`;
      const r = await fetch(url, { method: editing.row ? "PUT" : "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || "Save failed");
      }
      toast({ title: editing.row ? "Saved" : "Added" });
      setEditing(null);
      load();
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(section: SectionDef, row: Row) {
    if (!base) return;
    const r = await fetch(`${base}/${section.api}/${row.id}`, { method: "DELETE", headers: authHeaders() });
    if (r.ok) { toast({ title: "Removed" }); load(); }
    else toast({ title: "Could not remove", variant: "destructive" });
  }

  if (!labId) return <div className="text-sm text-muted-foreground py-8 text-center">Pick a lab to see its site registry.</div>;
  if (loadError) return <div className="text-sm text-destructive py-8 text-center">Could not load the site registry. Refresh to try again.</div>;
  if (!data) return <div className="text-sm text-muted-foreground py-8 text-center">Loading site registry...</div>;

  return (
    <div className="space-y-4" data-testid="site-registry">
      <p className="text-sm text-muted-foreground">
        This site's contacts, lab director history, CLIA fees and test menu changes. Each site is its own lab in VeritaAssure{"®"}; the All sites tab rolls them up.
      </p>
      {SECTIONS.map((section) => {
        const rows = data[section.listKey] || [];
        const Icon = section.icon;
        return (
          <Card key={section.api} data-testid={`registry-${section.api}`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="font-semibold flex items-center gap-2"><Icon size={16} className="text-primary" /> {section.title}</h3>
                <Button size="sm" variant="outline" onClick={() => open(section, null)} disabled={isReadOnly} data-testid={`registry-add-${section.api}`}>
                  <Plus size={14} className="mr-1" /> Add {section.noun}
                </Button>
              </div>
              {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">{section.empty}</p>
              ) : (
                <div className="divide-y divide-border">
                  {rows.map((r) => (
                    <div key={r.id} className="py-2 flex items-start justify-between gap-3 text-sm text-muted-foreground">
                      <div className="min-w-0">
                        {section.render(r, today)}
                        {r.notes && <div className="text-xs italic mt-1">{r.notes}</div>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => open(section, r)} disabled={isReadOnly} aria-label="Edit">
                          <Edit2 size={13} />
                        </Button>
                        <ConfirmDialog title={`Remove this ${section.noun}?`} message="This removes the record from the site registry." confirmLabel="Remove" onConfirm={() => remove(section, r)}>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" disabled={isReadOnly} aria-label="Remove">
                            <Trash2 size={13} />
                          </Button>
                        </ConfirmDialog>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.row ? "Edit" : "Add"} {editing?.section.noun}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {editing?.section.fields.map((f) => (
              <div key={f.key}>
                {f.type === "checkbox" ? (
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={!!form[f.key]} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.checked }))} />
                    {f.label}
                  </label>
                ) : (
                  <>
                    <label className="text-sm font-medium mb-1 block">{f.label}{f.required ? " *" : ""}</label>
                    {f.type === "select" ? (
                      <select
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={form[f.key] ?? ""}
                        onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                      >
                        {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : f.type === "textarea" ? (
                      <Textarea rows={2} value={form[f.key] ?? ""} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} />
                    ) : (
                      <Input
                        type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                        step={f.type === "number" ? "0.01" : undefined}
                        placeholder={f.placeholder}
                        value={form[f.key] ?? ""}
                        onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                      />
                    )}
                  </>
                )}
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Button onClick={save} disabled={saving} className="flex-1" data-testid="registry-save">{saving ? "Saving..." : "Save"}</Button>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
