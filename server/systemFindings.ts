// server/systemFindings.ts
//
// The cross-lab list of open findings (B2, 2026-11-24): GET /api/readiness/rollup/findings. For a system
// leader only, an active org_owner or org_admin of at least one organization. The labs are the ones handed in, which the
// route takes from the roll-up's own list (server/rollupGroups.ts), so this can't show a lab the roll-up doesn't. A group
// grants nothing here: the screen filters this answer by group and the answer is the same with or without groups.
//
// What a row holds is the list's columns: the lab, the accreditor and entry type, the finding's number and standard, the
// due date, the status, and past due by the VeritaResponse list's rule (shared/findingCounts.ts) on the lab's own day. No
// description, notes, plan, signer or any other text of the finding; those are read in the lab, through its own routes.
// A lab whose trial has ended is closed to everyone (labScopeMiddleware), so its findings stay out of this list too.
import { labTimeZoneOf, labToday } from "./dateLocal";
import { isFindingOpen, isFindingPastDue } from "@shared/findingCounts";
import type { RollupLabRow } from "./rollupGroups";

export interface SystemFinding {
  id: number; lab_id: number; lab_name: string | null; organization_id: number | null;
  accreditor: string; source_type: string; finding_number: string | null; standard_ref: string | null;
  due_date: string | null; status: string; past_due: boolean;
  past_target: boolean; // a soft clock (COLA, AABB) whose date has passed: never "past due"
}

const trialEnded = (l: RollupLabRow) => Number(l.is_trial) === 1 && !!l.subscription_expires_at && new Date() >= new Date(l.subscription_expires_at);

export function openFindingsAcrossLabs(sqlite: any, labs: RollupLabRow[]): SystemFinding[] {
  const stmt = sqlite.prepare("SELECT id, accreditor, source_type, finding_number, standard_ref, due_date, status FROM findings WHERE lab_id = ? AND status NOT IN ('closed', 'accepted')");
  const out: SystemFinding[] = [];
  for (const l of labs) {
    if (trialEnded(l)) continue;
    const today = labToday(labTimeZoneOf(l));
    for (const f of stmt.all(l.id) as any[]) {
      if (!isFindingOpen(f)) continue;
      const due = f.due_date ? String(f.due_date).slice(0, 10) : null;
      const pastDue = isFindingPastDue(f, today);
      out.push({
        id: f.id, lab_id: l.id, lab_name: l.lab_name, organization_id: l.organization_id ?? null,
        accreditor: f.accreditor, source_type: f.source_type || "inspection", finding_number: f.finding_number ?? null, standard_ref: f.standard_ref ?? null,
        due_date: due, status: f.status, past_due: pastDue, past_target: !pastDue && !!due && due < today,
      });
    }
  }
  // Past due first, then by due date with undated ones last.
  return out.sort((a, b) => Number(b.past_due) - Number(a.past_due) || (a.due_date || "9999").localeCompare(b.due_date || "9999") || String(a.lab_name).localeCompare(String(b.lab_name)) || a.id - b.id);
}
