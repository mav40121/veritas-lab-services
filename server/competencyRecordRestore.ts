// BUG-174 (Redington-Fairview, reported 2026-11-17; Michael's go Q346 = 1).
//
// A competency record (competency_assessments row) can hold two kinds of entry rows (competency_assessment_items):
//   - rows the whole-record form writes: keyed by method group, no instrument_id, no signoff_id;
//   - rows the person page writes (PUT .../competency/employee/:id/test-system/:instrumentId): keyed by instrument_id,
//     and rows frozen by a per-method sign-off (signoff_id).
// The person page saves into each person's open record in the lab's implicit "Competency" program, and that record can
// also be opened in the whole-record form. The form's save (PUT /api/labs/:labId/competency/assessments/:id and the older
// PUT /api/competency/assessments/:id) deleted every row on the record and wrote back only its own, so the person page's
// entries and a sign-off's frozen rows were lost (production: audit #19640, 75 rows, 45 holding entries, 2 signed).
//
// This module holds:
//   FORM_OWNED_ROWS            the rows the whole-record form owns; both PUTs replace only these.
//   personPageEntryCount       rows on a record that hold an entry made on the person page or frozen by a sign-off;
//                              both record DELETEs refuse while it is above 0 (409 HOLDS_PERSON_PAGE_ENTRIES).
//   planRecordSaveRestore      read one whole-record save's audit row and work out which of the rows it removed can be
//   applyRecordSaveRestore     put back exactly as they were; apply re-plans inside one transaction.
//   recordLosses               every whole-record save that removed such rows, and every deleted record that held them.
// Counts and ids only leave this module: no names, no entry text.
import { logAudit } from "./audit";

export const FORM_OWNED_ROWS = "instrument_id IS NULL AND signoff_id IS NULL";

// Columns that hold something someone entered. A mark (passed, an N/A) counts too.
const ENTRY_COLUMN = /^(el[1-8]_(specimen_id|observer_initials|evidence|date|qc_date|date_observed|sample_type|sample_id|acceptable|samples_json|quiz_id|score|date_taken|function_assessed)|waived_(evidence|date|initials|specimens_json)|evidence|date_met|specimen_info|nt_date_met|nt_employee_initials|nt_supervisor_initials)$/;
const NA_COLUMN = /^el[1-8]_na$/;

export function rowHoldsEntry(row: any): boolean {
  if (!row || typeof row !== "object") return false;
  if (Number(row.passed) === 1) return true;
  for (const [k, v] of Object.entries(row)) {
    if (NA_COLUMN.test(k) && Number(v) === 1) return true;
    if (!ENTRY_COLUMN.test(k) || v === null || v === undefined) continue;
    if (k === "el5_acceptable") return true; // 0 (not acceptable) is an entry
    const s = String(v).trim();
    if (s !== "" && s !== "[]") return true;
  }
  return false;
}

const isPersonPageRow = (r: any) => r && (r.instrument_id != null || r.signoff_id != null);

// Rows on this record that a whole-record delete would take from the person page: instrument-keyed rows holding an
// entry, and any row frozen by a sign-off.
export function personPageEntryCount(sqlite: any, assessmentId: number | string): number {
  const rows = sqlite.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ? AND (instrument_id IS NOT NULL OR signoff_id IS NOT NULL)").all(assessmentId) as any[];
  return rows.filter((r) => r.signoff_id != null || rowHoldsEntry(r)).length;
}

export function holdsPersonPageEntriesMessage(n: number): string {
  return `This record holds ${n} ${n === 1 ? "entry" : "entries"} made on the person's own competency page. Deleting it here would remove ${n === 1 ? "it" : "them"}, so it can't be deleted from this list. Open the person's page to change ${n === 1 ? "it" : "them"}.`;
}

const parse = (s: any) => { try { return typeof s === "string" ? JSON.parse(s) : s; } catch { return null; } };

