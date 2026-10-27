// server/competencyMethodClock.ts
//
// BUG-069 (Michael Q34 = 1, 2026-10-27). Since 10/13 competencies are signed method by method
// (competency_method_signoffs) and each method runs its own clock from its own signed initial (Q157 = 1). The VeritaComp
// method view worked that clock out inside routes.ts, but the competency register, the reminder emails, the VeritaStaff
// roster status and the dashboard tile read only the person-level dates in VeritaStaff, so a method whose 6-month was
// signed could still read as owed (or the reverse). This module holds the one per-method clock and a lab-wide loader so
// every reader uses the same answer:
//   - methodClock: next milestone, next due (target + latest), overdue and remediation for one method, from its
//     sign-offs. Moved here unchanged from the method view in routes.ts, which now calls it.
//   - loadInstrumentGroups: the lab's analyzer groups (an analyzer belongs to at most one; a group of 2+ is one method
//     keyed by its lowest-id analyzer). Moved here from routes.ts.
//   - loadLabMethodClocks: every testing person's assigned methods in a lab, each with its clock, in a few queries.

import { nextCompetencyDue } from "./competencySchedule";
import { labLocalDate } from "./dateLocal";
import { nextMilestoneAfter, alignAnnualToMonth, type MethodMilestone } from "@shared/competencySignoff";

export interface ClockSignoff {
  milestone: string | null;
  signedDate: string | null;
  determination: string;               // "pass" | "fail" | "remediation" (NULL rows read as pass, BUG-051)
  remediationTargetDate?: string | null;
}
export interface ClockContext {
  hireDate: string | null;
  accreditor: string | null;
  nys: boolean;
  annualMonth: number | null;
}
export interface MethodDue { targetDate: string | null; latest: string | null; naturalTargetDate?: string | null; annualMonth?: number | null }
export interface MethodClockResult {
  last: any | null;                    // the newest sign-off (as passed in)
  lastPass: any | null;
  initialDate: string | null;
  nextMilestone: MethodMilestone;
  nextDue: MethodDue | null;
  overdue: boolean;                    // today is past the late ceiling (latest)
  needsRemediation: boolean;
}

// One method's clock from its sign-offs, newest first. today is the lab-local date (YYYY-MM-DD).
export function methodClock(signoffs: ClockSignoff[], complexity: string, ctx: ClockContext, today: string): MethodClockResult {
  const last: any = signoffs[0] || null;
  // BUG-051: a Fail or Remediation Required sign-off records the assessment but not competence. While it is the
  // latest, the same competency is due again (reassessment after remediation) and the clock stays on the last PASS
  // sign-off; with no pass at all (a failed initial) there is no due date and the method is not current.
  const lastPass: any = signoffs.find((s) => s.determination === "pass") || null;
  const needsRemediation = !!last && last.determination !== "pass";
  const initial: any = signoffs.find((s) => s.milestone === "initial" && s.determination === "pass") || null;
  const nextMilestone: MethodMilestone = needsRemediation
    ? ((last.milestone as MethodMilestone | null) || nextMilestoneAfter((lastPass?.milestone as MethodMilestone) || null, complexity))
    : nextMilestoneAfter((last?.milestone as MethodMilestone) || null, complexity);
  let nextDue: MethodDue | null = null;
  if (lastPass && lastPass.milestone && lastPass.signedDate) {
    const r = nextCompetencyDue({
      recordedMilestone: lastPass.milestone, recordedDate: lastPass.signedDate, initialDate: initial?.signedDate || null,
      hireDate: ctx.hireDate || null, highestComplexity: complexity,
      accreditor: ctx.accreditor || null, regime: ctx.nys ? "NYS-CLEP" : null,
    });
    nextDue = { targetDate: r.targetDate, latest: r.latest };
    // Lab annual month (Michael Q157 = 1): a repeat annual moves earlier into the lab's month; the late ceiling
    // moves with it by the same number of days. Initial, 6-month and first annual are never moved.
    const month = Number(ctx.annualMonth) || null;
    if (month && nextMilestone === "annual" && r.targetDate) {
      const aligned = alignAnnualToMonth(r.targetDate, month);
      if (aligned && aligned !== r.targetDate) {
        const shiftDays = Math.round((Date.parse(`${r.targetDate}T00:00:00Z`) - Date.parse(`${aligned}T00:00:00Z`)) / 86400000);
        const latest = r.latest ? new Date(Date.parse(`${r.latest}T00:00:00Z`) - shiftDays * 86400000).toISOString().slice(0, 10) : null;
        nextDue = { targetDate: aligned, latest, naturalTargetDate: r.targetDate, annualMonth: month };
      }
    }
  }
  const overdue = !!(nextDue?.latest && today > nextDue.latest);
  return { last, lastPass, initialDate: initial?.signedDate || null, nextMilestone, nextDue, overdue, needsRemediation };
}

