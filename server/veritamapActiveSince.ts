// When a VeritaMap test became active on an instrument (veritamap_instrument_tests.active_since).
//
// 2026-11-11, Michael Q281 = 1: the compliance digest counts "New tests added" each month, and a new test is what
// starts a performance verification. No test row carried a date (veritamap_tests has only updated_at, which every
// map rebuild rewrites; veritamap_instrument_tests had none), so nothing could be counted. Every path that adds a
// test row or switches one on goes through here:
//   - an insert: active rows get now, inactive rows NULL (a backup analyzer pre-loaded with its menu switched off
//     hasn't added anything until a test is switched on);
//   - a switch on an existing row: off -> on sets now, on -> on keeps its date, -> off clears it (switched back on
//     later, it is a new date: the test was out of the menu in between);
//   - the build page's replace-all save, which deletes and re-inserts an instrument's rows: a row that was already
//     active keeps its date, including NULL. Rows that existed before this column stay NULL, so a lab's existing menu
//     never reads as new.
// The digest decides what to show (for example leaving out a map's first build); this only records when.

export type PriorRow = { active: number; active_since: string | null };

export function nowIso(): string {
  return new Date().toISOString();
}

/** active_since for a row being inserted fresh. */
export function activeSinceOnInsert(active: unknown, now: string = nowIso()): string | null {
  return isActive(active) ? now : null;
}

/** active_since for a row re-inserted by a replace-all save, given what the row held before (if it existed). */
export function activeSinceOnReplace(active: unknown, prior: PriorRow | undefined, now: string = nowIso()): string | null {
  if (!isActive(active)) return null;
  if (prior && Number(prior.active) === 1) return prior.active_since ?? null;
  return now;
}

/**
 * SET clause for an UPDATE that changes `active`. Bind order: (active, active, now).
 * off -> on: now; on -> on: unchanged; -> off: NULL.
 */
export const SET_ACTIVE_WITH_SINCE_SQL =
  "active = ?, active_since = CASE WHEN ? = 1 THEN (CASE WHEN active = 1 THEN active_since ELSE ? END) ELSE NULL END";

export function isActive(active: unknown): boolean {
  if (typeof active === "boolean") return active;
  if (active === null || active === undefined) return true; // the insert paths default a missing flag to active
  return Number(active) === 1;
}

/** The rows an instrument holds now, keyed by lower(trim(analyte)), read before a replace-all save deletes them. */
export function snapshotActiveSince(client: any, instId: string | number, mapId: string | number): Map<string, PriorRow> {
  const rows = client
    .prepare("SELECT analyte, active, active_since FROM veritamap_instrument_tests WHERE instrument_id = ? AND map_id = ?")
    .all(instId, mapId) as { analyte: string; active: number; active_since: string | null }[];
  const out = new Map<string, PriorRow>();
  for (const r of rows) out.set(String(r.analyte || "").toLowerCase().trim(), { active: Number(r.active), active_since: r.active_since ?? null });
  return out;
}