export type RestoreGroup = { instrumentId: number | null; signoffId: number | null; rows: number; rowsHoldingEntries: number; action: "restore" | "skip"; reason: string | null };
export type RestorePlan = {
  auditId: number; savedAt: string; savedByUserId: number;
  assessmentId: number; labId: number | null; competencyEmployeeId: number | null; staffEmployeeId: number | null;
  lostRows: number; lostRowsHoldingEntries: number; lostSignedRows: number;
  groups: RestoreGroup[]; total: number;
};
type PlanResult = { ok: true; plan: RestorePlan; rows: any[] } | { ok: false; status: number; code: string; error: string };

export function planRecordSaveRestore(sqlite: any, auditId: number): PlanResult {
  const a = sqlite.prepare("SELECT * FROM audit_log WHERE id = ?").get(auditId) as any;
  if (!a) return { ok: false, status: 404, code: "AUDIT_NOT_FOUND", error: "No audit row with that id." };
  if (a.module !== "veritacomp" || a.entity_type !== "assessment" || a.action !== "update") {
    return { ok: false, status: 400, code: "NOT_A_RECORD_SAVE", error: "That audit row isn't a competency record save." };
  }
  const before = parse(a.before_json), after = parse(a.after_json);
  if (!Array.isArray(before?.items) || !Array.isArray(after?.items)) {
    return { ok: false, status: 400, code: "NO_ITEMS_IN_AUDIT", error: "That save's audit row holds no entry rows before and after." };
  }
  const assessmentId = Number(a.entity_id);
  const rec = sqlite.prepare(
    `SELECT a.id, a.employee_id, p.lab_id FROM competency_assessments a JOIN competency_programs p ON p.id = a.program_id WHERE a.id = ?`
  ).get(assessmentId) as any;
  if (!rec) return { ok: false, status: 409, code: "ASSESSMENT_GONE", error: "The record that save belonged to no longer exists." };
  const afterIds = new Set(after.items.map((r: any) => Number(r.id)));
  const lost = (before.items as any[]).filter((r) => isPersonPageRow(r) && !afterIds.has(Number(r.id)));
  const ce = sqlite.prepare("SELECT staff_employee_id FROM competency_employees WHERE id = ?").get(rec.employee_id) as any;
  const current = sqlite.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ?").all(assessmentId) as any[];
  const currentIds = new Set(current.map((r) => Number(r.id)));
  // The person's working rows on ANY of their records: a person-page save made after the loss is newer than the copy.
  const workingByInstrument = new Set(
    (sqlite.prepare(
      `SELECT DISTINCT i.instrument_id FROM competency_assessment_items i JOIN competency_assessments x ON x.id = i.assessment_id
        WHERE x.employee_id = ? AND i.instrument_id IS NOT NULL AND i.signoff_id IS NULL`
    ).all(rec.employee_id) as any[]).map((r) => Number(r.instrument_id))
  );
  const groups: RestoreGroup[] = [];
  const rows: any[] = [];
  const working = lost.filter((r) => r.signoff_id == null);
  for (const instrumentId of Array.from(new Set(working.map((r) => Number(r.instrument_id))))) {
    const g = working.filter((r) => Number(r.instrument_id) === instrumentId);
    let reason: string | null = null;
    if (g.some((r) => currentIds.has(Number(r.id)))) reason = "already_present";
    else if (workingByInstrument.has(instrumentId)) reason = "newer_entries_on_person_page";
    groups.push({ instrumentId, signoffId: null, rows: g.length, rowsHoldingEntries: g.filter(rowHoldsEntry).length, action: reason ? "skip" : "restore", reason });
    if (!reason) rows.push(...g);
  }
  const signed = lost.filter((r) => r.signoff_id != null);
  for (const signoffId of Array.from(new Set(signed.map((r) => Number(r.signoff_id))))) {
    const g = signed.filter((r) => Number(r.signoff_id) === signoffId);
    const so = sqlite.prepare("SELECT id, revoked_at FROM competency_method_signoffs WHERE id = ?").get(signoffId) as any;
    const frozenNow = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM competency_assessment_items WHERE signoff_id = ?").get(signoffId) as any).n);
    let reason: string | null = null;
    if (!so) reason = "signoff_missing";
    else if (so.revoked_at) reason = "signoff_revoked";
    else if (g.some((r) => currentIds.has(Number(r.id))) || frozenNow > 0) reason = "already_present";
    groups.push({ instrumentId: g[0]?.instrument_id != null ? Number(g[0].instrument_id) : null, signoffId, rows: g.length, rowsHoldingEntries: g.filter(rowHoldsEntry).length, action: reason ? "skip" : "restore", reason });
    if (!reason) rows.push(...g);
  }
  return {
    ok: true, rows,
    plan: {
      auditId, savedAt: a.created_at, savedByUserId: a.user_id,
      assessmentId, labId: rec.lab_id ?? null, competencyEmployeeId: rec.employee_id ?? null, staffEmployeeId: ce?.staff_employee_id ?? null,
      lostRows: lost.length, lostRowsHoldingEntries: lost.filter(rowHoldsEntry).length, lostSignedRows: signed.length,
      groups, total: rows.length,
    },
  };
}