// Lab-chosen method groups (2026-10-14, Michael Q166/Q168 = 1): instrument id -> its group. The lead analyzer (lowest
// id) holds a group's working entries and its lead sign-off row, so every screen treats the group as one method.
export type InstrumentGroup = { groupId: number; name: string; memberIds: number[]; leadId: number; members: Array<{ id: number; name: string; category: string | null }> };
export function loadInstrumentGroups(sqlite: any, labId: number): Map<number, InstrumentGroup> {
  const rows = sqlite.prepare(
    `SELECT g.id AS group_id, g.name, gm.instrument_id, i.instrument_name, i.category FROM competency_instrument_groups g
     JOIN competency_instrument_group_members gm ON gm.group_id = g.id AND gm.lab_id = g.lab_id
     JOIN veritamap_instruments i ON i.id = gm.instrument_id
     WHERE g.lab_id = ? ORDER BY gm.instrument_id`
  ).all(labId) as any[];
  const byGroup = new Map<number, InstrumentGroup>();
  for (const r of rows) {
    const g: InstrumentGroup = byGroup.get(r.group_id) || { groupId: r.group_id, name: r.name, memberIds: [], members: [], leadId: r.instrument_id };
    g.memberIds.push(r.instrument_id);
    g.members.push({ id: r.instrument_id, name: r.instrument_name, category: r.category || null });
    byGroup.set(r.group_id, g);
  }
  const out = new Map<number, InstrumentGroup>();
  for (const g of Array.from(byGroup.values())) {
    if (g.memberIds.length < 2) continue;
    g.leadId = Math.min(...g.memberIds);
    for (const id of g.memberIds) out.set(id, g);
  }
  return out;
}

const rankC = (c: string): number => { const u = String(c || "").toUpperCase(); return u.startsWith("H") ? 3 : u.startsWith("M") ? 2 : u.startsWith("W") ? 1 : 0; };
const cLabel = (r: number): string => (r >= 3 ? "HIGH" : r === 2 ? "MODERATE" : r === 1 ? "WAIVED" : "UNSPECIFIED");
const LEGACY_MILESTONE: Record<string, string> = { initial: "initial", "6month": "six_month", six_month: "six_month", first_annual: "first_annual", annual: "annual" };

export interface PersonMethodClock {
  methodId: number;                    // the analyzer id, or a group's lead analyzer id
  name: string;                        // the analyzer's name, or the group's name
  complexity: string;                  // HIGH | MODERATE | WAIVED | UNSPECIFIED (the method's own, from VeritaMap)
  signed: boolean;                     // any sign-off (per-method, or a whole-record sign made before 10/13)
  clock: MethodClockResult;
}

