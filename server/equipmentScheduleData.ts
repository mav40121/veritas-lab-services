// server/equipmentScheduleData.ts
//
// The stored side of VeritaMaintain schedules (B10, 2026-11-24): what the equipment routes, the schedule routes, the reminders, the
// monthly review and the demo date refresh all read and write. Rules: shared/equipmentSchedules.ts. Routes: server/equipmentSchedules.ts.
//
// The first schedule (is_primary) is the single PM interval every instrument had before. lab_equipment.pm_interval_days and next_due_date
// stay its mirror, so the older readers (readiness, the digest, the instrument list) read what they always did: setScheduleDue writes
// both, and syncPrimaryFromEquipment carries a change typed on the instrument's own form back to the schedule.
import { addMonths, dueAfter, nominalDays } from "../shared/equipmentSchedules";

type Sqlite = any;

export interface ScheduleRow {
  id: number; lab_id: number; equipment_id: number; name: string; schedule_type: string; frequency: string; interval_days: number | null;
  next_due_date: string | null; recipients_json: string | null; sop_document_id: number | null; is_primary: number; active: number; starts_on: string | null;
  ended_at: string | null; ended_on: string | null; ended_by_name: string | null; end_reason: string | null; created_at: string; updated_at: string;
}

export const PRIMARY_NAME = "Preventive maintenance";

export function activeSchedules(sqlite: Sqlite, labId: number, equipmentId: number): ScheduleRow[] {
  return sqlite.prepare("SELECT * FROM equipment_schedules WHERE lab_id = ? AND equipment_id = ? AND active = 1 ORDER BY is_primary DESC, id").all(labId, equipmentId) as ScheduleRow[];
}
export function primaryOf(sqlite: Sqlite, labId: number, equipmentId: number): ScheduleRow | null {
  return (sqlite.prepare("SELECT * FROM equipment_schedules WHERE lab_id = ? AND equipment_id = ? AND active = 1 AND is_primary = 1 ORDER BY id LIMIT 1").get(labId, equipmentId) as ScheduleRow) ?? null;
}

/** The instrument's first schedule, made from its own interval and due date when it doesn't have one yet. Null when it has neither. */
export function ensurePrimary(sqlite: Sqlite, eq: any, now: string, by: { id: number | null; name: string | null } = { id: null, name: null }): ScheduleRow | null {
  const have = primaryOf(sqlite, eq.lab_id, eq.id);
  if (have) return have;
  const days = Number(eq.pm_interval_days) > 0 ? Number(eq.pm_interval_days) : null;
  if (!days && !eq.next_due_date) return null;
  sqlite.prepare(
    `INSERT INTO equipment_schedules (lab_id, equipment_id, name, schedule_type, frequency, interval_days, next_due_date, recipients_json, is_primary, active, starts_on, created_by_user_id, created_by_name, created_at, updated_at)
     VALUES (?, ?, ?, 'preventive_maintenance', ?, ?, ?, '[]', 1, 1, ?, ?, ?, ?, ?)`
  ).run(eq.lab_id, eq.id, PRIMARY_NAME, days ? "every_n_days" : "manual", days, eq.next_due_date ?? null, String(eq.created_at || now).slice(0, 10), by.id, by.name, now, now);
  return primaryOf(sqlite, eq.lab_id, eq.id);
}

/** The schedule's due date, and on the first schedule the instrument's own with it. */
export function setScheduleDue(sqlite: Sqlite, s: { id: number; equipment_id: number; is_primary: number }, due: string | null, now: string): void {
  sqlite.prepare("UPDATE equipment_schedules SET next_due_date = ?, updated_at = ? WHERE id = ?").run(due, now, s.id);
  if (s.is_primary) sqlite.prepare("UPDATE lab_equipment SET next_due_date = ?, updated_at = ? WHERE id = ?").run(due, now, s.equipment_id);
}

/** The instrument's own columns after a change to its first schedule. */
export function mirrorPrimary(sqlite: Sqlite, s: ScheduleRow, now: string): void {
  sqlite.prepare("UPDATE lab_equipment SET pm_interval_days = ?, next_due_date = ?, updated_at = ? WHERE id = ?")
    .run(s.active ? nominalDays(s.frequency, s.interval_days) : null, s.active ? s.next_due_date : null, now, s.equipment_id);
}