type ApplyResult = { ok: true; plan: RestorePlan; restoredItemIds: number[] } | { ok: false; status: number; code: string; error: string; plan?: RestorePlan };

export function applyRecordSaveRestore(sqlite: any, auditId: number, expectedTotal: unknown): ApplyResult {
  let out: ApplyResult = { ok: false, status: 500, code: "NOT_RUN", error: "Not run." };
  const cols = new Set((sqlite.prepare("PRAGMA table_info(competency_assessment_items)").all() as any[]).map((c) => String(c.name)));
  sqlite.transaction(() => {
    const p = planRecordSaveRestore(sqlite, auditId);
    if (!p.ok) { out = p; return; }
    if (!Number.isInteger(expectedTotal) || expectedTotal !== p.plan.total) {
      out = { ok: false, status: 409, code: "COUNT_CHANGED", error: `The dry run's total is ${p.plan.total}; send it as expectedTotal.`, plan: p.plan };
      return;
    }
    const ids: number[] = [];
    for (const r of p.rows) {
      // The row as it was, with its own id when that id is free, so links to it (element documents) still point at it.
      const keys = Object.keys(r).filter((k) => cols.has(k) && k !== "assessment_id");
      const free = !sqlite.prepare("SELECT 1 FROM competency_assessment_items WHERE id = ?").get(r.id);
      const use = keys.filter((k) => k !== "id" || free);
      const info = sqlite.prepare(
        `INSERT INTO competency_assessment_items (assessment_id, ${use.join(", ")}) VALUES (?, ${use.map(() => "?").join(", ")})`
      ).run(p.plan.assessmentId, ...use.map((k) => r[k]));
      ids.push(Number(info.lastInsertRowid));
    }
    const owner = sqlite.prepare("SELECT p.user_id FROM competency_assessments a JOIN competency_programs p ON p.id = a.program_id WHERE a.id = ?").get(p.plan.assessmentId) as any;
    logAudit({
      userId: 0, ownerUserId: owner?.user_id ?? 0, module: "veritacomp", action: "restore", entityType: "assessment",
      entityId: p.plan.assessmentId, entityLabel: `rows restored from audit #${auditId} (BUG-174)`,
      after: { auditId, restoredItemIds: ids, groups: p.plan.groups },
    });
    out = { ok: true, plan: p.plan, restoredItemIds: ids };
  })();
  return out;
}

export type SaveLoss = { auditId: number; at: string; userId: number; labId: number | null; assessmentId: number; assessmentExists: boolean; lostRows: number; lostRowsHoldingEntries: number; lostSignedRows: number; restorableNow: number };
export type DeletedRecord = {
  auditId: number; at: string; userId: number; labId: number | null; assessmentId: number; programId: number | null; programIsImplicit: boolean | null; programType: string | null;
  competencyEmployeeId: number | null; staffEmployeeId: number | null; assessmentType: string | null; status: string | null;
  rows: number; personPageRows: number; personPageRowsHoldingEntries: number; signedRows: number; instrumentIdsWithEntries: number[];
};

