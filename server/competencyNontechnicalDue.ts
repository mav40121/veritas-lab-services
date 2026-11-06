// server/competencyNontechnicalDue.ts
//
// Due dates for non-technical competency (Michael 2026-11-04, "The sites shoudl be able to set frequency", go Q216 = 1, 2026-11-06).
// A lab sets labs.competency_nontechnical_months; blank leaves every non-technical record with no due date, as it always has been.
// With it set, each person on each non-technical program comes due that many months after their last signed, passing record there.
//
// Worked out when read and never stored, so saving the setting rewrites no record, and technical timing can't be touched:
// competencySchedule.ts, the method clock and the VeritaStaff schedule never see this setting. Reused from the technical clock:
// addMonthsIso for the date, signedRecordDate for which date a signed record counts from, and the BUG-051 rule that a Fail or
// Remediation Required as the newest signed record means the same competency is due again now.
//
// Who has a due date: a record has to exist. Every program lists every active person, and a program isn't assigned to anyone, so
// someone with no passing record still reads Not assessed on the program and has no date, the way a technical initial has no
// deadline. Left out: new-hire evaluations (record_kind 'evaluation', their own hire-date clock), people marked Not applicable on
// the program, and anyone inactive in VeritaComp or VeritaStaff. A person needn't perform testing: a non-technical program covers
// a processor or a clerk too. The lab's annual competency month doesn't move these dates; it is for repeat technical annuals.

import { addMonthsIso } from "./competencySchedule";
import { signedRecordDate } from "./competencyMethodClock";
import { labTimeZoneById } from "./dateLocal";
import {
  isNontechnicalFrequency, type NontechnicalBucket, type NontechnicalDueItem,
} from "@shared/competencyNontechnicalFrequency";
import type { CompetencyDueItem } from "./competencyReminders";

const DAY = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d: string | null | undefined): d is string => !!d && ISO_DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

export function readNontechnicalFrequency(sqlite: any, labId: number): number | null {
  const m = Number((sqlite.prepare("SELECT competency_nontechnical_months AS m FROM labs WHERE id = ?").get(labId) as any)?.m);
  return isNontechnicalFrequency(m) ? m : null;
}

export interface NontechnicalRecord { id: number; status: string; date: string | null }
export interface NontechnicalClock { lastPassDate: string | null; nextDue: string; daysUntil: number; bucket: NontechnicalBucket; remediationOpen: boolean }

const bucketFor = (daysUntil: number): NontechnicalBucket =>
  daysUntil < 0 ? "overdue" : daysUntil <= 30 ? "dueSoon30" : daysUntil <= 90 ? "dueSoon90" : "compliant";

// One person's clock on one program, from their signed records in any order. Null when nothing dated is on file. A record with an
// unreadable date can't place the person, so it doesn't count.
export function nontechnicalClock(records: NontechnicalRecord[], months: number, todayIso: string): NontechnicalClock | null {
  const dated = records.filter((r) => validDay(r.date)).sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);
  if (!dated.length) return null;
  const lastPassDate = dated.find((r) => r.status === "pass")?.date ?? null;
  if (dated[0].status !== "pass") return { lastPassDate, nextDue: todayIso, daysUntil: 0, bucket: "dueSoon30", remediationOpen: true };
  const nextDue = addMonthsIso(dated[0].date as string, months);
  const daysUntil = Math.round((Date.parse(`${nextDue}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / DAY);
  return { lastPassDate, nextDue, daysUntil, bucket: bucketFor(daysUntil), remediationOpen: false };
}

// Everyone with a due date in this lab, soonest first; nothing when the setting is blank.
export function nontechnicalDueForLab(sqlite: any, labId: number, todayIso: string): NontechnicalDueItem[] {
  const months = readNontechnicalFrequency(sqlite, labId);
  if (!months) return [];
  const tz = labTimeZoneById(sqlite, labId);
  // On the program's type, never a.competency_type: a Bulk Import or Cohort Sign-off row can hold 'technical' there whatever its program is.
  const rows = sqlite.prepare(
    `SELECT a.id, a.status, a.signed_on_paper_date, a.completion_date, a.assessment_date, a.program_id, a.employee_id,
            p.name AS program_name, p.department, ce.name AS comp_name, ce.title AS comp_title, ce.staff_employee_id,
            se.first_name, se.last_name, se.title AS staff_title
     FROM competency_assessments a
     JOIN competency_programs p ON p.id = a.program_id
     JOIN competency_employees ce ON ce.id = a.employee_id
     LEFT JOIN staff_employees se ON se.id = ce.staff_employee_id
     WHERE p.lab_id = ? AND ce.lab_id = ?
       AND p.type = 'nontechnical' AND COALESCE(p.record_kind, 'competency') <> 'evaluation' AND COALESCE(p.is_implicit, 0) = 0
       AND a.locked = 1 AND a.status IN ('pass', 'fail', 'remediation')
       AND ce.status = 'active' AND (ce.staff_employee_id IS NULL OR se.status = 'active')
       AND NOT EXISTS (SELECT 1 FROM competency_program_not_applicable na WHERE na.program_id = a.program_id AND na.employee_id = a.employee_id)`
  ).all(labId, labId) as any[];
  const byPersonProgram = new Map<string, any[]>();
  for (const r of rows) {
    const k = `${r.program_id}:${r.employee_id}`;
    byPersonProgram.set(k, [...(byPersonProgram.get(k) || []), r]);
  }
  const out: NontechnicalDueItem[] = [];
  for (const list of Array.from(byPersonProgram.values())) {
    const clock = nontechnicalClock(list.map((r) => ({ id: r.id, status: r.status, date: signedRecordDate(r, tz) })), months, todayIso);
    if (!clock) continue;
    const r = list[0];
    const staffName = `${r.first_name || ""} ${r.last_name || ""}`.trim();
    out.push({
      ...clock,
      programId: r.program_id, programName: r.program_name, department: r.department || null,
      employeeId: r.employee_id, staffEmployeeId: r.staff_employee_id ?? null,
      name: staffName || r.comp_name || `Employee ${r.employee_id}`, title: r.staff_title || r.comp_title || null,
      reason: `${clock.remediationOpen ? "Reassessment after remediation due" : "Non-technical competency due"} (${r.program_name})`,
    });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name) || a.programName.localeCompare(b.programName));
}

// The same list in the shape the reminder emails read (server/competencyReminders.ts); nothing when the setting is blank.
export function nontechnicalReminderItems(sqlite: any, labId: number, todayIso: string): CompetencyDueItem[] {
  return nontechnicalDueForLab(sqlite, labId, todayIso).map((i) => ({
    employeeId: i.staffEmployeeId ?? i.employeeId, name: i.name, title: i.title, reason: i.reason, nextDue: i.nextDue, daysUntil: i.daysUntil,
  }));
}
