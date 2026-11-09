/**
 * VeritaCheck / VeritaComp → VeritaScan Integration Bridge
 * A passing VeritaCheck study links itself as evidence on its matching VeritaScan items and leaves the status to the lab;
 * items 21 and 29 are marked Compliant only while VeritaCheck Coverage shows the whole lab current (BUG-135). A passing
 * VeritaComp assessment marks the items COMPETENCY_SCAN_ITEMS lists.
 */
import { db } from "./db";
import { aggregateElementStatus, incompleteElementCells } from "@shared/competencyStatus";
import { isEvaluationProgram } from "@shared/competencyEvaluation";
import { computeCoverageForLab, type CoverageResult } from "./veritacheckCoverage";
import { labTimeZoneById, labToday, withLabClock } from "./dateLocal";

// An auto-completion only ever fills an unassessed item or refreshes its own earlier mark. Saving an item on the scan
// screen leaves completion_source alone, so an item the lab changed to Needs Attention or N/A still reads as an auto mark;
// the status is what shows the mark still stands (site review 2026-11-05, closing the gap BUG-074 left).
const AUTO_COMPLETION_MAY_UPDATE = `veritascan_items.status IS NULL OR veritascan_items.status IN ('', 'Not Assessed')
       OR (veritascan_items.status = 'Compliant' AND veritascan_items.completion_source IN ('veritacheck_auto', 'veritacomp_auto'))`;

// BUG-135 (Michael 2026-11-09, Q246 = 1). One passing study marked item 21 ("calibration verification performed at least every
// 6 months for all nonwaived tests") Compliant in every scan of the lab, whatever the rest of the menu showed. Now:
//   - A passing study links itself as evidence (completion_source 'veritacheck_evidence') on its items and never sets a status.
//     It writes only where the lab hasn't answered: an unassessed row, a row already holding VeritaCheck evidence (link and note
//     refreshed, status left), or an older VeritaCheck mark still reading Compliant (link and note refreshed, status left; the
//     admin correction route handles those marks). One study link per item: the latest passing study wins.
//   - Items 21 and 29 are marked Compliant ('veritacheck_auto', through AUTO_COMPLETION_MAY_UPDATE) only while VeritaCheck
//     Coverage shows every nonwaived test current (coverageItemsComplete). The mark's note starts with COVERAGE_NOTE_PREFIX, which
//     is how a coverage mark is told apart from an older one: no route lets a lab write completion_note.
//   - When coverage stops being complete, our coverage mark goes back to Not Assessed as evidence, with the link kept and a note
//     saying why. Re-checked on every pass, every sign-off, and daily (recheckCoverageScanMarks, server/index.ts).
export const EVIDENCE_SOURCE = "veritacheck_evidence";
export const COVERAGE_ITEMS = [21, 29] as const;
export const COVERAGE_NOTE_PREFIX = "Marked Compliant by VeritaCheck® Coverage";
const EVIDENCE_MAY_ATTACH = `veritascan_items.status IS NULL OR veritascan_items.status IN ('', 'Not Assessed')
       OR veritascan_items.completion_source = 'veritacheck_evidence'
       OR (veritascan_items.status = 'Compliant' AND veritascan_items.completion_source = 'veritacheck_auto')`;
const OUR_COMPLIANT_MARK = `veritascan_items.status = 'Compliant' AND veritascan_items.completion_source = 'veritacheck_auto'`;
const STUDY_LINK = /^\/study\/(\d+)\/results$/;

export function evidenceNote(testName: string, date: string): string {
  return `Evidence from VeritaCheck®: a passing ${testName} study on ${date}`;
}

