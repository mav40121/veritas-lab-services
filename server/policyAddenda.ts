// server/policyAddenda.ts
//
// A laboratory's own addenda to a system document (B1; server/policySharedDocuments.ts adds and removes them). Each is a VeritaDC
// document of that laboratory, with its own versions and approval. Reads only, used by every place the document itself opens, so an
// addendum is never read more widely than the document and never at a version the reader of the document wouldn't get.

import { approvedReadVersionId, revisionInProgress } from "./policyApprovedVersion";
import { versionLabel } from "../shared/policyVersion";

export interface AddendumRow {
  addendum_id: number; document_id: number; title: string; doc_number: string | null; status: string;
  version_id: number | null; version_label: string | null; file_format: string | null; in_force: boolean; revision_in_progress: boolean;
}

/** A document's addenda in reading and print order. `approvedOnly` is what a Staff login, an inspector or another module's link reads. */
export function addendaOf(sqlite: any, labId: number, documentId: number, approvedOnly: boolean): AddendumRow[] {
  const rows = sqlite.prepare(
    `SELECT a.id AS addendum_id, d.id AS document_id, d.title, d.doc_number, d.status, d.archived_at, d.current_version_id, d.approved_version_id
       FROM policy_addenda a JOIN policy_documents d ON d.id = a.addendum_document_id AND d.lab_id = a.lab_id
      WHERE a.lab_id = ? AND a.document_id = ? AND a.removed_at IS NULL AND d.archived_at IS NULL
      ORDER BY a.id`
  ).all(labId, documentId) as any[];
  return rows.flatMap((r) => {
    const inForce = approvedReadVersionId(r);
    const versionId = approvedOnly ? inForce : r.current_version_id ?? null;
    if (approvedOnly && versionId == null) return [];
    const v = versionId == null ? null : (sqlite.prepare("SELECT version_number, version_major, version_minor, file_format FROM policy_versions WHERE id = ? AND document_id = ?").get(versionId, r.document_id) as any);
    const revising = revisionInProgress(r);
    return [{
      addendum_id: r.addendum_id, document_id: r.document_id, title: r.title, doc_number: r.doc_number ?? null, status: approvedOnly && revising ? "approved" : r.status,
      version_id: versionId, version_label: versionLabel(v), file_format: v?.file_format ?? null, in_force: versionId != null && versionId === inForce, revision_in_progress: approvedOnly && revising,
    }];
  });
}

/** What an editor may assign for read-and-sign with the document: its addenda now, approved or not, of a type staff sign. */
export function addendaToAssign(sqlite: any, labId: number, documentId: number): Array<{ document_id: number; title: string; in_force: boolean }> {
  const noSign = sqlite.prepare(
    `SELECT 1 FROM policy_documents d JOIN policy_doc_type_settings ts ON ts.lab_id = d.lab_id AND ts.doc_type = d.doc_type
      WHERE d.id = ? AND ts.requires_read_and_sign = 0`
  );
  return addendaOf(sqlite, labId, documentId, false).filter((a) => !noSign.get(a.document_id)).map((a) => ({ document_id: a.document_id, title: a.title, in_force: a.in_force }));
}

/** An addendum by its place in the approved list, 1 first, for a link that names no document. Null for any other number. */
export function approvedAddendumAt(sqlite: any, labId: number, documentId: number, place: unknown): AddendumRow | null {
  const n = Number(place);
  return Number.isInteger(n) && n > 0 ? addendaOf(sqlite, labId, documentId, true)[n - 1] ?? null : null;
}
