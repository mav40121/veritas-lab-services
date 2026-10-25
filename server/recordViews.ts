// server/recordViews.ts
//
// Record-view logging and access reports (Lifepoint IPS III.1(i), committed for October 31, 2026; Security
// Policy v1.1 section 6; Michael Q27 = 1, 2026-10-25). The audit trail already records every change, approval
// and signature; this records who OPENED which records: every successful signed-in read (GET) of a lab's data.
//
// What is recorded: the lab, the person, when, the address (path without the query string), the module and the
// record id read from that path, the IP address, and whether the person was Veritas support. The same person
// opening the same address in the same lab is recorded once per 10 minutes, so a page that refreshes does not
// flood the log. Rows are kept for two years.
//
// Which lab a read belongs to: the lab in the path (/api/labs/:labId/...), which the lab-scope middleware has
// already checked, or, for older paths, the active-lab header, recorded only when the person really belongs to
// that lab. A read is never written into a lab the person does not belong to, so no customer's access report
// can show another customer's people.
//
// Not recorded: sign-in and account routes, the person's own shell calls (/api/me, /api/labs/me), public pages, Veritas admin routes (those have their own audit rows),
// the public demo, failed reads, and the owner's own full export (its job requests are verified by exportAllContext and marked req.exportAllJob).

const DEDUPE_MS = 10 * 60 * 1000;
const KEEP_DAYS = 730;
// The person's own shell calls (/api/me/..., /api/labs/me: who am I, my labs, my badges) are not lab records.
const SKIP = /^\/api\/(auth|health|public|demo|admin|csp-report|lookup|stripe|webhooks?|unsubscribe|newsletter|sso|me|labs\/me)(\/|$)/;

const recent = new Map<string, number>();
let lastPrune = 0;

const MODULES: Array<[RegExp, string]> = [
  [/^(studies|veritacheck|instrument-verifications|signoff-groups)/, "VeritaCheck"],
  [/^veritamap/, "VeritaMap"],
  [/^(competency|veritacomp)/, "VeritaComp"],
  [/^(staff|veritastaff|ceu)/, "VeritaStaff"],
  [/^(veritapolicy|policies|policy|documents|iqcp)/, "VeritaPolicy"],
  [/^(qc|veritaqc)/, "VeritaQC"],
  [/^(veritascan|scan)/, "VeritaScan"],
  [/^(equipment|veritamaintain|maintenance|temperature)/, "VeritaMaintain"],
  [/^(veritatrack|track|tasks)/, "VeritaTrack"],
  [/^(pt|veritapt)/, "VeritaPT"],
  [/^(veritastock|inventory|stock)/, "VeritaStock"],
  [/^(findings|veritaresponse|response)/, "VeritaResponse"],
  [/^(veritalab|certificates|clia)/, "VeritaLab"],
  [/^(veritaqa|qa)/, "VeritaQA"],
  [/^(bench|pace|shift|schedule|veritabench|veritapace|veritashift)/, "Productivity"],
  [/^(ops|veritaops|cprt)/, "VeritaOps"],
  [/^(members|team|seat|account-status|two-factor|vls-support|access-report)/, "Members and access"],
  [/^(export|export-all)/, "Exports"],
];

/** Module label and record id for a lab-relative path like "veritamap/maps/12/instruments". */
export function describeViewPath(rest: string): { module: string; entityId: string | null } {
  const clean = rest.replace(/^\/+/, "");
  const hit = MODULES.find(([re]) => re.test(clean));
  const id = clean.split("/").find((seg) => /^\d+$/.test(seg)) || null;
  return { module: hit ? hit[1] : "Other", entityId: id };
}

function belongsToLab(sqlite: any, userId: number, labId: number): boolean {
  try {
    return !!sqlite.prepare(
      `SELECT 1 FROM labs l WHERE l.id = ? AND (l.owner_user_id = ?
         OR EXISTS (SELECT 1 FROM lab_members m WHERE m.lab_id = l.id AND m.user_id = ? AND m.status = 'active')
         OR EXISTS (SELECT 1 FROM user_seats s WHERE s.lab_id = l.id AND s.seat_user_id = ? AND s.status = 'active')
         OR (l.organization_id IS NOT NULL AND EXISTS (SELECT 1 FROM organization_members om WHERE om.organization_id = l.organization_id AND om.user_id = ? AND om.status = 'active')))`
    ).get(labId, userId, userId, userId, userId);
  } catch {
    return false;
  }
}