// Study type → VeritaScan item keyword mapping
//
// Rewired 2026-06-02 after the cal_ver split (PRs #485 / #487 / #488 / #489):
// "Linearity" now routes to its own `linearity` study type instead of cal_ver,
// and reportable_range / accuracy_bias / carryover join the map with their
// own keyword arrays. cal_ver narrows to Calibration Verification only.
// accuracy_bias uses specific phrasing ("Accuracy / Bias", "Trueness") to
// avoid colliding with `precision` which legitimately matches bare "Accuracy"
// / "accuracy" / "bias" for accuracy within precision studies.
const STUDY_TYPE_KEYWORDS: Record<string, string[]> = {
  method_comparison: ["Correlation", "Method Comparison", "correlation"],
  cal_ver: ["Calibration Verification", "Calibration verification", "calibration verification"],
  cal_ver_correlation: ["Calibration Verification", "Calibration verification", "calibration verification", "Correlation", "Method Comparison", "correlation"],
  precision: ["Accuracy", "Precision", "accuracy", "precision", "bias"],
  lot_to_lot: ["Lot", "Reagent", "lot", "reagent"],
  pt_coag: ["PT", "PTT", "coagulation", "Coagulation"],
  qc_range: [],
  multi_analyte_coag: [],
  inr: [],
  linearity: ["Linearity", "linearity"],
  reportable_range: ["Reportable Range", "Reportable range", "reportable range", "AMR Verification", "AMR verification"],
  accuracy_bias: ["Accuracy / Bias", "Accuracy/Bias", "accuracy/bias", "Trueness", "trueness"],
  carryover: ["Carryover", "carryover"],
};

type StudyForScan = {
  id: number;
  userId: number | null;
  testName: string;
  studyType: string;
  instruments?: string;
  // BUG-074 (2026-10-27): the study's lab. Scans are matched by lab; the owner's account is the fallback only for
  // legacy rows with no lab, so a multi-lab owner's study no longer reaches another lab's scans.
  labId?: number | null;
  // SCN-09 (site review 2026-11-05): the stored verdict. Only a study that passed links anything; a saved draft or a
  // failed study marked these items Compliant until then.
  status?: string | null;
};

/**
 * When a VeritaCheck study is saved as a pass: link it as evidence on its VeritaScan items, then re-check the lab's coverage
 * marks on items 21 and 29 (BUG-135). A draft, a failed study or a guest study does nothing.
 */
export function autoCompleteVeritaScanItems(study: StudyForScan) {
  if (!study.userId) return; // Guest studies don't reach VeritaScan
  if (study.status !== "pass") return;
  linkVeritaCheckEvidence(study);
  if (study.labId) syncCoverageScanMarks((db as any).$client, Number(study.labId));
}

/**
 * A passing study's link and note on its matching items, in the scans of its lab (the owner's scans for a legacy study with no
 * lab). Never sets a status. A row the lab answered is left as it is; see EVIDENCE_MAY_ATTACH. Returns the rows written.
 */
export function linkVeritaCheckEvidence(study: StudyForScan): number {
  if (!study.userId || study.status !== "pass") return 0;
  const itemIds = scanItemsForPassingStudy(study.studyType, study.testName);
  if (itemIds.length === 0) return 0;
  const sqlite = (db as any).$client;
  const scans = (study.labId
    ? sqlite.prepare("SELECT id FROM veritascan_scans WHERE lab_id = ?").all(study.labId)
    : sqlite.prepare("SELECT id FROM veritascan_scans WHERE user_id = ?").all(study.userId)) as { id: number }[];
  if (scans.length === 0) return 0;

  const now = new Date().toISOString();
  const note = evidenceNote(study.testName, labToday());
  const link = `/study/${study.id}/results`;
  // An older mark (still Compliant from VeritaCheck) keeps its source and status, and a coverage mark keeps its note too, so the
  // coverage check that follows still knows it as ours. Every other row it reaches becomes evidence.
  const stmt = sqlite.prepare(`
    INSERT INTO veritascan_items (scan_id, item_id, status, notes, completion_source, completion_link, completion_note, updated_at)
    VALUES (@scan, @item, 'Not Assessed', NULL, '${EVIDENCE_SOURCE}', @link, @note, @now)
    ON CONFLICT(scan_id, item_id) DO UPDATE SET
      completion_source = CASE WHEN ${OUR_COMPLIANT_MARK} THEN veritascan_items.completion_source ELSE '${EVIDENCE_SOURCE}' END,
      completion_link = excluded.completion_link,
      completion_note = CASE WHEN ${OUR_COMPLIANT_MARK} AND veritascan_items.completion_note LIKE @coverage
        THEN veritascan_items.completion_note ELSE excluded.completion_note END,
      updated_at = excluded.updated_at
    WHERE ${EVIDENCE_MAY_ATTACH}
  `);
  const touchScan = sqlite.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?");
  let written = 0;
  sqlite.transaction(() => {
    for (const scan of scans) {
      let inScan = 0;
      for (const itemId of itemIds) inScan += stmt.run({ scan: scan.id, item: itemId, link, note, now, coverage: `${COVERAGE_NOTE_PREFIX}%` }).changes;
      if (inScan > 0) touchScan.run(now, scan.id);
      written += inScan;
    }
  })();
  return written;
}

