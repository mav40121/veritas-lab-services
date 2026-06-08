/**
 * VeritaBench routes - Productivity Tracker + Staffing Analyzer
 */
import type { Express } from "express";
import crypto from "crypto";
import { db } from "./db";
import { DEMO_USER_EMAIL } from "./constants";
import { applyLicenseToExcelJS } from "./licenseStamp";
import type { LicenseContext } from "@shared/licenseText";
import { generateReorderListPDF, generateReorderListExcel, generateSnapOrderPDF, type ReorderItem, type SnapOrderItem, type VendorRecordForPdf } from "./orderDocument";
import { generateBarcodeLabelSheetPdf, type BarcodeLabelInput } from "./barcodeLabelPdf";
import { generateInventoryCountExcel, type InventoryCountItem } from "./inventoryCountExcel";
import { storePdfToken } from "./pdfTokens";

// PR 4 helper: builds a lower-cased-name keyed map of VendorRecordForPdf
// from the lab's stock_vendors directory. The PDF renderer uses this to
// auto-fill the per-vendor "Send to" panel on the Order PDF cover. Empty
// map (or null labId) is the conditional fallback path: PDF renders
// today's behavior without any panel, no regression for labs that
// haven't populated their vendor directory.
function buildVendorRecordMap(labId: number | null): Map<string, VendorRecordForPdf> | undefined {
  if (!labId) return undefined;
  const sqlite = (db as any).$client;
  const vendors = sqlite.prepare(
    "SELECT id, name, account_number, ordering_email, ordering_phone, ordering_fax, ordering_portal_url, po_number FROM stock_vendors WHERE lab_id = ? AND status = 'active'"
  ).all(labId) as any[];
  if (vendors.length === 0) return undefined;
  const primaryContact = new Map<number, { contact_name: string; contact_role: string | null }>();
  const contacts = sqlite.prepare(
    "SELECT vendor_id, contact_name, contact_role FROM stock_vendor_contacts WHERE lab_id = ? ORDER BY sort_order ASC, id ASC"
  ).all(labId) as Array<{ vendor_id: number; contact_name: string; contact_role: string | null }>;
  for (const c of contacts) {
    if (!primaryContact.has(c.vendor_id)) {
      primaryContact.set(c.vendor_id, { contact_name: c.contact_name, contact_role: c.contact_role });
    }
  }
  const map = new Map<string, VendorRecordForPdf>();
  for (const v of vendors) {
    const pc = primaryContact.get(v.id) || null;
    map.set(String(v.name).toLowerCase().trim(), {
      name: v.name,
      account_number: v.account_number,
      ordering_email: v.ordering_email,
      ordering_phone: v.ordering_phone,
      ordering_fax: v.ordering_fax,
      ordering_portal_url: v.ordering_portal_url,
      po_number: v.po_number,
      primary_contact_name: pc?.contact_name || null,
      primary_contact_role: pc?.contact_role || null,
    });
  }
  return map;
}

function bencheLicenseCtx(req: any): LicenseContext {
  const u = req?.user || null;
  const sqlite = (db as any).$client;
  const ownerId = req?.ownerUserId ?? req?.userId;
  const row = ownerId
    ? (sqlite.prepare("SELECT clia_lab_name, clia_number, email, name, plan FROM users WHERE id = ?").get(ownerId) as any)
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
  return {
    licensee: "Demo Preview",
    email: ipHash,
    plan: "demo",
    issueDate: new Date().toISOString().slice(0, 10),
  };
}

const SUITE_PLANS = ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "clinic", "community", "hospital", "large_hospital", "enterprise"];

