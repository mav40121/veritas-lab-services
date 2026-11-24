// server/demoDateRefresh.ts
//
// Rolls stale dates forward in Michael's own test labs (Michael 2026-11-16: "update michael's lab expiration dates across the
// board. Inventory, clia certificates, veritatrack, everything"). POST /api/admin/demo-dates/refresh is a dry run unless dryRun
// is false AND confirm is DEMO_DATES_CONFIRM. Only a lab in the QA system (organization QA_ORG_ID) whose owner is that
// system's billing owner, or the demo user, can move. Any other lab id is refused, so a client lab is never touched.
//
// The rule: a date that has passed moves forward by whole cycles of its own period until it is today or later, so the day of
// the month and the spacing between a record's dates stay. A "last done" date (a VeritaTrack sign-off, a VeritaMap calibration
// verification, the last PM, a competency) moves by the same whole cycles, so its next due date is today or later and the done
// date itself is never in the future. History stays put: QC results, graded PT events, closed findings, completed
// attestations, and the sign-offs of a task that is current. The report lists every change as table, id, column, before and
// after (dates, ids and statuses only, no names), plus each lab's inspection-readiness status before and after.

import { addLabDays, labToday, labTimeZoneById, withLabClock } from "./dateLocal";
import { deriveCompetencyStatus, labMethodClocks } from "./competencyReminders";
import { computeLabReadiness } from "./labReadiness";
import { rollForward } from "./equipmentScheduleData";
import { alignDue } from "@shared/equipmentSchedules";

export const DEMO_DATES_CONFIRM = "Refresh demo dates";
// "Veritas QA System": Michael's own test system (labs 1, 3, 24, 37, 48, 49, 50 on 2026-11-16).
export const QA_ORG_ID = 5;

export type DatePlanRow = { module: string; table: string; id: number; labId: number; changes: Record<string, [string | null, string]> };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
const dayOf = (v: unknown): string | null => (typeof v === "string" && ISO_DAY.test(v) ? v.slice(0, 10) : null);
// The moved value keeps whatever followed the date (a time, when the column holds one).
const moved = (v: string, days: number, months: number): string => addLabDays(v.slice(0, 10), days, months) + v.slice(10);

