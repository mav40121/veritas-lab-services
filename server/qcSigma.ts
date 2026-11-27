// server/qcSigma.ts
//
// VeritaQC: the sigma metric per test, level and lot (B12, 2026-11-24; the arithmetic is shared/qcSigma.ts). Reads the runs on file;
// judges nothing and changes no rule. The runs are the ones the module's own statistics use: not voided, and not left out of the QC
// baseline by a corrective action. All of a lot's analyzers together.
//
// Two things the laboratory sets, each with an audit row: an allowable error per test (its own percent or units, or one of the app's
// regulatory criteria for that test; the choice is the laboratory's), and a peer mean per lot. With no peer mean the target is the
// manufacturer's mean on the lot. The lab's own mean is never the target.
//
// Reading follows VeritaQC's own read rule, so a view-only seat reads it; a limited Staff login doesn't (qcRuns.ts qcReader). Setting
// either needs VeritaQC edit, and Veritas support sets neither (server/vlsSupport.ts).

import type { Express } from "express";
import { db } from "./db";
import { logAudit } from "./audit";
import { CLIA_PRESETS } from "../shared/cliaPresets";
import { regulatedAnalyteFor } from "../shared/regulatedAnalytes";
import { qcReader } from "./qcRuns";
import { computeSigma, isOwnMean, SIGMA_FORMULA, type AllowableErrorSetting, type SigmaTarget } from "../shared/qcSigma";

type Sqlite = any;

/** The app's regulatory criteria for this test: the presets that mean the same 42 CFR 493 Subpart I row as the test's name. */
export function criteriaForAnalyte(analyte: string): Array<{ label: string; cfr: string }> {
  const row = regulatedAnalyteFor(analyte);
  if (!row) return [];
  return CLIA_PRESETS.filter((p) => p.value > 0 && regulatedAnalyteFor(p.label.replace(/\s*\([^()]*\)\s*$/, ""))?.analyte === row.analyte).map((p) => ({ label: p.label, cfr: p.cfr }));
}

export function sigmaRows(sqlite: Sqlite, labId: number) {
  const lots = sqlite.prepare(
    "SELECT id, analyte, level, lot_number, status, mfr_mean, lab_mean, lab_basis_source FROM qc_control_lots WHERE lab_id = ? ORDER BY analyte COLLATE NOCASE, level COLLATE NOCASE, (status = 'active') DESC, id DESC"
  ).all(labId) as any[];
  const allowable = new Map<string, any>((sqlite.prepare("SELECT * FROM qc_allowable_errors WHERE lab_id = ?").all(labId) as any[]).map((a) => [a.analyte, a]));
  const peers = new Map<number, any>((sqlite.prepare("SELECT * FROM qc_peer_means WHERE lab_id = ?").all(labId) as any[]).map((p) => [p.control_lot_id, p]));
  const runs = new Map<number, number[]>();
  const analyzers = new Map<number, Set<string>>();
  const first = new Map<number, string>(), last = new Map<number, string>();
  for (const r of sqlite.prepare(
    "SELECT control_lot_id, result_value, result_date, instrument FROM qc_results WHERE lab_id = ? AND voided_at IS NULL AND accepted_for_reporting = 1 ORDER BY result_date, id"
  ).all(labId) as any[]) {
    (runs.get(r.control_lot_id) ?? runs.set(r.control_lot_id, []).get(r.control_lot_id)!).push(Number(r.result_value));
    if (r.instrument) (analyzers.get(r.control_lot_id) ?? analyzers.set(r.control_lot_id, new Set()).get(r.control_lot_id)!).add(String(r.instrument).trim());
    if (!first.has(r.control_lot_id)) first.set(r.control_lot_id, r.result_date);
    last.set(r.control_lot_id, r.result_date);
  }
  const excluded = new Map<number, number>((sqlite.prepare(
    "SELECT control_lot_id AS id, COUNT(*) AS n FROM qc_results WHERE lab_id = ? AND voided_at IS NULL AND accepted_for_reporting <> 1 GROUP BY control_lot_id"
  ).all(labId) as any[]).map((r) => [r.id, r.n]));
  return lots.map((l) => {
    const a = allowable.get(l.analyte) ?? null, peer = peers.get(l.id) ?? null;
    const target: SigmaTarget | null = peer ? { value: Number(peer.peer_mean), source: "peer", note: peer.source_note || null }
      : l.mfr_mean !== null && Number.isFinite(Number(l.mfr_mean)) ? { value: Number(l.mfr_mean), source: "manufacturer", note: null } : null;
    const setting: AllowableErrorSetting | null = a ? { preset_label: a.preset_label, percent: a.percent, units_value: a.units_value, unit: a.unit } : null;
    const result = computeSigma({ values: runs.get(l.id) ?? [], target, allowable: setting });
    // The lab's own mean: the one worked out from its runs, and the one it set for the lot (VeritaQC's established basis).
    const set = (l.lab_basis_source === "manual" || l.lab_basis_source === "all_runs") && l.lab_mean !== null ? Number(l.lab_mean) : null;
    return {
      target_is_own_mean: target?.source === "manufacturer" && (isOwnMean(target.value, result.mean, result.sd) || isOwnMean(target.value, set, result.sd)),
      control_lot_id: l.id, analyte: l.analyte, level: l.level, lot_number: l.lot_number, status: l.status, mfr_mean: l.mfr_mean,
      peer_mean: peer ? { value: Number(peer.peer_mean), note: peer.source_note, set_by_name: peer.set_by_name, set_at: peer.set_at } : null,
      analyzers: Array.from(analyzers.get(l.id) ?? []).sort(), first_run: first.get(l.id) ?? null, last_run: last.get(l.id) ?? null, left_out: excluded.get(l.id) ?? 0,
      result,
    };
  });
}