/** Express middleware: after a successful signed-in GET of lab data, records the view. Never blocks or fails a request. */
export function recordViewMiddleware(getSqlite: () => any) {
  return (req: any, res: any, next: any) => {
    if (req.method !== "GET") return next();
    const path = String(req.originalUrl || req.url || "").split("?")[0];
    // Only a VERIFIED export-job request is left out (exportAllContext sets req.exportAllJob); the bare header proves nothing.
    if (!path.startsWith("/api/") || SKIP.test(path) || req.exportAllJob) return next();
    res.on("finish", () => {
      try {
        if (res.statusCode >= 400 || !req.userId || req.isDemo) return;
        const sqlite = getSqlite();
        const m = path.match(/^\/api\/labs\/(\d+)\/(.*)$/);
        let labId: number | null = null;
        let rest = "";
        if (m) { labId = Number(m[1]); rest = m[2]; }
        else {
          const h = Number(req.headers["x-active-lab-id"]);
          if (Number.isInteger(h) && h > 0 && belongsToLab(sqlite, Number(req.userId), h)) { labId = h; rest = path.replace(/^\/api\//, ""); }
        }
        if (!labId) return;
        const now = Date.now();
        const key = `${req.userId}|${labId}|${path}`;
        if (now - (recent.get(key) || 0) < DEDUPE_MS) return;
        recent.set(key, now);
        if (recent.size > 50000) recent.clear();
        const { module, entityId } = describeViewPath(rest);
        const vls = req.scope?.viaVlsSupport ? 1 : Number((sqlite.prepare("SELECT COALESCE(vls_support, 0) AS v FROM users WHERE id = ?").get(req.userId) as any)?.v) === 1 ? 1 : 0;
        const fwd = req.headers["x-forwarded-for"];
        const ip = (Array.isArray(fwd) ? fwd[0] : String(fwd || "").split(",")[0]).trim() || req.ip || null;
        sqlite.prepare(
          "INSERT INTO record_views (lab_id, user_id, path, module, entity_id, ip_address, vls_support, viewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(labId, Number(req.userId), path.slice(0, 300), module, entityId, ip, vls, new Date(now).toISOString());
        if (now - lastPrune > 24 * 60 * 60 * 1000) {
          lastPrune = now;
          sqlite.prepare("DELETE FROM record_views WHERE viewed_at < ?").run(new Date(now - KEEP_DAYS * 86400000).toISOString());
        }
      } catch { /* the log never breaks a read */ }
    });
    next();
  };
}

export interface AccessRow {
  viewedAt: string;
  userId: number;
  name: string;
  email: string;
  module: string;
  entityId: string | null;
  path: string;
  ipAddress: string | null;
  veritasSupport: boolean;
}

/** One lab's record views, newest first. Only this lab's rows: a report never reaches another customer's data. */
export function accessReport(sqlite: any, labId: number, opts: { days: number; userId?: number | null; limit?: number }): { rows: AccessRow[]; total: number; from: string } {
  const from = new Date(Date.now() - opts.days * 86400000).toISOString();
  const where = ["v.lab_id = ?", "v.viewed_at >= ?"];
  const args: any[] = [labId, from];
  if (opts.userId) { where.push("v.user_id = ?"); args.push(opts.userId); }
  const total = Number((sqlite.prepare(`SELECT COUNT(*) AS n FROM record_views v WHERE ${where.join(" AND ")}`).get(...args) as any)?.n || 0);
  const rows = (sqlite.prepare(
    `SELECT v.viewed_at, v.user_id, COALESCE(u.name, u.email) AS name, u.email, v.module, v.entity_id, v.path, v.ip_address, v.vls_support
       FROM record_views v LEFT JOIN users u ON u.id = v.user_id
      WHERE ${where.join(" AND ")}
      ORDER BY v.viewed_at DESC, v.id DESC LIMIT ?`
  ).all(...args, Math.min(opts.limit ?? 500, 20000)) as any[]).map((r) => ({
    viewedAt: r.viewed_at, userId: Number(r.user_id), name: r.name || "", email: r.email || "", module: r.module,
    entityId: r.entity_id, path: r.path, ipAddress: r.ip_address, veritasSupport: Number(r.vls_support) === 1,
  }));
  return { rows, total, from };
}

/** The access report as a workbook (CLAUDE.md section 6: About sheet first, lab identity in three layers, locked). */
export async function accessReportExcel(report: { rows: AccessRow[]; from: string }, ctx: { labName: string; cliaNumber: string | null; days: number }): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "VeritaAssure"; wb.lastModifiedBy = "VeritaAssure"; wb.created = new Date(); wb.modified = new Date();
  const labName = ctx.labName || "Lab name not on file";
  const idText = `${labName}    CLIA: ${ctx.cliaNumber || "Not on file"}`;
  const pwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";
  const thin: any = { style: "thin", color: { argb: "FFD0D0D0" } };
  const border: any = { top: thin, bottom: thin, left: thin, right: thin };
  const protect = { selectLockedCells: true, selectUnlockedCells: true, formatCells: false, formatColumns: false, formatRows: false, insertRows: false, insertColumns: false, deleteRows: false, deleteColumns: false, sort: true, autoFilter: true };
  const header = `&L&"Calibri,Regular"&10VeritaAssure Access Report&R&"Calibri,Regular"&10${idText}`;
  const footer = `&L&"Calibri,Regular"&9${idText}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;

  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const t = about.getCell("A1");
  t.value = "VeritaAssure Access Report";
  t.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
  t.alignment = { vertical: "middle", indent: 1 };
  about.getRow(1).height = 30;
  const id = about.getCell("A2");
  id.value = `Prepared for: ${idText}`;
  id.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF0A3A3D" } };
  id.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
  id.alignment = { vertical: "top", wrapText: true, indent: 1 };
  id.border = border;
  let row = 3;
  const section = (s: string) => { const c = about.getCell(`A${row}`); c.value = s; c.font = { name: "Calibri", bold: true, size: 12, color: { argb: "FF0A3A3D" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } }; c.alignment = { wrapText: true, indent: 1 }; c.border = border; row += 1; };
  const body = (s: string) => { const c = about.getCell(`A${row}`); c.value = s; c.font = { name: "Calibri", size: 11, color: { argb: "FF28251D" } }; c.alignment = { vertical: "top", wrapText: true, indent: 1 }; c.border = border; about.getRow(row).height = Math.max(1, Math.ceil(s.length / 88)) * 16 + 4; row += 1; };
  section("About this workbook");
  body(`Every time someone signed in opened records in this lab during the last ${ctx.days} days (from ${report.from.slice(0, 10)}), with who it was, when, which module and record, and the address they connected from. The same person opening the same page within 10 minutes is listed once. Changes, approvals and signatures are in the lab's audit trail, not here.`);
  section("How to use it");
  body("Filter the Access Log sheet by person, module or date. Rows marked Veritas support were opened by Veritas Lab Services staff helping with set-up; the lab owner can switch that access off on the Members page.");
  section("Source");
  body("VeritaAssure record-view log for this lab only. It never includes another lab's or another customer's activity. Records are kept for two years.");
  section("Disclaimer");
  body("This report lists what was opened in VeritaAssure. It is not a record of what was printed, copied or shared after it was opened. The laboratory director or designee is responsible for any action taken on the basis of this report.");
  section("Coverage gaps");
  body("If a column you need is missing, please email info@veritaslabservices.com so it can be evaluated for a future revision.");
  about.headerFooter.oddHeader = header;
  about.headerFooter.oddFooter = footer;
  await about.protect(pwd, { ...protect, sort: false, autoFilter: false });

  const log = wb.addWorksheet("Access Log");
  const COLS = [
    { header: "Opened (UTC)", width: 20 }, { header: "Person", width: 24 }, { header: "Email", width: 30 },
    { header: "Module", width: 18 }, { header: "Record #", width: 10 }, { header: "Page or record address", width: 50 },
    { header: "IP address", width: 16 }, { header: "Veritas support", width: 14 },
  ];
  log.columns = COLS.map((c) => ({ header: c.header, width: c.width }));
  for (const r of report.rows) {
    log.addRow([r.viewedAt.replace("T", " ").slice(0, 19), r.name, r.email, r.module, r.entityId ?? "", r.path, r.ipAddress ?? "", r.veritasSupport ? "Yes" : ""]);
  }
  const h = log.getRow(1);
  h.height = 20;
  h.eachCell((c: any) => { c.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } }; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; c.border = border; });
  for (let r = 2; r <= log.rowCount; r++) {
    const bg = r % 2 === 0 ? "FFEBF3F8" : "FFFFFFFF";
    log.getRow(r).eachCell({ includeEmpty: true }, (c: any) => { c.font = { name: "Calibri", size: 10, color: { argb: "FF28251D" } }; c.alignment = { vertical: "middle", wrapText: true }; c.border = border; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } }; c.protection = { locked: true }; });
  }
  log.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };
  log.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  log.headerFooter.oddHeader = header;
  log.headerFooter.oddFooter = footer;
  await log.protect(pwd, protect);
  return Buffer.from(await wb.xlsx.writeBuffer()) as Buffer;
}
