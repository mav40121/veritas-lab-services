// server/policyPriorSignature.ts
//
// Reads of policy_prior_signatures: a read-and-sign that happened in a lab's prior system (Michael 2026-11-06, Q207 = 1). The person doesn't
// owe what they already signed, and no screen implies they signed in VeritaAssure. These rows aren't staff_portal_policy_signatures on
// purpose: there is no typed name, password, IP address or file hash behind them, only a date from the prior system's report.
//
// A row with a version_id counts as signed for that version, by the lab's usual rule (signatureStillCurrent): a later major version asks
// again, and a later minor one follows the lab's minor-revision setting. A row with no version_id is history only (an earlier major).
// A row with no staff_employee_id is someone not on this lab's active roster: kept as history, owing nothing.

import { signatureStillCurrent } from "./policyMinorRevision";

export type PriorSignature = {
  id: number;
  version_id: number | null;
  staff_employee_id: number | null;
  person_state: string;
  source_system: string;
  source_name: string;
  source_credentials: string | null;
  source_version: string;
  signed_on: string;
};

const COLUMNS = "id, version_id, staff_employee_id, person_state, source_system, source_name, source_credentials, source_version, signed_on";

/** This person's carried signature that still answers the document's current version, newest first, or null. */
export function priorSignatureStillCurrent(sqlite: any, labId: number, documentId: number, staffEmployeeId: number | null, currentVersionId: number | null): PriorSignature | null {
  if (staffEmployeeId == null || currentVersionId == null) return null;
  const rows = sqlite.prepare(
    `SELECT ${COLUMNS} FROM policy_prior_signatures WHERE lab_id = ? AND document_id = ? AND staff_employee_id = ? AND version_id IS NOT NULL ORDER BY signed_on DESC, id DESC`
  ).all(labId, documentId, staffEmployeeId) as PriorSignature[];
  return rows.find((r) => signatureStillCurrent(sqlite, labId, r.version_id, currentVersionId)) ?? null;
}

/** Every carried signature on one person for one document, for the roster view. */
export function priorSignaturesOfPerson(sqlite: any, labId: number, documentId: number, staffEmployeeId: number): PriorSignature[] {
  return sqlite.prepare(`SELECT ${COLUMNS} FROM policy_prior_signatures WHERE lab_id = ? AND document_id = ? AND staff_employee_id = ?`).all(labId, documentId, staffEmployeeId) as PriorSignature[];
}

/** Every carried signature on a document, for the report and the inspector link. */
export function priorSignaturesOfDocument(sqlite: any, labId: number, documentId: number): PriorSignature[] {
  return sqlite.prepare(
    `SELECT ${COLUMNS} FROM policy_prior_signatures WHERE lab_id = ? AND document_id = ? ORDER BY signed_on DESC, source_name COLLATE NOCASE`
  ).all(labId, documentId) as PriorSignature[];
}

/** How many carried signatures each roster person holds in a lab, for the compliance page. */
export function priorCountsByPerson(sqlite: any, labId: number): Map<number, { count: number; last: string }> {
  const rows = sqlite.prepare(
    `SELECT staff_employee_id AS id, COUNT(*) AS n, MAX(signed_on) AS last FROM policy_prior_signatures
      WHERE lab_id = ? AND staff_employee_id IS NOT NULL AND version_id IS NOT NULL GROUP BY staff_employee_id`
  ).all(labId) as { id: number; n: number; last: string }[];
  return new Map(rows.map((r) => [r.id, { count: Number(r.n), last: r.last }]));
}

/** The words every screen and report uses, so none of them can read as a signature in VeritaAssure. */
export const priorHow = (sourceSystem: string) => `Carried over from ${sourceSystem}`;
