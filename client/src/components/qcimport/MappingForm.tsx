// VeritaQC file import (B12): which column of the file holds what. Nothing here reads a result; the server does (shared/qcImportRules.ts).
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { nameKey, type DateOrder, type FieldSource, type QcImportMapping } from "@shared/qcImportRules";
import { SELECT, type Inspect } from "./importShared";

const FIXED = "\u0001fixed";

// A column is offered already chosen only when its heading is one of these exactly (case and spaces aside). The person sees and can change it.
const HEADINGS: Record<string, string[]> = {
  dateColumn: ["Date/Time", "Date Time", "DateTime", "Run Date/Time", "Result Date/Time", "Date and time", "Run date", "Result date", "Date"],
  timeColumn: ["Time", "Run time", "Result time"],
  instrument: ["Instrument", "Analyzer", "Instrument name", "Analyzer name"],
  analyte: ["Test", "Analyte", "Test name", "Assay"],
  level: ["Level", "Control level", "QC level"],
  lot: ["Lot", "Control lot", "Lot number", "QC lot", "Lot No"],
  valueColumn: ["Result", "Value", "QC result", "Result value"],
  operatorColumn: ["Operator", "Tech", "User", "Operator name"],
  commentColumn: ["Comment", "Comments", "Note", "Notes"],
};
const find = (headers: string[], field: string): string => {
  for (const want of HEADINGS[field]) { const h = headers.find((x) => nameKey(x) === nameKey(want)); if (h) return h; }
  return "";
};

export function emptyMapping(file: Inspect): QcImportMapping {
  const col = (f: string): FieldSource | null => { const h = find(file.headers, f); return h ? { column: h } : null; };
  const dateColumn = find(file.headers, "dateColumn");
  const time = find(file.headers, "timeColumn");
  return {
    sheet: file.sheet, headerRow: file.header_row, layout: "long", dateOrder: "mdy", dateColumn, timeColumn: time || null,
    instrument: col("instrument"), analyte: col("analyte"), level: col("level"), lot: col("lot"),
    valueColumn: find(file.headers, "valueColumn") || null, valueColumns: [],
    operatorColumn: find(file.headers, "operatorColumn") || null, commentColumn: find(file.headers, "commentColumn") || null,
  };
}

function ColumnSelect({ id, headers, value, onChange, blank }: { id: string; headers: string[]; value: string | null; onChange: (v: string | null) => void; blank: string }) {
  return (
    <select id={id} className={SELECT} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} data-testid={id}>
      <option value="">{blank}</option>
      {value && !headers.includes(value) && <option value={value}>{value} (not in this file)</option>}
      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
    </select>
  );
}

