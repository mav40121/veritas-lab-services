// server/schedule.ts
//
// VeritaShift Scheduler (Phase 1): lab-native 24/7 shift-coverage grid.
// Competency-specific scheduling is OFF in this phase, so assignments are
// shift-level (department nullable) and the only gap surfaced is
// under-coverage: a shift below its min_staff on a given date. Bench-level
// competency coverage lands later behind a per-lab toggle.
//
// Lab-scoped by the main labs.id (labScopeMiddleware -> req.scope.labId),
// ops-gated like the rest of the VeritaBench/Shift family. The staff pool
// resolves owner_user_id -> staff_labs -> staff_employees, the same mapping
// the VeritaStaff endpoints use (staff_employees.lab_id is the staff_labs.id,
// not the labs.id).

import type { Express } from "express";
import { db } from "./db";

const SUITE_PLANS = ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "clinic", "community", "hospital", "large_hospital", "enterprise"];
function hasOpsAccess(user: any, lab?: any): boolean {
  const plan = lab?.plan ?? user?.plan;
  return SUITE_PLANS.includes(plan);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

export interface ShiftDef { id: number; name: string; min_staff: number; }
export interface Assignment { shift_def_id: number; work_date: string; }
export interface CoverageGap { date: string; shift_def_id: number; shift_name: string; assigned: number; required: number; }

// Pure coverage-gap computation (unit-tested by scripts/verify-schedule-coverage.ts).
// For each date in [startDate, endDate] and each shift, a gap exists when the
// number of assignments is below the shift's min_staff.
export function computeCoverageGaps(
  shiftDefs: ShiftDef[],
  assignments: Assignment[],
  startDate: string,
  endDate: string,
): CoverageGap[] {
  const dates: string[] = [];
  const cur = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  let guard = 0;
  while (cur.getTime() <= end.getTime() && guard < 3660) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard += 1;
  }
  const counts = new Map<string, number>();
  for (const a of assignments) {
    const k = a.work_date + "|" + a.shift_def_id;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const gaps: CoverageGap[] = [];
  for (const date of dates) {
    for (const s of shiftDefs) {
      const assigned = counts.get(date + "|" + s.id) || 0;
      if (assigned < s.min_staff) {
        gaps.push({ date, shift_def_id: s.id, shift_name: s.name, assigned, required: s.min_staff });
      }
    }
  }
  return gaps;
}

export function registerScheduleRoutes(
  app: Express,
  authMiddleware: any,
  labScopeMiddleware: any,
  requireWriteAccess: any,
) {
  const sqlite = (db as any).$client;
  const ops = (req: any, res: any): boolean => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) {
      res.status(403).json({ error: "VeritaShift™ requires a suite subscription" });
      return false;
    }
    return true;
  };

  // ── Shift definitions ──────────────────────────────────────────────────
  app.get("/api/labs/:labId/schedule/shifts", authMiddleware, labScopeMiddleware, (req: any, res) => {
    if (!ops(req, res)) return;
    const rows = sqlite.prepare(
      "SELECT id, name, start_time, end_time, min_staff, sort_order, active FROM schedule_shift_defs WHERE lab_id = ? AND active = 1 ORDER BY sort_order ASC, id ASC"
    ).all(req.scope.labId);
    res.json(rows);
  });

  app.post("/api/labs/:labId/schedule/shifts", authMiddleware, labScopeMiddleware, requireWriteAccess, (req: any, res) => {
    if (!ops(req, res)) return;
    const { name, start_time, end_time, min_staff, sort_order } = req.body || {};
    if (!name || typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "name required" });
    if (!HHMM.test(String(start_time)) || !HHMM.test(String(end_time))) return res.status(400).json({ error: "start_time and end_time must be HH:MM" });
    const min = Math.max(1, Math.min(99, parseInt(String(min_staff ?? 1), 10) || 1));
    const sort = Math.max(0, parseInt(String(sort_order ?? 0), 10) || 0);
    const now = new Date().toISOString();
    const info = sqlite.prepare(
      "INSERT INTO schedule_shift_defs (lab_id, name, start_time, end_time, min_staff, sort_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)"
    ).run(req.scope.labId, name.trim().slice(0, 60), start_time, end_time, min, sort, now, now);
    res.json({ ok: true, id: info.lastInsertRowid });
  });

  app.patch("/api/labs/:labId/schedule/shifts/:id", authMiddleware, labScopeMiddleware, requireWriteAccess, (req: any, res) => {
    if (!ops(req, res)) return;
    const row = sqlite.prepare("SELECT id FROM schedule_shift_defs WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId);
    if (!row) return res.status(404).json({ error: "Shift not found" });
    const b = req.body || {};
    const fields: string[] = []; const vals: any[] = [];
    if (typeof b.name === "string" && b.name.trim()) { fields.push("name = ?"); vals.push(b.name.trim().slice(0, 60)); }
    if (b.start_time !== undefined) { if (!HHMM.test(String(b.start_time))) return res.status(400).json({ error: "start_time must be HH:MM" }); fields.push("start_time = ?"); vals.push(b.start_time); }
    if (b.end_time !== undefined) { if (!HHMM.test(String(b.end_time))) return res.status(400).json({ error: "end_time must be HH:MM" }); fields.push("end_time = ?"); vals.push(b.end_time); }
    if (b.min_staff !== undefined) { fields.push("min_staff = ?"); vals.push(Math.max(1, Math.min(99, parseInt(String(b.min_staff), 10) || 1))); }
    if (b.sort_order !== undefined) { fields.push("sort_order = ?"); vals.push(Math.max(0, parseInt(String(b.sort_order), 10) || 0)); }
    if (!fields.length) return res.status(400).json({ error: "no fields to update" });
    fields.push("updated_at = ?"); vals.push(new Date().toISOString());
    vals.push(Number(req.params.id), req.scope.labId);
    sqlite.prepare(`UPDATE schedule_shift_defs SET ${fields.join(", ")} WHERE id = ? AND lab_id = ?`).run(...vals);
    res.json({ ok: true });
  });

  app.delete("/api/labs/:labId/schedule/shifts/:id", authMiddleware, labScopeMiddleware, requireWriteAccess, (req: any, res) => {
    if (!ops(req, res)) return;
    // Soft-delete: deactivate so past assignments still resolve the shift name.
    const info = sqlite.prepare(
      "UPDATE schedule_shift_defs SET active = 0, updated_at = ? WHERE id = ? AND lab_id = ?"
    ).run(new Date().toISOString(), Number(req.params.id), req.scope.labId);
    res.json({ ok: true, deactivated: info.changes });
  });

  // ── Staff pool (owner -> staff_labs -> staff_employees) ────────────────
  app.get("/api/labs/:labId/schedule/staff", authMiddleware, labScopeMiddleware, (req: any, res) => {
    if (!ops(req, res)) return;
    const ownerRow = sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(req.scope.labId) as any;
    if (!ownerRow) return res.json([]);
    const staffLab = sqlite.prepare("SELECT id FROM staff_labs WHERE user_id = ?").get(ownerRow.owner_user_id) as any;
    if (!staffLab) return res.json([]);
    const rows = sqlite.prepare(
      "SELECT id, first_name, last_name, title FROM staff_employees WHERE lab_id = ? AND status = 'active' ORDER BY last_name ASC, first_name ASC"
    ).all(staffLab.id) as any[];
    res.json(rows.map((r) => ({ id: r.id, name: `${r.first_name || ""} ${r.last_name || ""}`.trim(), title: r.title || null })));
  });

  // ── Schedule periods ───────────────────────────────────────────────────
  app.get("/api/labs/:labId/schedule/periods", authMiddleware, labScopeMiddleware, (req: any, res) => {
    if (!ops(req, res)) return;
    const rows = sqlite.prepare(
      "SELECT id, start_date, end_date, status, published_at, created_at FROM schedule_periods WHERE lab_id = ? ORDER BY start_date DESC, id DESC"
    ).all(req.scope.labId);
    res.json(rows);
  });

  app.post("/api/labs/:labId/schedule/periods", authMiddleware, labScopeMiddleware, requireWriteAccess, (req: any, res) => {
    if (!ops(req, res)) return;
    const { start_date, end_date } = req.body || {};
    if (!YMD.test(String(start_date)) || !YMD.test(String(end_date))) return res.status(400).json({ error: "start_date and end_date must be YYYY-MM-DD" });
    if (String(end_date) < String(start_date)) return res.status(400).json({ error: "end_date must be on or after start_date" });
    const now = new Date().toISOString();
    const info = sqlite.prepare(
      "INSERT INTO schedule_periods (lab_id, start_date, end_date, status, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?)"
    ).run(req.scope.labId, start_date, end_date, now, now);
    res.json({ ok: true, id: info.lastInsertRowid });
  });

  app.post("/api/labs/:labId/schedule/periods/:id/publish", authMiddleware, labScopeMiddleware, requireWriteAccess, (req: any, res) => {
    if (!ops(req, res)) return;
    const now = new Date().toISOString();
    const info = sqlite.prepare(
      "UPDATE schedule_periods SET status = 'published', published_at = ?, updated_at = ? WHERE id = ? AND lab_id = ?"
    ).run(now, now, Number(req.params.id), req.scope.labId);
    if (!info.changes) return res.status(404).json({ error: "Period not found" });
    res.json({ ok: true });
  });

  // Full period detail: shifts + assignments + computed coverage gaps.
  app.get("/api/labs/:labId/schedule/periods/:id", authMiddleware, labScopeMiddleware, (req: any, res) => {
    if (!ops(req, res)) return;
    const period = sqlite.prepare(
      "SELECT id, start_date, end_date, status, published_at FROM schedule_periods WHERE id = ? AND lab_id = ?"
    ).get(Number(req.params.id), req.scope.labId) as any;
    if (!period) return res.status(404).json({ error: "Period not found" });
    const shiftDefs = sqlite.prepare(
      "SELECT id, name, start_time, end_time, min_staff, sort_order FROM schedule_shift_defs WHERE lab_id = ? AND active = 1 ORDER BY sort_order ASC, id ASC"
    ).all(req.scope.labId) as any[];
    const rows = sqlite.prepare(
      `SELECT a.id, a.staff_employee_id, a.shift_def_id, a.work_date, a.department,
              e.first_name, e.last_name
         FROM schedule_assignments a
         LEFT JOIN staff_employees e ON e.id = a.staff_employee_id
        WHERE a.period_id = ? AND a.lab_id = ?`
    ).all(Number(req.params.id), req.scope.labId) as any[];
    const assignments = rows.map((a) => ({
      id: a.id,
      staff_employee_id: a.staff_employee_id,
      shift_def_id: a.shift_def_id,
      work_date: a.work_date,
      department: a.department,
      staff_name: (a.first_name || a.last_name) ? `${a.first_name || ""} ${a.last_name || ""}`.trim() : null,
    }));
    const coverageGaps = computeCoverageGaps(shiftDefs, rows, period.start_date, period.end_date);
    res.json({ period, shiftDefs, assignments, coverageGaps });
  });

  // ── Assignments ────────────────────────────────────────────────────────
  app.post("/api/labs/:labId/schedule/assignments", authMiddleware, labScopeMiddleware, requireWriteAccess, (req: any, res) => {
    if (!ops(req, res)) return;
    const { period_id, staff_employee_id, shift_def_id, work_date, department } = req.body || {};
    if (!period_id || !staff_employee_id || !shift_def_id) return res.status(400).json({ error: "period_id, staff_employee_id, shift_def_id required" });
    if (!YMD.test(String(work_date))) return res.status(400).json({ error: "work_date must be YYYY-MM-DD" });
    const period = sqlite.prepare("SELECT id FROM schedule_periods WHERE id = ? AND lab_id = ?").get(Number(period_id), req.scope.labId);
    if (!period) return res.status(404).json({ error: "Period not found" });
    const shift = sqlite.prepare("SELECT id FROM schedule_shift_defs WHERE id = ? AND lab_id = ?").get(Number(shift_def_id), req.scope.labId);
    if (!shift) return res.status(404).json({ error: "Shift not found" });
    const dept = typeof department === "string" && department.trim() ? department.trim().slice(0, 60) : null;
    const now = new Date().toISOString();
    const info = sqlite.prepare(
      "INSERT INTO schedule_assignments (lab_id, period_id, staff_employee_id, shift_def_id, work_date, department, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(req.scope.labId, Number(period_id), Number(staff_employee_id), Number(shift_def_id), work_date, dept, now);
    res.json({ ok: true, id: info.lastInsertRowid });
  });

  app.delete("/api/labs/:labId/schedule/assignments/:id", authMiddleware, labScopeMiddleware, requireWriteAccess, (req: any, res) => {
    if (!ops(req, res)) return;
    const info = sqlite.prepare(
      "DELETE FROM schedule_assignments WHERE id = ? AND lab_id = ?"
    ).run(Number(req.params.id), req.scope.labId);
    res.json({ ok: true, deleted: info.changes });
  });
}
