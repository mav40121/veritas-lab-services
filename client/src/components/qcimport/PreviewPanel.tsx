// VeritaQC file import (B12): what an import would do, row by row, and the names a person has to choose. Nothing is stored here.
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labDayOf } from "@/lib/labDate";
import { NAME_KIND_LABEL, type RowOutcome } from "@shared/qcImportRules";
import { num, OUTCOME_LABEL, plural, SELECT, type Preview, type UnplacedName } from "./importShared";

const KEEP = "\u0001keep";
const outcomeClass: Record<RowOutcome, string> = {
  ready: "border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  duplicate: "border-border bg-muted text-foreground",
  unplaced: "border-amber-600/30 bg-amber-500/10 text-amber-900 dark:text-amber-300",
};
const CONTEXT_WORDS: Record<string, string> = { analyte: "analyzer", level: "test", lot: "test and level" };

export interface ChosenName { kind: UnplacedName["kind"]; text: string; context_key: string; target: string; map_instrument_id?: number }
const idOf = (n: UnplacedName) => `${n.kind}|${n.file_key}|${n.group}`;

function NameChooser({ names, onSave, saving }: { names: UnplacedName[]; onSave: (choices: ChosenName[]) => void; saving: boolean }) {
  // Keyed by the name, or by the name and one place it appears when the person chooses separately.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [keepAs, setKeepAs] = useState<Record<string, string>>({});
  const [apart, setApart] = useState<Record<string, boolean>>({});
  useEffect(() => { setPicked({}); setApart({}); setKeepAs({}); }, [names]);
  const choices = useMemo(() => {
    const out: ChosenName[] = [];
    for (const n of names) for (const c of n.contexts) {
      const id = idOf(n), v = apart[id] ? picked[`${id}|${c.context_key}`] : picked[id];
      if (!v) continue;
      if (v === KEEP) { const t = (keepAs[id] ?? n.text).trim(); if (t) out.push({ kind: n.kind, text: n.text, context_key: c.context_key, target: t }); continue; }
      const o = c.options.find((x) => (x.map_instrument_id ? `i:${x.map_instrument_id}` : x.value) === v);
      if (o) out.push({ kind: n.kind, text: n.text, context_key: c.context_key, target: o.value, ...(o.map_instrument_id ? { map_instrument_id: o.map_instrument_id } : {}) });
    }
    return out;
  }, [names, picked, apart, keepAs]);
  if (!names.length) return null;
  const select = (key: string, n: UnplacedName, options: UnplacedName["contexts"][number]["options"], label: string, testId: string) => (
    <select className={SELECT} value={picked[key] ?? ""} onChange={(e) => setPicked((p) => ({ ...p, [key]: e.target.value }))} aria-label={label} data-testid={testId}>
      <option value="">Choose...</option>
      {options.map((o) => { const v = o.map_instrument_id ? `i:${o.map_instrument_id}` : o.value; return <option key={v} value={v}>{o.label}</option>; })}
      {n.kind === "instrument" && <option value={KEEP}>Not on the test menu: keep a name</option>}
    </select>
  );
  return (
    <div className="space-y-2 rounded-md border border-amber-600/30 bg-amber-500/5 p-3" data-testid="qcimport-names">
      <div className="text-sm font-semibold">Names to choose ({num(names.length)})</div>
      <p className="text-xs text-muted-foreground">These names in the file aren't ones this lab has. Choose what each means; the choice is remembered for this lab. Nothing is matched for you.</p>
      <ul className="space-y-2">
        {names.map((n) => {
          const id = idOf(n);
          // One pick for every place the name appears: the options any of those places has. A place that doesn't have it stays on the list.
          const union = Array.from(new Map(n.contexts.flatMap((c) => c.options).map((o) => [o.map_instrument_id ? `i:${o.map_instrument_id}` : o.value, o])).values());
          return (
            <li key={id} className="rounded-md border bg-background p-2" data-testid={`qcimport-name-${n.kind}-${n.file_key}`}>
              <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="min-w-0 text-sm">
                  <span className="text-xs text-muted-foreground">{NAME_KIND_LABEL[n.kind]} in the file: </span><span className="break-words font-medium">{n.text}</span>
                  {n.group && <span className="text-xs text-muted-foreground"> at level {n.group}</span>}
                  <div className="text-xs text-muted-foreground">{plural(n.rows, "row")}{n.contexts.length === 1 && n.contexts[0].label ? `, for ${n.contexts[0].label}` : n.contexts.length > 1 ? `, for ${num(n.contexts.length)} ${CONTEXT_WORDS[n.kind]}s` : ""}
                    {n.contexts.length > 1 && <button type="button" className="ml-2 text-primary underline" onClick={() => setApart((a) => ({ ...a, [id]: !a[id] }))} data-testid={`qcimport-apart-${n.kind}-${n.file_key}`}>{apart[id] ? "Choose once" : "Choose separately"}</button>}
                  </div>
                </div>
                {!apart[id] && (
                  <div className="min-w-0">
                    {select(id, n, union, `What ${n.text} means here`, `qcimport-pick-${n.kind}-${n.file_key}`)}
                    {picked[id] === KEEP && <Input className="mt-1 h-9" value={keepAs[id] ?? n.text} onChange={(e) => setKeepAs((k) => ({ ...k, [id]: e.target.value }))} aria-label="The analyzer's name" data-testid={`qcimport-keep-${n.file_key}`} />}
                  </div>
                )}
              </div>
              {apart[id] && (
                <div className="mt-2 space-y-1">
                  {n.contexts.map((c) => (
                    <div key={c.context_key} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                      <span className="truncate text-xs">{c.label} ({plural(c.rows, "row")})</span>
                      {select(`${id}|${c.context_key}`, n, c.options, `What ${n.text} means for ${c.label}`, `qcimport-pick-${n.kind}-${n.file_key}-${c.context_key}`)}
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Button size="sm" onClick={() => onSave(choices)} disabled={saving || !choices.length} data-testid="qcimport-names-save">{saving ? "Saving..." : `Remember ${choices.length ? plural(choices.length, "choice") : "choices"} and preview again`}</Button>
    </div>
  );
}

export function PreviewPanel({ preview, onSaveNames, saving, onImport, importing }: {
  preview: Preview; onSaveNames: (c: ChosenName[]) => void; saving: boolean; onImport: () => void; importing: boolean;
}) {
  const [tab, setTab] = useState<RowOutcome>("ready");
  const [shown, setShown] = useState(100);
  useEffect(() => { setShown(100); setTab(preview.counts.ready ? "ready" : preview.counts.unplaced ? "unplaced" : "duplicate"); }, [preview]);
  const rows = useMemo(() => preview.rows.filter((r) => r.outcome === tab), [preview, tab]);
  const { counts, notes } = preview;
  const said: string[] = [];
  if (notes.backdated) said.push(`${plural(notes.backdated, "row is", "rows are")} dated before a run already on file for that control lot. Each is judged against the runs before it. The runs already on file keep the verdict they have, as when a run is typed in late.`);
  if (notes.same_day) said.push(`${plural(notes.same_day, "row is", "rows are")} earlier in the day than a run already on file that day. Runs of one day are judged in the order they were recorded, so these come after it, as when a run is typed in late.`);
  for (const a of notes.after_review) said.push(`${plural(a.rows, "row lands", "rows land")} in ${a.month} for ${a.analyte} ${a.level}, lot ${a.lot}, whose review ${a.reviewed_by ? `${a.reviewed_by} ` : "was "}signed on ${labDayOf(a.reviewed_at)}. The signed review doesn't change; these runs will be marked as added after it.`);
  if (notes.inactive_lot) said.push(`${plural(notes.inactive_lot, "row is", "rows are")} for a control lot that is retired or on hold.`);
  if (notes.past_expiration) said.push(`${plural(notes.past_expiration, "row is", "rows are")} dated after the control lot's expiration.`);
  if (notes.maybe_same) said.push(`${plural(notes.maybe_same, "row has", "rows have")} the same value as a run on file that day with no time or no analyzer. Check they aren't the same run before importing.`);
  return (
    <div className="space-y-4" data-testid="qcimport-preview">
      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Rows by outcome">
        {(["ready", "duplicate", "unplaced"] as const).map((o) => (
          <button key={o} type="button" role="tab" aria-selected={tab === o} onClick={() => { setTab(o); setShown(100); }} className={`rounded-md border p-3 text-left ${tab === o ? "border-primary ring-1 ring-primary" : ""}`} data-testid={`qcimport-count-${o}`}>
            <div className="text-xl font-bold tabular-nums">{num(counts[o])}</div>
            <div className="text-xs text-muted-foreground">{OUTCOME_LABEL[o]}</div>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Times are on this laboratory's clock ({preview.time_zone}). Nothing is stored until you import.</p>
      {said.length > 0 && (
        <ul className="list-disc space-y-1 rounded-md border p-3 pl-7 text-sm" data-testid="qcimport-notes">{said.map((s) => <li key={s}>{s}</li>)}</ul>
      )}
      <NameChooser names={preview.names} onSave={onSaveNames} saving={saving} />
      {rows.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No rows here.</p> : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[640px] text-sm" data-testid="qcimport-rows">
            <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
              <tr><th className="p-2">Row</th><th className="p-2">Outcome</th><th className="p-2">When</th><th className="p-2">Analyzer</th><th className="p-2">Test, level, lot</th><th className="p-2">Value</th><th className="p-2">Operator</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((r, i) => (
                <tr key={`${r.row}|${r.column ?? ""}|${i}`} className="border-b align-top last:border-b-0" data-testid={`qcimport-row-${r.row}`}>
                  <td className="p-2 tabular-nums">{r.row}{r.column ? <div className="text-[11px] text-muted-foreground">{r.column}</div> : null}</td>
                  <td className="p-2"><Badge variant="outline" className={outcomeClass[r.outcome]}>{OUTCOME_LABEL[r.outcome]}</Badge>
                    {r.reason && <div className="mt-1 max-w-md text-xs">{r.reason}</div>}
                    {r.notes.map((n) => <div key={n} className="mt-1 max-w-md text-xs text-muted-foreground">{n}</div>)}</td>
                  <td className="whitespace-nowrap p-2">{r.date ?? ""}{r.time ? ` ${r.time}` : ""}</td>
                  <td className="p-2">{r.instrument}</td>
                  <td className="p-2">{[r.analyte, r.level, r.lot && `lot ${r.lot}`].filter(Boolean).join(", ")}</td>
                  <td className="p-2 font-mono">{r.value ?? ""}</td>
                  <td className="p-2 text-xs text-muted-foreground">{r.operator ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && <Button size="sm" variant="outline" onClick={() => setShown((s) => s + 200)}>Show more ({num(rows.length - shown)} left)</Button>}
      <div className="flex flex-wrap items-center gap-3">
        {preview.can_import
          ? <Button onClick={onImport} disabled={importing || !counts.ready} data-testid="qcimport-import">{importing ? "Importing..." : `Import ${plural(counts.ready, "result")}`}</Button>
          : <p className="text-sm text-muted-foreground" data-testid="qcimport-support-note">Veritas support sets up the mapping and the names. Someone in the laboratory imports the results.</p>}
        {counts.duplicate + counts.unplaced > 0 && <span className="text-xs text-muted-foreground">{num(counts.duplicate)} duplicate and {num(counts.unplaced)} that can't be placed will be left out.</span>}
      </div>
    </div>
  );
}
