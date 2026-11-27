// server/lodFactorChangeList.ts
//
// BUG-190 (owner pick 2026-11-27, option 1): GET /api/admin/veritacheck/lod-cbeta-change-list (header x-admin-secret only).
// New detection-limit (LoD) calculations take the factor from the CLSI EP17-A2 formula; a study saved before keeps the
// result it was saved with (the superseded table, shared/lodFactor.ts). This lists, for every saved sensitivity study,
// what the formula would give, so the owner can see which saved results it would move before anyone recalculates one.
// Counts first, then one row per study with ids and numbers only: no lab name, test name, analyst, signer or other name.
// A draft has no saved result, so it is counted and not listed. Read-only: nothing is written.

import { calculateSensitivity } from "../client/src/lib/calculations";
import { LOD_FACTOR_FORMULA, lodFactorMethodOf } from "../shared/lodFactor";

type SqliteLike = any;
const round = (v: unknown, d: number): number | null => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(d)) : null);

export interface LodFactorChangeRow {
  studyId: number;
  labId: number | null;
  signed: boolean;
  savedMethod: "table_2026_05" | "ep17_formula";
  savedPassFail: string;
  old: { factor: number | null; lod: number | null };
  formula: { factor: number | null; lod: number | null; L: number | null; K: number | null; passFail: "pass" | "fail" | null };
  passFailWouldChange: boolean;
  notEvaluable?: true;
}

export function lodFactorChangeList(sqlite: SqliteLike) {
  const rows = sqlite.prepare(
    `SELECT id, lab_id, status, lifecycle_state, data_points FROM studies WHERE study_type = 'sensitivity' ORDER BY lab_id, id`
  ).all() as any[];
  const counts = {
    studies: rows.length, drafts: 0, saved: 0, signed: 0, savedWithTable: 0, savedWithFormula: 0,
    passFailWouldChange: 0, signedPassFailWouldChange: 0, passToFail: 0, failToPass: 0, lodLower: 0, lodHigher: 0, notEvaluable: 0,
  };
  const byLab: Record<string, { saved: number; signed: number; passFailWouldChange: number }> = {};
  const studies: LodFactorChangeRow[] = [];
  for (const r of rows) {
    if (r.status === "draft") { counts.drafts++; continue; }
    counts.saved++;
    const signed = r.lifecycle_state === "finalized";
    if (signed) counts.signed++;
    const lab = String(r.lab_id ?? "none");
    byLab[lab] = byLab[lab] || { saved: 0, signed: 0, passFailWouldChange: 0 };
    byLab[lab].saved++;
    if (signed) byLab[lab].signed++;
    let dp: any = null;
    try { dp = JSON.parse(r.data_points); } catch { /* unreadable */ }
    const input = dp && typeof dp === "object" ? dp.input : null;
    const savedMethod = lodFactorMethodOf(input);
    const row: LodFactorChangeRow = {
      studyId: r.id, labId: r.lab_id ?? null, signed, savedMethod, savedPassFail: String(r.status ?? ""),
      old: { factor: null, lod: null }, formula: { factor: null, lod: null, L: null, K: null, passFail: null }, passFailWouldChange: false,
    };
    if (!input || typeof input !== "object" || !Array.isArray(input.blanks) || !Array.isArray(input.lowLevel)) {
      counts.notEvaluable++; row.notEvaluable = true; studies.push(row); continue;
    }
    if (savedMethod === LOD_FACTOR_FORMULA) counts.savedWithFormula++; else counts.savedWithTable++;
    // The saved result as stored; a row whose stored results are missing reads as its own method reproduces it.
    const saved = dp.results && typeof dp.results === "object" && dp.results.lod ? dp.results : calculateSensitivity(input);
    const next = calculateSensitivity({ ...input, cbetaMethod: LOD_FACTOR_FORMULA });
    row.old = { factor: round(saved.lod?.cBeta, 3), lod: round(saved.lod?.value, 6) };
    row.formula = {
      factor: round(next.lod.cBeta, 3), lod: round(next.lod.value, 6), L: next.lod.nLowLevel, K: next.lod.nLowLevelSamples ?? null,
      passFail: Number.isFinite(next.lod.value) ? (next.overallPass ? "pass" : "fail") : null,
    };
    if (row.formula.passFail === null) { counts.notEvaluable++; row.notEvaluable = true; studies.push(row); continue; }
    if (typeof saved.lod?.value === "number" && next.lod.value < saved.lod.value) counts.lodLower++;
    if (typeof saved.lod?.value === "number" && next.lod.value > saved.lod.value) counts.lodHigher++;
    // The saved verdict is the stored status (what the dashboard reads), else the saved result's own.
    const savedVerdict = r.status === "pass" || r.status === "fail" ? r.status : typeof saved.overallPass === "boolean" ? (saved.overallPass ? "pass" : "fail") : null;
    row.savedPassFail = savedVerdict ?? row.savedPassFail;
    if (savedVerdict && savedVerdict !== row.formula.passFail) {
      row.passFailWouldChange = true;
      counts.passFailWouldChange++;
      byLab[lab].passFailWouldChange++;
      if (signed) counts.signedPassFailWouldChange++;
      if (savedVerdict === "pass") counts.passToFail++; else counts.failToPass++;
    }
    studies.push(row);
  }
  return { counts, byLab, studies };
}
