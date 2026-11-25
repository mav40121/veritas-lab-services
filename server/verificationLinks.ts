// server/verificationLinks.ts
//
// BUG-200 (2026-11-24): a VeritaCheck verification links only its own laboratory's records. One rule, asked when a link is saved and
// again by every reader:
//   - a study or a VeritaMap analyzer is the verification's own when both are in the same laboratory; where either has no laboratory,
//     the owner rule decides (one owner's records, or the laboratory's owner's)
//   - an analyte is the verification's own when it is on that verification
// An id that isn't is answered exactly as one that doesn't exist. A slot already holding one reads as not linked, with "Linked study
// not available" and no name, type or result, on screen, in the package PDF and in the records export. Nothing stored is changed.
// A new id a slot can hold needs its line in SLOT_LINKS; without one the save is refused (linkIsOwn) and
// tests/integration/verification-slot-links.test.ts fails.

import { ownerMatchCounts } from "./labAccessGuard";

type SqliteLike = any;
interface Verification { id: number; lab_id: number | null; user_id: number }

export const LINKED_STUDY_UNAVAILABLE = "Linked study not available";
/** What a slot save has always answered for a study or analyte that isn't there. */
export const LINK_NOT_FOUND = { error: "That study or analyte no longer exists (it may have been deleted). Refresh the page and try again." };

/** SQL: row `r` (a study, a map) goes with row `v` (a verification). Aliases only, never user text. */
export function sameLabOrOwnerSql(r: string, v: string): string {
  return `(CASE WHEN ${r}.lab_id IS NOT NULL AND ${v}.lab_id IS NOT NULL THEN ${r}.lab_id = ${v}.lab_id
    ELSE ${r}.user_id = ${v}.user_id OR ${r}.user_id = (SELECT slo_l.owner_user_id FROM labs slo_l WHERE slo_l.id = ${v}.lab_id) END)`;
}

/** SQL: slot `vs` of verification `v` is linked to a study of its own. */
export function slotLinkedSql(vs: string, v: string): string {
  return `EXISTS (SELECT 1 FROM studies sl_s WHERE sl_s.id = ${vs}.study_id AND ${sameLabOrOwnerSql("sl_s", v)})`;
}

/** SQL: how many of verification `v`'s slots passed (1) or failed (0). A slot whose study isn't available has no result of its own. */
export function slotResultCountSql(v: string, passed: 0 | 1): string {
  return `(SELECT COUNT(*) FROM veritacheck_verification_studies src_vs WHERE src_vs.verification_id = ${v}.id AND src_vs.passed = ${passed}
    AND (src_vs.study_id IS NULL OR src_vs.manual_method = 1 OR ${slotLinkedSql("src_vs", v)}))`;
}

