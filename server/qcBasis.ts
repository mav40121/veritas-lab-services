// VeritaQC evaluation basis: which mean and SD a control run is judged against.
//
// One resolver for the Westgard rules, the Levey-Jennings chart, the continuous
// line chart and the monthly PDF, so what the chart shows is what the rules
// judged (the 2026-10-06 MedStar "1-3s flagged but the point sits near the
// mean" report was two different baselines for one run).
//
// Design (Mike Hiltunen / MedStar, 2026-09-30 and 2026-10-08; CLSI C24
// practice; 42 CFR 493.1256(d)(10)):
//   - A lot is judged against the LAB'S OWN established mean and SD once the
//     lab has enough runs on it (establish_n accepted runs, default 20).
//   - Until then (a new lot put into service without a parallel run) it is
//     judged against the manufacturer's published mean and SD for the lot.
//   - When the lot reaches establish_n accepted runs, the first establish_n
//     lock in as the lab's established mean and SD (lockEstablishedIfDue), so
//     voiding or excluding an early run later does not move the baseline.
//   - An owner or admin can re-establish (from all runs on file, or entered
//     values); a persisted basis always wins over the automatic one.
//   - The manufacturer's mean and range stay on the lot as the reference drawn
//     on the chart; they judge runs only while the lab is still establishing.

export const DEFAULT_ESTABLISH_N = 20;

export type QcBasisSource = "established" | "manufacturer";

export interface QcBasis {
  mean: number;
  sd: number;
  source: QcBasisSource;
  n: number;                  // accepted runs the basis rests on (0 = manufacturer values)
  runsOnLot: number;          // accepted runs on the lot before the run being judged
  establishN: number;         // runs needed before the lab's own numbers take over
  lockedAt: string | null;    // set once an established basis is persisted
  persisted: boolean;         // true when read from the lot row, false when computed
  label: string;              // one plain-English line for the UI and the PDF
}

export interface QcBasisLot {
  id: number;
  mfr_mean: number | null;
  mfr_sd: number | null;
  lab_mean?: number | null;
  lab_sd?: number | null;
  lab_basis_n?: number | null;
  lab_basis_locked_at?: string | null;
  lab_basis_source?: string | null;
}

export interface QcBasisConfig {
  establishN: number;
}

export function sampleStats(vals: number[]): { mean: number; sd: number } {
  const n = vals.length;
  if (n === 0) return { mean: NaN, sd: NaN };
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, sd: NaN };
  const sd = Math.sqrt(vals.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  return { mean, sd };
}

const fmt = (x: number) =>
  !Number.isFinite(x) ? "-" : Math.abs(x) >= 100 ? x.toFixed(1) : Math.abs(x) >= 10 ? x.toFixed(2) : x.toFixed(3);

// PURE: no database access, so every branch is unit-testable.
//   priorRuns = accepted, non-voided values on THIS lot that precede the run
//               being judged (or all of them, for "what judges the next run").
export function computeBasis(lot: QcBasisLot, priorRuns: number[], cfg: QcBasisConfig): QcBasis | null {
  const establishN = Math.max(2, Math.floor(cfg.establishN));
  const runsOnLot = priorRuns.length;
  const labMean = lot.lab_mean == null ? NaN : Number(lot.lab_mean);
  const labSd = lot.lab_sd == null ? NaN : Number(lot.lab_sd);

  if (Number.isFinite(labMean) && Number.isFinite(labSd) && labSd > 0) {
    const n = Number(lot.lab_basis_n) || 0;
    const how = lot.lab_basis_source === "manual" ? "entered by the lab"
      : lot.lab_basis_source === "all_runs" ? `from ${n} runs`
      : `from the first ${n} runs`;
    return {
      mean: labMean, sd: labSd, source: "established", n, runsOnLot, establishN,
      lockedAt: lot.lab_basis_locked_at || null, persisted: true,
      label: `Lab established mean ${fmt(labMean)}, SD ${fmt(labSd)} (${how}${lot.lab_basis_locked_at ? `, set ${String(lot.lab_basis_locked_at).slice(0, 10)}` : ""})`,
    };
  }

  if (runsOnLot >= establishN) {
    const { mean, sd } = sampleStats(priorRuns.slice(0, establishN));
    if (Number.isFinite(sd) && sd > 0) {
      return {
        mean, sd, source: "established", n: establishN, runsOnLot, establishN, lockedAt: null, persisted: false,
        label: `Lab established mean ${fmt(mean)}, SD ${fmt(sd)} (from the first ${establishN} runs)`,
      };
    }
  }

  const mfrMean = Number(lot.mfr_mean);
  const mfrSd = Number(lot.mfr_sd);
  if (!(Number.isFinite(mfrMean) && Number.isFinite(mfrSd) && mfrSd > 0)) return null;
  return {
    mean: mfrMean, sd: mfrSd, source: "manufacturer", n: 0, runsOnLot, establishN, lockedAt: null, persisted: false,
    label: `Manufacturer mean ${fmt(mfrMean)}, SD ${fmt(mfrSd)} while the lab establishes its own (${runsOnLot} of ${establishN} runs)`,
  };
}