/**
 * Is the whole lab current on VeritaCheck Coverage, for item 21 (calibration verification) and item 29 (correlation)? Read from
 * computeCoverageForLab's summary (served at GET /api/labs/:labId/veritacheck/coverage), which credits a test only when the latest
 * study on that instrument (or a recorded outside study) is signed and passing within 6 months, and skips waived and exempt tests.
 *   21: no test missing (missing also holds failed, unsigned and overdue) and none under review, and at least one covered.
 *   29: at least one correlation needed, every one done this cycle (signed, passing, next due ahead), none overdue.
 */
export function coverageItemsComplete(summary: CoverageResult["summary"]): Record<21 | 29, boolean> {
  return {
    21: summary.linearityMissing === 0 && summary.linearityReview === 0 && summary.linearityCovered > 0,
    29: summary.methodComparisonsNeeded > 0 && summary.methodComparisonsDone === summary.methodComparisonsNeeded && summary.methodComparisonsOverdue === 0,
  };
}

/** The lab's coverage on its own calendar day (the time zone a background job or an admin request doesn't carry). */
export function labCoverageForScan(sqlite: any, labId: number) {
  return withLabClock(labTimeZoneById(sqlite, labId), () => {
    const summary = computeCoverageForLab(sqlite, labId).summary;
    return { summary, complete: coverageItemsComplete(summary), date: labToday() };
  });
}

export function coverageMarkNote(itemId: 21 | 29, summary: CoverageResult["summary"], date: string): string {
  return itemId === 21
    ? `${COVERAGE_NOTE_PREFIX} on ${date}: every nonwaived test on the VeritaMap\u00AE that needs calibration verification has a current signed, passing study (${summary.linearityCovered} of ${summary.linearityRequired}).`
    : `${COVERAGE_NOTE_PREFIX} on ${date}: every test run on more than one instrument has a current signed, passing correlation (${summary.methodComparisonsDone} of ${summary.methodComparisonsNeeded}).`;
}

export function coverageLapseNote(itemId: 21 | 29, date: string, keepsStudy: boolean): string {
  const what = itemId === 21
    ? "every nonwaived test with a current signed, passing calibration verification"
    : "a current signed, passing correlation for every test run on more than one instrument";
  return `VeritaCheck\u00AE Coverage on ${date} no longer shows ${what}, so this item went back to Not Assessed.${keepsStudy ? " The study stays linked as evidence." : ""} Please review it and enter your answer.`;
}

const isCoverageMark = (row: any) =>
  !!row && row.status === "Compliant" && row.completion_source === "veritacheck_auto" && String(row.completion_note ?? "").startsWith(COVERAGE_NOTE_PREFIX);

/**
 * Items 21 and 29 in every scan of the lab, from the lab's coverage. Complete: marked Compliant ('veritacheck_auto') through
 * AUTO_COMPLETION_MAY_UPDATE, so a lab's own answer is never overwritten, keeping a passing study's link already on the row (else
 * the coverage page). Our own coverage mark is left as it is. Not complete: our own coverage mark goes back to Not Assessed as
 * evidence, link kept, with a note saying why; nothing else is touched. A lab is needed: a scan with no lab never gets it.
 */