function SourceSelect({ id, label, headers, value, onChange, optional, suggestions }: {
  id: string; label: string; headers: string[]; value: FieldSource | null; onChange: (v: FieldSource | null) => void; optional?: string; suggestions?: string[];
}) {
  const fixed = value && "fixed" in value;
  const shown = !value ? "" : fixed ? FIXED : (value as { column: string }).column;
  return (
    <div className="min-w-0">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <select id={id} className={SELECT} value={shown} data-testid={id}
        onChange={(e) => onChange(e.target.value === FIXED ? { fixed: "" } : e.target.value ? { column: e.target.value } : null)}>
        <option value="">{optional ?? "Choose a column"}</option>
        {shown && shown !== FIXED && !headers.includes(shown) && <option value={shown}>{shown} (not in this file)</option>}
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
        <option value={FIXED}>The same for every row...</option>
      </select>
      {fixed && (
        <>
          <Input className="mt-1 h-9" value={(value as { fixed: string }).fixed} onChange={(e) => onChange({ fixed: e.target.value })} placeholder="Type it once" list={suggestions?.length ? `${id}-list` : undefined} data-testid={`${id}-fixed`} />
          {!!suggestions?.length && <datalist id={`${id}-list`}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
        </>
      )}
    </div>
  );
}

export function MappingForm({ file, mapping, onChange, instrumentNames }: { file: Inspect; mapping: QcImportMapping; onChange: (m: QcImportMapping) => void; instrumentNames: string[] }) {
  const h = file.headers;
  const set = (patch: Partial<QcImportMapping>) => onChange({ ...mapping, ...patch });
  const wide = mapping.layout === "wide";
  const chosen = new Map(mapping.valueColumns.map((v) => [v.column, v]));
  const toggle = (column: string) => set({ valueColumns: chosen.has(column) ? mapping.valueColumns.filter((v) => v.column !== column) : [...mapping.valueColumns, { column }].sort((a, b) => h.indexOf(a.column) - h.indexOf(b.column)) });
  const setValue = (column: string, patch: Record<string, string>) => set({ valueColumns: mapping.valueColumns.map((v) => (v.column === column ? { ...v, ...patch } : v)) });
  const fill = (field: "analyte" | "level") => set({ valueColumns: mapping.valueColumns.map((v) => ({ ...v, [field]: v.column })) });
  const rowOptional = wide ? "On each result column" : undefined;
  return (
    <div className="space-y-4" data-testid="qcimport-mapping">
      <div>
        <span className="text-xs font-medium">How the file is laid out</span>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {([["long", "One result on each row"], ["wide", "Several result columns, one per test or per level"]] as const).map(([v, label]) => (
            <label key={v} className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${mapping.layout === v ? "border-primary bg-primary/5" : ""}`}>
              <input type="radio" name="qc-layout" checked={mapping.layout === v} onChange={() => set({ layout: v })} data-testid={`qcimport-layout-${v}`} />{label}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="min-w-0"><Label htmlFor="qcimport-date" className="text-xs">Date and time, or date</Label><ColumnSelect id="qcimport-date" headers={h} value={mapping.dateColumn || null} onChange={(v) => set({ dateColumn: v ?? "" })} blank="Choose a column" /></div>
        <div className="min-w-0"><Label htmlFor="qcimport-time" className="text-xs">Time, when it has its own column</Label><ColumnSelect id="qcimport-time" headers={h} value={mapping.timeColumn} onChange={(v) => set({ timeColumn: v })} blank="In the date column, or none" /></div>
        <div className="min-w-0">
          <Label htmlFor="qcimport-order" className="text-xs">Dates with slashes are written</Label>
          <select id="qcimport-order" className={SELECT} value={mapping.dateOrder} onChange={(e) => set({ dateOrder: e.target.value as DateOrder })} data-testid="qcimport-order">
            <option value="mdy">Month, day, year (11/20/2026)</option>
            <option value="dmy">Day, month, year (20/11/2026)</option>
            <option value="ymd">Year, month, day (26/11/20)</option>
          </select>
        </div>
        <SourceSelect id="qcimport-instrument" label="Analyzer" headers={h} value={mapping.instrument} onChange={(v) => set({ instrument: v })} suggestions={instrumentNames} />
        <SourceSelect id="qcimport-analyte" label="Test" headers={h} value={mapping.analyte} onChange={(v) => set({ analyte: v })} optional={rowOptional} />
        <SourceSelect id="qcimport-level" label="Control level" headers={h} value={mapping.level} onChange={(v) => set({ level: v })} optional={rowOptional} />
        <SourceSelect id="qcimport-lot" label="Control lot" headers={h} value={mapping.lot} onChange={(v) => set({ lot: v })} optional={rowOptional} />
        {!wide && <div className="min-w-0"><Label htmlFor="qcimport-value" className="text-xs">Result value</Label><ColumnSelect id="qcimport-value" headers={h} value={mapping.valueColumn} onChange={(v) => set({ valueColumn: v })} blank="Choose a column" /></div>}
        <div className="min-w-0"><Label htmlFor="qcimport-operator" className="text-xs">Operator (optional)</Label><ColumnSelect id="qcimport-operator" headers={h} value={mapping.operatorColumn} onChange={(v) => set({ operatorColumn: v })} blank="None" /></div>
        <div className="min-w-0"><Label htmlFor="qcimport-comment" className="text-xs">Comment (optional)</Label><ColumnSelect id="qcimport-comment" headers={h} value={mapping.commentColumn} onChange={(v) => set({ commentColumn: v })} blank="None" /></div>
      </div>
      {wide && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">Result columns</span>
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!mapping.valueColumns.length} onClick={() => fill("analyte")} data-testid="qcimport-fill-analyte">Headings are tests</Button>
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!mapping.valueColumns.length} onClick={() => fill("level")} data-testid="qcimport-fill-level">Headings are levels</Button>
          </div>
          <p className="text-xs text-muted-foreground">Tick the columns that hold results. A test, level or lot left blank here comes from the column chosen above.</p>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
            {h.map((c) => {
              const v = chosen.get(c);
              return (
                <div key={c} className="grid items-center gap-2 sm:grid-cols-[minmax(8rem,1fr)_1fr_1fr_1fr]">
                  <label className="flex min-w-0 items-center gap-2 text-sm"><input type="checkbox" checked={!!v} onChange={() => toggle(c)} data-testid={`qcimport-valuecol-${nameKey(c)}`} /><span className="truncate">{c}</span></label>
                  {v && (["analyte", "level", "lot"] as const).map((f) => (
                    <Input key={f} className="h-8 text-xs" value={v[f] ?? ""} onChange={(e) => setValue(c, { [f]: e.target.value })} placeholder={f === "analyte" ? "Test" : f === "level" ? "Level" : "Lot"} aria-label={`${f === "analyte" ? "Test" : f === "level" ? "Level" : "Lot"} for ${c}`} data-testid={`qcimport-valuecol-${nameKey(c)}-${f}`} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
