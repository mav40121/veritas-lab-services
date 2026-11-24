// An instrument's schedules (VeritaMaintain, B10): how often, next due, who is reminded, the SOP, and the checklist. Setup needs VeritaMaintain
// edit; anyone who records completes one. Server: server/equipmentSchedules.ts.
import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/auth";
import { labTodayIso } from "@/lib/labDate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowDown, ArrowUp, ListChecks, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cleanDays, cleanSteps, dueWithDays, firstDue, FREQUENCIES, frequencyLabel, limitsLabel, parseDays, SCHEDULE_TYPE_LABEL, SCHEDULE_TYPES, WEEK_DAYS } from "@shared/equipmentSchedules";
import { ApprovedDocumentDialog } from "./ApprovedDocumentDialog";
import { CompleteScheduleDialog } from "./CompleteScheduleDialog";
import { DocumentPicker, DueBadge, equipmentApi, ReasonDialog, sendJson, type Equipment, type Schedule } from "./equipmentShared";

const pickClass = "h-9 w-full rounded-md border border-border bg-background px-2 text-sm";

/** Add or edit one schedule. */
function ScheduleForm({ base, labId, schedule, onClose, onSaved }: { base: string; labId: number; schedule: Schedule | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(schedule?.name ?? "");
  const [type, setType] = useState(schedule?.schedule_type ?? "preventive_maintenance");
  const [frequency, setFrequency] = useState(schedule?.frequency ?? "daily");
  const [days, setDays] = useState(schedule?.interval_days ? String(schedule.interval_days) : "");
  // The days a daily schedule is due: every day until the lab says otherwise.
  const [week, setWeek] = useState<Set<number>>(new Set(parseDays(schedule?.days_of_week) ?? WEEK_DAYS.map((w) => w.value)));
  const stored = (w: Set<number>) => cleanDays([...w], "daily").value ?? null;
  const first = (f: string, n: string, w = week) => firstDue(f, Number(n) || null, labTodayIso(), f === "daily" ? stored(w) : null) ?? "";
  const [due, setDue] = useState(schedule ? schedule.next_due_date ?? "" : first("daily", ""));
  const [recipients, setRecipients] = useState((schedule?.recipients ?? []).map((r) => r.email).join(", "));
  const [sop, setSop] = useState<number | null>(schedule?.sop?.id ?? null);
  const [busy, setBusy] = useState(false);
  const pickFrequency = (f: string) => { setFrequency(f); if (!schedule) setDue(first(f, days)); };
  const toggleDay = (d: number) => {
    const w = new Set(week);
    if (w.has(d)) w.delete(d); else w.add(d);
    setWeek(w);
    if (!w.size) return;
    // The date goes with the days, as the server works it out; a date typed after that is kept.
    if (!schedule || schedule.frequency !== "daily") setDue(first("daily", days, w));
    else if (stored(w) === (schedule.days_of_week ?? null)) setDue(schedule.next_due_date ?? "");
    else setDue(dueWithDays(schedule.next_due_date, stored(w), labTodayIso(), schedule.last_completed?.done_day === labTodayIso()) ?? "");
  };
  async function save() {
    if (!name.trim()) { toast({ title: "Enter the schedule's name", variant: "destructive" }); return; }
    if (frequency === "daily" && !week.size) { toast({ title: "Pick at least one day", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const body = { name: name.trim(), schedule_type: type, frequency, interval_days: frequency === "every_n_days" ? Number(days) : null, days_of_week: frequency === "daily" ? [...week].sort() : null, next_due_date: due || null, recipients, sop_document_id: sop };
      const r = await sendJson(schedule ? `${base}/${schedule.id}` : base, schedule ? "PUT" : "POST", body);
      if (!r.ok) { toast({ title: r.data.error || "Could not save", variant: "destructive" }); return; }
      toast({ title: schedule ? "Schedule saved" : `Added ${name.trim()}` });
      onSaved(); onClose();
    } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="schedule-form">
        <DialogHeader>
          <DialogTitle>{schedule ? "Edit schedule" : "Add a schedule"}</DialogTitle>
          <DialogDescription>{schedule?.is_primary ? "This is the instrument's PM: its date is the one the instrument list and readiness show." : "How often it is due, who is reminded, and the SOP that covers it."}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
          <div className="sm:col-span-2"><Label htmlFor="sf-name">Name <span className="text-red-600">*</span></Label><Input id="sf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Daily maintenance" data-testid="sf-name" /></div>
          <div><Label htmlFor="sf-type">Type</Label><select id="sf-type" className={pickClass} value={type} onChange={(e) => setType(e.target.value)} data-testid="sf-type">{SCHEDULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
          <div><Label htmlFor="sf-freq">How often</Label><select id="sf-freq" className={pickClass} value={frequency} onChange={(e) => pickFrequency(e.target.value)} data-testid="sf-frequency">{FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select></div>
          {frequency === "every_n_days" && <div><Label htmlFor="sf-days">Days</Label><Input id="sf-days" inputMode="numeric" value={days} onChange={(e) => { setDays(e.target.value); if (!schedule) setDue(first(frequency, e.target.value)); }} data-testid="sf-days" /></div>}
          <div><Label htmlFor="sf-due">Next due</Label><Input id="sf-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} data-testid="sf-due" /></div>
          <div className="sm:col-span-2"><Label htmlFor="sf-recipients">Remind these people</Label><Input id="sf-recipients" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="Blank uses the lab's reminder list" data-testid="sf-recipients" /><p className="text-[11px] text-muted-foreground mt-1">Emails, separated by commas. Reminders go out only while the lab has them turned on.</p></div>
          <div className="sm:col-span-2"><Label>SOP in VeritaDC&#8482;</Label><DocumentPicker labId={labId} value={sop} valueLabel={schedule?.sop ? [schedule.sop.doc_number, schedule.sop.title].filter(Boolean).join(" ") : null} onChange={(id) => setSop(id)} testId="sf-sop" /></div>
          {frequency === "daily" && (
            <div className="sm:col-span-2">
              <Label>Days it is due</Label>
              <div className="flex flex-wrap gap-1.5 mt-1" role="group" aria-label="Days it is due" data-testid="sf-days-of-week">
                {WEEK_DAYS.map((w) => (
                  <button
                    key={w.value} type="button" aria-pressed={week.has(w.value)} aria-label={w.name} onClick={() => toggleDay(w.value)} data-testid={`sf-day-${w.value}`}
                    className={`h-8 min-w-[3rem] rounded-md border px-2 text-xs font-medium ${week.has(w.value) ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border"}`}
                  >{w.short}</button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1" data-testid="sf-days-said">
                {week.size === 0 ? "Pick at least one day." : `${frequencyLabel("daily", null, stored(week))}. Each of those days owes a record${schedule ? "" : " from its first due date"}. A day with none shows on the monthly review, unless the instrument was out of service all day.${schedule ? " A change counts from today. The days before today are judged by the days picked then." : ""}`}
              </p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !name.trim()} data-testid="sf-save">{busy ? "Saving..." : schedule ? "Save schedule" : "Add schedule"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type EditStep = { key: number; step_text: string; kind: "check" | "value"; unit: string; min_value: string; max_value: string };
let nextKey = 1;

/** The checklist's steps. Saving a change adds a version; what was completed keeps the steps it answered. */
function ChecklistForm({ base, schedule, onClose, onSaved }: { base: string; schedule: Schedule; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [steps, setSteps] = useState<EditStep[]>(() => (schedule.checklist?.steps ?? []).map((s) => ({ key: nextKey++, step_text: s.step_text, kind: s.kind, unit: s.unit ?? "", min_value: s.min_value == null ? "" : String(s.min_value), max_value: s.max_value == null ? "" : String(s.max_value) })));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const edit = (key: number, v: Partial<EditStep>) => setSteps((p) => p.map((s) => (s.key === key ? { ...s, ...v } : s)));
  const move = (i: number, by: number) => setSteps((p) => { const n = [...p]; const [x] = n.splice(i, 1); n.splice(i + by, 0, x); return n; });
  const add = () => setSteps((p) => [...p, { key: nextKey++, step_text: "", kind: "check", unit: "", min_value: "", max_value: "" }]);
  async function save() {
    const bad = cleanSteps(steps).error;
    if (bad) { toast({ title: bad, variant: "destructive" }); return; }
    setBusy(true);
    try {
      const r = await sendJson(`${base}/${schedule.id}/checklist`, "PUT", { steps: steps.map(({ key: _key, ...s }) => s), change_note: note || null });
      if (!r.ok) { toast({ title: r.data.error || "Could not save", variant: "destructive" }); return; }
      toast({ title: r.data.unchanged ? "Nothing changed" : r.data.checklist ? `Checklist version ${r.data.checklist.version_no} saved` : "Checklist removed", description: r.data.unchanged ? undefined : "Completed checklists keep the steps they answered." });
      onSaved(); onClose();
    } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="checklist-form">
        <DialogHeader>
          <DialogTitle>Checklist: {schedule.name}</DialogTitle>
          <DialogDescription>{schedule.checklist ? `Version ${schedule.checklist.version_no} is in use. Saving a change adds version ${schedule.checklist.version_no + 1}; completed checklists stay as they were.` : "Steps marked pass, fail or N/A, or a value with limits. A failed step asks for its corrective action."}</DialogDescription>
        </DialogHeader>
        <ol className="space-y-2 min-w-0">
          {steps.map((s, i) => (
            <li key={s.key} className="rounded-md border p-2" data-testid={`cl-step-${i + 1}`}>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground w-5 shrink-0">{i + 1}.</span>
                <Input className="h-8 min-w-0" value={s.step_text} onChange={(e) => edit(s.key, { step_text: e.target.value })} placeholder="What is done or checked" data-testid={`cl-text-${i + 1}`} />
                <Button type="button" size="sm" variant="ghost" className="px-1.5" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                <Button type="button" size="sm" variant="ghost" className="px-1.5" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                <Button type="button" size="sm" variant="ghost" className="px-1.5" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps((p) => p.filter((x) => x.key !== s.key))}><Trash2 /></Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-1 pl-6">
                <select className="h-8 rounded-md border border-border bg-background px-2 text-xs" value={s.kind} onChange={(e) => edit(s.key, { kind: e.target.value as any })} aria-label={`Kind of step ${i + 1}`} data-testid={`cl-kind-${i + 1}`}>
                  <option value="check">Pass, fail or N/A</option>
                  <option value="value">Value with limits</option>
                </select>
                {s.kind === "value" && (<>
                  <Input className="h-8 w-20 text-xs" inputMode="decimal" value={s.min_value} onChange={(e) => edit(s.key, { min_value: e.target.value })} placeholder="Low" aria-label="Low limit" data-testid={`cl-min-${i + 1}`} />
                  <Input className="h-8 w-20 text-xs" inputMode="decimal" value={s.max_value} onChange={(e) => edit(s.key, { max_value: e.target.value })} placeholder="High" aria-label="High limit" data-testid={`cl-max-${i + 1}`} />
                  <Input className="h-8 w-20 text-xs" value={s.unit} onChange={(e) => edit(s.key, { unit: e.target.value })} placeholder="Unit" aria-label="Unit" data-testid={`cl-unit-${i + 1}`} />
                </>)}
              </div>
            </li>
          ))}
        </ol>
        {steps.length === 0 && <p className="text-xs text-muted-foreground">No steps. {schedule.checklist ? "Saving takes the checklist off this schedule." : ""}</p>}
        <div><Button type="button" size="sm" variant="outline" onClick={add} data-testid="cl-add">Add a step</Button></div>
        {schedule.checklist && <div><Label htmlFor="cl-note">What changed (optional)</Label><Input id="cl-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>}
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || (steps.length === 0 && !schedule.checklist)} data-testid="cl-save">{busy ? "Saving..." : "Save checklist"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** What was completed on a schedule, newest first, each with its answers. */
function CompletionsDialog({ base, schedule, onClose }: { base: string; schedule: Schedule; onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    fetch(`${base}/${schedule.id}/completions`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }, [base, schedule.id]);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="completions-dialog">
        <DialogHeader><DialogTitle>{schedule.name}</DialogTitle><DialogDescription>What was completed, newest first. Each keeps the checklist version it answered.</DialogDescription></DialogHeader>
        {rows === null ? <p className="text-sm text-muted-foreground">Loading...</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing completed yet.</p> : (
          <ol className="space-y-2 min-w-0">
            {rows.map((c) => (
              <li key={c.id} className="rounded-md border p-2" data-testid={`completion-${c.id}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{c.done_day}</span>
                  <span className="text-xs text-muted-foreground">{[c.completed_by_name ? `by ${c.completed_by_name}` : "", c.performed_by ? `performed by ${c.performed_by}` : "", c.checklist_version_no ? `version ${c.checklist_version_no}` : "", c.carried_from_lab_name ? `at ${c.carried_from_lab_name}` : ""].filter(Boolean).join(" · ")}</span>
                  {c.failed_steps > 0 && <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-500/30 dark:text-amber-300">{c.failed_steps} failed</Badge>}
                  {!c.counts && <Badge variant="outline">Waiting for the vendor report</Badge>}
                </div>
                <ResultList results={c.results} />
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A completed checklist's steps as they were answered. */
export function ResultList({ results }: { results: any[] }) {
  if (!results?.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {results.map((r) => (
        <li key={r.id}>
          <span className={r.result === "fail" ? "font-medium text-red-700 dark:text-red-400" : r.result === "pass" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>{r.result === "fail" ? "Fail" : r.result === "pass" ? "Pass" : "N/A"}</span>
          {" "}{r.step_text}{r.value != null ? `: ${r.value}${r.unit ? ` ${r.unit}` : ""}` : ""}{limitsLabel(r) ? <span className="text-muted-foreground"> ({limitsLabel(r)})</span> : null}
          {r.corrective_action ? <div className="pl-8 text-muted-foreground">Corrective action: {r.corrective_action}</div> : null}
        </li>
      ))}
    </ul>
  );
}

export function EquipmentSchedulesDialog({ labId, equipment, canSetup, canRecord, requireVendorReport, onClose, onChanged }: {
  labId: number; equipment: Equipment | null; canSetup: boolean; canRecord: boolean; requireVendorReport: boolean; onClose: () => void; onChanged: () => void;
}) {
  const { toast } = useToast();
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [form, setForm] = useState<Schedule | "new" | null>(null);
  const [listFor, setListFor] = useState<Schedule | null>(null);
  const [completing, setCompleting] = useState<number | null>(null);
  const [seeing, setSeeing] = useState<Schedule | null>(null);
  const [ending, setEnding] = useState<Schedule | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const [doc, setDoc] = useState<string | null>(null);

  async function load() {
    if (!equipment) return;
    const r = await fetch(`${equipmentApi(labId)}/${equipment.id}/schedules`, { headers: authHeaders() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error || "Could not load the schedules"); return; }
    setSchedules(j.schedules); setCanEdit(!!j.can_edit && !j.retired); setError(null);
  }
  useEffect(() => {
    setSchedules(null); setError(null); setForm(null); setListFor(null); setCompleting(null); setSeeing(null); setEnding(null); setShowEnded(false);
    if (equipment) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment?.id]);
  if (!equipment) return null;
  const base = `${equipmentApi(labId)}/${equipment.id}/schedules`;
  const edit = canEdit && canSetup;
  const active = (schedules ?? []).filter((s) => s.active), ended = (schedules ?? []).filter((s) => !s.active);
  const changed = () => { load(); onChanged(); };

  const row = (s: Schedule) => (
    <li key={s.id} className="rounded-lg border p-3" data-testid={`schedule-${s.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm">{s.name}</span>
        {s.is_primary ? <Badge variant="outline" className="text-muted-foreground">PM date</Badge> : null}
        {s.active ? <DueBadge status={s.status} /> : <Badge variant="outline" className="text-muted-foreground">Ended {s.ended_on}</Badge>}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">
        {[SCHEDULE_TYPE_LABEL[s.schedule_type] ?? s.schedule_type, s.frequency_label, s.active ? (s.next_due_date ? `next due ${s.next_due_date}` : "no due date") : s.end_reason, s.has_own_recipients ? "has its own reminder list" : "", s.last_completed ? `last done ${s.last_completed.done_day}${s.last_completed.completed_by_name ? ` by ${s.last_completed.completed_by_name}` : ""}` : "not done yet"].filter(Boolean).join(" · ")}
      </div>
      <div className="text-xs mt-0.5 flex flex-wrap gap-x-3">
        {s.checklist && <span className="inline-flex items-center gap-1"><ListChecks className="h-3 w-3" />{s.checklist.steps.length} step{s.checklist.steps.length === 1 ? "" : "s"}, version {s.checklist.version_no}</span>}
        {s.sop && (s.sop.readable ? <button type="button" className="underline text-primary" onClick={() => setDoc(`${base}/${s.id}/sop`)} data-testid={`schedule-sop-${s.id}`}>SOP: {[s.sop.doc_number, s.sop.title].filter(Boolean).join(" ")}</button> : <span className="text-muted-foreground">SOP: {s.sop.title || "linked document"}, no approved version yet</span>)}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {s.active ? <Button size="sm" variant="outline" disabled={!canRecord || equipment.status === "retired"} onClick={() => setCompleting(s.id)} data-testid={`schedule-complete-${s.id}`}>Complete</Button> : null}
        <Button size="sm" variant="ghost" onClick={() => setSeeing(s)} data-testid={`schedule-done-${s.id}`}>What was done</Button>
        {edit && s.active ? (<>
          <Button size="sm" variant="ghost" onClick={() => setForm(s)} data-testid={`schedule-edit-${s.id}`}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => setListFor(s)} data-testid={`schedule-checklist-${s.id}`}>{s.checklist ? "Edit checklist" : "Add a checklist"}</Button>
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setEnding(s)} data-testid={`schedule-end-${s.id}`}>End</Button>
        </>) : null}
        {edit && !s.active ? <Button size="sm" variant="ghost" onClick={async () => { const r = await sendJson(`${base}/${s.id}/resume`, "POST", {}); if (!r.ok) toast({ title: r.data.error || "Could not resume it", variant: "destructive" }); else { toast({ title: "Schedule resumed" }); changed(); } }}>Resume</Button> : null}
      </div>
    </li>
  );

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="schedules-dialog">
          <DialogHeader>
            <DialogTitle>Schedules: {equipment.instrument_name}</DialogTitle>
            <DialogDescription>What is due on this instrument and how often. Completing one logs it on the instrument's history in your name.</DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
          {!schedules && !error && <p className="text-sm text-muted-foreground py-4">Loading...</p>}
          {schedules && (
            <div className="space-y-3 min-w-0">
              {active.length === 0 ? <p className="text-sm text-muted-foreground">No schedules yet.</p> : <ul className="space-y-2">{active.map(row)}</ul>}
              <div className="flex flex-wrap gap-2">
                {edit && <Button size="sm" onClick={() => setForm("new")} data-testid="schedule-add">Add a schedule</Button>}
                {ended.length > 0 && <Button size="sm" variant="ghost" onClick={() => setShowEnded((v) => !v)}>{showEnded ? "Hide ended" : `Ended (${ended.length})`}</Button>}
              </div>
              {showEnded && <ul className="space-y-2">{ended.map(row)}</ul>}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {form && <ScheduleForm base={base} labId={labId} schedule={form === "new" ? null : form} onClose={() => setForm(null)} onSaved={changed} />}
      {listFor && <ChecklistForm base={base} schedule={listFor} onClose={() => setListFor(null)} onSaved={changed} />}
      {seeing && <CompletionsDialog base={base} schedule={seeing} onClose={() => setSeeing(null)} />}
      <CompleteScheduleDialog labId={labId} equipmentId={equipment.id} equipmentName={equipment.instrument_name} scheduleId={completing} requireVendorReport={requireVendorReport} onClose={() => setCompleting(null)} onSaved={changed} />
      <ReasonDialog
        open={!!ending} testId="end-schedule" title={`End ${ending?.name ?? ""}`} confirmLabel="End schedule" destructive
        description="It stops being due and its reminders stop. What was done on it stays, and it can be resumed." label="Why is it ending" onClose={() => setEnding(null)}
        onConfirm={async (reason) => {
          const r = await sendJson(`${base}/${ending!.id}/end`, "POST", { reason });
          if (!r.ok) { toast({ title: r.data.error || "Could not end it", variant: "destructive" }); return false; }
          toast({ title: "Schedule ended" }); changed(); return true;
        }}
      />
      <ApprovedDocumentDialog url={doc} label="SOP" onClose={() => setDoc(null)} />
    </>
  );
}

/** What is due today or overdue across the lab's instruments, other than the PM dates the list already shows, with Complete on each. */
export function DueNowCard({ labId, items, canRecord, requireVendorReport, onChanged }: { labId: number; items: Equipment[]; canRecord: boolean; requireVendorReport: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState<{ equipment: Equipment; scheduleId: number } | null>(null);
  const today = labTodayIso();
  const due = items.flatMap((e) => (e.schedules ?? []).filter((s) => s.next_due_date && s.next_due_date <= today && (!s.is_primary || s.has_checklist)).map((s) => ({ e, s })))
    .sort((a, b) => (a.s.next_due_date! < b.s.next_due_date! ? -1 : a.s.next_due_date! > b.s.next_due_date! ? 1 : a.e.instrument_name.localeCompare(b.e.instrument_name)));
  if (!due.length && !open) return null;
  return (
    <div className="rounded-xl border p-4 mb-4" data-testid="due-now">
      <div className="text-sm font-semibold mb-2">Due now ({due.length})</div>
      <ul className="space-y-1.5">
        {due.slice(0, 30).map(({ e, s }) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid={`due-now-${s.id}`}>
            <span className="font-medium">{e.instrument_name}</span>
            <span>{s.name}</span>
            <span className={`text-xs ${s.next_due_date! < today ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>{s.next_due_date! < today ? `due ${s.next_due_date}` : "due today"}</span>
            {e.out_of_service && <span className="text-xs text-amber-800 dark:text-amber-300">out of service</span>}
            <Button size="sm" variant="outline" className="ml-auto" disabled={!canRecord} onClick={() => setOpen({ equipment: e, scheduleId: s.id })} data-testid={`due-now-complete-${s.id}`}>{s.has_checklist ? "Complete checklist" : "Complete"}</Button>
          </li>
        ))}
      </ul>
      {due.length > 30 && <p className="text-xs text-muted-foreground mt-1">and {due.length - 30} more</p>}
      {open && <CompleteScheduleDialog labId={labId} equipmentId={open.equipment.id} equipmentName={open.equipment.instrument_name} scheduleId={open.scheduleId} requireVendorReport={requireVendorReport} onClose={() => setOpen(null)} onSaved={onChanged} />}
    </div>
  );
}
