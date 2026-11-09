// server/veritascanMarkCorrection.ts
//
// One-time correction of automatic VeritaScan marks the records don't support (Michael Q189 = 1, 2026-11-06). PR 1821 stopped new
// wrong marks and left the old ones standing. This moves them back to Not Assessed with a note saying why, through
// POST /api/admin/veritascan/correct-auto-marks, which is a dry run unless told otherwise. The dry run is counts per lab with no names.
//
// What moves:
//   VeritaComp: Compliant, completion_source still veritacomp_auto, on an item COMPETENCY_SCAN_ITEMS no longer marks. Item 60 stays.
//   VeritaCheck: Compliant, completion_source still veritacheck_auto, linked to a study that is a draft or failed, unless a passing
//   study in the same scope marks the same item. The link holds only the study that touched the row last, so a draft saved after a
//   pass can sit on a mark that a real study does support.
//   VeritaCheck from a passing study (BUG-135): see below.
//
// "Nothing has changed since" is read from the row's content, never its updated_at. The scan screen's auto-save sends every item in
// the scan on each edit, so one edit rewrites updated_at on every row, including marks nobody looked at. A timestamp test would
// leave the wrong marks in place in every scan a lab has worked in. A row counts as changed when it has words of the lab's in its
// notes, an owner, a due date, a teaching note, or evidence linked to the item in its lab. Someone who looked at a mark and left it
// Compliant leaves no trace, so scan_saved_after_mark says how many marks to move sit in a scan saved after the mark.
//
// Each changed row gets an audit row holding its values from before, so a correction can be read back or undone by hand.
//
// BUG-135 (Michael 2026-11-09, Q246 = 1) adds a third category, veritacheck_passing: Compliant, completion_source still
// veritacheck_auto, linked to a study that passed, on an item the new rule wouldn't mark. That is every item other than 21 and 29,
// and 21 or 29 when the scan has no lab or its lab's VeritaCheck Coverage isn't complete. Same "nothing has changed since" test.
// A moved row reads Not Assessed and admin_correction like the others, but keeps its study link, because a passing study is real
// evidence for the item; the scan screen shows it as VeritaCheck evidence. The first two categories are unchanged.
import { COMPETENCY_SCAN_ITEMS, COVERAGE_ITEMS, labCoverageForScan, scanItemsForPassingStudy } from "./integrations";

export const CORRECTED_SOURCE = "admin_correction";

// Every form these notes have had, end anchored, so an auto note with the lab's own sentence added after it reads as the lab's.
const AUTO_NOTE = /^Auto-completed by Verita(?:Check|Competency|Comp)[^:\n]*: [^\n]* on \d{4}-\d{2}-\d{2}(?: documents all 6 CLIA procedures)?$/;
const NOTE_DATE = / on (\d{4}-\d{2}-\d{2})(?: documents all 6 CLIA procedures)?$/;
const STUDY_LINK = /^\/study\/(\d+)\/results$/;
const blank = (v: unknown) => v == null || String(v).trim() === "";

type Module = "veritacomp" | "veritacheck" | "veritacheck_passing";
type LeftReason = "lab_note_on_item" | "owner_due_or_teaching_note_set" | "evidence_linked" | "source_not_automatic" | "another_passing_study_supports";
type Row = {
  id: number; scan_id: number; item_id: number; status: string; notes: string | null; owner: string | null; due_date: string | null;
  teaching_note: string | null; completion_source: string | null; completion_link: string | null; completion_note: string | null;
  updated_at: string | null; lab_id: number | null; scan_user_id: number | null; is_demo: number;
};
export type PlannedMark = Row & { module: Module; savedAfterMark: boolean };

export function correctionNote(module: Module, date: string): string {
  if (module === "veritacomp") return `Veritas Lab Services moved this item back to Not Assessed on ${date}. VeritaComp™ had marked it Compliant automatically from a competency assessment, and one person's assessment doesn't answer this question. Please review it and enter your answer.`;
  if (module === "veritacheck") return `Veritas Lab Services moved this item back to Not Assessed on ${date}. VeritaCheck® had marked it Compliant automatically from a study that was a draft or did not pass, so that study doesn't support it. Please review it and enter your answer.`;
  return `Veritas Lab Services moved this item back to Not Assessed on ${date}. VeritaCheck® had marked it Compliant automatically from one passing study, which doesn't answer this question for the whole lab. The study stays linked as evidence. Please review it and enter your answer.`;
}

/** A corrected row keeps its study link only in the passing-study category: there the study is real evidence for the item. */
export const correctionKeepsLink = (module: Module): boolean => module === "veritacheck_passing";