const positiveId = (value: unknown): number | null => {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** A verification's own VeritaMap analyzer, or null. */
export function ownMapInstrument(sqlite: SqliteLike, v: { lab_id?: unknown; user_id?: unknown }, id: unknown): any | null {
  const n = positiveId(id);
  if (n == null) return null;
  return sqlite.prepare(
    `SELECT i.id, i.instrument_name, i.nickname, i.serial_number FROM veritamap_instruments i JOIN veritamap_maps m ON m.id = i.map_id
       JOIN (SELECT @lab AS lab_id, @user AS user_id) v ON ${sameLabOrOwnerSql("m", "v")} WHERE i.id = @id`
  ).get({ lab: positiveId(v.lab_id), user: positiveId(v.user_id), id: n }) ?? null;
}

/** The verification's own study, and one this person may read there: edit in its laboratory is already decided; with no laboratory, their own account's. */
function studyIsOwn(sqlite: SqliteLike, req: any, v: Verification, id: number): boolean {
  const s = sqlite.prepare(
    `SELECT s.lab_id, s.user_id FROM studies s JOIN veritacheck_verifications v ON v.id = ? WHERE s.id = ? AND ${sameLabOrOwnerSql("s", "v")}`
  ).get(v.id, id) as { lab_id: number | null; user_id: number | null } | undefined;
  if (!s) return false;
  if (s.lab_id != null && v.lab_id != null) return true;
  const ownerId = Number(req.ownerUserId ?? req.userId);
  return Number(s.user_id) === ownerId && ownerMatchCounts(sqlite, req.userId, ownerId, s.lab_id);
}

/** What a slot save may set. Every id among them has its check in SLOT_LINKS. */
export const SLOT_COLUMNS = ["study_id", "analyte", "sample_count", "clsi_protocol", "design_rationale", "result_summary", "passed", "analyte_id", "scope", "manual_method", "manual_note", "manual_evidence_url"];
export const SLOT_LINKS: Record<string, (sqlite: SqliteLike, req: any, v: Verification, id: number) => boolean> = {
  study_id: studyIsOwn,
  analyte_id: (sqlite, _req, v, id) => !!sqlite.prepare("SELECT 1 FROM veritacheck_verification_analytes WHERE id = ? AND verification_id = ?").get(id, v.id),
};
export const isIdColumn = (column: string): boolean => /(_id|Id)s?$/.test(column);

/** May this slot hold this id? null clears the link. An id column with no check never holds anything. */
export function linkIsOwn(sqlite: SqliteLike, req: any, v: Verification, column: string, value: unknown): boolean {
  if (value === null) return true;
  const id = positiveId(value), check = SLOT_LINKS[column];
  return id != null && !!check && check(sqlite, req, v, id);
}

/** The slot with nothing from a study that isn't available. An attestation by manual method is the person's own and stays. */
function withoutStudy(slot: any): any {
  return { ...slot, study_id: null, passed: slot.manual_method === 1 ? slot.passed : null, result_summary: null, sample_count: null, linked_study_unavailable: true };
}

/** A verification's slots, with `studyColumns` (SQL on alias s) from the linked study when it is the verification's own. */
export function verificationSlots(sqlite: SqliteLike, verificationId: unknown, studyColumns: string): any[] {
  const rows = sqlite.prepare(
    `SELECT vs.*, ${studyColumns}, (vs.study_id IS NOT NULL AND s.id IS NULL) AS no_study
       FROM veritacheck_verification_studies vs
       JOIN veritacheck_verifications v ON v.id = vs.verification_id
       LEFT JOIN studies s ON s.id = vs.study_id AND ${sameLabOrOwnerSql("s", "v")}
      WHERE vs.verification_id = ?
      ORDER BY vs.element, vs.id`
  ).all(verificationId) as any[];
  return rows.map(({ no_study, ...slot }) => (no_study ? withoutStudy(slot) : slot));
}

/** True when the slot holds a study that isn't available. */
export function slotStudyUnavailable(sqlite: SqliteLike, slotId: unknown): boolean {
  return !!sqlite.prepare(
    `SELECT 1 FROM veritacheck_verification_studies vs JOIN veritacheck_verifications v ON v.id = vs.verification_id
      WHERE vs.id = ? AND vs.study_id IS NOT NULL AND NOT ${slotLinkedSql("vs", "v")}`
  ).get(slotId);
}

/** The records export's rows of the slots table (server/exportAll.ts). */
export function slotRowsForExport(sqlite: SqliteLike, rows: any[]): any[] {
  return rows.map((r) => {
    if (r.study_id == null || !slotStudyUnavailable(sqlite, r.id)) return r;
    const { linked_study_unavailable, ...shown } = withoutStudy(r);
    return { ...shown, study_id: LINKED_STUDY_UNAVAILABLE };
  });
}

/** Counts and laboratory ids only, for GET /api/admin/veritacheck/foreign-slot-counts. Writes nothing. */
export function foreignSlotCounts(sqlite: SqliteLike) {
  const totals = { verifications: 0, linkedSlots: 0, foreignSlots: 0, sameOwner: 0, otherOwner: 0, missingStudies: 0, foreignAnalyzers: 0, missingAnalyzers: 0, analytesNotOnPackage: 0 };
  const byLab: Record<string, { isDemo: boolean | null; foreignSlots: number; sameOwner: number; otherOwner: number; foreignAnalyzers: number; analytesNotOnPackage: number }> = {};
  const lab = (id: number | null, isDemo: number | null) => (byLab[String(id ?? "none")] ??= { isDemo: id == null || isDemo == null ? null : isDemo === 1, foreignSlots: 0, sameOwner: 0, otherOwner: 0, foreignAnalyzers: 0, analytesNotOnPackage: 0 });
  totals.verifications = Number(sqlite.prepare("SELECT COUNT(*) AS n FROM veritacheck_verifications").get().n);
  const slots = sqlite.prepare(
    `SELECT v.lab_id, l.is_demo, s.id AS study, ${sameLabOrOwnerSql("s", "v")} AS own,
            COALESCE(l.owner_user_id, v.user_id) AS v_owner, COALESCE(sl.owner_user_id, s.user_id) AS s_owner
       FROM veritacheck_verification_studies vs JOIN veritacheck_verifications v ON v.id = vs.verification_id
       LEFT JOIN labs l ON l.id = v.lab_id LEFT JOIN studies s ON s.id = vs.study_id LEFT JOIN labs sl ON sl.id = s.lab_id
      WHERE vs.study_id IS NOT NULL`
  ).all() as any[];
  for (const r of slots) {
    totals.linkedSlots++;
    if (r.study == null) { totals.missingStudies++; continue; }
    if (r.own) continue;
    const key = r.s_owner != null && r.s_owner === r.v_owner ? "sameOwner" : "otherOwner", at = lab(r.lab_id, r.is_demo);
    totals.foreignSlots++; totals[key]++;
    at.foreignSlots++; at[key]++;
  }
  const analyzers = sqlite.prepare(
    `SELECT v.lab_id, l.is_demo, i.id AS analyzer, ${sameLabOrOwnerSql("m", "v")} AS own
       FROM veritacheck_verifications v LEFT JOIN labs l ON l.id = v.lab_id
       LEFT JOIN veritamap_instruments i ON i.id = v.map_instrument_id LEFT JOIN veritamap_maps m ON m.id = i.map_id
      WHERE v.map_instrument_id IS NOT NULL`
  ).all() as any[];
  for (const r of analyzers) {
    if (r.analyzer == null) totals.missingAnalyzers++;
    else if (!r.own) { totals.foreignAnalyzers++; lab(r.lab_id, r.is_demo).foreignAnalyzers++; }
  }
  const analytes = sqlite.prepare(
    `SELECT v.lab_id, l.is_demo FROM veritacheck_verification_studies vs JOIN veritacheck_verifications v ON v.id = vs.verification_id
       LEFT JOIN labs l ON l.id = v.lab_id
      WHERE vs.analyte_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM veritacheck_verification_analytes a WHERE a.id = vs.analyte_id AND a.verification_id = vs.verification_id)`
  ).all() as any[];
  for (const r of analytes) { totals.analytesNotOnPackage++; lab(r.lab_id, r.is_demo).analytesNotOnPackage++; }
  return { ...totals, byLab };
}
