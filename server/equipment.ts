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
//     PM due date, and never earlier unless the person says so (shared/equipmentSchedules.ts planScheduleDue). A lab can require an attached vendor
//     report before a vendor PM counts as complete: until one is attached the due date stays.
//   - Append-only: an editor corrects an event with a reason, which writes a new row and leaves the original as it was
//     (superseded_by_event_id), or voids it with a reason, which keeps the row. Readers take LIVE_EVENT. Nothing here edits or deletes one.
//   - Files keep their bytes in the row, like VeritaLab's certificate documents. Removing one needs a reason, keeps the row and drops the
//     bytes, so a file holding patient information can be taken out.
//   - Retire asks for a reason and keeps the record; the Retired list restores it. Move copies the record and its history, read-only, to
//     another lab of the same organization for someone who can edit VeritaMaintain in both, and retires the one here.
//
// B10, schedules and checklists, is server/equipmentSchedules.ts; this file's events are how a schedule gets completed. A completion belongs
// to an event by its root id, so a correction keeps it, and each schedule's due date moves by the same rule as the PM's.
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
import { reviewDueRecipients } from "./maintainReviewDue";
import { isValidIfuUrl } from "../shared/ifu";
import { isYmd } from "../shared/stainLogRules";
import {
  canCompletePm, completesPmByDefault, EQUIP_EVENT_LABEL, EQUIP_EVENT_TYPES, EQUIP_FILE_KIND_LABEL, EQUIP_FILE_MAX_MB, EQUIP_FILE_TYPES, isLocalMinute, minutesBetween,
} from "../shared/equipmentPm";
import { planScheduleDue, scheduleStatus, type StepOutcome } from "../shared/equipmentSchedules";
import { activeSchedules, currentChecklist, ensurePrimary, primaryOf, setScheduleDue, syncPrimaryFromEquipment, type ChecklistVersion, type ScheduleRow } from "./equipmentScheduleData";
import { registerEquipmentScheduleRoutes } from "./equipmentSchedules";

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

