// server/studyPdf.ts
//
// One VeritaCheck study report PDF, built on the server (2026-10-16) for "Download all records" (export-all version 2).
// It runs the same steps as POST /api/generate-pdf:
//   - the study is shaped by studyRowToClient (moved here from routes.ts; the study routes use it too)
//   - its results come from client/src/lib/studyResults.ts, the same function the results page uses
//   - the lab name, CLIA number, accreditation standards and license band come from the lab
//   - VeritaMap-linked instruments are resolved by resolveInstrumentDisplay (shared with the route)
// So a PDF in the export shows exactly what the director sees on screen. Unlike the route, it never sets the lab's
// reporting locks: exporting records is not printing a report.

import { generatePDFBuffer } from "./pdfReport";
import { computeStudyResults } from "../client/src/lib/studyResults";
import { labLocalDate } from "./dateLocal";

export function studyRowToClient(row: any): any {
  if (!row) return row;
  return {
    id: row.id,
    userId: row.user_id,
    createdByUserId: row.created_by_user_id,
    testName: row.test_name,
    instrument: row.instrument,
    analyst: row.analyst,
    date: row.date,
    studyType: row.study_type,
    cliaAllowableError: row.clia_allowable_error,
    dataPoints: row.data_points,
    instruments: row.instruments,
    status: row.status,
    teaIsPercentage: row.tea_is_percentage,
    teaUnit: row.tea_unit,
    cliaAbsoluteFloor: row.clia_absolute_floor,
    cliaAbsoluteUnit: row.clia_absolute_unit,
    // Frozen at write time. NULL on legacy rows = render the old
    // value-only TEa line (no parenthetical).
    cliaPresetLabel: row.clia_preset_label,
    // Director's explicit Coverage attribution (Phase 1/2 allocation work).
    coverageAnalyte: row.coverage_analyte,
    instrumentMeta: row.instrument_meta,
    // Phase 1 simple-precision parity fields (added 2026-05-20). Mapped
    // from snake_case DB columns to camelCase so the client + PDF
    // builder see them on lab-scoped GETs (which use raw SQL rather
    // than drizzle's auto-mapped Study type).
    vendorSd: row.vendor_sd,
    vendorSdConcentration: row.vendor_sd_concentration,
    targetMean: row.target_mean,
    targetCv: row.target_cv,
    // EE Day 2 QC traceability fields (2026-05-20).
    controlLot: row.control_lot,
    reagentLot: row.reagent_lot,
    comment: row.comment,
    resultUnits: row.result_units,
    material: row.material,
    // 2026-06-09 (Michael L feedback): optional per-study AMR.
    // Blank values disable the coverage analysis; renderer
    // short-circuits via shouldRenderAmrCoverage.
    amrLow: row.amr_low,
    amrHigh: row.amr_high,
    amrUnits: row.amr_units,
    censoringPolicy: row.censoring_policy,
    lifecycle_state: row.lifecycle_state,
    // 2026-07-31 (San Carlos): the sign-off identity fields were added to the
    // studies table + written by the finalize handler, but never mapped here,
    // so every lab-scoped GET dropped them. Result: the study page rendered
    // "Signed Off by [blank] on [blank]" and the PDF director-review block had
    // no signer to print, even though the DB held finalized_signature.
    finalized_at: row.finalized_at,
    finalized_by_user_id: row.finalized_by_user_id,
    finalized_signature: row.finalized_signature,
    amends_study_id: row.amends_study_id,
    archived_at: row.archived_at,
    archived_by_user_id: row.archived_by_user_id,
    archive_reason: row.archive_reason,
    verdict_override_justification: row.verdict_override_justification,
    verdict_override_at: row.verdict_override_at,
    verdict_override_by_user_id: row.verdict_override_by_user_id,
    verdict_before_override: row.verdict_before_override,
    // Sign-off group membership. Needed by the My Studies list so a study
    // already assigned to a VeritaCheck sign-off group shows its group at a
    // glance (was previously dropped here, so the client's "In group" cue
    // never rendered even after a study was added).
    signoff_group_id: row.signoff_group_id,
    createdAt: row.created_at,
    lab_id: row.lab_id,
  };
}

export function resolveInstrumentDisplay(sqlite: any, instrumentMeta: any): Record<string, { model: string; nickname: string | null; serial_number: string | null }> | null {
  try {
    const meta = typeof instrumentMeta === "string" ? JSON.parse(instrumentMeta) : instrumentMeta;
    const resolved: Record<string, { model: string; nickname: string | null; serial_number: string | null }> = {};
    for (const [idx, entry] of Object.entries(meta || {}) as [string, any][]) {
      if (entry?.instrument_id) {
        const row = sqlite.prepare("SELECT instrument_name, nickname, serial_number FROM veritamap_instruments WHERE id = ?").get(entry.instrument_id) as any;
        if (row) {
          resolved[idx] = { model: row.instrument_name, nickname: row.nickname || null, serial_number: row.serial_number || null };
        } else {
          resolved[idx] = { model: entry.model, nickname: entry.nickname, serial_number: entry.serial_number };
        }
      }
    }
    return resolved;
  } catch {
    return null;
  }
}

const TYPE_LABEL: Record<string, string> = { cal_ver: "CalVer", cal_ver_correlation: "CalVerCorrelation", precision: "Precision", method_comparison: "MethodComp", lot_to_lot: "LotToLot", pt_coag: "PTCoag", qc_range: "QCRange", multi_analyte_coag: "MultiAnalyteCoag", ref_interval: "RefInterval", sensitivity: "Sensitivity", carryover: "Carryover", accuracy_bias: "AccuracyBias", linearity: "Linearity", reportable_range: "ReportableRange" };

export function studyPdfFilename(study: { studyType: string; testName: string; date: string }): string {
  return `VeritaCheck_${TYPE_LABEL[study.studyType] || "Study"}_${String(study.testName || "Study").replace(/\s+/g, "_")}_${study.date}.pdf`;
}

// lab: the labs row; owner: the lab owner's users row (for the license band).
export async function buildStudyPdf(sqlite: any, row: any, lab: any, owner: any): Promise<{ buffer: Buffer; filename: string }> {
  const study = studyRowToClient(row);
  const results = computeStudyResults(study);
  if (lab?.lab_name) study._labName = lab.lab_name;
  if (study.instrumentMeta) {
    const resolved = resolveInstrumentDisplay(sqlite, study.instrumentMeta);
    if (resolved) study._instrumentDisplay = resolved;
  }
  const standards: string[] = [];
  if (lab?.accreditation_cap) standards.push("CAP");
  if (lab?.accreditation_tjc) standards.push("TJC");
  if (lab?.accreditation_cola) standards.push("COLA");
  if (lab?.accreditation_aabb) standards.push("AABB");
  const licenseCtx = owner?.email
    ? { licensee: lab?.lab_name || owner.name || owner.email, email: owner.email, plan: owner.plan, issueDate: labLocalDate(new Date().toISOString()), isDemo: !!lab?.is_demo }
    : null;
  const buffer = await generatePDFBuffer(study, results, lab?.clia_number || undefined, (standards.length ? standards : undefined) as any, licenseCtx);
  return { buffer, filename: studyPdfFilename(study) };
}
