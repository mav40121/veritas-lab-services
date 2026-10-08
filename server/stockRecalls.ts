// server/stockRecalls.ts
//
// VeritaStock recall tracker (2026-10-08). A vendor recall, product
// notification or device correction becomes a case on the lab:
//   intake (type, notice date, vendor, product, recall #, lot numbers, notice
//   file) -> due 1 business day after opening -> lot numbers matched against
//   stock at every location the user can see -> recalled stock pulled by lot
//   (a "recalled" write-off on THAT lot, not FEFO) -> closeout checklist ->
//   manager sign-off -> close.
// The notification list is per lab (stock_recall_recipients); the app emails
// it at intake and at closeout. Overdue cases email the assigned manager.
//
// Copy rule: VeritaStock carries no lab wording, in routes, emails or errors.
// Pure rules (due date, checklist, cadence, file name) live in
// ./stockRecallLogic and are exercised by scripts/verify-stock-recall-logic.mts.
import type { Express } from "express";
import { db } from "./db";
import { logAudit } from "./audit";
import { logConsumption } from "./consumptionLedger";
import { reconcileLots } from "./inventoryLots";
import { hasOpsAccess } from "./veritabench";
import {
  RECALL_NOTICE_TYPES, RECALL_NOTICE_TYPE_LABELS, type RecallNoticeType,
  isYmd, nextBusinessDay, resolveOpenedDate, parseLotNumbers, normalizeLot,
  recallChecklist, readyForSignoff, readyToClose, decideOverdueReminder,
  daysBetweenYmd, noticeFilename,
} from "./stockRecallLogic";

// ── Mailer ────────────────────────────────────────────────────────────────
export interface RecallMail {
  to: string[];
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer }[];
}
type Mailer = (m: RecallMail) => Promise<void>;
let mailerOverride: Mailer | null = null;
// Integration tests swap in a capturing mailer; production uses Resend.
export function setRecallMailerForTests(m: Mailer | null) { mailerOverride = m; }

async function getMailer(): Promise<Mailer | null> {
  if (mailerOverride) return mailerOverride;
  if (!process.env.RESEND_API_KEY) return null;
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  return async (m) => {
    const r: any = await resend.emails.send({
      from: "VeritaStock <info@veritaslabservices.com>",
      to: m.to, subject: m.subject, text: m.text,
      ...(m.attachments?.length ? { attachments: m.attachments } : {}),
    });
    if (r?.error) throw new Error(r.error.message || String(r.error));
  };
}

const sqliteOf = () => (db as any).$client;
const todayUtc = () => new Date().toISOString().slice(0, 10);
const MAX_ATTACH_BYTES = 15 * 1024 * 1024;

function typeLabel(t: string): string {
  return RECALL_NOTICE_TYPE_LABELS[(t as RecallNoticeType)] || "Recall";
}

function userLabel(sqlite: any, userId: number | null | undefined): { name: string | null; email: string | null } {
  if (!userId) return { name: null, email: null };
  const u = sqlite.prepare("SELECT name, email FROM users WHERE id = ?").get(userId) as any;
  return { name: u?.name || u?.email || null, email: u?.email || null };
}

// Locations whose stock a recall is matched against: every lab the requester
// owns or is an active member of, plus the case's own lab.
function networkLabs(sqlite: any, req: any): Map<number, string> {
  const ownerId = req.ownerUserId ?? req.userId;
  const owned = sqlite.prepare("SELECT id, lab_name FROM labs WHERE owner_user_id IN (?, ?)").all(ownerId, req.userId) as any[];
  const member = sqlite.prepare(
    "SELECT l.id, l.lab_name FROM labs l JOIN lab_members m ON m.lab_id = l.id WHERE m.user_id = ? AND m.status = 'active'"
  ).all(req.userId) as any[];
  const map = new Map<number, string>();
  for (const l of [...owned, ...member]) map.set(Number(l.id), l.lab_name || `Location ${l.id}`);
  if (req.scope?.lab?.id && !map.has(Number(req.scope.labId))) map.set(Number(req.scope.labId), req.scope.lab.lab_name || `Location ${req.scope.labId}`);
  return map;
}

export interface LotMatch {
  source: "lot" | "item";
  lot_id: number | null;
  item_id: number;
  item_name: string;
  catalog_number: string | null;
  item_vendor: string | null;
  vendor_matches: boolean;
  lot_number: string;
  expiration_date: string | null;
  quantity: number;
  unit: string | null;
  lab_id: number;
  lab_name: string;
  storage_location: string | null;
}