// Every person's assigned methods in a lab (staff_employee_instruments on the lab's VeritaMap), each with its clock.
// Keyed by staff_employees.id. A few lab-wide queries, not one per person, so lab-wide readers can call it once.
export function loadLabMethodClocks(sqlite: any, labId: number, today: string): Map<number, PersonMethodClock[]> {
  const out = new Map<number, PersonMethodClock[]>();
  const assigned = sqlite.prepare(
    `SELECT j.employee_id, i.id AS instrument_id, i.instrument_name FROM staff_employee_instruments j
     JOIN veritamap_instruments i ON j.instrument_id = i.id
     JOIN veritamap_maps m ON i.map_id = m.id
     JOIN staff_employees e ON e.id = j.employee_id
     WHERE m.lab_id = ? AND e.tier2_lab_id = ? AND e.status = 'active'
     ORDER BY j.employee_id, i.category, i.instrument_name`
  ).all(labId, labId) as any[];
  if (!assigned.length) return out;

  const groups = loadInstrumentGroups(sqlite, labId);
  // Method complexity: the highest active test complexity over the method's analyzers.
  const tests = sqlite.prepare(
    `SELECT t.instrument_id, t.complexity FROM veritamap_instrument_tests t
     JOIN veritamap_instruments i ON i.id = t.instrument_id JOIN veritamap_maps m ON m.id = i.map_id
     WHERE m.lab_id = ? AND t.active = 1`
  ).all(labId) as any[];
  const rankByInst = new Map<number, number>();
  for (const t of tests) rankByInst.set(t.instrument_id, Math.max(rankByInst.get(t.instrument_id) || 0, rankC(t.complexity)));

  // Non-revoked sign-offs, newest first; a group sign-off is one row per analyzer, counted once (group_signoff_id ?? id).
  const signoffs = sqlite.prepare(
    `SELECT id, staff_employee_id, instrument_id, milestone, signed_date, determination, remediation_target_date, group_signoff_id
     FROM competency_method_signoffs WHERE lab_id = ? AND revoked_at IS NULL ORDER BY signed_date DESC, id DESC`
  ).all(labId) as any[];
  const soByPersonInst = new Map<string, any[]>();
  for (const s of signoffs) {
    const k = `${s.staff_employee_id}:${s.instrument_id}`;
    const a = soByPersonInst.get(k) || []; a.push(s); soByPersonInst.set(k, a);
  }

  // Whole-record signs made before per-method sign-off (locked records in the implicit program): read only when a
  // method has no per-method sign-off, as the method view does.
  const legacyRows = sqlite.prepare(
    `SELECT ce.staff_employee_id, it.instrument_id, a.assessment_type, a.status, a.signed_on_paper_date, a.completion_date
     FROM competency_assessments a
     JOIN competency_programs p ON p.id = a.program_id
     JOIN competency_employees ce ON ce.id = a.employee_id
     JOIN competency_assessment_items it ON it.assessment_id = a.id
     WHERE p.lab_id = ? AND p.is_implicit = 1 AND a.locked = 1 AND it.instrument_id IS NOT NULL AND it.signoff_id IS NULL
       AND ce.staff_employee_id IS NOT NULL
     ORDER BY a.assessment_date DESC, a.id DESC`
  ).all(labId) as any[];
  const legacyByPersonInst = new Map<string, any>();
  for (const r of legacyRows) {
    const k = `${r.staff_employee_id}:${r.instrument_id}`;
    if (!legacyByPersonInst.has(k)) legacyByPersonInst.set(k, r);
  }

  const ctxRows = sqlite.prepare(
    `SELECT e.id, e.hire_date, sl.accreditation_body, sl.includes_nys, sl.competency_annual_month
     FROM staff_employees e LEFT JOIN staff_labs sl ON sl.id = e.lab_id WHERE e.tier2_lab_id = ?`
  ).all(labId) as any[];
  const ctxById = new Map<number, ClockContext>(ctxRows.map((r: any) => [r.id, {
    hireDate: r.hire_date || null, accreditor: r.accreditation_body || null, nys: r.includes_nys === 1,
    annualMonth: Number(r.competency_annual_month) || null,
  }]));

  const seen = new Set<string>();
  for (const a of assigned) {
    const g = groups.get(a.instrument_id);
    const methodId = g ? g.leadId : a.instrument_id;
    const key = `${a.employee_id}:${methodId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const memberIds = g ? g.memberIds : [a.instrument_id];
    const seenSo = new Set<number>();
    const rows = memberIds.flatMap((id) => soByPersonInst.get(`${a.employee_id}:${id}`) || [])
      .filter((s: any) => { const k = s.group_signoff_id ?? s.id; if (seenSo.has(k)) return false; seenSo.add(k); return true; })
      .sort((x: any, y: any) => String(y.signed_date).localeCompare(String(x.signed_date)) || (y.id - x.id));
    let list: ClockSignoff[] = rows.map((s: any) => ({
      milestone: s.milestone, signedDate: s.signed_date, determination: s.determination || "pass",
      remediationTargetDate: s.remediation_target_date || null,
    }));
    if (!list.length) {
      const legacyInst = memberIds.find((id) => legacyByPersonInst.has(`${a.employee_id}:${id}`));
      const legacy = legacyInst != null ? legacyByPersonInst.get(`${a.employee_id}:${legacyInst}`) : null;
      if (legacy) {
        const signed = String(legacy.signed_on_paper_date || "").slice(0, 10) || (legacy.completion_date ? labLocalDate(legacy.completion_date) : null) || null; // BUG-047: lab date
        list = [{
          milestone: LEGACY_MILESTONE[String(legacy.assessment_type || "")] || null, signedDate: signed,
          determination: legacy.status === "fail" || legacy.status === "remediation" ? legacy.status : "pass",
        }];
      }
    }
    const complexity = cLabel(Math.max(...memberIds.map((id) => rankByInst.get(id) || 0)));
    const ctx = ctxById.get(a.employee_id) || { hireDate: null, accreditor: null, nys: false, annualMonth: null };
    const entry: PersonMethodClock = {
      methodId, name: g ? g.name : a.instrument_name, complexity, signed: list.length > 0,
      clock: methodClock(list, complexity, ctx, today),
    };
    const arr = out.get(a.employee_id) || []; arr.push(entry); out.set(a.employee_id, arr);
  }
  return out;
}
