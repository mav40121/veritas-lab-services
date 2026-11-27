// VeritaQC file import (B12): the imports on file, one import's runs, the corrective actions its rejections need, and taking an import back.
import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/auth";
import { API_BASE } from "@/lib/queryClient";
import { labStampLabel } from "@/lib/labDate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { importApi, num, plural, sendJson, type ImportRow } from "./importShared";

interface Run {
  id: number; import_row: number; import_column: string | null; import_operator: string | null; instrument: string | null; result_value: number; result_date: string; run_time: string | null;
  analyte: string; level: string; lot_number: string; voided_at: string | null; has_corrective_action: boolean; added_after_review: string | null; accepted_for_reporting: number;
  violations: Array<{ id: number; rule_code: string; severity: string; detail: string | null }>;
}
interface Stay { id: number; import_row: number; import_column: string | null; analyte: string; level: string; lot_number: string; result_date: string; run_time: string | null; result_value: number; why: string }
interface Detail { import: ImportRow & { duplicate_rows: number[]; unplaced_rows: number[] }; runs: Run[]; undo: { will_void: number; stays: Stay[] }; can_import: boolean }

const runName = (r: { analyte: string; level: string; lot_number: string; result_date: string; run_time: string | null; result_value: number }) =>
  `${r.analyte} ${r.level}, lot ${r.lot_number}, ${r.result_date}${r.run_time ? ` ${r.run_time}` : ""}, ${r.result_value}`;
const rejects = (r: Run) => !r.voided_at && r.violations.some((v) => v.severity === "rejection");