export interface MaintainSettings { require_vendor_report: boolean; review_due_email: boolean }
export function readMaintainSettings(sqlite: Sqlite, labId: number): MaintainSettings {
  const row = sqlite.prepare("SELECT require_vendor_report, review_due_email FROM maintain_settings WHERE lab_id = ?").get(labId) as any;
  return { require_vendor_report: row?.require_vendor_report === 1, review_due_email: row?.review_due_email === 1 };
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
      ["uploaded_by_user_id", "uploaded_by_name"], ["removed_by_user_id", "removed_by_name"], ["started_by_user_id", "started_by_name"],
      ["retired_by_user_id", "retired_by_name"], ["completed_by_user_id", "completed_by_name"], ["ended_by_user_id", "ended_by_name"], ["created_by_user_id", "created_by_name"]];
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
  // The instrument's schedules, as the list shows them: the first one's status is the instrument's own.
  const schedulesFor = (row: any) => activeSchedules(sqlite(), row.lab_id, row.id).map((x) => ({
    id: x.id, name: x.name, schedule_type: x.schedule_type, frequency: x.frequency, interval_days: x.interval_days, next_due_date: x.next_due_date, is_primary: x.is_primary,
    has_checklist: !!currentChecklist(sqlite(), x.lab_id, x.id), status: x.is_primary ? equipmentStatus(x.next_due_date) : scheduleStatus(x, labToday()),
  }));
  const decorate = (row: any) => ({ ...row, maintenance_status: equipmentStatus(row.next_due_date), out_of_service: openDowntime(row.lab_id, row.id), schedules: schedulesFor(row) });

  // ── List, add ───────────────────────────────────────────────────────────────────────────────────────

  app.get("/api/labs/:labId/equipment", ...read, (req: any, res: any) => {
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

  app.post("/api/labs/:labId/equipment", ...setup, (req: any, res: any) => {
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
    syncPrimaryFromEquipment(sqlite(), null, row, now, { id: req.userId, name: userName(req.userId) });
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
  app.get("/api/labs/:labId/equipment/reminder-config", ...read, (req: any, res: any) => {
    res.json(readEquipmentReminderConfig(req.scope.labId));
  });
  app.put("/api/labs/:labId/equipment/reminder-config", ...setup, (req: any, res: any) => {
    res.json(writeEquipmentReminderConfig(req.scope.labId, req.body));
  });

  // ── The lab's VeritaMaintain settings ───────────────────────────────────────────────────────────────

  app.get("/api/labs/:labId/equipment-settings", ...read, (req: any, res: any) => {
    res.json({
      ...readMaintainSettings(sqlite(), req.scope.labId), can_edit: hasModuleEditAccess(req.scope.labId, req.userId, "veritamaintain"),
      review_due_recipients: reviewDueRecipients(sqlite(), req.scope.labId).length,
    });
  });
  app.put("/api/labs/:labId/equipment-settings", ...setup, (req: any, res: any) => {
    const before = readMaintainSettings(sqlite(), req.scope.labId);
    const next = {
      require_vendor_report: req.body?.require_vendor_report !== undefined ? truthy(req.body.require_vendor_report) : before.require_vendor_report,
      review_due_email: req.body?.review_due_email !== undefined ? truthy(req.body.review_due_email) : before.review_due_email,
    };
    const now = new Date().toISOString();
    sqlite().prepare(
      `INSERT INTO maintain_settings (lab_id, require_vendor_report, review_due_email, updated_by_user_id, created_at, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(lab_id) DO UPDATE SET require_vendor_report = excluded.require_vendor_report, review_due_email = excluded.review_due_email, updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`
    ).run(req.scope.labId, next.require_vendor_report ? 1 : 0, next.review_due_email ? 1 : 0, req.userId, now, now);
    if (JSON.stringify(before) !== JSON.stringify(next)) audit(req, "update", "maintain_settings", req.scope.labId, "VeritaMaintain settings", before, next);
    res.json(next);
  });

  // ── One record ──────────────────────────────────────────────────────────────────────────────────────

  app.get("/api/labs/:labId/equipment/:id/record", ...read, (req: any, res: any) => {
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
  app.get("/api/labs/:labId/equipment/:id/ifu-document", ...read, async (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (!eq.ifu_document_id) return res.status(404).json({ error: "No IFU document is linked to this instrument" });
    await sendApprovedDocument(sqlite(), req, res, { labId: eq.lab_id, documentId: eq.ifu_document_id, surface: "equipment_ifu" });
  });

  app.put("/api/labs/:labId/equipment/:id", ...setup, (req: any, res: any) => {
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
    syncPrimaryFromEquipment(sqlite(), ex, row, now, { id: req.userId, name: userName(req.userId) });
    const changed = Object.keys(row).filter((k) => k !== "updated_at" && row[k] !== ex[k]);
    if (changed.length) audit(req, "update", "equipment", ex.id, row.instrument_name, Object.fromEntries(changed.map((k) => [k, ex[k]])), Object.fromEntries(changed.map((k) => [k, row[k]])));
    res.json(decorate(row));
  });

  // An instrument that holds records is retired, not deleted. One added by mistake, holding nothing, can go.
  app.delete("/api/labs/:labId/equipment/:id", ...setup, (req: any, res: any) => {
    const ex = equipmentIn(req);
    if (!ex) return notFound(res);
    const count = (sql: string, ...a: any[]) => Number((sqlite().prepare(sql).get(...a) as any).n);
    // A stain log is a record the lab keeps (Q178 = 1): an instrument holding one is retired, not deleted. Rows nothing was recorded on go with it.
    const stainEntries = count("SELECT COUNT(*) AS n FROM stain_log_entries WHERE equipment_id = ? AND lab_id = ?", ex.id, req.scope.labId);
    if (stainEntries > 0) return res.status(409).json({ error: `This instrument holds ${stainEntries} stain log ${stainEntries === 1 ? "entry" : "entries"}, so it can't be deleted. Retire it instead.`, code: "HOLDS_STAIN_LOG", entry_count: stainEntries });
    const held = count("SELECT COUNT(*) AS n FROM equipment_maintenance_events WHERE equipment_id = ?", ex.id)
      + count("SELECT COUNT(*) AS n FROM equipment_files WHERE equipment_id = ?", ex.id)
      + count("SELECT COUNT(*) AS n FROM equipment_downtime WHERE equipment_id = ?", ex.id)
      + count("SELECT COUNT(*) AS n FROM equipment_schedule_completions WHERE equipment_id = ?", ex.id)
      + count("SELECT COUNT(*) AS n FROM maintain_record_reviews WHERE lab_id = ? AND item_type = 'equipment' AND item_id = ?", req.scope.labId, ex.id)
      + (ex.moved_to_lab_id || ex.moved_from_lab_id ? 1 : 0);
    if (held > 0) return res.status(409).json({ error: "This instrument holds records, so it can't be deleted. Retire it instead.", code: "HOLDS_RECORDS" });
    audit(req, "delete", "equipment", ex.id, ex.instrument_name, ex, {});
    sqlite().transaction(() => {
      sqlite().prepare("DELETE FROM stain_log_rows WHERE equipment_id = ? AND lab_id = ?").run(ex.id, req.scope.labId);
      // Schedules nothing was done on are setup, and go with it.
      sqlite().prepare("DELETE FROM equipment_checklist_steps WHERE lab_id = ? AND version_id IN (SELECT id FROM equipment_checklist_versions WHERE lab_id = ? AND equipment_id = ?)").run(req.scope.labId, req.scope.labId, ex.id);
      sqlite().prepare("DELETE FROM equipment_checklist_versions WHERE lab_id = ? AND equipment_id = ?").run(req.scope.labId, ex.id);
      sqlite().prepare("DELETE FROM equipment_schedules WHERE lab_id = ? AND equipment_id = ?").run(req.scope.labId, ex.id);
      sqlite().prepare("DELETE FROM lab_equipment WHERE id = ?").run(ex.id);
    })();
    res.json({ ok: true });
  });

  // ── Retire and restore ──────────────────────────────────────────────────────────────────────────────

  app.post("/api/labs/:labId/equipment/:id/retire", ...setup, (req: any, res: any) => {
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

  app.post("/api/labs/:labId/equipment/:id/restore", ...setup, (req: any, res: any) => {
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

  app.post("/api/labs/:labId/equipment/:id/downtime", ...setup, (req: any, res: any) => {
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

  app.post("/api/labs/:labId/equipment/:id/downtime/:downtimeId/end", ...setup, (req: any, res: any) => {
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
  app.put("/api/labs/:labId/equipment/:id/downtime/:downtimeId", ...setup, (req: any, res: any) => {
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

  type Held = { keeps: string | null; works_out_to: string | null };
  interface Done { schedule_id: number; name: string; is_primary: boolean; due_set: string | null; held: Held | null }
  const scheduleRow = (id: number, labId: number): ScheduleRow | null => (sqlite().prepare("SELECT * FROM equipment_schedules WHERE id = ? AND lab_id = ?").get(id, labId) as ScheduleRow) ?? null;

  /** One schedule completed by an event: the completion, its checklist as it was answered, and the due date (unless it waits for a report). */
  function completeSchedule(o: {
    eq: any; schedule: ScheduleRow; eventId: number; doneOn: string; typed: string | null; allowEarlier: boolean; waits: boolean; now: string; user: { id: number; name: string | null };
    version?: ChecklistVersion | null; outcomes?: StepOutcome[];
  }): Done {
    const plan = planScheduleDue({ currentDue: o.schedule.next_due_date, frequency: o.schedule.frequency, intervalDays: o.schedule.interval_days, doneOn: o.doneOn, typedDue: o.typed, allowEarlier: o.allowEarlier });
    const dueSet = !o.waits && plan.computed && !plan.held ? plan.computed : null;
    const steps = o.version?.steps ?? [];
    const completionId = Number(sqlite().prepare(
      `INSERT INTO equipment_schedule_completions (lab_id, equipment_id, schedule_id, event_id, checklist_version_id, checklist_version_no, done_on, completed_by_user_id, completed_by_name, step_count, failed_steps, counts, counted_at,
         due_before, due_set, typed_due, allow_earlier, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(o.eq.lab_id, o.eq.id, o.schedule.id, o.eventId, o.version?.id ?? null, o.version?.version_no ?? null, o.doneOn, o.user.id, o.user.name, steps.length, (o.outcomes ?? []).filter((r) => r.result === "fail").length,
      o.waits ? 0 : 1, o.waits ? null : o.now, o.schedule.next_due_date ?? null, dueSet, o.typed, o.allowEarlier ? 1 : 0, o.now).lastInsertRowid);
    // The steps are copied with their answers, so a later edit of the checklist can't change what was recorded.
    const ins = sqlite().prepare("INSERT INTO equipment_checklist_results (lab_id, completion_id, step_id, position, step_text, kind, unit, min_value, max_value, result, value, corrective_action) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    steps.forEach((st: any, i: number) => {
      const r = o.outcomes![i];
      ins.run(o.eq.lab_id, completionId, st.id, st.position, st.step_text, st.kind, st.unit, st.min_value, st.max_value, r.result, r.value, r.corrective_action);
    });
    if (dueSet) setScheduleDue(sqlite(), o.schedule, dueSet, o.now);
    return { schedule_id: o.schedule.id, name: o.schedule.name, is_primary: o.schedule.is_primary === 1, due_set: dueSet, held: o.waits ? null : plan.held };
  }

  const standingOf = (labId: number, rootEventId: number): any[] =>
    sqlite().prepare("SELECT * FROM equipment_schedule_completions WHERE lab_id = ? AND event_id = ? AND voided_at IS NULL ORDER BY id").all(labId, rootEventId) as any[];

  /** The due date of a schedule an event completed, worked out again: its report came, or its date was corrected. */
  function replan(c: any, doneOn: string, o: { typed?: string | null; allowEarlier: boolean; now: string }): Done | null {
    const sc = scheduleRow(c.schedule_id, c.lab_id);
    if (!sc) return null;
    const plan = planScheduleDue({ currentDue: sc.next_due_date, frequency: sc.frequency, intervalDays: sc.interval_days, doneOn, typedDue: o.typed ?? null, allowEarlier: o.allowEarlier });
    const dueSet = plan.computed && !plan.held ? plan.computed : null;
    const inForce = !!c.due_set && c.due_set === sc.next_due_date;
    sqlite().prepare("UPDATE equipment_schedule_completions SET counts = 1, counted_at = COALESCE(counted_at, ?), due_before = ?, due_set = ? WHERE id = ?")
      .run(o.now, inForce ? c.due_before : sc.next_due_date ?? null, dueSet ?? (plan.computed ? c.due_set : null), c.id);
    if (dueSet && sc.active) setScheduleDue(sqlite(), sc, dueSet, o.now);
    return { schedule_id: sc.id, name: sc.name, is_primary: sc.is_primary === 1, due_set: dueSet, held: plan.held };
  }
  const primaryHeld = (done: Done[]): Held | null => (done.find((d) => d.is_primary) ?? done[0])?.held ?? null;

  // Each standing entry, newest first, with its files and the versions a correction replaced.
  app.get("/api/labs/:labId/equipment/:id/events", ...read, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    const names = namesFor(req);
    const all = (sqlite().prepare("SELECT * FROM equipment_maintenance_events WHERE equipment_id = ? AND lab_id = ? ORDER BY event_date DESC, id DESC").all(eq.id, eq.lab_id) as any[]).map(names);
    const files = (sqlite().prepare(`SELECT ${FILE_COLS} FROM equipment_files WHERE lab_id = ? AND equipment_id = ? AND event_id IS NOT NULL ORDER BY id`).all(eq.lab_id, eq.id) as any[]).map(names);
    const done = (sqlite().prepare(
      `SELECT c.*, s.name AS schedule_name FROM equipment_schedule_completions c LEFT JOIN equipment_schedules s ON s.id = c.schedule_id AND s.lab_id = c.lab_id WHERE c.lab_id = ? AND c.equipment_id = ? ORDER BY c.id`
    ).all(eq.lab_id, eq.id) as any[]).map(names);
    const results = sqlite().prepare(
      "SELECT r.* FROM equipment_checklist_results r JOIN equipment_schedule_completions c ON c.id = r.completion_id AND c.lab_id = r.lab_id WHERE c.lab_id = ? AND c.equipment_id = ? ORDER BY r.completion_id, r.position, r.id"
    ).all(eq.lab_id, eq.id) as any[];
    res.json(all.filter((e) => !e.superseded_by_event_id).map((e) => ({
      ...e,
      completions: done.filter((c) => c.event_id === rootOf(e) && !c.voided_at).map((c) => ({ ...c, results: results.filter((r) => r.completion_id === c.id) })),
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

  // Which schedules an entry completes. The first one by "completes PM" (preventive maintenance does unless the person says not), any other by
  // its id. One with a checklist is completed by answering the checklist, never by an entry alone.
  const targetsFor = (eq: any, b: any, v: any): { error?: string; code?: string; status?: number; primary?: boolean; others?: ScheduleRow[] } => {
    const first = primaryOf(sqlite(), eq.lab_id, eq.id);
    const ids = Array.isArray(b.schedule_ids) ? [...new Set(b.schedule_ids.map(Number))] as number[] : null;
    if (!canCompletePm(v.event_type)) return { primary: false, others: [] };
    const others: ScheduleRow[] = [];
    for (const id of ids ?? []) {
      if (first && id === first.id) continue;
      const sc = activeSchedules(sqlite(), eq.lab_id, eq.id).find((x) => x.id === id);
      if (!sc) return { status: 400, error: "That schedule isn't on this instrument", code: "BAD_SCHEDULE" };
      others.push(sc);
    }
    const firstHasList = !!first && !!currentChecklist(sqlite(), eq.lab_id, first.id);
    const primary = b.completes_pm !== undefined ? v.completes_pm === 1 : ids ? !!first && ids.includes(first.id) : v.completes_pm === 1 && !firstHasList;
    const listed = [...(primary && first && firstHasList ? [first] : []), ...others.filter((x) => currentChecklist(sqlite(), eq.lab_id, x.id))];
    if (listed.length) return { status: 409, error: `${listed[0].name} has a checklist. Complete it from Schedules.`, code: "CHECKLIST_REQUIRED" };
    return { primary, others };
  };
  const isPm = (sc: ScheduleRow) => sc.schedule_type === "preventive_maintenance";

  // Logging a maintenance EVENT is operational work a tech performs, so staff may do it: gated by lab membership and an active
  // subscription, NOT requireModuleEdit (which stays on setup and corrections).
  app.post("/api/labs/:labId/equipment/:id/events", ...record, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.status === "retired") return res.status(409).json({ error: "This instrument is retired. Restore it to log maintenance.", code: "RETIRED" });
    const c = cleanEvent(req.body || {});
    if (c.error) return res.status(400).json({ error: c.error, ...(c.code ? { code: c.code } : {}) });
    const v = c.v;
    const t = targetsFor(eq, req.body || {}, v);
    if (t.error) return res.status(t.status!).json({ error: t.error, code: t.code });
    const r = logEvent(req, eq, v, { primary: t.primary!, others: t.others!, allowEarlier: truthy(req.body?.allow_earlier_due) });
    const row = sqlite().prepare("SELECT * FROM lab_equipment WHERE id = ?").get(eq.id) as any;
    res.json({ ...decorate(row), event_id: r.eventId, due_date_held: primaryHeld(r.done), completed_schedules: r.done, awaiting_vendor_report_event: r.waits });
  });

  /** The entry and everything it completes, in one transaction, with its audit row. A schedule with a checklist arrives with its answers. */
  function logEvent(req: any, eq: any, v: any, o: { primary: boolean; others: ScheduleRow[]; allowEarlier: boolean; typedAll?: boolean; checklist?: { schedule: ScheduleRow; version: ChecklistVersion; outcomes: StepOutcome[] } }) {
    const now = new Date().toISOString();
    const user = { id: req.userId as number, name: userName(req.userId) };
    const completesPm = o.primary || o.others.some(isPm);
    const completesAny = o.primary || o.others.length > 0;
    const waits = completesPm && v.by_vendor === 1 && readMaintainSettings(sqlite(), eq.lab_id).require_vendor_report;
    const done: Done[] = [];
    let eventId = 0;
    sqlite().transaction(() => {
      eventId = insertEvent({
        equipment_id: eq.id, lab_id: eq.lab_id, event_type: v.event_type, event_date: v.event_date, performed_by: v.performed_by, next_due_date: null, notes: v.notes,
        created_at: now, updated_at: now, logged_by_user_id: user.id, logged_by_name: user.name,
        completes_pm: completesPm ? 1 : 0, pm_complete: completesAny ? (waits ? 0 : 1) : null, pm_completed_at: completesAny && !waits ? now : null,
        due_before: eq.next_due_date ?? null, pm_typed_due: o.primary ? v.typed : null, pm_allow_earlier: o.allowEarlier ? 1 : 0,
        cost: v.cost, by_vendor: v.by_vendor, vendor_company: v.vendor_company, vendor_technician: v.vendor_technician, vendor_report_attached: 0,
      });
      const args = { eq, eventId, doneOn: v.event_date, allowEarlier: o.allowEarlier, waits, now, user };
      const answered = (sc: ScheduleRow) => (o.checklist?.schedule.id === sc.id ? { version: o.checklist.version, outcomes: o.checklist.outcomes } : {});
      if (o.primary) {
        // An instrument with no PM schedule yet gets one when the person says when the next PM is due.
        const first = ensurePrimary(sqlite(), eq, now, user) ?? (v.typed ? ensurePrimary(sqlite(), { ...eq, next_due_date: v.typed }, now, user) : null);
        if (first) done.push(completeSchedule({ ...args, ...answered(first), schedule: v.typed && !eq.next_due_date ? { ...first, next_due_date: null } : first, typed: v.typed }));
      }
      for (const sc of o.others) done.push(completeSchedule({ ...args, ...answered(sc), schedule: sc, typed: o.typedAll ? v.typed : null }));
      const set = done.find((d) => d.is_primary)?.due_set ?? null;
      if (set) sqlite().prepare("UPDATE equipment_maintenance_events SET next_due_date = ? WHERE id = ?").run(set, eventId);
    })();
    const ev = sqlite().prepare("SELECT * FROM equipment_maintenance_events WHERE id = ?").get(eventId) as any;
    audit(req, "create", "equipment_event", eventId, `${eq.instrument_name}: ${eventName(ev)}`, { next_due_date: eq.next_due_date }, { ...ev, completed_schedules: done });
    return { eventId, done, waits };
  }

  // Correct an entry: a new row with the corrected values; the original stays as it was and is shown under it.
  app.post("/api/labs/:labId/equipment/:id/events/:eventId/correct", ...setup, (req: any, res: any) => {
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
    const root = rootOf(old);
    const standing = standingOf(eq.lab_id, root);
    const first = primaryOf(sqlite(), eq.lab_id, eq.id);
    const firstDone = first ? standing.find((x) => x.schedule_id === first.id) : undefined;
    const others = standing.filter((x) => x !== firstDone);
    const othersPm = others.some((x) => { const sc = scheduleRow(x.schedule_id, eq.lab_id); return !!sc && isPm(sc); });
    // "Completes PM" in the body is about the first schedule; the others an entry completed stay completed unless it is voided.
    const keepsFirst = req.body?.completes_pm === undefined && othersPm && !firstDone ? false : v.completes_pm === 1;
    const wasPm = (old.completes_pm ?? (completesPmByDefault(old.event_type) ? 1 : 0)) === 1;
    // Saying now that it completed PM adds the first schedule's completion; an entry that already said so isn't completed a second time.
    const addsFirst = keepsFirst && !firstDone && !wasPm;
    if (others.length && !canCompletePm(v.event_type)) return res.status(409).json({ error: "This entry completed a schedule, so it can't become that type. Void it and log it again.", code: "COMPLETED_SCHEDULE" });
    if (addsFirst && first && currentChecklist(sqlite(), eq.lab_id, first.id)) return res.status(409).json({ error: `${first.name} has a checklist. Complete it from Schedules.`, code: "CHECKLIST_REQUIRED" });
    const completesPm = keepsFirst || othersPm;
    const completesAny = keepsFirst || others.length > 0;
    const hasReport = hasVendorReport(eq.lab_id, root);
    const waits = completesPm && v.by_vendor === 1 && !hasReport && readMaintainSettings(sqlite(), eq.lab_id).require_vendor_report && old.pm_complete !== 1;
    const wasWaiting = old.pm_complete === 0;
    const user = { id: req.userId as number, name: userName(req.userId) };
    const done: Done[] = [];
    let held: Held | null = null;
    let newId = 0;
    sqlite().transaction(() => {
      newId = insertEvent({
        equipment_id: eq.id, lab_id: eq.lab_id, event_type: v.event_type, event_date: v.event_date, performed_by: v.performed_by, next_due_date: keepsFirst ? old.next_due_date ?? null : null, notes: v.notes,
        created_at: now, updated_at: now, logged_by_user_id: old.logged_by_user_id, logged_by_name: old.logged_by_name,
        completes_pm: completesPm ? 1 : 0, pm_complete: completesAny ? (waits ? 0 : 1) : null, pm_completed_at: completesAny && !waits ? (old.pm_completed_at ?? now) : null,
        due_before: old.due_before ?? null, pm_typed_due: keepsFirst ? (v.typed ?? old.pm_typed_due ?? null) : null, pm_allow_earlier: allowEarlier ? 1 : 0,
        cost: v.cost, by_vendor: v.by_vendor, vendor_company: v.vendor_company, vendor_technician: v.vendor_technician, vendor_report_attached: hasReport ? 1 : 0,
        root_event_id: root, corrects_event_id: old.id, correction_reason: reason, corrected_by_user_id: req.userId, corrected_by_name: user.name, corrected_at: now,
      });
      sqlite().prepare("UPDATE equipment_maintenance_events SET superseded_by_event_id = ? WHERE id = ?").run(newId, old.id);
      if (firstDone && !keepsFirst) {
        // It never completed the first schedule after all. The date it set goes back only when the person says so.
        sqlite().prepare("UPDATE equipment_schedule_completions SET voided_at = ?, voided_by_user_id = ?, voided_by_name = ?, void_reason = ? WHERE id = ?").run(now, user.id, user.name, reason, firstDone.id);
        if (firstDone.due_set && first && first.next_due_date === firstDone.due_set) {
          if (allowEarlier) setScheduleDue(sqlite(), first, firstDone.due_before ?? null, now); else held = { keeps: first.next_due_date, works_out_to: firstDone.due_before ?? null };
        }
      }
      if (addsFirst) {
        const sc = ensurePrimary(sqlite(), eq, now, user) ?? (v.typed ? ensurePrimary(sqlite(), { ...eq, next_due_date: v.typed }, now, user) : null);
        if (sc) done.push(completeSchedule({ eq, schedule: sc, eventId: root, doneOn: v.event_date, typed: v.typed, allowEarlier, waits, now, user }));
      }
      // Only what a due date is worked out from can move it; a corrected note or name leaves it alone.
      const dated = v.event_date !== old.event_date || (wasWaiting && !waits);
      if (!waits) for (const x of [...(firstDone && keepsFirst ? [firstDone] : []), ...others]) {
        if (!dated && !(x === firstDone && v.typed)) continue;
        const r = replan(x, v.event_date, { typed: x === firstDone ? v.typed ?? (dated && wasWaiting ? x.typed_due : null) : wasWaiting ? x.typed_due : null, allowEarlier, now });
        if (r) done.push(r);
      }
      const firstResult = done.find((d) => d.is_primary);
      if (firstResult && firstResult.due_set) sqlite().prepare("UPDATE equipment_maintenance_events SET next_due_date = ? WHERE id = ?").run(firstResult.due_set, newId);
      held = held ?? primaryHeld(done);
    })();
    const ev = sqlite().prepare("SELECT * FROM equipment_maintenance_events WHERE id = ?").get(newId) as any;
    audit(req, "update", "equipment_event", newId, `${eq.instrument_name}: ${eventName(ev)} corrected`, old, { ...ev, reason, due_date_held: held, completed_schedules: done });
    const row = sqlite().prepare("SELECT * FROM lab_equipment WHERE id = ?").get(eq.id) as any;
    res.json({ ...decorate(row), event_id: newId, due_date_held: held });
  });

  // Void an entry made by mistake (the wrong instrument, twice). The row stays, with who and why.
  app.post("/api/labs/:labId/equipment/:id/events/:eventId/void", ...setup, (req: any, res: any) => {
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
    const putBack = truthy(req.body?.allow_earlier_due);
    const left: Done[] = [];
    sqlite().transaction(() => {
      sqlite().prepare("UPDATE equipment_maintenance_events SET voided_at = ?, voided_by_user_id = ?, voided_by_name = ?, void_reason = ?, updated_at = ? WHERE id = ?").run(now, req.userId, userName(req.userId), reason, now, ev.id);
      for (const x of standingOf(eq.lab_id, rootOf(ev))) {
        const sc = scheduleRow(x.schedule_id, eq.lab_id);
        if (!sc || !x.due_set || sc.next_due_date !== x.due_set) continue;
        if (putBack) setScheduleDue(sqlite(), sc, x.due_before ?? null, now);
        else left.push({ schedule_id: sc.id, name: sc.name, is_primary: sc.is_primary === 1, due_set: null, held: { keeps: sc.next_due_date, works_out_to: x.due_before ?? null } });
      }
    })();
    const row = sqlite().prepare("SELECT * FROM lab_equipment WHERE id = ?").get(eq.id) as any;
    audit(req, "update", "equipment_event", ev.id, `${eq.instrument_name}: ${eventName(ev)} voided`, ev, { voided: true, reason, next_due_date: row.next_due_date, due_dates_kept: left });
    res.json({ ...decorate(row), due_date_held: primaryHeld(left) });
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
        if (live.pm_complete === 0 && !live.voided_at) {
          const done = standingOf(eq.lab_id, root!).filter((x) => !x.counts).map((x) => replan(x, live.event_date, { typed: x.typed_due, allowEarlier: x.allow_earlier === 1, now })).filter(Boolean) as Done[];
          const set = done.find((d) => d.is_primary)?.due_set ?? null;
          sqlite().prepare("UPDATE equipment_maintenance_events SET pm_complete = 1, pm_completed_at = ?, next_due_date = ? WHERE id = ?").run(now, set, live.id);
          const due = (sqlite().prepare("SELECT next_due_date FROM lab_equipment WHERE id = ?").get(eq.id) as any).next_due_date;
          completed = { event_id: live.id, next_due_date: due, due_date_held: primaryHeld(done), completed_schedules: done };
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
  app.post("/api/labs/:labId/equipment/:id/files", ...setup, upload, async (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.moved_to_lab_id) return movedAway(res, eq);
    await saveFile(req, res, eq, null);
  });

  // A file on an event: the person who logged it, or an editor.
  app.post("/api/labs/:labId/equipment/:id/events/:eventId/files", ...record, upload, async (req: any, res: any) => {
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

  app.get("/api/labs/:labId/equipment/:id/files/:fileId", ...read, (req: any, res: any) => {
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

  app.post("/api/labs/:labId/equipment/:id/files/:fileId/remove", ...setup, (req: any, res: any) => {
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

  app.get("/api/labs/:labId/equipment/:id/move-targets", ...read, requireModuleEdit("veritamaintain"), (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    res.json(moveTargets(req).map((l) => ({ id: l.id, lab_name: l.lab_name, clia_number: l.clia_number })));
  });

  app.post("/api/labs/:labId/equipment/:id/move", ...setup, (req: any, res: any) => {
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
      activeSchedules(sqlite(), eq.lab_id, eq.id).some((x) => x.sop_document_id) ? "its schedules' SOP links, which are documents of that lab" : "",
      activeSchedules(sqlite(), eq.lab_id, eq.id).some((x) => (x.recipients_json || "[]") !== "[]") ? "its schedules' own reminder recipients" : "",
    ].filter(Boolean);
    const moveNote = `Moved from ${fromName} on ${today}: ${reason}${/[.!?]$/.test(reason) ? "" : "."}${dropped.length ? ` Dropped on the move: ${dropped.join(" and ")}. Set them again here.` : ""}`;
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
      // Its schedules and checklists go on there, starting that day, reminding that lab's list; what was completed here goes along read-only.
      const schedules = sqlite().prepare("SELECT * FROM equipment_schedules WHERE equipment_id = ? AND lab_id = ? ORDER BY id").all(eq.id, eq.lab_id) as any[];
      const scheduleIds = copyRows(sqlite(), "equipment_schedules", schedules, (r) => ({ lab_id: target.id, equipment_id: newId, recipients_json: "[]", sop_document_id: null, starts_on: labToday(labTimeZoneById(sqlite(), target.id)) }));
      const versions = sqlite().prepare("SELECT * FROM equipment_checklist_versions WHERE equipment_id = ? AND lab_id = ? ORDER BY id").all(eq.id, eq.lab_id) as any[];
      const versionIds = copyRows(sqlite(), "equipment_checklist_versions", versions, (r) => ({ lab_id: target.id, equipment_id: newId, schedule_id: scheduleIds.get(r.schedule_id) ?? null }));
      const steps = sqlite().prepare("SELECT s.* FROM equipment_checklist_steps s JOIN equipment_checklist_versions v ON v.id = s.version_id WHERE v.equipment_id = ? AND v.lab_id = ? ORDER BY s.id").all(eq.id, eq.lab_id) as any[];
      const stepIds = copyRows(sqlite(), "equipment_checklist_steps", steps, (r) => ({ lab_id: target.id, version_id: versionIds.get(r.version_id) }));
      const completions = (sqlite().prepare("SELECT * FROM equipment_schedule_completions WHERE equipment_id = ? AND lab_id = ? ORDER BY id").all(eq.id, eq.lab_id) as any[]).filter((r) => scheduleIds.has(r.schedule_id) && eventIds.has(r.event_id));
      const completionIds = copyRows(sqlite(), "equipment_schedule_completions", completions, (r) => ({
        ...from(r), schedule_id: scheduleIds.get(r.schedule_id), event_id: eventIds.get(r.event_id), checklist_version_id: r.checklist_version_id == null ? null : versionIds.get(r.checklist_version_id) ?? null,
      }));
      const answers = sqlite().prepare("SELECT r.* FROM equipment_checklist_results r JOIN equipment_schedule_completions c ON c.id = r.completion_id WHERE c.equipment_id = ? AND c.lab_id = ? ORDER BY r.id").all(eq.id, eq.lab_id) as any[];
      copyRows(sqlite(), "equipment_checklist_results", answers.filter((r) => completionIds.has(r.completion_id)), (r) => ({ lab_id: target.id, completion_id: completionIds.get(r.completion_id), step_id: r.step_id == null ? null : stepIds.get(r.step_id) ?? null }));
      counts.schedules = schedules.filter((r) => r.active).length;
      counts.completions = completions.length;
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

  // ── Schedules and checklists ────────────────────────────────────────────────────────────────────────
  registerEquipmentScheduleRoutes(app, { read, record, setup, sqlite, equipmentIn, notFound, movedAway, audit, namesFor, userName, text, truthy, cleanEvent, logEvent, hasModuleEditAccess });
}
