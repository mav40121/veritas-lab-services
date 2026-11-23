// StewardshipTab.tsx
//
// VeritaQA(TM) Stewardship tab: the laboratory's share of the hospital's antibiotic stewardship program (parking lot #81;
// Michael 2026-11-23, Decision 14 = 2, the minimum version). The cumulative antibiogram from the LIS's aggregate totals (typed in
// or uploaded), kept as versions; the committee participation log with action items; the readiness view (CFR rows only); and
// the lab's antibiogram settings. Server: server/stewardship.ts. Rules: shared/antibiogramRules.ts. The server enforces every
// check; this page shows its reason where the person is working. No field here is for a patient.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { downloadPdfToken } from "@/lib/utils";
import { labTodayIso } from "@/lib/labDate";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, CircleAlert, Download, FileText, FlaskConical, Plus, Trash2, Upload, Users, ClipboardCheck, Settings2 } from "lucide-react";
import { ORGANISM_GROUP_LABELS, UPLOAD_COLUMNS_HELP, type AbgGroup, type OrganismGroup } from "@shared/antibiogramRules";

async function api(path: string, init?: RequestInit & { json?: unknown }) {
  const headers: Record<string, string> = { ...authHeaders() };
  let body = init?.body;
  if (init?.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(init.json); }
  const r = await fetch(`${API_BASE}${path}`, { ...init, headers, body });
  let data: any = null;
  try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) { const e: any = new Error(data?.error || `Request failed (${r.status})`); e.data = data; throw e; }
  if (data === null) throw new Error("The server returned an unexpected response. Reload and try again.");
  return data;
}

const fieldClass = "w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground";
const TEAL = "#01696F";

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function ErrorList({ error, errors }: { error: string | null; errors?: { line: number; message: string }[] }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-3 py-2 text-sm text-red-800 dark:text-red-300" data-testid="stewardship-error">
      <p>{error}</p>
      {errors && errors.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs space-y-0.5">
          {errors.slice(0, 12).map((e, i) => <li key={i}>Line {e.line}: {e.message}</li>)}
          {errors.length > 12 && <li>and {errors.length - 12} more</li>}
        </ul>
      )}
    </div>
  );
}

// ── The percent-susceptible table (organisms down, antimicrobials across), as on the approved mock ─────────────────
function cellClass(pct: number | null) {
  if (pct == null) return "";
  if (pct >= 90) return "bg-[#E7F1E1] dark:bg-green-950/40";
  if (pct >= 70) return "bg-[#FFF4E0] dark:bg-amber-950/40";
  return "bg-[#F9E3EE] dark:bg-pink-950/40";
}

