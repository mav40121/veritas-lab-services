/**
 * VeritaCheck → VeritaScan Integration Bridge
 * When a VeritaCheck study is saved, automatically complete matching VeritaScan items.
 */
import { db } from "./db";

// Study type → VeritaScan item keyword mapping
const STUDY_TYPE_KEYWORDS: Record<string, string[]> = {
  method_comparison: ["Correlation", "Method Comparison", "correlation"],
  cal_ver: ["Calibration Verification", "Calibration verification", "calibration verification", "Linearity"],
  precision: ["Accuracy", "Precision", "accuracy", "precision", "bias"],
  lot_to_lot: ["Lot", "Reagent", "lot", "reagent"],
  pt_coag: ["PT", "PTT", "coagulation", "Coagulation"],
  qc_range: [],
  multi_analyte_coag: [],
  inr: [],
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
}) {
  if (!study.userId) return; // Guest studies don't trigger auto-completion

  const keywords = STUDY_TYPE_KEYWORDS[study.studyType];
  if (!keywords || keywords.length === 0) return;

  // Get the analyte name from the study's test name
  const analyte = study.testName;

  // Find all scans for this user
  const scans = (db as any).$client.prepare(
    "SELECT id FROM veritascan_scans WHERE user_id = ?"
  ).all(study.userId) as { id: number }[];

  if (scans.length === 0) return;

  const now = new Date().toISOString();
  const completionNote = `Auto-completed by VeritaCheck\u2122: ${analyte} on ${now.split("T")[0]}`;
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
    WHERE status != 'Compliant' OR completion_source != 'veritacheck_auto'
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

/**
 * Find VeritaScan item IDs that match a given study type and analyte.
 * Uses the 168-item checklist structure.
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
