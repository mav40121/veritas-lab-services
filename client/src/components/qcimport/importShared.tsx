// VeritaQC file import (B12): the shapes the server sends and the small pieces its screens share. Server: server/qcFileImport.ts.
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { labDayOf, labStampLabel } from "@/lib/labDate";
import type { ImportCounts, NameKind, QcImportMapping, RowOutcome } from "@shared/qcImportRules";

export const importApi = (labId: number) => `${API_BASE}/api/labs/${labId}/qc/file-imports`;

export interface Answer<T = any> { ok: boolean; status: number; data: T }
export async function sendForm(url: string, file: File, fields: Record<string, string | undefined>): Promise<Answer> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v);
  fd.append("file", file);
  try {
    const r = await fetch(url, { method: "POST", headers: authHeaders(), body: fd });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  } catch {
    // Status 0: the browser couldn't send it, as when the file was saved again after it was chosen.
    return { ok: false, status: 0, data: { error: "The file couldn't be sent. If it was saved again after you chose it, choose it again." } };
  }
}
export async function sendJson(url: string, method: string, body?: unknown): Promise<Answer> {
  const r = await fetch(url, { method, headers: { ...authHeaders(), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

export interface Inspect { file_name: string; file_sha256: string; kind: "csv" | "xlsx"; sheets: string[]; sheet: string | null; header_row: number; headers: string[]; sample: Array<{ row: number; cells: string[] }>; data_rows: number }
export interface SavedMapping { id: number; name: string; updated_at: string; mapping: QcImportMapping }
export interface SavedName { id: number; kind: NameKind; file_text: string; context_label: string | null; target: string; chosen_by_name: string | null; chosen_at: string }
export interface Setup { mappings: SavedMapping[]; names: SavedName[]; time_zone: string; can_import: boolean; instruments: Array<{ id: number | null; name: string; label: string }>; max_rows: number; max_mb: number }
export interface NameOption { value: string; label: string; map_instrument_id?: number }
export interface UnplacedName { kind: NameKind; text: string; file_key: string; group: string; rows: number; contexts: Array<{ context_key: string; label: string; rows: number; options: NameOption[] }> }
export interface PreviewRow { row: number; column: string | null; outcome: RowOutcome; reason: string | null; analyte: string; level: string; lot: string; instrument: string; date: string | null; time: string | null; value: number | null; operator: string | null; notes: string[] }
export interface Preview {
  file_name: string; file_sha256: string; time_zone: string; can_import: boolean; counts: ImportCounts; rows: PreviewRow[]; names: UnplacedName[];
  notes: { backdated: number; same_day: number; after_review: Array<{ analyte: string; level: string; lot: string; month: string; reviewed_by: string | null; reviewed_at: string; rows: number }>; inactive_lot: number; past_expiration: number; maybe_same: number };
}
export interface ImportRow {
  id: number; file_name: string; file_sha256: string; mapping_name: string | null; imported_by_name: string; imported_at: string; run_count: number; duplicate_count: number; unplaced_count: number;
  undone_at: string | null; undone_by_name: string | null; undo_reason: string | null; undone_count: number | null; runs_on_file?: number; missing_corrective_action?: number;
}

export const OUTCOME_LABEL: Record<RowOutcome, string> = { ready: "Ready", duplicate: "Duplicate", unplaced: "Can't be placed" };
export const num = (n: number) => n.toLocaleString("en-US");
export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
export const SELECT = "h-9 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground";

/** On a run: where it came from when it was read from a file, and that it was stored after its month's review was signed. */
export function RunOrigin({ run }: { run: { imported?: { id: number; file_name: string; imported_by_name: string; imported_at: string } | null; import_row?: number | null; import_column?: string | null; import_operator?: string | null; added_after_review?: string | null } }) {
  if (!run.imported && !run.added_after_review) return null;
  return (
    <>
      {run.imported && (
        <div className="text-[11px] leading-snug text-muted-foreground" data-testid="run-imported" title={`Imported by ${run.imported.imported_by_name} on ${labStampLabel(run.imported.imported_at)}`}>
          Imported from {run.imported.file_name}, row {run.import_row}{run.import_column ? `, ${run.import_column}` : ""}, by {run.imported.imported_by_name}.
          {run.import_operator ? ` Operator in the file: ${run.import_operator}.` : ""}
        </div>
      )}
      {run.added_after_review && (
        <div className="text-[11px] font-medium leading-snug text-amber-800 dark:text-amber-300" data-testid="run-after-review">Added after the review signed {labDayOf(run.added_after_review)}</div>
      )}
    </>
  );
}
