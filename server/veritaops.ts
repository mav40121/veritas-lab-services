/**
 * VeritaOps routes - Productivity Tracker + Staffing Analyzer
 */
import type { Express } from "express";
import { db } from "./db";

const SUITE_PLANS = ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital", "enterprise"];

function hasOpsAccess(user: any) {
  return SUITE_PLANS.includes(user?.plan);
}

export function registerVeritaOpsRoutes(
  app: Express,
  authMiddleware: any,
  requireWriteAccess: any,
  requireModuleEdit: (mod: string) => any,
) {
  const sqlite = (db as any).$client;

  // ═══════════════════════════════════════════════════════════════════════
  // PRODUCTIVITY TRACKER
  // ═══════════════════════════════════════════════════════════════════════

  // GET /api/productivity - list all months for authenticated user's account
  app.get("/api/productivity", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaOps requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rows = sqlite.prepare(
      "SELECT * FROM productivity_months WHERE account_id = ? ORDER BY year DESC, month DESC"
    ).all(accountId);
    res.json(rows);
  });

  // POST /api/productivity - upsert a month
  app.post("/api/productivity", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaOps requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { year, month, billable_tests, productive_hours, non_productive_hours, overtime_hours, total_ftes, facility_type, notes } = req.body;
    if (!year || !month) return res.status(400).json({ error: "year and month are required" });
    const now = new Date().toISOString();
    try {
      sqlite.prepare(`
        INSERT INTO productivity_months (account_id, year, month, billable_tests, productive_hours, non_productive_hours, overtime_hours, total_ftes, facility_type, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, year, month) DO UPDATE SET
          billable_tests = excluded.billable_tests,
          productive_hours = excluded.productive_hours,
          non_productive_hours = excluded.non_productive_hours,
          overtime_hours = excluded.overtime_hours,
          total_ftes = excluded.total_ftes,
          facility_type = excluded.facility_type,
          notes = excluded.notes,
          updated_at = excluded.updated_at
      `).run(accountId, year, month, billable_tests ?? null, productive_hours ?? null, non_productive_hours ?? null, overtime_hours ?? null, total_ftes ?? null, facility_type ?? 'community', notes ?? null, now, now);
      const row = sqlite.prepare("SELECT * FROM productivity_months WHERE account_id = ? AND year = ? AND month = ?").get(accountId, year, month);
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/productivity/:id - delete a month entry
  app.delete("/api/productivity/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaOps requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const row = sqlite.prepare("SELECT * FROM productivity_months WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!row) return res.status(404).json({ error: "Entry not found" });
    sqlite.prepare("DELETE FROM productivity_months WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // GET /api/productivity/export - Excel export
  app.get("/api/productivity/export", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaOps requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rows = sqlite.prepare(
      "SELECT * FROM productivity_months WHERE account_id = ? ORDER BY year ASC, month ASC"
    ).all(accountId) as any[];

    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Productivity Data");

      const headers = [
        "Year", "Month", "Billable Tests", "Productive Hours",
        "Non-Productive Hours", "Overtime Hours", "Total FTEs",
        "Productivity Ratio", "OT %", "Productive %", "Facility Type", "Notes",
      ];
      const colWidths = [10, 10, 18, 18, 22, 18, 14, 20, 12, 14, 22, 30];
      ws.columns = headers.map((h, i) => ({ header: h, key: `col${i}`, width: colWidths[i] ?? 18 }));

      const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const dataRows = rows.map((r: any) => {
        const prodRatio = r.productive_hours && r.billable_tests ? (r.productive_hours / r.billable_tests).toFixed(4) : "";
        const otPct = r.overtime_hours && r.productive_hours ? ((r.overtime_hours / r.productive_hours) * 100).toFixed(1) + "%" : "";
        const prodPct = r.productive_hours && r.non_productive_hours != null ? ((r.productive_hours / (r.productive_hours + r.non_productive_hours)) * 100).toFixed(1) + "%" : "";
        return [
          r.year, monthNames[r.month] || r.month, r.billable_tests ?? "",
          r.productive_hours ?? "", r.non_productive_hours ?? "",
          r.overtime_hours ?? "", r.total_ftes ?? "",
          prodRatio, otPct, prodPct,
          r.facility_type ?? "", r.notes ?? "",
        ];
      });
      ws.addRows(dataRows);

      // Styling: teal headers
      const tealFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
      const headerFont: any = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri", size: 11 };
      const headerRow = ws.getRow(1);
      headerRow.height = 20;
      headerRow.eachCell((cell: any) => {
        cell.fill = tealFill;
        cell.font = headerFont;
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = { top: { style: "thin", color: { argb: "FFD0D0D0" } }, bottom: { style: "thin", color: { argb: "FFD0D0D0" } }, left: { style: "thin", color: { argb: "FFD0D0D0" } }, right: { style: "thin", color: { argb: "FFD0D0D0" } } };
      });

      // Freeze pane B2, auto-filter, alternating rows
      ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
      ws.autoFilter = { from: "A1", to: `L${dataRows.length + 1}` };
      for (let i = 2; i <= dataRows.length + 1; i++) {
        const row = ws.getRow(i);
        row.height = 20;
        const bgColor = i % 2 === 0 ? "FFEBF3F8" : "FFFFFFFF";
        row.eachCell((cell: any) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
          cell.font = { name: "Calibri", size: 10, color: { argb: "FF28251D" } };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = { top: { style: "thin", color: { argb: "FFD0D0D0" } }, bottom: { style: "thin", color: { argb: "FFD0D0D0" } }, left: { style: "thin", color: { argb: "FFD0D0D0" } }, right: { style: "thin", color: { argb: "FFD0D0D0" } } };
        });
      }

      const buffer = await wb.xlsx.writeBuffer();
      res.set("Content-Disposition", `attachment; filename="VeritaOps-Productivity_${new Date().toISOString().split("T")[0]}.xlsx"`);
      res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ error: "Export failed: " + err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAFFING ANALYZER
  // ═══════════════════════════════════════════════════════════════════════

  // GET /api/staffing-studies - list studies for account
  app.get("/api/staffing-studies", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaOps requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rows = sqlite.prepare(
      "SELECT * FROM staffing_studies WHERE account_id = ? ORDER BY created_at DESC"
    ).all(accountId);
    res.json(rows);
  });

  // POST /api/staffing-studies - create study
  app.post("/api/staffing-studies", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaOps requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { name, department, start_date } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });
    const now = new Date().toISOString();
    try {
      const result = sqlite.prepare(
        "INSERT INTO staffing_studies (account_id, name, department, start_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)"
      ).run(accountId, name, department ?? "Core Lab", start_date ?? null, now, now);
      const row = sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ?").get(Number(result.lastInsertRowid));
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/staffing-studies/:id - get study with all data
  app.get("/api/staffing-studies/:id", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaOps requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const study = sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!study) return res.status(404).json({ error: "Study not found" });
    const data = sqlite.prepare("SELECT * FROM staffing_hourly_data WHERE study_id = ? ORDER BY week_number, day_of_week, hour_slot").all(id);
    res.json({ study, data });
  });

  // POST /api/staffing-studies/:id/data - batch upsert hourly data
  app.post("/api/staffing-studies/:id/data", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaOps requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const study = sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!study) return res.status(404).json({ error: "Study not found" });

    const items = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: "Expected array of data items" });

    const now = new Date().toISOString();
    const upsert = sqlite.prepare(`
      INSERT INTO staffing_hourly_data (study_id, week_number, day_of_week, hour_slot, metric_type, value, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(study_id, week_number, day_of_week, hour_slot, metric_type) DO UPDATE SET
        value = excluded.value
    `);

    const batchUpsert = sqlite.transaction(() => {
      for (const item of items) {
        upsert.run(id, item.week_number, item.day_of_week, item.hour_slot, item.metric_type, item.value ?? 0, now);
      }
    });

    try {
      batchUpsert();
      res.json({ success: true, count: items.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/staffing-studies/:id - delete study and cascade data
  app.delete("/api/staffing-studies/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaOps requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const study = sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!study) return res.status(404).json({ error: "Study not found" });
    sqlite.prepare("DELETE FROM staffing_hourly_data WHERE study_id = ?").run(id);
    sqlite.prepare("DELETE FROM staffing_studies WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // GET /api/staffing-studies/:id/export - Excel export of analysis
  app.get("/api/staffing-studies/:id/export", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaOps requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const study = sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ? AND account_id = ?").get(id, accountId) as any;
    if (!study) return res.status(404).json({ error: "Study not found" });
    const data = sqlite.prepare("SELECT * FROM staffing_hourly_data WHERE study_id = ?").all(id) as any[];

    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();

      const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      const hourLabels: string[] = [];
      for (let h = 0; h < 24; h++) {
        const start = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
        const end = (h + 1) === 24 ? "12 AM" : (h + 1) < 12 ? `${h + 1} AM` : (h + 1) === 12 ? "12 PM" : `${h + 1 - 12} PM`;
        hourLabels.push(`${start}-${end}`);
      }

      // Averages sheet
      const wsAvg = wb.addWorksheet("Averages");
      const avgHeaders = ["Hour Slot", ...dayNames.map(d => `${d} Received`), ...dayNames.map(d => `${d} Verified`)];
      wsAvg.columns = avgHeaders.map((h, i) => ({ header: h, key: `col${i}`, width: i === 0 ? 16 : 14 }));

      // Compute averages
      for (let h = 0; h < 24; h++) {
        const rowData: (string | number)[] = [hourLabels[h]];
        for (const metricType of ["received", "verified"]) {
          for (let d = 0; d < 7; d++) {
            const vals = data.filter((r: any) => r.hour_slot === h && r.day_of_week === d && r.metric_type === metricType);
            const avg = vals.length > 0 ? vals.reduce((s: number, r: any) => s + (r.value || 0), 0) / vals.length : 0;
            rowData.push(Math.round(avg * 10) / 10);
          }
        }
        wsAvg.addRow(rowData);
      }

      // Style headers
      const tealFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
      const headerFont: any = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri", size: 11 };
      for (const sheet of [wsAvg]) {
        const hRow = sheet.getRow(1);
        hRow.height = 20;
        hRow.eachCell((cell: any) => {
          cell.fill = tealFill;
          cell.font = headerFont;
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = { top: { style: "thin", color: { argb: "FFD0D0D0" } }, bottom: { style: "thin", color: { argb: "FFD0D0D0" } }, left: { style: "thin", color: { argb: "FFD0D0D0" } }, right: { style: "thin", color: { argb: "FFD0D0D0" } } };
        });
        sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
      }

      // Data row styling
      for (let i = 2; i <= 25; i++) {
        const row = wsAvg.getRow(i);
        row.height = 20;
        const bgColor = i % 2 === 0 ? "FFEBF3F8" : "FFFFFFFF";
        row.eachCell((cell: any) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
          cell.font = { name: "Calibri", size: 10, color: { argb: "FF28251D" } };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = { top: { style: "thin", color: { argb: "FFD0D0D0" } }, bottom: { style: "thin", color: { argb: "FFD0D0D0" } }, left: { style: "thin", color: { argb: "FFD0D0D0" } }, right: { style: "thin", color: { argb: "FFD0D0D0" } } };
        });
      }

      const buffer = await wb.xlsx.writeBuffer();
      res.set("Content-Disposition", `attachment; filename="Staffing-Analysis_${study.name.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx"`);
      res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ error: "Export failed: " + err.message });
    }
  });
}
