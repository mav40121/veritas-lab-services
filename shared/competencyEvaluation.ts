// shared/competencyEvaluation.ts
//
// New-hire evaluations in VeritaComp (2026-10-16, Michael Q = 1 for Natalie Lamb, Sampson Regional: "We have to do a
// 30 day, 60 day and 90 day eval on each employee when they are hired. I have 8 different job titles."). An evaluation
// is a non-technical program (type "nontechnical", with its own checklist) whose record_kind is "evaluation". One
// program per job title. It is titled Evaluation, never Competency, on screen and in the PDF, offers only the 30, 60
// and 90-day types, dates each one from the employee's hire date, and never counts toward competency compliance.

export type RecordKind = "competency" | "evaluation";

export const EVALUATION_TYPES = ["30day", "60day", "90day"] as const;
export type EvaluationType = (typeof EVALUATION_TYPES)[number];

const EVALUATION_DAYS: Record<EvaluationType, number> = { "30day": 30, "60day": 60, "90day": 90 };

// Every assessment type VeritaComp records, with the label people see.
export const ASSESSMENT_TYPE_LABELS: Record<string, string> = {
  initial: "Initial",
  "6month": "6-Month",
  annual: "Annual",
  reassessment: "Reassessment",
  orientation: "Orientation",
  duty_change: "Duty Change",
  "30day": "30-Day",
  "60day": "60-Day",
  "90day": "90-Day",
};

export function assessmentTypeLabel(type: string | null | undefined): string {
  const t = String(type || "initial");
  return ASSESSMENT_TYPE_LABELS[t] || t.replace(/_/g, " ");
}

export function isEvaluationType(type: unknown): type is EvaluationType {
  return typeof type === "string" && (EVALUATION_TYPES as readonly string[]).includes(type);
}

export function normalizeRecordKind(kind: unknown): RecordKind {
  return kind === "evaluation" ? "evaluation" : "competency";
}

// A program row (or an assessment joined to its program) is an evaluation when it is non-technical and marked so.
export function isEvaluationProgram(p: { type?: string | null; record_kind?: string | null } | null | undefined): boolean {
  return !!p && p.type === "nontechnical" && p.record_kind === "evaluation";
}

// Due date of a 30, 60 or 90-day evaluation: the hire date plus that many calendar days, as YYYY-MM-DD. Date-only
// arithmetic in UTC so a lab's time zone never shifts the day. Null when the hire date is missing or unreadable.
export function evaluationDueDate(hireDate: string | null | undefined, type: string): string | null {
  if (!isEvaluationType(type)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(hireDate || "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== Number(m[2]) - 1) return null;
  d.setUTCDate(d.getUTCDate() + EVALUATION_DAYS[type]);
  return d.toISOString().slice(0, 10);
}

// The check run on every new assessment: an evaluation program takes only the 30, 60 and 90-day types, and no other
// program takes them. Returns the error message, or null when the type fits the program.
export function assessmentTypeProblem(program: { type?: string | null; record_kind?: string | null }, type: string): string | null {
  if (isEvaluationProgram(program)) {
    return isEvaluationType(type) ? null : "A new-hire evaluation is a 30-day, 60-day or 90-day evaluation.";
  }
  return isEvaluationType(type) ? "30, 60 and 90-day evaluations belong to a new-hire evaluation program." : null;
}
