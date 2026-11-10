// server/policyApprovedVersion.ts
//
// BUG-151 (found 2026-11-09 building the share link): uploading a new version points the document at the new file and sets it
// back to draft. A limited Staff login and the share link read only an approved or review-overdue document's current version,
// so from the upload until the revision was approved they read nothing, though the earlier version was still the approved
// procedure. 42 CFR 493.1251(a) has the procedure manual available to laboratory personnel.
//
// The fix records which version is the approved one, policy_documents.approved_version_id, on every path that makes a
// document approved:
//   - the last approval step (decideApprovalStep in routes.ts: the editor screen and the staff login tile);
//   - a completed IQCP registering its document (routes.ts, PATCH iqcp plans);
//   - the bulk load from a prior system (server/veritadcBulkLoad.ts).
//
// A reader limited to approved procedures (a limited Staff login, the staff portal's lookup and reads, a share link) reads:
//   - the current version while the document is approved or review-overdue ('expired'), as before;
//   - the recorded approved version while a newer revision is a draft or in review;
//   - nothing for a retired document, or a draft or in-review one with no approved version recorded, as before.
// Editors and admins read the working revision as before; nothing here touches their routes.
//
// The column is added once, and in the same step a document that is approved or review-overdue right then records its current
// version (that version is the approved one). A document already in draft or review is left alone and only counted: which
// earlier version was approved isn't recorded anywhere it could be read back for certain.

export const APPROVED_STATUSES = ["approved", "expired"] as const;
export const REVISION_STATUSES = ["draft", "in_review"] as const;

export type ApprovedReadDoc = {
  status: string;
  archived_at?: string | null;
  current_version_id: number | null;
  approved_version_id?: number | null;
};

/** The version a reader limited to approved procedures reads, or null when it reads nothing. */
export function approvedReadVersionId(doc: ApprovedReadDoc | null | undefined): number | null {
  if (!doc || doc.archived_at) return null;
  if ((APPROVED_STATUSES as readonly string[]).includes(doc.status)) return doc.current_version_id ?? null;
  if ((REVISION_STATUSES as readonly string[]).includes(doc.status)) return doc.approved_version_id ?? null;
  return null;
}

/** True when that reader is shown the recorded approved version because a newer revision is a draft or in review. */
export function revisionInProgress(doc: ApprovedReadDoc | null | undefined): boolean {
  return !!doc && !doc.archived_at && (REVISION_STATUSES as readonly string[]).includes(doc.status) && doc.approved_version_id != null;
}

/** The same rule in SQL, for a policy_documents row aliased `a`: the version id read, or NULL. */
export function approvedReadVersionSql(a = "d"): string {
  return `(CASE WHEN ${a}.archived_at IS NOT NULL THEN NULL
               WHEN ${a}.status IN ('approved', 'expired') THEN ${a}.current_version_id
               WHEN ${a}.status IN ('draft', 'in_review') THEN ${a}.approved_version_id
               ELSE NULL END)`;
}

/** SQL: 1 when the row aliased `a` is a revision in progress over a recorded approved version, else 0. */
export function revisionInProgressSql(a = "d"): string {
  return `(CASE WHEN ${a}.archived_at IS NULL AND ${a}.status IN ('draft', 'in_review') AND ${a}.approved_version_id IS NOT NULL THEN 1 ELSE 0 END)`;
}

// An inspector's surveyor link (BUG-152, 2026-11-10; routes.ts "Phase 8" and the carried face page in veritadcBulkLoad.ts).
// It always showed an approved document's current version, and still does. Before this fix a document dropped out of the
// inspector's view from the moment a new version was uploaded until that revision was approved, though the earlier version
// was still the approved procedure. Now, while a newer revision is a draft or in review, it shows the version recorded as
// approved, as the share link and a limited Staff login do. Left as it was: a review-overdue ('expired') document isn't in
// the surveyor view (the other readers show it), and an approved document's reads don't check archived_at. A draft or in-review
// document with no recorded approved version still shows nothing.

/** True when the surveyor link shows this document. */
export function surveyorReads(doc: ApprovedReadDoc | null | undefined): boolean {
  return !!doc && (doc.status === "approved" || revisionInProgress(doc));
}

/** The version the surveyor link shows for this document, or null. */
export function surveyorReadVersionId(doc: ApprovedReadDoc | null | undefined): number | null {
  if (!doc) return null;
  if (doc.status === "approved") return doc.current_version_id ?? null;
  return revisionInProgress(doc) ? doc.approved_version_id ?? null : null;
}

/** The same rule in SQL, for a policy_documents row aliased `a`: the version id the surveyor link shows, or NULL. */
export function surveyorReadVersionSql(a = "d"): string {
  return `(CASE WHEN ${a}.status = 'approved' THEN ${a}.current_version_id
               WHEN ${revisionInProgressSql(a)} = 1 THEN ${a}.approved_version_id
               ELSE NULL END)`;
}

/**
 * The one-time backfill, run in the step that adds the column. A document approved or review-overdue right now records its
 * current version. Documents in draft or review are counted, never guessed: `withEarlierVersion` is how many of those have
 * more than one version, the ones whose staff reads stay as they were until their revision is approved.
 */
export function backfillApprovedVersions(sqlite: any): { recorded: number; inRevision: number; withEarlierVersion: number } {
  const recorded = sqlite
    .prepare(
      `UPDATE policy_documents SET approved_version_id = current_version_id
        WHERE approved_version_id IS NULL AND current_version_id IS NOT NULL AND status IN ('approved', 'expired')`
    )
    .run().changes as number;
  const left = sqlite
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN (SELECT COUNT(*) FROM policy_versions v WHERE v.document_id = d.id) > 1 THEN 1 ELSE 0 END), 0) AS earlier
         FROM policy_documents d
        WHERE d.approved_version_id IS NULL AND d.status IN ('draft', 'in_review') AND d.archived_at IS NULL`
    )
    .get() as { n: number; earlier: number };
  return { recorded, inRevision: Number(left.n), withEarlierVersion: Number(left.earlier) };
}