export function AntibiogramTable({ table, threshold }: { table: AbgGroup[]; threshold: number }) {
  if (!table.length) return <p className="text-sm text-muted-foreground">No totals yet.</p>;
  return (
    <div className="space-y-4" data-testid="antibiogram-table">
      {table.map((g) => (
        <div key={g.group}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: TEAL }}>{g.label}</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-[#E6F2F2] dark:bg-teal-950/50 text-[#0A3A3D] dark:text-teal-100">
                  <th className="border border-border px-2 py-1 text-left min-w-[180px]">Organism</th>
                  <th className="border border-border px-2 py-1">Isolates</th>
                  {g.drugs.map((d) => <th key={d} className="border border-border px-1.5 py-1 font-semibold min-w-[70px]">{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {g.organisms.map((o) => (
                  <tr key={o.organism}>
                    <td className="border border-border px-2 py-1">
                      {o.organism}
                      {o.below && <span className="ml-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">fewer than {threshold}</span>}
                    </td>
                    <td className="border border-border px-2 py-1 text-center">{o.isolates}</td>
                    {g.drugs.map((d) => {
                      const c = o.cells[d];
                      if (!c) return <td key={d} className="border border-border bg-muted/50" />;
                      if (!c.shown) return <td key={d} className="border border-border text-center text-muted-foreground font-semibold" title={`${c.tested} tested, under ${threshold}`}>*</td>;
                      return (
                        <td key={d} className={`border border-border text-center ${cellClass(c.pct)} ${c.below ? "italic text-muted-foreground" : ""}`} title={`${c.susceptible} of ${c.tested} susceptible`}>
                          {c.pct}{c.below ? "†" : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Percent of isolates susceptible. Blank: not tested or not reported. * fewer than {threshold} isolates tested, percent not shown.
        {table.some((g) => g.organisms.some((o) => Object.values(o.cells).some((c) => c.below && c.shown))) && <> {"†"} fewer than {threshold} isolates tested, shown for reference.</>}
      </p>
    </div>
  );
}

// ── Antibiograms ─────────────────────────────────────────────────────────
interface GridRow { organism: string; organism_group: OrganismGroup; antimicrobial: string; tested: string; susceptible: string; intermediate: string; resistant: string }
const emptyRow = (): GridRow => ({ organism: "", organism_group: "gram_negative", antimicrobial: "", tested: "", susceptible: "", intermediate: "", resistant: "" });
const toGrid = (rows: any[]): GridRow[] => rows.map((r) => ({
  organism: r.organism, organism_group: r.organism_group, antimicrobial: r.antimicrobial,
  tested: String(r.tested ?? ""), susceptible: String(r.susceptible ?? ""), intermediate: r.intermediate == null ? "" : String(r.intermediate), resistant: r.resistant == null ? "" : String(r.resistant),
}));

function AntibiogramEditor({ base, id, readOnly, onChanged, onOpen }: { base: string; id: number; readOnly: boolean; onChanged: () => void; onOpen: (id: number | null) => void }) {
  const qc = useQueryClient();
  const { data, error: loadErr, refetch } = useQuery<any>({ queryKey: ["stewardship-abg", base, id], queryFn: () => api(`${base}/antibiograms/${id}`), retry: false });
  const [meta, setMeta] = useState({ title: "", period_start: "", period_end: "", source_filter: "", data_source: "" });
  const [grid, setGrid] = useState<GridRow[]>([]);
  // Each form shows the server's refusal (a patient-information refusal names the field) where it was sent: at = which form.
  type At = "top" | "meta" | "upload" | "grid" | "release";
  const [err, setErr] = useState<{ at: At; error: string | null; errors?: any[] }>({ at: "top", error: null });
  const errFor = (at: At) => (err.at === at ? <ErrorList error={err.error} errors={err.errors} /> : null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [release, setRelease] = useState<{ open: boolean; name: string; title: string }>({ open: false, name: "", title: "" });
  const [pdfBusy, setPdfBusy] = useState(false);
  const a = data?.antibiogram;
  const draft = a?.status === "draft";
  const canEdit = draft && !readOnly;

  // The form refills from what was saved whenever the saved values themselves change. Keyed on the content, not updated_at:
  // datetime('now') is to the second, so an upload saved in the second the draft was made left the grid empty, and its
  // Save totals would then have replaced the uploaded totals.
  const metaKey = a ? JSON.stringify([a.id, a.title, a.period_start, a.period_end, a.source_filter, a.data_source]) : "";
  const rowsKey = data ? JSON.stringify([a?.id, a?.status, data.rows]) : "";
  useEffect(() => {
    if (!a) return;
    setMeta({ title: a.title || "", period_start: a.period_start || "", period_end: a.period_end || "", source_filter: a.source_filter || "", data_source: a.data_source || "" });
  }, [metaKey]);
  useEffect(() => {
    if (!data) return;
    setGrid(data.rows.length ? toGrid(data.rows) : [emptyRow()]);
    setPreview(null); setCsvText(null);
  }, [rowsKey]);

  const run = async (at: At, fn: () => Promise<any>, after?: (r: any) => void) => {
    setBusy(true); setErr({ at, error: null });
    try { const r = await fn(); after?.(r); await refetch(); onChanged(); }
    catch (e: any) { setErr({ at, error: e.message, errors: e.data?.errors }); }
    finally { setBusy(false); }
  };

  if (loadErr) return <ErrorList error={(loadErr as any).message} />;
  if (!a) return <p className="text-sm text-muted-foreground">Loading...</p>;

  const saveMeta = () => run("meta", () => api(`${base}/antibiograms/${id}`, { method: "PUT", json: meta }));
  const saveGrid = () => run("grid", () => api(`${base}/antibiograms/${id}/rows`, { method: "PUT", json: { rows: grid.filter((r) => r.organism || r.antimicrobial || r.tested || r.susceptible) } }));
  const onFile = async (f: File | null) => {
    if (!f) return;
    const text = await f.text();
    setCsvText(text);
    setBusy(true); setErr({ at: "upload", error: null });
    try { setPreview(await api(`${base}/antibiograms/${id}/upload`, { method: "POST", json: { csv: text, preview: true } })); }
    catch (e: any) { setPreview(null); setErr({ at: "upload", error: e.message, errors: e.data?.errors }); }
    finally { setBusy(false); }
  };
  const confirmUpload = () => run("upload", () => api(`${base}/antibiograms/${id}/upload`, { method: "POST", json: { csv: csvText } }), () => { setPreview(null); setCsvText(null); });
  const doRelease = () => run("release", () => api(`${base}/antibiograms/${id}/release`, { method: "POST", json: { released_by_name: release.name, released_by_title: release.title } }), () => setRelease({ open: false, name: "", title: "" }));
  const newVersion = () => run("top", () => api(`${base}/antibiograms/${id}/new-version`, { method: "POST" }), (r) => onOpen(r.id));
  const del = () => { if (window.confirm("Delete this draft? Its totals are removed.")) run("top", () => api(`${base}/antibiograms/${id}`, { method: "DELETE" }), () => { qc.removeQueries({ queryKey: ["stewardship-abg", base, id] }); onOpen(null); }); };
  const excel = async () => {
    setErr({ at: "top", error: null });
    try { const r = await api(`${base}/antibiograms/${id}/xlsx`, { method: "POST", json: {} }); downloadPdfToken(r.token, r.filename); }
    catch (e: any) { setErr({ at: "top", error: e.message }); }
  };
  // The PDF (Michael approved the mock 2026-11-23), fetched with the sign-in header; a draft prints DRAFT.
  const downloadPdf = async () => {
    setPdfBusy(true); setErr({ at: "top", error: null });
    try {
      const r = await fetch(`${API_BASE}${base}/antibiograms/${id}/pdf`, { headers: authHeaders() });
      if (!r.ok) {
        let msg = `Request failed (${r.status})`;
        try { msg = (await r.json())?.error || msg; } catch { /* not JSON */ }
        throw new Error(msg);
      }
      const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "")?.[1] || `VeritaQA_Antibiogram_${id}.pdf`;
      const url = URL.createObjectURL(await r.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e: any) { setErr({ at: "top", error: e.message }); } finally { setPdfBusy(false); }
  };
  const setCell = (i: number, k: keyof GridRow, v: string) => setGrid((g) => g.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <Card data-testid="antibiogram-editor">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{a.title} <span className="text-muted-foreground font-normal">version {a.version}</span></CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {a.period_start} to {a.period_end}{a.source_filter ? `, ${a.source_filter}` : ""}.{" "}
              {draft ? <span className="font-semibold text-amber-700 dark:text-amber-400">Draft</span>
                : <span className="font-semibold text-green-700 dark:text-green-400" data-testid="released-line">Released {a.released_day}, approved by {a.released_by_name}, {a.released_by_title}</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={downloadPdf} disabled={busy || pdfBusy} data-testid="abg-pdf"><FileText size={14} className="mr-1" />{pdfBusy ? "Building..." : "Download PDF"}</Button>
            <Button size="sm" variant="outline" onClick={excel} disabled={busy || !data.rows.length} data-testid="abg-excel"><Download size={14} className="mr-1" />Excel</Button>
            {!draft && !readOnly && <Button size="sm" variant="outline" onClick={newVersion} disabled={busy} data-testid="abg-new-version">Start a new version</Button>}
            {canEdit && <Button size="sm" variant="outline" onClick={del} disabled={busy} data-testid="abg-delete"><Trash2 size={14} className="mr-1" />Delete draft</Button>}
            <Button size="sm" variant="ghost" onClick={() => onOpen(null)}>Close</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {errFor("top")}

        {canEdit && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <Field label="Title"><Input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></Field>
            <Field label="Period starts"><input type="date" className={fieldClass} value={meta.period_start} onChange={(e) => setMeta({ ...meta, period_start: e.target.value })} /></Field>
            <Field label="Period ends"><input type="date" className={fieldClass} value={meta.period_end} onChange={(e) => setMeta({ ...meta, period_end: e.target.value })} /></Field>
            <Field label="Specimen sources"><Input value={meta.source_filter} placeholder="All sources" onChange={(e) => setMeta({ ...meta, source_filter: e.target.value })} /></Field>
            <Field label="Data source"><Input value={meta.data_source} placeholder="LIS antibiogram report" onChange={(e) => setMeta({ ...meta, data_source: e.target.value })} /></Field>
            <div className="lg:col-span-5 space-y-2" data-testid="abg-meta-form">{errFor("meta")}<Button size="sm" variant="outline" onClick={saveMeta} disabled={busy} data-testid="abg-meta-save">Save details</Button></div>
          </div>
        )}

        {canEdit && (
          <div className="rounded-md border border-dashed border-border p-3 space-y-2">
            <p className="text-sm font-medium flex items-center gap-1.5"><Upload size={14} style={{ color: TEAL }} />Upload the totals from the LIS antibiogram report (CSV)</p>
            <p className="text-xs text-muted-foreground">Columns: {UPLOAD_COLUMNS_HELP}. Totals only: the LIS removes repeat isolates from the same patient before export. A file with any other column, such as a patient name or record number, is refused.</p>
            <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0] ?? null)} data-testid="abg-csv-input" className="text-sm" />
            {errFor("upload")}
            {preview && (
              <div className="space-y-2" data-testid="abg-upload-preview">
                <p className="text-sm">{preview.row_count} rows read. Check the table, then save it. Saving replaces the totals below.</p>
                <AntibiogramTable table={preview.table} threshold={data.rule.threshold} />
                <div className="flex gap-2">
                  <Button size="sm" style={{ backgroundColor: TEAL }} className="text-white" onClick={confirmUpload} disabled={busy} data-testid="abg-upload-save">Save these totals</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setPreview(null); setCsvText(null); }}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {canEdit && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Or type the totals</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse" data-testid="abg-grid">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="px-1 py-1">Organism</th><th className="px-1 py-1">Group</th><th className="px-1 py-1">Antimicrobial</th>
                    <th className="px-1 py-1">Tested</th><th className="px-1 py-1">Susceptible</th><th className="px-1 py-1">Intermediate</th><th className="px-1 py-1">Resistant</th><th />
                  </tr>
                </thead>
                <tbody>
                  {grid.map((r, i) => (
                    <tr key={i}>
                      <td className="px-1 py-0.5 min-w-[170px]"><Input className="h-8 text-xs" value={r.organism} onChange={(e) => setCell(i, "organism", e.target.value)} aria-label={`Organism, row ${i + 1}`} /></td>
                      <td className="px-1 py-0.5 min-w-[140px]">
                        <select className={`${fieldClass} h-8 text-xs`} value={r.organism_group} onChange={(e) => setCell(i, "organism_group", e.target.value)} aria-label={`Group, row ${i + 1}`}>
                          {(Object.keys(ORGANISM_GROUP_LABELS) as OrganismGroup[]).map((g) => <option key={g} value={g}>{ORGANISM_GROUP_LABELS[g].replace(" organisms", "")}</option>)}
                        </select>
                      </td>
                      <td className="px-1 py-0.5 min-w-[150px]"><Input className="h-8 text-xs" value={r.antimicrobial} onChange={(e) => setCell(i, "antimicrobial", e.target.value)} aria-label={`Antimicrobial, row ${i + 1}`} /></td>
                      {(["tested", "susceptible", "intermediate", "resistant"] as const).map((k) => (
                        <td key={k} className="px-1 py-0.5 w-20"><Input className="h-8 text-xs" inputMode="numeric" value={r[k]} onChange={(e) => setCell(i, k, e.target.value)} aria-label={`${k}, row ${i + 1}`} /></td>
                      ))}
                      <td className="px-1"><Button size="sm" variant="ghost" onClick={() => setGrid((g) => (g.length > 1 ? g.filter((_, j) => j !== i) : [emptyRow()]))} aria-label={`Remove row ${i + 1}`}><Trash2 size={13} /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {errFor("grid")}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setGrid((g) => [...g, { ...emptyRow(), organism_group: g[g.length - 1]?.organism_group ?? "gram_negative", organism: g[g.length - 1]?.organism ?? "" }])}><Plus size={13} className="mr-1" />Add row</Button>
              <Button size="sm" style={{ backgroundColor: TEAL }} className="text-white" onClick={saveGrid} disabled={busy} data-testid="abg-grid-save">Save totals</Button>
            </div>
          </div>
        )}

        <div>
          <p className="text-sm font-medium mb-2">The antibiogram</p>
          <AntibiogramTable table={data.table} threshold={data.rule.threshold} />
          <p className="text-xs text-muted-foreground mt-2">Isolates counted: {data.rule.note}</p>
        </div>

        {canEdit && (
          <div className="rounded-md border border-border p-3 space-y-2">
            {!release.open ? (
              <Button size="sm" style={{ backgroundColor: TEAL }} className="text-white" onClick={() => setRelease({ ...release, open: true })} disabled={busy || !data.rows.length} data-testid="abg-release-open">Record the release</Button>
            ) : (
              <div className="space-y-2" data-testid="abg-release-form">
                <p className="text-sm">The medical director or designee approves the release. Once released, this version is locked; a change starts a new version.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Approved by (name)"><Input value={release.name} onChange={(e) => setRelease({ ...release, name: e.target.value })} /></Field>
                  <Field label="Title"><Input value={release.title} placeholder="Medical Director" onChange={(e) => setRelease({ ...release, title: e.target.value })} /></Field>
                </div>
                {errFor("release")}
                <div className="flex gap-2">
                  <Button size="sm" style={{ backgroundColor: TEAL }} className="text-white" onClick={doRelease} disabled={busy || !release.name.trim() || !release.title.trim()} data-testid="abg-release-confirm">Release this version</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRelease({ open: false, name: "", title: "" })}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AntibiogramsSection({ base, readOnly }: { base: string; readOnly: boolean }) {
  const { data, refetch } = useQuery<any>({ queryKey: ["stewardship-abgs", base], queryFn: () => api(`${base}/antibiograms`), retry: false });
  const [openId, setOpenId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: "", period_start: "", period_end: "", source_filter: "", data_source: "" });
  const [showNew, setShowNew] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const items: any[] = data?.items ?? [];
  const create = async () => {
    setErr(null);
    try { const r = await api(`${base}/antibiograms`, { method: "POST", json: form }); setShowNew(false); setForm({ title: "", period_start: "", period_end: "", source_filter: "", data_source: "" }); await refetch(); setOpenId(r.id); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2"><FlaskConical size={16} style={{ color: TEAL }} />Cumulative antibiograms</CardTitle>
            {!readOnly && <Button size="sm" variant="outline" onClick={() => setShowNew((v) => !v)} data-testid="abg-new"><Plus size={14} className="mr-1" />New antibiogram</Button>}
          </div>
          <p className="text-xs text-muted-foreground">Built from your LIS's antibiogram totals. Each released version is kept as the lab's record.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {showNew && (
            <div className="rounded-md border border-border p-3 space-y-3" data-testid="abg-new-form">
              <ErrorList error={err} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <Field label="Title"><Input value={form.title} placeholder="2025 antibiogram" onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
                <Field label="Period starts"><input type="date" className={fieldClass} value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} /></Field>
                <Field label="Period ends"><input type="date" className={fieldClass} value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} /></Field>
                <Field label="Specimen sources"><Input value={form.source_filter} placeholder="All sources" onChange={(e) => setForm({ ...form, source_filter: e.target.value })} /></Field>
                <Field label="Data source"><Input value={form.data_source} placeholder="LIS antibiogram report" onChange={(e) => setForm({ ...form, data_source: e.target.value })} /></Field>
              </div>
              <Button size="sm" style={{ backgroundColor: TEAL }} className="text-white" onClick={create} data-testid="abg-create">Create draft</Button>
            </div>
          )}
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="abg-empty">No antibiograms yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="abg-list">
                <thead><tr className="text-left text-xs text-muted-foreground border-b"><th className="py-1.5 pr-2">Title</th><th className="pr-2">Period</th><th className="pr-2">Version</th><th className="pr-2">Status</th><th className="pr-2">Rows</th><th /></tr></thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id} className={`border-b last:border-0 ${openId === i.id ? "bg-muted/40" : ""}`}>
                      <td className="py-1.5 pr-2">{i.title}</td>
                      <td className="pr-2 whitespace-nowrap">{i.period_start} to {i.period_end}</td>
                      <td className="pr-2">{i.version}</td>
                      <td className="pr-2">{i.status === "released" ? <span className="text-green-700 dark:text-green-400 font-medium">Released {i.released_day}</span> : <span className="text-amber-700 dark:text-amber-400 font-medium">Draft</span>}</td>
                      <td className="pr-2">{i.row_count}</td>
                      <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setOpenId(i.id)} data-testid={`abg-open-${i.id}`}>Open</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      {openId != null && <AntibiogramEditor base={base} id={openId} readOnly={readOnly} onChanged={() => refetch()} onOpen={setOpenId} />}
    </div>
  );
}

// ── Committee log ─────────────────────────────────────────────────────────
function CommitteeSection({ base, readOnly }: { base: string; readOnly: boolean }) {
  const { data, refetch } = useQuery<any>({ queryKey: ["stewardship-meetings", base], queryFn: () => api(`${base}/meetings`), retry: false });
  const [form, setForm] = useState({ meeting_date: labTodayIso(), lab_representative: "", minutes_link: "", notes: "" });
  const [actionForms, setActionForms] = useState<Record<number, { action: string; owner: string; due_date: string }>>({});
  // The server's refusal shows on the form that sent it: "meeting" (the new meeting form) or the meeting id whose action form or row sent it.
  const [err, setErr] = useState<{ at: string; error: string | null }>({ at: "", error: null });
  const today = labTodayIso();
  const run = async (at: string, fn: () => Promise<any>) => { setErr({ at, error: null }); try { await fn(); await refetch(); } catch (e: any) { setErr({ at, error: e.message }); } };
  const errFor = (at: string) => (err.at === at ? <ErrorList error={err.error} /> : null);
  const items: any[] = data?.items ?? [];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Users size={16} style={{ color: TEAL }} />Stewardship committee participation</CardTitle>
        <p className="text-xs text-muted-foreground">Each meeting the laboratory attended, who represented it, a link to the minutes, and the action items it took on.</p>
      </CardHeader>
      <CardContent className="space-y-4">

        {!readOnly && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end" data-testid="meeting-form">
            <Field label="Meeting date"><input type="date" className={fieldClass} value={form.meeting_date} onChange={(e) => setForm({ ...form, meeting_date: e.target.value })} /></Field>
            <Field label="Laboratory representative"><Input value={form.lab_representative} onChange={(e) => setForm({ ...form, lab_representative: e.target.value })} /></Field>
            <Field label="Minutes link (optional)"><Input value={form.minutes_link} placeholder="https://" onChange={(e) => setForm({ ...form, minutes_link: e.target.value })} /></Field>
            <Field label="Notes (optional)"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <div className="lg:col-span-4 space-y-2">{errFor("meeting")}<Button size="sm" style={{ backgroundColor: TEAL }} className="text-white" onClick={() => run("meeting", async () => { await api(`${base}/meetings`, { method: "POST", json: form }); setForm({ meeting_date: today, lab_representative: "", minutes_link: "", notes: "" }); })} data-testid="meeting-add"><Plus size={14} className="mr-1" />Log meeting</Button></div>
          </div>
        )}
        {items.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="meeting-empty">No meetings logged yet.</p> : (
          <div className="space-y-3" data-testid="meeting-list">
            {items.map((m) => {
              const af = actionForms[m.id] ?? { action: "", owner: "", due_date: "" };
              return (
                <div key={m.id} className="rounded-md border border-border p-3 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{m.meeting_date}: {m.lab_representative}</p>
                      {m.minutes_link && <a href={m.minutes_link} target="_blank" rel="noopener noreferrer" className="text-xs underline" style={{ color: TEAL }}>Minutes</a>}
                      {m.notes && <p className="text-xs text-muted-foreground">{m.notes}</p>}
                    </div>
                    {!readOnly && <Button size="sm" variant="ghost" onClick={() => { if (window.confirm("Remove this meeting and its action items?")) run(`m${m.id}`, () => api(`${base}/meetings/${m.id}`, { method: "DELETE" })); }} aria-label="Remove meeting"><Trash2 size={13} /></Button>}
                  </div>
                  {m.actions.length > 0 && (
                    <ul className="space-y-1">
                      {m.actions.map((a: any) => {
                        const late = a.status === "open" && a.due_date && a.due_date < today;
                        return (
                          <li key={a.id} className="flex flex-wrap items-center gap-2 text-xs">
                            <span className={`font-semibold ${a.status === "done" ? "text-green-700 dark:text-green-400" : late ? "text-[#A12C7B] dark:text-pink-400" : "text-amber-700 dark:text-amber-400"}`}>{a.status === "done" ? `Done ${a.completed_on ?? ""}` : late ? "Past due" : "Open"}</span>
                            <span>{a.action}</span>
                            {a.owner && <span className="text-muted-foreground">Owner: {a.owner}</span>}
                            {a.due_date && <span className="text-muted-foreground">Due {a.due_date}</span>}
                            {!readOnly && (a.status === "open"
                              ? <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => run(`m${m.id}`, () => api(`${base}/actions/${a.id}`, { method: "PUT", json: { status: "done", completed_on: today } }))}>Mark done</Button>
                              : <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => run(`m${m.id}`, () => api(`${base}/actions/${a.id}`, { method: "PUT", json: { status: "open" } }))}>Reopen</Button>)}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {errFor(`m${m.id}`)}
                  {!readOnly && (
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end" data-testid={`action-form-${m.id}`}>
                      <Input className="h-8 text-xs sm:col-span-2" placeholder="Action item" value={af.action} onChange={(e) => setActionForms({ ...actionForms, [m.id]: { ...af, action: e.target.value } })} aria-label="Action item" />
                      <Input className="h-8 text-xs" placeholder="Owner" value={af.owner} onChange={(e) => setActionForms({ ...actionForms, [m.id]: { ...af, owner: e.target.value } })} aria-label="Owner" />
                      <div className="flex gap-2">
                        <input type="date" className={`${fieldClass} h-8 text-xs`} value={af.due_date} onChange={(e) => setActionForms({ ...actionForms, [m.id]: { ...af, due_date: e.target.value } })} aria-label="Due date" />
                        <Button size="sm" variant="outline" className="h-8" onClick={() => run(`m${m.id}`, async () => { await api(`${base}/meetings/${m.id}/actions`, { method: "POST", json: af }); setActionForms({ ...actionForms, [m.id]: { action: "", owner: "", due_date: "" } }); })} aria-label="Add action item"><Plus size={13} /></Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Readiness (CFR rows only) ───────────────────────────────────────────────
function ReadinessSection({ base }: { base: string }) {
  const { data, error } = useQuery<any>({ queryKey: ["stewardship-readiness", base], queryFn: () => api(`${base}/readiness`), retry: false });
  if (error) return <ErrorList error={(error as any).message} />;
  if (!data) return <p className="text-sm text-muted-foreground">Loading...</p>;
  return (
    <Card data-testid="readiness">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><ClipboardCheck size={16} style={{ color: TEAL }} />Readiness</CardTitle>
        <p className="text-xs text-muted-foreground">What the laboratory can show for its part in the hospital's antibiotic stewardship program, as of {data.today}.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {data.items.map((i: any) => (
            <li key={i.key} className="flex gap-2 text-sm" data-testid={`readiness-${i.key}`} data-state={i.state}>
              {i.state === "met" ? <CheckCircle2 size={16} className="text-green-700 dark:text-green-400 shrink-0 mt-0.5" /> : <CircleAlert size={16} className="text-[#A12C7B] dark:text-pink-400 shrink-0 mt-0.5" />}
              <div><p className="font-medium">{i.label}</p><p className="text-xs text-muted-foreground">{i.detail}</p></div>
            </li>
          ))}
        </ul>
        <div className="space-y-3">
          {data.cfr.map((c: any) => (
            <div key={c.key} className="rounded-md border border-border p-3">
              <p className="text-xs font-semibold" style={{ color: TEAL }}>{c.citation} ({c.applies_to})</p>
              <p className="text-xs text-muted-foreground mt-1">{c.lead}</p>
              <p className="text-sm mt-1">{c.text}</p>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Regulation text from eCFR, current as of {data.cfr_as_of}. The Joint Commission and CAP rows are added once their standard text is verified.</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────
function SettingsSection({ base }: { base: string }) {
  const { data, refetch } = useQuery<any>({ queryKey: ["stewardship-settings", base], queryFn: () => api(`${base}/settings`), retry: false });
  const [form, setForm] = useState<any>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  useEffect(() => { if (data?.settings) setForm({ ...data.settings }); }, [data?.settings?.isolate_threshold, data?.settings?.below_threshold, data?.settings?.period_months, data?.settings?.first_isolate_note]);
  if (!data || !form) return <p className="text-sm text-muted-foreground">Loading...</p>;
  const canEdit = !!data.can_edit;
  const save = async () => {
    setMsg({});
    try { await api(`${base}/settings`, { method: "PUT", json: { ...form, isolate_threshold: Number(form.isolate_threshold), period_months: Number(form.period_months) } }); await refetch(); setMsg({ ok: "Saved." }); }
    catch (e: any) { setMsg({ err: e.message }); }
  };
  return (
    <Card data-testid="stewardship-settings">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Settings2 size={16} style={{ color: TEAL }} />Antibiogram settings</CardTitle>
        <p className="text-xs text-muted-foreground">The laboratory's own rules for its antibiogram. A released version keeps the rules it was released under.{canEdit ? "" : " Only the lab's owner or an admin can change them."}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorList error={msg.err ?? null} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Fewest isolates to report a percent"><Input type="number" min={1} value={form.isolate_threshold} disabled={!canEdit} onChange={(e) => setForm({ ...form, isolate_threshold: e.target.value })} data-testid="setting-threshold" /></Field>
          <Field label="Below that number">
            <select className={fieldClass} value={form.below_threshold} disabled={!canEdit} onChange={(e) => setForm({ ...form, below_threshold: e.target.value })} data-testid="setting-mode">
              <option value="suppress">Don't show the percent</option>
              <option value="flag">Show it, marked</option>
            </select>
          </Field>
          <Field label="Analysis period (months)"><Input type="number" min={1} max={36} value={form.period_months} disabled={!canEdit} onChange={(e) => setForm({ ...form, period_months: e.target.value })} /></Field>
        </div>
        <Field label="How repeat isolates are removed"><Textarea rows={2} value={form.first_isolate_note} disabled={!canEdit} onChange={(e) => setForm({ ...form, first_isolate_note: e.target.value })} /></Field>
        {canEdit && <div className="flex items-center gap-3"><Button size="sm" style={{ backgroundColor: TEAL }} className="text-white" onClick={save} data-testid="setting-save">Save settings</Button>{msg.ok && <span className="text-xs text-green-700 dark:text-green-400">{msg.ok}</span>}</div>}
      </CardContent>
    </Card>
  );
}

// ── The tab ───────────────────────────────────────────────────────────────
type Section = "antibiograms" | "committee" | "readiness" | "settings";
const SECTIONS: { key: Section; label: string }[] = [
  { key: "antibiograms", label: "Antibiograms" }, { key: "committee", label: "Committee log" }, { key: "readiness", label: "Readiness" }, { key: "settings", label: "Settings" },
];

export default function StewardshipTab({ readOnly }: { readOnly: boolean }) {
  const labId = useActiveLabId();
  const [section, setSection] = useState<Section>("antibiograms");
  const base = useMemo(() => (labId ? `/api/labs/${labId}/veritaqa/stewardship` : null), [labId]);
  if (!base) return <p className="text-sm text-muted-foreground">Choose a lab to see its stewardship records.</p>;
  return (
    <div className="space-y-4" data-testid="stewardship-tab">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: TEAL }}>Antimicrobial stewardship</h2>
        <p className="text-sm text-muted-foreground">The laboratory's share of the hospital's antibiotic stewardship program: the cumulative antibiogram, the lab's participation in the committee, and what it can show. Totals only; no patient records.</p>
      </div>
      <div className="flex flex-wrap gap-1" role="tablist">
        {SECTIONS.map((s) => (
          <button key={s.key} role="tab" aria-selected={section === s.key} onClick={() => setSection(s.key)} data-testid={`stewardship-section-${s.key}`}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${section === s.key ? "border-[#01696F] text-[#01696F] bg-[#E6F2F2] dark:bg-teal-950/40 dark:text-teal-200" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {s.label}
          </button>
        ))}
      </div>
      {section === "antibiograms" && <AntibiogramsSection base={base} readOnly={readOnly} />}
      {section === "committee" && <CommitteeSection base={base} readOnly={readOnly} />}
      {section === "readiness" && <ReadinessSection base={base} />}
      {section === "settings" && <SettingsSection base={base} />}
    </div>
  );
}
