import type { Express } from "express";
import crypto from "crypto";
import { db } from "./db";
import { applyLicenseToExcelJS } from "./licenseStamp";
import type { LicenseContext } from "@shared/licenseText";
import { resolveRowForMutation, resolveLegacyLabId } from "./labAccessGuard";

function trackLicenseCtx(req: any): LicenseContext {
  const u = req?.user || null;
  const sqlite = (db as any).$client;
  const ownerId = req?.ownerUserId ?? req?.userId;
  const row = ownerId
    ? (sqlite.prepare("SELECT clia_lab_name, clia_number FROM users WHERE id = ?").get(ownerId) as any)
    : null;
  if (u?.email) {
    return {
      licensee: row?.clia_lab_name || u.name || u.email,
      email: u.email,
      plan: u.plan,
      issueDate: new Date().toISOString().slice(0, 10),
    };
  }
  const ipRaw = (req?.ip || req?.headers?.["x-forwarded-for"] || "").toString();
  const ipHash = ipRaw
    ? "ip-" + crypto.createHash("sha256").update(ipRaw).digest("hex").slice(0, 8)
    : "anonymous";
  return { licensee: "Demo Preview", email: ipHash, plan: "demo", issueDate: new Date().toISOString().slice(0, 10) };
}

function frequencyToMonths(freq: string): number {
  switch (freq) {
    case "Monthly":   return 1;
    case "Quarterly": return 3;
    case "Biannual":  return 6;
    case "Annual":    return 12;
    case "Biennial":  return 24;
    default:          return 1;
  }
}

function nextDue(lastDate: string | null, frequencyMonths: number): string {
  const base = lastDate ? new Date(lastDate) : new Date();
  base.setMonth(base.getMonth() + frequencyMonths);
  return base.toISOString().split("T")[0];
}

// #6 (2026-07-11): whole-day difference between today and a YYYY-MM-DD date,
// computed date-only (both parsed as UTC midnight). The prior code diffed a
// UTC-midnight due date against a live timestamp, so in any US (negative-UTC-
// offset) timezone a task read "overdue" on its actual due date and the
// Due-Today bucket was always empty. Date-only makes due-today == 0.
function daysUntilDateOnly(dateStr: string): number {
  const todayStr = new Date().toISOString().slice(0, 10);
  return Math.round((Date.parse(dateStr + "T00:00:00Z") - Date.parse(todayStr + "T00:00:00Z")) / 86400000);
}

function taskStatus(nextDueDate: string): "overdue" | "due_soon" | "current" | "not_started" {
  const daysUntil = daysUntilDateOnly(nextDueDate);
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= 30) return "due_soon";
  return "current";
}

