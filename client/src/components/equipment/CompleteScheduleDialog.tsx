// Complete a schedule (VeritaMaintain, B10): its checklist when it has one, each step answered, and what that does to the due date before it
// is saved. Open to everyone who records in the lab, Staff logins included. Server: server/equipmentSchedules.ts.
import { useEffect, useState } from "react";
import { labTodayIso } from "@/lib/labDate";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { answerFails, judgeStep, limitsLabel, planScheduleDue, type StepAnswer } from "@shared/equipmentSchedules";
import { ApprovedDocumentDialog } from "./ApprovedDocumentDialog";
import { equipmentApi, sendJson, type Schedule } from "./equipmentShared";

export function CompleteScheduleDialog({ labId, equipmentId, equipmentName, scheduleId, requireVendorReport, onClose, onSaved }: {
  labId: number; equipmentId: number; equipmentName: string; scheduleId: number | null; requireVendorReport: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [sc, setSc] = useState<Schedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(labTodayIso());
  const [answers, setAnswers] = useState<Record<number, StepAnswer>>({});
  const [by, setBy] = useState("");
  const [notes, setNotes] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [allowEarlier, setAllowEarlier] = useState(false);
  const [vendor, setVendor] = useState(false);
  const [company, setCompany] = useState("");
  const [bad, setBad] = useState<number | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `${equipmentApi(labId)}/${equipmentId}/schedules`;

  async function load() {
    const r = await fetch(base, { headers: authHeaders() });
    const j = await r.json().catch(() => ({}));
    const found = (j.schedules || []).find((x: Schedule) => x.id === scheduleId);
    if (!r.ok || !found) { setError(j.error || "Could not load the schedule"); return; }
    setSc(found); setError(null);
  }
  useEffect(() => {
    setSc(null); setError(null); setDate(labTodayIso()); setAnswers({}); setBy(""); setNotes(""); setNextDue(""); setAllowEarlier(false); setVendor(false); setCompany(""); setBad(null); setDoc(null);
    if (scheduleId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleId, equipmentId]);
  if (!scheduleId) return null;

  const steps = sc?.checklist?.steps ?? [];
  const set = (id: number, a: Partial<StepAnswer>) => { setAnswers((p) => ({ ...p, [id]: { ...p[id], ...a } })); setBad(null); };
  const plan = sc && date ? planScheduleDue({ currentDue: sc.next_due_date, frequency: sc.frequency, intervalDays: sc.interval_days, daysOfWeek: sc.days_of_week, doneOn: date, typedDue: nextDue || null }) : null;
  const pm = sc?.schedule_type === "preventive_maintenance";
  const waits = pm && vendor && requireVendorReport;

  async function save() {
    if (!sc) return;
    for (const st of steps) {
      const r = judgeStep(st, answers[st.id]);
      if (r.error) {
        setBad(st.id);
        document.getElementById(`step-${st.id}`)?.scrollIntoView({ block: "center" });
        toast({ title: r.error, description: `Step ${st.position}: ${st.step_text}`, variant: "destructive" });
        return;
      }
    }
    setBusy(true);
    try {
      const r = await sendJson(`${base}/${sc.id}/complete`, "POST", {
        done_on: date, version_id: sc.checklist?.version_id ?? null, answers: steps.map((st) => ({ step_id: st.id, ...answers[st.id] })),
        performed_by: by || null, notes: notes || null, next_due_date: nextDue || null, allow_earlier_due: allowEarlier, by_vendor: vendor, vendor_company: vendor ? company || null : null,
      });
      if (!r.ok) {
        if (r.data.step_id) setBad(r.data.step_id);
        toast({ title: r.data.error || "Could not save", variant: "destructive" });
        if (r.data.code === "CHECKLIST_CHANGED") { setAnswers({}); await load(); }
        return;
      }
      toast({
        title: `${sc.name} completed`,
        description: r.data.awaiting_vendor_report_event ? "It counts, and the due date moves, when the vendor report is attached under History."
          : r.data.due_date_held ? `The due date stays ${r.data.due_date_held.keeps}.` : r.data.next_due_date ? `Next due ${r.data.next_due_date}.` : undefined,
      });
      onSaved(); onClose();
    } finally { setBusy(false); }
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="complete-dialog">
          <DialogHeader>
            <DialogTitle>{sc ? sc.name : "Complete"}</DialogTitle>
            <DialogDescription>{equipmentName}{sc?.checklist ? `, checklist version ${sc.checklist.version_no}` : ""}{sc ? `, ${sc.frequency_label.charAt(0).toLowerCase()}${sc.frequency_label.slice(1)}` : ""}</DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
          {!sc && !error && <p className="text-sm text-muted-foreground py-4">Loading...</p>}
          {sc && (
            <div className="space-y-3 min-w-0">
              {sc.sop && (sc.sop.readable
                ? <button type="button" className="text-sm text-primary underline inline-flex items-center gap-1 text-left" onClick={() => setDoc(`${base}/${sc.id}/sop`)} data-testid="complete-sop"><FileText className="h-3.5 w-3.5" />SOP: {[sc.sop.doc_number, sc.sop.title].filter(Boolean).join(" ")}</button>
                : <p className="text-xs text-muted-foreground">SOP: {[sc.sop.doc_number, sc.sop.title].filter(Boolean).join(" ") || "linked document"}, no approved version yet</p>)}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Label htmlFor="cs-date">Date done <span className="text-red-600">*</span></Label><Input id="cs-date" type="date" value={date} max={labTodayIso()} onChange={(e) => { setDate(e.target.value); setAllowEarlier(false); }} /></div>
                <div><Label htmlFor="cs-by">Performed by (if not you)</Label><Input id="cs-by" value={by} onChange={(e) => setBy(e.target.value)} /></div>
              </div>
              {steps.length > 0 && (
                <ol className="space-y-2" data-testid="complete-steps">
                  {steps.map((st) => {
                    const a = answers[st.id] || {};
                    const failing = answerFails(st, a);
                    return (
                      <li key={st.id} id={`step-${st.id}`} className={`rounded-md border p-2 ${bad === st.id ? "border-red-600" : failing ? "border-amber-600" : ""}`} data-testid={`step-${st.position}`}>
                        <div className="text-sm"><span className="text-muted-foreground mr-1">{st.position}.</span>{st.step_text}{st.kind === "value" && limitsLabel(st) ? <span className="text-xs text-muted-foreground"> ({limitsLabel(st)})</span> : null}</div>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          {st.kind === "value" && (
                            <span className="inline-flex items-center gap-1">
                              <Input className="h-8 w-28" inputMode="decimal" value={String(a.value ?? "")} disabled={a.result === "na"} onChange={(e) => set(st.id, { value: e.target.value })} aria-label={`Value for step ${st.position}`} data-testid={`step-${st.position}-value`} />
                              {st.unit && <span className="text-xs text-muted-foreground">{st.unit}</span>}
                            </span>
                          )}
                          {(st.kind === "check" ? ["pass", "fail", "na"] : ["na"]).map((k) => (
                            <label key={k} className="inline-flex items-center gap-1 text-sm">
                              {st.kind === "check"
                                ? <input type="radio" name={`step-${st.id}`} checked={a.result === k} onChange={() => set(st.id, { result: k })} data-testid={`step-${st.position}-${k}`} />
                                : <input type="checkbox" checked={a.result === "na"} onChange={(e) => set(st.id, { result: e.target.checked ? "na" : null })} data-testid={`step-${st.position}-na`} />}
                              {k === "pass" ? "Pass" : k === "fail" ? "Fail" : "N/A"}
                            </label>
                          ))}
                          {st.kind === "value" && failing && <span className="text-xs font-medium text-amber-800 dark:text-amber-300">Outside its limits</span>}
                        </div>
                        {failing && (
                          <div className="mt-1">
                            <Label className="text-xs">Corrective action <span className="text-red-600">*</span></Label>
                            <Textarea rows={2} value={a.corrective_action ?? ""} onChange={(e) => set(st.id, { corrective_action: e.target.value })} data-testid={`step-${st.position}-action`} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
              {sc.frequency === "manual" && <div className="max-w-[14rem]"><Label htmlFor="cs-next">Next due</Label><Input id="cs-next" type="date" value={nextDue} onChange={(e) => { setNextDue(e.target.value); setAllowEarlier(false); }} /></div>}
              {pm && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vendor} onChange={(e) => setVendor(e.target.checked)} /> Done by a vendor</label>
                  {vendor && <div className="max-w-xs"><Label htmlFor="cs-company">Company</Label><Input id="cs-company" value={company} onChange={(e) => setCompany(e.target.value)} /></div>}
                  {waits && <p className="text-xs text-amber-800 dark:text-amber-300">This lab requires an attached vendor report. Until one is attached under History, this PM isn't complete and the due date stays.</p>}
                </div>
              )}
              <div><Label htmlFor="cs-notes">Notes</Label><Textarea id="cs-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
              {plan?.held ? (
                <div className="text-xs text-amber-800 dark:text-amber-300" data-testid="complete-held">
                  {allowEarlier ? `The due date moves back from ${plan.held.keeps} to ${plan.held.works_out_to}.` : `This works out to ${plan.held.works_out_to}, earlier than the due date on file, so ${plan.held.keeps} stays.`}
                  <label className="flex items-center gap-2 mt-1 text-foreground"><input type="checkbox" checked={allowEarlier} onChange={(e) => setAllowEarlier(e.target.checked)} /> Move the due date back to {plan.held.works_out_to}</label>
                </div>
              ) : plan?.computed ? <p className="text-xs text-muted-foreground" data-testid="complete-preview">{waits ? "When the vendor report is attached, next due " : "Next due "}{plan.computed}.</p> : null}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy || !sc || !date} data-testid="complete-save">{busy ? "Saving..." : "Complete"}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <ApprovedDocumentDialog url={doc} label="SOP" onClose={() => setDoc(null)} />
    </>
  );
}