export function registerQcSigmaRoutes(app: Express, deps: { authMiddleware: any; labScopeMiddleware: any; requireWriteAccess: any; requireModuleEdit: (mod: string) => any; hasModuleEditAccess: (labId: number, userId: number, mod: string) => boolean }) {
  const { authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit, hasModuleEditAccess } = deps;
  const sqlite = (): Sqlite => (db as any).$client;
  const read = [authMiddleware, labScopeMiddleware, qcReader(sqlite)];
  const edit = [authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritaqc")];
  const userName = (userId: number): string => {
    const u = sqlite().prepare("SELECT name, email FROM users WHERE id = ?").get(userId) as any;
    return (u?.name && String(u.name).trim()) || u?.email || `user ${userId}`;
  };
  const audit = (req: any, entityType: string, entityId: number | string, label: string, before: any, after: any) => logAudit({
    userId: req.userId, ownerUserId: req.scope?.lab?.owner_user_id ?? req.userId, module: "veritaqc", action: "update", entityType, entityId, entityLabel: label,
    before: before ?? undefined, after: { ...(after ?? {}), lab_id: req.scope.labId }, ipAddress: req.ip,
  });
  const allowableIn = (labId: number, analyte: string): any => sqlite().prepare("SELECT preset_label, percent, units_value, unit, set_by_name, set_at FROM qc_allowable_errors WHERE lab_id = ? AND analyte = ?").get(labId, analyte) ?? null;
  const positive = (v: any): number | null => { const n = typeof v === "string" ? Number(v.trim() || NaN) : Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

  app.get("/api/labs/:labId/qc/sigma", ...read, (req: any, res) => {
    const rows = sigmaRows(sqlite(), req.scope.labId);
    const analytes = Array.from(new Set(rows.map((r) => r.analyte)));
    res.json({
      formula: SIGMA_FORMULA, can_set: !req.scope.viaVlsSupport && hasModuleEditAccess(req.scope.labId, req.userId, "veritaqc"), rows,
      analytes: analytes.map((a) => ({ analyte: a, allowable: allowableIn(req.scope.labId, a), criteria: criteriaForAnalyte(a) })),
    });
  });

  // { analyte, preset_label } | { analyte, percent } | { analyte, units_value, unit } | { analyte, clear: true }
  app.put("/api/labs/:labId/qc/sigma/allowable-error", ...edit, (req: any, res) => {
    const labId = req.scope.labId, b = req.body || {};
    const analyte = String(b.analyte ?? "");
    const lot = sqlite().prepare("SELECT 1 FROM qc_control_lots WHERE lab_id = ? AND analyte = ?").get(labId, analyte);
    if (!lot) return res.status(404).json({ error: "That test has no control lot in this lab." });
    const before = allowableIn(labId, analyte);
    if (b.clear === true) {
      sqlite().prepare("DELETE FROM qc_allowable_errors WHERE lab_id = ? AND analyte = ?").run(labId, analyte);
      if (before) audit(req, "qc_allowable_error", analyte, `Allowable error cleared: ${analyte}`, before, null);
      return res.json({ ok: true, allowable: null });
    }
    const given = [b.preset_label, b.percent, b.units_value].filter((v) => v !== undefined && v !== null && v !== "").length;
    if (given !== 1) return res.status(400).json({ error: "Give one of: a criterion, a percent, or an amount in the test's units.", code: "ONE_ALLOWABLE_ERROR" });
    let preset: string | null = null, percent: number | null = null, units: number | null = null, unit: string | null = null;
    if (b.preset_label) {
      preset = String(b.preset_label);
      if (!criteriaForAnalyte(analyte).some((c) => c.label === preset)) return res.status(400).json({ error: "That criterion isn't one for this test.", code: "NOT_THIS_TEST" });
    } else if (b.percent !== undefined && b.percent !== null && b.percent !== "") {
      percent = positive(b.percent);
      if (percent === null || percent > 1000) return res.status(400).json({ error: "The allowable error must be a percent above 0.", code: "BAD_VALUE" });
    } else {
      units = positive(b.units_value);
      unit = String(b.unit ?? "").trim().slice(0, 24) || null;
      if (units === null) return res.status(400).json({ error: "The allowable error must be a number above 0.", code: "BAD_VALUE" });
      if (!unit) return res.status(400).json({ error: "Give the units of the allowable error.", code: "UNIT_REQUIRED" });
    }
    const at = new Date().toISOString(), who = userName(req.userId);
    sqlite().prepare(
      `INSERT INTO qc_allowable_errors (lab_id, analyte, preset_label, percent, units_value, unit, set_by_user_id, set_by_name, set_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(lab_id, analyte) DO UPDATE SET preset_label = excluded.preset_label, percent = excluded.percent, units_value = excluded.units_value, unit = excluded.unit,
         set_by_user_id = excluded.set_by_user_id, set_by_name = excluded.set_by_name, set_at = excluded.set_at`
    ).run(labId, analyte, preset, percent, units, unit, req.userId, who, at);
    const after = allowableIn(labId, analyte);
    audit(req, "qc_allowable_error", analyte, `Allowable error set: ${analyte}`, before, after);
    res.json({ ok: true, allowable: after });
  });

  // { control_lot_id, peer_mean, note } ; peer_mean null clears it.
  app.put("/api/labs/:labId/qc/sigma/peer-mean", ...edit, (req: any, res) => {
    const labId = req.scope.labId, b = req.body || {};
    const lot = sqlite().prepare("SELECT id, analyte, level, lot_number FROM qc_control_lots WHERE id = ? AND lab_id = ?").get(Number(b.control_lot_id), labId) as any;
    if (!lot) return res.status(404).json({ error: "Control lot not found in this lab" });
    const read = () => sqlite().prepare("SELECT peer_mean, source_note, set_by_name, set_at FROM qc_peer_means WHERE lab_id = ? AND control_lot_id = ?").get(labId, lot.id) ?? null;
    const before = read();
    const name = `${lot.analyte} ${lot.level} lot ${lot.lot_number}`;
    if (b.peer_mean === null || b.peer_mean === undefined || b.peer_mean === "") {
      sqlite().prepare("DELETE FROM qc_peer_means WHERE lab_id = ? AND control_lot_id = ?").run(labId, lot.id);
      if (before) audit(req, "qc_peer_mean", lot.id, `Peer mean cleared: ${name}`, before, null);
      return res.json({ ok: true, peer_mean: null });
    }
    const mean = Number(b.peer_mean);
    if (!Number.isFinite(mean) || mean === 0) return res.status(400).json({ error: "The peer mean must be a number other than 0.", code: "BAD_VALUE" });
    const note = String(b.note ?? "").trim().slice(0, 200) || null;
    const at = new Date().toISOString(), who = userName(req.userId);
    sqlite().prepare(
      `INSERT INTO qc_peer_means (lab_id, control_lot_id, peer_mean, source_note, set_by_user_id, set_by_name, set_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(lab_id, control_lot_id) DO UPDATE SET peer_mean = excluded.peer_mean, source_note = excluded.source_note, set_by_user_id = excluded.set_by_user_id,
         set_by_name = excluded.set_by_name, set_at = excluded.set_at`
    ).run(labId, lot.id, mean, note, req.userId, who, at);
    const after = read();
    audit(req, "qc_peer_mean", lot.id, `Peer mean set: ${name}`, before, after);
    res.json({ ok: true, peer_mean: after });
  });
}