export function registerVeritaTrackRoutes(
  app: Express,
  authMiddleware: any,
  requireWriteAccess: any,
  requireModuleEdit: any
) {
  const sqlite = (db as any).$client;

  // Wave B3 (2026-06-12): append-only VeritaTrack audit writer. Never throws
  // into the caller; an audit failure must not break a sign-off or an edit.
  function trackAudit(opts: {
    labId: number | null; taskId: number | null; signoffId?: number | null;
    event: string; detail?: string | null; byUserId: number | null;
  }) {
    try {
      sqlite.prepare(
        "INSERT INTO veritatrack_audit (lab_id, task_id, signoff_id, event, detail, by_user_id) VALUES (?,?,?,?,?,?)"
      ).run(opts.labId ?? null, opts.taskId ?? null, opts.signoffId ?? null, opts.event, opts.detail ?? null, opts.byUserId ?? null);
    } catch { /* audit must never break the operation */ }
  }

  function hasTrackAccess(user: any, lab?: any) {
    const plan = lab?.plan ?? user?.plan;
    return [
      "annual","professional","lab","complete","waived",
      "community","hospital","large_hospital","enterprise",
    ].includes(plan);
  }

  // ── VeritaTrack 3-element framework, move-1 (2026-06-07): today's
  // worklist. Move-1 is "reduce time-to-action": the director shouldn't
  // have to mentally compute which tasks are due now. This endpoint
  // pre-buckets every active task into overdue / due_today /
  // due_this_week / due_next_30 so the dashboard tile can render
  // immediate-action lists without recomputing on the client.
  //
  // Lab-scoped via the Phase 3.7 dual-write lab_id column.
  app.get(
    "/api/labs/:labId/veritatrack/worklist",
    authMiddleware,
    (req: any, res) => {
      if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack™ subscription required" });
      // SECURITY (multi-lab IDOR fix, 2026-07-11): resolve + membership-validate
      // the lab via resolveLegacyLabId (the SAME guard the /tasks list read uses
      // at line ~349) instead of trusting req.params.labId. Without this, the
      // route had authMiddleware only (no labScopeMiddleware, unlike its /tasks
      // and /dashboard siblings), so any authenticated track-plan user could
      // read ANY lab's worklist + cross-module data by passing an arbitrary
      // :labId. resolveLegacyLabId ignores a forged foreign lab and falls back
      // to the requester's own validated lab, so no cross-lab read is possible.
      const labId = resolveLegacyLabId(sqlite, req);
      if (labId == null) return res.status(400).json({ error: "No lab resolved" });
      const tasks = sqlite.prepare(
        "SELECT * FROM veritatrack_tasks WHERE lab_id = ? AND active = 1 ORDER BY category, name"
      ).all(labId) as any[];
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const buckets: any = { overdue: [], due_today: [], due_this_week: [], due_next_30: [] };
      for (const t of tasks) {
        const last = sqlite.prepare(
          "SELECT * FROM veritatrack_signoffs WHERE task_id = ? ORDER BY completed_date DESC LIMIT 1"
        ).get(t.id) as any;
        const nextDueDate = last ? nextDue(last.completed_date, t.frequency_months) : null;
        // Not-started tasks (no signoff yet) appear as overdue so the
        // director sees them immediately rather than having them sit
        // invisible until their first signoff.
        if (!last) {
          buckets.overdue.push({ ...t, last_signoff: null, next_due: null, status: "not_started" });
          continue;
        }
        const due = new Date(nextDueDate!);
        const daysUntil = Math.floor((due.getTime() - today.getTime()) / 86400000);
        const enriched = { ...t, last_signoff: last, next_due: nextDueDate, status: taskStatus(nextDueDate!) };
        if (daysUntil < 0) buckets.overdue.push(enriched);
        else if (nextDueDate === todayStr) buckets.due_today.push(enriched);
        else if (daysUntil <= 7) buckets.due_this_week.push(enriched);
        else if (daysUntil <= 30) buckets.due_next_30.push(enriched);
      }
      // VeritaTrack 3-element framework, move-3 (close the seams)
      // Wave B2 (2026-06-07): cross-module items that need action but
      // aren't formal VeritaTrack tasks today. Two seam sources:
      // 1) VeritaLab certificates with expiration_date in the next
      //    90 days. CLIA cert renewal is the canonical example.
      // 2) VeritaPolicy approved documents past their next_review_date.
      //
      // Surfaced as a `cross_module` array on the worklist response so
      // the dashboard tile can show "renewal due" / "policy overdue"
      // alongside formal VeritaTrack tasks. Read-only here; the lab
      // converts a cross-module item into a real task by creating one
      // in the respective module.
      const certs = sqlite.prepare(`
        SELECT lc.id, lc.cert_type, lc.cert_name, lc.cert_number,
               lc.expiration_date, lc.lab_director
          FROM lab_certificates lc
         WHERE lc.lab_id = ?
           AND lc.is_active = 1
           AND lc.expiration_date IS NOT NULL
           AND lc.expiration_date != ''
           AND date(lc.expiration_date) <= date('now', '+90 days')
         ORDER BY lc.expiration_date ASC
      `).all(labId) as any[];

      const policies = sqlite.prepare(`
        SELECT d.id, d.title, d.next_review_date, m.name AS manual_name
          FROM policy_documents d
          LEFT JOIN policy_manuals m ON m.id = d.manual_id
         WHERE d.lab_id = ?
           AND d.archived_at IS NULL
           AND d.status = 'approved'
           AND d.next_review_date IS NOT NULL
           AND date(d.next_review_date) <= date('now', '+30 days')
         ORDER BY d.next_review_date ASC
      `).all(labId) as any[];

      // Wave C2 (VeritaPT move-3, 2026-06-07): AT-RISK PT analytes
      // surface as cross-module seam items. Computes the same 2-of-3
      // consecutive logic from /api/veritapt/trends but lab-scoped via
      // the Phase 3.6 lab_id column on pt_events. WATCH analytes are
      // omitted from the seam list (the per-page VeritaPT banner
      // handles the WATCH/AT-RISK early warning at the source); only
      // AT-RISK breaches that put the lab past the §493.803 line make
      // it into the worklist.
      const ptEvents = sqlite.prepare(`
        SELECT analyte, event_date, pass_fail
          FROM pt_events
         WHERE lab_id = ?
           AND pass_fail IN ('pass', 'fail')
         ORDER BY analyte ASC, event_date DESC
      `).all(labId) as Array<{ analyte: string; event_date: string; pass_fail: string }>;
      const ptByAnalyte: Record<string, Array<{ event_date: string; pass_fail: string }>> = {};
      for (const e of ptEvents) {
        if (!ptByAnalyte[e.analyte]) ptByAnalyte[e.analyte] = [];
        if (ptByAnalyte[e.analyte].length < 3) ptByAnalyte[e.analyte].push({ event_date: e.event_date, pass_fail: e.pass_fail });
      }
      const ptAtRisk = Object.entries(ptByAnalyte)
        .filter(([_, last3]) => last3.filter(e => e.pass_fail === "fail").length >= 2)
        .map(([analyte, last3]) => ({
          analyte,
          last_event_date: last3[0]?.event_date || "",
        }));

      // Wave D1 (VeritaQC move-3, 2026-06-07): open VeritaQC corrective
      // actions surface in the worklist. Once a Westgard violation gets
      // a corrective-action ticket opened, the lab director has a
      // CMS §493.1282 record to close. Surfacing them on the
      // single-pane worklist tightens the loop: open today, close
      // tomorrow, surveyor can see the chain.
      const qcOpenCAs = sqlite.prepare(`
        SELECT ca.id, ca.action_taken, ca.taken_at,
               cl.analyte, cl.level AS qc_level, cl.lot_number
          FROM qc_corrective_actions ca
          JOIN qc_results qr ON qr.id = ca.qc_result_id
          JOIN qc_control_lots cl ON cl.id = qr.control_lot_id
         WHERE ca.lab_id = ?
           AND ca.status = 'open'
         ORDER BY ca.taken_at ASC
         LIMIT 20
      `).all(labId) as any[];

      // Wave E1 (VeritaScan move-3, 2026-06-07): VeritaScan documents
      // past their review_due_date surface in the worklist. Pre-A1.1
      // documents (no review_due_date) are exempt from the seam
      // because they don't carry the review-cycle anchor.
      const scanNeedsReview = sqlite.prepare(`
        SELECT id, title, display_label, document_type, review_due_date
          FROM lab_documents
         WHERE lab_id = ?
           AND status = 'active'
           AND review_due_date IS NOT NULL
           AND review_due_date != ''
           AND date(review_due_date) <= date('now', '+30 days')
         ORDER BY review_due_date ASC
         LIMIT 20
      `).all(labId) as any[];

      // Wave F1 (VeritaComp move-3, 2026-06-07): staff competency
      // milestones whose due date is in the next 30 days AND have not
      // been completed yet. CLIA §493.1235 chain: initial, 6-month,
      // 1st annual, annual. Surveyor reads this as the lab director's
      // active competency-management record. Three milestones tracked
      // separately so the worklist labels them ("6-month", "1st annual",
      // "annual") without forcing the director to remember which one
      // is due for which employee.
      const compEmployees = sqlite.prepare(`
        SELECT cs.id, cs.six_month_due_at, cs.six_month_completed_at,
               cs.first_annual_due_at, cs.first_annual_completed_at,
               cs.annual_due_at, cs.last_annual_completed_at,
               e.first_name, e.last_name
          FROM staff_competency_schedules cs
          JOIN staff_employees e ON e.id = cs.employee_id
         WHERE e.tier2_lab_id = ?
           AND e.status = 'active'
      `).all(labId) as any[];

      const compMilestonesDue: Array<{ csId: number; employeeName: string; milestone: string; dueAt: string }> = [];
      for (const r of compEmployees) {
        const empName = `${r.last_name}, ${r.first_name}`;
        const candidates: Array<{ milestone: string; dueAt: string | null; doneAt: string | null }> = [
          { milestone: "6-month", dueAt: r.six_month_due_at, doneAt: r.six_month_completed_at },
          { milestone: "1st annual", dueAt: r.first_annual_due_at, doneAt: r.first_annual_completed_at },
          { milestone: "annual", dueAt: r.annual_due_at, doneAt: r.last_annual_completed_at },
        ];
        for (const c of candidates) {
          if (!c.dueAt || c.doneAt) continue;
          const dueDt = new Date(c.dueAt);
          const horizon = new Date();
          horizon.setDate(horizon.getDate() + 30);
          if (dueDt <= horizon) {
            compMilestonesDue.push({ csId: r.id, employeeName: empName, milestone: c.milestone, dueAt: c.dueAt });
          }
        }
      }
      compMilestonesDue.sort((a, b) => a.dueAt.localeCompare(b.dueAt));

      // Wave C3 (VeritaResponse effectiveness monitoring, 2026-06-12): pending
      // 30/60/90-day effectiveness checkpoints due in the next 30 days surface
      // in the worklist. A closed plan of correction is not finished until its
      // corrective action is verified effective over time; this keeps that
      // verification on the single-pane action list.
      const effChecks = sqlite.prepare(`
        SELECT ec.id, ec.finding_id, ec.interval_days, ec.due_date,
               f.finding_number, f.accreditor, f.standard_ref
          FROM finding_effectiveness_checks ec
          JOIN findings f ON f.id = ec.finding_id
         WHERE ec.lab_id = ?
           AND ec.status = 'pending'
           AND date(ec.due_date) <= date('now', '+30 days')
         ORDER BY ec.due_date ASC
         LIMIT 20
      `).all(labId) as any[];

      const crossModule = [
        ...effChecks.map((e: any) => ({
          source: "veritaresponse",
          source_id: e.finding_id,
          label: `Effectiveness check (${e.interval_days}-day): ${e.finding_number || e.accreditor + " finding"}`,
          due_date: e.due_date,
          link: `/labs/${labId}/veritaresponse/${e.finding_id}`,
        })),
        ...certs.map(c => ({
          source: "veritalab",
          source_id: c.id,
          label: `${c.cert_name}${c.cert_number ? " (" + c.cert_number + ")" : ""} expiration`,
          due_date: c.expiration_date,
          link: `/labs/${labId}/veritalab`,
        })),
        ...policies.map(p => ({
          source: "veritapolicy",
          source_id: p.id,
          label: `Review policy: ${p.title}`,
          due_date: p.next_review_date,
          link: `/labs/${labId}/veritapolicy-app/my-policies`,
        })),
        ...ptAtRisk.map((r, idx) => ({
          source: "veritapt",
          source_id: idx,
          label: `PT AT-RISK: ${r.analyte} (§493.803)`,
          due_date: r.last_event_date,
          link: `/labs/${labId}/veritapt`,
        })),
        ...qcOpenCAs.map((ca: any) => ({
          source: "veritaqc",
          source_id: ca.id,
          label: `QC corrective action open: ${ca.analyte} ${ca.qc_level || ""} lot ${ca.lot_number || ""}`.trim(),
          due_date: ca.taken_at?.slice(0, 10) || "",
          link: `/labs/${labId}/veritaqc-app`,
        })),
        ...scanNeedsReview.map((d: any) => ({
          source: "veritascan",
          source_id: d.id,
          label: `Document review due: ${d.display_label || d.title}`,
          due_date: d.review_due_date,
          link: `/labs/${labId}/veritascan`,
        })),
        ...compMilestonesDue.slice(0, 20).map((m) => ({
          source: "veritacomp",
          source_id: m.csId,
          label: `Competency ${m.milestone} due: ${m.employeeName}`,
          due_date: m.dueAt,
          link: `/labs/${labId}/veritacomp-app`,
        })),
      ];

      const counts = {
        overdue: buckets.overdue.length,
        due_today: buckets.due_today.length,
        due_this_week: buckets.due_this_week.length,
        due_next_30: buckets.due_next_30.length,
        cross_module: crossModule.length,
      };
      res.json({ today: todayStr, counts, buckets, cross_module: crossModule });
    },
  );

  // GET all tasks with latest sign-off and computed status
  // Shape A broader sweep (2026-06-09): scope by the active lab via
  // resolveLegacyLabId, not the user's user_id. Multi-lab owners
  // viewing /veritatrack on a secondary lab were seeing primary-lab
  // tasks bleed in.
  app.get("/api/veritatrack/tasks", authMiddleware, (req: any, res) => {
    if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    const labId = resolveLegacyLabId((db as any).$client, req);
    if (!labId) return res.json([]);
    const tasks = sqlite.prepare(
      "SELECT * FROM veritatrack_tasks WHERE lab_id = ? AND active = 1 ORDER BY category, name"
    ).all(labId) as any[];
    const result = tasks.map((t: any) => {
      const last = sqlite.prepare(
        "SELECT * FROM veritatrack_signoffs WHERE task_id = ? ORDER BY completed_date DESC LIMIT 1"
      ).get(t.id) as any;
      const nextDueDate = last ? nextDue(last.completed_date, t.frequency_months) : null;
      const status = last ? taskStatus(nextDueDate!) : "not_started";
      return { ...t, last_signoff: last || null, next_due: nextDueDate, status };
    });
    res.json(result);
  });

  // GET single task with all sign-offs \u2014 Shape A guard via resolveRowForMutation.
  app.get("/api/veritatrack/tasks/:id", authMiddleware, (req: any, res) => {
    if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    const { row: task, status } = resolveRowForMutation<any>((db as any).$client, "veritatrack_tasks", Number(req.params.id), req);
    if (!task) {
      if (status === 403) return res.status(403).json({ error: "You don't have access to this task's lab" });
      return res.status(404).json({ error: "Task not found" });
    }
    const signoffs = sqlite.prepare(
      "SELECT * FROM veritatrack_signoffs WHERE task_id = ? ORDER BY completed_date DESC"
    ).all(task.id);
    const last = (signoffs as any[])[0] || null;
    const nextDueDate = last ? nextDue(last.completed_date, task.frequency_months) : null;
    res.json({ ...task, signoffs, next_due: nextDueDate, status: last ? taskStatus(nextDueDate!) : "not_started" });
  });

  // POST create task
  app.post("/api/veritatrack/tasks", authMiddleware, requireWriteAccess, requireModuleEdit('veritatrack'), (req: any, res) => {
    if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const { name, category, instrument, owner, frequency, frequency_months, map_analyte, map_field, notes } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const freqMonths = frequency_months || frequencyToMonths(frequency || "Monthly");
    const now = new Date().toISOString();
    const r = sqlite.prepare(
      "INSERT INTO veritatrack_tasks (user_id,name,category,instrument,owner,frequency,frequency_months,map_analyte,map_field,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(userId, name, category || "Other", instrument || null, owner || null, frequency || "Monthly", freqMonths, map_analyte || null, map_field || null, notes || null, now, now);
    // write-path Shape A (resolver unification PR B): tag via the SAME shared
    // resolveLegacyLabId the tasks list read uses, so write==read in every
    // branch (validated active lab -> default lab -> first membership).
    const newLabId = resolveLegacyLabId(sqlite, req) ?? null;
    try {
      sqlite.prepare("UPDATE veritatrack_tasks SET lab_id = ? WHERE id = ?").run(newLabId, r.lastInsertRowid);
    } catch {}
    trackAudit({ labId: newLabId, taskId: Number(r.lastInsertRowid), event: "task_created", detail: `${name} (${frequency || "Monthly"})`, byUserId: req.user?.userId ?? null });
    res.json(sqlite.prepare("SELECT * FROM veritatrack_tasks WHERE id = ?").get(r.lastInsertRowid));
  });

  // PUT update task
  // 2026-06-09 Shape A class sweep: resolveRowForMutation accepts ownership
  // either via the task's user_id OR via active lab_members membership of
  // the task's lab_id. Previously a co-owner / lab admin / seeded-task user
  // got 404 on edit even though the list endpoint showed the row.
  app.put("/api/veritatrack/tasks/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritatrack'), (req: any, res) => {
    if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    const taskId = Number(req.params.id);
    const { row: existing, status } = resolveRowForMutation((db as any).$client, "veritatrack_tasks", taskId, req);
    if (!existing) {
      if (status === 403) return res.status(403).json({ error: "You don't have access to this task's lab" });
      return res.status(404).json({ error: "Task not found" });
    }
    const { name, category, instrument, owner, frequency, frequency_months, map_analyte, map_field, notes, active } = req.body;
    const freqMonths = frequency_months || frequencyToMonths(frequency || "Monthly");
    sqlite.prepare(
      "UPDATE veritatrack_tasks SET name=?,category=?,instrument=?,owner=?,frequency=?,frequency_months=?,map_analyte=?,map_field=?,notes=?,active=?,updated_at=datetime('now') WHERE id=?"
    ).run(name, category || "Other", instrument || null, owner || null, frequency || "Monthly", freqMonths, map_analyte || null, map_field || null, notes || null, active !== false ? 1 : 0, taskId);
    const wasDeactivated = (existing as any).active === 1 && active === false;
    trackAudit({
      labId: (existing as any).lab_id ?? null, taskId,
      event: wasDeactivated ? "task_deactivated" : "task_updated",
      detail: wasDeactivated ? `${name} deactivated` : `${name} (${frequency || "Monthly"})`,
      byUserId: req.user?.userId ?? null,
    });
    res.json(sqlite.prepare("SELECT * FROM veritatrack_tasks WHERE id = ?").get(taskId));
  });

  // DELETE (soft) task \u2014 Shape A guard via resolveRowForMutation.
  app.delete("/api/veritatrack/tasks/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritatrack'), (req: any, res) => {
    if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    const taskId = Number(req.params.id);
    const { row: existing, status } = resolveRowForMutation((db as any).$client, "veritatrack_tasks", taskId, req);
    if (!existing) {
      if (status === 403) return res.status(403).json({ error: "You don't have access to this task's lab" });
      return res.status(404).json({ error: "Task not found" });
    }
    sqlite.prepare("UPDATE veritatrack_tasks SET active=0 WHERE id=?").run(taskId);
    trackAudit({ labId: (existing as any).lab_id ?? null, taskId, event: "task_deactivated", detail: `${(existing as any).name} removed from active list`, byUserId: req.user?.userId ?? null });
    res.json({ ok: true });
  });

  // POST sign off a task \u2014 Shape A guard via resolveRowForMutation.
  app.post("/api/veritatrack/tasks/:id/signoff", authMiddleware, requireWriteAccess, requireModuleEdit('veritatrack'), (req: any, res) => {
    if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const taskId = Number(req.params.id);
    const { row: task, status } = resolveRowForMutation<any>((db as any).$client, "veritatrack_tasks", taskId, req);
    if (!task) {
      if (status === 403) return res.status(403).json({ error: "You don't have access to this task's lab" });
      return res.status(404).json({ error: "Task not found" });
    }
    const { completed_date, initials, performed_by, notes } = req.body;
    if (!completed_date) return res.status(400).json({ error: "completed_date required" });
    const r = sqlite.prepare(
      "INSERT INTO veritatrack_signoffs (task_id,user_id,completed_date,initials,performed_by,notes) VALUES (?,?,?,?,?,?)"
    ).run(task.id, userId, completed_date, initials || null, performed_by || null, notes || null);
    // write-path Shape A (resolver unification PR B): a signoff belongs to its
    // parent task's lab; fall back to the shared resolver if the task is
    // untagged (legacy rows).
    const signoffLabId = task.lab_id ?? resolveLegacyLabId(sqlite, req) ?? null;
    try {
      sqlite.prepare("UPDATE veritatrack_signoffs SET lab_id = ? WHERE id = ?").run(signoffLabId, r.lastInsertRowid);
    } catch {}
    trackAudit({
      labId: signoffLabId, taskId: task.id, signoffId: Number(r.lastInsertRowid),
      event: "signoff_recorded",
      detail: `Completed ${completed_date}${performed_by ? ` by ${performed_by}` : initials ? ` by ${initials}` : ""}`,
      byUserId: req.user?.userId ?? null,
    });
    // If linked to a VeritaMap field, update it there too.
    //
    // Shape A class sweep (2026-06-08): prior code picked ONE map per user
    // (LIMIT 1, ORDER BY updated_at DESC) which meant a multi-map lab's
    // signoff writeback landed on whichever map happened to be most recently
    // updated rather than every map whose test rows reference this analyte.
    // Now we walk every map in the owner's lab and UPDATE every matching row.
    // Compound Shape B fix on the same lines: lab-scope the map lookup via
    // users.lab_id with a fallback to user_id when lab_id is null (legacy).
    if (task.map_analyte && task.map_field) {
      try {
        const ownerLabRow = sqlite.prepare(
          "SELECT lab_id FROM users WHERE id = ?"
        ).get(userId) as { lab_id: number | null } | undefined;
        const ownerLabId = ownerLabRow?.lab_id ?? null;
        const maps = ownerLabId != null
          ? sqlite.prepare(
              "SELECT id FROM veritamap_maps WHERE lab_id = ?"
            ).all(ownerLabId) as Array<{ id: number }>
          : sqlite.prepare(
              "SELECT id FROM veritamap_maps WHERE user_id = ?"
            ).all(userId) as Array<{ id: number }>;
        if (maps.length > 0) {
          const allowed = ["last_cal_ver","last_method_comp","last_precision","last_sop_review"];
          if (allowed.includes(task.map_field)) {
            const placeholders = maps.map(() => "?").join(",");
            sqlite.prepare(
              `UPDATE veritamap_tests SET ${task.map_field} = ?, updated_at = datetime('now') WHERE map_id IN (${placeholders}) AND analyte = ?`
            ).run(completed_date, ...maps.map(m => m.id), task.map_analyte);
          }
        }
      } catch {}
    }
    res.json(sqlite.prepare("SELECT * FROM veritatrack_signoffs WHERE id = ?").get(r.lastInsertRowid));
  });

  // DELETE a sign-off \u2014 Shape A guard via resolveRowForMutation.
  app.delete("/api/veritatrack/signoffs/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritatrack'), (req: any, res) => {
    if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    const signoffId = Number(req.params.id);
    const { row: existing, status } = resolveRowForMutation((db as any).$client, "veritatrack_signoffs", signoffId, req);
    if (!existing) {
      if (status === 403) return res.status(403).json({ error: "You don't have access to this signoff's lab" });
      return res.status(404).json({ error: "Signoff not found" });
    }
    sqlite.prepare("DELETE FROM veritatrack_signoffs WHERE id = ?").run(signoffId);
    // Wave B3: a deleted completion record is the highest-risk audit event.
    // Capture it (with the date it claimed) BEFORE the row is gone -- already
    // read into `existing` by resolveRowForMutation above.
    trackAudit({
      labId: (existing as any).lab_id ?? null,
      taskId: (existing as any).task_id ?? null,
      signoffId,
      event: "signoff_deleted",
      detail: `Removed sign-off dated ${(existing as any).completed_date}${(existing as any).performed_by ? ` (${(existing as any).performed_by})` : ""}`,
      byUserId: req.user?.userId ?? null,
    });
    res.json({ ok: true });
  });

  // GET audit trail for a task (Wave B3). Lab-scoped read: resolves the task
  // through the same ownership guard the mutations use, then returns the
  // append-only event log newest-first.
  app.get("/api/veritatrack/tasks/:id/audit", authMiddleware, (req: any, res) => {
    if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack™ subscription required" });
    const { row: task, status } = resolveRowForMutation<any>((db as any).$client, "veritatrack_tasks", Number(req.params.id), req);
    if (!task) {
      if (status === 403) return res.status(403).json({ error: "You don't have access to this task's lab" });
      return res.status(404).json({ error: "Task not found" });
    }
    const rows = sqlite.prepare(
      "SELECT a.id, a.event, a.detail, a.at, a.signoff_id, u.name AS by_name FROM veritatrack_audit a LEFT JOIN users u ON u.id = a.by_user_id WHERE a.task_id = ? ORDER BY a.at DESC, a.id DESC"
    ).all(task.id);
    res.json(rows);
  });

  // POST import tasks from VeritaMap
  //
  // Shape A class sweep (2026-06-08): walks EVERY map in the owner's lab,
  // not just the most-recently-updated one. Prior code used LIMIT 1 ORDER BY
  // updated_at DESC, which meant a multi-map lab (Lisa's Milford per-dept
  // layout, San Carlos CW Bylas + SCAHC) only got tasks for one map's
  // analytes and silently dropped the rest. Compound Shape B fix on the same
  // edit: lab-scope the map lookup via users.lab_id with a fallback to
  // user_id when lab_id is null (legacy account before Phase 1 backfill).
  //
  // Per-analyte dedupe is keyed on the task name (`${label} - ${analyte}`),
  // so an analyte that lives in two maps (Glucose on CW Bylas AND on SCAHC)
  // only produces one task per field-definition.
  app.post("/api/veritatrack/import-from-map", authMiddleware, requireWriteAccess, requireModuleEdit('veritatrack'), (req: any, res) => {
    if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    // Multi-lab fix: read the maps of the ACTIVE lab (X-Active-Lab-Id), not the
    // owner's home users.lab_id. A multi-lab owner viewing Lab B used to import
    // Lab A's analytes. Falls back to user_id only when no lab resolves (legacy).
    const labId = resolveLegacyLabId(sqlite, req);
    const maps = labId != null
      ? sqlite.prepare(
          "SELECT id, name FROM veritamap_maps WHERE lab_id = ? ORDER BY updated_at DESC"
        ).all(labId) as Array<{ id: number; name: string }>
      : sqlite.prepare(
          "SELECT id, name FROM veritamap_maps WHERE user_id = ? ORDER BY updated_at DESC"
        ).all(userId) as Array<{ id: number; name: string }>;
    if (maps.length === 0) return res.status(404).json({ error: "No VeritaMap\u2122 found. Build your test menu first." });
    const mapIdPlaceholders = maps.map(() => "?").join(",");
    const allTests = sqlite.prepare(
      `SELECT * FROM veritamap_tests WHERE map_id IN (${mapIdPlaceholders}) AND active = 1 ORDER BY analyte`
    ).all(...maps.map(m => m.id)) as any[];
    // Dedupe across maps on lowercase analyte. Keep the most recent
    // last_cal_ver / last_method_comp / last_precision / last_sop_review
    // values across all the analyte's appearances so the seeded sign-off is
    // the latest the lab has on record.
    const dedupedByAnalyte = new Map<string, any>();
    for (const row of allTests) {
      const key = String(row.analyte || "").trim().toLowerCase();
      if (!key) continue;
      const prior = dedupedByAnalyte.get(key);
      if (!prior) { dedupedByAnalyte.set(key, { ...row }); continue; }
      // Field-by-field: keep the later date when both are populated.
      const dateFields = ["last_cal_ver", "last_method_comp", "last_precision", "last_sop_review"];
      const merged = { ...prior };
      for (const f of dateFields) {
        if (row[f] && (!prior[f] || String(row[f]) > String(prior[f]))) merged[f] = row[f];
      }
      // If prior is WAIVED but row is not, prefer the non-WAIVED so the task
      // gets created (waived analytes skip task creation below).
      if (prior.complexity === "WAIVED" && row.complexity !== "WAIVED") {
        merged.complexity = row.complexity;
        merged.instrument_source = row.instrument_source || prior.instrument_source;
      }
      dedupedByAnalyte.set(key, merged);
    }
    const tests = Array.from(dedupedByAnalyte.values());
    const now = new Date().toISOString();
    let created = 0; let skipped = 0;
    const fieldDefs = [
      { field: "last_cal_ver",     label: "Calibration Verification", category: "Calibration Verification", frequency: "Biannual", months: 6 },
      { field: "last_method_comp", label: "Correlation / Method Comparison", category: "Correlation",           frequency: "Biannual", months: 6 },
      { field: "last_precision",   label: "Precision Verification",   category: "Calibration Verification", frequency: "Biannual", months: 6 },
      { field: "last_sop_review",  label: "SOP Review",               category: "Policy Review",            frequency: "Biennial", months: 24 },
    ];
    for (const test of tests) {
      if (test.complexity === "WAIVED") continue;
      for (const fd of fieldDefs) {
        const taskName = `${fd.label} - ${test.analyte}`;
        const existing = sqlite.prepare(
          "SELECT id FROM veritatrack_tasks WHERE lab_id=? AND name=? AND active=1"
        ).get(labId, taskName);
        if (existing) { skipped++; continue; }
        sqlite.prepare(
          "INSERT INTO veritatrack_tasks (user_id,lab_id,name,category,instrument,frequency,frequency_months,map_analyte,map_field,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
        ).run(userId, labId, taskName, fd.category, test.instrument_source || null, fd.frequency, fd.months, test.analyte, fd.field, now, now);
        // Seed initial sign-off from existing map date if present
        if (test[fd.field]) {
          const newTask = sqlite.prepare(
            "SELECT id FROM veritatrack_tasks WHERE lab_id=? AND name=? ORDER BY id DESC LIMIT 1"
          ).get(labId, taskName) as any;
          if (newTask) {
            sqlite.prepare(
              "INSERT INTO veritatrack_signoffs (task_id,user_id,completed_date,notes) VALUES (?,?,?,?)"
            ).run(newTask.id, userId, test[fd.field], "Imported from VeritaMap\u2122");
          }
        }
        created++;
      }
    }
    res.json({ ok: true, created, skipped, total: tests.length, mapsScanned: maps.length });
  });

  // GET dashboard summary
  app.get("/api/veritatrack/dashboard", authMiddleware, (req: any, res) => {
    if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    // #9 multi-lab fix (2026-07-11): scope the legacy dashboard by lab_id via
    // resolveLegacyLabId (the same guard the /tasks list read uses), not by
    // user_id, so a multi-lab owner's summary counts match the visible list
    // instead of aggregating tasks across every lab they own.
    const labId = resolveLegacyLabId(sqlite, req);
    const tasks = sqlite.prepare(
      "SELECT * FROM veritatrack_tasks WHERE lab_id = ? AND active = 1"
    ).all(labId) as any[];
    const now = new Date();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const thirtyDays = new Date(now.getTime() + 30 * 86400000);
    let overdue = 0, dueThisMonth = 0, dueSoon = 0, current = 0, notStarted = 0;
    const overdueItems: any[] = [], dueThisMonthItems: any[] = [], dueSoonItems: any[] = [];
    for (const t of tasks) {
      const last = sqlite.prepare(
        "SELECT completed_date FROM veritatrack_signoffs WHERE task_id = ? ORDER BY completed_date DESC LIMIT 1"
      ).get(t.id) as any;
      if (!last) { notStarted++; continue; }
      const nextDueDate = nextDue(last.completed_date, t.frequency_months);
      const due = new Date(nextDueDate);
      const daysUntil = daysUntilDateOnly(nextDueDate);
      if (daysUntil < 0) { overdue++; overdueItems.push({ ...t, next_due: nextDueDate, days_overdue: -daysUntil }); }
      else if (due <= monthEnd) { dueThisMonth++; dueThisMonthItems.push({ ...t, next_due: nextDueDate, days_until: daysUntil }); }
      else if (due <= thirtyDays) { dueSoon++; dueSoonItems.push({ ...t, next_due: nextDueDate, days_until: daysUntil }); }
      else { current++; }
    }
    res.json({ overdue, dueThisMonth, dueSoon, current, notStarted, total: tasks.length, overdueItems, dueThisMonthItems, dueSoonItems });
  });

  // POST seed default tasks (idempotent)
  app.post("/api/veritatrack/seed-defaults", authMiddleware, requireWriteAccess, requireModuleEdit('veritatrack'), (req: any, res) => {
    if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    // Multi-lab fix: seed into the ACTIVE lab (X-Active-Lab-Id). Was user_id
    // only, so seeded tasks got lab_id=NULL and never appeared in the lab's
    // scoped list/dashboard on a multi-lab account.
    const labId = resolveLegacyLabId(sqlite, req);
    const { categories } = req.body as { categories: string[] };
    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ error: "categories array required" });
    }

    // Default task definitions keyed by toggle id
    const DEFAULT_TASKS: Record<string, Array<{ name: string; category: string; frequency: string; months: number }>> = {
      qc_review: [
        { name: "QC Review - Chemistry",    category: "QC Review", frequency: "Monthly", months: 1 },
        { name: "QC Review - Hematology",   category: "QC Review", frequency: "Monthly", months: 1 },
        { name: "QC Review - Urinalysis",   category: "QC Review", frequency: "Monthly", months: 1 },
      ],
      pt_review: [
        { name: "Proficiency Testing Review - Chemistry",    category: "Quality Assessment", frequency: "Quarterly", months: 3 },
        { name: "Proficiency Testing Review - Hematology",   category: "Quality Assessment", frequency: "Quarterly", months: 3 },
        { name: "Proficiency Testing Review - Microbiology", category: "Quality Assessment", frequency: "Quarterly", months: 3 },
      ],
      hipaa_training: [
        { name: "HIPAA Training - Annual Review", category: "HIPAA", frequency: "Annual", months: 12 },
      ],
      bbp_training: [
        { name: "Bloodborne Pathogen Training - Annual", category: "Bloodborne Pathogen", frequency: "Annual", months: 12 },
      ],
      pipette_cal: [
        { name: "Pipette Calibration", category: "Equipment Calibration", frequency: "Annual", months: 12 },
      ],
      therm_cal: [
        { name: "Thermometer Calibration", category: "Equipment Calibration", frequency: "Annual", months: 12 },
      ],
      centrifuge_rpm: [
        { name: "Centrifuge RPM Verification", category: "Equipment Calibration", frequency: "Annual", months: 12 },
      ],
      timer_verify: [
        { name: "Timer Verification", category: "Equipment Calibration", frequency: "Annual", months: 12 },
      ],
      blood_bank_alarms: [
        { name: "Blood Bank Alarm Check - Refrigerator",  category: "Blood Bank Alarm Checks", frequency: "Quarterly", months: 3 },
        { name: "Blood Bank Alarm Check - Freezer",       category: "Blood Bank Alarm Checks", frequency: "Quarterly", months: 3 },
        { name: "Blood Bank Alarm Check - Platelet Incubator", category: "Blood Bank Alarm Checks", frequency: "Quarterly", months: 3 },
      ],
      water_testing: [
        { name: "Water Contamination Testing", category: "Water Contamination", frequency: "Monthly", months: 1 },
      ],
    };

    const now = new Date().toISOString();
    let created = 0;
    let skipped = 0;

    for (const cat of categories) {
      const tasks = DEFAULT_TASKS[cat];
      if (!tasks) continue;
      for (const t of tasks) {
        const existing = sqlite.prepare(
          "SELECT id FROM veritatrack_tasks WHERE lab_id=? AND name=? AND active=1"
        ).get(labId, t.name);
        if (existing) { skipped++; continue; }
        sqlite.prepare(
          "INSERT INTO veritatrack_tasks (user_id,lab_id,name,category,frequency,frequency_months,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)"
        ).run(userId, labId, t.name, t.category, t.frequency, t.months, now, now);
        created++;
      }
    }

    res.json({ ok: true, created, skipped });
  });

  // POST Excel export
  app.post("/api/veritatrack/export/excel", authMiddleware, async (req: any, res) => {
    if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    // Multi-lab fix: export the ACTIVE lab's tasks (X-Active-Lab-Id), not every
    // task under user_id across all labs. A surveyor-facing export must never
    // mix labs together.
    const labId = resolveLegacyLabId(sqlite, req);
    const tasks = sqlite.prepare(
      "SELECT * FROM veritatrack_tasks WHERE lab_id = ? AND active = 1 ORDER BY category, name"
    ).all(labId) as any[];

    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.creator = "Perplexity Computer";
    wb.created = new Date();

    // ===== Lab identity (Excel Export Standard) =====
    // Prefer the ACTIVE lab's own identity; fall back to the lab owner's user
    // record, then to the requesting user, so a multi-lab export is stamped
    // with the lab it actually covers.
    const labRow = sqlite.prepare(
      "SELECT lab_name, clia_number, owner_user_id FROM labs WHERE id = ?"
    ).get(labId) as any;
    const ownerRow = sqlite.prepare(
      "SELECT clia_lab_name, clia_number, name FROM users WHERE id = ?"
    ).get(labRow?.owner_user_id ?? userId) as any;
    const labName = labRow?.lab_name || ownerRow?.clia_lab_name || ownerRow?.name || "Laboratory";
    const cliaNumber = labRow?.clia_number || ownerRow?.clia_number || "Not on file";
    const exportPwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";

    // ===== About sheet (sheet 1) =====
    const aboutBorder: any = {
      top: { style: "thin", color: { argb: "FFD0D0D0" } },
      bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
      left: { style: "thin", color: { argb: "FFD0D0D0" } },
      right: { style: "thin", color: { argb: "FFD0D0D0" } },
    };
    const about = wb.addWorksheet("About");
    about.getColumn(1).width = 110;
    const aboutTitle = about.getCell("A1");
    aboutTitle.value = "VeritaTrack Regulatory Calendar";
    aboutTitle.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    aboutTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
    aboutTitle.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    about.getRow(1).height = 30;
    const aboutIdentity = about.getCell("A2");
    aboutIdentity.value = `Prepared for: ${labName}    CLIA: ${cliaNumber}`;
    aboutIdentity.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF0A3A3D" } };
    aboutIdentity.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
    aboutIdentity.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    aboutIdentity.border = aboutBorder;
    about.getRow(2).height = 24;
    let aboutRow = 3;
    const aboutSection = (text: string) => {
      const c = about.getCell(`A${aboutRow}`);
      c.value = text;
      c.font = { name: "Calibri", bold: true, size: 12, color: { argb: "FF0A3A3D" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
      c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
      c.border = aboutBorder;
      about.getRow(aboutRow).height = 22; aboutRow += 1;
    };
    const aboutBody = (text: string) => {
      const c = about.getCell(`A${aboutRow}`);
      c.value = text;
      c.font = { name: "Calibri", size: 11, color: { argb: "FF28251D" } };
      c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
      c.border = aboutBorder;
      const estLines = Math.max(1, Math.floor(text.length / 100) + 1);
      about.getRow(aboutRow).height = Math.max(20, estLines * 16); aboutRow += 1;
    };
    const aboutBlank = () => { about.getRow(aboutRow).height = 8; aboutRow += 1; };
    aboutSection("About this product");
    aboutBody("This workbook is a snapshot of the laboratory's recurring regulatory and quality tasks tracked in VeritaTrack: daily, weekly, monthly, quarterly, semiannual, and annual checks tied to CLIA, CAP, TJC, AABB, FDA, OSHA, and state requirements. Each row shows what the task is, which instrument or category it covers, the last documented sign-off, when it is next due, and a status flag (Current / Due Soon / Overdue / Not Started) computed from the frequency and the most recent sign-off date.");
    aboutBlank();
    aboutSection("How to use this workbook");
    aboutBody("The Regulatory Calendar tab is grouped by Frequency (Daily, Weekly, Monthly, Quarterly, Semiannual, Annual) and then by Category. Sort or filter the Status column to triage what needs immediate attention: Overdue first, then Due Soon (within 14 days). The Days Until Due column shows the gap between today and the next due date and turns magenta when overdue. The Performed By column captures the initials or full name recorded at the time of the last sign-off; this is the audit trail for who attests the task was done. Notes carry instrument-specific or procedure-specific reminders set by the lab.");
    aboutBlank();
    aboutSection("Disclaimer");
    aboutBody("This workbook is an internal tracking aid, not an audit-grade compliance attestation, not a regulatory submission, and not a substitute for the lab's procedure manual or the underlying signed records. Status (Current / Due Soon / Overdue / Not Started) is calculated mechanically from the frequency_months value and the most recent completed_date in VeritaTrack. It does not confirm that the work was actually performed competently, that the recorded initials belong to the named person, or that the procedure followed the lab's SOP. The signed sign-off record (paper logs, instrument printouts, LIS records, validation files) is the audit-grade evidence; if there is a conflict between this calendar and those records, the underlying records govern. Due dates assume the frequency value is correct and that no regulatory or accreditation change has shortened the interval; the lab director is responsible for keeping intervals current with the latest CMS, CAP, TJC, AABB, FDA, OSHA, and state guidance. VeritaAssure does not certify regulatory compliance, does not advise on whether a given task satisfies a specific accreditation standard, does not file or report on the lab's behalf, and does not warrant that completing every row in this workbook will satisfy any inspector.");
    aboutBlank();
    aboutSection("Lab identity");
    aboutBody(`This workbook was prepared for ${labName} (CLIA ${cliaNumber}). The lab name and CLIA appear on every printed page header and footer.`);
    aboutBlank();
    aboutSection("Coverage gaps");
    aboutBody("If your laboratory needs a task category, frequency band, or column not represented here, for example multi-shift sign-off tracking, separate competency vs maintenance lanes, or per-method QC linkage, please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision.");
    about.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaTrack Regulatory Calendar&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
    about.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
    await about.protect(exportPwd, {
      selectLockedCells: false, selectUnlockedCells: false,
      formatCells: false, formatColumns: false, formatRows: false,
      insertRows: false, insertColumns: false, insertHyperlinks: false,
      deleteRows: false, deleteColumns: false,
      sort: false, autoFilter: false, pivotTables: false,
    });

    const ws = wb.addWorksheet("Regulatory Calendar");

    const headers = ["Frequency","Category","Task","Instrument / Serial","Owner","Last Performed","Performed By","Due Next","Days Until Due","Status","Notes"];
    const colWidths = [14, 28, 44, 24, 16, 16, 20, 16, 14, 14, 30];
    ws.columns = headers.map((h, i) => ({ header: h, key: `c${i}`, width: colWidths[i] ?? 12 }));

    const thinBorder: any = { top:{style:"thin",color:{argb:"FFD0D0D0"}}, bottom:{style:"thin",color:{argb:"FFD0D0D0"}}, left:{style:"thin",color:{argb:"FFD0D0D0"}}, right:{style:"thin",color:{argb:"FFD0D0D0"}} };

    const headerRow = ws.getRow(1);
    headerRow.height = 20;
    headerRow.eachCell(cell => {
      cell.font = { name:"Calibri", bold:true, color:{argb:"FFFFFFFF"}, size:11 };
      cell.fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FF01696F"} };
      cell.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
      cell.border = thinBorder;
    });

    const now = new Date();
    let rowIdx = 2;
    let lastFreq = "";
    for (const t of tasks) {
      const last = sqlite.prepare(
        "SELECT * FROM veritatrack_signoffs WHERE task_id = ? ORDER BY completed_date DESC LIMIT 1"
      ).get(t.id) as any;
      const nextDueDate = last ? nextDue(last.completed_date, t.frequency_months) : null;
      const status = last ? taskStatus(nextDueDate!) : "not_started";
      const daysUntil = nextDueDate
        ? Math.floor((new Date(nextDueDate).getTime() - now.getTime()) / 86400000)
        : null;
      const daysLabel = daysUntil === null ? "" : daysUntil < 0 ? `${-daysUntil}d overdue` : daysUntil === 0 ? "Due today" : `${daysUntil}d`;
      const statusLabel = status === "overdue" ? "Overdue" : status === "due_soon" ? "Due Soon" : status === "current" ? "Current" : "Not Started";

      const row = ws.addRow([
        t.frequency !== lastFreq ? t.frequency : "",
        t.category,
        t.name,
        t.instrument || "",
        t.owner || "",
        last ? last.completed_date : "",
        last ? (last.performed_by || last.initials || "") : "",
        nextDueDate || "",
        daysLabel,
        statusLabel,
        t.notes || "",
      ]);
      lastFreq = t.frequency;

      const isEven = rowIdx % 2 === 0;
      row.height = 18;
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.font = { name:"Calibri", size:10, color:{argb:"FF28251D"} };
        cell.alignment = { vertical:"middle", wrapText: false };
        cell.fill = { type:"pattern", pattern:"solid", fgColor:{argb: isEven ? "FFEBF3F8" : "FFFFFFFF"} };
        cell.border = thinBorder;
        // Status column (col 10) color coding
        if (colNum === 10) {
          const val = String(cell.value || "");
          if (val === "Overdue")  cell.font = { name:"Calibri", bold:true, size:10, color:{argb:"FFA12C7B"} };
          else if (val === "Due Soon") cell.font = { name:"Calibri", bold:true, size:10, color:{argb:"FF964219"} };
          else if (val === "Current")  cell.font = { name:"Calibri", bold:true, size:10, color:{argb:"FF437A22"} };
          else cell.font = { name:"Calibri", size:10, color:{argb:"FF7A7974"} };
        }
        // Days until (col 9) -- red if overdue
        if (colNum === 9 && String(cell.value || "").includes("overdue")) {
          cell.font = { name:"Calibri", bold:true, size:10, color:{argb:"FFA12C7B"} };
        }
      });
      rowIdx++;
    }

    ws.views = [{ state:"frozen" as const, xSplit:3, ySplit:1, topLeftCell:"D2" }];
    ws.autoFilter = { from:"A1", to: ws.getCell(1, headers.length).address };

    // Page-setup header/footer carry lab identity on every printed page.
    ws.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaTrack Regulatory Calendar&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
    ws.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;

    await ws.protect(exportPwd, {
      selectLockedCells: true, selectUnlockedCells: true,
      formatCells: false, formatColumns: false, formatRows: false,
      insertRows: false, insertColumns: false, insertHyperlinks: false,
      deleteRows: false, deleteColumns: false,
      sort: false, autoFilter: true, pivotTables: false,
    });

    // Workbook opens to the About sheet (sheet 1, activeTab 0).
    wb.views = [{ x: 0, y: 0, width: 10000, height: 20000,
                  firstSheet: 0, activeTab: 0, visibility: "visible" }];

    applyLicenseToExcelJS(wb, trackLicenseCtx(req));
    const buf = await wb.xlsx.writeBuffer();
    const filename = `VeritaTrack_${new Date().getFullYear()}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  });

  // ── MULTI-LAB Tier 2 — Phase 3.7b: lab-scoped VeritaTrack entry endpoints ──
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (labScopeMiddleware) {
    app.get("/api/labs/:labId/veritatrack/tasks", authMiddleware, labScopeMiddleware, (req: any, res) => {
      if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack™ subscription required" });
      const tasks = sqlite.prepare(
        "SELECT * FROM veritatrack_tasks WHERE lab_id = ? AND active = 1 ORDER BY category, name"
      ).all(req.scope.labId) as any[];
      const result = tasks.map((t: any) => {
        const last = sqlite.prepare(
          "SELECT * FROM veritatrack_signoffs WHERE task_id = ? ORDER BY completed_date DESC LIMIT 1"
        ).get(t.id) as any;
        const nextDueDate = last ? nextDue(last.completed_date, t.frequency_months) : null;
        const status = last ? taskStatus(nextDueDate!) : "not_started";
        return { ...t, last_signoff: last || null, next_due: nextDueDate, status };
      });
      res.json(result);
    });

    app.post("/api/labs/:labId/veritatrack/tasks", authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit('veritatrack'), (req: any, res) => {
      if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack™ subscription required" });
      const { name, category, instrument, owner, frequency, frequency_months, map_analyte, map_field, notes } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ error: "name required" });
      const freqMonths = Number(frequency_months || 1);
      const now = new Date().toISOString();
      const ownerRow = sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(req.scope.labId) as any;
      const userIdForRow = ownerRow?.owner_user_id ?? req.userId;
      const r = sqlite.prepare(
        "INSERT INTO veritatrack_tasks (user_id,lab_id,name,category,instrument,owner,frequency,frequency_months,map_analyte,map_field,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
      ).run(userIdForRow, req.scope.labId, name, category || "Other", instrument || null, owner || null, frequency || "Monthly", freqMonths, map_analyte || null, map_field || null, notes || null, now, now);
      trackAudit({ labId: req.scope.labId, taskId: Number(r.lastInsertRowid), event: "task_created", detail: `${name} (${frequency || "Monthly"})`, byUserId: req.user?.userId ?? null });
      res.json(sqlite.prepare("SELECT * FROM veritatrack_tasks WHERE id = ?").get(r.lastInsertRowid));
    });

    app.get("/api/labs/:labId/veritatrack/dashboard", authMiddleware, labScopeMiddleware, (req: any, res) => {
      if (!hasTrackAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaTrack™ subscription required" });
      const tasks = sqlite.prepare(
        "SELECT * FROM veritatrack_tasks WHERE lab_id = ? AND active = 1"
      ).all(req.scope.labId) as any[];
      // #5 shape fix (2026-07-11): return the SAME camelCase shape as the legacy
      // dashboard (dueThisMonth/dueSoon + *Items) so the client's Due This Month
      // and Due Soon cards are not blank on the multi-lab path (they previously
      // read dashboard.dueThisMonth / dashboard.dueSoon against a snake_case,
      // dueThisMonth-less response).
      const now = new Date();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const thirtyDays = new Date(now.getTime() + 30 * 86400000);
      let overdue = 0, dueThisMonth = 0, dueSoon = 0, current = 0, notStarted = 0;
      const overdueItems: any[] = [], dueThisMonthItems: any[] = [], dueSoonItems: any[] = [];
      for (const t of tasks) {
        const last = sqlite.prepare(
          "SELECT completed_date FROM veritatrack_signoffs WHERE task_id = ? ORDER BY completed_date DESC LIMIT 1"
        ).get(t.id) as any;
        if (!last) { notStarted++; continue; }
        const nextDueDate = nextDue(last.completed_date, t.frequency_months);
        const due = new Date(nextDueDate);
        const daysUntil = daysUntilDateOnly(nextDueDate);
        if (daysUntil < 0) { overdue++; overdueItems.push({ ...t, next_due: nextDueDate, days_overdue: -daysUntil }); }
        else if (due <= monthEnd) { dueThisMonth++; dueThisMonthItems.push({ ...t, next_due: nextDueDate, days_until: daysUntil }); }
        else if (due <= thirtyDays) { dueSoon++; dueSoonItems.push({ ...t, next_due: nextDueDate, days_until: daysUntil }); }
        else { current++; }
      }
      res.json({ overdue, dueThisMonth, dueSoon, current, notStarted, total: tasks.length, overdueItems, dueThisMonthItems, dueSoonItems });
    });
  }
}
