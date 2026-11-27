// The laboratory's own evaluation of a result its program didn't grade (B11, 2026-11-24; server/ptEvaluations.ts).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { labDayOf } from "@/lib/labDate";
import { PT_AAA_METHODS, PT_CONCLUSION_LABEL, ptMethodLabel, ptUngradedReasonText, type PtResult } from "@shared/ptEvents";
import { PtError, PtField, ptInputClass, ptRequest, usePtChanged } from "./ptUi";

function Form({ labId, result, today, onDone }: { labId: number; result: PtResult; today: string; onDone: () => void }) {
  const [f, setF] = useState({ method: "", method_notes: "", acceptance_criteria: "", result_summary: "", conclusion: "", performed_date: today });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = usePtChanged(labId);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const save = async () => {
    setSaving(true); setError(null);
    try {
      await ptRequest(`/api/labs/${labId}/pt/results/${result.id}/evaluations`, { method: "POST", json: f });
      changed(); onDone();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };
  return (
    <div className="space-y-3 pt-2" data-testid={`pt-evaluation-form-${result.id}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PtField label="What it was compared against">
          <select className={ptInputClass} value={f.method} onChange={set("method")} data-testid="pt-evaluation-method">
            <option value="">Select...</option>
            {PT_AAA_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </PtField>
        <PtField label="Date of the evaluation"><input type="date" max={today} className={ptInputClass} value={f.performed_date} onChange={set("performed_date")} data-testid="pt-evaluation-date" /></PtField>
        <PtField label="Criteria" hint="The laboratory's own."><input className={ptInputClass} value={f.acceptance_criteria} onChange={set("acceptance_criteria")} data-testid="pt-evaluation-criteria" /></PtField>
        <PtField label={f.method === "other" ? "Describe the comparison" : "More about the comparison"}><input className={ptInputClass} value={f.method_notes} onChange={set("method_notes")} data-testid="pt-evaluation-notes" /></PtField>
      </div>
      <PtField label="What it showed"><textarea rows={2} className={ptInputClass} value={f.result_summary} onChange={set("result_summary")} data-testid="pt-evaluation-summary" /></PtField>
      <div className="flex flex-wrap items-end gap-3">
        <PtField label="The laboratory's conclusion">
          <select className={ptInputClass} value={f.conclusion} onChange={set("conclusion")} data-testid="pt-evaluation-conclusion">
            <option value="">Select...</option><option value="pass">Acceptable</option><option value="fail">Unacceptable</option>
          </select>
        </PtField>
        <Button size="sm" disabled={saving} onClick={save} data-testid="pt-evaluation-save">{saving ? "Saving..." : "Record evaluation"}</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      <PtError error={error} />
    </div>
  );
}

export function PtUngradedResults({ labId, results, today, canEdit }: { labId: number; results: PtResult[]; today: string; canEdit: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const ungraded = results.filter((r) => r.status === "ungraded");
  if (!ungraded.length) return null;
  return (
    <section className="space-y-2" data-testid="pt-ungraded">
      <h3 className="text-sm font-semibold">Ungraded results</h3>
      <p className="text-xs text-muted-foreground">The program didn't grade these. Each stays open until the laboratory records its own evaluation. An ungraded result is neither acceptable nor unacceptable in the trend status and the rates.</p>
      {ungraded.map((r) => (
        <div key={r.id} className="rounded border p-3 text-sm space-y-1" data-testid={`pt-ungraded-${r.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><span className="font-medium">{r.analyte}</span> <span className="text-muted-foreground">{ptUngradedReasonText(r.ungraded_reason, r.ungraded_reason_text)}</span></div>
            {r.evaluation_open
              ? <span className="text-xs font-medium text-amber-700 dark:text-amber-400" data-testid="pt-evaluation-open">Evaluation open</span>
              : <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Evaluation on file</span>}
          </div>
          {r.evaluations.map((e) => (
            <p key={e.id} className="text-xs" data-testid="pt-evaluation">
              <span className="font-medium">{PT_CONCLUSION_LABEL[e.conclusion]}</span>, {e.performed_date}. {ptMethodLabel(e.method)}{e.method_notes ? ` (${e.method_notes})` : ""}; {e.acceptance_criteria}. {e.result_summary ?? ""} Recorded by {e.recorded_by_name ?? "name not on file"} on {labDayOf(e.recorded_at)}.
            </p>
          ))}
          {canEdit && (open === r.id
            ? <Form labId={labId} result={r} today={today} onDone={() => setOpen(null)} />
            : <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(r.id)} data-testid={`pt-evaluate-${r.id}`}>{r.evaluation_open ? "Record the laboratory's evaluation" : "Record another evaluation"}</Button>)}
        </div>
      ))}
    </section>
  );
}
