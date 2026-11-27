// server/qcRuns.ts
//
// Storing one VeritaQC control run, judging it, and voiding it. Moved out of routes.ts (B12, 2026-11-24) so a typed run
// (POST /qc/results) and a run read from a file (server/qcFileImport.ts) are stored and judged by the same code: the insert,
// the Westgard evaluation in the lot's own order (qcWestgard.ts), the basis kept on the run, and its rule violations.
//
// A run entered late (backdated) is judged against the runs that precede it in that order. Runs already stored keep the
// verdict they were given; nothing here judges one again. Since B12 part 2 the rules are the lab's own, in force on the run's date
// (server/qcRuleSets.ts judgeRunWithRules), and the version that judged a run is kept on it (qc_results.rule_version_id).
//
// Also here: which runs were stored after their month's review was signed (addedAfterReview). A signed review row is never
// touched by a later run; the run is marked instead, on screen and on the monthly review PDF.

import { type LotRuns, type WestgardViolation } from "./qcWestgard";
import { judgeRunWithRules } from "./qcRuleSets";
import { staffOwnScope } from "./competencySelfEntry";
import type { QcBasis } from "./qcBasis";

type Sqlite = any;

export interface QcRunInput {
  labId: number;
  controlLotId: number;
  instrument: string | null;
  mapInstrumentId: number | null;
  value: number;
  date: string;               // YYYY-MM-DD
  time: string | null;        // HH:MM or HH:MM:SS, the lab's own clock
  operatorUserId: number | null;
  comment: string | null;
  now: string;
  /** Set on a run read from a file (server/qcFileImport.ts): which import, the file's row, and the operator the file names. */
  from?: { importId: number; row: number; column: string | null; operator: string | null };
}

/**
 * Why a run of this day can't be recorded on this lot, or null when it can: a retired or held lot takes runs dated on or before the day
 * it was retired or held, and none after. With no day on file nobody can tell, so it takes none. Typed and imported runs alike.
 */
export function lotNotInUse(lot: { status: string | null; out_of_use_date?: string | null; held_date?: string | null }, runDate: string): string | null {
  const status = String(lot.status ?? "active");
  if (status !== "retired" && status !== "hold") return null;
  const day = status === "retired" ? lot.out_of_use_date : lot.held_date;
  const what = status === "retired" ? "retired" : "put on hold";
  if (!day) return `This lot is ${status === "retired" ? "retired" : "on hold"} and the day isn't on file. Re-activate it, then ${status === "retired" ? "retire it with its date" : "put it on hold again"}.`;
  return runDate > day ? `This lot was ${what} on ${day}.` : null;
}

export function insertQcRun(sqlite: Sqlite, run: QcRunInput): number {
  if (!run.from) {
    return Number(sqlite.prepare(
      "INSERT INTO qc_results (lab_id, control_lot_id, instrument, map_instrument_id, result_value, result_date, run_time, operator_user_id, comment, accepted_for_reporting, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)"
    ).run(
      run.labId, run.controlLotId, run.instrument, run.mapInstrumentId, run.value, run.date, run.time, run.operatorUserId, run.comment, run.now, run.now,
    ).lastInsertRowid);
  }
  return Number(sqlite.prepare(
    "INSERT INTO qc_results (lab_id, control_lot_id, instrument, map_instrument_id, result_value, result_date, run_time, operator_user_id, comment, accepted_for_reporting, created_at, updated_at, import_id, import_row, import_column, import_operator) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)"
  ).run(
    run.labId, run.controlLotId, run.instrument, run.mapInstrumentId, run.value, run.date, run.time, run.operatorUserId, run.comment, run.now, run.now,
    run.from.importId, run.from.row, run.from.column, run.from.operator,
  ).lastInsertRowid);
}

/** The N-x and N-T counts of the rules that judged a run (0: that rule was off). */
export interface QcRunSettings { bias_consecutive_count: number; trend_consecutive_count: number }

export interface JudgedRun {
  violations: Array<{ id: number } & WestgardViolation>;
  requires_corrective_action: boolean;
  settings_used: QcRunSettings;
  basis: QcBasis | null;
  /** Which rules judged it; own_date: a late entry, judged under the rules of its own date rather than today's. */
  judged_under: { version_id: number | null; label: string; own_date: boolean };
}