/** The fewest whole cycles (1 or more) that bring `due` to today or later; null when it is today or later already. */
export function cyclesToCurrent(due: string, today: string, days: number, months: number): number | null {
  if (due >= today || (days <= 0 && months <= 0)) return null;
  if (months <= 0) {
    // Days only: exact, so a daily cycle years behind still moves.
    const behind = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due.slice(0, 10)}T00:00:00Z`)) / 86400000);
    return Math.max(1, Math.ceil(behind / days));
  }
  for (let k = 1; k <= 1200; k++) if (addLabDays(due, days * k, months * k) >= today) return k;
  return null;
}

/** Whole months from a to b, to the nearest month (2024-03-01 to 2026-02-28 is 24). */
export function monthsBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  let n = (y2 - y1) * 12 + (m2 - m1);
  if (d2 - d1 >= 15) n += 1; else if (d1 - d2 >= 15) n -= 1;
  return n;
}

/** Why this lab may not move, or null when it may. */
export function demoDatesLabRefusal(sqlite: any, labId: number, demoUserId: number | null): string | null {
  const lab = sqlite.prepare("SELECT id, organization_id, owner_user_id FROM labs WHERE id = ?").get(labId) as any;
  if (!lab) return "LAB_NOT_FOUND";
  if (lab.organization_id !== QA_ORG_ID) return "NOT_IN_QA_SYSTEM";
  const org = sqlite.prepare("SELECT billing_owner_user_id FROM organizations WHERE id = ?").get(QA_ORG_ID) as any;
  const owners = [org?.billing_owner_user_id, demoUserId].filter((x) => x != null);
  if (!owners.includes(lab.owner_user_id)) return "OWNER_NOT_QA_SYSTEM_OWNER";
  return null;
}

/** Every lab in the QA system that may move. */
export function eligibleDemoDateLabs(sqlite: any, demoUserId: number | null): number[] {
  const ids = (sqlite.prepare("SELECT id FROM labs WHERE organization_id = ? ORDER BY id").all(QA_ORG_ID) as any[]).map((r) => r.id);
  return ids.filter((id) => demoDatesLabRefusal(sqlite, id, demoUserId) == null);
}

// Plans one lab. The competency step tries each shift inside a savepoint and reads the app's own status back, then rolls the
// savepoint back, so planning writes nothing.
export function planDemoDates(sqlite: any, labId: number): DatePlanRow[] {
  const tz = labTimeZoneById(sqlite, labId);
  return withLabClock(tz, () => planLab(sqlite, labId, labToday(tz)));
}

function planLab(sqlite: any, labId: number, today: string): DatePlanRow[] {
  const rows: DatePlanRow[] = [];
  const all = (sql: string, ...p: any[]) => { try { return sqlite.prepare(sql).all(...p) as any[]; } catch { return []; } };
  const get = (sql: string, ...p: any[]) => { try { return sqlite.prepare(sql).get(...p) as any; } catch { return undefined; } };
  const add = (module: string, table: string, id: number, changes: DatePlanRow["changes"]) => {
    if (Object.keys(changes).length) rows.push({ module, table, id, labId, changes });
  };
  // An expiration or due date: roll it by whole cycles. Companion dates on the row move by the same amount, and a companion
  // that is a done date only when it stays today or earlier.
  const roll = (module: string, table: string, row: any, col: string, days: number, months: number, companions: string[] = [], doneCols: string[] = []) => {
    const due = dayOf(row[col]);
    if (!due) return;
    const k = cyclesToCurrent(due, today, days, months);
    if (!k) return;
    const changes: DatePlanRow["changes"] = { [col]: [row[col], moved(row[col], days * k, months * k)] };
    for (const c of companions) {
      if (!dayOf(row[c])) continue;
      const to = moved(row[c], days * k, months * k);
      if (doneCols.includes(c) && to.slice(0, 10) > today) continue;
      changes[c] = [row[c], to];
    }
    add(module, table, row.id, changes);
  };

  // Certificates (VeritaLab): the renewal period is the certificate's own span when it has an issue date, else 2 years for a
  // CLIA certificate and 1 year for anything else.
  for (const c of all("SELECT id, cert_type, cert_name, issued_date, expiration_date FROM lab_certificates WHERE lab_id = ? AND is_active = 1", labId)) {
    const exp = dayOf(c.expiration_date);
    if (!exp) continue;
    const iss = dayOf(c.issued_date);
    let months = /clia/i.test(`${c.cert_type || ""} ${c.cert_name || ""}`) ? 24 : 12;
    if (iss) { const span = monthsBetween(iss, exp); if (span >= 6 && span <= 60) months = span; }
    roll("certificates", "lab_certificates", c, "expiration_date", 0, months, ["issued_date"], ["issued_date"]);
  }
  for (const f of all("SELECT id, invoice_date, due_date FROM clia_fee_payments WHERE lab_id = ? AND (paid_date IS NULL OR TRIM(paid_date) = '')", labId)) {
    roll("certificates", "clia_fee_payments", f, "due_date", 0, 24, ["invoice_date"], ["invoice_date"]);
  }

  // Equipment: next PM by the instrument's interval (a year when none is set), and the last PM event with it.
  for (const e of all("SELECT id, pm_interval_days, next_due_date FROM lab_equipment WHERE lab_id = ? AND status <> 'retired'", labId)) {
    const due = dayOf(e.next_due_date);
    if (!due) continue;
    const step = Number(e.pm_interval_days) > 0 ? Number(e.pm_interval_days) : 365;
    const k = cyclesToCurrent(due, today, step, 0);
    if (!k) continue;
    // The instrument's first schedule mirrors its PM date (server/equipmentScheduleData.ts), on a day it is due.
    const first = get("SELECT id, next_due_date, frequency, days_of_week FROM equipment_schedules WHERE equipment_id = ? AND lab_id = ? AND is_primary = 1 AND active = 1", e.id, labId);
    const to = first ? alignDue(first.frequency, first.days_of_week, moved(e.next_due_date, step * k, 0)) : moved(e.next_due_date, step * k, 0);
    add("equipment", "lab_equipment", e.id, { next_due_date: [e.next_due_date, to] });
    if (first) add("equipment", "equipment_schedules", first.id, { next_due_date: [first.next_due_date, to] });
    const last = get("SELECT id, event_date, next_due_date FROM equipment_maintenance_events WHERE equipment_id = ? AND lab_id = ? AND superseded_by_event_id IS NULL AND voided_at IS NULL ORDER BY event_date DESC, id DESC LIMIT 1", e.id, labId);
    if (last && dayOf(last.event_date)) {
      const to = moved(last.event_date, step * k, 0);
      if (to.slice(0, 10) <= today) {
        const changes: DatePlanRow["changes"] = { event_date: [last.event_date, to] };
        if (dayOf(last.next_due_date)) changes.next_due_date = [last.next_due_date, moved(last.next_due_date, step * k, 0)];
        add("equipment", "equipment_maintenance_events", last.id, changes);
      }
    }
  }

  // The instrument's other schedules, by whole cycles of their own frequency.
  for (const sc of all("SELECT s.id, s.frequency, s.interval_days, s.days_of_week, s.next_due_date FROM equipment_schedules s JOIN lab_equipment e ON e.id = s.equipment_id WHERE s.lab_id = ? AND s.is_primary = 0 AND s.active = 1 AND e.status <> 'retired'", labId)) {
    const due = dayOf(sc.next_due_date);
    if (!due || due >= today) continue;
    add("equipment", "equipment_schedules", sc.id, { next_due_date: [sc.next_due_date, rollForward(sc.frequency, sc.interval_days, due, today, sc.days_of_week)] });
  }

  // PT: a pending event (not yet graded) past its submission deadline becomes next year's event. Graded events are history.
  for (const p of all("SELECT id, event_date, submission_due_date FROM pt_events WHERE lab_id = ? AND pass_fail = 'pending'", labId)) {
    roll("pt", "pt_events", p, "submission_due_date", 0, 12, ["event_date"]);
  }
  // Alternative assessment (AA): the last performed and next due move by whole intervals (12 / times per year).
  for (const a of all("SELECT id, frequency_per_year, last_performed_date, next_due_date FROM aa_records WHERE lab_id = ?", labId)) {
    const months = Math.max(1, Math.round(12 / (Number(a.frequency_per_year) || 2)));
    roll("pt", "aa_records", a, "next_due_date", 0, months, ["last_performed_date"], ["last_performed_date"]);
  }

  // QC: active control lots past expiration (lots out of use are history).
  for (const q of all("SELECT id, expiration_date FROM qc_control_lots WHERE lab_id = ? AND status = 'active'", labId)) {
    roll("qc", "qc_control_lots", q, "expiration_date", 0, 12);
  }

  // Inventory (VeritaStock): items and lots with stock on hand, lots in use, standing-order reviews, and late orders.
  for (const i of all("SELECT id, expiration_date, standing_order_review_date, on_order_qty, on_order_expected_date, on_order_placed_date FROM inventory_items WHERE lab_id = ? AND COALESCE(status, 'active') = 'active'", labId)) {
    roll("inventory", "inventory_items", i, "expiration_date", 0, 12);
    roll("inventory", "inventory_items", i, "standing_order_review_date", 0, 12);
    if (Number(i.on_order_qty) > 0) roll("inventory", "inventory_items", i, "on_order_expected_date", 7, 0, ["on_order_placed_date"], ["on_order_placed_date"]);
  }
  for (const l of all("SELECT id, expiration_date FROM inventory_lots WHERE lab_id = ? AND COALESCE(quantity, 0) > 0", labId)) {
    roll("inventory", "inventory_lots", l, "expiration_date", 0, 12);
  }
  for (const u of all("SELECT id, expiration_date FROM inventory_lot_use WHERE lab_id = ? AND (out_of_use_date IS NULL OR TRIM(out_of_use_date) = '')", labId)) {
    roll("inventory", "inventory_lot_use", u, "expiration_date", 0, 12);
  }
  for (const t of all("SELECT id, expiration_date FROM tissue_units WHERE lab_id = ? AND state IN ('received_mm', 'stored')", labId)) {
    roll("inventory", "tissue_units", t, "expiration_date", 0, 12);
  }

  // VeritaTrack: a task past due (last sign-off + its frequency) has all its sign-offs moved by whole frequencies, so the
  // last one falls inside the current cycle. A task with no sign-off is "Not started" and stays.
  for (const t of all("SELECT id, frequency_months, frequency_days FROM veritatrack_tasks WHERE lab_id = ? AND active = 1", labId)) {
    const fd = Number(t.frequency_days) > 0 ? Number(t.frequency_days) : 0;
    const fm = fd > 0 ? 0 : Number(t.frequency_months) || 0;
    if (!fd && !fm) continue;
    const signoffs = all("SELECT id, completed_date FROM veritatrack_signoffs WHERE task_id = ? AND voided_at IS NULL", t.id);
    const days = signoffs.map((s) => dayOf(s.completed_date)).filter(Boolean) as string[];
    if (!days.length) continue;
    const last = days.sort()[days.length - 1];
    const k = cyclesToCurrent(addLabDays(last, fd, fm), today, fd, fm);
    if (!k) continue;
    for (const s of signoffs) {
      if (!dayOf(s.completed_date)) continue;
      const to = moved(s.completed_date, fd * k, fm * k);
      if (to.slice(0, 10) <= today) add("veritatrack", "veritatrack_signoffs", s.id, { completed_date: [s.completed_date, to] });
    }
  }

  // VeritaMap: each "last" date is due 6 months later (24 for the SOP review); one past due moves by whole periods.
  const mapFields: Array<[string, number, string | null]> = [["last_cal_ver", 6, "cal_ver_na"], ["last_method_comp", 6, "method_comp_na"], ["last_precision", 6, null], ["last_sop_review", 24, null]];
  for (const t of all("SELECT t.* FROM veritamap_tests t JOIN veritamap_maps m ON m.id = t.map_id WHERE m.lab_id = ? AND COALESCE(t.active, 1) = 1", labId)) {
    const changes: DatePlanRow["changes"] = {};
    for (const [col, months, naCol] of mapFields) {
      const last = dayOf(t[col]);
      if (!last || (naCol && Number(t[naCol]) === 1)) continue;
      const k = cyclesToCurrent(addLabDays(last, 0, months), today, 0, months);
      if (k) changes[col] = [t[col], moved(t[col], 0, months * k)];
    }
    add("veritamap", "veritamap_tests", t.id, changes);
  }
  for (const c of all("SELECT c.id, c.work_performed_date, c.signoff_date, c.next_due FROM veritamap_test_correlations c JOIN veritamap_tests t ON t.id = c.test_a_id JOIN veritamap_maps m ON m.id = t.map_id WHERE m.lab_id = ?", labId)) {
    roll("veritamap", "veritamap_test_correlations", c, "next_due", 0, 6, ["work_performed_date", "signoff_date"], ["work_performed_date", "signoff_date"]);
  }

  // Documents and policies: reviews past due move by the document's own review interval.
  for (const d of all("SELECT id, review_due_date FROM lab_documents WHERE lab_id = ? AND status = 'active'", labId)) {
    roll("documents", "lab_documents", d, "review_due_date", 0, 12);
  }
  for (const d of all("SELECT id, status, next_review_date, review_interval_months FROM policy_documents WHERE lab_id = ? AND archived_at IS NULL AND status IN ('approved', 'expired')", labId)) {
    const due = dayOf(d.next_review_date);
    if (!due) continue;
    const months = Number(d.review_interval_months) > 0 ? Number(d.review_interval_months) : 24;
    const k = cyclesToCurrent(due, today, 0, months);
    if (!k) continue;
    const changes: DatePlanRow["changes"] = { next_review_date: [d.next_review_date, moved(d.next_review_date, 0, months * k)] };
    // Expired only by the review sweep (its last audit entry is the auto flip): it goes back to approved with the new date.
    // A policy expired by hand stays expired.
    const lastAction = get("SELECT action FROM policy_audit_log WHERE document_id = ? ORDER BY id DESC LIMIT 1", d.id)?.action;
    if (d.status === "expired" && lastAction === "auto_expired") changes.status = ["expired", "approved"];
    add("documents", "policy_documents", d.id, changes);
  }
  for (const p of all("SELECT id, last_reviewed, next_review FROM veritapolicy_lab_policies WHERE lab_id = ?", labId)) {
    roll("documents", "veritapolicy_lab_policies", p, "next_review", 0, 12, ["last_reviewed"], ["last_reviewed"]);
  }
  for (const p of all("SELECT id, next_review FROM iqcp_plans WHERE lab_id = ?", labId)) {
    roll("documents", "iqcp_plans", p, "next_review", 0, 12);
  }
  for (const a of all("SELECT pa.id, pa.due_date FROM policy_attestations pa JOIN policy_documents d ON d.id = pa.document_id WHERE d.lab_id = ? AND pa.completed_at IS NULL", labId)) {
    roll("documents", "policy_attestations", a, "due_date", 30, 0);
  }

  // Open action items: due dates move by 30 days at a time. Closed, accepted or submitted findings and compliant or N/A scan
  // items are history.
  for (const f of all("SELECT id, due_date FROM findings WHERE lab_id = ? AND status IN ('open', 'drafting', 'rejected_resubmit')", labId)) {
    roll("findings", "findings", f, "due_date", 30, 0);
  }
  for (const c of all("SELECT id, due_date FROM finding_effectiveness_checks WHERE lab_id = ? AND status = 'pending'", labId)) {
    roll("findings", "finding_effectiveness_checks", c, "due_date", 30, 0);
  }
  for (const g of all("SELECT id, due_date FROM study_signoff_groups WHERE lab_id = ? AND signed_at IS NULL", labId)) {
    roll("veritacheck", "study_signoff_groups", g, "due_date", 30, 0);
  }
  for (const i of all("SELECT i.id, i.due_date FROM veritascan_items i JOIN veritascan_scans s ON s.id = i.scan_id WHERE s.lab_id = ? AND i.status NOT IN ('Compliant', 'Not Applicable', 'N/A')", labId)) {
    roll("veritascan", "veritascan_items", i, "due_date", 30, 0);
  }
  for (const i of all("SELECT i.id, i.due_date FROM veritascan_custom_item_status i JOIN veritascan_scans s ON s.id = i.scan_id WHERE s.lab_id = ? AND i.status NOT IN ('Compliant', 'Not Applicable', 'N/A')", labId)) {
    roll("veritascan", "veritascan_custom_item_status", i, "due_date", 30, 0);
  }

  // Staff: license and credential documents, and quiz assignments not yet taken.
  for (const d of all("SELECT d.id, d.expiration_date FROM staff_employee_documents d JOIN staff_employees e ON e.id = d.employee_id WHERE e.tier2_lab_id = ? AND e.status = 'active'", labId)) {
    roll("staff", "staff_employee_documents", d, "expiration_date", 0, 12);
  }
  for (const d of all("SELECT d.id, d.expiration_date FROM competency_element_documents d JOIN competency_assessments a ON a.id = d.assessment_id JOIN competency_programs p ON p.id = a.program_id WHERE p.lab_id = ?", labId)) {
    roll("staff", "competency_element_documents", d, "expiration_date", 0, 12);
  }
  for (const q of all("SELECT id, due_date FROM competency_quiz_assignments WHERE lab_id = ? AND status = 'assigned' AND completed_at IS NULL", labId)) {
    roll("staff", "competency_quiz_assignments", q, "due_date", 30, 0);
  }

  rows.push(...planCompetency(sqlite, labId, today));
  return rows;
}

const SCHEDULE_DUE = ["six_month_due_at", "first_annual_due_at", "annual_due_at", "nys_six_month_due_at"];
const SCHEDULE_DONE = ["initial_completed_at", "six_month_completed_at", "first_annual_completed_at", "last_annual_completed_at"];

// Competency (VeritaStaff and VeritaComp): an overdue testing employee has their whole competency timeline (hire date,
// schedule, method sign-offs and method history) moved by the fewest whole months that make the app's own status read not
// overdue with no done date in the future. Whole years left a new hire behind (a year moves the hire date past today), so
// the step is a month (2026-11-16 production run: a hire of 2026-03, 6-month due 2026-11-01). When no shift of the whole
// timeline works (a method signed in the last month would land in the future), the VeritaStaff schedule record moves on its
// own, by the same rule; the method sign-offs keep their own clocks. Anyone that can't be brought current is left as is.
function planCompetency(sqlite: any, labId: number, today: string): DatePlanRow[] {
  const out: DatePlanRow[] = [];
  let emps: any[] = [];
  try {
    emps = sqlite.prepare(
      "SELECT e.id, e.hire_date, e.created_at, s.id AS schedule_id, s.initial_completed_at, s.six_month_due_at, s.six_month_completed_at, s.first_annual_due_at, s.first_annual_completed_at, s.annual_due_at, s.last_annual_completed_at, s.nys_six_month_due_at, s.recorded_as FROM staff_employees e LEFT JOIN staff_competency_schedules s ON s.employee_id = e.id WHERE e.tier2_lab_id = ? AND e.status = 'active' AND e.performs_testing = 1"
    ).all(labId) as any[];
  } catch { return out; }
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const statusOf = (empId: number) => {
    const row = sqlite.prepare(
      "SELECT e.id, s.initial_completed_at, s.six_month_due_at, s.six_month_completed_at, s.first_annual_due_at, s.first_annual_completed_at, s.annual_due_at, s.last_annual_completed_at, s.recorded_as, e.hire_date, e.created_at FROM staff_employees e LEFT JOIN staff_competency_schedules s ON s.employee_id = e.id WHERE e.id = ?"
    ).get(empId);
    return deriveCompetencyStatus(row, todayStart, labMethodClocks(sqlite, labId).get(empId)).bucket;
  };
  for (const e of emps) {
    if (statusOf(e.id) !== "overdue") continue;
    const rowsOf = (sql: string) => { try { return sqlite.prepare(sql).all(labId, e.id) as any[]; } catch { return []; } };
    const signoffs = rowsOf("SELECT id, signed_date FROM competency_method_signoffs WHERE lab_id = ? AND staff_employee_id = ? AND revoked_at IS NULL");
    const history = rowsOf("SELECT id, completed_date FROM competency_method_history WHERE lab_id = ? AND staff_employee_id = ? AND removed_at IS NULL");
    let found: DatePlanRow[] | null = null;
    for (const scope of ["timeline", "schedule"] as const) {
      for (let months = 1; months <= 60 && !found; months++) {
        const plan: DatePlanRow[] = [];
        let future = false;
        const done = (v: string) => { const to = moved(v, 0, months); if (to.slice(0, 10) > today) future = true; return to; };
        if (scope === "timeline" && dayOf(e.hire_date)) plan.push({ module: "competency", table: "staff_employees", id: e.id, labId, changes: { hire_date: [e.hire_date, done(e.hire_date)] } });
        if (e.schedule_id != null) {
          const ch: DatePlanRow["changes"] = {};
          for (const c of SCHEDULE_DONE) if (dayOf(e[c])) ch[c] = [e[c], done(e[c])];
          for (const c of SCHEDULE_DUE) if (dayOf(e[c])) ch[c] = [e[c], moved(e[c], 0, months)];
          if (Object.keys(ch).length) plan.push({ module: "competency", table: "staff_competency_schedules", id: e.schedule_id, labId, changes: ch });
        }
        if (scope === "timeline") {
          for (const s of signoffs) if (dayOf(s.signed_date)) plan.push({ module: "competency", table: "competency_method_signoffs", id: s.id, labId, changes: { signed_date: [s.signed_date, done(s.signed_date)] } });
          for (const h of history) if (dayOf(h.completed_date)) plan.push({ module: "competency", table: "competency_method_history", id: h.id, labId, changes: { completed_date: [h.completed_date, done(h.completed_date)] } });
        }
        // A done date past today only gets later with a bigger shift, so this scope is finished.
        if (future || !plan.length) break;
        sqlite.exec("SAVEPOINT demo_dates_competency");
        let ok = false;
        try {
          applyDemoDates(sqlite, plan);
          ok = statusOf(e.id) !== "overdue";
        } finally {
          sqlite.exec("ROLLBACK TO demo_dates_competency");
          sqlite.exec("RELEASE demo_dates_competency");
        }
        if (ok) found = plan;
      }
      if (found) break;
    }
    if (found) out.push(...found);
  }
  return out;
}

// Only these tables and columns are ever written; anything else in a plan is refused.
const WRITABLE: Record<string, string[]> = {
  lab_certificates: ["expiration_date", "issued_date"],
  clia_fee_payments: ["due_date", "invoice_date"],
  lab_equipment: ["next_due_date"],
  equipment_maintenance_events: ["event_date", "next_due_date"],
  equipment_schedules: ["next_due_date"],
  pt_events: ["submission_due_date", "event_date"],
  aa_records: ["next_due_date", "last_performed_date"],
  qc_control_lots: ["expiration_date"],
  inventory_items: ["expiration_date", "standing_order_review_date", "on_order_expected_date", "on_order_placed_date"],
  inventory_lots: ["expiration_date"],
  inventory_lot_use: ["expiration_date"],
  tissue_units: ["expiration_date"],
  veritatrack_signoffs: ["completed_date"],
  veritamap_tests: ["last_cal_ver", "last_method_comp", "last_precision", "last_sop_review"],
  veritamap_test_correlations: ["next_due", "work_performed_date", "signoff_date"],
  lab_documents: ["review_due_date"],
  policy_documents: ["next_review_date", "status"],
  veritapolicy_lab_policies: ["next_review", "last_reviewed"],
  iqcp_plans: ["next_review"],
  policy_attestations: ["due_date"],
  findings: ["due_date"],
  finding_effectiveness_checks: ["due_date"],
  study_signoff_groups: ["due_date"],
  competency_element_documents: ["expiration_date"],
  veritascan_items: ["due_date"],
  veritascan_custom_item_status: ["due_date"],
  staff_employee_documents: ["expiration_date"],
  competency_quiz_assignments: ["due_date"],
  staff_employees: ["hire_date"],
  staff_competency_schedules: [...SCHEDULE_DONE, ...SCHEDULE_DUE],
  competency_method_signoffs: ["signed_date"],
  competency_method_history: ["completed_date"],
};

/**
 * Writes a plan in one transaction. Each update repeats the values it expects in its WHERE, so a row changed since the plan
 * is left alone. Returns the rows actually changed.
 */
export function applyDemoDates(sqlite: any, plan: DatePlanRow[]): DatePlanRow[] {
  for (const r of plan) {
    const cols = WRITABLE[r.table];
    if (!cols || Object.keys(r.changes).some((c) => !cols.includes(c))) throw new Error(`demo dates: ${r.table} is not writable here`);
  }
  const changed: DatePlanRow[] = [];
  sqlite.transaction(() => {
    for (const r of plan) {
      const cols = Object.keys(r.changes);
      const sets = cols.map((c) => `${c} = ?`).join(", ");
      const wheres = cols.map((c) => `${c} IS ?`).join(" AND ");
      const info = sqlite.prepare(`UPDATE ${r.table} SET ${sets} WHERE id = ? AND ${wheres}`)
        .run(...cols.map((c) => r.changes[c][1]), r.id, ...cols.map((c) => r.changes[c][0]));
      if (info.changes > 0) changed.push(r);
    }
  })();
  return changed;
}

/** Each lab's readiness, as the command center shows it, on that lab's clock. */
export function demoDatesReadiness(sqlite: any, labId: number) {
  try {
    const r = withLabClock(labTimeZoneById(sqlite, labId), () => computeLabReadiness(sqlite, labId));
    return { status: r.overall.status, overdue_items: r.overall.overdue_items, attention_items: r.overall.attention_items, modules: Object.fromEntries(r.modules.map((m: any) => [m.key, m.status])) };
  } catch { return null; }
}

/** A dry run's "after": each lab's readiness with the plan written inside a savepoint that is then rolled back. */
export function previewDemoDatesReadiness(sqlite: any, plan: DatePlanRow[], labIds: number[]) {
  sqlite.exec("SAVEPOINT demo_dates_preview");
  try {
    applyDemoDates(sqlite, plan);
    return Object.fromEntries(labIds.map((id) => [id, demoDatesReadiness(sqlite, id)]));
  } finally {
    sqlite.exec("ROLLBACK TO demo_dates_preview");
    sqlite.exec("RELEASE demo_dates_preview");
  }
}

/** Counts by lab and module: the report a dry run and a write both return (no names). */
export function demoDatesSummary(plan: DatePlanRow[]) {
  const byLab: Record<number, Record<string, number>> = {};
  for (const r of plan) {
    const m = (byLab[r.labId] ??= {});
    m[`${r.module}.${r.table}`] = (m[`${r.module}.${r.table}`] || 0) + 1;
  }
  return byLab;
}
