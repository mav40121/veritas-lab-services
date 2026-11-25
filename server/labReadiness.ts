// server/labReadiness.ts
//
// MLC-3: cross-module inspection-readiness rollup (GET /api/labs/:labId/readiness and GET /api/readiness/rollup).
// One aggregate per lab: a status per module (ok / attention / overdue / not_set_up) from each module's own data, plus a
// lab-level roll-up. Each module block is independently try/caught so one query failing never blanks the whole pane.
//
// Moved out of routes.ts (2026-11-11) for the compliance digest (server/digestCounts.ts), which reads the same
// equipment and certificate counts. "Today" is the request's lab clock (labToday()), so a caller with no request runs it
// inside withLabClock.
//
// Findings, documents and verification studies, and "Not set up" (B2, 2026-11-24). Each count is the one
// its module's own screen shows, read through the same function: shared/findingCounts.ts (the VeritaResponse list),
// server/policyComplianceCounts.ts (the VeritaDC compliance page) and VeritaCheck Coverage (server/coverageCounts.ts).
//   - overdue   a date has passed: a finding past its deadline, a document past its review or expired, a study past due
//   - due_soon  a date is near (30 days for these three), and a finding past a soft target (COLA, AABB), which is never overdue
//   - other     needs someone and has no date: a required study missing or to review, a document waiting for approval
// A module with nothing set up reads not_set_up, never ok, and is left out of modules_total, modules_ok and the percent.
// Set up means the lab has something for the module to watch, so finished work still reads ok: PT events all graded, QC
// lots all retired, findings all closed, every study current.

import { labToday } from "./dateLocal";
import { deriveCompetencyStatus, labMethodClocks } from "./competencyReminders";
import { isFindingOpen, isFindingPastDue } from "@shared/findingCounts";
import { policyComplianceHeadline, policyDueSoonDocuments, policyOverdueDocuments } from "./policyComplianceCounts";
import { coverageCountsForLab } from "./coverageCounts";

export type ReadinessStatus = "ok" | "attention" | "overdue" | "not_set_up";
export interface ReadinessModule {
  key: string; label: string; status: ReadinessStatus;
  overdue: number; due_soon: number; other: number; other_label: string | null; total: number; headline: string;
  counts?: Record<string, number>;
}

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

/**
 * VeritaResponse findings by the list's rule: open, due within 30 days, past due (hard deadlines only), and past target
 * (a soft clock, COLA or AABB for example, whose date has passed). total counts every finding on file, closed ones too.
 */
export function findingReadinessCounts(client: any, labId: number, today: string): { open: number; dueIn30: number; pastDue: number; pastTarget: number; total: number } {
  const rows = client.prepare("SELECT status, accreditor, due_date FROM findings WHERE lab_id = ?").all(labId) as any[];
  let open = 0, dueIn30 = 0, pastDue = 0, pastTarget = 0;
  for (const f of rows) {
    if (!isFindingOpen(f)) continue;
    open++;
    if (!f.due_date) continue;
    if (isFindingPastDue(f, today)) { pastDue++; continue; }
    const d = daysBetween(today, String(f.due_date).slice(0, 10));
    if (d < 0) pastTarget++; else if (d <= 30) dueIn30++;
  }
  return { open, dueIn30, pastDue, pastTarget, total: rows.length };
}

/** VeritaDC documents as the compliance page counts them: overdue for review, due within 30 days, expired, waiting for approval. */
export function documentReadinessCounts(client: any, labId: number, today: string): { overdueReview: number; dueIn30: number; expired: number; waiting: number; drafts: number; inUse: number } {
  const h = policyComplianceHeadline(client, labId);
  const n = (v: unknown) => Number(v || 0);
  return {
    overdueReview: policyOverdueDocuments(client, labId, today).length,
    dueIn30: policyDueSoonDocuments(client, labId, today).length,
    expired: n(h?.expired_total), waiting: n(h?.in_review_total), drafts: n(h?.draft_total),
    inUse: n(h?.approved_total) + n(h?.expired_total),
  };
}