export function recordLosses(sqlite: any, opts: { since?: string; labId?: number } = {}): { saves: SaveLoss[]; deletes: DeletedRecord[]; scanned: { saves: number; deletes: number } } {
  const since = opts.since ? String(opts.since).replace("T", " ").replace(/Z$/, "") : "0000";
  const rows = sqlite.prepare(
    `SELECT id, user_id, action, entity_id, before_json, after_json, created_at FROM audit_log
      WHERE module = 'veritacomp' AND entity_type = 'assessment' AND action IN ('update', 'delete') AND created_at >= ? ORDER BY id`
  ).all(since) as any[];
  const labOfProgram = sqlite.prepare("SELECT lab_id, is_implicit, type FROM competency_programs WHERE id = ?");
  const saves: SaveLoss[] = [], deletes: DeletedRecord[] = [];
  let nSaves = 0, nDeletes = 0;
  for (const r of rows) {
    const before = parse(r.before_json);
    const programId = before?.assessment?.program_id != null ? Number(before.assessment.program_id) : null;
    const prog = programId != null ? labOfProgram.get(programId) as any : null;
    const labId = prog?.lab_id != null ? Number(prog.lab_id) : null;
    if (opts.labId != null && labId !== opts.labId) continue;
    if (r.action === "update") {
      nSaves++;
      const after = parse(r.after_json);
      if (!Array.isArray(before?.items) || !Array.isArray(after?.items)) continue;
      const afterIds = new Set(after.items.map((x: any) => Number(x.id)));
      const lost = (before.items as any[]).filter((x) => isPersonPageRow(x) && !afterIds.has(Number(x.id)));
      if (!lost.length) continue;
      const exists = !!sqlite.prepare("SELECT 1 FROM competency_assessments WHERE id = ?").get(Number(r.entity_id));
      const p = exists ? planRecordSaveRestore(sqlite, Number(r.id)) : null;
      saves.push({
        auditId: Number(r.id), at: r.created_at, userId: Number(r.user_id), labId, assessmentId: Number(r.entity_id), assessmentExists: exists,
        lostRows: lost.length, lostRowsHoldingEntries: lost.filter(rowHoldsEntry).length, lostSignedRows: lost.filter((x) => x.signoff_id != null).length,
        restorableNow: p && p.ok ? p.plan.total : 0,
      });
    } else {
      nDeletes++;
      const items: any[] = Array.isArray(before?.items) ? before.items : [];
      const pp = items.filter(isPersonPageRow);
      const ceId = before?.assessment?.employee_id != null ? Number(before.assessment.employee_id) : null;
      const ce = ceId != null ? sqlite.prepare("SELECT staff_employee_id FROM competency_employees WHERE id = ?").get(ceId) as any : null;
      deletes.push({
        auditId: Number(r.id), at: r.created_at, userId: Number(r.user_id), labId, assessmentId: Number(r.entity_id), programId,
        programIsImplicit: prog ? Number(prog.is_implicit) === 1 : null, programType: prog?.type ?? null,
        competencyEmployeeId: ceId, staffEmployeeId: ce?.staff_employee_id ?? null,
        assessmentType: before?.assessment?.assessment_type ?? null, status: before?.assessment?.status ?? null,
        rows: items.length, personPageRows: pp.length, personPageRowsHoldingEntries: pp.filter((x) => x.signoff_id != null || rowHoldsEntry(x)).length,
        signedRows: pp.filter((x) => x.signoff_id != null).length,
        instrumentIdsWithEntries: Array.from(new Set(pp.filter(rowHoldsEntry).map((x) => Number(x.instrument_id)).filter(Number.isFinite))).sort((x, y) => x - y),
      });
    }
  }
  return { saves, deletes, scanned: { saves: nSaves, deletes: nDeletes } };
}
