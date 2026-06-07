// server/competencyCohortSignoff.ts
// VeritaComp cohort sign-off helpers.
//
// Wave I PR I1 (2026-06-06). One-program × N-employees cohort attestation.
// The lab director just finished an in-person session with a group of
// techs; this endpoint inserts one locked competency_assessments row per
// employee in a single sqlite transaction.
//
// Shared across all employees in the cohort: program, assessment_type,
// assessment_date, status, evaluator_name. That sameness is what makes
// it a cohort. If any field varies per tech, the director uses the
// individual "New Assessment" flow per tech instead.
//
// Lock-on-save (mirrors I4): every committed row lands with
// locked = 1 and completion_date = assessment_date. To later add per-tech
// element notes, the director unlocks → edits → re-locks the individual
// assessment.
//
// Cross-program (one employee × N programs) is NOT in v1. That's an
// orientation-cohort workflow and gets its own dialog if labs ask.

export const ALLOWED_TYPES = ["initial", "6month", "annual", "reassessment", "orientation", "duty_change"] as const;
export const ALLOWED_STATUSES = ["pass", "fail", "remediation"] as const;

export type AllowedType = (typeof ALLOWED_TYPES)[number];
export type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

export interface CohortInput {
  programId: number;
  employeeIds: number[];
  assessmentType: string;
  assessmentDate: string; // YYYY-MM-DD
  status: string;
  evaluatorName: string;
}

export interface CohortIssue {
  field?: string;
  severity: "error" | "warning";
  message: string;
}

export interface PerEmployeeRow {
  employeeId: number;
  employeeName: string;
  status: "ok" | "warning" | "error";
  issues: CohortIssue[];
  // True when a (program × employee × completion_date) match already
  // exists. Treated as a WARNING, not an error — the director may
  // legitimately re-sign on the same day (rare, but the lock check
  // protects them: see commit handler, which skips locked dups).
  duplicateOf: number | null; // existing assessment id, or null
}

export interface CohortPreview {
  rows: PerEmployeeRow[];
  shared: {
    programOk: boolean;
    programName: string | null;
    typeOk: boolean;
    statusOk: boolean;
    dateOk: boolean;
    evaluatorOk: boolean;
  };
  sharedIssues: CohortIssue[];
  summary: { total: number; ok: number; warning: number; error: number };
  fatal?: string;
}

export interface CohortContext {
  competencyEmployees: Array<{ id: number; name: string }>;
  programs: Array<{ id: number; name: string }>;
  existingAssessments: Array<{
    id: number;
    program_id: number;
    employee_id: number;
    completion_date: string | null;
    locked: number;
  }>;
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function validateCohort(input: CohortInput, ctx: CohortContext): CohortPreview {
  const sharedIssues: CohortIssue[] = [];

  const program = ctx.programs.find((p) => p.id === input.programId);
  const programOk = !!program;
  if (!programOk) sharedIssues.push({ field: "programId", severity: "error", message: `Program ${input.programId} not found in this lab.` });

  const typeOk = (ALLOWED_TYPES as readonly string[]).includes(input.assessmentType);
  if (!typeOk) sharedIssues.push({ field: "assessmentType", severity: "error", message: `Assessment type "${input.assessmentType}" not in: ${ALLOWED_TYPES.join(", ")}` });

  const statusOk = (ALLOWED_STATUSES as readonly string[]).includes(input.status);
  if (!statusOk) sharedIssues.push({ field: "status", severity: "error", message: `Status "${input.status}" not in: ${ALLOWED_STATUSES.join(", ")}` });

  const dateOk = isYmd(input.assessmentDate);
  if (!dateOk) sharedIssues.push({ field: "assessmentDate", severity: "error", message: `Assessment date "${input.assessmentDate}" must be YYYY-MM-DD.` });

  const evaluatorOk = typeof input.evaluatorName === "string" && input.evaluatorName.trim().length > 0;
  if (!evaluatorOk) sharedIssues.push({ field: "evaluatorName", severity: "error", message: "Evaluator name required." });

  // Build per-row results. Validate employee existence; check dups.
  const rows: PerEmployeeRow[] = [];
  const empById = new Map(ctx.competencyEmployees.map((e) => [e.id, e]));
  for (const empId of input.employeeIds) {
    const row: PerEmployeeRow = {
      employeeId: empId,
      employeeName: empById.get(empId)?.name ?? `Employee #${empId}`,
      status: "ok",
      issues: [],
      duplicateOf: null,
    };
    if (!empById.has(empId)) {
      row.status = "error";
      row.issues.push({ field: "employeeId", severity: "error", message: `Competency employee #${empId} not found in this lab.` });
      rows.push(row);
      continue;
    }
    // Same-day dup check: same program × same employee × same completion_date.
    if (programOk && dateOk) {
      const dup = ctx.existingAssessments.find(
        (a) => a.program_id === input.programId && a.employee_id === empId && a.completion_date === input.assessmentDate
      );
      if (dup) {
        row.duplicateOf = dup.id;
        if (dup.locked === 1) {
          // Locked dup → block the row. Director must unlock the existing one to override.
          row.status = "error";
          row.issues.push({ field: "duplicate", severity: "error", message: `Locked assessment #${dup.id} already exists for this employee + program + date.` });
        } else {
          row.status = "warning";
          row.issues.push({ field: "duplicate", severity: "warning", message: `Open assessment #${dup.id} already exists for this employee + program + date. Skipped on commit.` });
        }
      }
    }
    rows.push(row);
  }

  // If a shared-field error exists, every row is non-committable. Push it
  // onto each row so the UI surfaces the reason inline, but don't
  // duplicate the count: the shared error appears once in sharedIssues
  // and is the fatal blocker.
  if (sharedIssues.some((i) => i.severity === "error")) {
    for (const r of rows) {
      if (r.status !== "error") r.status = "error";
    }
  }

  const summary = {
    total: rows.length,
    ok: rows.filter((r) => r.status === "ok").length,
    warning: rows.filter((r) => r.status === "warning").length,
    error: rows.filter((r) => r.status === "error").length,
  };

  return {
    rows,
    shared: {
      programOk,
      programName: program?.name ?? null,
      typeOk,
      statusOk,
      dateOk,
      evaluatorOk,
    },
    sharedIssues,
    summary,
  };
}