/** Reads only. Works out which marks move and why the others stay. */
export function planMarkCorrection(sqlite: any) {
  const rows = sqlite.prepare(
    `SELECT i.id, i.scan_id, i.item_id, i.status, i.notes, i.owner, i.due_date, i.teaching_note, i.completion_source, i.completion_link, i.completion_note,
            i.updated_at, s.lab_id, s.user_id AS scan_user_id, COALESCE(l.is_demo, 0) AS is_demo
     FROM veritascan_items i JOIN veritascan_scans s ON s.id = i.scan_id LEFT JOIN labs l ON l.id = s.lab_id
     WHERE i.status = 'Compliant' AND (i.completion_source IN ('veritacomp_auto', 'veritacheck_auto')
        OR i.completion_note LIKE 'Auto-completed by VeritaComp%' OR i.notes LIKE 'Auto-completed by VeritaComp%')
     ORDER BY i.id`
  ).all() as Row[];
  const evidenceStmt = sqlite.prepare(
    `SELECT 1 FROM document_checklist_links dcl JOIN lab_documents d ON d.id = dcl.document_id WHERE d.lab_id = ? AND dcl.checklist_item_id = ? LIMIT 1`
  );
  const studyStmt = sqlite.prepare("SELECT status FROM studies WHERE id = ?");
  const passingStmt = sqlite.prepare("SELECT test_name, study_type FROM studies WHERE status = 'pass' AND (lab_id = ? OR (lab_id IS NULL AND user_id = ?))");

  const changedBy = (r: Row): LeftReason | null => {
    if (!blank(r.notes) && !AUTO_NOTE.test(String(r.notes))) return "lab_note_on_item";
    if (!blank(r.owner) || !blank(r.due_date) || !blank(r.teaching_note)) return "owner_due_or_teaching_note_set";
    if (r.lab_id != null && evidenceStmt.get(r.lab_id, r.item_id)) return "evidence_linked";
    return null;
  };
  const left = (): Record<LeftReason, number> => ({ lab_note_on_item: 0, owner_due_or_teaching_note_set: 0, evidence_linked: 0, source_not_automatic: 0, another_passing_study_supports: 0 });
  const comp = { outside_mapping_still_compliant: 0, to_move: 0, left_alone: left(), in_current_mapping_not_touched: 0 };
  const check = { from_draft_or_failed_study_still_compliant: 0, to_move: 0, left_alone: left(), study_not_draft_or_failed_not_touched: 0, study_not_found_not_touched: 0 };
  const passing = { from_passing_study_still_compliant: 0, to_move: 0, left_alone: left(), item_21_or_29_lab_coverage_complete_not_touched: 0 };
  const inMapping = new Set(Object.values(COMPETENCY_SCAN_ITEMS).flat());
  const moving = new Map<number, PlannedMark>();
  const leftPerRow = new Map<number, Row>();
  const plan = (r: Row, module: Module) => {
    const markDate = String(r.completion_note ?? r.notes ?? "").match(NOTE_DATE)?.[1];
    moving.set(r.id, { ...r, module, savedAfterMark: !!markDate && String(r.updated_at ?? "").slice(0, 10) > markDate });
  };
  const coverageByLab = new Map<number, Record<21 | 29, boolean>>();
  const coverageComplete = (labId: number | null, itemId: number): boolean => {
    if (labId == null || !(COVERAGE_ITEMS as readonly number[]).includes(itemId)) return false;
    if (!coverageByLab.has(labId)) coverageByLab.set(labId, labCoverageForScan(sqlite, labId).complete);
    return coverageByLab.get(labId)![itemId as 21 | 29];
  };
  // BUG-135: a mark from a passing study stays only where the new rule would make it, items 21 and 29 on a lab whose coverage is complete.
  const planPassing = (r: Row) => {
    passing.from_passing_study_still_compliant++;
    if (coverageComplete(r.lab_id, r.item_id)) { passing.item_21_or_29_lab_coverage_complete_not_touched++; return; }
    const reason = changedBy(r);
    if (reason) { passing.left_alone[reason]++; leftPerRow.set(r.id, r); return; }
    passing.to_move++;
    plan(r, "veritacheck_passing");
  };

  for (const r of rows) {
    if (r.completion_source === "veritacheck_auto") {
      const studyId = String(r.completion_link ?? "").match(STUDY_LINK)?.[1];
      const study = studyId ? (studyStmt.get(Number(studyId)) as { status: string } | undefined) : undefined;
      if (!study) { check.study_not_found_not_touched++; continue; }
      if (study.status !== "draft" && study.status !== "fail") {
        check.study_not_draft_or_failed_not_touched++;
        if (study.status === "pass") planPassing(r);
        continue;
      }
      check.from_draft_or_failed_study_still_compliant++;
      const supported = (passingStmt.all(r.lab_id, r.scan_user_id) as Array<{ test_name: string; study_type: string }>)
        .some((s) => scanItemsForPassingStudy(s.study_type, s.test_name).includes(r.item_id));
      const reason: LeftReason | null = supported ? "another_passing_study_supports" : changedBy(r);
      if (reason) { check.left_alone[reason]++; leftPerRow.set(r.id, r); continue; }
      check.to_move++;
      plan(r, "veritacheck");
      continue;
    }
    if (inMapping.has(r.item_id)) { comp.in_current_mapping_not_touched++; continue; }
    comp.outside_mapping_still_compliant++;
    const reason: LeftReason | null = r.completion_source !== "veritacomp_auto" ? "source_not_automatic" : changedBy(r);
    if (reason) { comp.left_alone[reason]++; leftPerRow.set(r.id, r); continue; }
    comp.to_move++;
    plan(r, "veritacomp");
  }

  const toMove = Array.from(moving.values());
  type Tally = { scans: Set<number>; veritacomp: number; veritacheck: number; veritacheck_passing: number; left_alone: number; is_demo: boolean };
  const emptyTally = (isDemo: number): Tally => ({ scans: new Set(), veritacomp: 0, veritacheck: 0, veritacheck_passing: 0, left_alone: 0, is_demo: !!isDemo });
  const tallies = new Map<number | null, Tally>();
  const tally = (labId: number | null, isDemo: number): Tally => {
    if (!tallies.has(labId)) tallies.set(labId, emptyTally(isDemo));
    return tallies.get(labId)!;
  };
  for (const m of toMove) { const t = tally(m.lab_id, m.is_demo); t.scans.add(m.scan_id); t[m.module]++; }
  for (const r of Array.from(leftPerRow.values())) tally(r.lab_id, r.is_demo).left_alone++;
  const counts = (t: Tally) => ({ scans_with_a_mark_to_move: t.scans.size, veritacomp: t.veritacomp, veritacheck: t.veritacheck, veritacheck_passing: t.veritacheck_passing, left_alone: t.left_alone });
  const report = {
    total_to_move: toMove.length,
    scan_saved_after_mark: toMove.filter((m) => m.savedAfterMark).length,
    veritacomp: comp,
    veritacheck: check,
    veritacheck_passing: passing,
    by_lab: Array.from(tallies.entries()).filter(([labId]) => labId != null).sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([labId, t]) => ({ lab_id: Number(labId), is_demo: t.is_demo, ...counts(t) })),
    scans_with_no_lab: counts(tallies.get(null) ?? emptyTally(0)),
  };
  return { toMove, report };
}

