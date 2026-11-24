// One proficiency testing event (B11, 2026-11-24; server/ptEvents.ts): its results and its dates.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pencil, Plus } from "lucide-react";
import { useFreshRecord } from "@/lib/freshRecord";
import { PT_SUBMISSION_LABEL, type PtEvent, type PtResult } from "@shared/ptEvents";
import { PtUngradedResults } from "./PtEvaluationForm";
import { PtError, PtField, PtStatusBadge, ptInputClass, ptNum, ptRange, ptRequest, usePtChanged } from "./ptUi";

export interface PtEventDetail { event: PtEvent; can_edit: boolean; today: string }

function EventDates({ labId, event, canEdit }: { labId: number; event: PtEvent; canEdit: boolean }) {
  const [due, setDue] = useState(event.due_date ?? "");
  const [submitted, setSubmitted] = useState(event.submitted_date ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = usePtChanged(labId);
  const save = async () => {
    setSaving(true); setError(null);
    try {
      await ptRequest(`/api/labs/${labId}/pt/events/${event.id}/dates`, { method: "PATCH", json: { submission_due_date: due || null, submitted_date: submitted || null } });
      changed();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };
  if (!canEdit) return <p className="text-xs text-muted-foreground">Due {event.due_date ?? "not entered"}. Submitted {event.submitted_date ?? "not entered"}. {PT_SUBMISSION_LABEL[event.submission]}.</p>;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <PtField label="Due to the program"><input type="date" className={ptInputClass} value={due} onChange={(e) => setDue(e.target.value)} data-testid="pt-event-due" /></PtField>
        <PtField label="Submitted to the program"><input type="date" className={ptInputClass} value={submitted} onChange={(e) => setSubmitted(e.target.value)} data-testid="pt-event-submitted" /></PtField>
        <Button size="sm" variant="outline" disabled={saving || (due === (event.due_date ?? "") && submitted === (event.submitted_date ?? ""))} onClick={save} data-testid="pt-event-dates-save">{saving ? "Saving..." : "Save dates"}</Button>
      </div>
      <p className="text-[11px] text-muted-foreground" data-testid="pt-event-submission">{PT_SUBMISSION_LABEL[event.submission]}. These dates apply to every result of this event.</p>
      <PtError error={error} />
    </div>
  );
}

export function PtEventDialog({ labId, resultId, onClose, onEdit, onAdd }: {
  labId: number;
  resultId: number;
  onClose: () => void;
  onEdit: (r: PtResult) => void;
  onAdd: (like: PtResult) => void;
}) {
  const url = `/api/labs/${labId}/pt/events/${resultId}`;
  const query = useQuery<PtEventDetail>({ queryKey: [url], queryFn: () => ptRequest(url), refetchOnMount: "always", retry: false });
  const data = useFreshRecord(query);
  const e = data?.event;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto" data-testid="pt-event-dialog">
        <DialogHeader><DialogTitle>{e ? `${e.name}` : "Event"}</DialogTitle></DialogHeader>
        {!data && <p className="text-sm text-muted-foreground py-6 text-center">{query.error ? (query.error as Error).message : "Loading..."}</p>}
        {data && e && (
          <div className="space-y-5 min-w-0">
            <p className="text-sm text-muted-foreground">{e.program}. Event date {e.event_date}.</p>
            <EventDates key={`${e.due_date}|${e.submitted_date}`} labId={labId} event={e} canEdit={data.can_edit} />
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Results</h3>
                {data.can_edit && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onAdd(e.results[0])} data-testid="pt-event-add-result"><Plus size={12} className="mr-1" />Add a result</Button>}
              </div>
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-xs" style={{ minWidth: 640 }}>
                  <thead><tr className="text-muted-foreground border-b bg-muted/40">
                    {["Analyte", "Result", "Peer mean", "Peer SD", "SDI", "Program's range", "Status", "Tested by", ""].map((h, i) => <th key={i} className="text-left py-2 px-2 font-medium">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {e.results.map((r) => (
                      <tr key={r.id} className="border-b border-border/50 align-top" data-testid={`pt-result-row-${r.id}`}>
                        <td className="py-2 px-2 font-medium">{r.analyte}{r.your_method && <div className="text-[11px] font-normal text-muted-foreground">{r.your_method}</div>}</td>
                        <td className="py-2 px-2">{ptNum(r.your_result)}</td>
                        <td className="py-2 px-2">{r.peer_mean == null ? <span className="text-muted-foreground">no peer data</span> : ptNum(r.peer_mean)}</td>
                        <td className="py-2 px-2">{ptNum(r.peer_sd)}</td>
                        <td className="py-2 px-2">{r.sdi == null ? "" : r.sdi.toFixed(2)}</td>
                        <td className="py-2 px-2 whitespace-nowrap">{ptRange(r.acceptable_low, r.acceptable_high)}</td>
                        <td className="py-2 px-2"><PtStatusBadge status={r.status} /></td>
                        <td className="py-2 px-2">{r.tested_by ?? ""}</td>
                        <td className="py-2 px-2 text-right">{data.can_edit && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onEdit(r)} data-testid={`pt-result-edit-${r.id}`}><Pencil size={12} className="mr-1" />Edit</Button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <PtUngradedResults labId={labId} results={e.results} today={data.today} canEdit={data.can_edit} />
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
