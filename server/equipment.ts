// server/equipment.ts
//
// VeritaMaintain equipment (MLC-1, 2026-08-11; moved out of routes.ts and extended for B9, 2026-11-24). Per-instrument records with a
// next-due date and an append-only event log, lab-scoped, behind the same suite plan list as the other modules. maintenance_status is
// worked out from next_due_date when read.
//
// B9, the equipment record:
//   - The record: dates in and out of service, who retired it and why, vendor and service contract, the IFU (a web address and/or one of
//     the lab's VeritaDC documents, opened at its current approved version), and the periods it was out of service.
//   - Events: who was signed in, cost, the vendor's person and company, files. An event that completes PM is the only thing that moves the
//     PM due date, and never earlier unless the person says so (shared/equipmentPm.ts planPmDue). A lab can require an attached vendor
//     report before a vendor PM counts as complete: until one is attached the due date stays.
//   - Append-only: an editor corrects an event with a reason, which writes a new row and leaves the original as it was
//     (superseded_by_event_id), or voids it with a reason, which keeps the row. Readers take LIVE_EVENT. Nothing here edits or deletes one.
//   - Files keep their bytes in the row, like VeritaLab's certificate documents. Removing one needs a reason, keeps the row and drops the
//     bytes, so a file holding patient information can be taken out.
//   - Retire asks for a reason and keeps the record; the Retired list restores it. Move copies the record and its history, read-only, to
//     another lab of the same organization for someone who can edit VeritaMaintain in both, and retires the one here.
//
// Access is the module's split: setup and corrections need VeritaMaintain edit; logging an event is recording work open to every active
// member, Staff logins included. A limited Staff login reads what was typed, as on paper, but not a coworker's sign-in name (stainLog.ts).
import type { Express } from "express";
import { db } from "./db";
import { labLocalDate, labTimeZoneById, labToday } from "./dateLocal";
import { logAudit } from "./audit";
import { exportAllPlanBypass } from "./exportAllContext";
import { staffOwnScope } from "./competencySelfEntry";
import { checkUploadedFileForPhi } from "./phiUploadCheck";
import { canonicalFormatFromMimeAndName, DOC_MIME } from "./veritapolicyApproval";
import { approvedReadVersionId } from "./policyApprovedVersion";
import { sendApprovedDocument } from "./approvedDocumentView";
import { vlsContext } from "./vlsSupport";
import { isValidIfuUrl } from "../shared/ifu";
import { isYmd } from "../shared/stainLogRules";
import {
  canCompletePm, completesPmByDefault, EQUIP_EVENT_LABEL, EQUIP_EVENT_TYPES, EQUIP_FILE_KIND_LABEL, EQUIP_FILE_MAX_MB, EQUIP_FILE_TYPES, isLocalMinute, minutesBetween, planPmDue,
} from "../shared/equipmentPm";

type Sqlite = any;

/** An event that still stands: not corrected by a later row and not voided. `a` is the table alias with its dot, or "". */
export const LIVE_EVENT = (a = "") => `${a}superseded_by_event_id IS NULL AND ${a}voided_at IS NULL`;

export function hasEquipmentAccess(user: any, lab?: any): boolean {
  if (exportAllPlanBypass(lab)) return true; // export-all job (server/exportAllContext.ts)
  const plan = lab?.plan ?? user?.plan;
  return ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "clinic", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(plan);
}

