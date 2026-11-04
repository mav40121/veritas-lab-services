// server/policySignatureStatus.ts
//
// Who has signed one VeritaDC document (Michael 2026-11-04, Q161 = 1; CAP GEN.75400 asks for a roster with dates of participation).
// A person can sign two ways, and each used to know nothing about the other:
//   - a Staff login signs under My sign-offs (staff_portal_policy_signatures, keyed on the roster person);
//   - someone assigned the document attests in VeritaDC (policy_attestations, keyed on the user).
// So a Staff login who signed stayed Pending on their assignment, someone who attested still looked unsigned under My sign-offs, and
// people nobody assigned appeared nowhere. Here the two records are read together, against the VeritaStaff roster.
//
// A signature closes an assignment only for the same person, and only on the version assigned or a later one (or an earlier minor
// revision, in a lab that carries those forward). A lab's passing-quiz gate still holds: a signature doesn't answer a required quiz.
import { versionLabel } from "../shared/policyVersion";
import { signatureStillCurrent, carriedStaffSignature } from "./policyMinorRevision";
import { writeAuditLog } from "./veritapolicyApproval";

export type RosterSignStatus = "signed" | "older_version" | "not_signed";

/** Close open assignments a Staff login's existing signature already answers. Safe to repeat. Returns how many closed. */
export function closeAttestationsCoveredByStaffSignatures(sqlite: any, labId: number, scope: { documentId?: number; userId?: number }): number {
  const filters = [scope.documentId != null ? "AND a.document_id = ?" : "", scope.userId != null ? "AND a.assigned_to_user_id = ?" : ""].join(" ");
  const params = [labId, ...(scope.documentId != null ? [scope.documentId] : []), ...(scope.userId != null ? [scope.userId] : [])];
  const open = sqlite.prepare(
    `SELECT a.id, a.document_id, a.version_id, a.assigned_to_user_id, a.quiz_score, d.quiz_requires_pass, d.quiz_pass_threshold, us.staff_employee_id
       FROM policy_attestations a
       JOIN policy_documents d ON d.id = a.document_id
       JOIN user_seats us ON us.seat_user_id = a.assigned_to_user_id AND us.lab_id = d.lab_id
        AND us.seat_type = 'staff_portal' AND us.status = 'active' AND us.staff_employee_id IS NOT NULL
      WHERE d.lab_id = ? AND a.completed_at IS NULL ${filters}`
  ).all(...params) as any[];
  let closed = 0;
  for (const a of open) {
    if (a.quiz_requires_pass === 1 && a.quiz_pass_threshold != null && (a.quiz_score == null || a.quiz_score < a.quiz_pass_threshold)) continue;
    const signatures = sqlite.prepare(
      `SELECT s.id, s.version_id, s.signed_at, s.signed_document_hash, s.typed_signature, s.ip_address, s.user_agent, v.file_hash_sha256 AS version_hash
         FROM staff_portal_policy_signatures s
         LEFT JOIN policy_versions v ON v.id = s.version_id
        WHERE s.lab_id = ? AND s.document_id = ? AND s.staff_employee_id = ?
        ORDER BY s.signed_at DESC, s.id DESC`
    ).all(labId, a.document_id, a.staff_employee_id) as any[];
    const sig = signatures.find((s) => s.version_id >= a.version_id || signatureStillCurrent(sqlite, labId, s.version_id, a.version_id));
    if (!sig) continue;
    // The record says what they actually signed and when, including a later version than the one assigned.
    const done = sqlite.prepare(
      `UPDATE policy_attestations
          SET completed_at = ?, version_id = ?, attested_document_hash = ?, typed_signature = ?, ip_address = ?, user_agent = ?
        WHERE id = ? AND completed_at IS NULL`
    ).run(sig.signed_at, sig.version_id, sig.signed_document_hash || sig.version_hash || "missing", sig.typed_signature, sig.ip_address, sig.user_agent, a.id);
    if (!done.changes) continue;
    closed += 1;
    writeAuditLog(sqlite, {
      labId,
      documentId: a.document_id,
      userId: a.assigned_to_user_id,
      action: "attestation_completed",
      details: { attestation_id: a.id, version_id: sig.version_id, assigned_version_id: a.version_id, via: "staff_login", staff_signature_id: sig.id },
      ipAddress: sig.ip_address,
      userAgent: sig.user_agent,
    });
  }
  return closed;
}

/** The newest completed attestation by this user that still counts for the document's current version, or null. */
export function attestationStillCurrent(sqlite: any, labId: number, documentId: number, userId: number, currentVersionId: number | null): { completed_at: string; typed_signature: string | null; version_id: number } | null {
  if (currentVersionId == null) return null;
  const rows = sqlite.prepare(
    "SELECT completed_at, typed_signature, version_id FROM policy_attestations WHERE document_id = ? AND assigned_to_user_id = ? AND completed_at IS NOT NULL ORDER BY completed_at DESC, id DESC"
  ).all(documentId, userId) as any[];
  return rows.find((r) => signatureStillCurrent(sqlite, labId, r.version_id, currentVersionId)) ?? null;
}

