import type { Express } from "express";
import { db } from "./db";

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

function taskStatus(nextDueDate: string): "overdue" | "due_soon" | "current" | "not_started" {
  const now = new Date();
  const due = new Date(nextDueDate);
  const daysUntil = Math.floor((due.getTime() - now.getTime()) / 86400000);
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

  function hasTrackAccess(user: any) {
    return [
      "annual","professional","lab","complete","waived",
      "community","hospital","large_hospital","enterprise",
    ].includes(user?.plan);
  }

  // GET all tasks with latest sign-off and computed status
  app.get("/api/veritatrack/tasks", authMiddleware, (req: any, res) => {
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const tasks = sqlite.prepare(
      "SELECT * FROM veritatrack_tasks WHERE user_id = ? AND active = 1 ORDER BY category, name"
    ).all(userId) as any[];
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

  // GET single task with all sign-offs
  app.get("/api/veritatrack/tasks/:id", authMiddleware, (req: any, res) => {
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const task = sqlite.prepare(
      "SELECT * FROM veritatrack_tasks WHERE id = ? AND user_id = ?"
    ).get(Number(req.params.id), userId) as any;
    if (!task) return res.status(404).json({ error: "Task not found" });
    const signoffs = sqlite.prepare(
      "SELECT * FROM veritatrack_signoffs WHERE task_id = ? ORDER BY completed_date DESC"
    ).all(task.id);
    const last = (signoffs as any[])[0] || null;
    const nextDueDate = last ? nextDue(last.completed_date, task.frequency_months) : null;
    res.json({ ...task, signoffs, next_due: nextDueDate, status: last ? taskStatus(nextDueDate!) : "not_started" });
  });

  // POST create task
  app.post("/api/veritatrack/tasks", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const { name, category, instrument, owner, frequency, frequency_months, map_analyte, map_field, notes } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const freqMonths = frequency_months || frequencyToMonths(frequency || "Monthly");
    const now = new Date().toISOString();
    const r = sqlite.prepare(
      "INSERT INTO veritatrack_tasks (user_id,name,category,instrument,owner,frequency,frequency_months,map_analyte,map_field,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(userId, name, category || "Other", instrument || null, owner || null, frequency || "Monthly", freqMonths, map_analyte || null, map_field || null, notes || null, now, now);
    res.json(sqlite.prepare("SELECT * FROM veritatrack_tasks WHERE id = ?").get(r.lastInsertRowid));
  });

  // PUT update task
  app.put("/api/veritatrack/tasks/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const { name, category, instrument, owner, frequency, frequency_months, map_analyte, map_field, notes, active } = req.body;
    const freqMonths = frequency_months || frequencyToMonths(frequency || "Monthly");
    sqlite.prepare(
      "UPDATE veritatrack_tasks SET name=?,category=?,instrument=?,owner=?,frequency=?,frequency_months=?,map_analyte=?,map_field=?,notes=?,active=?,updated_at=datetime('now') WHERE id=? AND user_id=?"
    ).run(name, category || "Other", instrument || null, owner || null, frequency || "Monthly", freqMonths, map_analyte || null, map_field || null, notes || null, active !== false ? 1 : 0, Number(req.params.id), userId);
    res.json(sqlite.prepare("SELECT * FROM veritatrack_tasks WHERE id = ?").get(Number(req.params.id)));
  });

  // DELETE (soft) task
  app.delete("/api/veritatrack/tasks/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    sqlite.prepare("UPDATE veritatrack_tasks SET active=0 WHERE id=? AND user_id=?").run(Number(req.params.id), userId);
    res.json({ ok: true });
  });

  // POST sign off a task
  app.post("/api/veritatrack/tasks/:id/signoff", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const task = sqlite.prepare(
      "SELECT * FROM veritatrack_tasks WHERE id = ? AND user_id = ?"
    ).get(Number(req.params.id), userId) as any;
    if (!task) return res.status(404).json({ error: "Task not found" });
    const { completed_date, initials, performed_by, notes } = req.body;
    if (!completed_date) return res.status(400).json({ error: "completed_date required" });
    const r = sqlite.prepare(
      "INSERT INTO veritatrack_signoffs (task_id,user_id,completed_date,initials,performed_by,notes) VALUES (?,?,?,?,?,?)"
    ).run(task.id, userId, completed_date, initials || null, performed_by || null, notes || null);
    // If linked to a VeritaMap field, update it there too
    if (task.map_analyte && task.map_field) {
      try {
        const map = sqlite.prepare(
          "SELECT id FROM veritamap_maps WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1"
        ).get(userId) as any;
        if (map) {
          const allowed = ["last_cal_ver","last_method_comp","last_precision","last_sop_review"];
          if (allowed.includes(task.map_field)) {
            sqlite.prepare(
              `UPDATE veritamap_tests SET ${task.map_field} = ?, updated_at = datetime('now') WHERE map_id = ? AND analyte = ?`
            ).run(completed_date, map.id, task.map_analyte);
          }
        }
      } catch {}
    }
    res.json(sqlite.prepare("SELECT * FROM veritatrack_signoffs WHERE id = ?").get(r.lastInsertRowid));
  });

  // DELETE a sign-off
  app.delete("/api/veritatrack/signoffs/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    sqlite.prepare("DELETE FROM veritatrack_signoffs WHERE id = ? AND user_id = ?").run(Number(req.params.id), userId);
    res.json({ ok: true });
  });

  // POST import tasks from VeritaMap
  app.post("/api/veritatrack/import-from-map", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const map = sqlite.prepare(
      "SELECT * FROM veritamap_maps WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1"
    ).get(userId) as any;
    if (!map) return res.status(404).json({ error: "No VeritaMap found. Build your test menu first." });
    const tests = sqlite.prepare(
      "SELECT * FROM veritamap_tests WHERE map_id = ? AND active = 1"
    ).all(map.id) as any[];
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
          "SELECT id FROM veritatrack_tasks WHERE user_id=? AND name=? AND active=1"
        ).get(userId, taskName);
        if (existing) { skipped++; continue; }
        sqlite.prepare(
          "INSERT INTO veritatrack_tasks (user_id,name,category,instrument,frequency,frequency_months,map_analyte,map_field,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
        ).run(userId, taskName, fd.category, test.instrument_source || null, fd.frequency, fd.months, test.analyte, fd.field, now, now);
        // Seed initial sign-off from existing map date if present
        if (test[fd.field]) {
          const newTask = sqlite.prepare(
            "SELECT id FROM veritatrack_tasks WHERE user_id=? AND name=? ORDER BY id DESC LIMIT 1"
          ).get(userId, taskName) as any;
          if (newTask) {
            sqlite.prepare(
              "INSERT INTO veritatrack_signoffs (task_id,user_id,completed_date,notes) VALUES (?,?,?,?)"
            ).run(newTask.id, userId, test[fd.field], "Imported from VeritaMap");
          }
        }
        created++;
      }
    }
    res.json({ ok: true, created, skipped, total: tests.length });
  });

  // GET dashboard summary
  app.get("/api/veritatrack/dashboard", authMiddleware, (req: any, res) => {
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const tasks = sqlite.prepare(
      "SELECT * FROM veritatrack_tasks WHERE user_id = ? AND active = 1"
    ).all(userId) as any[];
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
      const daysUntil = Math.floor((due.getTime() - now.getTime()) / 86400000);
      if (daysUntil < 0) { overdue++; overdueItems.push({ ...t, next_due: nextDueDate, days_overdue: -daysUntil }); }
      else if (due <= monthEnd) { dueThisMonth++; dueThisMonthItems.push({ ...t, next_due: nextDueDate, days_until: daysUntil }); }
      else if (due <= thirtyDays) { dueSoon++; dueSoonItems.push({ ...t, next_due: nextDueDate, days_until: daysUntil }); }
      else { current++; }
    }
    res.json({ overdue, dueThisMonth, dueSoon, current, notStarted, total: tasks.length, overdueItems, dueThisMonthItems, dueSoonItems });
  });

  // POST Excel export
  app.post("/api/veritatrack/export/excel", authMiddleware, async (req: any, res) => {
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const tasks = sqlite.prepare(
      "SELECT * FROM veritatrack_tasks WHERE user_id = ? AND active = 1 ORDER BY category, name"
    ).all(userId) as any[];

    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Regulatory Calendar");

    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const headers = ["Frequency","Category","Task","Instrument","Owner", ...MONTHS, "Last Sign-Off","Next Due","Status"];
    const colWidths = [14, 28, 40, 20, 16, ...Array(12).fill(8), 16, 16, 14];
    ws.columns = headers.map((h, i) => ({ header: h, key: `c${i}`, width: colWidths[i] ?? 12 }));

    const year = new Date().getFullYear();
    const thinBorder: any = { top:{style:"thin",color:{argb:"FFD0D0D0"}}, bottom:{style:"thin",color:{argb:"FFD0D0D0"}}, left:{style:"thin",color:{argb:"FFD0D0D0"}}, right:{style:"thin",color:{argb:"FFD0D0D0"}} };

    const headerRow = ws.getRow(1);
    headerRow.height = 20;
    headerRow.eachCell(cell => {
      cell.font = { name:"Calibri", bold:true, color:{argb:"FFFFFFFF"}, size:11 };
      cell.fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FF01696F"} };
      cell.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
      cell.border = thinBorder;
    });

    let rowIdx = 2;
    let lastFreq = "";
    for (const t of tasks) {
      const signoffs = sqlite.prepare(
        "SELECT * FROM veritatrack_signoffs WHERE task_id = ? ORDER BY completed_date DESC"
      ).all(t.id) as any[];
      const last = signoffs[0] || null;
      const nextDueDate = last ? nextDue(last.completed_date, t.frequency_months) : null;
      const status = last ? taskStatus(nextDueDate!) : "not_started";

      // Build month columns -- mark X if due that month
      const monthCols: string[] = Array(12).fill("");
      for (const s of signoffs) {
        const d = new Date(s.completed_date);
        if (d.getFullYear() === year) monthCols[d.getMonth()] = "x";
      }
      if (nextDueDate) {
        const nd = new Date(nextDueDate);
        if (nd.getFullYear() === year && !monthCols[nd.getMonth()]) monthCols[nd.getMonth()] = "-";
      }

      const row = ws.addRow([
        t.frequency !== lastFreq ? t.frequency : "",
        t.category,
        t.name,
        t.instrument || "",
        t.owner || "",
        ...monthCols,
        last ? last.completed_date : "",
        nextDueDate || "",
        status === "overdue" ? "Overdue" : status === "due_soon" ? "Due Soon" : status === "current" ? "Current" : "Not Started",
      ]);
      lastFreq = t.frequency;

      const isEven = rowIdx % 2 === 0;
      row.height = 18;
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.font = { name:"Calibri", size:10, color:{argb:"FF28251D"} };
        cell.alignment = { vertical:"middle", horizontal: colNum >= 6 && colNum <= 17 ? "center" : "left" };
        cell.fill = { type:"pattern", pattern:"solid", fgColor:{argb: isEven ? "FFEBF3F8" : "FFFFFFFF"} };
        cell.border = thinBorder;
        // Status color
        if (colNum === headers.length) {
          const val = String(cell.value || "");
          if (val === "Overdue") cell.font = { name:"Calibri", bold:true, size:10, color:{argb:"FFA12C7B"} };
          else if (val === "Due Soon") cell.font = { name:"Calibri", bold:true, size:10, color:{argb:"FF964219"} };
          else if (val === "Current") cell.font = { name:"Calibri", bold:true, size:10, color:{argb:"FF437A22"} };
        }
        // Month X cells
        if (colNum >= 6 && colNum <= 17 && cell.value === "x") {
          cell.font = { name:"Calibri", bold:true, size:10, color:{argb:"FF01696F"} };
        }
      });
      rowIdx++;
    }

    ws.views = [{ state:"frozen" as const, xSplit:2, ySplit:1, topLeftCell:"C2" }];
    ws.autoFilter = { from:"A1", to: ws.getCell(1, headers.length).address };

    const buf = await wb.xlsx.writeBuffer();
    const filename = `VeritaTrack_${year}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  });
}
