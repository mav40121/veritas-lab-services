// VeritaStockTissuePage.tsx
//
// VeritaStock tissue tracking (Heywood, parking lot #105, REQ-106; Michael Q152 = 1: NO PHI). The perpetual log, lookup by
// tissue ID, the receipt form, one record per unit with the next step's form, and the lab's own catalog.
// No field here is for a patient. Server: server/tissue.ts. Rules: shared/tissueRules.ts. The server enforces every check;
// this page shows its reason where the person is working.
// Shown only inside VeritaAssure, never on veritastock.com.

import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { isStockHost } from "@/lib/host";
import { downloadPdfToken } from "@/lib/utils";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Download, FileText, Plus, Search, ShieldCheck, Thermometer, Undo2 } from "lucide-react";
import {
  OTHER_DISPOSITION_LABELS, RETURN_UNUSED_PACKAGE_LABEL, RETURN_UNUSED_STORAGE_LABEL, TISSUE_CFR_CODE_CITATION, TISSUE_CFR_CODE_QUOTE, TISSUE_FIELD_LABELS,
  TISSUE_NO_PHI_NOTICE, returnUnusedRefusal, type OtherDisposition,
} from "@shared/tissueRules";

const localToday = () => new Date().toLocaleDateString("en-CA");
const localNow = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const fieldClass = "w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground";
const dt = (d?: string | null, t?: string | null) => [d, t].filter(Boolean).join(" ");

async function api(path: string, init?: RequestInit & { json?: unknown }) {
  const headers: Record<string, string> = { ...authHeaders() };
  let body = init?.body;
  if (init?.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(init.json); }
  const r = await fetch(`${API_BASE}${path}`, { ...init, headers, body });
  let data: any = null;
  try { data = await r.json(); } catch { /* empty */ }
  if (r.ok && data === null) throw new Error("The server returned an unexpected response. Reload and try again.");
  if (!r.ok) throw new Error(data?.error || `Request failed (${r.status})`);
  return data;
}