// ── database helpers ────────────────────────────────────────────────────────

const LOT_COLS = "id, lab_id, analyte, mfr_mean, mfr_sd, mfr_range_low, mfr_range_high, lab_mean, lab_sd, lab_basis_n, lab_basis_locked_at, lab_basis_source";

export function loadBasisLot(sqlite: any, labId: number, lotId: number): (QcBasisLot & { analyte: string; mfr_range_low: number | null; mfr_range_high: number | null }) | undefined {
  return sqlite.prepare(`SELECT ${LOT_COLS} FROM qc_control_lots WHERE id = ? AND lab_id = ?`).get(lotId, labId);
}

export function basisConfig(sqlite: any, labId: number, analyte: string | null): QcBasisConfig {
  let row: any;
  try {
    row = sqlite.prepare(
      "SELECT establish_n FROM qc_rule_settings WHERE lab_id = ? AND (analyte = ? OR analyte IS NULL) ORDER BY (analyte IS NULL) ASC LIMIT 1"
    ).get(labId, analyte);
  } catch { row = undefined; }
  const e = Number(row?.establish_n);
  return { establishN: Number.isFinite(e) && e >= 2 ? e : DEFAULT_ESTABLISH_N };
}

// Accepted, non-voided runs on the lot in chart order (result_date, then id).
export function acceptedHistory(sqlite: any, labId: number, lotId: number): { id: number; result_value: number; result_date: string }[] {
  return sqlite.prepare(
    "SELECT id, result_value, result_date FROM qc_results WHERE lab_id = ? AND control_lot_id = ? AND accepted_for_reporting = 1 AND voided_at IS NULL ORDER BY result_date ASC, id ASC"
  ).all(labId, lotId);
}

// What judges a run: beforeResultId = the run being judged (basis from the runs
// that precede it in chart order); omitted = what will judge the NEXT run.
export function resolveBasis(sqlite: any, labId: number, lotId: number, opts: { beforeResultId?: number } = {}): QcBasis | null {
  const lot = loadBasisLot(sqlite, labId, lotId);
  if (!lot) return null;
  const hist = acceptedHistory(sqlite, labId, lotId);
  let prior = hist;
  if (opts.beforeResultId != null) {
    const i = hist.findIndex(r => r.id === opts.beforeResultId);
    prior = i >= 0 ? hist.slice(0, i) : hist;
  }
  return computeBasis(lot, prior.map(r => Number(r.result_value)), basisConfig(sqlite, labId, lot.analyte));
}

// Persist the automatically established basis the first time a lot has
// establish_n accepted runs, so voiding or excluding an early run later does not
// move the lab's mean. Never overwrites a basis already on the lot.
// excludeResultId = the run just entered: it has not yet had its chance to be
// excluded after a rejection, so it never counts toward the locked numbers.
export function lockEstablishedIfDue(sqlite: any, labId: number, lotId: number, excludeResultId?: number): QcBasis | null {
  const lot = loadBasisLot(sqlite, labId, lotId);
  if (!lot || lot.lab_mean != null) return null;
  const cfg = basisConfig(sqlite, labId, lot.analyte);
  const vals = acceptedHistory(sqlite, labId, lotId)
    .filter(r => excludeResultId == null || r.id !== excludeResultId)
    .map(r => Number(r.result_value));
  if (vals.length < cfg.establishN) return null;
  const { mean, sd } = sampleStats(vals.slice(0, cfg.establishN));
  if (!Number.isFinite(sd) || sd <= 0) return null;
  const now = new Date().toISOString();
  const r = sqlite.prepare(
    "UPDATE qc_control_lots SET lab_mean = ?, lab_sd = ?, lab_basis_n = ?, lab_basis_locked_at = ?, lab_basis_source = 'auto', updated_at = ? WHERE id = ? AND lab_id = ? AND lab_mean IS NULL"
  ).run(mean, sd, cfg.establishN, now, now, lotId, labId);
  return r.changes > 0 ? resolveBasis(sqlite, labId, lotId) : null;
}