// Stock on hand carrying one of the recalled lot numbers, at every location in
// the requester's network. Read-only and computed fresh on every case read.
// Matches are candidates: lot numbers are not unique across vendors, so each
// row says whether the item's vendor looks like the recall's vendor.
export function findLotMatches(sqlite: any, labs: Map<number, string>, lotNumbers: string[], recallVendor: string): LotMatch[] {
  const keys = new Set(lotNumbers.map(normalizeLot).filter(Boolean));
  if (keys.size === 0 || labs.size === 0) return [];
  const ids = Array.from(labs.keys());
  const ph = ids.map(() => "?").join(",");
  const vKey = normalizeLot(recallVendor || "");
  const vendorMatches = (v: string | null) => {
    const k = normalizeLot(v || "");
    return !!k && !!vKey && (k.includes(vKey) || vKey.includes(k));
  };
  const out: LotMatch[] = [];
  const lotRows = sqlite.prepare(
    `SELECT l.id AS lot_id, l.lot_number, l.expiration_date, l.quantity,
            i.id AS item_id, i.item_name, i.catalog_number, i.vendor, i.usage_unit, i.unit, i.lab_id, i.storage_location
       FROM inventory_lots l JOIN inventory_items i ON i.id = l.item_id
      WHERE i.lab_id IN (${ph}) AND l.quantity > 0 AND l.lot_number IS NOT NULL AND TRIM(l.lot_number) <> ''`
  ).all(...ids) as any[];
  for (const r of lotRows) {
    if (!keys.has(normalizeLot(r.lot_number))) continue;
    out.push({
      source: "lot", lot_id: r.lot_id, item_id: r.item_id, item_name: r.item_name, catalog_number: r.catalog_number ?? null,
      item_vendor: r.vendor ?? null, vendor_matches: vendorMatches(r.vendor), lot_number: r.lot_number,
      expiration_date: r.expiration_date ?? null, quantity: Number(r.quantity) || 0, unit: r.usage_unit || r.unit || null,
      lab_id: r.lab_id, lab_name: labs.get(Number(r.lab_id)) || `Location ${r.lab_id}`, storage_location: r.storage_location ?? null,
    });
  }
  // Items tracked with a single lot on the item row and no lot breakdown yet.
  const itemRows = sqlite.prepare(
    `SELECT i.id AS item_id, i.item_name, i.catalog_number, i.vendor, i.usage_unit, i.unit, i.lab_id, i.storage_location,
            i.lot_number, i.expiration_date, i.quantity_on_hand
       FROM inventory_items i
      WHERE i.lab_id IN (${ph}) AND i.quantity_on_hand > 0 AND i.lot_number IS NOT NULL AND TRIM(i.lot_number) <> ''
        AND NOT EXISTS (SELECT 1 FROM inventory_lots l WHERE l.item_id = i.id)`
  ).all(...ids) as any[];
  for (const r of itemRows) {
    if (!keys.has(normalizeLot(r.lot_number))) continue;
    out.push({
      source: "item", lot_id: null, item_id: r.item_id, item_name: r.item_name, catalog_number: r.catalog_number ?? null,
      item_vendor: r.vendor ?? null, vendor_matches: vendorMatches(r.vendor), lot_number: r.lot_number,
      expiration_date: r.expiration_date ?? null, quantity: Number(r.quantity_on_hand) || 0, unit: r.usage_unit || r.unit || null,
      lab_id: r.lab_id, lab_name: labs.get(Number(r.lab_id)) || `Location ${r.lab_id}`, storage_location: r.storage_location ?? null,
    });
  }
  out.sort((a, b) => Number(b.vendor_matches) - Number(a.vendor_matches) || a.lab_name.localeCompare(b.lab_name) || a.item_name.localeCompare(b.item_name));
  return out;
}

