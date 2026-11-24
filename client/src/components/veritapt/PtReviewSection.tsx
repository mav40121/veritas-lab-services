// The laboratory's review of a whole event (B11, 2026-11-24; server/ptReviews.ts).
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { labDayOf } from "@/lib/labDate";
import { PT_REVIEW_LABEL, type PtEvent, type PtEventReview, type PtLinkedAction, type PtLinkedFinding, type PtReviewState } from "@shared/ptEvents";
import { PtError, PtField, ptInputClass, ptRequest, usePtChanged } from "./ptUi";

export interface PtReviewData {
  reviews: PtEventReview[];
  review_token: string;
  needs_link: boolean;
  options: { corrective_actions: PtLinkedAction[]; findings: PtLinkedFinding[] } | null;
}

const TONE: Record<PtReviewState, string> = {
  reviewed: "text-emerald-700 dark:text-emerald-400", changed: "text-amber-700 dark:text-amber-400", not_reviewed: "text-muted-foreground",
};
export const PtReviewChip = ({ state }: { state: PtReviewState }) => <span className={`text-xs font-medium ${TONE[state]}`} data-testid={`pt-review-${state}`}>{PT_REVIEW_LABEL[state]}</span>;

const actionText = (c: PtLinkedAction) => (c.corrective_action ? `${c.analyte ? `${c.analyte}: ` : ""}${c.corrective_action} (${c.status})` : "Corrective action no longer on file");
const findingText = (f: PtLinkedFinding) => (f.status ? `Finding ${f.finding_number || `#${f.id}`}${f.pt_analyte ? `, ${f.pt_analyte}` : ""}${f.pt_event ? ` ${f.pt_event}` : ""} (${f.status.replace(/_/g, " ")})` : `Finding #${f.id} no longer on file`);

function Form({ labId, event, data, onDone }: { labId: number; event: PtEvent; data: PtReviewData; onDone: () => void }) {
  const [notes, setNotes] = useState("");
  const [actions, setActions] = useState<number[]>([]);
  const [findings, setFindings] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = usePtChanged(labId);
  const save = async () => {
    setSaving(true); setError(null);
    try {
      await ptRequest(`/api/labs/${labId}/pt/event-reviews`, { method: "POST", json: { result_id: event.id, review_token: data.review_token, notes, corrective_action_ids: actions, finding_ids: findings } });
      changed(); onDone();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };
  const toggle = (list: number[], set: (v: number[]) => void, id: number) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const opts = data.options;
  return (
    <div className="rounded border p-3 space-y-3" data-testid="pt-review-form">
      <PtField label="Review notes"><textarea rows={3} className={ptInputClass} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="pt-review-notes" /></PtField>
      {data.needs_link && <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="pt-review-needs-link">This event has an unacceptable result, or an ungraded one without an acceptable evaluation. Link its corrective action or investigation.</p>}
      <fieldset className="text-xs space-y-1">
        <legend className="font-medium mb-1">Corrective actions of this event</legend>
        {!opts?.corrective_actions.length && <p className="text-muted-foreground">None on file.</p>}
        {opts?.corrective_actions.map((c) => (
          <label key={c.id} className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={actions.includes(c.id)} onChange={() => toggle(actions, setActions, c.id)} data-testid={`pt-review-action-${c.id}`} />{actionText(c)}</label>
        ))}
      </fieldset>
      <fieldset className="text-xs space-y-1">
        <legend className="font-medium mb-1">VeritaResponse&trade; findings</legend>
        {!opts?.findings.length && <p className="text-muted-foreground">None on file. <Link href={`/labs/${labId}/veritaresponse`} className="underline">Open VeritaResponse&trade;</Link> to record one first.</p>}
        <div className="max-h-40 overflow-y-auto space-y-1">
          {opts?.findings.map((x) => (
            <label key={x.id} className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={findings.includes(x.id)} onChange={() => toggle(findings, setFindings, x.id)} data-testid={`pt-review-finding-${x.id}`} /><span>{findingText(x)}{x.description ? <span className="text-muted-foreground"> {x.description}</span> : null}</span></label>
          ))}
        </div>
        <p className="text-muted-foreground">A link points to the record. It doesn't open, change or close it.</p>
      </fieldset>
      <PtError error={error} />
      <div className="flex gap-2">
        <Button size="sm" disabled={saving} onClick={save} data-testid="pt-review-save">{saving ? "Saving..." : "Record review"}</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

export function PtReviewSection({ labId, event, data, canEdit }: { labId: number; event: PtEvent; data: PtReviewData; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = usePtChanged(labId);
  const waiting = event.counts.not_graded;
  const director = async (id: number) => {
    setError(null);
    try { await ptRequest(`/api/labs/${labId}/pt/event-reviews/${id}/director-review`, { method: "POST", json: {} }); changed(); } catch (e: any) { setError(e.message); }
  };
  return (
    <section className="space-y-2" data-testid="pt-review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Review of this event</h3>
        <PtReviewChip state={event.review.state} />
      </div>
      <p className="text-xs text-muted-foreground">42 CFR §493.1236(a): "The laboratory must review and evaluate the results obtained on proficiency testing performed as specified in subpart H of this part."</p>
      {event.review.state === "changed" && <p className="text-xs text-amber-700 dark:text-amber-400">A result was added, changed or evaluated after this event was reviewed.</p>}
      {data.reviews.map((r, i) => (
        <div key={r.id} className="rounded border p-3 text-xs space-y-1" data-testid={`pt-review-record-${r.id}`}>
          <p><span className="font-medium">Reviewed by {r.reviewed_by_name ?? "name not on file"}</span> on {labDayOf(r.reviewed_at)}{i > 0 ? " (earlier review)" : ""}</p>
          {r.notes && <p className="whitespace-pre-wrap">{r.notes}</p>}
          {r.corrective_actions.map((c) => <p key={`a${c.id}`}>Corrective action: {actionText(c)}</p>)}
          {r.findings.map((x) => <p key={`f${x.id}`}>{x.status ? <Link href={`/labs/${labId}/veritaresponse/${x.id}`} className="underline">{findingText(x)}</Link> : findingText(x)}</p>)}
          {r.director_reviewed_at
            ? <p className="text-emerald-700 dark:text-emerald-400" data-testid="pt-director-reviewed">Laboratory director or designee review: {r.director_name ?? "name not on file"}, {labDayOf(r.director_reviewed_at)}</p>
            : i === 0 && canEdit && event.review.state === "reviewed" ? (
              <ConfirmDialog title="Record the laboratory director or designee review?" message="This records that you, as the laboratory director or designee, reviewed this event today. It can't be changed afterward." confirmLabel="Record my review" destructive={false} onConfirm={() => director(r.id)}>
                <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="pt-director-review">Laboratory director or designee review</Button>
              </ConfirmDialog>
            ) : <p className="text-muted-foreground">Laboratory director or designee review not recorded.</p>}
        </div>
      ))}
      <PtError error={error} />
      {canEdit && event.review.state !== "reviewed" && (waiting > 0
        ? <p className="text-xs text-muted-foreground" data-testid="pt-review-waiting">{waiting} {waiting === 1 ? "result is" : "results are"} not yet graded. Record every result's status, then review the event.</p>
        : open ? <Form labId={labId} event={event} data={data} onDone={() => setOpen(false)} />
          : <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="pt-review-start">Record a review</Button>)}
      {canEdit && event.review.state === "reviewed" && !open && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid="pt-review-again">Record another review</Button>}
      {canEdit && event.review.state === "reviewed" && open && <Form labId={labId} event={event} data={data} onDone={() => setOpen(false)} />}
    </section>
  );
}