export function syncCoverageScanMarks(sqlite: any, labId: number): { marked: number; lapsed: number; complete: Record<21 | 29, boolean> } {
  const scans = sqlite.prepare("SELECT id FROM veritascan_scans WHERE lab_id = ?").all(labId) as { id: number }[];
  if (!labId || scans.length === 0) return { marked: 0, lapsed: 0, complete: { 21: false, 29: false } };
  const { summary, complete, date } = labCoverageForScan(sqlite, labId);
  const now = new Date().toISOString();
  const rowStmt = sqlite.prepare("SELECT * FROM veritascan_items WHERE scan_id = ? AND item_id = ?");
  const studyStatus = sqlite.prepare("SELECT status FROM studies WHERE id = ?");
  const passingStudyLink = (link: unknown) => {
    const id = String(link ?? "").match(STUDY_LINK)?.[1];
    return !!id && (studyStatus.get(Number(id)) as { status: string } | undefined)?.status === "pass";
  };
  const mark = sqlite.prepare(`
    INSERT INTO veritascan_items (scan_id, item_id, status, notes, completion_source, completion_link, completion_note, updated_at)
    VALUES (@scan, @item, 'Compliant', NULL, 'veritacheck_auto', @link, @note, @now)
    ON CONFLICT(scan_id, item_id) DO UPDATE SET
      status = 'Compliant',
      completion_source = 'veritacheck_auto',
      completion_link = excluded.completion_link,
      completion_note = excluded.completion_note,
      updated_at = excluded.updated_at
    WHERE (${AUTO_COMPLETION_MAY_UPDATE}) AND NOT (${OUR_COMPLIANT_MARK} AND veritascan_items.completion_note LIKE @coverage)
  `);
  const lapse = sqlite.prepare(`
    UPDATE veritascan_items SET status = 'Not Assessed', completion_source = '${EVIDENCE_SOURCE}', completion_note = @note, updated_at = @now
    WHERE id = @id AND ${OUR_COMPLIANT_MARK} AND veritascan_items.completion_note LIKE @coverage
  `);
  const touchScan = sqlite.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?");
  let marked = 0, lapsed = 0;
  sqlite.transaction(() => {
    for (const scan of scans) {
      let inScan = 0;
      for (const itemId of COVERAGE_ITEMS) {
        const row = rowStmt.get(scan.id, itemId) as any;
        if (complete[itemId]) {
          if (isCoverageMark(row)) continue;
          const link = row && passingStudyLink(row.completion_link) ? row.completion_link : `/labs/${labId}/veritacheck/coverage`;
          const n = mark.run({ scan: scan.id, item: itemId, link, note: coverageMarkNote(itemId, summary, date), now, coverage: `${COVERAGE_NOTE_PREFIX}%` }).changes;
          marked += n; inScan += n;
        } else if (isCoverageMark(row)) {
          const n = lapse.run({ id: row.id, note: coverageLapseNote(itemId, date, passingStudyLink(row.completion_link)), now, coverage: `${COVERAGE_NOTE_PREFIX}%` }).changes;
          lapsed += n; inScan += n;
        }
      }
      if (inScan > 0) touchScan.run(now, scan.id);
    }
  })();
  return { marked, lapsed, complete };
}

/**
 * The daily re-check (server/index.ts): every lab holding a coverage mark on item 21 or 29, so a mark lapses when a signed study
 * passes its 6 months, or coverage changes without a study being signed. Each lab runs on its own calendar day.
 */
