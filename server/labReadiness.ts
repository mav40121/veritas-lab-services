// server/labReadiness.ts
//
// MLC-3: cross-module inspection-readiness rollup (GET /api/labs/:labId/readiness and GET /api/readiness/rollup).
// One aggregate per lab: a status per module (ok / attention / overdue) from each module's own data, plus a
// lab-level roll-up. Each module block is independently try/caught so one query failing never blanks the whole pane.
//
// Moved out of routes.ts (2026-11-11) for the compliance digest (server/digestCounts.ts), which reads the same
// equipment and certificate counts. The routes' answers are unchanged. "Today" is the request's lab clock (labToday()),
// so a caller with no request runs it inside withLabClock.

import { labToday } from "./dateLocal";
import { deriveCompetencyStatus, labMethodClocks } from "./competencyReminders";

const daysBetween = (today: string, d: string) => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);

/** Equipment maintenance by lab_equipment.next_due_date: overdue, and due within 30 days. Retired instruments are left out. */
export function equipmentDueCounts(client: any, labId: number, today: string): { overdue: number; dueIn30: number; total: number } {
  const rows = client.prepare("SELECT next_due_date FROM lab_equipment WHERE lab_id = ? AND status <> 'retired'").all(labId) as any[];
  let od = 0, ds = 0; for (const r of rows) { if (!r.next_due_date) continue; const d = daysBetween(today, r.next_due_date); if (d < 0) od++; else if (d <= 30) ds++; }
  return { overdue: od, dueIn30: ds, total: rows.length };
}

/**
 * This lab's active certificates (by lab_id, as VeritaLab lists them): expired, and expiring within `windowDays`
 * (counted from today, inclusive). Readiness uses 60 days; the compliance digest uses 90.
 */
export function certificateExpiryCounts(client: any, labId: number, today: string, windowDays: number): { expired: number; expiring: number; total: number } {
  const rows = client.prepare("SELECT expiration_date FROM lab_certificates WHERE lab_id = ? AND is_active = 1 AND expiration_date IS NOT NULL AND TRIM(expiration_date) <> ''").all(labId) as any[];
  let od = 0, ds = 0; for (const r of rows) { const d = daysBetween(today, String(r.expiration_date).slice(0, 10)); if (d < 0) od++; else if (d <= windowDays) ds++; }
  return { expired: od, expiring: ds, total: rows.length };
}

export function computeLabReadiness(client: any, labId: number) {
  const today = labToday();
  const daysTo = (d: string) => daysBetween(today, d);
  const modules: any[] = [];
  const push = (key: string, label: string, overdue: number, dueSoon: number, total: number, unit: string) => {
    const status = overdue > 0 ? "overdue" : dueSoon > 0 ? "attention" : "ok";
    const headline = overdue > 0 ? `${overdue} overdue${dueSoon > 0 ? `, ${dueSoon} due soon` : ""}`
      : dueSoon > 0 ? `${dueSoon} due soon`
      : total > 0 ? `${total} ${unit}, all current`
      : `No ${unit} tracked`;
    modules.push({ key, label, status, overdue, due_soon: dueSoon, total, headline });
  };
  // Equipment maintenance (next_due_date; due-soon within 30d)
  try {
    const eq = equipmentDueCounts(client, labId, today);
    push("equipment", "Equipment maintenance", eq.overdue, eq.dueIn30, eq.total, "instruments");
  } catch {}
  // PT submission deadlines (pending events; due-soon within 14d)
  try {
    const rows = client.prepare("SELECT submission_due_date FROM pt_events WHERE lab_id = ? AND pass_fail = 'pending' AND submission_due_date IS NOT NULL AND TRIM(submission_due_date) <> ''").all(labId) as any[];
    let od = 0, ds = 0; for (const r of rows) { const d = daysTo(r.submission_due_date); if (d < 0) od++; else if (d <= 14) ds++; }
    push("pt_deadlines", "PT submission deadlines", od, ds, rows.length, "pending submissions");
  } catch {}
  // QC corrective actions (rejection violations with no CA filed)
  try {
    const miss = client.prepare("SELECT COUNT(*) AS n FROM qc_rule_violations v WHERE v.severity = 'rejection' AND v.superseded_at IS NULL AND v.qc_result_id IN (SELECT id FROM qc_results WHERE lab_id = ?) AND NOT EXISTS (SELECT 1 FROM qc_corrective_actions ca WHERE ca.qc_result_id = v.qc_result_id)").get(labId).n as number;
    const lots = client.prepare("SELECT COUNT(*) AS n FROM qc_control_lots WHERE lab_id = ? AND status = 'active'").get(labId).n as number;
    push("qc", "QC corrective actions", miss, 0, lots, "active lots");
  } catch {}
  // Certificate expirations (this lab's certificates, by lab_id, as VeritaLab lists them;
  // due-soon 60d). BUG-033: keyed by the owner's user_id this counted every lab the owner
  // owns and missed this lab's certificates filed under another user.
  try {
    const c = certificateExpiryCounts(client, labId, today, 60);
    push("certificates", "Certificate expirations", c.expired, c.expiring, c.total, "certificates");
  } catch {}
  // Competency (testing staff whose next assessment is overdue; due-soon 30d).
  // Mirrors the next-due classification used by /compliance/score.
  try {
    const emps = client.prepare(
      "SELECT e.id, s.initial_completed_at, s.six_month_due_at, s.six_month_completed_at, s.first_annual_due_at, s.first_annual_completed_at, s.annual_due_at, s.last_annual_completed_at, s.recorded_as, e.hire_date, e.created_at FROM staff_employees e LEFT JOIN staff_competency_schedules s ON s.employee_id = e.id WHERE e.tier2_lab_id = ? AND e.status = 'active' AND e.performs_testing = 1"
    ).all(labId) as any[];
    const methodClocks = labMethodClocks(client, labId); // BUG-069: per-method due status
    let od = 0, ds = 0;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    for (const e of emps) {
      // Shared walk (server/competencyReminders.ts).
      const st = deriveCompetencyStatus(e, todayStart, methodClocks.get(e.id));
      if (st.bucket === "overdue") od++; else if (st.bucket === "dueSoon30") ds++;
    }
    push("competency", "Competency assessments", od, ds, emps.length, "testing staff");
  } catch {}

  const modules_ok = modules.filter(m => m.status === "ok").length;
  const overdue_items = modules.reduce((a, m) => a + m.overdue, 0);
  const attention_items = modules.reduce((a, m) => a + m.overdue + m.due_soon, 0);
  return {
    modules,
    overall: {
      modules_total: modules.length, modules_ok, attention_items, overdue_items,
      status: overdue_items > 0 ? "overdue" : attention_items > 0 ? "attention" : "ok",
    },
  };
}
