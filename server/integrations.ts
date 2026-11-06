/**
 * VeritaCheck / VeritaComp → VeritaScan Integration Bridge
 * When a VeritaCheck study passes or a VeritaComp assessment passes, automatically complete matching VeritaScan items.
 */
import { db } from "./db";
import { aggregateElementStatus, incompleteElementCells } from "@shared/competencyStatus";
import { isEvaluationProgram } from "@shared/competencyEvaluation";

// An auto-completion only ever fills an unassessed item or refreshes its own earlier mark. Saving an item on the scan
// screen leaves completion_source alone, so an item the lab changed to Needs Attention or N/A still reads as an auto mark;
// the status is what shows the mark still stands (site review 2026-11-05, closing the gap BUG-074 left).
const AUTO_COMPLETION_MAY_UPDATE = `veritascan_items.status IS NULL OR veritascan_items.status IN ('', 'Not Assessed')
       OR (veritascan_items.status = 'Compliant' AND veritascan_items.completion_source IN ('veritacheck_auto', 'veritacomp_auto'))`;

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

/**
 * When a VeritaCheck study is saved, find and auto-complete matching VeritaScan items.
 */
export function autoCompleteVeritaScanItems(study: {
  id: number;
  userId: number | null;
  testName: string;
  studyType: string;
  instruments?: string;
  // BUG-074 (2026-10-27): the study's lab. Scans are matched by lab; the owner's account is the fallback only for
  // legacy rows with no lab, so a multi-lab owner's study no longer completes items in another lab's scans.
  labId?: number | null;
  // SCN-09 (site review 2026-11-05): the stored verdict. Only a study that passed marks anything; a saved draft or a
  // failed study marked these items Compliant until now.
  status?: string | null;
}) {
  if (!study.userId) return; // Guest studies don't trigger auto-completion
  if (study.status !== "pass") return;

  const keywords = STUDY_TYPE_KEYWORDS[study.studyType];
  if (!keywords || keywords.length === 0) return;

  // Get the analyte name from the study's test name
  const analyte = study.testName;

  // Find all scans for this user
  const scans = (study.labId
    ? (db as any).$client.prepare("SELECT id FROM veritascan_scans WHERE lab_id = ?").all(study.labId)
    : (db as any).$client.prepare("SELECT id FROM veritascan_scans WHERE user_id = ?").all(study.userId)) as { id: number }[];

  if (scans.length === 0) return;

  const now = new Date().toISOString();
  const completionNote = `Auto-completed by VeritaCheck\u00AE: ${analyte} on ${now.split("T")[0]}`;
  const completionLink = `/study/${study.id}/results`;

  // For each scan, find matching items using the veritaScanData items
  // We need to match by: keyword in question AND analyte name in question (case-insensitive)
  const upsertStmt = (db as any).$client.prepare(`
    INSERT INTO veritascan_items (scan_id, item_id, status, notes, completion_source, completion_link, completion_note, updated_at)
    VALUES (?, ?, 'Compliant', ?, 'veritacheck_auto', ?, ?, ?)
    ON CONFLICT(scan_id, item_id) DO UPDATE SET
      status = 'Compliant',
      completion_source = 'veritacheck_auto',
      completion_link = excluded.completion_link,
      completion_note = excluded.completion_note,
      updated_at = excluded.updated_at
    -- BUG-074: never overwrite a lab's own answer (Needs Attention, N/A, a manual Compliant); only an unassessed item
    -- or an earlier auto-completion is updated.
    WHERE ${AUTO_COMPLETION_MAY_UPDATE}
  `);

  // Import scan items data (embedded for server-side use)
  const matchingItemIds = findMatchingScanItemIds(keywords, analyte, study.studyType);

  if (matchingItemIds.length === 0) return;

  const bulkUpdate = (db as any).$client.transaction(() => {
    for (const scan of scans) {
      for (const itemId of matchingItemIds) {
        upsertStmt.run(scan.id, itemId, completionNote, completionLink, completionNote, now);
      }
    }
  });

  bulkUpdate();

  // Update scan updated_at
  for (const scan of scans) {
    (db as any).$client.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?").run(now, scan.id);
  }
}

/** The VeritaScan items a passing study of this type and test marks: the rule autoCompleteVeritaScanItems applies. */
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