export function equipmentStatus(nextDue: string | null): string {
  if (!nextDue) return "none";
  const today = labToday();
  const days = Math.round((Date.parse(nextDue + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
  if (days < 0) return "overdue";
  if (days <= 30) return "due_soon";
  return "ok";
}

export interface MaintainSettings { require_vendor_report: boolean }
export function readMaintainSettings(sqlite: Sqlite, labId: number): MaintainSettings {
  const row = sqlite.prepare("SELECT require_vendor_report FROM maintain_settings WHERE lab_id = ?").get(labId) as any;
  return { require_vendor_report: row?.require_vendor_report === 1 };
}

const nowLocal = () => labLocalDate(new Date().toISOString(), true).replace(" ", "T");
const text = (v: any, max: number): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const truthy = (v: any) => v === true || v === 1 || v === "1" || v === "true";

/** A plain copy of table rows into another lab's record: every column but id, with the named columns replaced. Old id to new id. */
function copyRows(sqlite: Sqlite, table: string, rows: any[], change: (row: any) => Record<string, any>): Map<number, number> {
  const cols = (sqlite.prepare(`PRAGMA table_info("${table}")`).all() as any[]).map((c) => c.name as string).filter((c) => c !== "id");
  const ins = sqlite.prepare(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((c) => `@${c}`).join(", ")})`);
  const ids = new Map<number, number>();
  for (const row of rows) {
    const next: Record<string, any> = {};
    const over = change(row);
    for (const c of cols) next[c] = Object.prototype.hasOwnProperty.call(over, c) ? over[c] : row[c] ?? null;
    ids.set(row.id, Number(ins.run(next).lastInsertRowid));
  }
  return ids;
}

export function registerEquipmentRoutes(app: Express, deps: {
  authMiddleware: any;
  labScopeMiddleware: any;
  requireWriteAccess: any;
  requireModuleEdit: (mod: string) => any;
  hasModuleEditAccess: (labId: number, userId: number, module: string) => boolean;
  resolveLabMapInstrument: (sqlite: any, labId: number, id: any) => any;
  /** True when this person can add records in that lab now (its subscription or trial hasn't ended). */
  labAcceptsWrites: (labId: number, userId: number) => boolean;
}) {
  const { authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit, hasModuleEditAccess, resolveLabMapInstrument } = deps;
  const sqlite = (): Sqlite => (db as any).$client;
  const E = "/api/labs/:labId/equipment";
  const multer = require("multer"); // same CJS load as the VeritaLab upload route
  const uploadOne = multer({ storage: multer.memoryStorage(), limits: { fileSize: EQUIP_FILE_MAX_MB * 1024 * 1024, files: 1 } }).single("file");
  // The upload finishes outside the context labScopeMiddleware opened, so a Veritas support upload re-enters it (BUG-014).
  const upload = (req: any, res: any, next: any) => uploadOne(req, res, (err: any) => {
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? `The file is too large (the limit is ${EQUIP_FILE_MAX_MB} MB).` : "Upload failed." });
    if (req.scope?.viaVlsSupport) return vlsContext.run({ actingAs: "vls_support", labId: req.scope.labId, userId: req.userId }, () => next());
    next();
  });
  const planGate = (req: any, res: any, next: any) => {
    if (hasEquipmentAccess(req.user, req.scope?.lab)) return next();
    res.status(403).json({ error: "Equipment maintenance requires a suite subscription" });
  };
  const read = [authMiddleware, labScopeMiddleware, planGate];
  const record = [authMiddleware, labScopeMiddleware, requireWriteAccess, planGate];
  const setup = [authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritamaintain"), planGate];

  const userName = (userId: number): string | null => {
    const u = sqlite().prepare("SELECT name, email FROM users WHERE id = ?").get(userId) as any;
    return u ? (u.name || u.email || null) : null;
  };
  const equipmentIn = (req: any): any => {
    const id = Number(req.params.id);
    return Number.isInteger(id) && id > 0 ? (sqlite().prepare("SELECT * FROM lab_equipment WHERE id = ? AND lab_id = ?").get(id, req.scope.labId) as any) ?? null : null;
  };
  const notFound = (res: any) => res.status(404).json({ error: "Equipment not found in this lab" });
  const movedAway = (res: any, eq: any) => res.status(409).json({ error: `This instrument moved to ${eq.moved_to_lab_name || "another lab"}. Its record here is read-only.`, code: "MOVED_AWAY" });
  const audit = (req: any, action: any, entityType: string, entityId: number, label: string, before: any, after: any) => logAudit({
    userId: req.userId, ownerUserId: req.scope?.lab?.owner_user_id, module: "veritamaintain", action, entityType, entityId, entityLabel: label,
    before: before ?? undefined, after: { ...(after ?? {}), lab_id: req.scope.labId }, ipAddress: req.ip,
  });
  const eventName = (ev: any) => `${EQUIP_EVENT_LABEL[ev.event_type] || ev.event_type} ${ev.event_date}`;

  // A limited Staff login reads its own sign-in name and nobody else's (the stain log's rule).
  const namesFor = (req: any) => {
    const limited = !!staffOwnScope(sqlite(), req.userId, req.scope.labId, "veritamaintain");
    const pairs: [string, string][] = [["logged_by_user_id", "logged_by_name"], ["corrected_by_user_id", "corrected_by_name"], ["voided_by_user_id", "voided_by_name"],
      ["uploaded_by_user_id", "uploaded_by_name"], ["removed_by_user_id", "removed_by_name"], ["started_by_user_id", "started_by_name"], ["ended_by_user_id", "ended_by_name"],
      ["retired_by_user_id", "retired_by_name"]];
    return <T extends Record<string, any>>(row: T): T => {
      if (!limited) return row;
      const out: any = { ...row };
      for (const [id, name] of pairs) if (name in out && out[id] !== req.userId) out[name] = null;
      return out;
    };
  };

  const FILE_COLS = "id, lab_id, equipment_id, event_id, kind, original_filename, mime_type, file_size, uploaded_by_user_id, uploaded_by_name, uploaded_at, removed_at, removed_by_user_id, removed_by_name, removal_reason, carried_from_lab_id, carried_from_lab_name";
  const openDowntime = (labId: number, equipmentId: number): any =>
    sqlite().prepare("SELECT id, down_from, reason FROM equipment_downtime WHERE lab_id = ? AND equipment_id = ? AND down_until IS NULL ORDER BY id DESC LIMIT 1").get(labId, equipmentId) ?? null;
  const decorate = (row: any) => ({ ...row, maintenance_status: equipmentStatus(row.next_due_date), out_of_service: openDowntime(row.lab_id, row.id) });

  // ── List, add ───────────────────────────────────────────────────────────────────────────────────────

  app.get(E, ...read, (req: any, res: any) => {
    const retired = String(req.query?.retired || "") === "1";
    const rows = sqlite().prepare(
      `SELECT * FROM lab_equipment WHERE lab_id = ? AND status ${retired ? "=" : "<>"} 'retired' ORDER BY ${retired ? "COALESCE(retired_at, updated_at) DESC, " : ""}instrument_name ASC`
    ).all(req.scope.labId) as any[];
    const names = namesFor(req);
    const waiting = new Map((sqlite().prepare(
      `SELECT equipment_id, COUNT(*) AS n FROM equipment_maintenance_events WHERE lab_id = ? AND completes_pm = 1 AND pm_complete = 0 AND ${LIVE_EVENT()} GROUP BY equipment_id`
    ).all(req.scope.labId) as any[]).map((r) => [r.equipment_id, r.n]));
    res.json(rows.map((r) => names({ ...decorate(r), awaiting_vendor_report: waiting.get(r.id) ?? 0 })));
  });

  // The fields both add and edit write; a problem is the message to send back.
  const cleanRecord = (req: any, b: any): { error?: string; values?: Record<string, any> } => {
    const values: Record<string, any> = {};
    if (b.placed_in_service_date !== undefined) {
      const d = text(b.placed_in_service_date, 10);
      if (d && !isYmd(d)) return { error: "The date placed in service isn't a date" };
      values.placed_in_service_date = d;
    }
    if (b.vendor_name !== undefined) values.vendor_name = text(b.vendor_name, 200);
    if (b.service_contract !== undefined) values.service_contract = text(b.service_contract, 4000);
    if (b.ifu_url !== undefined) {
      const u = text(b.ifu_url, 1000);
      if (u && !isValidIfuUrl(u)) return { error: "The IFU link must be a web address starting with http or https" };
      values.ifu_url = u;
    }
    if (b.ifu_document_id !== undefined) {
      let docId: number | null = null;
      if (b.ifu_document_id !== null && b.ifu_document_id !== "") {
        const doc = sqlite().prepare("SELECT id FROM policy_documents WHERE id = ? AND lab_id = ? AND archived_at IS NULL").get(Number(b.ifu_document_id), req.scope.labId) as any;
        if (!doc) return { error: "That document isn't in this lab's VeritaDC" };
        docId = doc.id;
      }
      values.ifu_document_id = docId;
    }
    return { values };
  };

  app.post(E, ...setup, (req: any, res: any) => {
    const b = req.body || {};
    if (!b.instrument_name || !String(b.instrument_name).trim()) return res.status(400).json({ error: "instrument_name required" });
    const now = new Date().toISOString();
    let linkId: number | null = null;
    if (b.map_instrument_id !== undefined && b.map_instrument_id !== null && b.map_instrument_id !== "") {
      const mi = resolveLabMapInstrument(sqlite(), req.scope.labId, b.map_instrument_id);
      if (!mi) return res.status(400).json({ error: "Analyzer not found on this lab's test menu" });
      linkId = mi.id;
    }
    const clean = cleanRecord(req, b);
    if (clean.error) return res.status(400).json({ error: clean.error });
    const v = clean.values!;
    const ins = sqlite().prepare(
      `INSERT INTO lab_equipment (lab_id, instrument_name, manufacturer, model, serial_number, location, pm_interval_days, next_due_date, status, notes, map_instrument_id,
         placed_in_service_date, vendor_name, service_contract, ifu_url, ifu_document_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,'active',?,?,?,?,?,?,?,?,?)`
    ).run(req.scope.labId, String(b.instrument_name).trim(), b.manufacturer || null, b.model || null, b.serial_number || null, b.location || null,
      b.pm_interval_days != null && b.pm_interval_days !== "" ? Number(b.pm_interval_days) : null, b.next_due_date || null, b.notes || null, linkId,
      v.placed_in_service_date ?? null, v.vendor_name ?? null, v.service_contract ?? null, v.ifu_url ?? null, v.ifu_document_id ?? null, now, now);
    const row = sqlite().prepare("SELECT * FROM lab_equipment WHERE id = ?").get(ins.lastInsertRowid) as any;
    audit(req, "create", "equipment", row.id, row.instrument_name, null, row);
    res.json(decorate(row));
  });

  // ── Reminder settings (the nightly engine is server/equipmentReminders.ts). Before /:id so the words aren't read as an id. ──
  function readEquipmentReminderConfig(labId: number) {
    const row = sqlite().prepare("SELECT * FROM equipment_reminder_config WHERE lab_id = ?").get(labId) as any;
    let recipients: any[] = [];
    try { recipients = row ? JSON.parse(row.recipients_json || "[]") : []; } catch { recipients = []; }
    return { lab_id: labId, enabled: row ? !!row.enabled : false, lead_days: row ? row.lead_days : 14, overdue_cadence_days: row ? row.overdue_cadence_days : 7, recipients, configured: !!row };
  }
  function writeEquipmentReminderConfig(labId: number, body: any) {
    const { enabled, lead_days, overdue_cadence_days, recipients } = body || {};
    const enabledInt = enabled ? 1 : 0;
    const lead = Math.max(1, Math.min(90, Number.isFinite(+lead_days) ? Math.round(+lead_days) : 14));
    const cadence = Math.max(1, Math.min(30, Number.isFinite(+overdue_cadence_days) ? Math.round(+overdue_cadence_days) : 7));
    let recips: { email: string; name?: string }[] = [];
    if (Array.isArray(recipients)) {
      recips = recipients
        .map((r: any) => (typeof r === "string" ? { email: r } : { email: r?.email, name: r?.name }))
        .filter((r: any) => r.email && typeof r.email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email))
        .map((r: any) => ({ email: String(r.email).trim(), ...(r.name ? { name: String(r.name).trim() } : {}) }));
    }
    const now = new Date().toISOString();
    const existing = sqlite().prepare("SELECT id FROM equipment_reminder_config WHERE lab_id = ?").get(labId) as any;
    if (existing) {
      sqlite().prepare("UPDATE equipment_reminder_config SET enabled=?, lead_days=?, overdue_cadence_days=?, recipients_json=?, updated_at=? WHERE lab_id=?").run(enabledInt, lead, cadence, JSON.stringify(recips), now, labId);
    } else {
      sqlite().prepare("INSERT INTO equipment_reminder_config (lab_id, enabled, lead_days, overdue_cadence_days, recipients_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run(labId, enabledInt, lead, cadence, JSON.stringify(recips), now, now);
    }
    return { lab_id: labId, enabled: !!enabledInt, lead_days: lead, overdue_cadence_days: cadence, recipients: recips, configured: true };
  }
  app.get(`${E}/reminder-config`, ...read, (req: any, res: any) => {
    res.json(readEquipmentReminderConfig(req.scope.labId));
  });
  app.put(`${E}/reminder-config`, ...setup, (req: any, res: any) => {
    res.json(writeEquipmentReminderConfig(req.scope.labId, req.body));
  });

  // ── The lab's VeritaMaintain settings ───────────────────────────────────────────────────────────────

  app.get("/api/labs/:labId/equipment-settings", ...read, (req: any, res: any) => {
    res.json({ ...readMaintainSettings(sqlite(), req.scope.labId), can_edit: hasModuleEditAccess(req.scope.labId, req.userId, "veritamaintain") });
  });
  app.put("/api/labs/:labId/equipment-settings", ...setup, (req: any, res: any) => {
    const before = readMaintainSettings(sqlite(), req.scope.labId);
    const next = { require_vendor_report: req.body?.require_vendor_report !== undefined ? truthy(req.body.require_vendor_report) : before.require_vendor_report };
    const now = new Date().toISOString();
    sqlite().prepare(
      `INSERT INTO maintain_settings (lab_id, require_vendor_report, updated_by_user_id, created_at, updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(lab_id) DO UPDATE SET require_vendor_report = excluded.require_vendor_report, updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`
    ).run(req.scope.labId, next.require_vendor_report ? 1 : 0, req.userId, now, now);
    if (before.require_vendor_report !== next.require_vendor_report) audit(req, "update", "maintain_settings", req.scope.labId, "VeritaMaintain settings", before, next);
    res.json(next);
  });

  // ── One record ──────────────────────────────────────────────────────────────────────────────────────

  app.get(`${E}/:id/record`, ...read, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    const names = namesFor(req);
    const doc = eq.ifu_document_id
      ? (sqlite().prepare("SELECT id, title, doc_number, status, archived_at, current_version_id, approved_version_id FROM policy_documents WHERE id = ? AND lab_id = ?").get(eq.ifu_document_id, eq.lab_id) as any)
      : null;
    const now = nowLocal();
    const downtime = (sqlite().prepare("SELECT * FROM equipment_downtime WHERE lab_id = ? AND equipment_id = ? ORDER BY down_from DESC, id DESC").all(eq.lab_id, eq.id) as any[])
      .map((d) => names({ ...d, minutes: minutesBetween(d.down_from, d.down_until || now) }));
    const files = (sqlite().prepare(`SELECT ${FILE_COLS} FROM equipment_files WHERE lab_id = ? AND equipment_id = ? AND event_id IS NULL ORDER BY id DESC`).all(eq.lab_id, eq.id) as any[]).map(names);
    const menu = eq.map_instrument_id ? resolveLabMapInstrument(sqlite(), eq.lab_id, eq.map_instrument_id) : null;
    res.json({
      equipment: names(decorate(eq)),
      ifu_document: eq.ifu_document_id ? { id: eq.ifu_document_id, title: doc?.title ?? null, doc_number: doc?.doc_number ?? null, readable: approvedReadVersionId(doc) != null } : null,
      downtime,
      files,
      menu_instrument: menu ? { id: menu.id, name: menu.nickname || menu.instrument_name, map_name: menu.map_name } : null,
      settings: readMaintainSettings(sqlite(), eq.lab_id),
      can_edit: hasModuleEditAccess(eq.lab_id, req.userId, "veritamaintain"),
      now_local: now,
    });
  });

  // The linked VeritaDC document at its current approved version, for anyone who reads this record.
  app.get(`${E}/:id/ifu-document`, ...read, async (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (!eq.ifu_document_id) return res.status(404).json({ error: "No IFU document is linked to this instrument" });
    await sendApprovedDocument(sqlite(), req, res, { labId: eq.lab_id, documentId: eq.ifu_document_id, surface: "equipment_ifu" });
  });

  app.put(`${E}/:id`, ...setup, (req: any, res: any) => {
    const ex = equipmentIn(req);
    if (!ex) return notFound(res);
    if (ex.moved_to_lab_id) return movedAway(res, ex);
    const b = req.body || {}; const now = new Date().toISOString();
    if (b.status !== undefined && b.status !== ex.status) {
      return res.status(400).json({ error: b.status === "retired" ? "Retire needs a reason. Use Retire." : "Use Restore to bring an instrument back.", code: "REASON_REQUIRED" });
    }
    const keep = (v: any, cur: any) => (v !== undefined ? v : cur);
    let linkId: number | null = ex.map_instrument_id ?? null;
    if (b.map_instrument_id !== undefined) {
      linkId = null;
      if (b.map_instrument_id !== null && b.map_instrument_id !== "") {
        const mi = resolveLabMapInstrument(sqlite(), req.scope.labId, b.map_instrument_id);
        if (!mi) return res.status(400).json({ error: "Analyzer not found on this lab's test menu" });
        linkId = mi.id;
      }
    }
    const clean = cleanRecord(req, b);
    if (clean.error) return res.status(400).json({ error: clean.error });
    const v = clean.values!;
    sqlite().prepare(
      `UPDATE lab_equipment SET instrument_name=?, manufacturer=?, model=?, serial_number=?, location=?, pm_interval_days=?, next_due_date=?, notes=?, map_instrument_id=?,
         placed_in_service_date=?, vendor_name=?, service_contract=?, ifu_url=?, ifu_document_id=?, updated_at=? WHERE id=?`
    ).run(
      b.instrument_name !== undefined ? String(b.instrument_name).trim() : ex.instrument_name,
      keep(b.manufacturer, ex.manufacturer), keep(b.model, ex.model), keep(b.serial_number, ex.serial_number),
      keep(b.location, ex.location),
      b.pm_interval_days !== undefined ? (b.pm_interval_days !== "" && b.pm_interval_days !== null ? Number(b.pm_interval_days) : null) : ex.pm_interval_days,
      b.next_due_date !== undefined ? (b.next_due_date || null) : ex.next_due_date,
      keep(b.notes, ex.notes), linkId,
      keep(v.placed_in_service_date, ex.placed_in_service_date), keep(v.vendor_name, ex.vendor_name), keep(v.service_contract, ex.service_contract),
      keep(v.ifu_url, ex.ifu_url), keep(v.ifu_document_id, ex.ifu_document_id), now, ex.id,
    );
    const row = sqlite().prepare("SELECT * FROM lab_equipment WHERE id = ?").get(ex.id) as any;
    const changed = Object.keys(row).filter((k) => k !== "updated_at" && row[k] !== ex[k]);
    if (changed.length) audit(req, "update", "equipment", ex.id, row.instrument_name, Object.fromEntries(changed.map((k) => [k, ex[k]])), Object.fromEntries(changed.map((k) => [k, row[k]])));
    res.json(decorate(row));
  });

  // An instrument that holds records is retired, not deleted. One added by mistake, holding nothing, can go.
  app.delete(`${E}/:id`, ...setup, (req: any, res: any) => {
    const ex = equipmentIn(req);
    if (!ex) return notFound(res);
    const count = (sql: string, ...a: any[]) => Number((sqlite().prepare(sql).get(...a) as any).n);
    // A stain log is a record the lab keeps (Q178 = 1): an instrument holding one is retired, not deleted. Rows nothing was recorded on go with it.
    const stainEntries = count("SELECT COUNT(*) AS n FROM stain_log_entries WHERE equipment_id = ? AND lab_id = ?", ex.id, req.scope.labId);
    if (stainEntries > 0) return res.status(409).json({ error: `This instrument holds ${stainEntries} stain log ${stainEntries === 1 ? "entry" : "entries"}, so it can't be deleted. Retire it instead.`, code: "HOLDS_STAIN_LOG", entry_count: stainEntries });
    const held = count("SELECT COUNT(*) AS n FROM equipment_maintenance_events WHERE equipment_id = ?", ex.id)
      + count("SELECT COUNT(*) AS n FROM equipment_files WHERE equipment_id = ?", ex.id)
      + count("SELECT COUNT(*) AS n FROM equipment_downtime WHERE equipment_id = ?", ex.id)
      + count("SELECT COUNT(*) AS n FROM maintain_record_reviews WHERE lab_id = ? AND item_type = 'equipment' AND item_id = ?", req.scope.labId, ex.id)
      + (ex.moved_to_lab_id || ex.moved_from_lab_id ? 1 : 0);
    if (held > 0) return res.status(409).json({ error: "This instrument holds records, so it can't be deleted. Retire it instead.", code: "HOLDS_RECORDS" });
    audit(req, "delete", "equipment", ex.id, ex.instrument_name, ex, {});
    sqlite().prepare("DELETE FROM stain_log_rows WHERE equipment_id = ? AND lab_id = ?").run(ex.id, req.scope.labId);
    sqlite().prepare("DELETE FROM lab_equipment WHERE id = ?").run(ex.id);
    res.json({ ok: true });
  });

  // ── Retire and restore ──────────────────────────────────────────────────────────────────────────────

  app.post(`${E}/:id/retire`, ...setup, (req: any, res: any) => {
    const ex = equipmentIn(req);
    if (!ex) return notFound(res);
    if (ex.status === "retired") return res.status(409).json({ error: "This instrument is already retired", code: "ALREADY_RETIRED" });
    const reason = text(req.body?.reason, 1000);
    if (!reason) return res.status(400).json({ error: "Enter why this instrument is being retired", code: "REASON_REQUIRED" });
    const day = text(req.body?.removed_from_service_date, 10) ?? labToday();
    if (!isYmd(day)) return res.status(400).json({ error: "The date removed from service isn't a date", code: "BAD_DATE" });
    if (day > labToday()) return res.status(400).json({ error: "The date removed from service can't be in the future", code: "BAD_DATE" });
    if (ex.placed_in_service_date && day < ex.placed_in_service_date) return res.status(400).json({ error: "It can't be removed from service before it was placed in service", code: "BAD_DATE" });
    const now = new Date().toISOString();
    const name = userName(req.userId);
    sqlite().transaction(() => {
      sqlite().prepare("UPDATE lab_equipment SET status = 'retired', removed_from_service_date = ?, removed_from_service_reason = ?, retired_at = ?, retired_by_user_id = ?, retired_by_name = ?, updated_at = ? WHERE id = ?")
        .run(day, reason, now, req.userId, name, now, ex.id);
      closeDowntime(ex, "Retired", req.userId, name, now);
    })();
    audit(req, "update", "equipment_retired", ex.id, `${ex.instrument_name} retired`, { status: ex.status }, { status: "retired", removed_from_service_date: day, reason });
    res.json(decorate(sqlite().prepare("SELECT * FROM lab_equipment WHERE id = ?").get(ex.id)));
  });

  app.post(`${E}/:id/restore`, ...setup, (req: any, res: any) => {
    const ex = equipmentIn(req);
    if (!ex) return notFound(res);
    if (ex.moved_to_lab_id) return movedAway(res, ex);
    if (ex.status !== "retired") return res.status(409).json({ error: "This instrument isn't retired", code: "NOT_RETIRED" });
    const now = new Date().toISOString();
    sqlite().prepare("UPDATE lab_equipment SET status = 'active', removed_from_service_date = NULL, removed_from_service_reason = NULL, retired_at = NULL, retired_by_user_id = NULL, retired_by_name = NULL, updated_at = ? WHERE id = ?").run(now, ex.id);
    audit(req, "restore", "equipment", ex.id, `${ex.instrument_name} restored`,
      { status: "retired", removed_from_service_date: ex.removed_from_service_date, reason: ex.removed_from_service_reason, retired_by: ex.retired_by_name, retired_at: ex.retired_at },
      { status: "active", note: text(req.body?.note, 1000) });
    res.json(decorate(sqlite().prepare("SELECT * FROM lab_equipment WHERE id = ?").get(ex.id)));
  });

  // ── Out of service ──────────────────────────────────────────────────────────────────────────────────

  // Ends the open period when the record leaves service here; a period that started later than now ends where it started.
  function closeDowntime(eq: any, note: string, userId: number, name: string | null, now: string) {
    const open = openDowntime(eq.lab_id, eq.id);
    if (!open) return;
    const until = nowLocal() > open.down_from ? nowLocal() : open.down_from;
    sqlite().prepare("UPDATE equipment_downtime SET down_until = ?, return_note = ?, ended_by_user_id = ?, ended_by_name = ?, updated_at = ? WHERE id = ?").run(until, note, userId, name, now, open.id);
  }
  const downtimeIn = (req: any, eq: any): any => sqlite().prepare("SELECT * FROM equipment_downtime WHERE id = ? AND equipment_id = ? AND lab_id = ?").get(Number(req.params.downtimeId), eq.id, eq.lab_id) ?? null;
  const overlaps = (eq: any, from: string, until: string | null, exceptId = 0): boolean =>
    (sqlite().prepare("SELECT id, down_from, down_until FROM equipment_downtime WHERE lab_id = ? AND equipment_id = ? AND id <> ?").all(eq.lab_id, eq.id, exceptId) as any[])
      .some((d) => from < (d.down_until || "9999-12-31T23:59") && d.down_from < (until || "9999-12-31T23:59"));

  app.post(`${E}/:id/downtime`, ...setup, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.status === "retired") return res.status(409).json({ error: "This instrument is retired", code: "RETIRED" });
    const reason = text(req.body?.reason, 1000);
    if (!reason) return res.status(400).json({ error: "Enter why it's out of service", code: "REASON_REQUIRED" });
    const from = req.body?.down_from ?? nowLocal();
    if (!isLocalMinute(from)) return res.status(400).json({ error: "Enter the date and time it went out of service", code: "BAD_DATE" });
    if (from > nowLocal()) return res.status(400).json({ error: "The start can't be in the future", code: "BAD_DATE" });
    if (openDowntime(eq.lab_id, eq.id)) return res.status(409).json({ error: "This instrument is already out of service", code: "ALREADY_OUT" });
    if (overlaps(eq, from, null)) return res.status(409).json({ error: "That overlaps another out of service period", code: "OVERLAP" });
    const now = new Date().toISOString();
    const r = sqlite().prepare("INSERT INTO equipment_downtime (lab_id, equipment_id, down_from, reason, started_by_user_id, started_by_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(eq.lab_id, eq.id, from, reason, req.userId, userName(req.userId), now, now);
    audit(req, "create", "equipment_downtime", Number(r.lastInsertRowid), `${eq.instrument_name} out of service`, null, { equipment_id: eq.id, down_from: from, reason });
    res.status(201).json(sqlite().prepare("SELECT * FROM equipment_downtime WHERE id = ?").get(r.lastInsertRowid));
  });

  app.post(`${E}/:id/downtime/:downtimeId/end`, ...setup, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    const d = downtimeIn(req, eq);
    if (!d) return res.status(404).json({ error: "That out of service period isn't on this instrument" });
    if (d.carried_from_lab_id) return res.status(409).json({ error: "That period came from another lab and is read-only", code: "CARRIED_READ_ONLY" });
    if (d.down_until) return res.status(409).json({ error: "That period already ended", code: "ALREADY_ENDED" });
    const until = req.body?.down_until ?? nowLocal();
    if (!isLocalMinute(until)) return res.status(400).json({ error: "Enter the date and time it came back", code: "BAD_DATE" });
    if (until > nowLocal()) return res.status(400).json({ error: "The stop can't be in the future", code: "BAD_DATE" });
    if (until < d.down_from) return res.status(400).json({ error: "It can't come back before it went out", code: "BAD_DATE" });
    const now = new Date().toISOString();
    const note = text(req.body?.return_note, 1000);
    sqlite().prepare("UPDATE equipment_downtime SET down_until = ?, return_note = ?, ended_by_user_id = ?, ended_by_name = ?, updated_at = ? WHERE id = ?").run(until, note, req.userId, userName(req.userId), now, d.id);
    audit(req, "update", "equipment_downtime", d.id, `${eq.instrument_name} back in service`, { down_until: null }, { equipment_id: eq.id, down_until: until, return_note: note });
    res.json({ ...sqlite().prepare("SELECT * FROM equipment_downtime WHERE id = ?").get(d.id) as any, minutes: minutesBetween(d.down_from, until) });
  });

  // A correction to a period: the values before are in the audit row, with the reason.
  app.put(`${E}/:id/downtime/:downtimeId`, ...setup, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.moved_to_lab_id) return movedAway(res, eq);
    const d = downtimeIn(req, eq);
    if (!d) return res.status(404).json({ error: "That out of service period isn't on this instrument" });
    if (d.carried_from_lab_id) return res.status(409).json({ error: "That period came from another lab and is read-only", code: "CARRIED_READ_ONLY" });
    const why = text(req.body?.correction_reason, 1000);
    if (!why) return res.status(400).json({ error: "Enter why this is being corrected", code: "REASON_REQUIRED" });
    const from = req.body?.down_from ?? d.down_from;
    const until = req.body?.down_until !== undefined ? (req.body.down_until || null) : d.down_until;
    const reason = req.body?.reason !== undefined ? text(req.body.reason, 1000) : d.reason;
    if (!reason) return res.status(400).json({ error: "Enter why it was out of service", code: "REASON_REQUIRED" });
    if (!isLocalMinute(from) || (until && !isLocalMinute(until))) return res.status(400).json({ error: "Enter the dates and times", code: "BAD_DATE" });
    if (from > nowLocal() || (until && until > nowLocal())) return res.status(400).json({ error: "Those can't be in the future", code: "BAD_DATE" });
    if (until && until < from) return res.status(400).json({ error: "It can't come back before it went out", code: "BAD_DATE" });
    if (!until && eq.status === "retired") return res.status(400).json({ error: "A retired instrument's period needs its stop", code: "BAD_DATE" });
    if (overlaps(eq, from, until, d.id)) return res.status(409).json({ error: "That overlaps another out of service period", code: "OVERLAP" });
    sqlite().prepare("UPDATE equipment_downtime SET down_from = ?, down_until = ?, reason = ?, updated_at = ? WHERE id = ?").run(from, until, reason, new Date().toISOString(), d.id);
    audit(req, "update", "equipment_downtime", d.id, `${eq.instrument_name} out of service period corrected`, { down_from: d.down_from, down_until: d.down_until, reason: d.reason }, { equipment_id: eq.id, down_from: from, down_until: until, reason, correction_reason: why });
    res.json(sqlite().prepare("SELECT * FROM equipment_downtime WHERE id = ?").get(d.id));
  });

  // ── Events ──────────────────────────────────────────────────────────────────────────────────────────

  const eventIn = (req: any, eq: any): any => sqlite().prepare("SELECT * FROM equipment_maintenance_events WHERE id = ? AND equipment_id = ? AND lab_id = ?").get(Number(req.params.eventId), eq.id, eq.lab_id) ?? null;
  const rootOf = (ev: any): number => ev.root_event_id ?? ev.id;
  const setDue = (equipmentId: number, due: string | null, now: string) => sqlite().prepare("UPDATE lab_equipment SET next_due_date = ?, updated_at = ? WHERE id = ?").run(due, now, equipmentId);

  // Each standing entry, newest first, with its files and the versions a correction replaced.
  app.get(`${E}/:id/events`, ...read, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    const names = namesFor(req);
    const all = (sqlite().prepare("SELECT * FROM equipment_maintenance_events WHERE equipment_id = ? AND lab_id = ? ORDER BY event_date DESC, id DESC").all(eq.id, eq.lab_id) as any[]).map(names);
    const files = (sqlite().prepare(`SELECT ${FILE_COLS} FROM equipment_files WHERE lab_id = ? AND equipment_id = ? AND event_id IS NOT NULL ORDER BY id`).all(eq.lab_id, eq.id) as any[]).map(names);
    res.json(all.filter((e) => !e.superseded_by_event_id).map((e) => ({
      ...e,
      files: files.filter((f) => f.event_id === rootOf(e)),
      earlier_versions: all.filter((x) => x.id !== e.id && x.superseded_by_event_id && rootOf(x) === rootOf(e)).sort((a, b) => b.id - a.id),
    })));
  });

  // What an event says, checked. A correction starts from the row it replaces.
  const cleanEvent = (b: any, from: any = {}): { error?: string; code?: string; v?: any } => {
    const pick = (k: string) => (b[k] !== undefined ? b[k] : from[k]);
    const event_type = pick("event_type");
    if (!(EQUIP_EVENT_TYPES as readonly any[]).includes(event_type)) return { error: "event_type must be one of " + EQUIP_EVENT_TYPES.join(", ") };
    const event_date = pick("event_date");
    if (!event_date) return { error: "event_date required" };
    if (!isYmd(event_date)) return { error: "event_date must be a date", code: "BAD_DATE" };
    const performed_by = text(pick("performed_by"), 200);
    const notes = pick("notes") ? String(pick("notes")).slice(0, 8000) : null;
    if (event_type === "solution_change" && (!performed_by || !String(notes || "").trim())) return { error: "A solution change needs who did it and which solutions" };
    let cost: number | null = null;
    const rawCost = pick("cost");
    if (rawCost !== undefined && rawCost !== null && String(rawCost).trim() !== "") {
      cost = Number(String(rawCost).replace(/[$,\s]/g, ""));
      if (!Number.isFinite(cost) || cost < 0 || cost > 100000000) return { error: "The cost must be a number", code: "BAD_COST" };
      cost = Math.round(cost * 100) / 100;
    }
    const vendor_company = text(pick("vendor_company"), 200);
    const vendor_technician = text(pick("vendor_technician"), 200);
    const by_vendor = truthy(pick("by_vendor")) || !!vendor_company || !!vendor_technician ? 1 : 0;
    const typedRaw = b.next_due_date;
    const typed = typedRaw ? String(typedRaw) : null;
    if (typed && !isYmd(typed)) return { error: "next_due_date must be a date", code: "BAD_DATE" };
    const said = b.completes_pm !== undefined ? truthy(b.completes_pm) : from.id ? (from.completes_pm ?? (completesPmByDefault(from.event_type) ? 1 : 0)) === 1 && (event_type === from.event_type || completesPmByDefault(event_type)) : completesPmByDefault(event_type);
    const completes_pm = said && canCompletePm(event_type) ? 1 : 0;
    return { v: { event_type, event_date, performed_by, notes, cost, vendor_company, vendor_technician, by_vendor, typed, completes_pm } };
  };

  const insertEvent = (row: Record<string, any>): number => {
    const keys = Object.keys(row);
    return Number(sqlite().prepare(`INSERT INTO equipment_maintenance_events (${keys.join(", ")}) VALUES (${keys.map((k) => `@${k}`).join(", ")})`).run(row).lastInsertRowid);
  };

  // Logging a maintenance EVENT is operational work a tech performs, so staff may do it: gated by lab membership and an active
  // subscription, NOT requireModuleEdit (which stays on setup and corrections).
  app.post(`${E}/:id/events`, ...record, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.status === "retired") return res.status(409).json({ error: "This instrument is retired. Restore it to log maintenance.", code: "RETIRED" });
    const c = cleanEvent(req.body || {});
    if (c.error) return res.status(400).json({ error: c.error, ...(c.code ? { code: c.code } : {}) });
    const v = c.v;
    const now = new Date().toISOString();
    const allowEarlier = truthy(req.body?.allow_earlier_due);
    const waits = v.completes_pm === 1 && v.by_vendor === 1 && readMaintainSettings(sqlite(), eq.lab_id).require_vendor_report;
    let held: any = null;
    let eventId = 0;
    sqlite().transaction(() => {
      let nextDue: string | null = null;
      if (v.completes_pm && !waits) {
        const plan = planPmDue({ currentDue: eq.next_due_date, eventDate: v.event_date, intervalDays: eq.pm_interval_days, typedDue: v.typed, allowEarlier });
        held = plan.held;
        if (plan.computed && !plan.held) nextDue = plan.computed;
      }
      eventId = insertEvent({
        equipment_id: eq.id, lab_id: eq.lab_id, event_type: v.event_type, event_date: v.event_date, performed_by: v.performed_by, next_due_date: nextDue, notes: v.notes,
        created_at: now, updated_at: now, logged_by_user_id: req.userId, logged_by_name: userName(req.userId),
        completes_pm: v.completes_pm, pm_complete: v.completes_pm ? (waits ? 0 : 1) : null, pm_completed_at: v.completes_pm && !waits ? now : null,
        due_before: eq.next_due_date ?? null, pm_typed_due: v.completes_pm ? v.typed : null, pm_allow_earlier: allowEarlier ? 1 : 0,
        cost: v.cost, by_vendor: v.by_vendor, vendor_company: v.vendor_company, vendor_technician: v.vendor_technician, vendor_report_attached: 0,
      });
      if (nextDue) setDue(eq.id, nextDue, now);
    })();
    const ev = sqlite().prepare("SELECT * FROM equipment_maintenance_events WHERE id = ?").get(eventId) as any;
    audit(req, "create", "equipment_event", eventId, `${eq.instrument_name}: ${eventName(ev)}`, { next_due_date: eq.next_due_date }, { ...ev, due_date_held: held });
    const row = sqlite().prepare("SELECT * FROM lab_equipment WHERE id = ?").get(eq.id) as any;
    res.json({ ...decorate(row), event_id: eventId, due_date_held: held, awaiting_vendor_report_event: waits });
  });

  // Correct an entry: a new row with the corrected values; the original stays as it was and is shown under it.
  app.post(`${E}/:id/events/:eventId/correct`, ...setup, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.moved_to_lab_id) return movedAway(res, eq);
    const old = eventIn(req, eq);
    if (!old) return res.status(404).json({ error: "That entry isn't on this instrument" });
    if (old.carried_from_lab_id) return res.status(409).json({ error: "That entry came from another lab and is read-only", code: "CARRIED_READ_ONLY" });
    if (old.superseded_by_event_id) return res.status(409).json({ error: "That entry was already corrected. Correct the current one.", code: "ALREADY_CORRECTED" });
    if (old.voided_at) return res.status(409).json({ error: "That entry is voided", code: "ALREADY_VOIDED" });
    const reason = text(req.body?.reason, 1000);
    if (!reason) return res.status(400).json({ error: "Enter why this entry is being corrected", code: "REASON_REQUIRED" });
    const c = cleanEvent(req.body || {}, old);
    if (c.error) return res.status(400).json({ error: c.error, ...(c.code ? { code: c.code } : {}) });
    const v = c.v;
    const now = new Date().toISOString();
    const allowEarlier = truthy(req.body?.allow_earlier_due);
    const inForce = !!old.next_due_date && old.next_due_date === eq.next_due_date;
    const hasReport = hasVendorReport(eq.lab_id, rootOf(old));
    const waits = v.completes_pm === 1 && v.by_vendor === 1 && !hasReport && readMaintainSettings(sqlite(), eq.lab_id).require_vendor_report && old.pm_complete !== 1;
    let held: any = null;
    let newId = 0;
    sqlite().transaction(() => {
      let nextDue: string | null = old.next_due_date ?? null;
      // Only what the due date is worked out from can move it; a corrected note or name leaves it alone.
      const dueInputs = v.event_date !== old.event_date || !!v.typed || v.completes_pm !== (old.completes_pm ?? (completesPmByDefault(old.event_type) ? 1 : 0)) || (old.pm_complete === 0 && !waits);
      if (dueInputs && v.completes_pm && !waits) {
        const plan = planPmDue({ currentDue: eq.next_due_date, eventDate: v.event_date, intervalDays: eq.pm_interval_days, typedDue: v.typed, allowEarlier });
        held = plan.held;
        if (plan.computed && !plan.held) nextDue = plan.computed; else if (!plan.computed) nextDue = null;
      } else if (dueInputs && !v.completes_pm && inForce) {
        // It never completed PM after all. The date it set goes back only when the person says so.
        if (allowEarlier) { nextDue = null; setDue(eq.id, old.due_before ?? null, now); } else held = { keeps: eq.next_due_date, works_out_to: old.due_before ?? null };
      } else if (dueInputs && !v.completes_pm) nextDue = null;
      newId = insertEvent({
        equipment_id: eq.id, lab_id: eq.lab_id, event_type: v.event_type, event_date: v.event_date, performed_by: v.performed_by, next_due_date: nextDue, notes: v.notes,
        created_at: now, updated_at: now, logged_by_user_id: old.logged_by_user_id, logged_by_name: old.logged_by_name,
        completes_pm: v.completes_pm, pm_complete: v.completes_pm ? (waits ? 0 : 1) : null, pm_completed_at: v.completes_pm && !waits ? (old.pm_completed_at ?? now) : null,
        due_before: inForce ? old.due_before : (eq.next_due_date ?? null), pm_typed_due: v.completes_pm ? (v.typed ?? old.pm_typed_due ?? null) : null, pm_allow_earlier: allowEarlier ? 1 : 0,
        cost: v.cost, by_vendor: v.by_vendor, vendor_company: v.vendor_company, vendor_technician: v.vendor_technician, vendor_report_attached: hasReport ? 1 : 0,
        root_event_id: rootOf(old), corrects_event_id: old.id, correction_reason: reason, corrected_by_user_id: req.userId, corrected_by_name: userName(req.userId), corrected_at: now,
      });
      sqlite().prepare("UPDATE equipment_maintenance_events SET superseded_by_event_id = ? WHERE id = ?").run(newId, old.id);
      if (dueInputs && v.completes_pm && nextDue && !held && !waits) setDue(eq.id, nextDue, now);
    })();
    const ev = sqlite().prepare("SELECT * FROM equipment_maintenance_events WHERE id = ?").get(newId) as any;
    audit(req, "update", "equipment_event", newId, `${eq.instrument_name}: ${eventName(ev)} corrected`, old, { ...ev, reason, due_date_held: held });
    const row = sqlite().prepare("SELECT * FROM lab_equipment WHERE id = ?").get(eq.id) as any;
    res.json({ ...decorate(row), event_id: newId, due_date_held: held });
  });

  // Void an entry made by mistake (the wrong instrument, twice). The row stays, with who and why.
  app.post(`${E}/:id/events/:eventId/void`, ...setup, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.moved_to_lab_id) return movedAway(res, eq);
    const ev = eventIn(req, eq);
    if (!ev) return res.status(404).json({ error: "That entry isn't on this instrument" });
    if (ev.carried_from_lab_id) return res.status(409).json({ error: "That entry came from another lab and is read-only", code: "CARRIED_READ_ONLY" });
    if (ev.superseded_by_event_id) return res.status(409).json({ error: "That entry was already corrected. Void the current one.", code: "ALREADY_CORRECTED" });
    if (ev.voided_at) return res.status(409).json({ error: "That entry is already voided", code: "ALREADY_VOIDED" });
    const reason = text(req.body?.reason, 1000);
    if (!reason) return res.status(400).json({ error: "Enter why this entry is being voided", code: "REASON_REQUIRED" });
    const now = new Date().toISOString();
    const inForce = !!ev.next_due_date && ev.next_due_date === eq.next_due_date;
    const putBack = inForce && truthy(req.body?.allow_earlier_due);
    sqlite().transaction(() => {
      sqlite().prepare("UPDATE equipment_maintenance_events SET voided_at = ?, voided_by_user_id = ?, voided_by_name = ?, void_reason = ?, updated_at = ? WHERE id = ?").run(now, req.userId, userName(req.userId), reason, now, ev.id);
      if (putBack) setDue(eq.id, ev.due_before ?? null, now);
    })();
    audit(req, "update", "equipment_event", ev.id, `${eq.instrument_name}: ${eventName(ev)} voided`, ev, { voided: true, reason, next_due_date: putBack ? ev.due_before : eq.next_due_date });
    const row = sqlite().prepare("SELECT * FROM lab_equipment WHERE id = ?").get(eq.id) as any;
    res.json({ ...decorate(row), due_date_held: inForce && !putBack ? { keeps: eq.next_due_date, works_out_to: ev.due_before ?? null } : null });
  });

  // ── Files ───────────────────────────────────────────────────────────────────────────────────────────

  function hasVendorReport(labId: number, rootEventId: number): boolean {
    return !!sqlite().prepare("SELECT 1 FROM equipment_files WHERE lab_id = ? AND event_id = ? AND kind = 'vendor_report' AND removed_at IS NULL LIMIT 1").get(labId, rootEventId);
  }
  const liveOf = (labId: number, rootEventId: number): any =>
    sqlite().prepare("SELECT * FROM equipment_maintenance_events WHERE lab_id = ? AND (id = ? OR root_event_id = ?) AND superseded_by_event_id IS NULL ORDER BY id DESC LIMIT 1").get(labId, rootEventId, rootEventId) ?? null;

  const saveFile = async (req: any, res: any, eq: any, ev: any | null) => {
    if (!req.file?.buffer?.length) return res.status(400).json({ error: "Choose a file", code: "NO_FILE" });
    const format = canonicalFormatFromMimeAndName(String(req.file.mimetype || ""), String(req.file.originalname || ""), req.file.buffer);
    if (!format || format === "html") return res.status(400).json({ error: `That file type isn't accepted. Use ${EQUIP_FILE_TYPES}.`, code: "BAD_TYPE" });
    const kind = EQUIP_FILE_KIND_LABEL[String(req.body?.kind)] ? String(req.body.kind) : "other";
    const now = new Date().toISOString();
    const root = ev ? rootOf(ev) : null;
    let completed: any = null;
    let fileId = 0;
    sqlite().transaction(() => {
      fileId = Number(sqlite().prepare(
        "INSERT INTO equipment_files (lab_id, equipment_id, event_id, kind, original_filename, mime_type, file_size, file_data, uploaded_by_user_id, uploaded_by_name, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
      ).run(eq.lab_id, eq.id, root, kind, String(req.file.originalname || "file").replace(/[\r\n"]/g, "").slice(0, 200), DOC_MIME[format], req.file.buffer.length, req.file.buffer, req.userId, userName(req.userId), now).lastInsertRowid);
      if (ev && kind === "vendor_report") {
        const live = liveOf(eq.lab_id, root!);
        sqlite().prepare("UPDATE equipment_maintenance_events SET vendor_report_attached = 1 WHERE id = ?").run(live.id);
        // The report is what a vendor PM was waiting for: it counts as complete now, and the due date moves by the same rule.
        if (live.completes_pm === 1 && live.pm_complete === 0 && !live.voided_at) {
          const plan = planPmDue({ currentDue: eq.next_due_date, eventDate: live.event_date, intervalDays: eq.pm_interval_days, typedDue: live.pm_typed_due, allowEarlier: live.pm_allow_earlier === 1 });
          const next = plan.computed && !plan.held ? plan.computed : null;
          sqlite().prepare("UPDATE equipment_maintenance_events SET pm_complete = 1, pm_completed_at = ?, due_before = ?, next_due_date = ? WHERE id = ?").run(now, eq.next_due_date ?? null, next, live.id);
          if (next) setDue(eq.id, next, now);
          completed = { event_id: live.id, next_due_date: next ?? eq.next_due_date, due_date_held: plan.held };
        }
      }
    })();
    audit(req, "create", "equipment_file", fileId, `${eq.instrument_name}: ${EQUIP_FILE_KIND_LABEL[kind]} ${req.file.originalname}`, null,
      { equipment_id: eq.id, event_id: ev?.id ?? null, kind, filename: req.file.originalname, size: req.file.buffer.length, pm_completed: completed });
    // PHI guard (Q56 item 4): warn, never block. server/phiUploadCheck.ts
    const phiWarning = (await checkUploadedFileForPhi(req.file)).message;
    res.status(201).json({ ...sqlite().prepare(`SELECT ${FILE_COLS} FROM equipment_files WHERE id = ?`).get(fileId) as any, pm_completed: completed, phiWarning });
  };

  // A file on the record: setup.
  app.post(`${E}/:id/files`, ...setup, upload, async (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.moved_to_lab_id) return movedAway(res, eq);
    await saveFile(req, res, eq, null);
  });

  // A file on an event: the person who logged it, or an editor.
  app.post(`${E}/:id/events/:eventId/files`, ...record, upload, async (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.moved_to_lab_id) return movedAway(res, eq);
    const ev = eventIn(req, eq);
    if (!ev) return res.status(404).json({ error: "That entry isn't on this instrument" });
    if (ev.carried_from_lab_id) return res.status(409).json({ error: "That entry came from another lab and is read-only", code: "CARRIED_READ_ONLY" });
    if (ev.voided_at) return res.status(409).json({ error: "That entry is voided", code: "ALREADY_VOIDED" });
    if (ev.logged_by_user_id !== req.userId && !hasModuleEditAccess(eq.lab_id, req.userId, "veritamaintain")) {
      return res.status(403).json({ error: "Only the person who logged it, or someone who can edit VeritaMaintain, can attach a file.", code: "NOT_YOUR_ENTRY" });
    }
    await saveFile(req, res, eq, ev);
  });

  const fileIn = (req: any, eq: any): any => sqlite().prepare("SELECT * FROM equipment_files WHERE id = ? AND equipment_id = ? AND lab_id = ?").get(Number(req.params.fileId), eq.id, eq.lab_id) ?? null;

  app.get(`${E}/:id/files/:fileId`, ...read, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    const f = fileIn(req, eq);
    if (!f) return res.status(404).json({ error: "File not found" });
    if (f.removed_at || !f.file_data) return res.status(410).json({ error: "That file was removed", code: "FILE_REMOVED" });
    res.setHeader("Content-Type", f.mime_type || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${String(f.original_filename).replace(/[^\w.\- ]+/g, "_")}"`);
    res.send(Buffer.from(f.file_data));
  });

  app.post(`${E}/:id/files/:fileId/remove`, ...setup, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.moved_to_lab_id) return movedAway(res, eq);
    const f = fileIn(req, eq);
    if (!f) return res.status(404).json({ error: "File not found" });
    if (f.removed_at) return res.status(409).json({ error: "That file was already removed", code: "ALREADY_REMOVED" });
    const reason = text(req.body?.reason, 1000);
    if (!reason) return res.status(400).json({ error: "Enter why this file is being removed", code: "REASON_REQUIRED" });
    if (f.event_id && f.kind === "vendor_report" && readMaintainSettings(sqlite(), eq.lab_id).require_vendor_report) {
      const live = liveOf(eq.lab_id, f.event_id);
      const others = Number((sqlite().prepare("SELECT COUNT(*) AS n FROM equipment_files WHERE lab_id = ? AND event_id = ? AND kind = 'vendor_report' AND removed_at IS NULL AND id <> ?").get(eq.lab_id, f.event_id, f.id) as any).n);
      if (live?.completes_pm === 1 && live?.by_vendor === 1 && live?.pm_complete === 1 && !live?.voided_at && others === 0) {
        return res.status(409).json({ error: "This lab requires a report on a vendor PM. Attach the right one first, then remove this.", code: "LAST_VENDOR_REPORT" });
      }
    }
    const now = new Date().toISOString();
    sqlite().transaction(() => {
      sqlite().prepare("UPDATE equipment_files SET file_data = NULL, removed_at = ?, removed_by_user_id = ?, removed_by_name = ?, removal_reason = ? WHERE id = ?").run(now, req.userId, userName(req.userId), reason, f.id);
      if (f.event_id && !hasVendorReport(eq.lab_id, f.event_id)) {
        const live = liveOf(eq.lab_id, f.event_id);
        if (live) sqlite().prepare("UPDATE equipment_maintenance_events SET vendor_report_attached = 0 WHERE id = ?").run(live.id);
      }
    })();
    audit(req, "update", "equipment_file", f.id, `${eq.instrument_name}: removed ${f.original_filename}`, { kind: f.kind, filename: f.original_filename, size: f.file_size, event_id: f.event_id }, { removed: true, reason });
    res.json(sqlite().prepare(`SELECT ${FILE_COLS} FROM equipment_files WHERE id = ?`).get(f.id));
  });

  // ── Move to another lab of the same organization ────────────────────────────────────────────────────

  // The labs this person could move it to: same organization, VeritaMaintain edit there, and that lab takes new records. Never a body id on trust.
  const moveTargets = (req: any): { id: number; lab_name: string; clia_number: string | null; owner_user_id: number | null; plan: string | null }[] => {
    const org = (sqlite().prepare("SELECT organization_id FROM labs WHERE id = ?").get(req.scope.labId) as any)?.organization_id;
    if (!org || !hasModuleEditAccess(req.scope.labId, req.userId, "veritamaintain")) return [];
    return (sqlite().prepare("SELECT * FROM labs WHERE organization_id = ? AND id <> ? AND retired_at IS NULL AND COALESCE(is_repository, 0) = 0 ORDER BY lab_name").all(org, req.scope.labId) as any[])
      .filter((l) => hasEquipmentAccess(null, l) && hasModuleEditAccess(l.id, req.userId, "veritamaintain") && deps.labAcceptsWrites(l.id, req.userId));
  };

  app.get(`${E}/:id/move-targets`, ...read, requireModuleEdit("veritamaintain"), (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    res.json(moveTargets(req).map((l) => ({ id: l.id, lab_name: l.lab_name, clia_number: l.clia_number })));
  });

  app.post(`${E}/:id/move`, ...setup, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.moved_to_lab_id) return movedAway(res, eq);
    if (eq.status === "retired") return res.status(409).json({ error: "This instrument is retired. Restore it to move it.", code: "RETIRED" });
    const target = moveTargets(req).find((l) => l.id === Number(req.body?.to_lab_id));
    if (!target) return res.status(403).json({ error: "You can move an instrument only to another lab of this organization where you can edit VeritaMaintain.", code: "MOVE_NOT_ALLOWED" });
    const reason = text(req.body?.reason, 1000);
    if (!reason) return res.status(400).json({ error: "Enter why this instrument is moving", code: "REASON_REQUIRED" });
    const now = new Date().toISOString();
    const today = labToday();
    const name = userName(req.userId);
    const fromName = (sqlite().prepare("SELECT lab_name FROM labs WHERE id = ?").get(eq.lab_id) as any)?.lab_name || "another lab";
    const menu = eq.map_instrument_id ? resolveLabMapInstrument(sqlite(), eq.lab_id, eq.map_instrument_id) : null;
    const dropped = [
      eq.map_instrument_id ? `its VeritaMap® analyzer link (${menu ? menu.nickname || menu.instrument_name : "analyzer"})` : "",
      eq.ifu_document_id ? "its IFU document link, which is a document of that lab" : "",
    ].filter(Boolean);
    const moveNote = `Moved from ${fromName} on ${today}: ${reason}${dropped.length ? ` Dropped on the move: ${dropped.join(" and ")}. Link it again here.` : ""}`;
    let newId = 0;
    const counts: Record<string, number> = {};
    sqlite().transaction(() => {
      const over: Record<string, any> = {
        lab_id: target.id, map_instrument_id: null, ifu_document_id: null, status: "active", retired_at: null, retired_by_user_id: null, retired_by_name: null,
        removed_from_service_date: null, removed_from_service_reason: null, moved_from_lab_id: eq.lab_id, moved_from_lab_name: fromName, moved_from_equipment_id: eq.id, moved_in_at: now,
        moved_to_lab_id: null, moved_to_lab_name: null, moved_to_equipment_id: null, moved_out_at: null, move_note: moveNote, created_at: now, updated_at: now,
      };
      newId = copyRows(sqlite(), "lab_equipment", [eq], () => over).get(eq.id)!;
      const from = (row: any) => ({ lab_id: target.id, equipment_id: newId, carried_from_lab_id: row.carried_from_lab_id ?? eq.lab_id, carried_from_lab_name: row.carried_from_lab_name ?? fromName });
      const events = sqlite().prepare("SELECT * FROM equipment_maintenance_events WHERE equipment_id = ? AND lab_id = ? ORDER BY id").all(eq.id, eq.lab_id) as any[];
      const eventIds = copyRows(sqlite(), "equipment_maintenance_events", events, (r) => ({ ...from(r), carried_from_event_id: r.id }));
      const link = sqlite().prepare("UPDATE equipment_maintenance_events SET root_event_id = ?, corrects_event_id = ?, superseded_by_event_id = ? WHERE id = ?");
      const to = (id: number | null) => (id == null ? null : eventIds.get(id) ?? null);
      for (const r of events) link.run(to(r.root_event_id), to(r.corrects_event_id), to(r.superseded_by_event_id), eventIds.get(r.id));
      counts.events = events.length;
      const files = sqlite().prepare("SELECT * FROM equipment_files WHERE equipment_id = ? AND lab_id = ? ORDER BY id").all(eq.id, eq.lab_id) as any[];
      copyRows(sqlite(), "equipment_files", files, (r) => ({ ...from(r), event_id: to(r.event_id) }));
      counts.files = files.length;
      // An open out of service period ends here and goes on in the new lab as that lab's own, on its own clock.
      const open = openDowntime(eq.lab_id, eq.id);
      closeDowntime(eq, `Moved to ${target.lab_name}`, req.userId, name, now);
      const periods = sqlite().prepare("SELECT * FROM equipment_downtime WHERE equipment_id = ? AND lab_id = ? ORDER BY id").all(eq.id, eq.lab_id) as any[];
      copyRows(sqlite(), "equipment_downtime", periods, from);
      counts.downtime = periods.length;
      if (open) {
        const there = labLocalDate(now, true, labTimeZoneById(sqlite(), target.id)).replace(" ", "T");
        sqlite().prepare("INSERT INTO equipment_downtime (lab_id, equipment_id, down_from, reason, started_by_user_id, started_by_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
          .run(target.id, newId, there, `${open.reason} (out of service when it moved from ${fromName})`, req.userId, name, now, now);
      }
      // The stain log's rows are this lab's setup and its entries stay on this lab's record; the new lab gets them as read-only lines.
      const stain = sqlite().prepare(
        "SELECT s.*, r.name AS row_name FROM stain_log_entries s JOIN stain_log_rows r ON r.id = s.row_id WHERE s.equipment_id = ? AND s.lab_id = ? ORDER BY s.log_date, s.id"
      ).all(eq.id, eq.lab_id) as any[];
      for (const s of stain) {
        insertEvent({
          equipment_id: newId, lab_id: target.id, event_type: "stain_log", event_date: s.log_date, performed_by: s.initials, next_due_date: null,
          notes: [`${s.row_name}: ${s.code}`, s.lot_number ? `lot ${s.lot_number}${s.expiration_date ? ` (exp ${s.expiration_date})` : ""}` : "", s.corrective_action ? `Corrective action: ${s.corrective_action}` : ""].filter(Boolean).join("; "),
          created_at: s.created_at, updated_at: s.created_at, logged_by_user_id: s.recorded_by_user_id, logged_by_name: s.recorded_by_name,
          voided_at: s.voided_at, voided_by_user_id: s.voided_by_user_id, voided_by_name: s.voided_by_name, void_reason: s.void_reason,
          carried_from_lab_id: eq.lab_id, carried_from_lab_name: fromName, carried_from_event_id: null,
        });
      }
      counts.stain_entries = stain.length;
      // Here: retired, read-only, and it says where it went.
      sqlite().prepare(
        `UPDATE lab_equipment SET status = 'retired', retired_at = ?, retired_by_user_id = ?, retired_by_name = ?, removed_from_service_date = ?, removed_from_service_reason = ?,
           moved_to_lab_id = ?, moved_to_lab_name = ?, moved_to_equipment_id = ?, moved_out_at = ?, updated_at = ? WHERE id = ?`
      ).run(now, req.userId, name, today, `Moved to ${target.lab_name}: ${reason}`, target.id, target.lab_name, newId, now, now, eq.id);
    })();
    audit(req, "transfer_out", "equipment", eq.id, `${eq.instrument_name} moved to ${target.lab_name}`, { lab_id: eq.lab_id, status: eq.status, map_instrument_id: eq.map_instrument_id, ifu_document_id: eq.ifu_document_id },
      { moved_to_lab_id: target.id, moved_to_equipment_id: newId, reason, ...counts });
    logAudit({
      userId: req.userId, ownerUserId: target.owner_user_id ?? undefined, module: "veritamaintain", action: "transfer_in", entityType: "equipment", entityId: newId,
      entityLabel: `${eq.instrument_name} moved from ${fromName}`, before: { lab_id: eq.lab_id, equipment_id: eq.id }, after: { lab_id: target.id, reason, note: moveNote, ...counts }, ipAddress: req.ip,
    });
    res.json({ ok: true, to_lab_id: target.id, to_lab_name: target.lab_name, equipment_id: newId, note: moveNote, carried: counts });
  });
}
