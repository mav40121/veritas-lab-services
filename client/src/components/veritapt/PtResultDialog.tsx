// Record or edit one PT result (B11, 2026-11-24; server/ptEvents.ts). Opened from Record PT Event on the VeritaPT page and from
// an event's screen. Editing fills from the result the event screen has just read.
import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import { labTodayIso } from "@/lib/labDate";
import { PT_STATUS_LABEL, PT_STATUS_STORED, PT_UNGRADED_REASONS, type PtResult, type PtStatus } from "@shared/ptEvents";
import { PtError, PtField, ptInputClass, ptNum, ptRequest, usePtChanged } from "./ptUi";

export interface PtStaffName { id: number; first_name: string; last_name: string; middle_initial: string | null; title: string | null }

const STATUS_ORDER: PtStatus[] = ["not_graded", "acceptable", "unacceptable", "ungraded"];
const numberOrNull = (s: string): number | string | null => (s.trim() === "" ? null : Number.isFinite(Number(s)) ? Number(s) : s.trim());

export function PtResultDialog({ labId, enrollments, staffRoster, result, like, onClose, onSaved }: {
  labId: number;
  enrollments: Array<{ id: number; vendor: string; program_name: string; year_enrolled: number }>;
  staffRoster: PtStaffName[];
  /** The result to edit; none records a new one. */
  result?: PtResult | null;
  /** A new result in the same event as this one. */
  like?: PtResult | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const from = result ?? like ?? null;
  const [f, setF] = useState({
    enrollment_id: from ? String(from.enrollment_id) : "",
    event_id: from?.event_id ?? "", event_name: from?.event_name ?? "",
    event_date: from?.event_date ?? labTodayIso(),
    analyte: result?.analyte ?? "", your_method: result?.your_method ?? "",
    your_result: ptNum(result?.your_result), peer_mean: ptNum(result?.peer_mean), peer_sd: ptNum(result?.peer_sd), peer_n: ptNum(result?.peer_n),
    acceptable_low: ptNum(result?.acceptable_low), acceptable_high: ptNum(result?.acceptable_high),
    status: (result?.status ?? "not_graded") as PtStatus,
    ungraded_reason: result?.ungraded_reason ?? "", ungraded_reason_text: result?.ungraded_reason_text ?? "",
    tested_by_employee_id: result?.tested_by_employee_id ? String(result.tested_by_employee_id) : "",
    submission_due_date: from?.submission_due_date ?? "", submitted_date: from?.submitted_date ?? "",
    notes: result?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = usePtChanged(labId);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const known = enrollments.some((en) => String(en.id) === f.enrollment_id);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const body = {
        enrollment_id: Number(f.enrollment_id), event_id: f.event_id || null, event_name: f.event_name || null, event_date: f.event_date,
        analyte: f.analyte.trim(), your_method: f.your_method || null,
        your_result: numberOrNull(f.your_result), peer_mean: numberOrNull(f.peer_mean), peer_sd: numberOrNull(f.peer_sd), peer_n: numberOrNull(f.peer_n),
        acceptable_low: numberOrNull(f.acceptable_low), acceptable_high: numberOrNull(f.acceptable_high),
        pass_fail: PT_STATUS_STORED[f.status],
        ...(f.status === "ungraded" ? { ungraded_reason: f.ungraded_reason, ungraded_reason_text: f.ungraded_reason_text } : {}),
        tested_by_employee_id: f.tested_by_employee_id ? Number(f.tested_by_employee_id) : null,
        submission_due_date: f.submission_due_date || null, submitted_date: f.submitted_date || null, notes: f.notes || null,
      };
      await ptRequest(`/api/labs/${labId}/pt/results${result ? `/${result.id}` : ""}`, { method: result ? "PUT" : "POST", json: body });
      changed();
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const number = (k: keyof typeof f, label: string) => (
    <PtField label={label}><input type="text" inputMode="decimal" className={ptInputClass} value={f[k]} onChange={set(k)} data-testid={`pt-result-${k}`} /></PtField>
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="pt-result-dialog">
        <DialogHeader><DialogTitle>{result ? "Edit PT Result" : like ? "Add a Result to This Event" : "Record PT Event"}</DialogTitle></DialogHeader>
        <div className="flex items-start gap-3 rounded-lg border border-teal-200 bg-teal-50 dark:bg-teal-900/10 dark:border-teal-800 p-3 text-sm text-teal-900 dark:text-teal-200">
          <Info size={16} className="mt-0.5 shrink-0" />
          <div>Record the per-event result for the lab. CMS advises rotating PT samples among testing personnel, and 42 CFR §493.801(b)(1) requires testing by personnel who routinely perform the test. Capturing tested_by here builds the record.</div>
        </div>
        <div className="space-y-3">
          <PtField label="Enrollment">
            <select className={ptInputClass} value={f.enrollment_id} onChange={set("enrollment_id")} data-testid="pt-result-enrollment_id">
              <option value="">Select enrollment...</option>
              {from && !known && <option value={String(from.enrollment_id)}>{from.program}</option>}
              {enrollments.map((en) => <option key={en.id} value={en.id}>{en.vendor} {en.program_name} {en.year_enrolled}</option>)}
            </select>
          </PtField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PtField label="Event code" hint="As the program prints it. Results with the same code or name are one event."><input className={ptInputClass} value={f.event_id} onChange={set("event_id")} placeholder="e.g. 2026-A" data-testid="pt-result-event_id" /></PtField>
            <PtField label="Event name"><input className={ptInputClass} value={f.event_name} onChange={set("event_name")} data-testid="pt-result-event_name" /></PtField>
            <PtField label="Event date"><input type="date" className={ptInputClass} value={f.event_date} onChange={set("event_date")} data-testid="pt-result-event_date" /></PtField>
            <PtField label="Analyte"><input className={ptInputClass} value={f.analyte} onChange={set("analyte")} placeholder="e.g. Glucose" data-testid="pt-result-analyte" /></PtField>
            <PtField label="Submission due date" hint="Date results are due to the PT program. Drives the overdue/upcoming deadline banner. Optional."><input type="date" className={ptInputClass} value={f.submission_due_date} onChange={set("submission_due_date")} data-testid="pt-result-submission_due_date" /></PtField>
            <PtField label="Submitted date" hint="Date your results went to the PT program. Optional."><input type="date" className={ptInputClass} value={f.submitted_date} onChange={set("submitted_date")} data-testid="pt-result-submitted_date" /></PtField>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {number("your_result", "Your result")}{number("peer_mean", "Peer mean")}{number("peer_sd", "Peer SD")}{number("peer_n", "Peer group size")}
            {number("acceptable_low", "Lowest acceptable")}{number("acceptable_high", "Highest acceptable")}
          </div>
          <p className="text-[11px] text-muted-foreground">Lowest and highest acceptable are the program's own limits for this result, when its report gives them.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PtField label="Result status">
              <select className={ptInputClass} value={f.status} onChange={set("status")} data-testid="pt-result-status">
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{PT_STATUS_LABEL[s]}</option>)}
              </select>
            </PtField>
            <PtField label={staffRoster.length === 0 ? "Tested by (no staff roster)" : "Tested by"}>
              <select className={ptInputClass} value={f.tested_by_employee_id} onChange={set("tested_by_employee_id")} disabled={staffRoster.length === 0} data-testid="pt-result-tested_by">
                <option value="">Not specified</option>
                {staffRoster.map((emp) => <option key={emp.id} value={emp.id}>{emp.last_name}, {emp.first_name}{emp.middle_initial ? ` ${emp.middle_initial}.` : ""}{emp.title ? ` (${emp.title})` : ""}</option>)}
              </select>
            </PtField>
            {f.status === "ungraded" && (
              <PtField label="Why it was not graded" hint="Not for a late submission: record that as the program scored it. The submitted date shows it was late.">
                <select className={ptInputClass} value={f.ungraded_reason} onChange={set("ungraded_reason")} data-testid="pt-result-reason">
                  <option value="">Select...</option>
                  {PT_UNGRADED_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </PtField>
            )}
            {f.status === "ungraded" && <PtField label={f.ungraded_reason === "other" ? "In words" : "More about why (optional)"}><input className={ptInputClass} value={f.ungraded_reason_text} onChange={set("ungraded_reason_text")} data-testid="pt-result-reason-text" /></PtField>}
            <PtField label="Method"><input className={ptInputClass} value={f.your_method} onChange={set("your_method")} data-testid="pt-result-your_method" /></PtField>
          </div>
          <PtField label="Notes"><textarea rows={2} className={ptInputClass} value={f.notes} onChange={set("notes")} data-testid="pt-result-notes" /></PtField>
          <PtError error={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-[#006064] hover:bg-[#004d50] text-white" disabled={saving || !f.enrollment_id || !f.event_date || !f.analyte.trim()} onClick={save} data-testid="pt-result-save">
            {saving ? "Saving..." : result ? "Save Result" : "Save Event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
