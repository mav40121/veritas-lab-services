// server/ptEvaluations.ts
//
// Ungraded VeritaPT results (B11, 2026-11-24). A result the program didn't grade carries its reason and stays open until the
// laboratory records its own evaluation: what it compared against, its conclusion, who and when. The fields are the
// alternative assessment record's (aa_records: method, acceptance criteria, result, pass or fail, date), with the same list of
// methods, because both are the laboratory verifying its own accuracy. They aren't aa_records rows: those count an analyte as
// covered by alternative assessment, which one ungraded event doesn't make it.
//
// An evaluation is never edited or removed; a second one is added and the newest counts. It never changes the result's status:
// the flags, the pass rate and the digest read pass_fail alone. Recording needs VeritaPT edit; Veritas support can't
// (server/vlsSupport.ts).
import type { Express } from "express";
import { PT_AAA_METHODS, PT_UNGRADED_REASONS, type PtEvaluation, type PtResult } from "@shared/ptEvents";
import { isPtDay, ptAudit, ptToday, type PtDeps } from "./ptEvents";

const txt = (v: unknown, max = 4000): string => String(v ?? "").trim().slice(0, max);

/** The two reason columns for a status, or why they're wrong. Only an ungraded result carries a reason. */
export function ptUngradedColumns(body: any, existing: any | null, passFail: string): { error?: string; code?: string; cols: { ungraded_reason: string | null; ungraded_reason_text: string | null } } {
  if (passFail !== "ungraded") return { cols: { ungraded_reason: null, ungraded_reason_text: null } };
  const reason = body?.ungraded_reason !== undefined ? txt(body.ungraded_reason, 60) : txt(existing?.ungraded_reason, 60);
  const words = body?.ungraded_reason_text !== undefined ? txt(body.ungraded_reason_text, 500) : txt(existing?.ungraded_reason_text, 500);
  const cols = { ungraded_reason: reason || null, ungraded_reason_text: words || null };
  if (!PT_UNGRADED_REASONS.some((r) => r.value === reason)) return { error: "Say why the result was not graded.", code: "UNGRADED_REASON_REQUIRED", cols };
  if (reason === "other" && !words) return { error: "Say why the result was not graded, in words.", code: "UNGRADED_REASON_REQUIRED", cols };
  return { cols };
}

/** Evaluations of a lab's results, newest first, by result. */
export function ptEvaluations(sqlite: any, labId: number): Map<number, PtEvaluation[]> {
  const out = new Map<number, PtEvaluation[]>();
  for (const r of sqlite.prepare("SELECT * FROM pt_event_evaluations WHERE lab_id = ? ORDER BY id DESC").all(labId) as any[]) {
    const e: PtEvaluation = {
      id: r.id, method: r.method, method_notes: r.method_notes, acceptance_criteria: r.acceptance_criteria, result_summary: r.result_summary,
      conclusion: r.conclusion, performed_date: r.performed_date, recorded_by_name: r.recorded_by_name, recorded_at: r.recorded_at,
    };
    out.set(Number(r.event_id), [...(out.get(Number(r.event_id)) ?? []), e]);
  }
  return out;
}

/** An ungraded result with no evaluation on file is open. */
export const ptEvaluationOpen = (r: Pick<PtResult, "status" | "evaluations">): boolean => r.status === "ungraded" && r.evaluations.length === 0;

export function registerPtEvaluationRoutes(app: Express, deps: PtDeps) {
  const { sqlite, authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit, hasPTAccess } = deps;
  app.post("/api/labs/:labId/pt/results/:id/evaluations", authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritapt"), (req: any, res: any) => {
    if (!hasPTAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    const labId = req.scope.labId, b = req.body ?? {};
    const result = sqlite().prepare("SELECT * FROM pt_events WHERE id = ? AND lab_id = ?").get(Number(req.params.id), labId) as any;
    if (!result) return res.status(404).json({ error: "Result not found" });
    if (result.pass_fail !== "ungraded") return res.status(409).json({ error: "Only an ungraded result takes the laboratory's own evaluation.", code: "NOT_UNGRADED" });
    const row = {
      lab_id: labId, event_id: result.id, method: txt(b.method, 60), method_notes: txt(b.method_notes) || null, acceptance_criteria: txt(b.acceptance_criteria),
      result_summary: txt(b.result_summary) || null, conclusion: txt(b.conclusion, 10), performed_date: txt(b.performed_date, 10),
      recorded_by_user_id: req.userId, recorded_by_name: (sqlite().prepare("SELECT name FROM users WHERE id = ?").get(req.userId) as any)?.name ?? null, recorded_at: new Date().toISOString(),
    };
    if (!PT_AAA_METHODS.some((m) => m.value === row.method)) return res.status(400).json({ error: "Pick what the result was compared against." });
    if (row.method === "other" && !row.method_notes) return res.status(400).json({ error: "Describe what the result was compared against." });
    if (!row.acceptance_criteria) return res.status(400).json({ error: "Enter the criteria the result was compared to." });
    if (row.conclusion !== "pass" && row.conclusion !== "fail") return res.status(400).json({ error: "Record the laboratory's conclusion: acceptable or unacceptable." });
    if (!isPtDay(row.performed_date) || row.performed_date > ptToday(sqlite(), labId)) return res.status(400).json({ error: "Enter the date the evaluation was done." });
    const keys = Object.keys(row);
    const id = Number(sqlite().prepare(`INSERT INTO pt_event_evaluations (${keys.join(", ")}) VALUES (${keys.map((k) => `@${k}`).join(", ")})`).run(row).lastInsertRowid);
    ptAudit(req, "create", "pt_evaluation", id, `${result.analyte}, ${String(result.event_date).slice(0, 10)}: laboratory's own evaluation`, { result_id: result.id, pass_fail: result.pass_fail, ungraded_reason: result.ungraded_reason }, row);
    res.status(201).json({ id, ...row });
  });
}
