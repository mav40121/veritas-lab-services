/**
 * Audit log helpers for VeritaAssure.
 * Every destructive or significant write operation across all modules
 * should call logAudit() before executing.
 */

import { db } from "./db";

export type AuditModule =
  | "veritamap"
  | "veritascan"
  | "veritacomp"
  | "veritastaff"
  | "veritalab"
  | "veritacheck"
  | "veritapt"
  | "veritastock"
  | "account";

export type AuditAction = "create" | "update" | "delete" | "restore" | "transfer_out" | "transfer_in" | "transfer_rejected" | "receive" | "adjust" | "write_off";

export interface AuditEntry {
  userId: number;
  ownerUserId?: number;
  module: AuditModule;
  action: AuditAction;
  entityType: string;
  entityId?: string | number;
  entityLabel?: string;
  before?: any;
  after?: any;
  ipAddress?: string;
}

/**
 * Log an audit entry. Call this BEFORE executing the destructive operation
 * so the before_json captures the current state.
 */
export function logAudit(entry: AuditEntry): number {
  try {
    const result = (db as any).$client.prepare(`
      INSERT INTO audit_log
        (user_id, owner_user_id, module, action, entity_type, entity_id, entity_label, before_json, after_json, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      entry.userId,
      entry.ownerUserId ?? entry.userId,
      entry.module,
      entry.action,
      entry.entityType,
      entry.entityId != null ? String(entry.entityId) : null,
      entry.entityLabel ?? null,
      entry.before != null ? JSON.stringify(entry.before) : null,
      entry.after != null ? JSON.stringify(entry.after) : null,
      entry.ipAddress ?? null,
    );
    return result.lastInsertRowid as number;
  } catch (err: any) {
    // Audit failure should never break the main operation
    console.error("[audit] Failed to write audit log:", err.message);
    return -1;
  }
}

/**
 * Capture a full snapshot of all user data for a single user.
 * Returns the snapshot JSON. Call this from the nightly cron.
 */
export function captureUserSnapshot(userId: number): object {
  const sqlite = (db as any).$client;

  // Studies (VeritaCheck)
  const studies = sqlite.prepare(
    "SELECT id, test_name, study_type, instrument, analyst, date, status, created_at FROM studies WHERE user_id = ?"
  ).all(userId);

  // VeritaMap
  const maps = sqlite.prepare(
    "SELECT id, name, created_at, updated_at FROM veritamap_maps WHERE user_id = ?"
  ).all(userId);
  const mapIds = maps.map((m: any) => m.id);
  const instruments = mapIds.length
    ? sqlite.prepare(
        `SELECT * FROM veritamap_instruments WHERE map_id IN (${mapIds.join(",")})`
      ).all()
    : [];
  const instrumentIds = instruments.map((i: any) => i.id);
  const instrumentTests = instrumentIds.length
    ? sqlite.prepare(
        `SELECT * FROM veritamap_instrument_tests WHERE instrument_id IN (${instrumentIds.join(",")})`
      ).all()
    : [];

  // VeritaScan
  const scans = sqlite.prepare(
    "SELECT id, name, created_at, updated_at FROM veritascan_scans WHERE user_id = ?"
  ).all(userId);
  const scanIds = scans.map((s: any) => s.id);
  const scanItems = scanIds.length
    ? sqlite.prepare(
        `SELECT * FROM veritascan_items WHERE scan_id IN (${scanIds.join(",")})`
      ).all()
    : [];

  // VeritaComp
  const assessments = sqlite.prepare(
    `SELECT a.id, e.name as employee_name, p.name as program_name, a.assessment_type, p.department, a.status, a.created_at
     FROM competency_assessments a
     LEFT JOIN competency_employees e ON a.employee_id = e.id
     LEFT JOIN competency_programs p ON a.program_id = p.id
     WHERE p.user_id = ?`
  ).all(userId);

  // VeritaStaff
  const staff = sqlite.prepare(
    "SELECT e.* FROM staff_employees e JOIN staff_labs l ON e.lab_id = l.id WHERE l.user_id = ?"
  ).all(userId);

  // VeritaLab
  const certs = sqlite.prepare(
    "SELECT * FROM lab_certificates WHERE user_id = ?"
  ).all(userId);

  // VeritaPT enrollments
  const ptEnrollments = sqlite.prepare(
    "SELECT * FROM pt_enrollments_v2 WHERE user_id = ?"
  ).all(userId);

  return {
    snapshot_version: 1,
    user_id: userId,
    studies,
    maps,
    instruments,
    instrument_tests: instrumentTests,
    scans,
    scan_items: scanItems,
    assessments,
    staff,
    certificates: certs,
    pt_enrollments: ptEnrollments,
  };
}

/**
 * Save a nightly snapshot for a user. Replaces existing snapshot for same date.
 */
export function saveNightlySnapshot(userId: number): void {
  try {
    const sqlite = (db as any).$client;
    const data = captureUserSnapshot(userId);
    const today = new Date().toISOString().split("T")[0];
    const jsonStr = JSON.stringify(data);
    const now = new Date().toISOString();

    // Delete existing snapshot for today first, then insert fresh
    sqlite.prepare("DELETE FROM nightly_snapshots WHERE user_id = ? AND snapshot_date = ?").run(userId, today);
    sqlite.prepare(
      "INSERT INTO nightly_snapshots (user_id, snapshot_date, modules_json, created_at) VALUES (?, ?, ?, ?)"
    ).run(userId, today, jsonStr, now);

    // Purge snapshots older than 30 days
    sqlite.prepare(
      "DELETE FROM nightly_snapshots WHERE user_id = ? AND snapshot_date < ?"
    ).run(userId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);

    console.log(`[snapshot] Saved ${Math.round(jsonStr.length / 1024)}KB snapshot for user ${userId} on ${today}`);
  } catch (err: any) {
    console.error(`[snapshot] Failed to save snapshot for user ${userId}:`, err.message);
  }
}

/**
 * Run nightly snapshots for all users with paid plans.
 */
export function runNightlySnapshots(): void {
  try {
    const users = (db as any).$client.prepare(
      `SELECT id FROM users WHERE plan NOT IN ('free', 'per_study') OR study_credits > 0`
    ).all() as { id: number }[];

    console.log(`[snapshot] Running nightly snapshot for ${users.length} users`);
    for (const user of users) {
      saveNightlySnapshot(user.id);
    }
    console.log(`[snapshot] Nightly snapshot complete`);
  } catch (err: any) {
    console.error("[snapshot] Nightly snapshot failed:", err.message);
  }
}

/**
 * Get recent audit log entries for a user (admin use).
 */
export function getAuditLog(ownerUserId: number, limit = 100): any[] {
  return (db as any).$client.prepare(`
    SELECT * FROM audit_log
    WHERE owner_user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(ownerUserId, limit);
}

/**
 * Get available snapshots for a user (admin use).
 */
export function getSnapshots(userId: number): any[] {
  return (db as any).$client.prepare(`
    SELECT id, snapshot_date, created_at,
           length(modules_json) as size_bytes
    FROM nightly_snapshots
    WHERE user_id = ?
    ORDER BY snapshot_date DESC
    LIMIT 30
  `).all(userId);
}

/**
 * Get a specific snapshot by id (admin use).
 */
export function getSnapshot(snapshotId: number): any | null {
  const row = (db as any).$client.prepare(
    "SELECT * FROM nightly_snapshots WHERE id = ?"
  ).get(snapshotId) as any;
  if (!row) return null;
  return { ...row, data: JSON.parse(row.modules_json) };
}

// ── VeritaResponse due-date reminders ──────────────────────────────────
// Last Tier-1 gap from docs/scoping-veritaresponse.md: email reminders at
// T-14 / T-7 / T-3 / T-1 days before a finding's due_date. Dispatched by
// the daily scheduler in server/index.ts and also callable via the admin
// trigger endpoint for manual verification. UNIQUE(finding_id,
// reminder_type) on finding_reminder_log prevents double-sends across
// server restarts and manual + scheduled invocations.

const REMINDER_WINDOWS = [14, 7, 3, 1] as const;

function utcDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetweenUtc(fromIso: string, toIso: string): number | null {
  if (!fromIso || !toIso) return null;
  const from = new Date(fromIso + "T00:00:00Z").getTime();
  const to = new Date(toIso + "T00:00:00Z").getTime();
  if (isNaN(from) || isNaN(to)) return null;
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

export interface ReminderRunSummary {
  checked: number;
  sent: number;
  skipped: number;
  errors: number;
  details: Array<{ findingId: number; reminderType: string; status: 'sent' | 'skipped' | 'error'; reason?: string }>;
}

/**
 * Scan open VeritaResponse findings and dispatch any due reminders.
 * Skips COLA (consultative, no hard deadline) and already-resolved
 * findings (status accepted or closed). Returns a summary for the
 * caller to inspect or log.
 */
export async function runFindingReminders(): Promise<ReminderRunSummary> {
  const summary: ReminderRunSummary = { checked: 0, sent: 0, skipped: 0, errors: 0, details: [] };
  const sqlite = (db as any).$client;
  const today = utcDateOnly(new Date());

  // Pull resend at call time so an env without RESEND_API_KEY doesn't
  // crash the module on import; we just log-and-skip the actual send.
  let resend: any = null;
  try {
    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import("resend");
      resend = new Resend(process.env.RESEND_API_KEY);
    }
  } catch (err: any) {
    console.error("[finding-reminder] Resend init failed:", err.message);
  }

  let candidates: any[] = [];
  try {
    candidates = sqlite.prepare(`
      SELECT f.id, f.user_id, f.accreditor, f.due_date, f.status,
             f.finding_number, f.standard_ref,
             u.email AS recipient_email, u.name AS recipient_name,
             l.lab_name, l.clia_number
      FROM findings f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN labs l ON l.id = f.lab_id
      WHERE f.status NOT IN ('accepted', 'closed')
        AND f.due_date IS NOT NULL
        AND f.accreditor != 'COLA'
    `).all() as any[];
  } catch (err: any) {
    console.error("[finding-reminder] Query failed:", err.message);
    return summary;
  }

  for (const c of candidates) {
    const days = daysBetweenUtc(today, String(c.due_date).slice(0, 10));
    if (days === null) continue;
    if (!REMINDER_WINDOWS.includes(days as any)) continue;
    summary.checked++;

    const reminderType = `T-${days}`;
    const existing = sqlite.prepare(
      "SELECT id FROM finding_reminder_log WHERE finding_id = ? AND reminder_type = ? LIMIT 1"
    ).get(c.id, reminderType);
    if (existing) {
      summary.skipped++;
      summary.details.push({ findingId: c.id, reminderType, status: 'skipped', reason: 'already sent' });
      continue;
    }

    if (!c.recipient_email) {
      summary.skipped++;
      summary.details.push({ findingId: c.id, reminderType, status: 'skipped', reason: 'no recipient email' });
      continue;
    }

    if (!resend) {
      summary.skipped++;
      summary.details.push({ findingId: c.id, reminderType, status: 'skipped', reason: 'RESEND_API_KEY unset' });
      continue;
    }

    const labLabel = c.lab_name || c.clia_number || "your lab";
    const findingLabel = c.finding_number || `#${c.id}`;
    const standardLabel = c.standard_ref || "(no standard cited)";
    const subject = `VeritaResponse reminder: finding ${findingLabel} due in ${days} day${days === 1 ? '' : 's'}`;
    const text = [
      `Hello,`,
      ``,
      `This is an automated reminder from VeritaResponse for ${labLabel}.`,
      ``,
      `Finding: ${findingLabel}`,
      `Standard cited: ${standardLabel}`,
      `Accreditor: ${c.accreditor}`,
      `Due date: ${String(c.due_date).slice(0, 10)} (${days} day${days === 1 ? '' : 's'} from today)`,
      `Status: ${c.status}`,
      ``,
      `Sign in to VeritaAssure to update the response before the due date.`,
      ``,
      `Sent automatically by VeritaResponse from VeritaAssure. To stop these reminders, mark the finding as accepted or closed.`,
    ].join("\n");

    try {
      await resend.emails.send({
        from: "VeritaAssure <info@veritaslabservices.com>",
        to: [c.recipient_email],
        subject,
        text,
      });
      sqlite.prepare(
        "INSERT INTO finding_reminder_log (finding_id, reminder_type, sent_at, recipient_email) VALUES (?, ?, ?, ?)"
      ).run(c.id, reminderType, new Date().toISOString(), c.recipient_email);
      summary.sent++;
      summary.details.push({ findingId: c.id, reminderType, status: 'sent' });
    } catch (err: any) {
      console.error(`[finding-reminder] Send failed for finding ${c.id} ${reminderType}:`, err?.message || err);
      summary.errors++;
      summary.details.push({ findingId: c.id, reminderType, status: 'error', reason: err?.message || 'unknown' });
    }
  }

  console.log(`[finding-reminder] Run complete: checked=${summary.checked} sent=${summary.sent} skipped=${summary.skipped} errors=${summary.errors}`);
  return summary;
}
