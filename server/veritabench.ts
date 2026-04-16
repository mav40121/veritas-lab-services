/**
 * VeritaBench routes - Productivity Tracker + Staffing Analyzer
 */
import type { Express } from "express";
import { db } from "./db";

const SUITE_PLANS = ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital", "enterprise"];

function hasOpsAccess(user: any) {
  return SUITE_PLANS.includes(user?.plan);
}

export function registerVeritaBenchRoutes(
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
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rows = sqlite.prepare(
      "SELECT * FROM productivity_months WHERE account_id = ? ORDER BY year DESC, month DESC"
    ).all(accountId);
    res.json(rows);
  });

  // POST /api/productivity - upsert a month
  app.post("/api/productivity", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
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
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const row = sqlite.prepare("SELECT * FROM productivity_months WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!row) return res.status(404).json({ error: "Entry not found" });
    sqlite.prepare("DELETE FROM productivity_months WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // GET /api/productivity/export - Excel export
  app.get("/api/productivity/export", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
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
      res.set("Content-Disposition", `attachment; filename="VeritaBench-Productivity_${new Date().toISOString().split("T")[0]}.xlsx"`);
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
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rows = sqlite.prepare(
      "SELECT * FROM staffing_studies WHERE account_id = ? ORDER BY created_at DESC"
    ).all(accountId);
    res.json(rows);
  });

  // POST /api/staffing-studies - create study
  app.post("/api/staffing-studies", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
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
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const study = sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!study) return res.status(404).json({ error: "Study not found" });
    const data = sqlite.prepare("SELECT * FROM staffing_hourly_data WHERE study_id = ? ORDER BY week_number, day_of_week, hour_slot").all(id);
    res.json({ study, data });
  });

  // POST /api/staffing-studies/:id/data - batch upsert hourly data
  app.post("/api/staffing-studies/:id/data", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
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
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const study = sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!study) return res.status(404).json({ error: "Study not found" });
    sqlite.prepare("DELETE FROM staffing_hourly_data WHERE study_id = ?").run(id);
    sqlite.prepare("DELETE FROM staffing_studies WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PUBLIC DEMO ENDPOINTS (no auth - demo data only)
  // ═══════════════════════════════════════════════════════════════════════

  // GET /api/demo/productivity-months - returns demo account productivity data only
  app.get("/api/demo/productivity-months", (_req: any, res) => {
    const demoUser = sqlite.prepare("SELECT id FROM users WHERE email = 'demo@veritaslabservices.com'").get() as any;
    if (!demoUser) return res.status(404).json({ error: "Demo data not available" });
    const rows = sqlite.prepare(
      "SELECT * FROM productivity_months WHERE account_id = ? ORDER BY year ASC, month ASC"
    ).all(demoUser.id);
    res.json(rows);
  });

  // GET /api/demo/inventory - returns demo account inventory items only
  app.get("/api/demo/inventory", (_req: any, res) => {
    const demoUser = sqlite.prepare("SELECT id FROM users WHERE email = 'demo@veritaslabservices.com'").get() as any;
    if (!demoUser) return res.status(404).json({ error: "Demo data not available" });
    const rows = sqlite.prepare(
      "SELECT * FROM inventory_items WHERE account_id = ? ORDER BY item_name ASC"
    ).all(demoUser.id);
    const items = rows.map((item: any) => {
      const burnRate = item.burn_rate || 0;
      const reorderPoint = burnRate * ((item.lead_time_days || 0) + (item.safety_stock_days || 0));
      const orderToQty = burnRate * (item.desired_days_of_stock || 0);
      const daysRemaining = burnRate > 0 ? Math.round(item.quantity_on_hand / burnRate) : null;
      const needsReorder = item.quantity_on_hand <= reorderPoint;
      return {
        ...item,
        reorder_point: Math.round(reorderPoint),
        order_to_qty: Math.round(orderToQty),
        days_remaining: daysRemaining,
        needs_reorder: needsReorder,
      };
    });
    res.json(items);
  });

  // GET /api/demo/staffing-study - returns demo account first staffing study with data
  app.get("/api/demo/staffing-study", (_req: any, res) => {
    const demoUser = sqlite.prepare("SELECT id FROM users WHERE email = 'demo@veritaslabservices.com'").get() as any;
    if (!demoUser) return res.status(404).json({ error: "Demo data not available" });
    const study = sqlite.prepare(
      "SELECT * FROM staffing_studies WHERE account_id = ? ORDER BY created_at ASC LIMIT 1"
    ).get(demoUser.id) as any;
    if (!study) return res.status(404).json({ error: "No demo staffing study found" });
    const data = sqlite.prepare(
      "SELECT * FROM staffing_hourly_data WHERE study_id = ? ORDER BY week_number, day_of_week, hour_slot"
    ).all(study.id);
    res.json({ study, data });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // INVENTORY MANAGER
  // ═══════════════════════════════════════════════════════════════════════

  // GET /api/inventory - list all inventory items for account
  app.get("/api/inventory", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rows = sqlite.prepare(
      "SELECT * FROM inventory_items WHERE account_id = ? ORDER BY item_name ASC"
    ).all(accountId);
    const items = rows.map((item: any) => {
      const burnRate = item.burn_rate || 0;
      const reorderPoint = burnRate * ((item.lead_time_days || 0) + (item.safety_stock_days || 0));
      const orderToQty = burnRate * (item.desired_days_of_stock || 0);
      const daysRemaining = burnRate > 0 ? Math.round(item.quantity_on_hand / burnRate) : null;
      const needsReorder = item.quantity_on_hand <= reorderPoint;
      return {
        ...item,
        reorder_point: Math.round(reorderPoint),
        order_to_qty: Math.round(orderToQty),
        days_remaining: daysRemaining,
        needs_reorder: needsReorder,
      };
    });
    res.json(items);
  });

  // POST /api/inventory - create new inventory item
  app.post("/api/inventory", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { item_name, catalog_number, lot_number, department, category, quantity_on_hand, unit, expiration_date, vendor, storage_location, notes, status, burn_rate, order_unit, usage_unit, units_per_order_unit, lead_time_days, safety_stock_days, desired_days_of_stock, standing_order, standing_order_review_date } = req.body;
    if (!item_name) return res.status(400).json({ error: "item_name is required" });
    const now = new Date().toISOString();
    try {
      const result = sqlite.prepare(`
        INSERT INTO inventory_items (account_id, item_name, catalog_number, lot_number, department, category, quantity_on_hand, unit, expiration_date, vendor, storage_location, notes, status, burn_rate, order_unit, usage_unit, units_per_order_unit, lead_time_days, safety_stock_days, desired_days_of_stock, standing_order, standing_order_review_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(accountId, item_name, catalog_number ?? null, lot_number ?? null, department ?? 'Core Lab', category ?? 'Reagent', quantity_on_hand ?? 0, unit ?? 'each', expiration_date ?? null, vendor ?? null, storage_location ?? null, notes ?? null, status ?? 'active', burn_rate ?? 0, order_unit ?? 'each', usage_unit ?? 'each', units_per_order_unit ?? 1, lead_time_days ?? 5, safety_stock_days ?? 3, desired_days_of_stock ?? 30, standing_order ?? 0, standing_order_review_date ?? null, now, now);
      const row = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(Number(result.lastInsertRowid));
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/inventory/:id - update an inventory item
  app.put("/api/inventory/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const existing = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!existing) return res.status(404).json({ error: "Item not found" });
    const { item_name, catalog_number, lot_number, department, category, quantity_on_hand, unit, expiration_date, vendor, storage_location, notes, status, burn_rate, order_unit, usage_unit, units_per_order_unit, lead_time_days, safety_stock_days, desired_days_of_stock, standing_order, standing_order_review_date } = req.body;
    const now = new Date().toISOString();
    try {
      sqlite.prepare(`
        UPDATE inventory_items SET item_name = ?, catalog_number = ?, lot_number = ?, department = ?, category = ?, quantity_on_hand = ?, unit = ?, expiration_date = ?, vendor = ?, storage_location = ?, notes = ?, status = ?, burn_rate = ?, order_unit = ?, usage_unit = ?, units_per_order_unit = ?, lead_time_days = ?, safety_stock_days = ?, desired_days_of_stock = ?, standing_order = ?, standing_order_review_date = ?, updated_at = ?
        WHERE id = ? AND account_id = ?
      `).run(item_name ?? (existing as any).item_name, catalog_number ?? null, lot_number ?? null, department ?? 'Core Lab', category ?? 'Reagent', quantity_on_hand ?? 0, unit ?? 'each', expiration_date ?? null, vendor ?? null, storage_location ?? null, notes ?? null, status ?? 'active', burn_rate ?? 0, order_unit ?? 'each', usage_unit ?? 'each', units_per_order_unit ?? 1, lead_time_days ?? 5, safety_stock_days ?? 3, desired_days_of_stock ?? 30, standing_order ?? 0, standing_order_review_date ?? null, now, id, accountId);
      const row = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(id);
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/inventory/:id - delete an inventory item
  app.delete("/api/inventory/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const row = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!row) return res.status(404).json({ error: "Item not found" });
    sqlite.prepare("DELETE FROM inventory_items WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // GET /api/staffing-studies/:id/export - Excel export of analysis
  app.get("/api/staffing-studies/:id/export", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
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

  // ═══════════════════════════════════════════════════════════════════════
  // PI DASHBOARD - Performance Improvement quality metrics
  // ═══════════════════════════════════════════════════════════════════════

  // GET /api/pi/departments - list departments (returns empty array if none exist)
  app.get("/api/pi/departments", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rows = sqlite.prepare(
      "SELECT * FROM pi_departments WHERE account_id = ? ORDER BY sort_order ASC, id ASC"
    ).all(accountId);
    res.json(rows);
  });

  // POST /api/pi/departments - create department
  app.post("/api/pi/departments", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { name, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });
    const now = new Date().toISOString();
    try {
      const result = sqlite.prepare(
        "INSERT INTO pi_departments (account_id, name, sort_order, active, created_at) VALUES (?, ?, ?, 1, ?)"
      ).run(accountId, name, sort_order ?? 0, now);
      const row = sqlite.prepare("SELECT * FROM pi_departments WHERE id = ?").get(Number(result.lastInsertRowid));
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/pi/departments/:id - update department
  app.put("/api/pi/departments/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const existing = sqlite.prepare("SELECT * FROM pi_departments WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!existing) return res.status(404).json({ error: "Department not found" });
    const { name, sort_order, active } = req.body;
    try {
      sqlite.prepare(
        "UPDATE pi_departments SET name = ?, sort_order = ?, active = ? WHERE id = ? AND account_id = ?"
      ).run(name ?? (existing as any).name, sort_order ?? (existing as any).sort_order, active ?? (existing as any).active, id, accountId);
      const row = sqlite.prepare("SELECT * FROM pi_departments WHERE id = ?").get(id);
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/pi/departments/:id - delete department (cascade metrics + entries)
  app.delete("/api/pi/departments/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const existing = sqlite.prepare("SELECT * FROM pi_departments WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!existing) return res.status(404).json({ error: "Department not found" });
    const metricIds = sqlite.prepare("SELECT id FROM pi_metrics WHERE department_id = ?").all(id) as any[];
    for (const m of metricIds) {
      sqlite.prepare("DELETE FROM pi_entries WHERE metric_id = ?").run(m.id);
    }
    sqlite.prepare("DELETE FROM pi_metrics WHERE department_id = ?").run(id);
    sqlite.prepare("DELETE FROM pi_departments WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // GET /api/pi/metrics - list metrics for a department
  app.get("/api/pi/metrics", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const departmentId = req.query.department_id;
    if (!departmentId) return res.status(400).json({ error: "department_id is required" });
    const rows = sqlite.prepare(
      "SELECT * FROM pi_metrics WHERE department_id = ? AND account_id = ? ORDER BY sort_order ASC, id ASC"
    ).all(departmentId, accountId);
    res.json(rows);
  });

  // POST /api/pi/metrics - create metric
  app.post("/api/pi/metrics", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { department_id, name, unit, direction, benchmark_green, benchmark_yellow, benchmark_red, sort_order } = req.body;
    if (!department_id || !name) return res.status(400).json({ error: "department_id and name are required" });
    const now = new Date().toISOString();
    try {
      const result = sqlite.prepare(
        "INSERT INTO pi_metrics (department_id, account_id, name, unit, direction, benchmark_green, benchmark_yellow, benchmark_red, sort_order, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)"
      ).run(department_id, accountId, name, unit ?? "%", direction ?? "lower_is_better", benchmark_green ?? null, benchmark_yellow ?? null, benchmark_red ?? null, sort_order ?? 0, now);
      const row = sqlite.prepare("SELECT * FROM pi_metrics WHERE id = ?").get(Number(result.lastInsertRowid));
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/pi/metrics/:id - update metric (including benchmark thresholds)
  app.put("/api/pi/metrics/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const existing = sqlite.prepare("SELECT * FROM pi_metrics WHERE id = ? AND account_id = ?").get(id, accountId) as any;
    if (!existing) return res.status(404).json({ error: "Metric not found" });
    const { name, unit, direction, benchmark_green, benchmark_yellow, benchmark_red, sort_order, active } = req.body;
    try {
      sqlite.prepare(
        "UPDATE pi_metrics SET name = ?, unit = ?, direction = ?, benchmark_green = ?, benchmark_yellow = ?, benchmark_red = ?, sort_order = ?, active = ? WHERE id = ? AND account_id = ?"
      ).run(
        name ?? existing.name, unit ?? existing.unit, direction ?? existing.direction,
        benchmark_green !== undefined ? benchmark_green : existing.benchmark_green,
        benchmark_yellow !== undefined ? benchmark_yellow : existing.benchmark_yellow,
        benchmark_red !== undefined ? benchmark_red : existing.benchmark_red,
        sort_order ?? existing.sort_order, active ?? existing.active, id, accountId
      );
      const row = sqlite.prepare("SELECT * FROM pi_metrics WHERE id = ?").get(id);
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/pi/metrics/:id - delete metric (cascade entries)
  app.delete("/api/pi/metrics/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const existing = sqlite.prepare("SELECT * FROM pi_metrics WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!existing) return res.status(404).json({ error: "Metric not found" });
    sqlite.prepare("DELETE FROM pi_entries WHERE metric_id = ?").run(id);
    sqlite.prepare("DELETE FROM pi_metrics WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // GET /api/pi/entries - get all entries for a year/department
  app.get("/api/pi/entries", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { year, department_id } = req.query;
    if (!year || !department_id) return res.status(400).json({ error: "year and department_id are required" });
    const metricIds = sqlite.prepare("SELECT id FROM pi_metrics WHERE department_id = ? AND account_id = ?").all(department_id, accountId) as any[];
    if (metricIds.length === 0) return res.json([]);
    const ids = metricIds.map((m: any) => m.id);
    const placeholders = ids.map(() => "?").join(",");
    const rows = sqlite.prepare(
      `SELECT * FROM pi_entries WHERE metric_id IN (${placeholders}) AND year = ? AND account_id = ? ORDER BY month ASC`
    ).all(...ids, year, accountId);
    res.json(rows);
  });

  // POST /api/pi/entries - upsert entry (metric_id + year + month unique)
  app.post("/api/pi/entries", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { metric_id, year, month, value, volume, notes } = req.body;
    if (!metric_id || !year || !month) return res.status(400).json({ error: "metric_id, year, and month are required" });
    const now = new Date().toISOString();
    try {
      sqlite.prepare(`
        INSERT INTO pi_entries (metric_id, account_id, year, month, value, volume, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(metric_id, year, month) DO UPDATE SET
          value = excluded.value,
          volume = excluded.volume,
          notes = excluded.notes,
          updated_at = excluded.updated_at
      `).run(metric_id, accountId, year, month, value ?? null, volume ?? null, notes ?? null, now, now);
      const row = sqlite.prepare(
        "SELECT * FROM pi_entries WHERE metric_id = ? AND year = ? AND month = ?"
      ).get(metric_id, year, month);
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/pi/entries/:id - delete entry
  app.delete("/api/pi/entries/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const row = sqlite.prepare("SELECT * FROM pi_entries WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!row) return res.status(404).json({ error: "Entry not found" });
    sqlite.prepare("DELETE FROM pi_entries WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // GET /api/pi/dashboard - computed dashboard data
  app.get("/api/pi/dashboard", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user)) return res.status(403).json({ error: "VeritaBench requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { year, department_id } = req.query;
    if (!year || !department_id) return res.status(400).json({ error: "year and department_id are required" });
    const yr = parseInt(year as string);

    const metrics = sqlite.prepare(
      "SELECT * FROM pi_metrics WHERE department_id = ? AND account_id = ? AND active = 1 ORDER BY sort_order ASC, id ASC"
    ).all(department_id, accountId) as any[];

    if (metrics.length === 0) return res.json({ metrics: [] });

    const metricIds = metrics.map((m: any) => m.id);
    const placeholders = metricIds.map(() => "?").join(",");

    // Current year entries
    const currentEntries = sqlite.prepare(
      `SELECT * FROM pi_entries WHERE metric_id IN (${placeholders}) AND year = ? ORDER BY month ASC`
    ).all(...metricIds, yr) as any[];

    // Prior year entries
    const priorEntries = sqlite.prepare(
      `SELECT * FROM pi_entries WHERE metric_id IN (${placeholders}) AND year = ? ORDER BY month ASC`
    ).all(...metricIds, yr - 1) as any[];

    function getBenchmarkStatus(value: number | null, metric: any): string | null {
      if (value == null) return null;
      if (metric.benchmark_green == null && metric.benchmark_yellow == null) return null;
      if (metric.direction === "lower_is_better") {
        if (metric.benchmark_green != null && value <= metric.benchmark_green) return "green";
        if (metric.benchmark_yellow != null && value <= metric.benchmark_yellow) return "yellow";
        return "red";
      } else {
        if (metric.benchmark_green != null && value >= metric.benchmark_green) return "green";
        if (metric.benchmark_yellow != null && value >= metric.benchmark_yellow) return "yellow";
        return "red";
      }
    }

    const result = metrics.map((metric: any) => {
      const entries = currentEntries.filter((e: any) => e.metric_id === metric.id);
      const priorYearEntries = priorEntries.filter((e: any) => e.metric_id === metric.id);

      const monthlyValues: Record<number, { value: number | null; volume: number | null; status: string | null }> = {};
      for (let m = 1; m <= 12; m++) {
        const entry = entries.find((e: any) => e.month === m);
        const val = entry?.value ?? null;
        monthlyValues[m] = {
          value: val,
          volume: entry?.volume ?? null,
          status: getBenchmarkStatus(val, metric),
        };
      }

      // Quarterly averages
      const quarters: Record<string, number | null> = {};
      for (const [qLabel, months] of [["Q1", [1,2,3]], ["Q2", [4,5,6]], ["Q3", [7,8,9]], ["Q4", [10,11,12]]] as [string, number[]][]) {
        const vals = months.map(m => monthlyValues[m]?.value).filter((v): v is number => v != null);
        quarters[qLabel] = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      }

      // YTD average
      const allVals = entries.map((e: any) => e.value).filter((v: any): v is number => v != null);
      const ytdAvg = allVals.length > 0 ? allVals.reduce((s: number, v: number) => s + v, 0) / allVals.length : null;

      // Prior year average
      const pyVals = priorYearEntries.map((e: any) => e.value).filter((v: any): v is number => v != null);
      const pyAvg = pyVals.length > 0 ? pyVals.reduce((s: number, v: number) => s + v, 0) / pyVals.length : null;

      // Current month value (latest entry)
      const latestEntry = entries.length > 0 ? entries[entries.length - 1] : null;

      return {
        metric,
        monthlyValues,
        quarters,
        ytdAvg,
        ytdStatus: getBenchmarkStatus(ytdAvg, metric),
        pyAvg,
        pyStatus: getBenchmarkStatus(pyAvg, metric),
        currentValue: latestEntry?.value ?? null,
        currentMonth: latestEntry?.month ?? null,
        currentStatus: getBenchmarkStatus(latestEntry?.value ?? null, metric),
        dataPointCount: allVals.length,
      };
    });

    res.json({ metrics: result });
  });
}