function hasOpsAccess(user: any, lab?: any) {
  const plan = lab?.plan ?? user?.plan;
  return SUITE_PLANS.includes(plan);
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
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rows = sqlite.prepare(
      "SELECT * FROM productivity_months WHERE account_id = ? ORDER BY year DESC, month DESC"
    ).all(accountId);
    res.json(rows);
  });

  // POST /api/productivity - upsert a month
  app.post("/api/productivity", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
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
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const row = sqlite.prepare("SELECT * FROM productivity_months WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!row) return res.status(404).json({ error: "Entry not found" });
    sqlite.prepare("DELETE FROM productivity_months WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // GET /api/productivity/export - Excel export
  app.get("/api/productivity/export", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rows = sqlite.prepare(
      "SELECT * FROM productivity_months WHERE account_id = ? ORDER BY year ASC, month ASC"
    ).all(accountId) as any[];

    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      wb.creator = "Perplexity Computer";
      wb.created = new Date();

      // ===== Lab identity (Excel Export Standard) =====
      const ownerRow = sqlite.prepare(
        "SELECT clia_lab_name, clia_number, name FROM users WHERE id = ?"
      ).get(accountId) as any;
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
      aboutTitle.value = "VeritaBench Productivity Tracker";
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
      aboutBody("This workbook is a month-by-month export of the productivity data the laboratory has entered into VeritaBench. Each row represents a single calendar month and shows billable test volume, productive and non-productive hours, overtime, total FTEs, and three derived metrics (Productivity Ratio, Overtime Percentage, Productive Percentage). It is intended for internal trending, board reporting, and benchmarking conversations \u2014 not as a personnel evaluation instrument and not as a substitute for a formal time-and-motion study.");
      aboutBlank();
      aboutSection("How to use this workbook");
      aboutBody("The Productivity Data tab is sorted oldest-to-newest so a quick glance shows the trend line for each metric. Productivity Ratio is productive hours divided by billable tests (lower is leaner). OT % is overtime hours as a share of productive hours. Productive % is productive hours divided by total worked hours (productive plus non-productive). Use the auto-filter on row 1 to isolate a year, a facility type, or a month range. Notes capture context the lab director recorded at the time \u2014 staffing changes, instrument downtime, holiday weeks \u2014 and should be read alongside the numeric columns.");
      aboutBlank();
      aboutSection("Disclaimer");
      aboutBody("This workbook is an internal management report, not an audit-grade productivity assessment, not a regulatory submission, and not a substitute for a formal staffing or time-and-motion study. The numbers reflect what the laboratory entered into VeritaBench; VeritaAssure does not validate the underlying timecards, LIS billable-test counts, or FTE allocations. Productivity Ratio, OT %, and Productive % are mechanical formulas applied to the entered values \u2014 they are not benchmarks against an external standard, and a 'good' or 'bad' ratio depends on the lab's test mix, automation level, complexity, and union or contractual rules. This workbook is not a personnel evaluation tool and must not be used to discipline, terminate, or compensate individual employees. The lab director and senior leadership are responsible for staffing decisions, productivity targets, and any operational action taken on the basis of these numbers. VeritaAssure does not certify staffing levels, does not advise on labor law compliance, and does not represent these figures to any accrediting or regulatory body.");
      aboutBlank();
      aboutSection("Lab identity");
      aboutBody(`This workbook was prepared for ${labName} (CLIA ${cliaNumber}). The lab name and CLIA appear on every printed page header and footer.`);
      aboutBlank();
      aboutSection("Coverage gaps");
      aboutBody("If your laboratory needs a productivity metric or column not represented here \u2014 for example, test-mix-weighted CAP workload units, send-out volume, or department-level breakouts \u2014 please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision.");
      about.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaBench Productivity Tracker&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
      about.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
      await about.protect(exportPwd, {
        selectLockedCells: false, selectUnlockedCells: false,
        formatCells: false, formatColumns: false, formatRows: false,
        insertRows: false, insertColumns: false, insertHyperlinks: false,
        deleteRows: false, deleteColumns: false,
        sort: false, autoFilter: false, pivotTables: false,
      });

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

      // Page-setup header/footer carry lab identity on every printed page.
      ws.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaBench Productivity Tracker&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
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

      applyLicenseToExcelJS(wb, bencheLicenseCtx(req));
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
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rows = sqlite.prepare(
      "SELECT * FROM staffing_studies WHERE account_id = ? ORDER BY created_at DESC"
    ).all(accountId);
    res.json(rows);
  });

  // POST /api/staffing-studies - create study
  app.post("/api/staffing-studies", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
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
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const study = sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!study) return res.status(404).json({ error: "Study not found" });
    const data = sqlite.prepare("SELECT * FROM staffing_hourly_data WHERE study_id = ? ORDER BY week_number, day_of_week, hour_slot").all(id);
    res.json({ study, data });
  });

  // POST /api/staffing-studies/:id/data - batch upsert hourly data
  app.post("/api/staffing-studies/:id/data", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
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
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
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
    const demoUser = sqlite.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_USER_EMAIL) as any;
    if (!demoUser) return res.status(404).json({ error: "Demo data not available" });
    const rows = sqlite.prepare(
      "SELECT * FROM productivity_months WHERE account_id = ? ORDER BY year ASC, month ASC"
    ).all(demoUser.id);
    res.json(rows);
  });

  // GET /api/demo/inventory - returns demo account inventory items only
  app.get("/api/demo/inventory", (_req: any, res) => {
    const demoUser = sqlite.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_USER_EMAIL) as any;
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
    const demoUser = sqlite.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_USER_EMAIL) as any;
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

  // Per-item decoration shared by the legacy and lab-scoped list/reorder
  // routes. Single source of truth for ALL inventory math so the list view,
  // reorder PDF, and reorder Excel can never disagree.
  //
  // Math definitions (so future readers don't have to re-derive them):
  //   reorder_point     burn_rate * (lead_time_days + safety_stock_days)
  //                     the threshold at which we flag the item for reorder
  //   order_to_qty      burn_rate * desired_days_of_stock
  //                     the TARGET INVENTORY LEVEL (not "amount to order")
  //   days_remaining    floor(quantity_on_hand / burn_rate)
  //                     days of supply at current burn before stockout.
  //                     Use floor not round so "5d" never means "actually
  //                     4.5d remaining"
  //   shortfall         max(0, order_to_qty - quantity_on_hand)
  //                     how many additional eachs we need to hit target
  //   suggested_order_packs   ceil(shortfall / units_per_order_unit)
  //                     can't order half a box; round UP
  //   delivered_qty           suggested_order_packs * units_per_order_unit
  //                     what we'll ACTUALLY receive. Always >= shortfall;
  //                     overshoot is unavoidable with case-pack packaging
  //   ending_qty              quantity_on_hand + delivered_qty
  //                     inventory level after the order arrives
  //   ending_days             floor(ending_qty / burn_rate)
  //                     days of supply after delivery; sanity check that
  //                     ending_days >= desired_days_of_stock
  function decorateInventoryItem(item: any) {
    const burnRate = item.burn_rate || 0;
    const onHand = item.quantity_on_hand || 0;
    const upu = item.units_per_order_unit || 1;
    const reorderPoint = burnRate * ((item.lead_time_days || 0) + (item.safety_stock_days || 0));
    const orderToQty = burnRate * (item.desired_days_of_stock || 0);
    const daysRemaining = burnRate > 0 ? Math.floor(onHand / burnRate) : null;
    const needsReorder = onHand <= reorderPoint;

    const shortfall = Math.max(0, Math.round(orderToQty) - onHand);
    const suggestedOrderPacks = upu > 1
      ? Math.ceil(shortfall / upu)
      : shortfall;
    const deliveredQty = upu > 1
      ? suggestedOrderPacks * upu
      : shortfall;
    const endingQty = onHand + deliveredQty;
    const endingDays = burnRate > 0 ? Math.floor(endingQty / burnRate) : null;

    return {
      ...item,
      reorder_point: Math.round(reorderPoint),
      order_to_qty: Math.round(orderToQty),
      days_remaining: daysRemaining,
      needs_reorder: needsReorder,
      suggested_order_packs: suggestedOrderPacks,
      delivered_qty: deliveredQty,
      ending_qty: endingQty,
      ending_days: endingDays,
    };
  }

  // Apply optional client-side filters to a decorated reorder list.
  // Filters accepted as query params on the reorder-list endpoints (PDF
  // + Excel + JSON). When provided, the generated document is scoped to
  // matching items only. This is what powers "Order PDF (Fisher)" -- the
  // John (San Carlos) ask from 2026-05-21 where the lab wants to print
  // a vendor-specific list to hand to the rep.
  //
  // Status filter is intentionally not supported -- the reorder endpoint
  // already filters to needs_reorder=true.
  function applyReorderFilters(items: any[], query: any): any[] {
    const department = (query.department || "").trim();
    const category = (query.category || "").trim();
    const vendor = (query.vendor || "").trim();
    return items.filter(it => {
      if (department && it.department !== department) return false;
      if (category && it.category !== category) return false;
      if (vendor && (it.vendor || "") !== vendor) return false;
      return true;
    });
  }

  // Build the filter-context object passed into the PDF/XLSX generators so
  // they can render the FILTERED VIEW banner + reflect scope in the
  // filename. Mirrors applyReorderFilters' inputs.
  function reorderFilterContext(query: any) {
    return {
      filterDepartment: (query.department || "").trim() || null,
      filterCategory: (query.category || "").trim() || null,
      filterVendor: (query.vendor || "").trim() || null,
    };
  }

  // Filename suffix when filters are active. Sanitizes the same way the
  // lab name is sanitized so the output is a safe Windows/Mac filename.
  function reorderFilenameSuffix(query: any): string {
    const vendor = (query.vendor || "").trim();
    const department = (query.department || "").trim();
    const category = (query.category || "").trim();
    const parts: string[] = [];
    if (vendor) parts.push(vendor);
    if (department) parts.push(department);
    if (category) parts.push(category);
    if (parts.length === 0) return "";
    const joined = parts.join("_").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 60);
    return joined ? `_${joined}` : "";
  }

  // GET /api/inventory - list all inventory items for account
  app.get("/api/inventory", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rows = sqlite.prepare(
      "SELECT * FROM inventory_items WHERE account_id = ? ORDER BY item_name ASC"
    ).all(accountId);
    const items = (rows as any[]).map(decorateInventoryItem);
    res.json(items);
  });

  // GET /api/inventory/reorder-list - items currently flagged needs_reorder,
  // grouped by vendor server-side so the client can either render a table
  // or hand the payload straight to the PDF/Excel generator unchanged.
  // The trigger formula lives in decorateInventoryItem above; we filter
  // here rather than recomputing.
  app.get("/api/inventory/reorder-list", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rows = sqlite.prepare(
      "SELECT * FROM inventory_items WHERE account_id = ? ORDER BY item_name ASC"
    ).all(accountId);
    const decorated = (rows as any[]).map(decorateInventoryItem).filter(it => it.needs_reorder);
    const items = applyReorderFilters(decorated, req.query);
    res.json({ items, totalCount: items.length, generatedAt: new Date().toISOString() });
  });

  // POST /api/inventory/reorder-list/pdf - generate a reorder document PDF
  // grouped by vendor with a director signature block. Returns a one-time
  // token the client GETs at /api/pdf/:token (same pattern as the studies
  // PDF flow in routes.ts). The lab identity stamped on the PDF is read
  // fresh from the labs table when the requester has a lab, falling back
  // to the user's clia_lab_name / clia_number for legacy single-lab users.
  app.post("/api/inventory/reorder-list/pdf", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    try {
      const rows = sqlite.prepare(
        "SELECT * FROM inventory_items WHERE account_id = ? ORDER BY item_name ASC"
      ).all(accountId);
      const decorated = (rows as any[]).map(decorateInventoryItem).filter(it => it.needs_reorder);
      const items = applyReorderFilters(decorated, req.query) as ReorderItem[];

      // Pull lab identity for the header. labs table first, user row fallback.
      let labName: string | null = null;
      let cliaNumber: string | null = null;
      let preparedBy: string | null = null;
      const userRow = sqlite.prepare(
        "SELECT name, email, clia_lab_name, clia_number FROM users WHERE id = ?"
      ).get(accountId) as any;
      if (userRow) {
        preparedBy = userRow.name || userRow.email || null;
        labName = userRow.clia_lab_name || null;
        cliaNumber = userRow.clia_number || null;
      }
      const labRow = sqlite.prepare(
        "SELECT lab_name, clia_number FROM labs WHERE owner_user_id = ? LIMIT 1"
      ).get(accountId) as any;
      let labIdForVendors: number | null = null;
      if (labRow) {
        labName = labRow.lab_name || labName;
        cliaNumber = labRow.clia_number || cliaNumber;
      }
      // PR 4 auto-fill: pull stock_vendors records for this lab and pass
      // them into the PDF generator. The renderer looks each vendor
      // section up by name (case-insensitive, single-match substring
      // fallback) and renders a "Send to" panel under the vendor header
      // when a record exists. Labs that haven't populated their vendor
      // directory get the prior behavior (no panel, no regression).
      const userLabRow = sqlite.prepare(
        "SELECT lab_id FROM users WHERE id = ?"
      ).get(accountId) as any;
      labIdForVendors = userLabRow?.lab_id || null;
      const vendorRecords = buildVendorRecordMap(labIdForVendors);

      const pdfBuffer = await generateReorderListPDF(items, { labName, cliaNumber, preparedBy, vendorRecords, ...reorderFilterContext(req.query) });
      const datestamp = new Date().toISOString().slice(0, 10);
      const filename = `VeritaStock_Reorder${reorderFilenameSuffix(req.query)}_${datestamp}.pdf`;
      const token = storePdfToken(pdfBuffer, filename);
      res.json({ token, totalCount: items.length });
    } catch (err: any) {
      console.error("Reorder PDF generation error:", err.message);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // POST /api/inventory/reorder-list/excel - same payload as the PDF route
  // but streams an .xlsx directly. Excel is the format purchasing actually
  // edits before sending to a vendor (Confirmed Qty + Notes columns are the
  // only two left unlocked), so this route does not go through the PDF
  // token store - we return the buffer inline with Content-Disposition.
  app.post("/api/inventory/reorder-list/excel", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    try {
      const rows = sqlite.prepare(
        "SELECT * FROM inventory_items WHERE account_id = ? ORDER BY item_name ASC"
      ).all(accountId);
      const decorated = (rows as any[]).map(decorateInventoryItem).filter(it => it.needs_reorder);
      const items = applyReorderFilters(decorated, req.query) as ReorderItem[];

      let labName: string | null = null;
      let cliaNumber: string | null = null;
      let preparedBy: string | null = null;
      const userRow = sqlite.prepare(
        "SELECT name, email, clia_lab_name, clia_number FROM users WHERE id = ?"
      ).get(accountId) as any;
      if (userRow) {
        preparedBy = userRow.name || userRow.email || null;
        labName = userRow.clia_lab_name || null;
        cliaNumber = userRow.clia_number || null;
      }
      const labRow = sqlite.prepare(
        "SELECT lab_name, clia_number FROM labs WHERE owner_user_id = ? LIMIT 1"
      ).get(accountId) as any;
      if (labRow) {
        labName = labRow.lab_name || labName;
        cliaNumber = labRow.clia_number || cliaNumber;
      }

      const xlsxBuffer = await generateReorderListExcel(items, { labName, cliaNumber, preparedBy, ...reorderFilterContext(req.query) });
      const datestamp = new Date().toISOString().slice(0, 10);
      const filename = `VeritaStock_Reorder${reorderFilenameSuffix(req.query)}_${datestamp}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", xlsxBuffer.length);
      res.send(xlsxBuffer);
    } catch (err: any) {
      console.error("Reorder Excel generation error:", err.message);
      res.status(500).json({ error: "Excel generation failed", detail: err.message });
    }
  });

  // POST /api/inventory/snap-order/pdf - emergency manual-order PDF.
  //
  // Use case: surge events (respiratory outbreak, supply-chain shock) where
  // the lab wants to order quantities that intentionally bypass the
  // calculated reorder thresholds. User enters quantities by hand on the
  // Snap Order screen; this endpoint generates a vendor-grouped PDF with
  // a director signature block, clearly framed as a MANUAL order so the
  // rep doesn't confuse it with the auto-calculated reorder document.
  //
  // Body shape: { items: [{ id: number, snap_qty: number, snap_unit?: string }] }
  // Server fetches each item by id (scoped to account), validates ownership,
  // composes SnapOrderItem rows, and generates the PDF.
  app.post("/api/inventory/snap-order/pdf", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const requestedItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const valid = requestedItems
      .filter((r: any) => typeof r?.id === "number" && typeof r?.snap_qty === "number" && r.snap_qty > 0)
      .map((r: any) => ({ id: Number(r.id), snap_qty: Number(r.snap_qty), snap_unit: typeof r.snap_unit === "string" ? r.snap_unit : null }));
    if (valid.length === 0) {
      return res.status(400).json({ error: "No items with snap_qty > 0 submitted." });
    }
    try {
      const placeholders = valid.map(() => "?").join(",");
      const rows = sqlite.prepare(
        `SELECT * FROM inventory_items WHERE account_id = ? AND id IN (${placeholders})`
      ).all(accountId, ...valid.map((v: any) => v.id)) as any[];

      const byId = new Map<number, any>();
      for (const r of rows) byId.set(r.id, r);

      const items: SnapOrderItem[] = valid
        .map((v: any) => {
          const row = byId.get(v.id);
          if (!row) return null;
          return {
            id: row.id,
            item_name: row.item_name,
            catalog_number: row.catalog_number,
            lot_number: row.lot_number,
            vendor: row.vendor,
            department: row.department,
            unit: row.unit,
            order_unit: row.order_unit,
            quantity_on_hand: row.quantity_on_hand || 0,
            snap_qty: v.snap_qty,
            snap_unit: v.snap_unit || row.order_unit || row.unit || "each",
          } as SnapOrderItem;
        })
        .filter((x: any): x is SnapOrderItem => x !== null);

      if (items.length === 0) {
        return res.status(404).json({ error: "None of the submitted items found for this account." });
      }

      let labName: string | null = null;
      let cliaNumber: string | null = null;
      let preparedBy: string | null = null;
      const userRow = sqlite.prepare(
        "SELECT name, email, clia_lab_name, clia_number FROM users WHERE id = ?"
      ).get(accountId) as any;
      if (userRow) {
        preparedBy = userRow.name || userRow.email || null;
        labName = userRow.clia_lab_name || null;
        cliaNumber = userRow.clia_number || null;
      }
      const labRow = sqlite.prepare(
        "SELECT lab_name, clia_number FROM labs WHERE owner_user_id = ? LIMIT 1"
      ).get(accountId) as any;
      if (labRow) {
        labName = labRow.lab_name || labName;
        cliaNumber = labRow.clia_number || cliaNumber;
      }

      const snapLabRow = sqlite.prepare("SELECT lab_id FROM users WHERE id = ?").get(accountId) as any;
      const pdfBuffer = await generateSnapOrderPDF(items, { labName, cliaNumber, preparedBy, vendorRecords: buildVendorRecordMap(snapLabRow?.lab_id || null) });
      const datestamp = new Date().toISOString().slice(0, 10);
      const filename = `VeritaStock_SnapOrder_${datestamp}.pdf`;
      const token = storePdfToken(pdfBuffer, filename);
      res.json({ token, totalCount: items.length });
    } catch (err: any) {
      console.error("Snap order PDF generation error:", err.message);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // POST /api/inventory/labels/pdf - parking-lot #29 Phase 1.
  //
  // Generate an Avery 5160 sheet of Code 128 barcode labels for inventory
  // items. Two modes:
  //   - body.itemIds: number[]  →  labels for those specific items only
  //   - body.itemIds omitted    →  labels for every item in the account that
  //                                has a non-null barcode_value
  //
  // If a requested item does not yet have a barcode_value, we synthesize a
  // stable VLS- prefix code from the item id so labels render even before
  // Phase 2 wiring assigns "real" barcode values. The synthesized value is
  // NOT persisted - this endpoint is print-only.
  app.post("/api/inventory/labels/pdf", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const requestedIds = Array.isArray(req.body?.itemIds)
      ? req.body.itemIds.filter((x: any) => typeof x === "number" && Number.isFinite(x))
      : null;
    try {
      let rows: any[];
      if (requestedIds && requestedIds.length > 0) {
        const placeholders = requestedIds.map(() => "?").join(",");
        rows = sqlite.prepare(
          `SELECT id, item_name, catalog_number, lot_number, storage_location, barcode_value FROM inventory_items WHERE account_id = ? AND id IN (${placeholders}) ORDER BY item_name ASC`
        ).all(accountId, ...requestedIds) as any[];
      } else {
        // Print labels for every item in the account. Items without a
        // bound barcode_value get a synthesized VLS-<id> placeholder
        // below (see labels.map). The whole point of the placeholder
        // is to let the lab print labels BEFORE assigning barcodes,
        // so the previous "WHERE barcode_value IS NOT NULL" filter
        // was directly contradicting that path; dropped 2026-05-29.
        rows = sqlite.prepare(
          "SELECT id, item_name, catalog_number, lot_number, storage_location, barcode_value FROM inventory_items WHERE account_id = ? ORDER BY item_name ASC"
        ).all(accountId) as any[];
      }
      if (rows.length === 0) {
        return res.status(404).json({ error: "No inventory items found in this account. Add at least one item before printing labels." });
      }

      const labels: BarcodeLabelInput[] = rows.map((r) => ({
        barcodeValue: (r.barcode_value && String(r.barcode_value).trim().length > 0)
          ? String(r.barcode_value)
          : `VLS-${String(r.id).padStart(8, "0")}`,
        itemName: r.item_name || "(unnamed)",
        catalogNumber: r.catalog_number,
        lotNumber: r.lot_number,
        storageLocation: r.storage_location,
      }));

      // Lab identity (footer text on the sheet).
      let labName: string | null = null;
      let cliaNumber: string | null = null;
      const userRow = sqlite.prepare(
        "SELECT clia_lab_name, clia_number FROM users WHERE id = ?"
      ).get(accountId) as any;
      if (userRow) {
        labName = userRow.clia_lab_name || null;
        cliaNumber = userRow.clia_number || null;
      }
      const labRow = sqlite.prepare(
        "SELECT lab_name, clia_number FROM labs WHERE owner_user_id = ? LIMIT 1"
      ).get(accountId) as any;
      if (labRow) {
        labName = labRow.lab_name || labName;
        cliaNumber = labRow.clia_number || cliaNumber;
      }

      const pdfBuffer = await generateBarcodeLabelSheetPdf(labels, { labName, cliaNumber });
      const datestamp = new Date().toISOString().slice(0, 10);
      const filename = `VeritaStock_Labels_${datestamp}.pdf`;
      const token = storePdfToken(pdfBuffer, filename);
      res.json({ token, totalCount: labels.length });
    } catch (err: any) {
      console.error("Barcode label PDF generation error:", err.message);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // POST /api/inventory/count-sheet/excel - Inventory Count workbook.
  //
  // Designed for the periodic physical inventory: counter walks the
  // shelves with the printed workbook (or a tablet open to it),
  // writing counted quantities next to system quantities. Sheet is
  // protected so identity / system columns cannot be edited; only
  // the counter-input columns (Counted Qty, Counted By, Count Date,
  // Notes) are unlocked. Discrepancy is an in-cell formula that
  // populates when Counted Qty is entered.
  //
  // Filters: department / category / vendor — same query-param
  // shape as the reorder routes — so the user can produce a
  // Chemistry-only or a Bio-Rad-only count sheet.
  //
  // Streamed inline (no PDF token store) because the workbook is
  // edited by the counter; the binary is the deliverable.
  app.post("/api/inventory/count-sheet/excel", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    try {
      const rows = sqlite.prepare(
        "SELECT * FROM inventory_items WHERE account_id = ? ORDER BY item_name ASC"
      ).all(accountId);
      const filtered = applyReorderFilters(rows as any[], req.query);
      if (filtered.length === 0) {
        return res.status(404).json({ error: "No inventory items in the current scope. Clear filters or add items before generating a count sheet." });
      }
      const items: InventoryCountItem[] = filtered.map((r: any) => ({
        storage_location: r.storage_location,
        department: r.department,
        item_name: r.item_name,
        category: r.category,
        catalog_number: r.catalog_number,
        lot_number: r.lot_number,
        expiration_date: r.expiration_date,
        vendor: r.vendor,
        quantity_on_hand: Number(r.quantity_on_hand ?? 0),
        unit: r.unit ?? r.usage_unit ?? null,
      }));

      let labName: string | null = null;
      let cliaNumber: string | null = null;
      let preparedBy: string | null = null;
      const userRow = sqlite.prepare(
        "SELECT name, email, clia_lab_name, clia_number FROM users WHERE id = ?"
      ).get(accountId) as any;
      if (userRow) {
        preparedBy = userRow.name || userRow.email || null;
        labName = userRow.clia_lab_name || null;
        cliaNumber = userRow.clia_number || null;
      }
      const labRow = sqlite.prepare(
        "SELECT lab_name, clia_number FROM labs WHERE owner_user_id = ? LIMIT 1"
      ).get(accountId) as any;
      if (labRow) {
        labName = labRow.lab_name || labName;
        cliaNumber = labRow.clia_number || cliaNumber;
      }

      const ctxFilters = reorderFilterContext(req.query);
      const filterLabelParts: string[] = [];
      if (ctxFilters.filterDepartment) filterLabelParts.push(ctxFilters.filterDepartment);
      if (ctxFilters.filterCategory) filterLabelParts.push(ctxFilters.filterCategory);
      if (ctxFilters.filterVendor) filterLabelParts.push(ctxFilters.filterVendor);
      const filterLabel = filterLabelParts.length > 0 ? filterLabelParts.join(" / ") : null;

      const xlsxBuffer = await generateInventoryCountExcel(items, { labName, cliaNumber, preparedBy, filterLabel });
      const datestamp = new Date().toISOString().slice(0, 10);
      const filename = `VeritaStock_Count${reorderFilenameSuffix(req.query)}_${datestamp}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", xlsxBuffer.length);
      res.send(xlsxBuffer);
    } catch (err: any) {
      console.error("Inventory count workbook generation error:", err.message);
      res.status(500).json({ error: "Workbook generation failed", detail: err.message });
    }
  });

  // POST /api/inventory/scan - parking-lot #29 Phase 2.
  //
  // Record a barcode scan event and (optionally) adjust the bound
  // inventory item's quantity_on_hand. All scans are logged to
  // scan_events for audit, including unknown-barcode misses.
  //
  // Body:
  //   { barcode_value: string (required, trimmed),
  //     action?: "decrement" | "increment" | "lookup_only" | "correction",
  //     quantity_delta?: number  (only honored for action="correction";
  //                               must be a finite integer, signed),
  //     notes?: string }
  //
  // Defaults: action="decrement", quantity_delta=-1 for decrement,
  // +1 for increment, 0 for lookup_only.
  //
  // Response on hit:
  //   { ok: true, action, item, scan_event_id, quantity_before,
  //     quantity_after, needs_reorder, reorder_point, order_to_qty }
  // Response on miss (404, but scan still logged):
  //   { ok: false, action: "unknown_barcode", scan_event_id, barcode_value }
  //
  // The whole SELECT-UPDATE-INSERT runs in a sqlite transaction so two
  // concurrent scans of the same barcode can't read stale quantities.
  app.post("/api/inventory/scan", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rawBarcode = req.body?.barcode_value;
    const requestedAction = req.body?.action ?? "decrement";
    const correctionDelta = Number(req.body?.quantity_delta);
    const notes = typeof req.body?.notes === "string" ? req.body.notes : null;
    if (typeof rawBarcode !== "string" || rawBarcode.trim() === "") {
      return res.status(400).json({ error: "barcode_value is required and must be a non-empty string." });
    }
    const ALLOWED_ACTIONS = ["decrement", "increment", "lookup_only", "correction"] as const;
    if (!(ALLOWED_ACTIONS as readonly string[]).includes(requestedAction)) {
      return res.status(400).json({ error: `action must be one of ${ALLOWED_ACTIONS.join(", ")}` });
    }
    if (requestedAction === "correction" && !Number.isFinite(correctionDelta)) {
      return res.status(400).json({ error: "action=correction requires a finite quantity_delta number." });
    }
    const barcode = rawBarcode.trim();
    const ipRaw = (req?.ip || req?.headers?.["x-forwarded-for"] || "").toString();
    const ip = ipRaw ? ipRaw.split(",")[0].trim() : null;
    const ua = typeof req?.headers?.["user-agent"] === "string" ? (req.headers["user-agent"] as string).slice(0, 500) : null;
    const userId = req.userId;
    try {
      const txn = sqlite.transaction(() => {
        const row = sqlite.prepare(
          "SELECT * FROM inventory_items WHERE account_id = ? AND barcode_value IS NOT NULL AND barcode_value = ?"
        ).get(accountId, barcode) as any;
        if (!row) {
          const ins = sqlite.prepare(`
            INSERT INTO scan_events (account_id, inventory_item_id, user_id, action, quantity_delta, quantity_before, quantity_after, barcode_value, notes, ip_address, user_agent)
            VALUES (?, NULL, ?, 'unknown_barcode', NULL, NULL, NULL, ?, ?, ?, ?)
          `).run(accountId, userId, barcode, notes, ip, ua);
          return { hit: false as const, scanEventId: Number(ins.lastInsertRowid) };
        }
        const qtyBefore = Number(row.quantity_on_hand ?? 0);
        let delta = 0;
        if (requestedAction === "decrement") delta = -1;
        else if (requestedAction === "increment") delta = 1;
        else if (requestedAction === "lookup_only") delta = 0;
        else if (requestedAction === "correction") delta = Math.trunc(correctionDelta);
        const qtyAfter = Math.max(0, qtyBefore + delta);
        // Recompute the actual signed delta we'll record (zero-clamp can
        // make the stored delta smaller in magnitude than the requested
        // delta on a decrement past zero).
        const actualDelta = qtyAfter - qtyBefore;
        if (requestedAction !== "lookup_only" && actualDelta !== 0) {
          const now = new Date().toISOString();
          sqlite.prepare(
            "UPDATE inventory_items SET quantity_on_hand = ?, updated_at = ? WHERE id = ? AND account_id = ?"
          ).run(qtyAfter, now, row.id, accountId);
        }
        const ins = sqlite.prepare(`
          INSERT INTO scan_events (account_id, inventory_item_id, user_id, action, quantity_delta, quantity_before, quantity_after, barcode_value, notes, ip_address, user_agent)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(accountId, row.id, userId, requestedAction, actualDelta, qtyBefore, qtyAfter, barcode, notes, ip, ua);
        return { hit: true as const, scanEventId: Number(ins.lastInsertRowid), itemId: row.id, qtyBefore, qtyAfter };
      });
      const result = txn();
      if (!result.hit) {
        return res.status(404).json({ ok: false, action: "unknown_barcode", scan_event_id: result.scanEventId, barcode_value: barcode });
      }
      const fresh = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(result.itemId) as any;
      const decorated = decorateInventoryItem(fresh);
      return res.json({
        ok: true,
        action: requestedAction,
        item: decorated,
        scan_event_id: result.scanEventId,
        quantity_before: result.qtyBefore,
        quantity_after: result.qtyAfter,
        needs_reorder: !!decorated.needs_reorder,
        reorder_point: decorated.reorder_point ?? null,
        order_to_qty: decorated.order_to_qty ?? null,
      });
    } catch (err: any) {
      console.error("Scan endpoint error:", err.message);
      return res.status(500).json({ error: "Scan failed", detail: err.message });
    }
  });

  // POST /api/inventory - create new inventory item
  app.post("/api/inventory", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { item_name, catalog_number, lot_number, department, category, quantity_on_hand, unit, expiration_date, vendor, storage_location, notes, status, burn_rate, order_unit, usage_unit, units_per_order_unit, lead_time_days, safety_stock_days, desired_days_of_stock, standing_order, standing_order_review_date } = req.body;
    if (!item_name) return res.status(400).json({ error: "item_name is required" });
    const now = new Date().toISOString();
    try {
      const result = sqlite.prepare(`
        INSERT INTO inventory_items (account_id, item_name, catalog_number, lot_number, department, category, quantity_on_hand, unit, expiration_date, vendor, storage_location, notes, status, burn_rate, order_unit, usage_unit, units_per_order_unit, lead_time_days, safety_stock_days, desired_days_of_stock, standing_order, standing_order_review_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(accountId, item_name, catalog_number ?? null, lot_number ?? null, department ?? 'Core Lab', category ?? 'Reagent', quantity_on_hand ?? 0, unit ?? 'each', expiration_date ?? null, vendor ?? null, storage_location ?? null, notes ?? null, status ?? 'active', burn_rate ?? 0, order_unit ?? 'each', usage_unit ?? 'each', units_per_order_unit ?? 1, lead_time_days ?? 5, safety_stock_days ?? 3, desired_days_of_stock ?? 30, standing_order ?? 0, standing_order_review_date ?? null, now, now);
      // Phase 3.11 dual-write lab_id from the owning user's lab.
      try {
        sqlite.prepare("UPDATE inventory_items SET lab_id = (SELECT lab_id FROM users WHERE id = ?) WHERE id = ?").run(accountId, result.lastInsertRowid);
      } catch {}
      // Persist canonical barcode_value (VLS-<padded id>) at creation so
      // the label code never changes across runtime/algorithm shifts. Gated
      // by the WHERE clause so a user-supplied value (added via a future
      // edit endpoint) is preserved.
      try {
        sqlite.prepare("UPDATE inventory_items SET barcode_value = 'VLS-' || printf('%08d', id) WHERE id = ? AND (barcode_value IS NULL OR barcode_value = '')").run(result.lastInsertRowid);
      } catch {}
      const row = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(Number(result.lastInsertRowid));
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/inventory/:id - update an inventory item
  app.put("/api/inventory/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const existing = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!existing) return res.status(404).json({ error: "Item not found" });
    const { item_name, catalog_number, lot_number, department, category, quantity_on_hand, unit, expiration_date, vendor, storage_location, notes, status, burn_rate, order_unit, usage_unit, units_per_order_unit, lead_time_days, safety_stock_days, desired_days_of_stock, standing_order, standing_order_review_date, barcode_value } = req.body;
    const now = new Date().toISOString();
    // parking-lot #29 Phase 2: normalize the incoming barcode_value.
    // "" or whitespace -> NULL (clears the binding). Anything else is
    // trimmed and account-scope-uniqueness-checked before write.
    let normalizedBarcode: string | null;
    if (barcode_value === undefined) {
      normalizedBarcode = (existing as any).barcode_value ?? null;
    } else if (barcode_value === null || (typeof barcode_value === "string" && barcode_value.trim() === "")) {
      normalizedBarcode = null;
    } else {
      normalizedBarcode = String(barcode_value).trim();
      const collision = sqlite.prepare(
        "SELECT id FROM inventory_items WHERE account_id = ? AND barcode_value = ? AND id <> ?"
      ).get(accountId, normalizedBarcode, id) as any;
      if (collision) {
        return res.status(409).json({ error: `Barcode "${normalizedBarcode}" is already bound to a different item in this account.` });
      }
    }
    try {
      sqlite.prepare(`
        UPDATE inventory_items SET item_name = ?, catalog_number = ?, lot_number = ?, department = ?, category = ?, quantity_on_hand = ?, unit = ?, expiration_date = ?, vendor = ?, storage_location = ?, notes = ?, status = ?, burn_rate = ?, order_unit = ?, usage_unit = ?, units_per_order_unit = ?, lead_time_days = ?, safety_stock_days = ?, desired_days_of_stock = ?, standing_order = ?, standing_order_review_date = ?, barcode_value = ?, updated_at = ?
        WHERE id = ? AND account_id = ?
      `).run(item_name ?? (existing as any).item_name, catalog_number ?? null, lot_number ?? null, department ?? 'Core Lab', category ?? 'Reagent', quantity_on_hand ?? 0, unit ?? 'each', expiration_date ?? null, vendor ?? null, storage_location ?? null, notes ?? null, status ?? 'active', burn_rate ?? 0, order_unit ?? 'each', usage_unit ?? 'each', units_per_order_unit ?? 1, lead_time_days ?? 5, safety_stock_days ?? 3, desired_days_of_stock ?? 30, standing_order ?? 0, standing_order_review_date ?? null, normalizedBarcode, now, id, accountId);
      const row = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(id);
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/inventory/:id - delete an inventory item
  app.delete("/api/inventory/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const row = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!row) return res.status(404).json({ error: "Item not found" });
    sqlite.prepare("DELETE FROM inventory_items WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // GET /api/staffing-studies/:id/export - Excel export of analysis
  app.get("/api/staffing-studies/:id/export", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const study = sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ? AND account_id = ?").get(id, accountId) as any;
    if (!study) return res.status(404).json({ error: "Study not found" });
    const data = sqlite.prepare("SELECT * FROM staffing_hourly_data WHERE study_id = ?").all(id) as any[];

    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      wb.creator = "Perplexity Computer";
      wb.created = new Date();

      // ===== Lab identity (Excel Export Standard) =====
      const ownerRow = sqlite.prepare(
        "SELECT clia_lab_name, clia_number, name FROM users WHERE id = ?"
      ).get(accountId) as any;
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
      aboutTitle.value = `VeritaBench Staffing Analyzer \u2014 ${study.name}`;
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
      aboutBody("This workbook is the analysis output of a VeritaBench Staffing Analyzer study. The lab recorded specimen-receipt and result-verification volumes hour-by-hour and day-by-day; the Averages tab shows the mean specimens received and results verified for each of the 168 hour-of-week slots (24 hours \u00d7 7 days), averaged across every observation week the study contains. It is a workload-shape report intended to inform shift design, bench coverage, and break scheduling \u2014 not an FTE entitlement calculation, not a CAP workload-unit study, and not a personnel evaluation tool.");
      aboutBlank();
      aboutSection("How to use this workbook");
      aboutBody("The Averages tab is laid out with 24 rows (one per hour slot, midnight at the top) and 14 day columns: the first 7 are average specimens Received per hour, the second 7 are average results Verified per hour. Read across a row to see how a single hour-of-day compares Monday-through-Sunday; read down a column to see how a single weekday's volume curve looks. Pair the Received and Verified columns to identify lag (high receipt volume followed by delayed verification) or pile-up risk. The freeze pane keeps the Hour Slot column visible while you scroll across the 14 day columns.");
      aboutBlank();
      aboutSection("Disclaimer");
      aboutBody("This workbook is an internal staffing-shape analysis, not an audit-grade staffing study, not a CAP/CLIA-required workload assessment, and not a substitute for a formal time-and-motion or productivity engineering study. The averages reflect only the hours and days the lab entered into VeritaBench for this study; gaps, holiday weeks, instrument outages, and short-staffed weeks are baked into the averages and are not corrected for. Specimen-receipt and result-verification counts are not equivalent to actual hands-on work time \u2014 they are volume proxies. This workbook is not a personnel evaluation tool and must not be used to discipline, terminate, or compensate individual employees, nor to justify reductions in force. The lab director and senior leadership are responsible for shift design, FTE allocation, and any operational action taken on the basis of these numbers. VeritaAssure does not certify staffing levels, does not advise on labor or scheduling law, and does not represent these figures to any accrediting or regulatory body.");
      aboutBlank();
      aboutSection("Lab identity");
      aboutBody(`This workbook was prepared for ${labName} (CLIA ${cliaNumber}). The lab name and CLIA appear on every printed page header and footer.`);
      aboutBlank();
      aboutSection("Coverage gaps");
      aboutBody("If your laboratory needs additional metrics in this analysis \u2014 for example, send-out volumes, STAT vs routine separation, instrument-level breakouts, or 15-minute granularity \u2014 please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision.");
      about.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaBench Staffing Analyzer&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
      about.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
      await about.protect(exportPwd, {
        selectLockedCells: false, selectUnlockedCells: false,
        formatCells: false, formatColumns: false, formatRows: false,
        insertRows: false, insertColumns: false, insertHyperlinks: false,
        deleteRows: false, deleteColumns: false,
        sort: false, autoFilter: false, pivotTables: false,
      });

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

      // Page-setup header/footer carry lab identity on every printed page.
      wsAvg.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaBench Staffing Analyzer \u2014 ${study.name}&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
      wsAvg.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;

      await wsAvg.protect(exportPwd, {
        selectLockedCells: true, selectUnlockedCells: true,
        formatCells: false, formatColumns: false, formatRows: false,
        insertRows: false, insertColumns: false, insertHyperlinks: false,
        deleteRows: false, deleteColumns: false,
        sort: false, autoFilter: true, pivotTables: false,
      });

      // Workbook opens to the About sheet (sheet 1, activeTab 0).
      wb.views = [{ x: 0, y: 0, width: 10000, height: 20000,
                    firstSheet: 0, activeTab: 0, visibility: "visible" }];

      applyLicenseToExcelJS(wb, bencheLicenseCtx(req));
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
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rows = sqlite.prepare(
      "SELECT * FROM pi_departments WHERE account_id = ? ORDER BY sort_order ASC, id ASC"
    ).all(accountId);
    res.json(rows);
  });

  // POST /api/pi/departments - create department
  app.post("/api/pi/departments", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
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
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
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
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
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
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
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
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
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
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
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
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
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
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
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
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
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
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const row = sqlite.prepare("SELECT * FROM pi_entries WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!row) return res.status(404).json({ error: "Entry not found" });
    sqlite.prepare("DELETE FROM pi_entries WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // GET /api/pi/dashboard - computed dashboard data
  app.get("/api/pi/dashboard", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
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

  // ── MULTI-LAB Tier 2 — Phase 3.11b: lab-scoped VeritaStock endpoints ───────
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (labScopeMiddleware) {
    app.get("/api/labs/:labId/inventory", authMiddleware, labScopeMiddleware, (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const rows = sqlite.prepare(
        "SELECT * FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
      ).all(req.scope.labId);
      const items = (rows as any[]).map(decorateInventoryItem);
      res.json(items);
    });

    // GET /api/labs/:labId/inventory/reorder-list — lab-scoped reorder list.
    // Same shape as the legacy /api/inventory/reorder-list above; gated on
    // the active lab membership rather than account_id.
    app.get("/api/labs/:labId/inventory/reorder-list", authMiddleware, labScopeMiddleware, (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const rows = sqlite.prepare(
        "SELECT * FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
      ).all(req.scope.labId);
      const decorated = (rows as any[]).map(decorateInventoryItem).filter(it => it.needs_reorder);
      const items = applyReorderFilters(decorated, req.query);
      res.json({ items, totalCount: items.length, generatedAt: new Date().toISOString() });
    });

    // POST /api/labs/:labId/inventory/reorder-list/pdf — lab-scoped reorder
    // document PDF. Lab identity comes from the labs table for THIS labId
    // (not the requester's default lab), so a user with memberships on
    // multiple labs gets a correctly stamped header per lab.
    app.post("/api/labs/:labId/inventory/reorder-list/pdf", authMiddleware, labScopeMiddleware, async (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      try {
        const rows = sqlite.prepare(
          "SELECT * FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
        ).all(req.scope.labId);
        const decorated = (rows as any[]).map(decorateInventoryItem).filter(it => it.needs_reorder);
        const items = applyReorderFilters(decorated, req.query) as ReorderItem[];

        const labRow = sqlite.prepare(
          "SELECT lab_name, clia_number FROM labs WHERE id = ?"
        ).get(req.scope.labId) as any;
        const userRow = sqlite.prepare(
          "SELECT name, email FROM users WHERE id = ?"
        ).get(req.userId) as any;

        const pdfBuffer = await generateReorderListPDF(items, {
          labName: labRow?.lab_name || null,
          cliaNumber: labRow?.clia_number || null,
          preparedBy: userRow?.name || userRow?.email || null,
          vendorRecords: buildVendorRecordMap(req.scope.labId),
          ...reorderFilterContext(req.query),
        });
        const datestamp = new Date().toISOString().slice(0, 10);
        const safeLab = (labRow?.lab_name || "Lab").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
        const filename = `VeritaStock_Reorder_${safeLab}${reorderFilenameSuffix(req.query)}_${datestamp}.pdf`;
        const token = storePdfToken(pdfBuffer, filename);
        res.json({ token, totalCount: items.length });
      } catch (err: any) {
        console.error("Reorder PDF generation error (lab-scoped):", err.message);
        res.status(500).json({ error: "PDF generation failed", detail: err.message });
      }
    });

    // POST /api/labs/:labId/inventory/reorder-list/excel — lab-scoped Excel
    // variant. Same shape as the legacy /api/inventory/reorder-list/excel
    // above; differs only in how the lab identity for the header is read
    // (this labId, not the requester's default lab).
    app.post("/api/labs/:labId/inventory/reorder-list/excel", authMiddleware, labScopeMiddleware, async (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      try {
        const rows = sqlite.prepare(
          "SELECT * FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
        ).all(req.scope.labId);
        const decorated = (rows as any[]).map(decorateInventoryItem).filter(it => it.needs_reorder);
        const items = applyReorderFilters(decorated, req.query) as ReorderItem[];

        const labRow = sqlite.prepare(
          "SELECT lab_name, clia_number FROM labs WHERE id = ?"
        ).get(req.scope.labId) as any;
        const userRow = sqlite.prepare(
          "SELECT name, email FROM users WHERE id = ?"
        ).get(req.userId) as any;

        const xlsxBuffer = await generateReorderListExcel(items, {
          labName: labRow?.lab_name || null,
          cliaNumber: labRow?.clia_number || null,
          preparedBy: userRow?.name || userRow?.email || null,
          ...reorderFilterContext(req.query),
        });
        const datestamp = new Date().toISOString().slice(0, 10);
        const safeLab = (labRow?.lab_name || "Lab").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
        const filename = `VeritaStock_Reorder_${safeLab}${reorderFilenameSuffix(req.query)}_${datestamp}.xlsx`;
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", xlsxBuffer.length);
        res.send(xlsxBuffer);
      } catch (err: any) {
        console.error("Reorder Excel generation error (lab-scoped):", err.message);
        res.status(500).json({ error: "Excel generation failed", detail: err.message });
      }
    });

    // POST /api/labs/:labId/inventory/count-sheet/excel — lab-scoped
    // Inventory Count workbook. Same shape as the legacy
    // /api/inventory/count-sheet/excel above; differs only in how items
    // are scoped (lab_id, not account_id) and where lab identity is read
    // (the labs row for this labId, not the requester's default lab).
    app.post("/api/labs/:labId/inventory/count-sheet/excel", authMiddleware, labScopeMiddleware, async (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      try {
        const rows = sqlite.prepare(
          "SELECT * FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
        ).all(req.scope.labId);
        const filtered = applyReorderFilters(rows as any[], req.query);
        if (filtered.length === 0) {
          return res.status(404).json({ error: "No inventory items in the current scope. Clear filters or add items before generating a count sheet." });
        }
        const items: InventoryCountItem[] = filtered.map((r: any) => ({
          storage_location: r.storage_location,
          department: r.department,
          item_name: r.item_name,
          category: r.category,
          catalog_number: r.catalog_number,
          lot_number: r.lot_number,
          expiration_date: r.expiration_date,
          vendor: r.vendor,
          quantity_on_hand: Number(r.quantity_on_hand ?? 0),
          unit: r.unit ?? r.usage_unit ?? null,
        }));

        const labRow = sqlite.prepare(
          "SELECT lab_name, clia_number FROM labs WHERE id = ?"
        ).get(req.scope.labId) as any;
        const userRow = sqlite.prepare(
          "SELECT name, email FROM users WHERE id = ?"
        ).get(req.userId) as any;

        const ctxFilters = reorderFilterContext(req.query);
        const filterLabelParts: string[] = [];
        if (ctxFilters.filterDepartment) filterLabelParts.push(ctxFilters.filterDepartment);
        if (ctxFilters.filterCategory) filterLabelParts.push(ctxFilters.filterCategory);
        if (ctxFilters.filterVendor) filterLabelParts.push(ctxFilters.filterVendor);
        const filterLabel = filterLabelParts.length > 0 ? filterLabelParts.join(" / ") : null;

        const xlsxBuffer = await generateInventoryCountExcel(items, {
          labName: labRow?.lab_name || null,
          cliaNumber: labRow?.clia_number || null,
          preparedBy: userRow?.name || userRow?.email || null,
          filterLabel,
        });
        const datestamp = new Date().toISOString().slice(0, 10);
        const safeLab = (labRow?.lab_name || "Lab").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
        const filename = `VeritaStock_Count_${safeLab}${reorderFilenameSuffix(req.query)}_${datestamp}.xlsx`;
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", xlsxBuffer.length);
        res.send(xlsxBuffer);
      } catch (err: any) {
        console.error("Inventory count workbook generation error (lab-scoped):", err.message);
        res.status(500).json({ error: "Workbook generation failed", detail: err.message });
      }
    });

    // POST /api/labs/:labId/inventory/labels/pdf — lab-scoped barcode label
    // sheet. Same shape as the legacy /api/inventory/labels/pdf above; differs
    // only in how items are scoped (lab_id, not account_id) and where lab
    // identity is read (the labs row for THIS labId). Fixes the cross-lab
    // bleed where items added under a seat user (account_id != owner.id) were
    // invisible to the legacy endpoint's account-scoped query, producing a
    // partial label sheet that looked like "only one label printed when the
    // lab has many items." Same bug class as the count-sheet lab-scoping fix
    // above. (2026-06-04, customer report on Michaels Lab.)
    app.post("/api/labs/:labId/inventory/labels/pdf", authMiddleware, labScopeMiddleware, async (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const requestedIds = Array.isArray(req.body?.itemIds)
        ? req.body.itemIds.filter((x: any) => typeof x === "number" && Number.isFinite(x))
        : null;
      try {
        let rows: any[];
        if (requestedIds && requestedIds.length > 0) {
          const placeholders = requestedIds.map(() => "?").join(",");
          rows = sqlite.prepare(
            `SELECT id, item_name, catalog_number, lot_number, storage_location, barcode_value FROM inventory_items WHERE lab_id = ? AND id IN (${placeholders}) ORDER BY item_name ASC`
          ).all(req.scope.labId, ...requestedIds) as any[];
        } else {
          rows = sqlite.prepare(
            "SELECT id, item_name, catalog_number, lot_number, storage_location, barcode_value FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
          ).all(req.scope.labId) as any[];
        }
        if (rows.length === 0) {
          return res.status(404).json({ error: "No inventory items in this lab. Add at least one item before printing labels." });
        }

        const labels: BarcodeLabelInput[] = rows.map((r) => ({
          barcodeValue: (r.barcode_value && String(r.barcode_value).trim().length > 0)
            ? String(r.barcode_value)
            : `VLS-${String(r.id).padStart(8, "0")}`,
          itemName: r.item_name || "(unnamed)",
          catalogNumber: r.catalog_number,
          lotNumber: r.lot_number,
          storageLocation: r.storage_location,
        }));

        const labRow = sqlite.prepare(
          "SELECT lab_name, clia_number FROM labs WHERE id = ?"
        ).get(req.scope.labId) as any;
        const labName: string | null = labRow?.lab_name || null;
        const cliaNumber: string | null = labRow?.clia_number || null;

        const pdfBuffer = await generateBarcodeLabelSheetPdf(labels, { labName, cliaNumber });
        const datestamp = new Date().toISOString().slice(0, 10);
        const filename = `VeritaStock_Labels_${datestamp}.pdf`;
        const token = storePdfToken(pdfBuffer, filename);
        res.json({ token, totalCount: labels.length });
      } catch (err: any) {
        console.error("Barcode label PDF generation error (lab-scoped):", err.message);
        res.status(500).json({ error: "PDF generation failed", detail: err.message });
      }
    });

    // POST /api/labs/:labId/inventory/snap-order/pdf — lab-scoped snap order
    // PDF. Same shape as the legacy variant; differs only in how items are
    // scoped (by lab_id rather than account_id) and where the lab identity
    // header comes from (the labs row for THIS labId).
    app.post("/api/labs/:labId/inventory/snap-order/pdf", authMiddleware, labScopeMiddleware, async (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const requestedItems = Array.isArray(req.body?.items) ? req.body.items : [];
      const valid = requestedItems
        .filter((r: any) => typeof r?.id === "number" && typeof r?.snap_qty === "number" && r.snap_qty > 0)
        .map((r: any) => ({ id: Number(r.id), snap_qty: Number(r.snap_qty), snap_unit: typeof r.snap_unit === "string" ? r.snap_unit : null }));
      if (valid.length === 0) {
        return res.status(400).json({ error: "No items with snap_qty > 0 submitted." });
      }
      try {
        const placeholders = valid.map(() => "?").join(",");
        const rows = sqlite.prepare(
          `SELECT * FROM inventory_items WHERE lab_id = ? AND id IN (${placeholders})`
        ).all(req.scope.labId, ...valid.map((v: any) => v.id)) as any[];

        const byId = new Map<number, any>();
        for (const r of rows) byId.set(r.id, r);

        const items: SnapOrderItem[] = valid
          .map((v: any) => {
            const row = byId.get(v.id);
            if (!row) return null;
            return {
              id: row.id,
              item_name: row.item_name,
              catalog_number: row.catalog_number,
              lot_number: row.lot_number,
              vendor: row.vendor,
              department: row.department,
              unit: row.unit,
              order_unit: row.order_unit,
              quantity_on_hand: row.quantity_on_hand || 0,
              snap_qty: v.snap_qty,
              snap_unit: v.snap_unit || row.order_unit || row.unit || "each",
            } as SnapOrderItem;
          })
          .filter((x: any): x is SnapOrderItem => x !== null);

        if (items.length === 0) {
          return res.status(404).json({ error: "None of the submitted items found in this lab." });
        }

        const labRow = sqlite.prepare(
          "SELECT lab_name, clia_number FROM labs WHERE id = ?"
        ).get(req.scope.labId) as any;
        const userRow = sqlite.prepare(
          "SELECT name, email FROM users WHERE id = ?"
        ).get(req.userId) as any;

        const pdfBuffer = await generateSnapOrderPDF(items, {
          labName: labRow?.lab_name || null,
          cliaNumber: labRow?.clia_number || null,
          preparedBy: userRow?.name || userRow?.email || null,
          vendorRecords: buildVendorRecordMap(req.scope.labId),
        });
        const datestamp = new Date().toISOString().slice(0, 10);
        const safeLab = (labRow?.lab_name || "Lab").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
        const filename = `VeritaStock_SnapOrder_${safeLab}_${datestamp}.pdf`;
        const token = storePdfToken(pdfBuffer, filename);
        res.json({ token, totalCount: items.length });
      } catch (err: any) {
        console.error("Snap order PDF generation error (lab-scoped):", err.message);
        res.status(500).json({ error: "PDF generation failed", detail: err.message });
      }
    });

    app.post("/api/labs/:labId/inventory", authMiddleware, labScopeMiddleware, requireWriteAccess, (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const { item_name, catalog_number, lot_number, department, category, quantity_on_hand, unit, expiration_date, vendor, storage_location, notes, status, burn_rate, order_unit, usage_unit, units_per_order_unit, lead_time_days, safety_stock_days, desired_days_of_stock, standing_order, standing_order_review_date } = req.body;
      if (!item_name) return res.status(400).json({ error: "item_name is required" });
      const ownerRow = sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(req.scope.labId) as any;
      const accountId = ownerRow?.owner_user_id ?? req.userId;
      const now = new Date().toISOString();
      try {
        const result = sqlite.prepare(`
          INSERT INTO inventory_items (account_id, lab_id, item_name, catalog_number, lot_number, department, category, quantity_on_hand, unit, expiration_date, vendor, storage_location, notes, status, burn_rate, order_unit, usage_unit, units_per_order_unit, lead_time_days, safety_stock_days, desired_days_of_stock, standing_order, standing_order_review_date, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(accountId, req.scope.labId, item_name, catalog_number ?? null, lot_number ?? null, department ?? 'Core Lab', category ?? 'Reagent', quantity_on_hand ?? 0, unit ?? 'each', expiration_date ?? null, vendor ?? null, storage_location ?? null, notes ?? null, status ?? 'active', burn_rate ?? 0, order_unit ?? 'each', usage_unit ?? 'each', units_per_order_unit ?? 1, lead_time_days ?? 5, safety_stock_days ?? 3, desired_days_of_stock ?? 30, standing_order ?? 0, standing_order_review_date ?? null, now, now);
        // Persist canonical barcode_value (VLS-<padded id>) at creation so
        // the label code never changes across runtime/algorithm shifts.
        try {
          sqlite.prepare("UPDATE inventory_items SET barcode_value = 'VLS-' || printf('%08d', id) WHERE id = ? AND (barcode_value IS NULL OR barcode_value = '')").run(result.lastInsertRowid);
        } catch {}
        const row = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(Number(result.lastInsertRowid));
        res.json(row);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
  }
}