export function recheckCoverageScanMarks(sqlite: any = (db as any).$client): { labs: number; marked: number; lapsed: number; errors: number } {
  const labs = sqlite.prepare(
    `SELECT DISTINCT s.lab_id FROM veritascan_items i JOIN veritascan_scans s ON s.id = i.scan_id
     WHERE s.lab_id IS NOT NULL AND i.item_id IN (${COVERAGE_ITEMS.join(", ")}) AND i.status = 'Compliant'
       AND i.completion_source = 'veritacheck_auto' AND i.completion_note LIKE ?
     ORDER BY s.lab_id`
  ).all(`${COVERAGE_NOTE_PREFIX}%`) as Array<{ lab_id: number }>;
  let marked = 0, lapsed = 0, errors = 0;
  for (const { lab_id } of labs) {
    try {
      const r = syncCoverageScanMarks(sqlite, Number(lab_id));
      marked += r.marked; lapsed += r.lapsed;
    } catch (err: any) {
      errors++;
      console.warn(`[scan-coverage] lab ${lab_id} re-check failed:`, err?.message);
    }
  }
  return { labs: labs.length, marked, lapsed, errors };
}

/** The VeritaScan items a passing study of this type and test links itself to as evidence. */
export function scanItemsForPassingStudy(studyType: string, testName: string): number[] {
  const keywords = STUDY_TYPE_KEYWORDS[studyType];
  if (!keywords || keywords.length === 0) return [];
  return findMatchingScanItemIds(keywords, testName, studyType);
}

/**
 * Find VeritaScan item IDs that match a given study type and analyte.
 * Uses the 173-item checklist structure.
 */
function findMatchingScanItemIds(keywords: string[], analyte: string, studyType: string): number[] {
  // Calibration & Verification domain items (21-38) — match by keyword
  // Quality Systems & QC domain items (1-20) — match by keyword
  // We search by keyword across all items, plus analyte-specific matching

  const matchingIds: number[] = [];
  const analyteLower = analyte.toLowerCase();

  // Domain-specific item ranges for targeted matching
  const SCAN_ITEM_QUESTIONS: Record<number, string> = {
    // Calibration & Verification items most likely to match
    21: "Calibration verification performed at least every 6 months",
    22: "Calibration verification records include assigned values",
    23: "Calibration verification uses a minimum of 3 levels",
    24: "Acceptability criteria for calibration verification defined",
    25: "Failed calibration verification triggers corrective action",
    26: "Method comparison (correlation) performed before any new method",
    27: "Method comparison includes minimum 20 patient samples",
    28: "Method comparison acceptability criteria defined",
    29: "Correlation studies performed when multiple instruments perform the same test",
    30: "Precision verification (EP15 or equivalent) performed",
    31: "Reportable range verified and documented",
    32: "Accuracy verification (bias study) performed",
    // Equipment items for lot/reagent
    99: "Reagent and supply lot numbers documented with acceptance testing",
    105: "New reagent lot acceptance testing performed before patient use",
    // QC items
    7: "New QC lot numbers validated before being placed in service",
  };

  // Match based on study type
  switch (studyType) {
    case "method_comparison":
      // Items about correlation/method comparison
      matchingIds.push(26, 27, 28, 29);
      break;
    case "cal_ver":
      // Items about calibration verification
      matchingIds.push(21, 22, 23, 24);
      break;
    case "cal_ver_correlation":
      // Calibration Verification + Correlation answers both sets
      matchingIds.push(21, 22, 23, 24, 26, 27, 28, 29);
      break;
    case "precision":
      // Items about accuracy/precision
      matchingIds.push(30, 32);
      break;
    case "lot_to_lot":
      // Items about lot/reagent verification
      matchingIds.push(99, 105, 7);
      break;
    case "pt_coag":
      // PT-specific: match correlation items for PT/PTT
      if (analyteLower.includes("pt") || analyteLower.includes("ptt") || analyteLower.includes("coag")) {
        matchingIds.push(26, 27, 28, 29);
      }
      break;
  }

  return matchingIds;
}

