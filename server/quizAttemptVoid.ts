// Void a scored quiz attempt (Redington 2026-11-18, Michael Q2 = 1; shared/quizAttemptVoid.ts has the rule and the words).
// Only an attempt taken on an assigned quiz (a competency_quiz_results row an assignment completed with) can be voided: a quiz
// an evaluator gave on a competency record feeds that record's Element 6, so it is corrected on the record, not here. The row
// is never deleted and a void is never undone; voided_at, voided_by_user_id and void_reason are set once.
// POST /api/veritacomp/quiz-results/:id/void (the quiz card Results' reach) and POST /api/admin/veritacomp/quiz-results/void
// (x-admin-secret, user 0) in routes.ts both go through here.

export type VoidRefusalCode = "NOT_FOUND" | "NOT_ASSIGNED_ATTEMPT" | "ALREADY_VOIDED";

export interface VoidTarget {
  resultId: number;
  quizId: number;
  quizTitle: string;
  labId: number | null;
  assignmentId: number;
  attemptNo: number;
  staffEmployeeId: number | null;
  score: number | null;
  passed: boolean;
  dateTaken: string | null;
}

export type VoidCheck =
  | { ok: true; target: VoidTarget }
  | { ok: false; status: number; code: VoidRefusalCode; message: string; target?: VoidTarget };

export function voidTarget(sqlite: any, resultId: number): VoidCheck {
  const r = sqlite.prepare(
    `SELECT qr.id, qr.quiz_id, qr.score, qr.passed, qr.date_taken, qr.voided_at, qr.assessment_id,
            q.title, q.method_group_name, q.lab_id AS quiz_lab_id,
            qa.id AS assignment_id, qa.attempt_no, qa.lab_id AS assignment_lab_id, qa.staff_employee_id
       FROM competency_quiz_results qr
       JOIN competency_quizzes q ON q.id = qr.quiz_id
       LEFT JOIN competency_quiz_assignments qa ON qa.completed_result_id = qr.id
      WHERE qr.id = ?`,
  ).get(resultId) as any;
  if (!r) return { ok: false, status: 404, code: "NOT_FOUND", message: "Attempt not found" };
  if (r.assignment_id == null) {
    return { ok: false, status: 409, code: "NOT_ASSIGNED_ATTEMPT", message: "Only an attempt taken on an assigned quiz can be voided here. A quiz given on a competency record is corrected on that record." };
  }
  const target: VoidTarget = {
    resultId: Number(r.id), quizId: Number(r.quiz_id), quizTitle: String(r.title || r.method_group_name || `Quiz ${r.quiz_id}`),
    labId: r.assignment_lab_id != null ? Number(r.assignment_lab_id) : r.quiz_lab_id != null ? Number(r.quiz_lab_id) : null,
    assignmentId: Number(r.assignment_id), attemptNo: Number(r.attempt_no ?? 1),
    staffEmployeeId: r.staff_employee_id != null ? Number(r.staff_employee_id) : null,
    score: r.score != null ? Number(r.score) : null, passed: Number(r.passed) === 1, dateTaken: r.date_taken ?? null,
  };
  if (r.voided_at) return { ok: false, status: 409, code: "ALREADY_VOIDED", message: `Attempt ${target.attemptNo} was already voided.`, target };
  return { ok: true, target };
}

/** Sets the void once. Returns false when another request voided it first. */
export function applyVoid(sqlite: any, resultId: number, reason: string, userId: number): { ok: boolean; voidedAt: string } {
  const voidedAt = new Date().toISOString();
  const res = sqlite.prepare(
    "UPDATE competency_quiz_results SET voided_at = ?, voided_by_user_id = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL",
  ).run(voidedAt, userId, reason.trim(), resultId);
  return { ok: res.changes === 1, voidedAt };
}