function lotsOf(row: any): string[] {
  try { const v = JSON.parse(row?.lot_numbers_json || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

function vendorDocCount(sqlite: any, recallId: number): number {
  return (sqlite.prepare("SELECT COUNT(*) AS n FROM stock_recall_documents WHERE recall_id = ? AND kind = 'vendor_response'").get(recallId) as any)?.n || 0;
}

function logEvent(sqlite: any, recallId: number, labId: number, userId: number | null, action: string, detail?: unknown) {
  sqlite.prepare("INSERT INTO stock_recall_events (recall_id, lab_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(recallId, labId, userId, action, detail == null ? null : (typeof detail === "string" ? detail : JSON.stringify(detail)), new Date().toISOString());
}

function decorate(sqlite: any, row: any, today: string) {
  const items = recallChecklist(row, vendorDocCount(sqlite, row.id));
  const assigned = userLabel(sqlite, row.assigned_user_id);
  return {
    ...row,
    lot_numbers: lotsOf(row),
    notice_type_label: typeLabel(row.notice_type),
    assigned_name: assigned.name,
    assigned_email: assigned.email,
    checklist: items,
    checklist_done: items.filter((i) => i.done).length,
    checklist_total: items.length,
    ready_for_signoff: readyForSignoff(items),
    ready_to_close: readyToClose(items),
    overdue: row.status === "open" && isYmd(row.due_date) && row.due_date < today,
    days_overdue: row.status === "open" && isYmd(row.due_date) ? Math.max(0, daysBetweenYmd(row.due_date, today)) : 0,
  };
}

function cleanStr(v: unknown, max = 2000): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

const RECALLS = "/api/labs/:labId/veritastock/recalls";

export function registerStockRecallRoutes(
  app: Express,
  authMiddleware: any,
  requireWriteAccess: any,
  requireModuleEdit: (mod: string) => any,
) {
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (!labScopeMiddleware) throw new Error("registerStockRecallRoutes: labScopeMiddleware not registered");
  const multer = require("multer"); // same CJS load as the VeritaLab upload route
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
  const edit = [authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritastock")];
  const read = [authMiddleware, labScopeMiddleware];
  const gate = (req: any, res: any) => {
    if (hasOpsAccess(req.user, req.scope?.lab)) return false;
    res.status(403).json({ error: "VeritaStock™ requires a suite subscription" });
    return true;
  };
  const viewerToday = (req: any) => resolveOpenedDate(req.query?.today ?? req.body?.local_date, todayUtc());
  const loadCase = (req: any) =>
    sqliteOf().prepare("SELECT * FROM stock_recalls WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;

  // ── Notification list ─────────────────────────────────────────────────
  app.get(`${RECALLS}/recipients`, ...read, (req: any, res) => {
    if (gate(req, res)) return;
    res.json(sqliteOf().prepare("SELECT id, name, email, role, active FROM stock_recall_recipients WHERE lab_id = ? ORDER BY active DESC, name COLLATE NOCASE ASC, id ASC").all(req.scope.labId));
  });

  app.post(`${RECALLS}/recipients`, ...edit, (req: any, res) => {
    if (gate(req, res)) return;
    const email = cleanStr(req.body?.email, 254);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "A valid email is required" });
    const sqlite = sqliteOf();
    const dup = sqlite.prepare("SELECT id FROM stock_recall_recipients WHERE lab_id = ? AND LOWER(email) = LOWER(?)").get(req.scope.labId, email);
    if (dup) return res.status(409).json({ error: "That email is already on the list" });
    const now = new Date().toISOString();
    const r = sqlite.prepare("INSERT INTO stock_recall_recipients (lab_id, name, email, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)")
      .run(req.scope.labId, cleanStr(req.body?.name, 120), email, cleanStr(req.body?.role, 120), now, now);
    res.json(sqlite.prepare("SELECT id, name, email, role, active FROM stock_recall_recipients WHERE id = ?").get(r.lastInsertRowid));
  });

  app.put(`${RECALLS}/recipients/:rid`, ...edit, (req: any, res) => {
    if (gate(req, res)) return;
    const sqlite = sqliteOf();
    const row = sqlite.prepare("SELECT * FROM stock_recall_recipients WHERE id = ? AND lab_id = ?").get(Number(req.params.rid), req.scope.labId) as any;
    if (!row) return res.status(404).json({ error: "Not found" });
    const email = req.body?.email !== undefined ? cleanStr(req.body.email, 254) : row.email;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "A valid email is required" });
    sqlite.prepare("UPDATE stock_recall_recipients SET name = ?, email = ?, role = ?, active = ?, updated_at = ? WHERE id = ?").run(
      req.body?.name !== undefined ? cleanStr(req.body.name, 120) : row.name,
      email,
      req.body?.role !== undefined ? cleanStr(req.body.role, 120) : row.role,
      req.body?.active !== undefined ? (req.body.active ? 1 : 0) : row.active,
      new Date().toISOString(), row.id,
    );
    res.json(sqlite.prepare("SELECT id, name, email, role, active FROM stock_recall_recipients WHERE id = ?").get(row.id));
  });

  app.delete(`${RECALLS}/recipients/:rid`, ...edit, (req: any, res) => {
    if (gate(req, res)) return;
    const r = sqliteOf().prepare("DELETE FROM stock_recall_recipients WHERE id = ? AND lab_id = ?").run(Number(req.params.rid), req.scope.labId);
    if (!r.changes) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  });

  // People a case can be assigned to: active members of this lab.
  app.get(`${RECALLS}/assignees`, ...read, (req: any, res) => {
    if (gate(req, res)) return;
    const rows = sqliteOf().prepare(
      `SELECT u.id, COALESCE(NULLIF(TRIM(u.name), ''), u.email) AS name, u.email, m.role
         FROM lab_members m JOIN users u ON u.id = m.user_id
        WHERE m.lab_id = ? AND m.status = 'active'
        ORDER BY name COLLATE NOCASE ASC`
    ).all(req.scope.labId);
    res.json(rows);
  });

  // ── Cases ─────────────────────────────────────────────────────────────
  app.get(RECALLS, ...read, (req: any, res) => {
    if (gate(req, res)) return;
    const sqlite = sqliteOf();
    const today = viewerToday(req);
    const rows = sqlite.prepare("SELECT * FROM stock_recalls WHERE lab_id = ? ORDER BY (status = 'open') DESC, due_date ASC, id DESC").all(req.scope.labId) as any[];
    res.json({ today, cases: rows.map((r) => decorate(sqlite, r, today)) });
  });

  app.post(RECALLS, ...edit, (req: any, res) => {
    if (gate(req, res)) return;
    const sqlite = sqliteOf();
    const b = req.body || {};
    const noticeType = String(b.notice_type || "recall");
    if (!(RECALL_NOTICE_TYPES as readonly string[]).includes(noticeType)) return res.status(400).json({ error: "notice_type must be recall, product_notification, device_correction or other" });
    const vendor = cleanStr(b.vendor, 200);
    const product = cleanStr(b.product, 300);
    if (!vendor) return res.status(400).json({ error: "Vendor is required" });
    if (!product) return res.status(400).json({ error: "Product is required" });
    if (b.notice_date != null && b.notice_date !== "" && !isYmd(b.notice_date)) return res.status(400).json({ error: "notice_date must be YYYY-MM-DD" });
    const assigned = b.assigned_user_id ? Number(b.assigned_user_id) : null;
    if (assigned) {
      const ok = sqlite.prepare("SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active'").get(req.scope.labId, assigned);
      if (!ok) return res.status(400).json({ error: "The assigned person must be an active member of this location" });
    }
    const openedOn = resolveOpenedDate(b.local_date, todayUtc());
    let dueDate = nextBusinessDay(openedOn);
    if (b.due_date != null && b.due_date !== "") {
      if (!isYmd(b.due_date)) return res.status(400).json({ error: "due_date must be YYYY-MM-DD" });
      dueDate = b.due_date;
    }
    const lots = parseLotNumbers(b.lot_numbers);
    const now = new Date().toISOString();
    const r = sqlite.prepare(
      `INSERT INTO stock_recalls (lab_id, notice_type, notice_date, vendor, product, recall_number, lot_numbers_json, details,
         assigned_user_id, opened_on, due_date, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
    ).run(req.scope.labId, noticeType, b.notice_date || null, vendor, product, cleanStr(b.recall_number, 120), JSON.stringify(lots),
      cleanStr(b.details, 8000), assigned, openedOn, dueDate, req.userId, now, now);
    const id = Number(r.lastInsertRowid);
    logEvent(sqlite, id, req.scope.labId, req.userId, "opened", { notice_type: noticeType, vendor, product, lots, due_date: dueDate });
    try {
      logAudit({ userId: req.userId, ownerUserId: req.scope?.lab?.owner_user_id ?? req.ownerUserId ?? req.userId, module: "veritastock", action: "create",
        entityType: "stock_recall", entityId: id, entityLabel: `${typeLabel(noticeType)}: ${vendor} ${product}`, after: { lots, due_date: dueDate }, ipAddress: req.ip });
    } catch { /* best-effort */ }
    res.json(decorate(sqlite, sqlite.prepare("SELECT * FROM stock_recalls WHERE id = ?").get(id), viewerToday(req)));
  });

  app.get(`${RECALLS}/:id`, ...read, (req: any, res) => {
    if (gate(req, res)) return;
    const sqlite = sqliteOf();
    const row = loadCase(req);
    if (!row) return res.status(404).json({ error: "Recall not found" });
    const today = viewerToday(req);
    const documents = sqlite.prepare("SELECT id, kind, original_filename, mime_type, file_size, uploaded_by, uploaded_at FROM stock_recall_documents WHERE recall_id = ? ORDER BY uploaded_at ASC, id ASC").all(row.id) as any[];
    const events = (sqlite.prepare("SELECT id, user_id, action, detail, created_at FROM stock_recall_events WHERE recall_id = ? ORDER BY id ASC").all(row.id) as any[])
      .map((e) => ({ ...e, user_name: userLabel(sqlite, e.user_id).name }));
    const matches = row.status === "open" ? findLotMatches(sqlite, networkLabs(sqlite, req), lotsOf(row), row.vendor) : [];
    const recipients = sqlite.prepare("SELECT id, name, email, role FROM stock_recall_recipients WHERE lab_id = ? AND active = 1 ORDER BY name COLLATE NOCASE").all(req.scope.labId);
    res.json({
      ...decorate(sqlite, row, today),
      documents: documents.map((d) => ({ ...d, download_name: d.kind === "notice" ? noticeFilename(row, d.original_filename) : d.original_filename })),
      events, matches, recipients,
    });
  });

  // Edit intake + closeout fields. Closed cases are read-only. Changing a
  // closeout field after sign-off clears the sign-off (it no longer covers
  // what is on the case).
  const CLOSEOUT_FIELDS = ["affected_summary", "corrective_action", "vendor_response_sent_on", "vendor_response_not_required"];
  app.put(`${RECALLS}/:id`, ...edit, (req: any, res) => {
    if (gate(req, res)) return;
    const sqlite = sqliteOf();
    const row = loadCase(req);
    if (!row) return res.status(404).json({ error: "Recall not found" });
    if (row.status === "closed") return res.status(409).json({ error: "This case is closed" });
    const b = req.body || {};
    const set: Record<string, any> = {};
    if (b.notice_type !== undefined) {
      if (!(RECALL_NOTICE_TYPES as readonly string[]).includes(String(b.notice_type))) return res.status(400).json({ error: "Invalid notice_type" });
      set.notice_type = String(b.notice_type);
    }
    for (const k of ["notice_date", "due_date", "vendor_response_sent_on"]) {
      if (b[k] === undefined) continue;
      if (b[k] === null || b[k] === "") { if (k === "due_date") return res.status(400).json({ error: "due_date is required" }); set[k] = null; continue; }
      if (!isYmd(b[k])) return res.status(400).json({ error: `${k} must be YYYY-MM-DD` });
      set[k] = b[k];
    }
    if (b.vendor !== undefined) { const v = cleanStr(b.vendor, 200); if (!v) return res.status(400).json({ error: "Vendor is required" }); set.vendor = v; }
    if (b.product !== undefined) { const v = cleanStr(b.product, 300); if (!v) return res.status(400).json({ error: "Product is required" }); set.product = v; }
    if (b.recall_number !== undefined) set.recall_number = cleanStr(b.recall_number, 120);
    if (b.details !== undefined) set.details = cleanStr(b.details, 8000);
    if (b.lot_numbers !== undefined) set.lot_numbers_json = JSON.stringify(parseLotNumbers(b.lot_numbers));
    if (b.assigned_user_id !== undefined) {
      const a = b.assigned_user_id ? Number(b.assigned_user_id) : null;
      if (a && !sqlite.prepare("SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active'").get(req.scope.labId, a)) {
        return res.status(400).json({ error: "The assigned person must be an active member of this location" });
      }
      set.assigned_user_id = a;
    }
    if (b.affected_summary !== undefined) set.affected_summary = cleanStr(b.affected_summary, 8000);
    if (b.corrective_action !== undefined) set.corrective_action = cleanStr(b.corrective_action, 8000);
    if (b.vendor_response_not_required !== undefined) set.vendor_response_not_required = b.vendor_response_not_required ? 1 : 0;
    const changed = Object.keys(set).filter((k) => String(set[k] ?? "") !== String(row[k] ?? ""));
    if (changed.length === 0) return res.json(decorate(sqlite, row, viewerToday(req)));
    const closeoutTouched = changed.some((k) => CLOSEOUT_FIELDS.includes(k));
    // The list was told the old version, and the sign-off covered it: both redo.
    if (closeoutTouched && row.signoff_at) { set.signoff_at = null; set.signoff_user_id = null; set.signoff_name = null; }
    if (closeoutTouched && row.closeout_notified_at) set.closeout_notified_at = null;
    set.updated_at = new Date().toISOString();
    const keys = Object.keys(set);
    sqlite.prepare(`UPDATE stock_recalls SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => set[k]), row.id);
    logEvent(sqlite, row.id, row.lab_id, req.userId, "updated", {
      fields: changed,
      ...(closeoutTouched && row.signoff_at ? { signoff_cleared: true } : {}),
      ...(closeoutTouched && row.closeout_notified_at ? { closeout_notice_cleared: true } : {}),
    });
    res.json(decorate(sqlite, sqlite.prepare("SELECT * FROM stock_recalls WHERE id = ?").get(row.id), viewerToday(req)));
  });

  // Delete a case opened by mistake: only while open and before any stock was
  // pulled against it (those write-offs must keep their case).
  app.delete(`${RECALLS}/:id`, ...edit, (req: any, res) => {
    if (gate(req, res)) return;
    const sqlite = sqliteOf();
    const row = loadCase(req);
    if (!row) return res.status(404).json({ error: "Recall not found" });
    if (row.status === "closed") return res.status(409).json({ error: "A closed case cannot be deleted" });
    const pulled = sqlite.prepare("SELECT 1 FROM stock_recall_events WHERE recall_id = ? AND action = 'stock_removed' LIMIT 1").get(row.id);
    if (pulled) return res.status(409).json({ error: "Stock has already been removed against this case, so it cannot be deleted" });
    sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM stock_recall_events WHERE recall_id = ?").run(row.id);
      sqlite.prepare("DELETE FROM stock_recall_documents WHERE recall_id = ?").run(row.id);
      sqlite.prepare("DELETE FROM stock_recalls WHERE id = ?").run(row.id);
    })();
    try {
      logAudit({ userId: req.userId, ownerUserId: req.scope?.lab?.owner_user_id ?? req.userId, module: "veritastock", action: "delete",
        entityType: "stock_recall", entityId: row.id, entityLabel: `${typeLabel(row.notice_type)}: ${row.vendor} ${row.product}`, before: row, ipAddress: req.ip });
    } catch { /* best-effort */ }
    res.json({ ok: true });
  });

  // ── Files ─────────────────────────────────────────────────────────────
  app.post(`${RECALLS}/:id/documents`, ...edit, upload.single("file"), (req: any, res: any) => {
    if (gate(req, res)) return;
    const sqlite = sqliteOf();
    const row = loadCase(req);
    if (!row) return res.status(404).json({ error: "Recall not found" });
    if (row.status === "closed") return res.status(409).json({ error: "This case is closed" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const kind = req.body?.kind === "vendor_response" ? "vendor_response" : req.body?.kind === "other" ? "other" : "notice";
    const r = sqlite.prepare(
      "INSERT INTO stock_recall_documents (recall_id, lab_id, kind, original_filename, mime_type, file_size, file_data, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(row.id, row.lab_id, kind, String(req.file.originalname || "file").slice(0, 200), req.file.mimetype || null, req.file.size, req.file.buffer, req.userId, new Date().toISOString());
    logEvent(sqlite, row.id, row.lab_id, req.userId, "file_added", { kind, filename: req.file.originalname });
    res.status(201).json({ id: Number(r.lastInsertRowid), kind, original_filename: req.file.originalname, file_size: req.file.size, download_name: kind === "notice" ? noticeFilename(row, req.file.originalname) : req.file.originalname });
  });

  app.get(`${RECALLS}/:id/documents/:docId`, ...read, (req: any, res) => {
    if (gate(req, res)) return;
    const sqlite = sqliteOf();
    const row = loadCase(req);
    if (!row) return res.status(404).json({ error: "Recall not found" });
    const doc = sqlite.prepare("SELECT * FROM stock_recall_documents WHERE id = ? AND recall_id = ?").get(Number(req.params.docId), row.id) as any;
    if (!doc) return res.status(404).json({ error: "File not found" });
    const name = doc.kind === "notice" ? noticeFilename(row, doc.original_filename) : doc.original_filename;
    res.setHeader("Content-Type", doc.mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${String(name).replace(/["\r\n]/g, "")}"`);
    res.send(doc.file_data);
  });

  app.delete(`${RECALLS}/:id/documents/:docId`, ...edit, (req: any, res) => {
    if (gate(req, res)) return;
    const sqlite = sqliteOf();
    const row = loadCase(req);
    if (!row) return res.status(404).json({ error: "Recall not found" });
    if (row.status === "closed") return res.status(409).json({ error: "This case is closed" });
    const doc = sqlite.prepare("SELECT id, kind, original_filename FROM stock_recall_documents WHERE id = ? AND recall_id = ?").get(Number(req.params.docId), row.id) as any;
    if (!doc) return res.status(404).json({ error: "File not found" });
    sqlite.prepare("DELETE FROM stock_recall_documents WHERE id = ?").run(doc.id);
    logEvent(sqlite, row.id, row.lab_id, req.userId, "file_removed", { kind: doc.kind, filename: doc.original_filename });
    res.json({ ok: true });
  });

  // ── Pull recalled stock, by lot ───────────────────────────────────────
  // body: { item_id, lot_id?, qty, note? }. Writes off qty from THAT lot with
  // reason "recalled" (the generic write-off would take the oldest lot first).
  // Operational like the generic write-off: any active member with write access.
  app.post(`${RECALLS}/:id/remove-stock`, authMiddleware, labScopeMiddleware, requireWriteAccess, (req: any, res) => {
    if (gate(req, res)) return;
    const sqlite = sqliteOf();
    const row = loadCase(req);
    if (!row) return res.status(404).json({ error: "Recall not found" });
    if (row.status === "closed") return res.status(409).json({ error: "This case is closed" });
    const itemId = Number(req.body?.item_id);
    const item = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(itemId) as any;
    if (!item) return res.status(404).json({ error: "Item not found" });
    const labs = networkLabs(sqlite, req);
    if (!item.lab_id || !labs.has(Number(item.lab_id))) return res.status(403).json({ error: "You don't have access to this item's location" });
    const nowIso = new Date().toISOString();
    if (!req.body?.lot_id) reconcileLots(sqlite, itemId, nowIso); // seed the lot row for single-lot items
    const caseKeys = new Set(lotsOf(row).map(normalizeLot));
    const lot = (req.body?.lot_id
      ? sqlite.prepare("SELECT * FROM inventory_lots WHERE id = ? AND item_id = ?").get(Number(req.body.lot_id), itemId)
      : (sqlite.prepare("SELECT * FROM inventory_lots WHERE item_id = ?").all(itemId) as any[]).find((l) => caseKeys.has(normalizeLot(l.lot_number || "")))) as any;
    if (!lot) return res.status(404).json({ error: "That lot is not on hand for this item" });
    if (!caseKeys.has(normalizeLot(lot.lot_number || ""))) return res.status(400).json({ error: "That lot number is not on this recall" });
    let qty = Number(req.body?.qty);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: "qty must be a positive number" });
    const lotQty = Number(lot.quantity) || 0;
    const onHand = Number(item.quantity_on_hand) || 0;
    qty = Math.min(qty, lotQty, onHand);
    if (qty <= 0) return res.status(400).json({ error: "Nothing on hand to remove" });
    const unitCost = Number(item.unit_cost) || 0;
    const wasteValue = qty * unitCost;
    const yearMonth = nowIso.slice(0, 7);
    const note = cleanStr(req.body?.note, 500);
    const recallRef = `${typeLabel(row.notice_type)} ${row.vendor}${row.recall_number ? " " + row.recall_number : ""} (case ${row.id})`;
    sqlite.transaction(() => {
      const remain = lotQty - qty;
      if (remain <= 0.0001) sqlite.prepare("DELETE FROM inventory_lots WHERE id = ?").run(lot.id);
      else sqlite.prepare("UPDATE inventory_lots SET quantity = ?, updated_at = ? WHERE id = ?").run(remain, nowIso, lot.id);
      sqlite.prepare("UPDATE inventory_items SET quantity_on_hand = ?, updated_at = ? WHERE id = ?").run(onHand - qty, nowIso, itemId);
      sqlite.prepare(
        `INSERT INTO inventory_waste_events (lab_id, item_id, item_name, qty, unit_cost, waste_value, reason_code, note, event_date, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'recalled', ?, ?, ?, ?)`
      ).run(item.lab_id, itemId, item.item_name, qty, unitCost, wasteValue, [`Lot ${lot.lot_number}, ${recallRef}`, note].filter(Boolean).join(". "), nowIso.slice(0, 10), req.userId, nowIso);
      const curVal = (sqlite.prepare("SELECT COALESCE(SUM(quantity_on_hand * unit_cost), 0) AS v FROM inventory_items WHERE lab_id = ?").get(item.lab_id) as any)?.v || 0;
      sqlite.prepare(
        `INSERT INTO inventory_monthly_snapshots (lab_id, year_month, avg_value_on_hand, opening_value, closing_value, waste_value, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?)
         ON CONFLICT(lab_id, year_month) DO UPDATE SET waste_value = waste_value + excluded.waste_value, closing_value = excluded.closing_value, updated_at = excluded.updated_at`
      ).run(item.lab_id, yearMonth, curVal, curVal, wasteValue, nowIso, nowIso);
      reconcileLots(sqlite, itemId, nowIso); // refresh the item's headline lot/expiry
      logEvent(sqlite, row.id, row.lab_id, req.userId, "stock_removed", {
        item_id: itemId, item_name: item.item_name, lot_number: lot.lot_number, qty, unit: item.usage_unit || item.unit || null,
        lab_id: item.lab_id, lab_name: labs.get(Number(item.lab_id)) || null, waste_value: wasteValue, note,
      });
    })();
    const ownerUserId = (sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(item.lab_id) as any)?.owner_user_id ?? item.account_id ?? req.userId;
    try {
      logAudit({ userId: req.userId, ownerUserId, module: "veritastock", action: "write_off", entityType: "inventory_item", entityId: itemId,
        entityLabel: `${item.item_name}: wrote off ${qty} ${item.usage_unit || "unit"} of lot ${lot.lot_number} (recalled, case ${row.id}), $${wasteValue.toFixed(2)} loss`,
        before: { quantity_on_hand: onHand, lot_quantity: lotQty }, after: { quantity_on_hand: onHand - qty, reason_code: "recalled", waste_value: wasteValue }, ipAddress: req.ip });
    } catch { /* best-effort */ }
    logConsumption({ itemId, labId: item.lab_id, accountId: ownerUserId, qty, unitCostAtEvent: unitCost, reason: "write_off", sourceEventRef: `write_off:recalled:case:${row.id}`, occurredAt: nowIso });
    res.json({ ok: true, removed: { item_id: itemId, lot_number: lot.lot_number, qty, waste_value: wasteValue, on_hand_after: onHand - qty } });
  });

  // ── Notices to the notification list ─────────────────────────────────
  // body: { stage: "intake" | "closeout" }. Intake sends the vendor notice as
  // an attachment; closeout sends what was done. Both go to the active list
  // plus the assigned manager. Recorded on the case only after the send works.
  app.post(`${RECALLS}/:id/notify`, ...edit, async (req: any, res) => {
    if (gate(req, res)) return;
    const sqlite = sqliteOf();
    const row = loadCase(req);
    if (!row) return res.status(404).json({ error: "Recall not found" });
    if (row.status === "closed") return res.status(409).json({ error: "This case is closed" });
    const stage = req.body?.stage === "closeout" ? "closeout" : req.body?.stage === "intake" ? "intake" : null;
    if (!stage) return res.status(400).json({ error: "stage must be intake or closeout" });
    if (stage === "closeout") {
      const items = recallChecklist(row, vendorDocCount(sqlite, row.id));
      const missing = items.filter((i) => ["affected", "corrective_action", "vendor_response", "vendor_paperwork"].includes(i.key) && !i.done);
      if (missing.length) return res.status(400).json({ error: "Finish the case before sending the closeout notice", missing: missing.map((m) => m.label) });
    }
    const list = (sqlite.prepare("SELECT name, email FROM stock_recall_recipients WHERE lab_id = ? AND active = 1").all(row.lab_id) as any[]);
    const assigned = userLabel(sqlite, row.assigned_user_id);
    const to = Array.from(new Set([...list.map((r) => String(r.email).toLowerCase()), ...(assigned.email ? [assigned.email.toLowerCase()] : [])]));
    if (to.length === 0) return res.status(400).json({ error: "Add at least one person to the notification list first" });
    const mailer = await getMailer();
    if (!mailer) return res.status(503).json({ error: "Email is not set up on this server" });

    const lab = sqlite.prepare("SELECT lab_name FROM labs WHERE id = ?").get(row.lab_id) as any;
    const where = lab?.lab_name || "your location";
    const lots = lotsOf(row);
    const tl = typeLabel(row.notice_type);
    const head = [
      `Vendor: ${row.vendor}`,
      `Product: ${row.product}`,
      row.recall_number ? `Recall number: ${row.recall_number}` : null,
      row.notice_date ? `Notice date: ${row.notice_date}` : null,
      `Lot numbers: ${lots.length ? lots.join(", ") : "none listed"}`,
      `Assigned to: ${assigned.name || "not assigned"}, due ${row.due_date}`,
    ].filter(Boolean) as string[];
    let subject: string; let text: string; let attachments: { filename: string; content: Buffer }[] = [];
    if (stage === "intake") {
      const matches = findLotMatches(sqlite, networkLabs(sqlite, req), lots, row.vendor);
      const stockLines = matches.length
        ? matches.map((m) => `- ${m.item_name}, lot ${m.lot_number}: ${m.quantity} ${m.unit || ""} at ${m.lab_name}${m.storage_location ? ` (${m.storage_location})` : ""}${m.vendor_matches ? "" : " [check vendor]"}`.replace(/\s+\]/, "]"))
        : ["No stock with these lot numbers is on hand."];
      const docs = sqlite.prepare("SELECT original_filename, file_size, file_data FROM stock_recall_documents WHERE recall_id = ? AND kind = 'notice' ORDER BY id").all(row.id) as any[];
      let total = 0;
      for (const d of docs) {
        total += Number(d.file_size) || 0;
        if (total > MAX_ATTACH_BYTES) break;
        attachments.push({ filename: noticeFilename(row, d.original_filename), content: Buffer.from(d.file_data) });
      }
      const skipped = docs.length - attachments.length;
      subject = `${tl}: ${row.vendor} ${row.product}${row.recall_number ? ` (${row.recall_number})` : ""}`;
      text = [
        `A new ${tl.toLowerCase()} has been logged for ${where}.`, ``,
        ...head, ``,
        row.details ? `Details: ${row.details}` : null, row.details ? `` : null,
        `Stock on hand with these lot numbers:`, ...stockLines, ``,
        attachments.length ? `The vendor notice is attached.` : docs.length ? `` : `No vendor notice file has been added to the case yet.`,
        skipped > 0 ? `${skipped} file${skipped === 1 ? " was" : "s were"} too large to attach; open the case in VeritaStock to view ${skipped === 1 ? "it" : "them"}.` : null,
        `Open the case in VeritaStock to record the action taken.`,
        ``, `Sent from VeritaStock.`,
      ].filter((l) => l !== null).join("\n");
    } else {
      const removed = (sqlite.prepare("SELECT detail FROM stock_recall_events WHERE recall_id = ? AND action = 'stock_removed' ORDER BY id").all(row.id) as any[])
        .map((e) => { try { return JSON.parse(e.detail); } catch { return null; } }).filter(Boolean);
      const removedLines = removed.length
        ? removed.map((d: any) => `- ${d.item_name}, lot ${d.lot_number}: ${d.qty} ${d.unit || ""} removed${d.lab_name ? ` at ${d.lab_name}` : ""}`)
        : ["No stock was removed through VeritaStock."];
      const sender = userLabel(sqlite, req.userId);
      subject = `Action taken: ${tl} ${row.vendor} ${row.product}${row.recall_number ? ` (${row.recall_number})` : ""}`;
      text = [
        `Here is the action taken on this ${tl.toLowerCase()} at ${where}.`, ``,
        ...head, ``,
        `What was affected: ${row.affected_summary}`, ``,
        `Corrective action: ${row.corrective_action}`, ``,
        `Stock removed:`, ...removedLines, ``,
        Number(row.vendor_response_not_required) ? `Vendor response: not required.` : `Vendor response sent: ${row.vendor_response_sent_on}.`,
        ``, `Recorded by ${sender.name || "a VeritaStock user"}.`, ``, `Sent from VeritaStock.`,
      ].join("\n");
    }
    try {
      await mailer({ to, subject, text, attachments });
    } catch (err: any) {
      console.error(`[stock-recalls] ${stage} notice failed for case ${row.id}:`, err?.message || err);
      return res.status(502).json({ error: "The email could not be sent. Try again." });
    }
    const nowIso = new Date().toISOString();
    sqlite.prepare(`UPDATE stock_recalls SET ${stage === "intake" ? "intake_notified_at" : "closeout_notified_at"} = ?, updated_at = ? WHERE id = ?`).run(nowIso, nowIso, row.id);
    logEvent(sqlite, row.id, row.lab_id, req.userId, stage === "intake" ? "intake_notice_sent" : "closeout_notice_sent", { to, attachments: attachments.length });
    res.json({ ok: true, sent_to: to, attachments: attachments.length, case: decorate(sqlite, sqlite.prepare("SELECT * FROM stock_recalls WHERE id = ?").get(row.id), viewerToday(req)) });
  });

  // ── Sign-off and close ────────────────────────────────────────────────
  // Sign-off: the assigned manager, or the location's owner/admin, once every
  // other checklist item is done. Close: every item, sign-off included.
  app.post(`${RECALLS}/:id/signoff`, ...edit, (req: any, res) => {
    if (gate(req, res)) return;
    const sqlite = sqliteOf();
    const row = loadCase(req);
    if (!row) return res.status(404).json({ error: "Recall not found" });
    if (row.status === "closed") return res.status(409).json({ error: "This case is closed" });
    const role = req.scope?.role;
    if (!(Number(row.assigned_user_id) === Number(req.userId) || role === "owner" || role === "admin")) {
      return res.status(403).json({ error: "Only the assigned manager or an owner/admin can sign off" });
    }
    const items = recallChecklist(row, vendorDocCount(sqlite, row.id));
    if (!readyForSignoff(items)) return res.status(400).json({ error: "Finish the checklist before signing off", missing: items.filter((i) => i.key !== "signoff" && !i.done).map((i) => i.label) });
    const me = userLabel(sqlite, req.userId);
    const nowIso = new Date().toISOString();
    sqlite.prepare("UPDATE stock_recalls SET signoff_user_id = ?, signoff_name = ?, signoff_at = ?, updated_at = ? WHERE id = ?").run(req.userId, me.name, nowIso, nowIso, row.id);
    logEvent(sqlite, row.id, row.lab_id, req.userId, "signed_off", { name: me.name });
    res.json(decorate(sqlite, sqlite.prepare("SELECT * FROM stock_recalls WHERE id = ?").get(row.id), viewerToday(req)));
  });

  app.post(`${RECALLS}/:id/close`, ...edit, (req: any, res) => {
    if (gate(req, res)) return;
    const sqlite = sqliteOf();
    const row = loadCase(req);
    if (!row) return res.status(404).json({ error: "Recall not found" });
    if (row.status === "closed") return res.status(409).json({ error: "This case is already closed" });
    const items = recallChecklist(row, vendorDocCount(sqlite, row.id));
    if (!readyToClose(items)) return res.status(400).json({ error: "Every checklist item must be done before the case can close", missing: items.filter((i) => !i.done).map((i) => i.label) });
    const nowIso = new Date().toISOString();
    sqlite.prepare("UPDATE stock_recalls SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?").run(nowIso, nowIso, row.id);
    logEvent(sqlite, row.id, row.lab_id, req.userId, "closed");
    try {
      logAudit({ userId: req.userId, ownerUserId: req.scope?.lab?.owner_user_id ?? req.userId, module: "veritastock", action: "update",
        entityType: "stock_recall", entityId: row.id, entityLabel: `Closed ${typeLabel(row.notice_type)}: ${row.vendor} ${row.product}`, ipAddress: req.ip });
    } catch { /* best-effort */ }
    res.json(decorate(sqlite, sqlite.prepare("SELECT * FROM stock_recalls WHERE id = ?").get(row.id), viewerToday(req)));
  });
}

// ── Nightly overdue reminders ───────────────────────────────────────────
// Open cases past their due date email the assigned manager: the first day
// overdue, then every 3 days. "Today" is the UTC date (the job runs at UTC
// midnight); a case due today is not overdue until the next run.
export async function runRecallReminders(todayOverride?: string): Promise<{ checked: number; sent: number; skipped: number; errors: number }> {
  const summary = { checked: 0, sent: 0, skipped: 0, errors: 0 };
  const sqlite = sqliteOf();
  const today = todayOverride && isYmd(todayOverride) ? todayOverride : todayUtc();
  const rows = sqlite.prepare("SELECT * FROM stock_recalls WHERE status = 'open' AND due_date < ?").all(today) as any[];
  const mailer = rows.length ? await getMailer() : null;
  for (const row of rows) {
    summary.checked++;
    const assigned = userLabel(sqlite, row.assigned_user_id);
    if (!assigned.email || !mailer) { summary.skipped++; continue; }
    // Cadence keys off the run date stored with each reminder (detail.on).
    const last = sqlite.prepare("SELECT MAX(json_extract(detail, '$.on')) AS s FROM stock_recall_events WHERE recall_id = ? AND action = 'overdue_reminder'").get(row.id) as any;
    const sinceLast = last?.s ? daysBetweenYmd(String(last.s).slice(0, 10), today) : null;
    const daysOverdue = daysBetweenYmd(row.due_date, today);
    if (!decideOverdueReminder(daysOverdue, sinceLast)) continue;
    const lab = sqlite.prepare("SELECT lab_name FROM labs WHERE id = ?").get(row.lab_id) as any;
    const items = recallChecklist(row, vendorDocCount(sqlite, row.id));
    const open = items.filter((i) => !i.done).map((i) => `- ${i.label}`);
    const tl = typeLabel(row.notice_type);
    try {
      await mailer({
        to: [assigned.email],
        subject: `Overdue: ${tl} ${row.vendor} ${row.product} (due ${row.due_date})`,
        text: [
          `Hello${assigned.name ? " " + assigned.name : ""},`, ``,
          `This ${tl.toLowerCase()} at ${lab?.lab_name || "your location"} was due ${row.due_date} and is still open (${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue).`, ``,
          `Vendor: ${row.vendor}`, `Product: ${row.product}`, row.recall_number ? `Recall number: ${row.recall_number}` : null, ``,
          `Still to do:`, ...open, ``,
          `Open the case in VeritaStock to finish it.`, ``, `Sent from VeritaStock.`,
        ].filter((l) => l !== null).join("\n"),
      });
      logEvent(sqlite, row.id, row.lab_id, null, "overdue_reminder", { to: assigned.email, days_overdue: daysOverdue, on: today });
      summary.sent++;
    } catch (err: any) {
      summary.errors++;
      console.error(`[stock-recalls] overdue reminder failed for case ${row.id}:`, err?.message || err);
    }
  }
  return summary;
}