/**
 * The VeritaScan items one passing VeritaComp assessment can honestly mark, by the program's type (site review
 * 2026-11-05). The list used to be item numbers from an older catalog: waived marked 64 (director attestation) and 65 (job
 * descriptions), non-technical marked 66 (safety training records) and 67 (delegation of authority), technical marked 60
 * to 63. Keep it to questions one person's record can answer. An item that asks about all staff, a schedule or a process
 * stays with the lab:
 *   58, 59, 143, 144  initial, annual and POCT competency "for all" staff: one record says nothing about the others.
 *   61  records signed by the laboratory director or designee: signing comes after this save, and it asks about all records.
 *   62  remediation when deficiencies are found: a pass shows none.
 *   63  concurrent QC on infrequently performed tests: not on the record.
 *   68  personnel know the QC rules: one person's record, and the question is about all of them.
 * Technical keeps 60 (the assessment includes all 6 CLIA procedures), and only when the record shows them. No item asks
 * about waived or non-technical competency for one person, so those two mark nothing.
 */
export const COMPETENCY_SCAN_ITEMS: Record<string, number[]> = {
  technical: [60],
  waived: [],
  nontechnical: [],
};

const CLIA_PROCEDURES = [1, 2, 3, 4, 5, 6];

/**
 * Does this saved record show all 6 CLIA procedures? Every method on the program has all six elements documented or marked
 * N/A, none failed, and each procedure has real data on at least one method. A "pass" alone doesn't: the form defaults to
 * pass and saves with elements blank.
 */
export function recordShowsAllCliaProcedures(items: any[], methodGroups: Array<{ id: number; name?: string | null }>): boolean {
  return methodGroups.length > 0
    && incompleteElementCells(items, methodGroups, CLIA_PROCEDURES.length).length === 0
    && CLIA_PROCEDURES.every((el) => aggregateElementStatus(items, el) === "pass");
}

/**
 * After a VeritaComp assessment is saved, mark the VeritaScan items it supports. Everything is read from the saved record:
 * its verdict, its program's own type and its lab, never what the request said. A record is often saved first and filled in
 * later, so an edit runs this too. A new-hire evaluation is not a competency and marks nothing. BUG-074 (2026-10-27): scans
 * of the assessment's lab only (the owner's account is the fallback for legacy rows with no lab), and a lab's own answer on
 * an item is never overwritten.
 */
export function autoCompleteCompetencyScanItems(assessmentId: number | string) {
  const sqlite = (db as any).$client;
  const record = sqlite.prepare(
    `SELECT a.status, a.program_id, p.type, p.record_kind, p.lab_id, p.user_id
     FROM competency_assessments a JOIN competency_programs p ON a.program_id = p.id
     WHERE a.id = ?`
  ).get(assessmentId) as any;
  if (!record || record.status !== "pass" || isEvaluationProgram(record)) return;
  const itemIds = COMPETENCY_SCAN_ITEMS[record.type] ?? [];
  if (itemIds.length === 0) return;

  const rows = sqlite.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ?").all(assessmentId) as any[];
  const methodGroups = sqlite.prepare("SELECT id, name FROM competency_method_groups WHERE program_id = ?").all(record.program_id) as any[];
  if (!recordShowsAllCliaProcedures(rows, methodGroups)) return;

  const scans = (record.lab_id
    ? sqlite.prepare("SELECT id FROM veritascan_scans WHERE lab_id = ?").all(record.lab_id)
    : sqlite.prepare("SELECT id FROM veritascan_scans WHERE user_id = ?").all(record.user_id)) as { id: number }[];
  if (scans.length === 0) return;

  const now = new Date().toISOString();
  const completionNote = `Auto-completed by VeritaComp™: a ${record.type} assessment on ${now.split("T")[0]} documents all 6 CLIA procedures`;
  const upsertStmt = sqlite.prepare(`
    INSERT INTO veritascan_items (scan_id, item_id, status, notes, completion_source, completion_link, completion_note, updated_at)
    VALUES (?, ?, 'Compliant', ?, 'veritacomp_auto', '/veritacomp-app', ?, ?)
    ON CONFLICT(scan_id, item_id) DO UPDATE SET
      status = 'Compliant',
      completion_source = 'veritacomp_auto',
      completion_link = '/veritacomp-app',
      completion_note = excluded.completion_note,
      updated_at = excluded.updated_at
    WHERE ${AUTO_COMPLETION_MAY_UPDATE}
  `);

  const bulkUpdate = sqlite.transaction(() => {
    for (const scan of scans) {
      for (const itemId of itemIds) {
        upsertStmt.run(scan.id, itemId, completionNote, completionNote, now);
      }
    }
  });
  bulkUpdate();

  for (const scan of scans) {
    sqlite.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?").run(now, scan.id);
  }
}

