// server/policyMinorRevision.ts
//
// VeritaDC minor revisions (Michael 2026-11-03, Q154 = 1). Each lab chooses (labs.dc_minor_revision_carry_forward):
//   - re-sign (NULL/0, the default and the behavior before this setting): a signature or completed attestation counts only
//     for the exact version signed, so every new version goes back to everyone;
//   - carry forward (1): a signature on a version still counts after a MINOR revision of it (same major number, so 1.0
//     covers 1.1 and 1.2 but never 2.0), and the staff list says the document changed since they signed.
// A version saved before major/minor existed has major = version_number (shared/policyVersion.ts).
import { versionLabel } from "../shared/policyVersion";

const MAJOR_SQL = "COALESCE(version_major, version_number)";

export function labCarriesMinorRevisions(sqlite: any, labId: number): boolean {
  const row = sqlite.prepare("SELECT dc_minor_revision_carry_forward AS c FROM labs WHERE id = ?").get(labId) as { c?: number } | undefined;
  return row?.c === 1;
}

function majorOf(sqlite: any, versionId: number): number | null {
  const row = sqlite.prepare(`SELECT ${MAJOR_SQL} AS m FROM policy_versions WHERE id = ?`).get(versionId) as { m?: number } | undefined;
  return row?.m ?? null;
}

/** Whether a signature on signedVersionId still counts for the document's current version in this lab. */
export function signatureStillCurrent(sqlite: any, labId: number, signedVersionId: number | null, currentVersionId: number | null): boolean {
  if (signedVersionId == null || currentVersionId == null) return false;
  if (signedVersionId === currentVersionId) return true;
  if (!labCarriesMinorRevisions(sqlite, labId)) return false;
  const a = majorOf(sqlite, signedVersionId);
  return a != null && a === majorOf(sqlite, currentVersionId);
}

/**
 * For a staff login whose signature isn't on the current version: their latest signature on an earlier version of the
 * same major, when the lab carries minor revisions forward. null otherwise.
 */
export function carriedStaffSignature(
  sqlite: any,
  labId: number,
  documentId: number,
  staffEmployeeId: number,
  currentVersionId: number | null
): { id: number; signed_at: string; typed_signature: string | null; signed_version_label: string | null } | null {
  if (currentVersionId == null || !labCarriesMinorRevisions(sqlite, labId)) return null;
  const major = majorOf(sqlite, currentVersionId);
  if (major == null) return null;
  const row = sqlite
    .prepare(
      `SELECT sps.id, sps.signed_at, sps.typed_signature, sv.version_number, sv.version_major, sv.version_minor
         FROM staff_portal_policy_signatures sps
         JOIN policy_versions sv ON sv.id = sps.version_id
        WHERE sps.document_id = ? AND sps.staff_employee_id = ?
          AND COALESCE(sv.version_major, sv.version_number) = ?
        ORDER BY sps.signed_at DESC
        LIMIT 1`
    )
    .get(documentId, staffEmployeeId, major) as any;
  if (!row) return null;
  return { id: row.id, signed_at: row.signed_at, typed_signature: row.typed_signature, signed_version_label: versionLabel(row) };
}