// The platform's no-PHI notice, on every free-text box.
const NoPhiNotice = () => <p className="text-xs text-muted-foreground mt-1" data-testid="no-phi-notice">{TISSUE_NO_PHI_NOTICE}</p>;

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function YesNo({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <fieldset data-testid={testId}>
      <legend className="text-xs font-medium">{label}</legend>
      <div className="flex gap-4 mt-1.5">
        {["yes", "no"].map((v) => (
          <label key={v} className="inline-flex items-center gap-1.5 text-sm capitalize">
            <input type="radio" name={testId} value={v} checked={value === v} onChange={() => onChange(v)} data-testid={`${testId}-${v}`} /> {v}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const ErrorLine = ({ text }: { text: string | null }) => text ? <div role="alert" className="text-sm rounded-md border border-red-500/50 bg-red-500/10 text-red-800 dark:text-red-300 px-3 py-2" data-testid="tissue-error">{text}</div> : null;
const Row = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex flex-col sm:flex-row sm:gap-3 py-1 text-sm border-b border-border/50 last:border-0">
    <dt className="sm:w-56 shrink-0 text-muted-foreground">{label}</dt>
    <dd className="break-words min-w-0">{value === null || value === undefined || value === "" ? "" : value}</dd>
  </div>
);
const yn = (v: number | null | undefined) => (v === 1 ? "Yes" : v === 0 ? "No" : "");

function StateBadge({ unit }: { unit: any }) {
  const cls = unit.state === "implanted" ? "border-green-600 text-green-700 dark:text-green-400"
    : unit.state === "expired" ? "border-red-600 text-red-700 dark:text-red-400"
    : unit.state === "wasted" || unit.state === "returned" ? "border-muted-foreground text-muted-foreground"
    : "border-amber-600 text-amber-800 dark:text-amber-400";
  return <Badge variant="outline" className={cls} data-testid="unit-state">{unit.state_label}</Badge>;
}
const Flags = ({ unit }: { unit: any }) => (
  <>
    {unit.flags?.expired_on_shelf && <Badge variant="outline" className="border-red-600 text-red-700 dark:text-red-400">Past expiration</Badge>}
    {unit.flags?.receipt_problem && <Badge variant="outline" className="border-amber-600 text-amber-800 dark:text-amber-400">Receipt: answered no</Badge>}
    {unit.flags?.card_pending && <Badge variant="outline" className="border-amber-600 text-amber-800 dark:text-amber-400">Usage card not returned</Badge>}
  </>
);

export default function VeritaStockTissuePage() {
  const labId = useActiveLabId();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const unitId = Number(params.get("unit")) || null;
  const view = params.get("tab") === "catalog" ? "catalog" : params.get("new") ? "new" : "log";
  const base = labId ? `/api/labs/${labId}/veritastock/tissue` : null;
  const pagePath = labId ? `/labs/${labId}/veritastock/tissue` : "/veritastock";
  const isReadOnly = useIsReadOnly("veritastock");
  if (isStockHost()) return null;

  return (
    <div className="container-default py-8 max-w-6xl mx-auto px-4">
      <div className="mb-5">
        {unitId || view !== "log" ? (
          <Link href={pagePath} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"><ArrowLeft size={12} /> Tissue log</Link>
        ) : (
          <Link href={labId ? `/labs/${labId}/veritastock` : "/veritastock"} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"><ArrowLeft size={12} /> Back to VeritaStock™</Link>
        )}
        <h1 className="text-2xl font-bold">Tissue tracking</h1>
        <div className="flex items-start gap-2 mt-2 rounded-md border bg-secondary/40 px-3 py-2 text-sm max-w-3xl" data-testid="no-phi-banner">
          <ShieldCheck size={16} className="text-primary mt-0.5 shrink-0" />
          <span>No patient information is kept here. Each record carries the supplier's tissue ID. A lookback runs tissue ID, then this record, then the hospital's chart, where the link to the patient stays.</span>
        </div>
      </div>

      {!labId ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Choose a lab to see its tissue log.</CardContent></Card>
      ) : unitId ? (
        <UnitView base={base!} labId={labId} unitId={unitId} canEdit={!isReadOnly} />
      ) : view === "new" ? (
        <ReceiveForm base={base!} labId={labId} pagePath={pagePath} onCreated={(id) => navigate(`${pagePath}?unit=${id}`)} />
      ) : view === "catalog" ? (
        <CatalogView base={base!} canEdit={!isReadOnly} />
      ) : (
        <LogView base={base!} pagePath={pagePath} onOpen={(id) => navigate(`${pagePath}?unit=${id}`)} />
      )}
      <p className="text-xs text-muted-foreground mt-6 max-w-3xl">The tissue ID is the supplier's "{TISSUE_CFR_CODE_QUOTE}" ({TISSUE_CFR_CODE_CITATION}).</p>
    </div>
  );
}

// ── The log and lookup ───────────────────────────────────────────────────
function LogView({ base, pagePath, onOpen }: { base: string; pagePath: string; onOpen: (id: number) => void }) {
  const [filter, setFilter] = useState<"open" | "all" | "card_pending">("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery<any>({ queryKey: [base, "units", filter], queryFn: () => api(`${base}/units?filter=${filter}`) });
  const rows: any[] = data?.rows || [];
  const download = async (kind: "xlsx" | "pdf") => {
    setBusy(kind); setErr(null);
    try {
      const r = await api(`${base}/log/${kind}`, { method: "POST", json: { filter } });
      downloadPdfToken(r.token, r.filename);
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-4">
      <LookupCard base={base} onOpen={onOpen} />
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`${pagePath}?new=1`}><Button size="sm" data-testid="receive-tissue"><Plus size={14} className="mr-1.5" />Receive tissue</Button></Link>
        <Link href={`${pagePath}?tab=catalog`}><Button size="sm" variant="outline" data-testid="tissue-catalog-link">Catalog</Button></Link>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => download("pdf")} data-testid="tissue-print"><FileText size={14} className="mr-1.5" />{busy === "pdf" ? "Building..." : "Print log (PDF)"}</Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => download("xlsx")} data-testid="tissue-excel"><Download size={14} className="mr-1.5" />{busy === "xlsx" ? "Building..." : "Excel"}</Button>
      </div>
      <ErrorLine text={err} />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Which units to show">
        {([["open", `Open (${data?.counts?.open ?? 0})`], ["all", `All (${data?.counts?.all ?? 0})`], ["card_pending", `Usage card not returned (${data?.counts?.card_pending ?? 0})`]] as const).map(([k, label]) => (
          <Button key={k} size="sm" variant={filter === k ? "secondary" : "ghost"} onClick={() => setFilter(k)} data-testid={`tissue-filter-${k}`}>{label}</Button>
        ))}
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : error ? <ErrorLine text={(error as Error).message} /> : rows.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No units on this view. Receive tissue to start the log.</CardContent></Card>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto rounded-md border" data-testid="tissue-log-table">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground bg-secondary/40">
                <tr><th className="p-2">Tissue ID</th><th className="p-2">Type of tissue</th><th className="p-2">Supplier</th><th className="p-2">Expires</th><th className="p-2">Status</th><th className="p-2">Delivered to</th><th className="p-2">Implanted or final</th></tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="border-t hover:bg-secondary/30 cursor-pointer" onClick={() => onOpen(u.id)} data-testid="tissue-log-row">
                    <td className="p-2 font-medium">{u.source_id}</td>
                    <td className="p-2">{u.tissue_type}</td>
                    <td className="p-2">{u.supplier_name}</td>
                    <td className="p-2 whitespace-nowrap">{u.expiration_date}</td>
                    <td className="p-2"><div className="flex flex-wrap gap-1"><StateBadge unit={u} /><Flags unit={u} /></div></td>
                    <td className="p-2">{u.delivered_to}</td>
                    <td className="p-2 whitespace-nowrap">{u.implanted_date ? `${dt(u.implanted_date, u.implanted_time)}, ${u.implanted_by}` : dt(u.disposition_date, u.disposition_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-2" data-testid="tissue-log-cards">
            {rows.map((u) => (
              <button key={u.id} type="button" className="w-full text-left rounded-md border p-3 space-y-1" onClick={() => onOpen(u.id)} data-testid="tissue-log-card">
                <div className="font-medium break-words">{u.source_id}</div>
                <div className="text-sm break-words">{u.tissue_type}</div>
                <div className="text-xs text-muted-foreground break-words">{u.supplier_name}. Expires {u.expiration_date}</div>
                <div className="flex flex-wrap gap-1"><StateBadge unit={u} /><Flags unit={u} /></div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LookupCard({ base, onOpen }: { base: string; onOpen: (id: number) => void }) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setErr(null); setResult(null);
    if (!q.trim()) return;
    try { setResult((await api(`${base}/lookup?id=${encodeURIComponent(q.trim())}`)).matches); } catch (e: any) { setErr(e.message); }
  };
  return (
    <Card>
      <CardContent className="p-4">
        <form className="flex flex-col sm:flex-row gap-2 sm:items-end" onSubmit={(e) => { e.preventDefault(); run(); }}>
          <div className="flex-1"><Field label="Look up a tissue ID"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="The ID on the supplier's label" data-testid="tissue-lookup-input" /></Field></div>
          <Button type="submit" variant="outline" data-testid="tissue-lookup-button"><Search size={14} className="mr-1.5" />Look up</Button>
        </form>
        <ErrorLine text={err} />
        {result && result.length === 0 && <p className="text-sm mt-3" data-testid="tissue-lookup-none">No unit with that tissue ID is on this lab's log.</p>}
        {result && result.length > 0 && (
          <div className="mt-3 space-y-2" data-testid="tissue-lookup-results">
            {result.map((u) => (
              <button key={u.id} type="button" className="w-full text-left rounded-md border p-3 space-y-1" onClick={() => onOpen(u.id)} data-testid="tissue-lookup-result">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium break-words">{u.source_id}</span><StateBadge unit={u} /></div>
                <div className="text-sm break-words">{u.tissue_type}, {u.supplier_name}</div>
                {u.implanted_date && <div className="text-sm">Implanted {dt(u.implanted_date, u.implanted_time)} by {u.implanted_by}</div>}
                {u.delivered_to && <div className="text-sm">Delivered to {u.delivered_to}</div>}
                {u.implanted_date && <div className="text-xs text-muted-foreground">To reach the patient, find this tissue ID in the hospital's chart.</div>}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Storage units from VeritaMaintain temperature logs ───────────────────
function useStorageUnits(labId: number) {
  const { data } = useQuery<any>({ queryKey: ["tissue-storage-units", labId], queryFn: () => api(`/api/labs/${labId}/temp-logs/units`), retry: false });
  return (data?.units || []) as any[];
}

function BbFields({ labId, v, set }: { labId: number; v: Record<string, string>; set: (k: string, val: string) => void }) {
  const units = useStorageUnits(labId);
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Date received in blood bank"><Input type="date" value={v.received_bb_date} onChange={(e) => set("received_bb_date", e.target.value)} data-testid="bb-date" /></Field>
        <Field label="Time"><Input type="time" value={v.received_bb_time} onChange={(e) => set("received_bb_time", e.target.value)} data-testid="bb-time" /></Field>
        <Field label="Received by"><Input value={v.received_bb_by} onChange={(e) => set("received_bb_by", e.target.value)} data-testid="bb-by" /></Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <YesNo label="Transport temperature acceptable on receipt?" value={v.transport_temp_ok} onChange={(x) => set("transport_temp_ok", x)} testId="transport-temp" />
        <YesNo label="Package integrity acceptable?" value={v.package_ok} onChange={(x) => set("package_ok", x)} testId="package-ok" />
      </div>
      <Field label="Action taken (needed on any no)"><Textarea rows={2} value={v.transport_action} onChange={(e) => set("transport_action", e.target.value)} data-testid="transport-action" /><NoPhiNotice /></Field>
      <StorageFields units={units} v={v} set={set} />
    </div>
  );
}

// Where a unit is stored: the blood bank receipt and a return to storage both set it, with the same check on the server.
function StorageFields({ units, v, set, prefix = "" }: { units: any[]; v: Record<string, string>; set: (k: string, val: string) => void; prefix?: string }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <Field label="Storage unit" hint="From VeritaMaintain temperature logs."><select className={fieldClass} value={v.storage_unit_id} onChange={(e) => set("storage_unit_id", e.target.value)} data-testid={`${prefix}storage-unit`}><option value="">Not on the temperature log</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}{u.location ? `, ${u.location}` : ""}</option>)}</select></Field>
      <Field label="Location or shelf"><Input value={v.storage_location} onChange={(e) => set("storage_location", e.target.value)} data-testid={`${prefix}storage-location`} /></Field>
    </div>
  );
}

const emptyBb = () => ({ received_bb_date: localToday(), received_bb_time: localNow(), received_bb_by: "", transport_temp_ok: "", package_ok: "", transport_action: "", storage_unit_id: "", storage_location: "" });

// ── Receipt ──────────────────────────────────────────────────────────────
function ReceiveForm({ base, labId, pagePath, onCreated }: { base: string; labId: number; pagePath: string; onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery<any>({ queryKey: [base, "catalog"], queryFn: () => api(`${base}/catalog`) });
  const items: any[] = useMemo(() => (data?.items || []).filter((i: any) => i.active), [data]);
  const [v, setV] = useState<Record<string, string>>({ catalog_id: "", source_id: "", quantity_or_size: "", expiration_date: "", received_mm_date: localToday(), received_mm_time: localNow(), received_mm_by: "", notes: "" });
  const [withBb, setWithBb] = useState(true);
  const [bb, setBb] = useState<Record<string, string>>(emptyBb);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  const save = async () => {
    setErr(null); setSaving(true);
    try {
      const r = await api(`${base}/units`, { method: "POST", json: { ...v, catalog_id: Number(v.catalog_id) || null, receive_bb: withBb ? bb : undefined } });
      qc.invalidateQueries({ queryKey: [base, "units"] });
      onCreated(r.id);
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };
  return (
    <Card>
      <CardContent className="p-5 space-y-4" data-testid="receive-form">
        <h2 className="font-semibold">Receive tissue</h2>
        {data && items.length === 0 && <p className="text-sm">Your catalog is empty. <Link href={`${pagePath}?tab=catalog`} className="underline">Add the tissue types you receive</Link> first.</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Type of tissue and supplier"><select className={fieldClass} value={v.catalog_id} onChange={(e) => set("catalog_id", e.target.value)} data-testid="catalog-select"><option value="">Choose from your catalog</option>{items.map((i) => <option key={i.id} value={i.id}>{i.tissue_type} ({i.supplier_name})</option>)}</select></Field>
          <Field label="Tissue ID" hint="The ID on the supplier's label."><Input value={v.source_id} onChange={(e) => set("source_id", e.target.value)} data-testid="source-id" /></Field>
          <Field label="Quantity or size"><Input value={v.quantity_or_size} onChange={(e) => set("quantity_or_size", e.target.value)} data-testid="quantity-size" /></Field>
          <Field label="Expiration date"><Input type="date" value={v.expiration_date} onChange={(e) => set("expiration_date", e.target.value)} data-testid="expiration" /></Field>
        </div>
        <div>
          <h3 className="text-sm font-medium mb-2">Received in Materials Management</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Date"><Input type="date" value={v.received_mm_date} onChange={(e) => set("received_mm_date", e.target.value)} data-testid="mm-date" /></Field>
            <Field label="Time"><Input type="time" value={v.received_mm_time} onChange={(e) => set("received_mm_time", e.target.value)} data-testid="mm-time" /></Field>
            <Field label="Received by"><Input value={v.received_mm_by} onChange={(e) => set("received_mm_by", e.target.value)} data-testid="mm-by" /></Field>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={withBb} onChange={(e) => setWithBb(e.target.checked)} data-testid="with-bb" /> Also received in the blood bank now</label>
        {withBb && <BbFields labId={labId} v={bb} set={(k, val) => setBb((p) => ({ ...p, [k]: val }))} />}
        <Field label="Notes"><Textarea rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} data-testid="notes" /><NoPhiNotice /></Field>
        <ErrorLine text={err} />
        <Button onClick={save} disabled={saving} data-testid="save-receipt">{saving ? "Saving..." : "Save receipt"}</Button>
      </CardContent>
    </Card>
  );
}

// ── One unit: what's recorded, then the next step ────────────────────────
function UnitView({ base, labId, unitId, canEdit }: { base: string; labId: number; unitId: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = [base, "unit", unitId];
  const { data: u, isLoading, error } = useQuery<any>({ queryKey: key, queryFn: () => api(`${base}/units/${unitId}`) });
  const done = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: [base, "units"] }); };
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (error || !u) return <ErrorLine text={(error as Error)?.message || "That unit isn't on this lab's log"} />;
  const final = !u.flags.open;
  return (
    <div className="space-y-4" data-testid="tissue-unit">
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center gap-2 mb-1"><h2 className="text-lg font-semibold break-all" data-testid="unit-source-id">{u.source_id}</h2><StateBadge unit={u} /><Flags unit={u} /></div>
          <p className="text-sm break-words">{u.tissue_type}, {u.supplier_name}</p>
          {u.state === "implanted" && <p className="text-xs text-muted-foreground mt-2">To reach the patient, find this tissue ID in the hospital's chart.</p>}
          <RecordPdfButton base={base} u={u} />
        </CardContent>
      </Card>

      <Section title="1. Receipt">
        <Row label="Quantity or size" value={u.quantity_or_size} />
        <Row label="Expiration date" value={u.expiration_date} />
        <Row label="Received in Materials Management" value={[dt(u.received_mm_date, u.received_mm_time), u.received_mm_by].filter(Boolean).join(", ")} />
        {u.received_bb_date && <>
          <Row label="Received in blood bank" value={[dt(u.received_bb_date, u.received_bb_time), u.received_bb_by].filter(Boolean).join(", ")} />
          <Row label="Transport temperature acceptable" value={yn(u.transport_temp_ok)} />
          <Row label="Package integrity acceptable" value={yn(u.package_ok)} />
          {u.transport_action && <Row label="Action taken" value={u.transport_action} />}
        </>}
        {u.notes && <Row label="Notes" value={u.notes} />}
      </Section>

      {u.received_bb_date && (
        <Section title="2. Storage">
          {u.storage && <Row label="Storage unit" value={<span className="inline-flex items-center gap-1"><Thermometer size={13} />{u.storage.name}{u.storage.location ? `, ${u.storage.location}` : ""}</span>} />}
          {u.storage_location && <Row label="Location or shelf" value={u.storage_location} />}
          {u.storage && <Row label="Latest temperature reading" value={u.storage.last_reading ? `${u.storage.last_reading.value} ${u.storage.scale} on ${dt(u.storage.last_reading.reading_date, u.storage.last_reading.reading_time)}` : "None on the log"} />}
          {u.storage && <Row label="Out-of-range readings while stored" value={String(u.storage.out_of_range_while_stored)} />}
        </Section>
      )}

      {u.issued_date && (
        <Section title="3. Issue">
          <Row label="Issued" value={dt(u.issued_date, u.issued_time)} />
          <Row label="Requesting physician" value={u.requesting_physician} />
          <Row label="Issued to (courier)" value={u.issued_to} />
          <Row label="Tech issuing" value={u.issued_by_tech} />
          <Row label="Delivered to" value={u.delivered_to} />
          <Row label="Source ID read back and acceptable" value={yn(u.readback_id_ok)} />
          <Row label="Unit expiration date acceptable" value={yn(u.readback_expiration_ok)} />
          <Row label="Integrity at issue acceptable" value={yn(u.readback_integrity_ok)} />
        </Section>
      )}

      {u.implanted_date && (
        <Section title="4. Implant">
          <Row label="Implanted" value={dt(u.implanted_date, u.implanted_time)} />
          <Row label="Implanted by" value={u.implanted_by} />
          {u.reconstituted_time && <Row label="Reconstituted" value={[u.reconstituted_time, u.reconstituted_by].filter(Boolean).join(", ")} />}
          {u.reconstitution_solution && <Row label="Solution" value={`${u.reconstitution_solution}, lot ${u.reconstitution_lot}, expires ${u.reconstitution_expiration}`} />}
          <Row label="Tissue usage card completed and returned" value={u.usage_card_returned === 1 ? `Yes, ${u.usage_card_returned_on}` : "No"} />
        </Section>
      )}

      {u.disposition_date && (
        <Section title="Other disposition">
          <Row label="Disposition" value={OTHER_DISPOSITION_LABELS[u.state as OtherDisposition] || ""} />
          <Row label="When" value={dt(u.disposition_date, u.disposition_time)} />
          <Row label="Description" value={u.disposition_description} />
          <Row label="Performed by" value={u.disposition_by} />
        </Section>
      )}

      {u.state === "received_mm" && <ReceiveBbStep base={base} labId={labId} u={u} done={done} />}
      {u.state === "stored" && <IssueStep base={base} u={u} done={done} />}
      {u.state === "issued" && <ImplantStep base={base} u={u} done={done} />}
      {u.state === "implanted" && <UsageCardStep base={base} u={u} done={done} />}
      {!final && (
        <div className="flex flex-wrap items-start gap-2" data-testid="unit-actions">
          {u.state === "issued" && <ReturnUnusedStep base={base} labId={labId} u={u} done={done} />}
          <DisposeStep base={base} u={u} done={done} />
        </div>
      )}
      {canEdit && <CorrectionStep base={base} u={u} done={done} />}
      <History events={u.events} />
    </div>
  );
}

// The unit's record as a PDF (server/tissueRecordPdf.ts). The route needs the sign-in header, so the page fetches it and saves the
// file itself, the way the Competency Register button does; a plain link would go out without the header.
function RecordPdfButton({ base, u }: { base: string; u: any }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const download = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${API_BASE}${base}/units/${u.id}/pdf`, { headers: authHeaders() });
      if (!r.ok) {
        let msg = `Request failed (${r.status})`;
        try { msg = (await r.json())?.error || msg; } catch { /* not JSON */ }
        throw new Error(msg);
      }
      const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "")?.[1] || `VeritaStock_Tissue_Record_${u.id}.pdf`;
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 space-y-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={download} data-testid="tissue-record-pdf"><FileText size={14} className="mr-1.5" />{busy ? "Building..." : "Print record (PDF)"}</Button>
      <ErrorLine text={err} />
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <Card><CardContent className="p-5"><h3 className="font-semibold mb-2">{title}</h3><dl>{children}</dl></CardContent></Card>
);

function usePost(url: string, done: () => void) {
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const post = async (json: unknown) => {
    setErr(null); setSaving(true);
    try { await api(url, { method: "POST", json }); done(); return true; } catch (e: any) { setErr(e.message); return false; } finally { setSaving(false); }
  };
  return { err, saving, post };
}

function ReceiveBbStep({ base, labId, u, done }: { base: string; labId: number; u: any; done: () => void }) {
  const [v, setV] = useState<Record<string, string>>(emptyBb);
  const { err, saving, post } = usePost(`${base}/units/${u.id}/receive-bb`, done);
  return (
    <Card><CardContent className="p-5 space-y-3" data-testid="step-receive-bb">
      <h3 className="font-semibold">Next: receive in the blood bank</h3>
      <BbFields labId={labId} v={v} set={(k, val) => setV((p) => ({ ...p, [k]: val }))} />
      <ErrorLine text={err} />
      <Button onClick={() => post(v)} disabled={saving} data-testid="save-bb">{saving ? "Saving..." : "Save blood bank receipt"}</Button>
    </CardContent></Card>
  );
}

function IssueStep({ base, u, done }: { base: string; u: any; done: () => void }) {
  const [v, setV] = useState<Record<string, string>>({ issued_date: localToday(), issued_time: localNow(), requesting_physician: "", issued_to: "", issued_by_tech: "", delivered_to: "", readback_id: "", readback_expiration: "", readback_integrity: "" });
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  const { err, saving, post } = usePost(`${base}/units/${u.id}/issue`, done);
  return (
    <Card><CardContent className="p-5 space-y-3" data-testid="step-issue">
      <h3 className="font-semibold">Next: issue from storage</h3>
      {u.flags.expired_on_shelf && <p className="text-sm text-red-700 dark:text-red-400" data-testid="issue-expired-note">This unit expired on {u.expiration_date}. An expired unit can't be issued. Record it below as another disposition.</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Date"><Input type="date" value={v.issued_date} onChange={(e) => set("issued_date", e.target.value)} data-testid="issue-date" /></Field>
        <Field label="Time"><Input type="time" value={v.issued_time} onChange={(e) => set("issued_time", e.target.value)} data-testid="issue-time" /></Field>
        <Field label="Requesting physician"><Input value={v.requesting_physician} onChange={(e) => set("requesting_physician", e.target.value)} data-testid="issue-physician" /></Field>
        <Field label="Issued to (courier)"><Input value={v.issued_to} onChange={(e) => set("issued_to", e.target.value)} data-testid="issue-to" /></Field>
        <Field label="Tech issuing"><Input value={v.issued_by_tech} onChange={(e) => set("issued_by_tech", e.target.value)} data-testid="issue-tech" /></Field>
        <Field label="Delivered to" hint="The room or department."><Input value={v.delivered_to} onChange={(e) => set("delivered_to", e.target.value)} data-testid="issue-delivered" /></Field>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <YesNo label={`Source ID read back (${u.source_id}) and acceptable?`} value={v.readback_id} onChange={(x) => set("readback_id", x)} testId="readback-id" />
        <YesNo label={`Unit expiration date (${u.expiration_date}) acceptable?`} value={v.readback_expiration} onChange={(x) => set("readback_expiration", x)} testId="readback-exp" />
        <YesNo label="Integrity at issue acceptable?" value={v.readback_integrity} onChange={(x) => set("readback_integrity", x)} testId="readback-int" />
      </div>
      <ErrorLine text={err} />
      <Button onClick={() => post(v)} disabled={saving} data-testid="save-issue">{saving ? "Saving..." : "Issue this unit"}</Button>
    </CardContent></Card>
  );
}

function ImplantStep({ base, u, done }: { base: string; u: any; done: () => void }) {
  const [v, setV] = useState<Record<string, string>>({ implanted_date: localToday(), implanted_time: localNow(), implanted_by: "", reconstituted_time: "", reconstituted_by: "", reconstitution_solution: "", reconstitution_lot: "", reconstitution_expiration: "", usage_card_returned: "", usage_card_returned_on: "" });
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  const { err, saving, post } = usePost(`${base}/units/${u.id}/implant`, done);
  return (
    <Card><CardContent className="p-5 space-y-3" data-testid="step-implant">
      <h3 className="font-semibold">Next: implant</h3>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Date implanted"><Input type="date" value={v.implanted_date} onChange={(e) => set("implanted_date", e.target.value)} data-testid="implant-date" /></Field>
        <Field label="Time implanted"><Input type="time" value={v.implanted_time} onChange={(e) => set("implanted_time", e.target.value)} data-testid="implant-time" /></Field>
        <Field label="Implanted by"><Input value={v.implanted_by} onChange={(e) => set("implanted_by", e.target.value)} data-testid="implant-by" /></Field>
      </div>
      <p className="text-sm font-medium pt-1">Reconstitution, if the tissue needed it</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Time"><Input type="time" value={v.reconstituted_time} onChange={(e) => set("reconstituted_time", e.target.value)} data-testid="recon-time" /></Field>
        <Field label="By"><Input value={v.reconstituted_by} onChange={(e) => set("reconstituted_by", e.target.value)} data-testid="recon-by" /></Field>
        <Field label="Solution used"><Input value={v.reconstitution_solution} onChange={(e) => set("reconstitution_solution", e.target.value)} data-testid="recon-solution" /></Field>
        <Field label="Solution lot"><Input value={v.reconstitution_lot} onChange={(e) => set("reconstitution_lot", e.target.value)} data-testid="recon-lot" /></Field>
        <Field label="Solution expiration"><Input type="date" value={v.reconstitution_expiration} onChange={(e) => set("reconstitution_expiration", e.target.value)} data-testid="recon-exp" /></Field>
      </div>
      <ErrorLine text={err} />
      <Button onClick={() => post(v)} disabled={saving} data-testid="save-implant">{saving ? "Saving..." : "Record the implant"}</Button>
    </CardContent></Card>
  );
}

function UsageCardStep({ base, u, done }: { base: string; u: any; done: () => void }) {
  const [returned, setReturned] = useState(u.usage_card_returned === 1 ? "yes" : "");
  const [on, setOn] = useState(u.usage_card_returned_on || localToday());
  const { err, saving, post } = usePost(`${base}/units/${u.id}/usage-card`, done);
  return (
    <Card><CardContent className="p-5 space-y-3" data-testid="step-usage-card">
      <h3 className="font-semibold">Tissue usage card</h3>
      <p className="text-sm text-muted-foreground">The card goes back to the supplier on paper, filled in by the hospital. Only record here that it went back, and the date.</p>
      <YesNo label="Completed and returned?" value={returned} onChange={setReturned} testId="usage-card" />
      {returned === "yes" && <div className="max-w-xs"><Field label="Date returned"><Input type="date" value={on} onChange={(e) => setOn(e.target.value)} data-testid="usage-card-date" /></Field></div>}
      <ErrorLine text={err} />
      <Button variant="outline" onClick={() => post({ usage_card_returned: returned, usage_card_returned_on: returned === "yes" ? on : null })} disabled={saving} data-testid="save-usage-card">Save</Button>
    </CardContent></Card>
  );
}

// Issued, not implanted, and back in the blood bank (Michael 2026-11-09). The unit goes back into storage and can be issued again;
// a no on either check keeps it off the shelf, so the save is held and the person is pointed to Other disposition. The server
// re-checks all of it (server/tissue.ts return-unused).
function ReturnUnusedStep({ base, labId, u, done }: { base: string; labId: number; u: any; done: () => void }) {
  const units = useStorageUnits(labId);
  const [open, setOpen] = useState(false);
  const fresh = () => ({
    returned_date: localToday(), returned_time: localNow(), returned_by: "", received_back_by: "", storage_ok: "", package_ok_on_return: "",
    storage_unit_id: u.storage_unit_id ? String(u.storage_unit_id) : "", storage_location: u.storage_location || "", note: "",
  });
  const [v, setV] = useState<Record<string, string>>(fresh);
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  const { err, saving, post } = usePost(`${base}/units/${u.id}/return-unused`, done);
  const refusal = returnUnusedRefusal(v.storage_ok, v.package_ok_on_return);
  if (!open) return <Button variant="outline" size="sm" onClick={() => { setV(fresh()); setOpen(true); }} data-testid="open-return-unused">Returned unused</Button>;
  return (
    <Card className="w-full"><CardContent className="p-5 space-y-3" data-testid="step-return-unused">
      <h3 className="font-semibold">Returned unused to blood bank</h3>
      <p className="text-sm text-muted-foreground" data-testid="return-unused-help">Use this when the tissue came back to blood bank without being implanted. It goes back into storage and can be issued again. If it can't go back on the shelf, record an Other disposition instead.</p>
      <p className={`text-sm ${u.flags.expired_on_shelf ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`} data-testid="return-unused-expiry">
        {u.flags.expired_on_shelf ? `This unit expired on ${u.expiration_date}. It can still be returned here, but it can't be issued again.` : "A unit past its expiration date can still be returned here, but it can't be issued again."}
      </p>
      <p className="text-sm">Issued {dt(u.issued_date, u.issued_time)}{u.delivered_to ? ` to ${u.delivered_to}` : ""}.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Date returned to blood bank"><Input type="date" value={v.returned_date} onChange={(e) => set("returned_date", e.target.value)} data-testid="return-date" /></Field>
        <Field label="Time"><Input type="time" value={v.returned_time} onChange={(e) => set("returned_time", e.target.value)} data-testid="return-time" /></Field>
        <Field label="Returned by" hint="Who brought it back."><Input value={v.returned_by} onChange={(e) => set("returned_by", e.target.value)} data-testid="return-by" /></Field>
        <Field label="Received back by" hint="The blood bank tech."><Input value={v.received_back_by} onChange={(e) => set("received_back_by", e.target.value)} data-testid="return-received-by" /></Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <YesNo label={RETURN_UNUSED_STORAGE_LABEL} value={v.storage_ok} onChange={(x) => set("storage_ok", x)} testId="return-storage-ok" />
        <YesNo label={RETURN_UNUSED_PACKAGE_LABEL} value={v.package_ok_on_return} onChange={(x) => set("package_ok_on_return", x)} testId="return-package-ok" />
      </div>
      {refusal && <div role="alert" className="text-sm rounded-md border border-red-500/50 bg-red-500/10 text-red-800 dark:text-red-300 px-3 py-2" data-testid="return-unused-refusal">{refusal}</div>}
      <p className="text-sm font-medium pt-1">Where it goes back</p>
      <StorageFields units={units} v={v} set={set} prefix="return-" />
      <Field label="Note (optional)"><Textarea rows={2} value={v.note} onChange={(e) => set("note", e.target.value)} data-testid="return-note" /><NoPhiNotice /></Field>
      <ErrorLine text={err} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => post(v)} disabled={saving || !!refusal} data-testid="save-return-unused">{saving ? "Saving..." : "Put back in storage"}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)} data-testid="cancel-return-unused">Cancel</Button>
      </div>
    </CardContent></Card>
  );
}

function DisposeStep({ base, u, done }: { base: string; u: any; done: () => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Record<string, string>>({ kind: u.flags.expired_on_shelf ? "expired" : "", disposition_date: localToday(), disposition_time: localNow(), disposition_description: "", disposition_by: "" });
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  const { err, saving, post } = usePost(`${base}/units/${u.id}/dispose`, done);
  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="open-dispose">Other disposition (wasted, returned to supplier or expired)</Button>;
  return (
    <Card className="w-full"><CardContent className="p-5 space-y-3" data-testid="step-dispose">
      <h3 className="font-semibold">Other disposition</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Disposition"><select className={fieldClass} value={v.kind} onChange={(e) => set("kind", e.target.value)} data-testid="dispose-kind"><option value="">Choose</option>{Object.entries(OTHER_DISPOSITION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Performed by"><Input value={v.disposition_by} onChange={(e) => set("disposition_by", e.target.value)} data-testid="dispose-by" /></Field>
        <Field label="Date"><Input type="date" value={v.disposition_date} onChange={(e) => set("disposition_date", e.target.value)} data-testid="dispose-date" /></Field>
        <Field label="Time"><Input type="time" value={v.disposition_time} onChange={(e) => set("disposition_time", e.target.value)} data-testid="dispose-time" /></Field>
      </div>
      <Field label="Description of disposition"><Textarea rows={2} value={v.disposition_description} onChange={(e) => set("disposition_description", e.target.value)} data-testid="dispose-description" /><NoPhiNotice /></Field>
      <ErrorLine text={err} />
      <Button onClick={() => post(v)} disabled={saving} data-testid="save-dispose">{saving ? "Saving..." : "Record the disposition"}</Button>
    </CardContent></Card>
  );
}

// ── Correct a value, or undo the last step. Both need a reason; the history keeps what changed. ─
const DATE_FIELD = /_date$|reconstitution_expiration/;
const TIME_FIELD = /_time$/;
const YES_NO_FIELD = /^(transport_temp_ok|package_ok)$/;
const FREE_TEXT_FIELD = /^(notes|transport_action|disposition_description)$/;

function CorrectionStep({ base, u, done }: { base: string; u: any; done: () => void }) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [undoReason, setUndoReason] = useState("");
  const correct = usePost(`${base}/units/${u.id}/correct`, () => { setField(""); setValue(""); setReason(""); done(); });
  const undo = usePost(`${base}/units/${u.id}/undo`, () => { setUndoReason(""); done(); });
  const fields: string[] = (u.correctable_fields || []).filter((f: string) => f !== "storage_unit_id");
  const pick = (f: string) => { setField(f); setValue(u[f] == null ? "" : YES_NO_FIELD.test(f) ? (u[f] === 1 ? "yes" : "no") : String(u[f])); };
  if (!open) return <div><Button variant="ghost" size="sm" onClick={() => setOpen(true)} data-testid="open-correct">Correct this record</Button></div>;
  return (
    <Card><CardContent className="p-5 space-y-4" data-testid="step-correct">
      <div className="space-y-3">
        <h3 className="font-semibold">Correct a value</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Which value"><select className={fieldClass} value={field} onChange={(e) => pick(e.target.value)} data-testid="correct-field"><option value="">Choose</option>{fields.map((f) => <option key={f} value={f}>{TISSUE_FIELD_LABELS[f] || f}</option>)}</select></Field>
          {field && <Field label="Correct value">
            {YES_NO_FIELD.test(field) ? <select className={fieldClass} value={value} onChange={(e) => setValue(e.target.value)} data-testid="correct-value"><option value="yes">Yes</option><option value="no">No</option></select>
              : <Input type={DATE_FIELD.test(field) ? "date" : TIME_FIELD.test(field) ? "time" : "text"} value={value} onChange={(e) => setValue(e.target.value)} data-testid="correct-value" />}
            {FREE_TEXT_FIELD.test(field) && <NoPhiNotice />}
          </Field>}
        </div>
        <Field label="Reason for the correction"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="correct-reason" /><NoPhiNotice /></Field>
        <ErrorLine text={correct.err} />
        <Button variant="outline" size="sm" disabled={correct.saving || !field} onClick={() => correct.post({ reason, changes: { [field]: value } })} data-testid="save-correct">Save correction</Button>
      </div>
      {u.state !== "received_mm" && (
        <div className="space-y-3 border-t pt-4">
          <h3 className="font-semibold">Undo the last step</h3>
          <p className="text-sm text-muted-foreground">For a step recorded by mistake. This unit goes back one step, and the history keeps what was cleared.</p>
          <Field label="Reason for undoing it"><Textarea rows={2} value={undoReason} onChange={(e) => setUndoReason(e.target.value)} data-testid="undo-reason" /><NoPhiNotice /></Field>
          <ErrorLine text={undo.err} />
          <Button variant="outline" size="sm" disabled={undo.saving} onClick={() => undo.post({ reason: undoReason })} data-testid="save-undo"><Undo2 size={14} className="mr-1.5" />Undo last step</Button>
        </div>
      )}
    </CardContent></Card>
  );
}

const EVENT_LABELS: Record<string, string> = {
  received_mm: "Received in Materials Management", received_bb: "Received in blood bank", issued: "Issued", implanted: "Implanted",
  usage_card: "Tissue usage card", other_disposition: "Other disposition", returned_unused: "Returned unused to blood bank", corrected: "Corrected", undone: "Step undone",
};

function History({ events }: { events: any[] }) {
  return (
    <Card><CardContent className="p-5">
      <h3 className="font-semibold mb-2">History</h3>
      <ul className="text-sm space-y-1.5" data-testid="unit-history">
        {(events || []).map((e) => {
          let d: any = {};
          try { d = JSON.parse(e.detail_json || "{}") || {}; } catch { /* no detail */ }
          const reason: string | null = d.reason ?? null;
          const label = e.event_type === "undone" && d.undid === "returned_unused" ? `Step undone (${EVENT_LABELS.returned_unused})` : EVENT_LABELS[e.event_type] || e.event_type;
          return (
            <li key={e.id} className="break-words" data-testid={`history-${e.event_type}`}>
              <span className="font-medium">{label}</span>
              {e.event_type === "returned_unused" ? (
                <span>
                  : {dt(e.event_date, e.event_time)}. Brought back by {d.returned_by}, received by {d.received_back_by}. Storage conditions maintained: {yn(d.storage_ok)}. Package integrity acceptable: {yn(d.package_ok_on_return)}.
                  {d.cleared_issue?.issued_date && ` It had been issued ${dt(d.cleared_issue.issued_date, d.cleared_issue.issued_time)}${d.cleared_issue.delivered_to ? ` to ${d.cleared_issue.delivered_to}` : ""}.`}
                  {d.note && ` Note: ${d.note}`}
                </span>
              ) : (e.event_date || e.performed_by) && <span>: {[dt(e.event_date, e.event_time), e.performed_by].filter(Boolean).join(", ")}</span>}
              {reason && <span>. Reason: {reason}</span>}
              <span className="text-xs text-muted-foreground"> (entered by {e.recorded_by_name || "unknown"}, {new Date(e.created_at).toLocaleString()})</span>
            </li>
          );
        })}
      </ul>
    </CardContent></Card>
  );
}

// ── The lab's own catalog ────────────────────────────────────────────────
function CatalogView({ base, canEdit }: { base: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = [base, "catalog"];
  const { data, isLoading, error } = useQuery<any>({ queryKey: key, queryFn: () => api(`${base}/catalog`) });
  const [type, setType] = useState("");
  const [supplier, setSupplier] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editType, setEditType] = useState("");
  const [editSupplier, setEditSupplier] = useState("");
  const items: any[] = data?.items || [];
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); refresh(); return true; } catch (e: any) { setErr(e.message); return false; } };
  const add = async () => { if (await run(() => api(`${base}/catalog`, { method: "POST", json: { tissue_type: type, supplier_name: supplier } }))) { setType(""); setSupplier(""); } };
  const saveEdit = async () => { if (await run(() => api(`${base}/catalog/${editId}`, { method: "PUT", json: { tissue_type: editType, supplier_name: editSupplier } }))) setEditId(null); };
  return (
    <div className="space-y-4" data-testid="tissue-catalog">
      <p className="text-sm text-muted-foreground max-w-3xl">Your lab's own list of the tissue you receive and who supplies it. Receiving picks from this list. A supplier added here also appears in your Vendor Directory.</p>
      {canEdit && (
        <Card><CardContent className="p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Type of tissue"><Input value={type} onChange={(e) => setType(e.target.value)} data-testid="catalog-type" /></Field>
            <Field label="Supplier"><Input list="tissue-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} data-testid="catalog-supplier" /><datalist id="tissue-suppliers">{(data?.vendors || []).map((v: any) => <option key={v.id} value={v.name} />)}</datalist></Field>
          </div>
          <Button size="sm" onClick={add} data-testid="catalog-add"><Plus size={14} className="mr-1.5" />Add to catalog</Button>
        </CardContent></Card>
      )}
      <ErrorLine text={err} />
      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : error ? <ErrorLine text={(error as Error).message} /> : items.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Nothing on your catalog yet.</CardContent></Card>
      ) : (
        <div className="rounded-md border divide-y" data-testid="catalog-list">
          {items.map((i) => (
            <div key={i.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2" data-testid="catalog-row">
              {editId === i.id ? (
                <>
                  <Input className="sm:flex-1" value={editType} onChange={(e) => setEditType(e.target.value)} data-testid="catalog-edit-type" />
                  <Input className="sm:flex-1" list="tissue-suppliers" value={editSupplier} onChange={(e) => setEditSupplier(e.target.value)} data-testid="catalog-edit-supplier" />
                  <div className="flex gap-2"><Button size="sm" onClick={saveEdit} data-testid="catalog-save-edit">Save</Button><Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button></div>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium break-words">{i.tissue_type} {!i.active && <Badge variant="outline" className="ml-1">Retired</Badge>}</div>
                    <div className="text-xs text-muted-foreground break-words">{i.supplier_name}{i.unit_count ? `. ${i.unit_count} received` : ""}</div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setEditId(i.id); setEditType(i.tissue_type); setEditSupplier(i.supplier_name); }} data-testid="catalog-edit">Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => run(() => api(`${base}/catalog/${i.id}`, { method: "PUT", json: { active: i.active ? "no" : "yes" } }))} data-testid="catalog-retire">{i.active ? "Retire" : "Bring back"}</Button>
                      {!i.unit_count && <Button size="sm" variant="ghost" onClick={() => run(() => api(`${base}/catalog/${i.id}`, { method: "DELETE" }))} data-testid="catalog-delete">Delete</Button>}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
