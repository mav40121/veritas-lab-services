// server/competencyProgramRestore.ts
//
// REQ-157 (Redington-Fairview, 2026-11-18). A VeritaComp quiz lives under a program: the Quiz tab lists quizzes program
// by program (GET /api/veritacomp/programs/:id/quizzes), so a quiz whose program is gone can't be seen there, though
// staff can still open it from an assignment. Program delete (deleteProgramIfEmpty in routes.ts) removed the program
// and its method groups and left its quizzes pointing at an id that no longer exists: Redington's "2026 Body Fluid"
// quiz (18 questions, 20 assignments, 2 attempts) dropped out of sight when its program was deleted, and the lab read
// it as the quiz being deleted.
//
// This module holds:
//   programQuizCount              quizzes sitting on a program; program delete refuses while it is above 0
//                                 (409 PROGRAM_HOLDS_QUIZZES), the way Michael's Q184 refuses a program holding records.
//   orphanQuizzes                 quizzes whose program no longer exists, by lab: ids and counts only.
//   planDeletedProgramRestore     read a deleted program from one backup copy (the program, its method groups,
//   applyDeletedProgramRestore    checklist items and their pictures, Not applicable rows) and put it back with its
//                                 original ids, so its quizzes and their method-group labels point at it again.
// The backup copy is opened inside the server (backup.ts withBackupCopy); nothing here sends a row anywhere. Counts,
// ids, the program's name and its method groups' instrument names leave this module, never a person's name.
import type Database from "better-sqlite3";
import { logAudit } from "./audit";

export function programQuizCount(sqlite: any, programId: number | string): number {
  return Number((sqlite.prepare("SELECT COUNT(*) AS n FROM competency_quizzes WHERE program_id = ?").get(programId) as any)?.n ?? 0);
}

export interface OrphanQuizLab { labId: number | null; quizIds: number[]; quizzes: number; assignments: number; results: number }

// Quizzes whose program_id names a program that no longer exists. A quiz with no program at all (program_id NULL,
// the built-in library) isn't one.
export function orphanQuizzes(sqlite: any): { total: number; labs: OrphanQuizLab[] } {
  const rows = sqlite.prepare(
    `SELECT q.id, q.lab_id,
            (SELECT COUNT(*) FROM competency_quiz_assignments a WHERE a.quiz_id = q.id) AS assignments,
            (SELECT COUNT(*) FROM competency_quiz_results r WHERE r.quiz_id = q.id) AS results
       FROM competency_quizzes q
      WHERE q.program_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM competency_programs p WHERE p.id = q.program_id)
      ORDER BY q.lab_id, q.id`,
  ).all() as Array<{ id: number; lab_id: number | null; assignments: number; results: number }>;
  const byLab = new Map<string, OrphanQuizLab>();
  for (const r of rows) {
    const k = String(r.lab_id ?? "none");
    const e = byLab.get(k) ?? { labId: r.lab_id ?? null, quizIds: [], quizzes: 0, assignments: 0, results: 0 };
    e.quizIds.push(r.id); e.quizzes++; e.assignments += Number(r.assignments); e.results += Number(r.results);
    byLab.set(k, e);
  }
  return { total: rows.length, labs: [...byLab.values()] };
}

const columnsOf = (db: any, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

export interface DeletedProgramPlan {
  ok: boolean;
  problems: Array<{ code: string; detail: string }>;
  program: { id: number; labId: number | null; name: string; department: string | null; type: string | null; recordKind: string | null; createdAt: string | null } | null;
  methodGroups: Array<{ id: number; name: string; instruments: string[] }>;
  rows: { programs: number; methodGroups: number; checklistItems: number; checklistImages: number; notApplicable: number };
  skippedNotApplicable: number;
  quizzesWaiting: Array<{ id: number; title: string | null; questions: number; assignments: number; results: number }>;
  total: number;
}

interface Gathered {
  program: any;
  groups: any[];
  items: any[];
  images: any[];
  na: any[];
  skippedNa: number;
  problems: Array<{ code: string; detail: string }>;
}

function gather(live: any, backup: Database.Database, labId: number, programId: number): Gathered {
  const problems: Array<{ code: string; detail: string }> = [];
  const program = backup.prepare("SELECT * FROM competency_programs WHERE id = ?").get(programId) as any;
  if (!program) return { program: null, groups: [], items: [], images: [], na: [], skippedNa: 0, problems: [{ code: "NOT_IN_COPY", detail: `program ${programId} is not in this copy` }] };
  if (Number(program.lab_id) !== labId) problems.push({ code: "LAB_MISMATCH", detail: `program ${programId} belonged to lab ${program.lab_id}, not lab ${labId}` });
  if (!live.prepare("SELECT 1 FROM labs WHERE id = ?").get(labId)) problems.push({ code: "LAB_NOT_FOUND", detail: `lab ${labId} is not on file` });
  if (live.prepare("SELECT 1 FROM competency_programs WHERE id = ?").get(programId)) problems.push({ code: "PROGRAM_EXISTS", detail: `program ${programId} is on file now` });
  const groups = backup.prepare("SELECT * FROM competency_method_groups WHERE program_id = ? ORDER BY id").all(programId) as any[];
  const items = backup.prepare("SELECT * FROM competency_checklist_items WHERE program_id = ? ORDER BY id").all(programId) as any[];
  let na: any[] = [];
  try { na = backup.prepare("SELECT * FROM competency_program_not_applicable WHERE program_id = ? ORDER BY id").all(programId) as any[]; } catch { na = []; }
  const taken = (table: string, ids: number[]) => ids.filter((id) => live.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id));
  const groupTaken = taken("competency_method_groups", groups.map((g) => g.id));
  if (groupTaken.length) problems.push({ code: "ID_TAKEN", detail: `method group ids in use now: ${groupTaken.join(", ")}` });
  const itemTaken = taken("competency_checklist_items", items.map((i) => i.id));
  if (itemTaken.length) problems.push({ code: "ID_TAKEN", detail: `checklist item ids in use now: ${itemTaken.join(", ")}` });
  // A checklist item's picture is shared by lab and SHA-256; bring back only a picture that is gone now.
  const images: any[] = [];
  for (const id of [...new Set(items.map((i) => i.image_id).filter((v) => v != null))]) {
    if (live.prepare("SELECT 1 FROM competency_checklist_images WHERE id = ?").get(id)) continue;
    const img = backup.prepare("SELECT * FROM competency_checklist_images WHERE id = ?").get(id) as any;
    if (img) images.push(img);
    else problems.push({ code: "IMAGE_MISSING", detail: `checklist picture ${id} is in neither the copy nor the live database` });
  }
  // A Not applicable row names a person; keep only those still on file in this lab.
  const naKept = na.filter((r) => live.prepare("SELECT 1 FROM competency_employees WHERE id = ? AND lab_id = ?").get(r.employee_id, labId));
  const naIdTaken = naKept.filter((r) => r.id != null && live.prepare("SELECT 1 FROM competency_program_not_applicable WHERE id = ?").get(r.id)).map((r) => r.id);
  if (naIdTaken.length) problems.push({ code: "ID_TAKEN", detail: `Not applicable row ids in use now: ${naIdTaken.join(", ")}` });
  return { program, groups, items, images, na: naKept, skippedNa: na.length - naKept.length, problems };
}