export function computeLabReadiness(client: any, labId: number) {
  const today = labToday();
  const daysTo = (d: string) => daysBetween(today, d);
  const modules: ReadinessModule[] = [];
  // setUp: the lab has something for this module to watch (default: total > 0). say: the headline when it isn't the standard one.
  const push = (key: string, label: string, overdue: number, dueSoon: number, total: number, unit: string,
    more: { setUp?: boolean; notSetUp?: string; clear?: string; say?: string; other?: number; otherLabel?: string; counts?: Record<string, number> } = {}) => {
    const other = more.other ?? 0;
    const setUp = more.setUp ?? total > 0;
    const status: ReadinessStatus = overdue > 0 ? "overdue" : dueSoon > 0 || other > 0 ? "attention" : setUp ? "ok" : "not_set_up";
    const headline = status === "not_set_up" ? (more.notSetUp ?? `No ${unit} tracked`)
      : status === "ok" ? (total > 0 ? (more.clear ?? `${total} ${unit}, all current`) : `No ${unit}`)
      : more.say ?? (overdue > 0 ? `${overdue} overdue${dueSoon > 0 ? `, ${dueSoon} due soon` : ""}` : `${dueSoon} due soon`);
    modules.push({ key, label, status, overdue, due_soon: dueSoon, other, other_label: other > 0 ? (more.otherLabel ?? null) : null, total, headline, ...(more.counts ? { counts: more.counts } : {}) });
  };
  const has = (sql: string) => !!client.prepare(sql).get(labId);
  const list = (parts: [number, string][]) => parts.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`).join(", ");

  // Equipment maintenance (next_due_date; due-soon within 30d)
  try {
    const eq = equipmentDueCounts(client, labId, today);
    push("equipment", "Equipment maintenance", eq.overdue, eq.dueIn30, eq.total, "instruments");
  } catch {}
  // PT submission deadlines (pending events; due-soon within 14d)
  try {
    const rows = client.prepare("SELECT submission_due_date FROM pt_events WHERE lab_id = ? AND pass_fail = 'pending' AND submission_due_date IS NOT NULL AND TRIM(submission_due_date) <> ''").all(labId) as any[];
    let od = 0, ds = 0; for (const r of rows) { const d = daysTo(r.submission_due_date); if (d < 0) od++; else if (d <= 14) ds++; }
    push("pt_deadlines", "PT submission deadlines", od, ds, rows.length, "pending submissions",
      { setUp: rows.length > 0 || has("SELECT 1 FROM pt_events WHERE lab_id = ? LIMIT 1"), notSetUp: "No PT events entered" });
  } catch {}
  // QC corrective actions (rejection violations with no CA filed; a voided run owes none, BUG-198)
  try {
    const miss = client.prepare("SELECT COUNT(*) AS n FROM qc_rule_violations v WHERE v.severity = 'rejection' AND v.superseded_at IS NULL AND v.qc_result_id IN (SELECT id FROM qc_results WHERE lab_id = ? AND voided_at IS NULL) AND NOT EXISTS (SELECT 1 FROM qc_corrective_actions ca WHERE ca.qc_result_id = v.qc_result_id)").get(labId).n as number;
    const lots = client.prepare("SELECT COUNT(*) AS n FROM qc_control_lots WHERE lab_id = ? AND status = 'active'").get(labId).n as number;
    push("qc", "QC corrective actions", miss, 0, lots, "active lots",
      { setUp: lots > 0 || has("SELECT 1 FROM qc_control_lots WHERE lab_id = ? LIMIT 1"), notSetUp: "No control lots entered" });
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
  // Findings (VeritaResponse, every entry type its list holds; due within 30d; past due = hard deadlines only)
  try {
    const f = findingReadinessCounts(client, labId, today);
    push("findings", "Findings", f.pastDue, f.dueIn30 + f.pastTarget, f.total, "findings", {
      notSetUp: "No findings recorded",
      clear: f.open > 0 ? `${f.open} open, none due within 30 days` : `No open findings (${f.total} on file)`,
      say: `${f.open} open: ${list([[f.pastDue, "past due"], [f.dueIn30, "due within 30 days"], [f.pastTarget, "past target"]])}`,
      counts: { open: f.open, due_in_30: f.dueIn30, past_due: f.pastDue, past_target: f.pastTarget },
    });
  } catch {}
  // Documents (VeritaDC: overdue for review, expired, due within 30d, waiting for approval). Drafts alone aren't a set-up library.
  try {
    const d = documentReadinessCounts(client, labId, today);
    const total = d.inUse + d.waiting;
    push("documents", "Documents", d.overdueReview + d.expired, d.dueIn30, total, "documents", {
      notSetUp: d.drafts > 0 ? `No documents in use (${d.drafts} ${d.drafts === 1 ? "draft" : "drafts"})` : "No documents in VeritaDC™",
      say: list([[d.overdueReview, "overdue for review"], [d.expired, "expired"], [d.dueIn30, "due within 30 days"], [d.waiting, "waiting for approval"]]),
      other: d.waiting, otherLabel: "waiting for approval",
      counts: { overdue_review: d.overdueReview, expired: d.expired, due_in_30: d.dueIn30, waiting_approval: d.waiting },
    });
  } catch {}
  // Verification studies (VeritaCheck Coverage: calibration verification / linearity and method comparison, against the map)
  try {
    const v = coverageCountsForLab(client, labId);
    push("verification", "Verification studies", v.overdue, v.dueSoon, v.required, "required studies", {
      setUp: v.hasMap, notSetUp: "No tests on the VeritaMap®",
      say: list([[v.overdue, "overdue"], [v.missing, "missing"], [v.review, "to review"], [v.dueSoon, "due within 30 days"]]),
      other: v.missing + v.review, otherLabel: v.review === 0 ? "missing" : v.missing === 0 ? "to review" : "missing or to review",
      counts: { required: v.required, missing: v.missing, review: v.review, overdue: v.overdue, due_in_30: v.dueSoon },
    });
  } catch {}

  const tracked = modules.filter(m => m.status !== "not_set_up");
  const modules_ok = tracked.filter(m => m.status === "ok").length;
  const overdue_items = modules.reduce((a, m) => a + m.overdue, 0);
  const other_items = modules.reduce((a, m) => a + m.other, 0);
  const attention_items = modules.reduce((a, m) => a + m.overdue + m.due_soon + m.other, 0);
  const status: ReadinessStatus = overdue_items > 0 ? "overdue" : attention_items > 0 ? "attention" : tracked.length > 0 ? "ok" : "not_set_up";
  return {
    modules,
    overall: {
      modules_total: tracked.length, modules_ok, modules_not_set_up: modules.length - tracked.length,
      attention_items, overdue_items, other_items, status,
    },
  };
}
