// Log maintenance on an instrument (VeritaMaintain). Moved out of EquipmentAppPage.tsx and extended for B9: whether the entry completes PM,
// what that does to the due date before it is saved, the cost, the vendor, and files. Open to everyone who records in the lab.
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { labTodayIso } from "@/lib/labDate";
import { useLabRoute } from "@/hooks/useLabRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { canCompletePm, completesPmByDefault, EQUIP_EVENT_LABEL, EQUIP_FILE_ACCEPT, EQUIP_FILE_KINDS, EQUIP_FILE_MAX_MB, } from "@shared/equipmentPm";
import { planScheduleDue } from "@shared/equipmentSchedules";
import { equipmentApi, sendJson, uploadFile, type Equipment } from "./equipmentShared";

const TYPE_ORDER = ["calibration", "preventive_maintenance", "function_check", "service", "repair", "troubleshooting", "solution_change"] as const;
// 2026-11-04 (Q161): what a stainer's solution record has to say was done to the solution.
const SOLUTION_ACTIONS = ["Changed", "Filtered", "Added to"];

export function LogMaintenanceDialog({ labId, equipment, requireVendorReport, onClose, onSaved }: {
  labId: number; equipment: Equipment | null; requireVendorReport: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const labRoute = useLabRoute();
  const [type, setType] = useState<string>("calibration");
  const [date, setDate] = useState(labTodayIso());
  const [by, setBy] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [notes, setNotes] = useState("");
  const [completesPm, setCompletesPm] = useState(false);
  const [allowEarlier, setAllowEarlier] = useState(false);
  const [cost, setCost] = useState("");
  const [vendor, setVendor] = useState(false);
  const [company, setCompany] = useState("");
  const [technician, setTechnician] = useState("");
  const [report, setReport] = useState<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileKind, setFileKind] = useState("service_report");
  // Troubleshooting entries record the problem, the action taken and the outcome (St. Charles REQ-070).
  const [problem, setProblem] = useState("");
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [solAction, setSolAction] = useState(SOLUTION_ACTIONS[0]);
  const [solNames, setSolNames] = useState("");
  const [others, setOthers] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const reportRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!equipment) return;
    setType("calibration"); setDate(labTodayIso()); setBy(""); setNextDue(""); setNotes(""); setCompletesPm(false); setAllowEarlier(false); setCost("");
    setVendor(false); setCompany(""); setTechnician(""); setReport(null); setFile(null); setFileKind("service_report");
    setOthers(new Set());
    setProblem(""); setAction(""); setOutcome(""); setSolAction(SOLUTION_ACTIONS[0]); setSolNames("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment?.id]);

  if (!equipment) return null;
  const isTs = type === "troubleshooting";
  const isSol = type === "solution_change";
  const schedules = equipment.schedules ?? [];
  const first = schedules.find((x) => x.is_primary) ?? null;
  // A schedule with a checklist is completed by answering it (Schedules), never by an entry alone.
  const firstHasList = !!first?.has_checklist;
  const rest = schedules.filter((x) => !x.is_primary);
  const pm = completesPm && canCompletePm(type) && !firstHasList;
  const pickType = (t: string) => { setType(t); setCompletesPm(completesPmByDefault(t)); setAllowEarlier(false); if (!canCompletePm(t)) setNextDue(""); };
  // What the server will do with the due date, worked out by the same rule, before the person says anything about moving it back.
  const plan = pm && date ? planScheduleDue({ currentDue: equipment.next_due_date, frequency: first?.frequency ?? "manual", intervalDays: first?.interval_days ?? null, daysOfWeek: first?.days_of_week ?? null, doneOn: date, typedDue: nextDue || null }) : null;
  const otherPm = canCompletePm(type) && rest.some((x) => others.has(x.id) && x.schedule_type === "preventive_maintenance");
  const waits = (pm || otherPm) && vendor && requireVendorReport && !report;

  async function save() {
    if (!date) return;
    if (isTs && (!problem.trim() || !action.trim() || !outcome.trim())) { toast({ title: "Enter the problem, the action taken and the outcome", variant: "destructive" }); return; }
    if (isSol && (!by.trim() || !solNames.trim())) { toast({ title: "Enter who did it and which solutions", variant: "destructive" }); return; }
    for (const f of [report, file]) if (f && f.size > EQUIP_FILE_MAX_MB * 1024 * 1024) { toast({ title: `${f.name} is too large (the limit is ${EQUIP_FILE_MAX_MB} MB).`, variant: "destructive" }); return; }
    const text = isSol
      ? [`${solAction}: ${solNames.trim()}`, notes.trim() ? `Notes: ${notes.trim()}` : ""].filter(Boolean).join("\n")
      : isTs
        ? [`Problem: ${problem.trim()}`, `Action taken: ${action.trim()}`, `Outcome: ${outcome.trim()}`, notes.trim() ? `Notes: ${notes.trim()}` : ""].filter(Boolean).join("\n")
        : notes || null;
    setSaving(true);
    try {
      const base = `${equipmentApi(labId)}/${equipment!.id}/events`;
      const r = await sendJson(base, "POST", {
        event_type: type, event_date: date, performed_by: by || null, notes: text, next_due_date: pm ? nextDue || null : null,
        completes_pm: pm, ...(canCompletePm(type) && others.size ? { schedule_ids: [...others] } : {}), allow_earlier_due: allowEarlier, cost: cost.trim() || null,
        by_vendor: vendor, vendor_company: vendor ? company || null : null, vendor_technician: vendor ? technician || null : null,
      });
      if (!r.ok) { toast({ title: r.data.error || "Could not log event", variant: "destructive" }); return; }
      const problems: string[] = [], warnings: string[] = [];
      let completed: any = null;
      for (const [f, kind] of [[report, "vendor_report"], [file, fileKind]] as [File | null, string][]) {
        if (!f) continue;
        const u = await uploadFile(`${base}/${r.data.event_id}/files`, f, kind);
        if (!u.ok) problems.push(`${f.name}: ${u.data.error || "not attached"}`);
        else { if (u.data.phiWarning) warnings.push(u.data.phiWarning); if (u.data.pm_completed) completed = u.data.pm_completed; }
      }
      const held = completed ? completed.due_date_held : r.data.due_date_held;
      const due = completed ? completed.next_due_date : r.data.next_due_date;
      const said = held
        ? `The PM due date stays ${held.keeps}. This entry works out to ${held.works_out_to}, which is earlier.`
        : pm && r.data.awaiting_vendor_report_event && !completed
          ? "It counts as complete, and the due date moves, when the vendor report is attached."
          : pm && due ? `Next PM due ${due}.` : "Recorded on this instrument's history. The maintenance due date is unchanged.";
      toast({ title: isSol ? "Solution change logged" : isTs ? "Troubleshooting logged" : "Maintenance logged", description: said });
      if (problems.length) toast({ title: "The entry is logged, but a file was not attached", description: `${problems.join("; ")}. Attach it from History.`, variant: "destructive" });
      if (warnings.length) toast({ title: "Check the attached file", description: warnings[0], variant: "destructive" });
      onClose(); onSaved();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="log-maintenance-dialog">
        <DialogHeader>
          <DialogTitle>Log maintenance</DialogTitle>
          <DialogDescription>{equipment.instrument_name}. Record a completed maintenance activity or a troubleshooting event. Only an entry that completes PM moves the PM due date.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
          <div>
            <Label htmlFor="ev-type">Type <span className="text-red-600">*</span></Label>
            <Select value={type} onValueChange={pickType}>
              <SelectTrigger id="ev-type"><SelectValue /></SelectTrigger>
              <SelectContent>{TYPE_ORDER.map((t) => <SelectItem key={t} value={t}>{EQUIP_EVENT_LABEL[t]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label htmlFor="ev-date">Date <span className="text-red-600">*</span></Label><Input id="ev-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setAllowEarlier(false); }} /></div>
          <div><Label htmlFor="ev-by">Performed by{isSol && <span className="text-red-600"> *</span>}</Label><Input id="ev-by" value={by} onChange={(e) => setBy(e.target.value)} placeholder="Tech or vendor" /></div>
          <div><Label htmlFor="ev-cost">Cost (optional)</Label><Input id="ev-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="e.g. 1250.00" /></div>
          {canCompletePm(type) && (
            <div className="sm:col-span-2 rounded-md border p-2 space-y-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pm} disabled={firstHasList} onChange={(e) => { setCompletesPm(e.target.checked); setAllowEarlier(false); }} data-testid="ev-completes-pm" /> This completes the scheduled PM</label>
              {firstHasList && <p className="text-xs text-muted-foreground">{first!.name} has a checklist. Complete it from Schedules.</p>}
              {pm && (
                <>
                  <div className="max-w-[14rem]"><Label htmlFor="ev-next">Next due (optional)</Label><Input id="ev-next" type="date" value={nextDue} onChange={(e) => { setNextDue(e.target.value); setAllowEarlier(false); }} /></div>
                  {plan?.held ? (
                    <div className="text-xs text-amber-800 dark:text-amber-300" data-testid="ev-due-held">
                      {allowEarlier
                        ? `The due date moves back from ${plan.held.keeps} to ${plan.held.works_out_to}.`
                        : `This works out to ${plan.held.works_out_to}, earlier than the due date on file, so ${plan.held.keeps} stays.`}
                      <label className="flex items-center gap-2 mt-1 text-foreground"><input type="checkbox" checked={allowEarlier} onChange={(e) => setAllowEarlier(e.target.checked)} data-testid="ev-allow-earlier" /> Move the due date back to {plan.held.works_out_to}</label>
                    </div>
                  ) : plan?.computed ? (
                    <p className="text-xs text-muted-foreground" data-testid="ev-due-preview">
                      {waits ? "When the vendor report is attached, the next PM is due " : "Next PM due "}{plan.computed}.
                    </p>
                  ) : <p className="text-xs text-muted-foreground">No PM interval on this instrument: enter the next due date, or it stays as it is.</p>}
                </>
              )}
              {rest.length > 0 && (
                <div data-testid="ev-schedules">
                  <div className="text-xs font-medium">It also completes</div>
                  {rest.map((x) => (
                    <label key={x.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={others.has(x.id)} disabled={x.has_checklist} onChange={() => setOthers((p) => { const n = new Set(p); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; })} data-testid={`ev-schedule-${x.id}`} />
                      <span>{x.name}{x.has_checklist ? <span className="text-xs text-muted-foreground"> (has a checklist: complete it from Schedules)</span> : null}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="sm:col-span-2 rounded-md border p-2 space-y-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vendor} onChange={(e) => setVendor(e.target.checked)} data-testid="ev-vendor" /> Done by a vendor</label>
            {vendor && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><Label htmlFor="ev-company">Company</Label><Input id="ev-company" value={company} onChange={(e) => setCompany(e.target.value)} /></div>
                <div><Label htmlFor="ev-tech">Technician</Label><Input id="ev-tech" value={technician} onChange={(e) => setTechnician(e.target.value)} /></div>
                <div className="sm:col-span-2">
                  <Label htmlFor="ev-report">Vendor report attached</Label>
                  <Input ref={reportRef} id="ev-report" type="file" accept={EQUIP_FILE_ACCEPT} className="text-xs" onChange={(e) => setReport(e.target.files?.[0] ?? null)} data-testid="ev-report" />
                  {waits && <p className="text-xs text-amber-800 dark:text-amber-300 mt-1" data-testid="ev-waits">This lab requires an attached vendor report. Until one is attached, this PM isn't complete and the due date stays.</p>}
                </div>
              </div>
            )}
          </div>
          {isSol && (<>
            <div>
              <Label htmlFor="sol-action">What was done <span className="text-red-600">*</span></Label>
              <select id="sol-action" className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={solAction} onChange={(e) => setSolAction(e.target.value)} data-testid="sol-action">
                {SOLUTION_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2"><Label htmlFor="sol-names">Which solutions <span className="text-red-600">*</span></Label><Input id="sol-names" value={solNames} onChange={(e) => setSolNames(e.target.value)} placeholder="e.g. Hematoxylin, eosin, clarifier" data-testid="sol-names" /></div>
            <p className="sm:col-span-2 text-[11px] text-muted-foreground" data-testid="sol-stain-log-hint">Keeping a <Link href={labRoute(`/equipment-app/stain-log?instrument=${equipment.id}`)} className="underline">stain log</Link> on this instrument? Record changes there, so the lot and expiration are kept.</p>
          </>)}
          {isTs && (<>
            <div className="sm:col-span-2"><Label htmlFor="ts-problem">Problem <span className="text-red-600">*</span></Label><Textarea id="ts-problem" rows={2} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="What happened (error code, symptom, QC shift)" /></div>
            <div className="sm:col-span-2"><Label htmlFor="ts-action">Action taken <span className="text-red-600">*</span></Label><Textarea id="ts-action" rows={2} value={action} onChange={(e) => setAction(e.target.value)} placeholder="Steps taken, parts replaced, vendor contacted" /></div>
            <div className="sm:col-span-2"><Label htmlFor="ts-outcome">Outcome <span className="text-red-600">*</span></Label><Textarea id="ts-outcome" rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Resolved and returned to service, or still open" /></div>
          </>)}
          <div className="sm:col-span-2"><Label htmlFor="ev-notes">{isTs ? "Additional notes" : "Notes"}</Label><Textarea id="ev-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Work performed, parts, results" /></div>
          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-2">
            <div>
              <Label htmlFor="ev-file-kind">Attach a file (optional)</Label>
              <select id="ev-file-kind" className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={fileKind} onChange={(e) => setFileKind(e.target.value)}>
                {EQUIP_FILE_KINDS.filter((k) => k.value !== "vendor_report").map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </div>
            <div className="min-w-0"><Label htmlFor="ev-file">File</Label><Input ref={fileRef} id="ev-file" type="file" accept={EQUIP_FILE_ACCEPT} className="text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="ev-file" /></div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !date}>{saving ? "Saving..." : "Log maintenance"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