export function planDeletedProgramRestore(live: any, backup: Database.Database, labId: number, programId: number): DeletedProgramPlan {
  const g = gather(live, backup, labId, programId);
  const parse = (s: unknown): string[] => { try { const v = JSON.parse(String(s ?? "[]")); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
  const quizzesWaiting = (live.prepare(
    `SELECT q.id, q.title, q.questions,
            (SELECT COUNT(*) FROM competency_quiz_assignments a WHERE a.quiz_id = q.id) AS assignments,
            (SELECT COUNT(*) FROM competency_quiz_results r WHERE r.quiz_id = q.id) AS results
       FROM competency_quizzes q WHERE q.program_id = ? ORDER BY q.id`,
  ).all(programId) as any[]).map((q) => ({ id: q.id, title: q.title ?? null, questions: parse(q.questions).length, assignments: Number(q.assignments), results: Number(q.results) }));
  const rows = { programs: g.program ? 1 : 0, methodGroups: g.groups.length, checklistItems: g.items.length, checklistImages: g.images.length, notApplicable: g.na.length };
  return {
    ok: !!g.program && g.problems.length === 0,
    problems: g.problems,
    program: g.program ? { id: g.program.id, labId: g.program.lab_id ?? null, name: g.program.name, department: g.program.department ?? null, type: g.program.type ?? null, recordKind: g.program.record_kind ?? null, createdAt: g.program.created_at ?? null } : null,
    methodGroups: g.groups.map((m) => ({ id: m.id, name: m.name, instruments: parse(m.instruments) })),
    rows,
    skippedNotApplicable: g.skippedNa,
    quizzesWaiting,
    total: rows.programs + rows.methodGroups + rows.checklistItems + rows.checklistImages + rows.notApplicable,
  };
}

// Insert a backup row into the live table with the columns both have, its id included.
function insertRow(live: any, backup: Database.Database, table: string, row: any) {
  const liveCols = new Set(columnsOf(live, table));
  const cols = columnsOf(backup, table).filter((c) => liveCols.has(c) && row[c] !== undefined);
  live.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => row[c]));
}

export class RestoreRefused extends Error {
  constructor(public status: number, public code: string, public plan: DeletedProgramPlan) { super(code); }
}

// Re-plans inside one transaction, refuses unless the plan is clean and its total is the one the caller saw, then puts
// the rows back with their ids and writes one audit row (user 0, the system actor) holding the counts.
export function applyDeletedProgramRestore(live: any, backup: Database.Database, labId: number, programId: number, expectedTotal: number, backupKey: string): DeletedProgramPlan {
  return live.transaction(() => {
    const plan = planDeletedProgramRestore(live, backup, labId, programId);
    if (!plan.ok) throw new RestoreRefused(409, plan.problems[0]?.code || "NOT_RESTORABLE", plan);
    if (plan.total !== expectedTotal) throw new RestoreRefused(409, "COUNT_CHANGED", plan);
    const g = gather(live, backup, labId, programId);
    for (const img of g.images) insertRow(live, backup, "competency_checklist_images", img);
    insertRow(live, backup, "competency_programs", g.program);
    for (const m of g.groups) insertRow(live, backup, "competency_method_groups", m);
    for (const i of g.items) insertRow(live, backup, "competency_checklist_items", i);
    for (const n of g.na) insertRow(live, backup, "competency_program_not_applicable", n);
    logAudit({
      userId: 0, ownerUserId: Number(g.program.user_id) || 0, module: "veritacomp", action: "restore", entityType: "program",
      entityId: String(programId), entityLabel: String(g.program.name || ""),
      before: null, after: { restoredFrom: backupKey, rows: plan.rows, skippedNotApplicable: plan.skippedNotApplicable, quizzesWaiting: plan.quizzesWaiting.map((q) => q.id) },
    });
    return plan;
  })();
}