function NeedsAction({ labId, run, canRecord, onFiled }: { labId: number; run: Run; canRecord: boolean; onFiled: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const rule = run.violations.find((v) => v.severity === "rejection")!;
  async function file() {
    setBusy(true);
    try {
      const r = await sendJson(`${API_BASE}/api/labs/${labId}/qc/corrective-actions`, "POST", { qc_result_id: run.id, qc_rule_violation_id: rule.id, action_taken: text.trim() });
      if (!r.ok) { toast({ title: r.data.error || "Could not file the corrective action", variant: "destructive" }); return; }
      toast({ title: "Corrective action filed" });
      onFiled();
    } finally { setBusy(false); }
  }
  return (
    <li className="space-y-1 rounded-md border p-2" data-testid={`import-needs-ca-${run.id}`}>
      <div className="text-sm"><Badge variant="outline" className="mr-2 border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-300">{rule.rule_code}</Badge>{runName(run)}</div>
      <div className="text-xs text-muted-foreground">Row {run.import_row}{run.import_column ? `, ${run.import_column}` : ""}. {rule.detail}</div>
      {canRecord && <div className="flex flex-col gap-2 sm:flex-row">
        <Input className="h-9" value={text} onChange={(e) => setText(e.target.value)} placeholder="What was done" aria-label={`Corrective action for ${runName(run)}`} data-testid={`import-ca-text-${run.id}`} />
        <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={file} disabled={busy || !text.trim()} data-testid={`import-ca-file-${run.id}`}>File corrective action</Button>
      </div>}
    </li>
  );
}

export function ImportDetailDialog({ labId, importId, canRecord, onClose, onChanged }: { labId: number; importId: number | null; canRecord: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(100);
  async function load() {
    if (!importId) return;
    const r = await fetch(`${importApi(labId)}/${importId}`, { headers: authHeaders() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error || "Could not load the import"); return; }
    setError(null); setData(j);
  }
  useEffect(() => { setData(null); setError(null); setUndoing(false); setReason(""); setShown(100); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [importId, labId]);
  if (!importId) return null;
  async function takeBack() {
    if (!data) return;
    setBusy(true);
    try {
      const r = await sendJson(`${importApi(labId)}/${importId}/undo`, "POST", { reason: reason.trim(), expected_void: data.undo.will_void });
      if (!r.ok) { toast({ title: r.data.error || "Could not take the import back", variant: "destructive" }); await load(); return; }
      toast({ title: `${plural(r.data.voided, "run")} taken back`, description: r.data.stays?.length ? `${plural(r.data.stays.length, "run stays", "runs stay")}.` : undefined });
      setUndoing(false); await load(); onChanged();
    } finally { setBusy(false); }
  }
  const imp = data?.import;
  const needs = data?.runs.filter((r) => rejects(r) && !r.has_corrective_action) ?? [];
  const rowList = (rows: number[]) => (rows.length > 60 ? `${rows.slice(0, 60).join(", ")} and ${num(rows.length - 60)} more` : rows.join(", "));
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto" data-testid="import-dialog">
        <DialogHeader>
          <DialogTitle className="break-words pr-6">{imp ? imp.file_name : "Import"}</DialogTitle>
          <DialogDescription>{imp ? `Imported by ${imp.imported_by_name} on ${labStampLabel(imp.imported_at)}` : "Loading"}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
        {!data && !error && <p className="text-sm text-muted-foreground">Loading...</p>}
        {data && imp && (
          <div className="min-w-0 space-y-4">
            <div className="space-y-1 text-sm">
              <p data-testid="import-summary">{plural(imp.run_count, "result")} stored, {plural(imp.duplicate_count, "duplicate")} and {num(imp.unplaced_count)} that couldn't be placed left out.{imp.mapping_name ? ` Mapping: ${imp.mapping_name}.` : ""}</p>
              <p className="break-all text-xs text-muted-foreground">SHA-256 of the file: {imp.file_sha256}. The file itself isn't kept.</p>
              {imp.duplicate_rows.length > 0 && <p className="text-xs text-muted-foreground">Duplicate rows: {rowList(imp.duplicate_rows)}.</p>}
              {imp.unplaced_rows.length > 0 && <p className="text-xs text-muted-foreground">Rows that couldn't be placed: {rowList(imp.unplaced_rows)}.</p>}
              {imp.undone_at && <p className="rounded-md border border-dashed p-2 text-sm" data-testid="import-undone">Taken back by {imp.undone_by_name} on {labStampLabel(imp.undone_at)}: {imp.undo_reason} ({plural(imp.undone_count ?? 0, "run")} voided).</p>}
            </div>
            {needs.length > 0 && (
              <section className="space-y-2" data-testid="import-needs-ca">
                <h3 className="text-sm font-semibold">Corrective action required ({num(needs.length)})</h3>
                <p className="text-xs text-muted-foreground">These runs fired a Westgard rejection rule. They're also in Review &amp; Sign-off until each has its corrective action.</p>
                <ul className="max-h-80 space-y-2 overflow-y-auto">{needs.slice(0, 50).map((r) => <NeedsAction key={r.id} labId={labId} run={r} canRecord={canRecord} onFiled={() => { load(); onChanged(); }} />)}</ul>
                {needs.length > 50 && <p className="text-xs text-muted-foreground">{num(needs.length - 50)} more in Review &amp; Sign-off.</p>}
              </section>
            )}
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="border-b bg-muted text-left text-xs text-muted-foreground"><tr><th className="p-2">Row</th><th className="p-2">When</th><th className="p-2">Analyzer</th><th className="p-2">Test, level, lot</th><th className="p-2">Value</th><th className="p-2">Rules fired</th><th className="p-2">Operator</th></tr></thead>
                <tbody>
                  {data.runs.slice(0, shown).map((r) => (
                    <tr key={r.id} className={`border-b align-top last:border-b-0 ${r.voided_at ? "opacity-60" : ""}`} data-testid={`import-run-${r.id}`}>
                      <td className="p-2 tabular-nums">{r.import_row}{r.import_column && <div className="text-[11px] text-muted-foreground">{r.import_column}</div>}</td>
                      <td className="whitespace-nowrap p-2">{r.result_date}{r.run_time ? ` ${r.run_time}` : ""}{r.added_after_review && <div className="whitespace-normal text-[11px] font-medium text-amber-800 dark:text-amber-300">Added after the review</div>}</td>
                      <td className="p-2">{r.instrument}</td>
                      <td className="p-2">{r.analyte}, {r.level}, lot {r.lot_number}</td>
                      <td className={`p-2 font-mono ${r.voided_at ? "line-through" : ""}`}>{r.result_value}</td>
                      <td className="p-2 text-xs">{r.voided_at ? "Voided" : r.violations.length ? r.violations.map((v) => v.rule_code).join(", ") : "none"}{r.has_corrective_action && <div className="text-muted-foreground">Corrective action filed</div>}</td>
                      <td className="p-2 text-xs text-muted-foreground">{r.import_operator}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.runs.length > shown && <Button size="sm" variant="outline" onClick={() => setShown((s) => s + 200)}>Show more ({num(data.runs.length - shown)} left)</Button>}
            {!imp.undone_at && data.can_import && (
              undoing ? (
                <section className="space-y-2 rounded-md border border-red-500/30 p-3" data-testid="import-undo">
                  <h3 className="text-sm font-semibold">Take this import back</h3>
                  <p className="text-sm">{plural(data.undo.will_void, "run")} will be voided. The rows are kept with your name, the time and the reason, and no longer count.{data.undo.stays.length ? ` ${plural(data.undo.stays.length, "run stays", "runs stay")}:` : ""}</p>
                  {data.undo.stays.length > 0 && <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs" data-testid="import-undo-stays">{data.undo.stays.slice(0, 200).map((s) => <li key={s.id}>Row {s.import_row}: {runName(s)}. {s.why}</li>)}</ul>}
                  <div><Label htmlFor="undo-reason" className="text-xs">Reason <span className="text-red-600">*</span></Label><Textarea id="undo-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The wrong file" data-testid="import-undo-reason" /></div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="destructive" onClick={takeBack} disabled={busy || !reason.trim() || !data.undo.will_void} data-testid="import-undo-confirm">{busy ? "Taking back..." : `Void ${plural(data.undo.will_void, "run")}`}</Button>
                    <Button size="sm" variant="outline" onClick={() => setUndoing(false)}>Keep the import</Button>
                  </div>
                </section>
              ) : <Button size="sm" variant="outline" onClick={() => setUndoing(true)} data-testid="import-undo-open">Take this import back...</Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ImportsList({ imports, onOpen }: { imports: ImportRow[]; onOpen: (id: number) => void }) {
  if (!imports.length) return <p className="text-sm text-muted-foreground">No results have been imported yet.</p>;
  return (
    <ul className="space-y-2" data-testid="imports-list">
      {imports.map((i) => (
        <li key={i.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center" data-testid={`import-${i.id}`}>
          <div className="min-w-0 flex-1">
            <div className="break-words text-sm font-medium">{i.file_name}</div>
            <div className="text-xs text-muted-foreground">{labStampLabel(i.imported_at)}, {i.imported_by_name}. {plural(i.run_count, "result")} stored, {plural(i.duplicate_count, "duplicate")}, {num(i.unplaced_count)} not placed.</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {i.undone_at && <Badge variant="outline">Taken back: {plural(i.undone_count ?? 0, "run")} voided</Badge>}
              {!!i.missing_corrective_action && <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-300">{plural(i.missing_corrective_action, "run needs", "runs need")} a corrective action</Badge>}
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => onOpen(i.id)} data-testid={`import-open-${i.id}`}>Open</Button>
        </li>
      ))}
    </ul>
  );
}
