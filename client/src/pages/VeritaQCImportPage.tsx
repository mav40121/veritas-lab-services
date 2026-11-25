// VeritaQC: control results from a CSV or Excel export (B12, 2026-11-24). Choose the file, match its columns, look at what every row would
// do, then import. Importing is VeritaQC edit only: a view-only seat reads the imports on file, and a Staff login gets a note.
// Server: server/qcFileImport.ts.
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { useCanRecord, useIsReadOnly } from "@/components/SubscriptionBanner";
import { useStaffOwnScope } from "@/hooks/useStaffLogin";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Lock, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { NAME_KIND_LABEL, QC_IMPORT_MAX_MB, QC_IMPORT_MAX_ROWS, readMapping, type QcImportMapping } from "@shared/qcImportRules";
import { emptyMapping, MappingForm } from "@/components/qcimport/MappingForm";
import { PreviewPanel, type ChosenName } from "@/components/qcimport/PreviewPanel";
import { ImportDetailDialog, ImportsList } from "@/components/qcimport/ImportsList";
import { importApi, num, plural, SELECT, sendForm, sendJson, type ImportRow, type Inspect, type Preview, type Setup } from "@/components/qcimport/importShared";

export default function VeritaQCImportPage() {
  const { user, isLoggedIn } = useAuth();
  const isReadOnly = useIsReadOnly("veritaqc");
  const canRecord = useCanRecord();
  const { ownOnly: staffLogin, ready } = useStaffOwnScope();
  const labId = useActiveLabId();
  const { toast } = useToast();
  const hasPlanAccess = !!user && [
    "annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "clinic", "waived", "community", "hospital", "large_hospital", "enterprise",
  ].includes(user.plan);
  const allowed = isLoggedIn && hasPlanAccess && !!labId && ready && !staffLogin;
  const canImport = allowed && !isReadOnly;

  const [setup, setSetup] = useState<Setup | null>(null);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<Inspect | null>(null);
  const [headerRow, setHeaderRow] = useState("");
  const [mapping, setMapping] = useState<QcImportMapping | null>(null);
  const [mappingName, setMappingName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function load() {
    if (!labId) return;
    try {
      const [s, l] = await Promise.all([canImport ? fetch(`${importApi(labId)}/setup`, { headers: authHeaders() }) : null, fetch(importApi(labId), { headers: authHeaders() })]);
      if ((s && !s.ok) || !l.ok) throw new Error();
      setSetup(s ? await s.json() : null); setImports((await l.json()).imports); setLoadError(false);
    } catch { setLoadError(true); }
  }
  useEffect(() => {
    setSetup(null); setImports([]); clearFile();
    if (allowed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labId, allowed, canImport]);

  function forget() { setFile(null); setInfo(null); setMapping(null); setPreview(null); setProblem(null); setMappingName(""); }
  function clearFile() { forget(); if (input.current) input.current.value = ""; }
  const refused = (r: { status: number; data: any }, otherwise: string) => { if (r.status === 0) clearFile(); setProblem(r.data.error || otherwise); };

  async function inspect(f: File, at: { sheet?: string | null; headerRow?: string } = {}, keep: QcImportMapping | null = null) {
    if (!labId) return;
    setBusy("inspect"); setProblem(null); setPreview(null);
    try {
      const r = await sendForm(`${importApi(labId)}/inspect`, f, { sheet: at.sheet || undefined, headerRow: at.headerRow || undefined });
      if (!r.ok) { refused(r, "The file couldn't be read."); setInfo(null); setMapping(null); return; }
      const i = r.data as Inspect;
      setInfo(i); setHeaderRow(String(i.header_row));
      setMapping(keep ? { ...keep, sheet: i.sheet, headerRow: i.header_row } : emptyMapping(i));
    } finally { setBusy(null); }
  }

  async function pick(f: File | null) {
    forget();
    if (!f) return;
    if (f.size > QC_IMPORT_MAX_MB * 1024 * 1024) { setProblem(`The file is too large (the limit is ${QC_IMPORT_MAX_MB} MB).`); return; }
    setFile(f);
    await inspect(f);
  }

  async function applySaved(id: string) {
    const m = setup?.mappings.find((x) => String(x.id) === id);
    if (!m || !file) return;
    setMappingName(m.name);
    await inspect(file, { sheet: m.mapping.sheet, headerRow: String(m.mapping.headerRow) }, m.mapping);
  }

  async function runPreview() {
    if (!labId || !file || !mapping) return;
    const { error } = readMapping(mapping);
    if (error) { setProblem(error); return; }
    setBusy("preview"); setProblem(null);
    try {
      const r = await sendForm(`${importApi(labId)}/preview`, file, { mapping: JSON.stringify(mapping) });
      if (!r.ok) { refused(r, "The preview couldn't be made."); setPreview(null); return; }
      setPreview(r.data);
    } finally { setBusy(null); }
  }

  async function saveMapping() {
    if (!labId || !mapping) return;
    setBusy("save");
    try {
      const r = await sendJson(`${importApi(labId)}/mappings`, "PUT", { name: mappingName, mapping });
      if (!r.ok) { setProblem(r.data.error || "The mapping couldn't be saved."); return; }
      setProblem(null);
      setSetup((s) => (s ? { ...s, mappings: r.data.mappings } : s));
      toast({ title: "Mapping saved", description: `The next file can use "${mappingName.trim()}".` });
    } finally { setBusy(null); }
  }

  async function saveNames(choices: ChosenName[]) {
    if (!labId) return;
    setBusy("names");
    try {
      const r = await sendJson(`${importApi(labId)}/names`, "PUT", { choices });
      if (!r.ok) { setProblem(r.data.error || "The names couldn't be saved."); return; }
      setSetup((s) => (s ? { ...s, names: r.data.names } : s));
    } finally { setBusy(null); }
    await runPreview();
  }

  async function doImport() {
    if (!labId || !file || !mapping || !preview) return;
    setConfirming(false); setBusy("import"); setProblem(null);
    try {
      const saved = setup?.mappings.find((m) => m.name.toLowerCase() === mappingName.trim().toLowerCase());
      const r = await sendForm(importApi(labId), file, {
        mapping: JSON.stringify(mapping), mapping_name: saved?.name, expected: JSON.stringify({ ...preview.counts, file_sha256: preview.file_sha256 }),
      });
      if (!r.ok) {
        if (r.status === 409) await runPreview(); // what changed is on the new preview, with why it was refused above it
        refused(r, "The import didn't go through. Nothing was stored.");
        return;
      }
      toast({ title: `${plural(r.data.counts.ready, "result")} imported`, description: r.data.need_corrective_action ? `${plural(r.data.need_corrective_action, "run needs", "runs need")} a corrective action.` : "No run needs a corrective action." });
      clearFile(); await load(); setOpenId(r.data.import_id);
    } finally { setBusy(null); }
  }

  if (isLoggedIn && !ready) return <div className="container mx-auto max-w-5xl px-4 py-8 text-sm text-muted-foreground">Loading...</div>;
  if (!allowed) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <Card><CardContent className="py-10 text-center">
          <Lock className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h2 className="mb-1 text-lg font-semibold">{!isLoggedIn ? "Sign in to use VeritaQC™" : !hasPlanAccess ? "VeritaQC™ requires a subscription" : !labId ? "Select a lab first" : "Imports aren't part of a staff login"}</h2>
          <p className="text-sm text-muted-foreground" data-testid="qcimport-staff">{isLoggedIn && hasPlanAccess && labId ? "Results are recorded one at a time on VeritaQC™." : ""}</p>
          {labId && <Button asChild variant="outline" size="sm" className="mt-4"><Link href={`/labs/${labId}/veritaqc-app`}>Back to VeritaQC™</Link></Button>}
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Upload className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">{canImport ? "Import QC results" : "Imported QC results"}</h1>
        <Button asChild variant="outline" size="sm" className="ml-auto"><Link href={`/labs/${labId}/veritaqc-app`}>Back to VeritaQC™</Link></Button>
      </div>
      {loadError && <Card className="mb-4"><CardContent className="py-4 text-sm">The import page couldn't load. <Button size="sm" variant="outline" onClick={load}>Retry</Button></CardContent></Card>}

      {!canImport && <p className="mb-4 text-sm text-muted-foreground" data-testid="qcimport-no-edit">You have view-only access to VeritaQC™, so you can read what has been imported. Importing needs edit access.</p>}
      {canImport && <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">1. Choose the file</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">A CSV or Excel export of control results from your analyzer, middleware or LIS. Up to {num(QC_IMPORT_MAX_ROWS)} results and {QC_IMPORT_MAX_MB} MB. No patient information: a file with a patient column is refused. The file itself isn't kept, only its name, its SHA-256 and the row numbers.</p>
          <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 sm:col-span-2"><Label htmlFor="qcimport-file" className="text-xs">File</Label><Input ref={input} id="qcimport-file" type="file" accept=".csv,.txt,.tsv,.xlsx" className="h-9 text-xs" onChange={(e) => pick(e.target.files?.[0] ?? null)} data-testid="qcimport-file" /></div>
            {info && info.sheets.length > 1 && file && (
              <div className="min-w-0"><Label htmlFor="qcimport-sheet" className="text-xs">Sheet</Label><select id="qcimport-sheet" className={SELECT} value={info.sheet ?? ""} onChange={(e) => inspect(file, { sheet: e.target.value })} data-testid="qcimport-sheet">{info.sheets.map((s) => <option key={s}>{s}</option>)}</select></div>
            )}
            {info && file && (
              <div className="min-w-0"><Label htmlFor="qcimport-header" className="text-xs">Column headings are in row</Label>
                <div className="flex gap-2"><Input id="qcimport-header" inputMode="numeric" className="h-9" value={headerRow} onChange={(e) => setHeaderRow(e.target.value)} data-testid="qcimport-header" /><Button size="sm" variant="outline" className="h-9" disabled={busy !== null || headerRow === String(info.header_row)} onClick={() => inspect(file, { sheet: info.sheet, headerRow })}>Use</Button></div>
              </div>
            )}
          </div>
          {busy === "inspect" && <p className="text-sm text-muted-foreground">Reading the file...</p>}
          {problem && <p className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-sm text-red-800 dark:text-red-300" role="alert" data-testid="qcimport-problem">{problem}</p>}
          {info && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground" data-testid="qcimport-read">{plural(info.data_rows, "row")} under the headings. The first {plural(info.sample.length, "row")}:</p>
              <div className="overflow-x-auto rounded-md border"><table className="text-xs">
                <thead className="border-b bg-muted text-left"><tr><th className="p-1.5">Row</th>{info.headers.map((h) => <th key={h} className="whitespace-nowrap p-1.5">{h}</th>)}</tr></thead>
                <tbody>{info.sample.map((s) => <tr key={s.row} className="border-b last:border-b-0"><td className="p-1.5 tabular-nums text-muted-foreground">{s.row}</td>{s.cells.map((c, i) => <td key={i} className="whitespace-nowrap p-1.5">{c}</td>)}</tr>)}</tbody>
              </table></div>
            </div>
          )}
        </CardContent>
      </Card>}

      {canImport && info && mapping && (
        <Card className="mb-4">
          <CardHeader><CardTitle className="text-base">2. Match the columns</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!!setup?.mappings.length && (
              <div className="max-w-sm"><Label htmlFor="qcimport-saved" className="text-xs">Use a saved mapping</Label>
                <select id="qcimport-saved" className={SELECT} value="" onChange={(e) => applySaved(e.target.value)} data-testid="qcimport-saved"><option value="">Choose...</option>{setup.mappings.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
            )}
            <MappingForm file={info} mapping={mapping} onChange={(m) => { setMapping(m); setPreview(null); }} instrumentNames={(setup?.instruments ?? []).map((i) => i.name)} />
            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end">
              <Button onClick={runPreview} disabled={busy !== null} data-testid="qcimport-preview-button">{busy === "preview" ? "Reading..." : "Preview"}</Button>
              <div className="flex min-w-0 flex-1 items-end gap-2 sm:justify-end">
                <div className="min-w-0 flex-1 sm:max-w-xs"><Label htmlFor="qcimport-name" className="text-xs">Save this mapping as</Label><Input id="qcimport-name" className="h-9" maxLength={80} value={mappingName} onChange={(e) => setMappingName(e.target.value)} placeholder="e.g. Chemistry middleware" data-testid="qcimport-mapping-name" /></div>
                <Button variant="outline" className="h-9" onClick={saveMapping} disabled={busy !== null || !mappingName.trim()} data-testid="qcimport-mapping-save">Save</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {canImport && preview && (
        <Card className="mb-4">
          <CardHeader><CardTitle className="text-base">3. Preview</CardTitle></CardHeader>
          <CardContent><PreviewPanel preview={preview} onSaveNames={saveNames} saving={busy === "names" || busy === "preview"} onImport={() => setConfirming(true)} importing={busy === "import"} /></CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Imports on file</CardTitle></CardHeader>
        <CardContent><ImportsList imports={imports} onOpen={setOpenId} /></CardContent>
      </Card>

      {canImport && setup && (setup.mappings.length > 0 || setup.names.length > 0) && (
        <Card>
          <CardHeader><CardTitle className="text-base">Saved mappings and remembered names</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {setup.mappings.length > 0 && (
              <ul className="space-y-1" data-testid="qcimport-mappings">{setup.mappings.map((m) => (
                <li key={m.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <ConfirmDialog title="Delete this mapping?" message={`"${m.name}" will no longer be offered. Imports already made aren't affected.`} onConfirm={async () => { const r = await sendJson(`${importApi(labId!)}/mappings/${m.id}`, "DELETE"); if (r.ok) setSetup((s) => (s ? { ...s, mappings: r.data.mappings } : s)); }}><Button size="sm" variant="ghost" className="h-7 px-2 text-xs">Delete</Button></ConfirmDialog></li>
              ))}</ul>
            )}
            {setup.names.length > 0 && (
              <details><summary className="cursor-pointer text-sm">Remembered names ({num(setup.names.length)})</summary>
                <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto" data-testid="qcimport-remembered">{setup.names.map((n) => (
                  <li key={n.id} className="flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 break-words">{NAME_KIND_LABEL[n.kind]} "{n.file_text}"{n.context_label ? ` (${n.context_label})` : ""} means {n.target}{n.chosen_by_name ? `, chosen by ${n.chosen_by_name}` : ""}</span>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={async () => { const r = await sendJson(`${importApi(labId!)}/names/${n.id}`, "DELETE"); if (r.ok) { setSetup((s) => (s ? { ...s, names: r.data.names } : s)); setPreview(null); } }}>Forget</Button></li>
                ))}</ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-md" data-testid="qcimport-confirm">
          <DialogHeader><DialogTitle>Import {preview ? plural(preview.counts.ready, "result") : ""}?</DialogTitle>
            <DialogDescription>{preview ? `${plural(preview.counts.ready, "result")} from ${preview.file_name} will be stored and judged by the lab's Westgard rules. ${num(preview.counts.duplicate)} duplicate and ${num(preview.counts.unplaced)} that can't be placed will be left out.` : ""}</DialogDescription></DialogHeader>
          <div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setConfirming(false)}>Cancel</Button><Button size="sm" onClick={doImport} data-testid="qcimport-confirm-go">Import</Button></div>
        </DialogContent>
      </Dialog>
      {labId && <ImportDetailDialog labId={labId} importId={openId} canRecord={canRecord} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
