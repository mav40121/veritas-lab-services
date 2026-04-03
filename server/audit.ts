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
  | "account";

export type AuditAction = "create" | "update" | "delete" | "restore";

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
    "SELECT id, employee_name, program_name, assessment_type, department, status, created_at FROM competency_assessments WHERE user_id = ?"
  ).all(userId);

  // VeritaStaff
  const staff = sqlite.prepare(
    "SELECT * FROM lab_staff WHERE user_id = ?"
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
    const data = captureUserSnapshot(userId);
    const today = new Date().toISOString().split("T")[0];
    (db as any).$client.prepare(`
      INSERT OR REPLACE INTO nightly_snapshots (user_id, snapshot_date, modules_json, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(userId, today, JSON.stringify(data));

    // Purge snapshots older than 30 days for this user
    (db as any).$client.prepare(`
      DELETE FROM nightly_snapshots
      WHERE user_id = ?
        AND snapshot_date < date('now', '-30 days')
    `).run(userId);
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