/** A PM interval or due date typed on the instrument's form (the older screen): the first schedule follows. */
export function syncPrimaryFromEquipment(sqlite: Sqlite, before: any, after: any, now: string, by: { id: number | null; name: string | null }): void {
  const intervalChanged = (before?.pm_interval_days ?? null) !== (after.pm_interval_days ?? null);
  const dueChanged = (before?.next_due_date ?? null) !== (after.next_due_date ?? null);
  if (!intervalChanged && !dueChanged) { if (!before) ensurePrimary(sqlite, after, now, by); return; }
  const s = primaryOf(sqlite, after.lab_id, after.id);
  if (!s) { ensurePrimary(sqlite, after, now, by); return; }
  const days = Number(after.pm_interval_days) > 0 ? Number(after.pm_interval_days) : null;
  // An interval that is just this schedule's own, written another way, leaves a monthly or quarterly schedule as it is.
  const frequency = !intervalChanged || (days !== null && days === nominalDays(s.frequency, s.interval_days)) ? s.frequency : days ? "every_n_days" : "manual";
  sqlite.prepare("UPDATE equipment_schedules SET frequency = ?, interval_days = ?, next_due_date = ?, updated_at = ? WHERE id = ?")
    .run(frequency, frequency === "every_n_days" ? days ?? s.interval_days : null, after.next_due_date ?? null, now, s.id);
}

/**
 * The boot step that gives each instrument from before schedules its first one, with the interval and due date it already has. Nothing on
 * lab_equipment is written, so no due date moves; a second boot finds them there and adds nothing.
 */
export function backfillPrimarySchedules(sqlite: Sqlite): number {
  return sqlite.prepare(
    `INSERT INTO equipment_schedules (lab_id, equipment_id, name, schedule_type, frequency, interval_days, next_due_date, recipients_json, is_primary, active, starts_on, created_at, updated_at)
     SELECT e.lab_id, e.id, '${PRIMARY_NAME}', 'preventive_maintenance', CASE WHEN COALESCE(e.pm_interval_days, 0) > 0 THEN 'every_n_days' ELSE 'manual' END,
            CASE WHEN COALESCE(e.pm_interval_days, 0) > 0 THEN e.pm_interval_days ELSE NULL END, e.next_due_date, '[]', 1, 1, substr(e.created_at, 1, 10), datetime('now'), datetime('now')
       FROM lab_equipment e
      WHERE (COALESCE(e.pm_interval_days, 0) > 0 OR (e.next_due_date IS NOT NULL AND TRIM(e.next_due_date) <> ''))
        AND NOT EXISTS (SELECT 1 FROM equipment_schedules s WHERE s.equipment_id = e.id AND s.is_primary = 1)`
  ).run().changes as number;
}

// ── Checklists ─────────────────────────────────────────────────────────────────────────────────────────

export interface ChecklistVersion { id: number; version_no: number; created_at: string; created_by_name: string | null; change_note: string | null; steps: any[] }

/** The schedule's checklist as it stands: its newest version, or null when it has none or the newest version has no steps. */
export function currentChecklist(sqlite: Sqlite, labId: number, scheduleId: number): ChecklistVersion | null {
  const v = sqlite.prepare("SELECT * FROM equipment_checklist_versions WHERE lab_id = ? AND schedule_id = ? ORDER BY version_no DESC, id DESC LIMIT 1").get(labId, scheduleId) as any;
  if (!v) return null;
  const steps = sqlite.prepare("SELECT * FROM equipment_checklist_steps WHERE lab_id = ? AND version_id = ? ORDER BY position, id").all(labId, v.id) as any[];
  return steps.length ? { ...v, steps } : null;
}

// ── Completions ────────────────────────────────────────────────────────────────────────────────────────
// A completion belongs to an event by the event's root id, so a corrected event keeps it. The day it counts for is the standing event's
// own date; a completion whose event is voided, or that was itself taken back, counts for nothing.

export const STANDING_COMPLETION = `c.voided_at IS NULL AND e.superseded_by_event_id IS NULL AND e.voided_at IS NULL`;
export const COMPLETION_JOIN = `equipment_schedule_completions c JOIN equipment_maintenance_events e ON e.lab_id = c.lab_id AND (e.id = c.event_id OR e.root_event_id = c.event_id)`;

/** Standing completions of one schedule inside a date range, oldest first. `done_day` is the day each counts for. */
export function completionsBetween(sqlite: Sqlite, labId: number, scheduleId: number, from: string, to: string): any[] {
  return sqlite.prepare(
    `SELECT c.*, e.event_date AS done_day FROM ${COMPLETION_JOIN} WHERE c.lab_id = ? AND c.schedule_id = ? AND ${STANDING_COMPLETION} AND e.event_date >= ? AND e.event_date <= ? ORDER BY e.event_date, c.id`
  ).all(labId, scheduleId, from, to) as any[];
}

/** The next time a due date would come round after today, by whole cycles of its own frequency (server/demoDateRefresh.ts). */
export function rollForward(frequency: string, intervalDays: number | null, due: string, today: string): string {
  let next = due;
  for (let i = 0; i < 2000 && next < today; i += 1) {
    const step = dueAfter(frequency, intervalDays, next) ?? addMonths(next, 12);
    if (step <= next) break;
    next = step;
  }
  return next;
}
