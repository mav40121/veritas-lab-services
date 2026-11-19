// Quizzes whose questions share an id (Redington 2026-11-19; shared/quizQuestionIds.ts has why). Every answer finds its question
// by id, so on such a quiz the later question was graded against the earlier one's key and the Take a Quiz screen kept one
// answer for both. Quiz writes now re-id a repeat before storing; this finds the quizzes stored before that and gives each
// repeat a new id, the same rule (the first question with an id keeps it). Attempts already on file are never changed: their
// answers and scores stay as recorded, so a mis-scored attempt is handled on its own (Void, shared/quizAttemptVoid.ts).
// GET /api/admin/veritacomp/quiz-question-id-audit and POST /api/admin/veritacomp/quiz-question-ids/repair (x-admin-secret
// only) in routes.ts call these. Ids and counts only, no names.
import { logAudit } from "./audit";
import { repeatedQuestionIds, withUniqueQuestionIds, type QuestionIdChange } from "@shared/quizQuestionIds";

export interface QuizIdProblem {
  quizId: number;
  labId: number | null;
  systemDefault: boolean;
  questions: number;
  repeatedIds: string[];
  /** 1-based positions of the questions that would get a new id, with the id each would get. */
  changes: Array<{ position: number; from: string; to: string }>;
  attempts: Array<{ resultId: number; createdAt: string | null; score: number | null; passed: boolean; voided: boolean }>;
}

function parse(raw: unknown): any[] {
  try {
    const list = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const asChanges = (changes: QuestionIdChange[]) => changes.map((c) => ({ position: c.index + 1, from: c.from, to: c.to }));

export function quizQuestionIdAudit(sqlite: any): { quizzesChecked: number; quizzesAffected: number; labsAffected: number[]; questionsToRename: number; attemptsOnAffected: number; quizzes: QuizIdProblem[] } {
  const rows = sqlite.prepare("SELECT id, lab_id, user_id, questions FROM competency_quizzes ORDER BY id").all() as any[];
  const quizzes: QuizIdProblem[] = [];
  for (const r of rows) {
    const qs = parse(r.questions);
    const { changes } = withUniqueQuestionIds(qs);
    if (changes.length === 0) continue;
    const attempts = (sqlite.prepare(
      "SELECT id, created_at, score, passed, voided_at FROM competency_quiz_results WHERE quiz_id = ? ORDER BY created_at, id",
    ).all(r.id) as any[]).map((a) => ({
      resultId: Number(a.id), createdAt: a.created_at ?? null, score: a.score != null ? Number(a.score) : null,
      passed: Number(a.passed) === 1, voided: !!a.voided_at,
    }));
    quizzes.push({
      quizId: Number(r.id), labId: r.lab_id != null ? Number(r.lab_id) : null, systemDefault: Number(r.user_id) === 0,
      questions: qs.length, repeatedIds: repeatedQuestionIds(qs), changes: asChanges(changes), attempts,
    });
  }
  const labs = [...new Set(quizzes.map((q) => q.labId).filter((x): x is number => x != null))].sort((a, b) => a - b);
  return {
    quizzesChecked: rows.length,
    quizzesAffected: quizzes.length,
    labsAffected: labs,
    questionsToRename: quizzes.reduce((n, q) => n + q.changes.length, 0),
    attemptsOnAffected: quizzes.reduce((n, q) => n + q.attempts.length, 0),
    quizzes,
  };
}

export type RepairResult =
  | { ok: true; dryRun: boolean; total: number; quizzes: Array<{ quizId: number; labId: number | null; changes: Array<{ position: number; from: string; to: string }> }> }
  | { ok: false; status: number; code: "COUNT_CHANGED" | "EXPECTED_TOTAL_REQUIRED"; message: string; total: number };

/** A dry run unless `dryRun` is false; then `expectedTotal` must be the dry run's total (questions to rename) or nothing is written. */
export function repairQuizQuestionIds(sqlite: any, opts: { quizIds?: number[]; dryRun?: boolean; expectedTotal?: number }): RepairResult {
  const want = Array.isArray(opts.quizIds) && opts.quizIds.length ? new Set(opts.quizIds.map(Number)) : null;
  const rows = (sqlite.prepare("SELECT id, lab_id, user_id, questions FROM competency_quizzes ORDER BY id").all() as any[])
    .filter((r) => !want || want.has(Number(r.id)));
  const plan = rows
    .map((r) => {
      const qs = parse(r.questions);
      const fixed = withUniqueQuestionIds(qs);
      return { row: r, qs, fixed };
    })
    .filter((p) => p.fixed.changes.length > 0);
  const total = plan.reduce((n, p) => n + p.fixed.changes.length, 0);
  const summary = plan.map((p) => ({ quizId: Number(p.row.id), labId: p.row.lab_id != null ? Number(p.row.lab_id) : null, changes: asChanges(p.fixed.changes) }));
  if (opts.dryRun !== false) return { ok: true, dryRun: true, total, quizzes: summary };
  if (!Number.isInteger(opts.expectedTotal)) {
    return { ok: false, status: 400, code: "EXPECTED_TOTAL_REQUIRED", message: "Send expectedTotal, the dry run's total, to apply.", total };
  }
  if (opts.expectedTotal !== total) {
    return { ok: false, status: 409, code: "COUNT_CHANGED", message: `The dry run's total was ${opts.expectedTotal}; it is ${total} now. Nothing was changed.`, total };
  }
  const update = sqlite.prepare("UPDATE competency_quizzes SET questions = ? WHERE id = ? AND questions = ?");
  const tx = sqlite.transaction(() => {
    for (const p of plan) {
      const res = update.run(JSON.stringify(p.fixed.questions), p.row.id, p.row.questions);
      if (res.changes !== 1) throw Object.assign(new Error("quiz changed during repair"), { code: "COUNT_CHANGED" });
    }
  });
  try {
    tx();
  } catch (e: any) {
    if (e?.code === "COUNT_CHANGED") return { ok: false, status: 409, code: "COUNT_CHANGED", message: "A quiz changed while it was being repaired. Nothing was changed.", total };
    throw e;
  }
  for (const p of plan) {
    logAudit({
      userId: 0, ownerUserId: Number(p.row.user_id ?? 0), module: "veritacomp", action: "update", entityType: "quiz_question_ids",
      entityId: String(p.row.id), entityLabel: `Quiz ${p.row.id}: ${p.fixed.changes.length} repeated question id${p.fixed.changes.length === 1 ? "" : "s"} given a new id`,
      before: { ids: p.qs.map((q: any) => q?.id ?? null) },
      after: { ids: p.fixed.questions.map((q: any) => q?.id ?? null), changes: asChanges(p.fixed.changes) },
    });
  }
  return { ok: true, dryRun: false, total, quizzes: summary };
}
