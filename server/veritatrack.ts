import type { Express } from "express";
import crypto from "crypto";
import { db } from "./db";
import { applyLicenseToExcelJS } from "./licenseStamp";
import type { LicenseContext } from "@shared/licenseText";

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
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
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
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
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
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
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
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
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
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    sqlite.prepare("UPDATE veritatrack_tasks SET active=0 WHERE id=? AND user_id=?").run(Number(req.params.id), userId);
    res.json({ ok: true });
  });

  // POST sign off a task
  app.post("/api/veritatrack/tasks/:id/signoff", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
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
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    sqlite.prepare("DELETE FROM veritatrack_signoffs WHERE id = ? AND user_id = ?").run(Number(req.params.id), userId);
    res.json({ ok: true });
  });

  // POST import tasks from VeritaMap
  app.post("/api/veritatrack/import-from-map", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const map = sqlite.prepare(
      "SELECT * FROM veritamap_maps WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1"
    ).get(userId) as any;
    if (!map) return res.status(404).json({ error: "No VeritaMap\u2122 found. Build your test menu first." });
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
            ).run(newTask.id, userId, test[fd.field], "Imported from VeritaMap\u2122");
          }
        }
        created++;
      }
    }
    res.json({ ok: true, created, skipped, total: tests.length });
  });

  // GET dashboard summary
  app.get("/api/veritatrack/dashboard", authMiddleware, (req: any, res) => {
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
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

  // POST seed default tasks (idempotent)
  app.post("/api/veritatrack/seed-defaults", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
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
          "SELECT id FROM veritatrack_tasks WHERE user_id=? AND name=? AND active=1"
        ).get(userId, t.name);
        if (existing) { skipped++; continue; }
        sqlite.prepare(
          "INSERT INTO veritatrack_tasks (user_id,name,category,frequency,frequency_months,created_at,updated_at) VALUES (?,?,?,?,?,?,?)"
        ).run(userId, t.name, t.category, t.frequency, t.months, now, now);
        created++;
      }
    }

    res.json({ ok: true, created, skipped });
  });

  // POST Excel export
  app.post("/api/veritatrack/export/excel", authMiddleware, async (req: any, res) => {
    if (!hasTrackAccess(req.user)) return res.status(403).json({ error: "VeritaTrack\u2122 subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const tasks = sqlite.prepare(
      "SELECT * FROM veritatrack_tasks WHERE user_id = ? AND active = 1 ORDER BY category, name"
    ).all(userId) as any[];

    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.creator = "Perplexity Computer";
    wb.created = new Date();

    // ===== Lab identity (Excel Export Standard) =====
    const ownerRow = sqlite.prepare(
      "SELECT clia_lab_name, clia_number, name FROM users WHERE id = ?"
    ).get(userId) as any;
    const labName = ownerRow?.clia_lab_name || ownerRow?.name || "Laboratory";
    const cliaNumber = ownerRow?.clia_number || "Not on file";
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
    aboutBody("This workbook is a snapshot of the laboratory's recurring regulatory and quality tasks tracked in VeritaTrack \u2014 daily, weekly, monthly, quarterly, semiannual, and annual checks tied to CLIA, CAP, TJC, AABB, FDA, OSHA, and state requirements. Each row shows what the task is, which instrument or category it covers, the last documented sign-off, when it is next due, and a status flag (Current / Due Soon / Overdue / Not Started) computed from the frequency and the most recent sign-off date.");
    aboutBlank();
    aboutSection("How to use this workbook");
    aboutBody("The Regulatory Calendar tab is grouped by Frequency (Daily, Weekly, Monthly, Quarterly, Semiannual, Annual) and then by Category. Sort or filter the Status column to triage what needs immediate attention: Overdue first, then Due Soon (within 14 days). The Days Until Due column shows the gap between today and the next due date and turns magenta when overdue. The Performed By column captures the initials or full name recorded at the time of the last sign-off; this is the audit trail for who attests the task was done. Notes carry instrument-specific or procedure-specific reminders set by the lab.");
    aboutBlank();
    aboutSection("Disclaimer");
    aboutBody("This workbook is an internal tracking aid, not an audit-grade compliance attestation, not a regulatory submission, and not a substitute for the lab's procedure manual or the underlying signed records. Status (Current / Due Soon / Overdue / Not Started) is calculated mechanically from the frequency_months value and the most recent completed_date in VeritaTrack \u2014 it does not validate that the work was actually performed competently, that the recorded initials belong to the named person, or that the procedure followed the lab's SOP. The signed sign-off record (paper logs, instrument printouts, LIS records, validation files) is the audit-grade evidence; if there is a conflict between this calendar and those records, the underlying records govern. Due dates assume the frequency value is correct and that no regulatory or accreditation change has shortened the interval; the lab director is responsible for keeping intervals current with the latest CMS, CAP, TJC, AABB, FDA, OSHA, and state guidance. VeritaAssure does not certify regulatory compliance, does not advise on whether a given task satisfies a specific accreditation standard, does not file or report on the lab's behalf, and does not warrant that completing every row in this workbook will satisfy any inspector.");
    aboutBlank();
    aboutSection("Lab identity");
    aboutBody(`This workbook was prepared for ${labName} (CLIA ${cliaNumber}). The lab name and CLIA appear on every printed page header and footer.`);
    aboutBlank();
    aboutSection("Coverage gaps");
    aboutBody("If your laboratory needs a task category, frequency band, or column not represented here \u2014 for example, multi-shift sign-off tracking, separate competency vs maintenance lanes, or per-method QC linkage \u2014 please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision.");
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
}