type AutoMark = { item_id: number; status: string; scan_id: number; lab_id: number | null; is_demo: number };

function tallyMarks(rows: AutoMark[]) {
  return {
    marks: rows.length,
    still_compliant: rows.filter((r) => r.status === "Compliant").length,
    labs: new Set(rows.filter((r) => r.lab_id != null).map((r) => r.lab_id)).size,
    demo_labs: new Set(rows.filter((r) => r.lab_id != null && r.is_demo).map((r) => r.lab_id)).size,
    scans: new Set(rows.map((r) => r.scan_id)).size,
    scans_with_no_lab: new Set(rows.filter((r) => r.lab_id == null).map((r) => r.scan_id)).size,
  };
}

function marksByItem<T>(rows: AutoMark[], extra: (itemId: number) => T) {
  const byItem = new Map<number, AutoMark[]>();
  for (const r of rows) byItem.set(r.item_id, [...(byItem.get(r.item_id) ?? []), r]);
  return Array.from(byItem.keys()).sort((a, b) => a - b).map((itemId) => {
    const { marks, still_compliant, labs } = tallyMarks(byItem.get(itemId)!);
    return { item_id: itemId, marks, still_compliant, labs, ...extra(itemId) };
  });
}

/**
 * GET /api/admin/veritascan/auto-completion-audit. Read-only, counts only, no names: how many VeritaScan items the
 * auto-completions have marked, so Michael can decide what to do about the marks made before the 2026-11-05 fix.
 * still_compliant leaves out an item the lab has since changed. A VeritaComp mark is known by its source or its note; "outside
 * the current mapping" is what the list above would no longer mark. An item 60 mark from before the fix did not check the
 * record, so it may not rest on all six either. A VeritaCheck mark links the study that last touched it.
 */
export function auditScanAutoCompletions(sqlite: any) {
  const select = `SELECT i.item_id, i.status, i.scan_id, s.lab_id, COALESCE(l.is_demo, 0) AS is_demo`;
  const from = `FROM veritascan_items i JOIN veritascan_scans s ON s.id = i.scan_id LEFT JOIN labs l ON l.id = s.lab_id`;
  const comp = sqlite.prepare(`${select} ${from}
    WHERE i.completion_source = 'veritacomp_auto' OR i.completion_note LIKE 'Auto-completed by VeritaComp%' OR i.notes LIKE 'Auto-completed by VeritaComp%'`).all() as AutoMark[];
  const check = sqlite.prepare(`${select}, st.status AS study_status ${from}
    LEFT JOIN studies st ON i.completion_link = '/study/' || st.id || '/results'
    WHERE i.completion_source = 'veritacheck_auto'`).all() as Array<AutoMark & { study_status: string | null }>;
  const inMapping = new Set(Object.values(COMPETENCY_SCAN_ITEMS).flat());
  return {
    ok: true,
    veritacomp: {
      ...tallyMarks(comp),
      outside_current_mapping: tallyMarks(comp.filter((r) => !inMapping.has(r.item_id))),
      items: marksByItem(comp, (itemId) => ({ in_current_mapping: inMapping.has(itemId) })),
    },
    veritacheck: {
      ...tallyMarks(check),
      from_draft_or_failed_study: check.filter((r) => r.status === "Compliant" && (r.study_status === "draft" || r.study_status === "fail")).length,
      items: marksByItem(check, () => ({})),
    },
  };
}
