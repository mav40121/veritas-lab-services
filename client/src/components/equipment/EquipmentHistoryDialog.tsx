// An instrument's maintenance history (VeritaMaintain, B9). Each standing entry with its files, and under a corrected one, what it said before.
// An editor corrects an entry or voids it, with a reason; nothing is edited in place.
import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/auth";
import { labDayOf } from "@/lib/labDate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/AuthContext";
import { canCompletePm, EQUIP_EVENT_LABEL, EQUIP_EVENT_TYPES } from "@shared/equipmentPm";
import { planScheduleDue } from "@shared/equipmentSchedules";
import { ResultList } from "./EquipmentSchedulesDialog";
import { AttachFile, equipmentApi, FileList, ReasonDialog, sendJson, type Equipment, type MaintEvent } from "./equipmentShared";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Facts({ ev }: { ev: MaintEvent }) {
  const facts = [
    ev.performed_by ? `Performed by ${ev.performed_by}` : "",
    ev.by_vendor ? `Vendor: ${[ev.vendor_company, ev.vendor_technician].filter(Boolean).join(", ") || "yes"}` : "",
    ev.cost != null ? `Cost ${money(ev.cost)}` : "",
    ev.next_due_date ? `Next due ${ev.next_due_date}` : "",
    ev.logged_by_name ? `Logged by ${ev.logged_by_name} ${labDayOf(ev.created_at)}` : "",
  ].filter(Boolean);
  return (
    <>
      {facts.length > 0 && <div className="text-xs text-muted-foreground mt-0.5">{facts.join(" · ")}</div>}
      {ev.notes && <div className="text-sm mt-1 whitespace-pre-wrap break-words">{ev.notes}</div>}
    </>
  );
}