/**
 * All of it or none of it. Each update repeats what the row held in the plan, so a row someone changed after the plan stays as it
 * is and isn't returned. The note replaces the auto note, which the plan has shown holds none of the lab's words. The link is
 * cleared, except on a passing-study mark (correctionKeepsLink), where it stays as the item's evidence.
 */
export function applyMarkCorrection(sqlite: any, toMove: PlannedMark[], nowIso: string): PlannedMark[] {
  const date = nowIso.slice(0, 10);
  const update = sqlite.prepare(
    `UPDATE veritascan_items SET status = 'Not Assessed', notes = ?, completion_source = ?, completion_link = CASE WHEN ? = 1 THEN completion_link ELSE NULL END, completion_note = ?, updated_at = ?
     WHERE id = ? AND status = 'Compliant' AND completion_source = ? AND COALESCE(notes, '') = COALESCE(?, '') AND COALESCE(owner, '') = COALESCE(?, '')
       AND COALESCE(due_date, '') = COALESCE(?, '') AND COALESCE(teaching_note, '') = COALESCE(?, '') AND COALESCE(completion_link, '') = COALESCE(?, '')`
  );
  const touchScan = sqlite.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?");
  return sqlite.transaction(() => {
    const changed = toMove.filter((m) => {
      const note = correctionNote(m.module, date);
      return update.run(note, CORRECTED_SOURCE, correctionKeepsLink(m.module) ? 1 : 0, note, nowIso, m.id, m.completion_source, m.notes, m.owner, m.due_date, m.teaching_note, m.completion_link).changes === 1;
    });
    for (const scanId of Array.from(new Set(changed.map((m) => m.scan_id)))) touchScan.run(nowIso, scanId);
    return changed;
  })();
}