/** Approved documents a Staff login still has to sign, by the same rules as their My sign-offs list. */
export function unsignedDocumentsForStaff(sqlite: any, labId: number, staffEmployeeId: number, userId: number): Array<{ document_id: number; title: string; effective_date: string | null }> {
  const rows = sqlite.prepare(
    `SELECT d.id AS document_id, d.title, d.effective_date, d.current_version_id
       FROM policy_documents d
      WHERE d.lab_id = ? AND d.status = 'approved' AND d.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM policy_doc_type_settings ts WHERE ts.lab_id = d.lab_id AND ts.doc_type = d.doc_type AND ts.requires_read_and_sign = 0)
        AND NOT EXISTS (SELECT 1 FROM staff_portal_policy_signatures s WHERE s.document_id = d.id AND s.version_id = d.current_version_id AND s.staff_employee_id = ?)
      ORDER BY d.title`
  ).all(labId, staffEmployeeId) as any[];
  return rows
    .filter((d) => !carriedStaffSignature(sqlite, labId, d.document_id, staffEmployeeId, d.current_version_id) && !attestationStillCurrent(sqlite, labId, d.document_id, userId, d.current_version_id))
    .slice(0, 100)
    .map((d) => ({ document_id: d.document_id, title: d.title, effective_date: d.effective_date }));
}

/** Every active roster person and where they stand on this document's current version. Not signed first, then by name. */
export function documentSignatureStatus(sqlite: any, labId: number, doc: { id: number; current_version_id: number | null }, staffLabId: number | null) {
  const employees = staffLabId == null ? [] : sqlite.prepare(
    "SELECT id, first_name, last_name, middle_initial, title, login_user_id FROM staff_employees WHERE lab_id = ? AND status = 'active'"
  ).all(staffLabId) as any[];
  const seats = sqlite.prepare(
    "SELECT staff_employee_id, seat_user_id FROM user_seats WHERE lab_id = ? AND seat_type = 'staff_portal' AND status = 'active' AND staff_employee_id IS NOT NULL AND seat_user_id IS NOT NULL"
  ).all(labId) as any[];
  const seatBy = new Map<number, number>(seats.map((s) => [s.staff_employee_id, s.seat_user_id]));
  const labelFor = (versionId: number | null): string | null => {
    if (versionId == null) return null;
    const v = sqlite.prepare("SELECT version_number, version_major, version_minor FROM policy_versions WHERE id = ?").get(versionId) as any;
    return v ? versionLabel(v) : null;
  };
  const people = employees.map((e) => {
    const users = [e.login_user_id, seatBy.get(e.id)].filter((u): u is number => u != null);
    const signed = (sqlite.prepare(
      "SELECT version_id, signed_at FROM staff_portal_policy_signatures WHERE lab_id = ? AND document_id = ? AND staff_employee_id = ?"
    ).all(labId, doc.id, e.id) as any[]).map((s) => ({ version_id: s.version_id, at: s.signed_at, how: "Staff login" }));
    const attested = users.flatMap((u) => (sqlite.prepare(
      "SELECT version_id, completed_at FROM policy_attestations WHERE document_id = ? AND assigned_to_user_id = ? AND completed_at IS NOT NULL"
    ).all(doc.id, u) as any[]).map((a) => ({ version_id: a.version_id, at: a.completed_at, how: "Attestation" })));
    // A Staff login signature that closed an assignment appears in both; it is the same act, so the signature wins the tie.
    const all = [...signed, ...attested].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const current = all.find((x) => signatureStillCurrent(sqlite, labId, x.version_id, doc.current_version_id));
    const newest = current ?? all[0] ?? null;
    const status: RosterSignStatus = current ? "signed" : newest ? "older_version" : "not_signed";
    return {
      employee_id: e.id,
      name: [e.last_name, e.first_name].filter(Boolean).join(", ") + (e.middle_initial ? ` ${e.middle_initial}.` : ""),
      title: e.title ?? null,
      has_login: users.length > 0,
      status,
      signed_at: newest?.at ?? null,
      version_label: labelFor(newest?.version_id ?? null),
      carried_forward: !!current && current.version_id !== doc.current_version_id,
      how: newest?.how ?? null,
    };
  });
  const rank: Record<RosterSignStatus, number> = { not_signed: 0, older_version: 1, signed: 2 };
  people.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
  return {
    people,
    summary: {
      total: people.length,
      signed: people.filter((p) => p.status === "signed").length,
      older_version: people.filter((p) => p.status === "older_version").length,
      not_signed: people.filter((p) => p.status === "not_signed").length,
      no_login: people.filter((p) => !p.has_login).length,
    },
  };
}