/** The correction form: the values as they stand, and a reason. The server writes a new row and keeps the old one. */
function CorrectDialog({ labId, equipment, ev, onClose, onSaved }: { labId: number; equipment: Equipment; ev: MaintEvent; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [type, setType] = useState(ev.event_type);
  const [date, setDate] = useState(ev.event_date);
  const [by, setBy] = useState(ev.performed_by || "");
  const [cost, setCost] = useState(ev.cost != null ? String(ev.cost) : "");
  const [company, setCompany] = useState(ev.vendor_company || "");
  const [technician, setTechnician] = useState(ev.vendor_technician || "");
  const [vendor, setVendor] = useState(ev.by_vendor === 1);
  // The first schedule is the PM: an entry that only completed another schedule keeps it, and this box starts off.
  const first = equipment.schedules?.find((x) => x.is_primary) ?? null;
  const done = ev.completions ?? [];
  const wasPm = done.length ? done.some((c) => c.schedule_id === first?.id) : (ev.completes_pm ?? (ev.event_type === "preventive_maintenance" ? 1 : 0)) === 1;
  const others = done.filter((c) => c.schedule_id !== first?.id);
  const [completesPm, setCompletesPm] = useState(wasPm);
  const [notes, setNotes] = useState(ev.notes || "");
  const [reason, setReason] = useState("");
  const [allowEarlier, setAllowEarlier] = useState(false);
  const [busy, setBusy] = useState(false);
  const pm = completesPm && canCompletePm(type);
  const moves = date !== ev.event_date || pm !== wasPm;
  const plan = moves && pm && date ? planScheduleDue({ currentDue: equipment.next_due_date, frequency: first?.frequency ?? "manual", intervalDays: first?.interval_days ?? null, daysOfWeek: first?.days_of_week ?? null, doneOn: date }) : null;
  const undoes = moves && !pm && wasPm && !!ev.next_due_date && ev.next_due_date === equipment.next_due_date;

  async function save() {
    if (!reason.trim()) { toast({ title: "Enter why this entry is being corrected", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const r = await sendJson(`${equipmentApi(labId)}/${equipment.id}/events/${ev.id}/correct`, "POST", {
        reason: reason.trim(), event_type: type, event_date: date, performed_by: by, notes, cost: cost.trim() || null,
        by_vendor: vendor, vendor_company: vendor ? company : "", vendor_technician: vendor ? technician : "", ...(pm !== wasPm ? { completes_pm: pm } : {}), allow_earlier_due: allowEarlier,
      });
      if (!r.ok) { toast({ title: r.data.error || "Could not save the correction", variant: "destructive" }); return; }
      toast({ title: "Entry corrected", description: r.data.due_date_held ? `The PM due date stays ${r.data.due_date_held.keeps}.` : "The original stays under it." });
      onSaved(); onClose();
    } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="correct-dialog">
        <DialogHeader>
          <DialogTitle>Correct this entry</DialogTitle>
          <DialogDescription>The original stays on the record, under the corrected entry, with who corrected it and why.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
          <div>
            <Label htmlFor="co-type">Type</Label>
            <select id="co-type" className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
              {EQUIP_EVENT_TYPES.map((t) => <option key={t} value={t}>{EQUIP_EVENT_LABEL[t]}</option>)}
            </select>
          </div>
          <div><Label htmlFor="co-date">Date</Label><Input id="co-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setAllowEarlier(false); }} data-testid="correct-date" /></div>
          <div><Label htmlFor="co-by">Performed by</Label><Input id="co-by" value={by} onChange={(e) => setBy(e.target.value)} /></div>
          <div><Label htmlFor="co-cost">Cost</Label><Input id="co-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} data-testid="correct-cost" /></div>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={vendor} onChange={(e) => setVendor(e.target.checked)} /> Done by a vendor</label>
          {vendor && (<>
            <div><Label htmlFor="co-company">Company</Label><Input id="co-company" value={company} onChange={(e) => setCompany(e.target.value)} /></div>
            <div><Label htmlFor="co-tech">Technician</Label><Input id="co-tech" value={technician} onChange={(e) => setTechnician(e.target.value)} /></div>
          </>)}
          {canCompletePm(type) && <label className="sm:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={completesPm} onChange={(e) => { setCompletesPm(e.target.checked); setAllowEarlier(false); }} /> This completed the scheduled PM</label>}
          {others.length > 0 && <p className="sm:col-span-2 text-xs text-muted-foreground">It also completed {others.map((c) => c.schedule_name).join(", ")}. A corrected date carries to that; to take it back, void the entry.</p>}
          {(plan?.held || plan?.move || undoes) && (
            <div className="sm:col-span-2 text-xs text-amber-800 dark:text-amber-300" data-testid="correct-due">
              {plan?.held ? (allowEarlier ? `The PM due date moves back from ${plan.held.keeps} to ${plan.held.works_out_to}.` : `With this date the next PM works out to ${plan.held.works_out_to}, earlier than ${plan.held.keeps}, which stays.`)
                : undoes ? (allowEarlier ? `The PM due date goes back from ${equipment.next_due_date}${ev.due_before ? ` to ${ev.due_before}` : ""}.` : `This entry set the PM due date ${equipment.next_due_date}, which stays.`)
                : plan?.computed ? `The next PM will be due ${plan.computed}.` : ""}
              {(plan?.held || undoes) && (
                <label className="flex items-center gap-2 mt-1 text-foreground"><input type="checkbox" checked={allowEarlier} onChange={(e) => setAllowEarlier(e.target.checked)} data-testid="correct-allow-earlier" /> Move the due date back{undoes ? (ev.due_before ? ` to ${ev.due_before}` : "") : plan?.computed ? ` to ${plan.computed}` : ""}</label>
              )}
            </div>
          )}
          <div className="sm:col-span-2"><Label htmlFor="co-notes">Notes</Label><Textarea id="co-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="correct-notes" /></div>
          <div className="sm:col-span-2"><Label htmlFor="co-reason">Why is this being corrected <span className="text-red-600">*</span></Label><Textarea id="co-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="correct-reason" /></div>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy} data-testid="correct-save">{busy ? "Saving..." : "Save correction"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EquipmentHistoryDialog({ labId, equipment, canEdit, canRecord, onClose, onChanged }: {
  labId: number; equipment: Equipment | null; canEdit: boolean; canRecord: boolean; onClose: () => void; onChanged: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [events, setEvents] = useState<MaintEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [attachTo, setAttachTo] = useState<number | null>(null);
  const [correcting, setCorrecting] = useState<MaintEvent | null>(null);
  const [voiding, setVoiding] = useState<MaintEvent | null>(null);
  const [putBack, setPutBack] = useState(false);

  async function load(show = true) {
    if (!equipment) return;
    if (show) setLoading(true);
    try {
      const r = await fetch(`${equipmentApi(labId)}/${equipment.id}/events`, { headers: authHeaders() });
      setEvents(r.ok ? await r.json() : []);
    } finally { setLoading(false); }
  }
  useEffect(() => {
    setEvents([]); setOpen(new Set()); setAttachTo(null); setCorrecting(null); setVoiding(null);
    if (equipment) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment?.id]);
  if (!equipment) return null;

  const readOnlyRecord = !!equipment.moved_to_lab_id;
  const changed = () => { load(false); onChanged(); };
  const voidSetsDue = !!voiding?.next_due_date && voiding.next_due_date === equipment.next_due_date;
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="history-dialog">
          <DialogHeader>
            <DialogTitle>Maintenance history: {equipment.instrument_name}</DialogTitle>
            <DialogDescription>Every calibration, preventive maintenance, service, repair and troubleshooting event, newest first.</DialogDescription>
          </DialogHeader>
          {loading ? (
            <p className="text-sm text-muted-foreground py-4">Loading...</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No maintenance events logged yet.</p>
          ) : (
            <ol className="space-y-2 min-w-0">
              {events.map((ev) => {
                const mine = !!user && ev.logged_by_user_id === (user as any).id;
                const live = !ev.voided_at && !ev.carried_from_lab_name && !readOnlyRecord;
                return (
                  <li key={ev.id} className={`rounded-lg border p-3 ${ev.voided_at ? "opacity-70" : ""}`} data-testid={`history-event-${ev.id}`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{ev.event_date}</span>
                      <span>{EQUIP_EVENT_LABEL[ev.event_type] || ev.event_type}</span>
                      {ev.completes_pm === 1 && ev.pm_complete !== 0 && !ev.voided_at && <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400">Completes PM</Badge>}
                      {ev.pm_complete === 0 && !ev.voided_at && <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-500/30 dark:text-amber-300" data-testid={`history-waiting-${ev.id}`}>Waiting for the vendor report</Badge>}
                      {ev.vendor_report_attached === 1 && <Badge variant="outline" data-testid={`history-report-${ev.id}`}>Vendor report attached</Badge>}
                      {ev.carried_from_lab_name && <Badge variant="outline" className="text-muted-foreground">Recorded at {ev.carried_from_lab_name}, read-only</Badge>}
                      {ev.voided_at && <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400">Voided</Badge>}
                    </div>
                    <Facts ev={ev} />
                    {ev.voided_at && <div className="text-xs text-red-700 dark:text-red-400 mt-1">Voided {labDayOf(ev.voided_at)}{ev.voided_by_name ? ` by ${ev.voided_by_name}` : ""}: {ev.void_reason}</div>}
                    {ev.corrected_at && <div className="text-xs text-muted-foreground mt-1" data-testid={`history-corrected-${ev.id}`}>Corrected {labDayOf(ev.corrected_at)}{ev.corrected_by_name ? ` by ${ev.corrected_by_name}` : ""}: {ev.correction_reason}</div>}
                    {(ev.completions ?? []).map((c) => (
                      <div key={c.id} className="mt-1" data-testid={`history-completion-${c.id}`}>
                        <div className="text-xs font-medium">Completed: {c.schedule_name}{c.checklist_version_no ? `, checklist version ${c.checklist_version_no}` : ""}</div>
                        <ResultList results={c.results} />
                      </div>
                    ))}
                    <FileList files={ev.files} base={`${equipmentApi(labId)}/${equipment.id}/files`} canRemove={canEdit && live} onChanged={changed} />
                    {attachTo === ev.id && <div className="mt-2"><AttachFile url={`${equipmentApi(labId)}/${equipment.id}/events/${ev.id}/files`} defaultKind={ev.by_vendor ? "vendor_report" : "service_report"} onSent={() => { setAttachTo(null); changed(); }} testId={`attach-${ev.id}`} /></div>}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {ev.earlier_versions.length > 0 && <Button size="sm" variant="ghost" onClick={() => toggle(ev.id)} data-testid={`history-earlier-${ev.id}`}>{open.has(ev.id) ? "Hide the original" : `Show the original${ev.earlier_versions.length > 1 ? ` and ${ev.earlier_versions.length - 1} correction${ev.earlier_versions.length === 2 ? "" : "s"}` : ""}`}</Button>}
                      {live && canRecord && (mine || canEdit) && attachTo !== ev.id && <Button size="sm" variant="ghost" onClick={() => setAttachTo(ev.id)} data-testid={`history-attach-${ev.id}`}>Attach a file</Button>}
                      {live && canEdit && <Button size="sm" variant="ghost" onClick={() => setCorrecting(ev)} data-testid={`history-correct-${ev.id}`}>Correct</Button>}
                      {live && canEdit && <Button size="sm" variant="ghost" onClick={() => { setPutBack(false); setVoiding(ev); }} data-testid={`history-void-${ev.id}`}>Void</Button>}
                    </div>
                    {open.has(ev.id) && (
                      <div className="mt-2 pl-3 border-l space-y-2" data-testid={`history-versions-${ev.id}`}>
                        {ev.earlier_versions.map((v, i) => (
                          <div key={v.id}>
                            <div className="text-xs font-medium">{i === ev.earlier_versions.length - 1 ? "Original" : `Corrected ${labDayOf(v.corrected_at || v.created_at)}: ${v.correction_reason || ""}`} · {v.event_date} · {EQUIP_EVENT_LABEL[v.event_type] || v.event_type}</div>
                            <Facts ev={v} />
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </DialogContent>
      </Dialog>
      {correcting && <CorrectDialog labId={labId} equipment={equipment} ev={correcting} onClose={() => setCorrecting(null)} onSaved={changed} />}
      <ReasonDialog
        open={!!voiding} title="Void this entry" description="For an entry made by mistake, such as on the wrong instrument. It stays on the record, marked voided, with who and why."
        label="Why is it being voided" confirmLabel="Void entry" destructive testId="void-dialog" onClose={() => setVoiding(null)}
        onConfirm={async (reason) => {
          const r = await sendJson(`${equipmentApi(labId)}/${equipment.id}/events/${voiding!.id}/void`, "POST", { reason, allow_earlier_due: putBack });
          if (!r.ok) { toast({ title: r.data.error || "Could not void the entry", variant: "destructive" }); return false; }
          toast({ title: "Entry voided" }); changed(); return true;
        }}
      >
        {voidSetsDue ? (
          <div className="text-xs text-amber-800 dark:text-amber-300">
            This entry set the PM due date {equipment.next_due_date}, which stays.
            <label className="flex items-center gap-2 mt-1 text-foreground"><input type="checkbox" checked={putBack} onChange={(e) => setPutBack(e.target.checked)} data-testid="void-put-back" /> Put the due date back{voiding?.due_before ? ` to ${voiding.due_before}` : " to blank"}</label>
          </div>
        ) : null}
      </ReasonDialog>
    </>
  );
}