/** Judge a stored run under the lab's rules in force on its date, keep the basis and the version that judged it, and store the rules it fired. */
export function judgeQcRun(sqlite: Sqlite, labId: number, controlLotId: number, resultId: number, now: string, loaded?: LotRuns): JudgedRun {
  const judged = judgeRunWithRules(sqlite, labId, controlLotId, resultId, loaded);
  const { violations, basis } = judged;
  if (basis) sqlite.prepare("UPDATE qc_results SET basis_mean = ?, basis_sd = ?, basis_source = ? WHERE id = ?").run(basis.mean, basis.sd, basis.source, resultId);
  if (judged.version.id) sqlite.prepare("UPDATE qc_results SET rule_version_id = ? WHERE id = ?").run(judged.version.id, resultId);
  const insertViol = sqlite.prepare(
    "INSERT INTO qc_rule_violations (qc_result_id, rule_code, severity, detail, related_result_ids, evaluated_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const stored: JudgedRun["violations"] = [];
  for (const v of violations) {
    const r = insertViol.run(resultId, v.rule_code, v.severity, v.detail, JSON.stringify(v.related_result_ids), now);
    stored.push({ id: Number(r.lastInsertRowid), ...v });
  }
  const set = judged.version.rules!;
  const settings: QcRunSettings = {
    bias_consecutive_count: set.rules["N-x"].on ? Number(set.rules["N-x"].n) : 0,
    trend_consecutive_count: set.rules["N-T"].on ? Number(set.rules["N-T"].n) : 0,
  };
  return {
    violations: stored, requires_corrective_action: violations.some((v) => v.severity === "rejection"), settings_used: settings, basis,
    judged_under: { version_id: judged.version.id, label: judged.judgedUnder, own_date: judged.ownDate },
  };
}

/** The module's void: the row stays with who, when and why, and drops out of the chart, statistics, rules and the monthly review. */
export function voidQcRun(sqlite: Sqlite, resultId: number, userId: number, reason: string, source: "import_undo" | null = null): void {
  if (source) {
    sqlite.prepare("UPDATE qc_results SET voided_at = datetime('now'), voided_by_user_id = ?, void_reason = ?, void_source = ? WHERE id = ?").run(userId, reason, source, resultId);
    return;
  }
  sqlite.prepare("UPDATE qc_results SET voided_at = datetime('now'), voided_by_user_id = ?, void_reason = ? WHERE id = ?").run(userId, reason, resultId);
}

/** A run that counts. A voided run stays on file and shows only where it is marked voided; counts, charts and other modules take this (BUG-198). */
export const LIVE_RUN = (a = "") => `${a}voided_at IS NULL`;

/** A run an import brought in and that was taken back with it isn't one the lab has: left out even of the feed that shows voided runs, marked. */
export const NOT_TAKEN_BACK = (a = "") => `COALESCE(${a}void_source, '') <> 'import_undo'`;

/** Reads beyond the results themselves (imports on file, the sigma metric): any member, as VeritaQC's reads are, but not a limited Staff login. */
export const qcReader = (sqlite: () => Sqlite) => (req: any, res: any, next: any) =>
  staffOwnScope(sqlite(), req.userId, req.scope.labId, "veritaqc")
    ? res.status(403).json({ error: "A staff login records and reads QC results. Imports and the sigma metric aren't part of it.", code: "STAFF_OWN_ONLY" })
    : next();

// ── Runs stored after their month's review was signed ────────────────────────────────────────────────────────────────

/** A stored moment in milliseconds: ISO with a zone, or SQLite's datetime('now'), which is UTC. */
export function momentMs(stamp: string | null | undefined): number {
  const s = String(stamp ?? "").trim();
  if (!s) return NaN;
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s.replace(" ", "T")}Z`);
}

export interface SignedMonth { reviewed_at: string; reviewed_by: string | null }
const monthKey = (lotId: number, date: string) => `${lotId}|${String(date).slice(0, 7)}`;

/** The signed monthly reviews of these lots, by lot and month. */
export function signedMonths(sqlite: Sqlite, labId: number, lotIds: number[]): Map<string, SignedMonth> {
  const out = new Map<string, SignedMonth>();
  const ids = Array.from(new Set(lotIds));
  if (!ids.length) return out;
  const rows = sqlite.prepare(
    `SELECT r.control_lot_id, r.period_year, r.period_month, r.reviewed_at, u.name AS reviewed_by
       FROM qc_period_reviews r LEFT JOIN users u ON u.id = r.reviewed_by_user_id
      WHERE r.lab_id = ? AND r.attestation_acknowledged = 1 AND r.control_lot_id IN (SELECT value FROM json_each(?))`
  ).all(labId, JSON.stringify(ids)) as any[];
  for (const r of rows) {
    out.set(`${r.control_lot_id}|${r.period_year}-${String(r.period_month).padStart(2, "0")}`, { reviewed_at: r.reviewed_at, reviewed_by: r.reviewed_by || null });
  }
  return out;
}

export const signedMonthOf = (months: Map<string, SignedMonth>, lotId: number, date: string): SignedMonth | null => months.get(monthKey(lotId, date)) ?? null;

/** When the month's review was signed, if this run was stored after it; else null. */
export function addedAfterReview(months: Map<string, SignedMonth>, run: { control_lot_id: number; result_date: string; created_at: string | null }): string | null {
  const signed = signedMonthOf(months, run.control_lot_id, run.result_date);
  if (!signed) return null;
  return momentMs(run.created_at) > momentMs(signed.reviewed_at) ? signed.reviewed_at : null;
}
