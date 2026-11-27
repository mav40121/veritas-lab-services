// server/policyStaffSign.ts
//
// A Staff login's read-and-sign, signed for real (BUG-188, 2026-11-27; mock 3 and the owner's answers to its three questions).
// Before this, My sign-offs took a name already filled in and no password, stored whatever content hash the browser sent, and wrote
// no audit row. Now:
//  - the person signs with their own typed name and password, or with their hospital's sign-in asked for again at signing (Q2),
//    through server/eSignature.ts verifySigner (purpose policy_read_sign); a wrong password counts toward the sign-in lockout;
//  - the server makes the fingerprint from the version on file (readVersionBuffer, hashBuffer) and refuses a file that doesn't match
//    its record; a hash the browser sends is not read;
//  - each document signed gets its own signature row, saying how it was made (signed_with, signed_with_provider, and signed_together
//    when one signature signed several), and its own policy_audit_log row;
//  - a document is signed only at a version this person opened (Q1). An opening is recorded with its version (logStaffDocumentView,
//    the main app's render, approvedDocumentView); openings recorded before had no version and don't count;
//  - Sign several signs up to 100 with one name and password, as bulk approval does: each document stands alone, one that moved since
//    the list was shown is refused and the rest go.
// Signatures from before (a typed name, no password, a hash the browser sent) stay signed (Q3): their row has no signed_with, and the
// record says how they were made. Every reader that decides "signed" reads staff_portal_policy_signatures as before.
import { versionLabel } from "../shared/policyVersion";
import { BULK_APPROVE_MAX } from "../shared/policyNotices";
import { assignedDocumentIds } from "./policyReadSign";
import { closeAttestationsCoveredByStaffSignatures } from "./policySignatureStatus";
import { signedWithValues, type SignedWith } from "./eSignature";
import { hashBuffer, readVersionBuffer, writeAuditLog } from "./veritapolicyApproval";

/** Sign several takes as many as bulk approval does. */
export const STAFF_SIGN_SEVERAL_MAX = BULK_APPROVE_MAX;

export const REVISED_TEXT = "Policy revised since you started reading. Please reload and re-read.";
export const REVISED_IN_LIST_TEXT = "It was revised since the list was shown. Open it and read it again before you sign.";
export const NOT_OPENED_TEXT = "Open this version and read it before you sign it.";
export const FILE_MISMATCH_TEXT = "This file doesn't match its record, so it can't be signed. Tell your supervisor.";
export const SUPPORT_REFUSAL = { error: "Veritas support cannot read and sign a document. That belongs to the lab's own staff.", code: "VLS_SUPPORT_CANNOT_SIGN" };

export interface StaffSigner { labId: number; employeeId: number; userId: number; ip: string | null; userAgent: string | null }
export interface StaffSignItem { documentId: number; versionId: number }
export interface StaffSignRefusal { status: number; body: { error: string; code: string; expected_version_id?: number } }
type Check =
  | { ok: false; refusal: StaffSignRefusal; title: string | null; versionLabel: string | null }
  | { ok: true; title: string; versionLabel: string | null; existing: { id: number; signed_at: string } | null; hash: string | null };

// The version an opening was recorded at. A row from before BUG-188 has none (or no JSON at all) and reads as null.
const OPENED_VERSION_SQL = "CASE WHEN json_valid(details) THEN CAST(json_extract(details, '$.version_id') AS INTEGER) END";
const OPENING_ACTIONS = "('viewed', 'version_viewed')";

/** When this person last opened each version of the lab's documents: document id to (version id to when). */
export function openingsOf(sqlite: any, labId: number, userId: number): Map<number, Map<number, string>> {
  const rows = sqlite.prepare(
    `SELECT document_id, ${OPENED_VERSION_SQL} AS version_id, MAX(created_at) AS at FROM policy_audit_log
      WHERE lab_id = ? AND user_id = ? AND document_id IS NOT NULL AND action IN ${OPENING_ACTIONS}
      GROUP BY document_id, ${OPENED_VERSION_SQL}`
  ).all(labId, userId) as any[];
  const out = new Map<number, Map<number, string>>();
  for (const r of rows) {
    if (r.version_id == null) continue;
    const m = out.get(r.document_id) ?? new Map<number, string>();
    m.set(Number(r.version_id), String(r.at));
    out.set(r.document_id, m);
  }
  return out;
}

/** When this person last opened this version of the document, or null. */
export function openedAt(sqlite: any, labId: number, documentId: number, userId: number, versionId: number): string | null {
  const r = sqlite.prepare(
    `SELECT MAX(created_at) AS at FROM policy_audit_log
      WHERE lab_id = ? AND document_id = ? AND user_id = ? AND action IN ${OPENING_ACTIONS} AND ${OPENED_VERSION_SQL} = ?`
  ).get(labId, documentId, userId, versionId) as any;
  return r?.at ?? null;
}

const refuse = (status: number, error: string, code: string, extra: { expected_version_id?: number } = {}) => ({ status, body: { error, code, ...extra } });

/**
 * Whether this person can sign this document at this version now: what they would sign (the server's own hash of the file), the
 * signature already there, or the refusal. In the order the route always answered: not found, revised, not assigned, a type with no
 * read-and-sign; then already signed; then not opened at this version, and a file that doesn't match its record.
 */
export function staffSignCheck(sqlite: any, who: StaffSigner, item: StaffSignItem, o: { several?: boolean; assigned?: Set<number> } = {}): Check {
  const doc = sqlite.prepare(
    `SELECT d.id, d.title, d.current_version_id, v.version_number, v.version_major, v.version_minor, v.file_path, v.file_hash_sha256
       FROM policy_documents d LEFT JOIN policy_versions v ON v.id = d.current_version_id AND v.document_id = d.id
      WHERE d.id = ? AND d.lab_id = ? AND d.status = 'approved' AND d.archived_at IS NULL`
  ).get(item.documentId, who.labId) as any;
  if (!doc) return { ok: false, refusal: refuse(404, "Policy not found or not approved", "NOT_FOUND"), title: null, versionLabel: null };
  const label = doc.version_number != null ? versionLabel(doc) : null;
  const no = (refusal: StaffSignRefusal): Check => ({ ok: false, refusal, title: doc.title, versionLabel: label });
  if (doc.current_version_id !== item.versionId) {
    return no(refuse(409, o.several ? REVISED_IN_LIST_TEXT : REVISED_TEXT, "MOVED", { expected_version_id: doc.current_version_id }));
  }
  // Staff sign only what's assigned to them (Step D). Anything else they may read, but there is nothing to sign.
  const assigned = o.assigned ?? assignedDocumentIds(sqlite, who.labId, { employeeId: who.employeeId, userId: who.userId });
  if (!assigned.has(doc.id)) return no(refuse(403, "This document isn't assigned to you, so there's nothing to sign.", "NOT_ASSIGNED"));
  // A manual's assignment can cover a form or job aid the lab set to no read-and-sign. That stays readable, with nothing to sign.
  const noSign = sqlite.prepare(
    `SELECT 1 FROM policy_documents d JOIN policy_doc_type_settings ts ON ts.lab_id = d.lab_id AND ts.doc_type = d.doc_type
      WHERE d.id = ? AND ts.requires_read_and_sign = 0`
  ).get(doc.id);
  if (noSign) return no(refuse(409, "This document type doesn't need read-and-sign in this lab.", "TYPE_NO_READ_AND_SIGN"));
  const existing = sqlite.prepare(
    "SELECT id, signed_at FROM staff_portal_policy_signatures WHERE document_id = ? AND version_id = ? AND staff_employee_id = ?"
  ).get(doc.id, item.versionId, who.employeeId) as any;
  if (existing) return { ok: true, title: doc.title, versionLabel: label, existing, hash: null };
  // Q1: only a version they opened. The opening is recorded with the version it showed.
  if (!openedAt(sqlite, who.labId, doc.id, who.userId, item.versionId)) return no(refuse(409, NOT_OPENED_TEXT, "NOT_OPENED"));
  // The fingerprint is the server's own, from the file on record, never one a browser sends.
  let actual: string | null = null;
  try { actual = doc.file_path ? hashBuffer(readVersionBuffer(doc.file_path)) : null; } catch { actual = null; }
  if (!actual || actual !== doc.file_hash_sha256) {
    writeAuditLog(sqlite, {
      labId: who.labId, documentId: doc.id, userId: who.userId, action: "tamper_detected",
      details: { expected_hash: doc.file_hash_sha256, actual_hash: actual ?? "file missing", surface: "staff_sign", version_id: item.versionId },
      ipAddress: who.ip, userAgent: who.userAgent,
    });
    return no(refuse(409, FILE_MISMATCH_TEXT, "FILE_MISMATCH"));
  }
  return { ok: true, title: doc.title, versionLabel: label, existing: null, hash: actual };
}

export interface StaffSignResult {
  document_id: number;
  title: string | null;
  version_label: string | null;
  ok: boolean;
  already_signed: boolean;
  signature_id: number | null;
  signed_at: string | null;
  status: number;
  code: string | null;
  message: string | null;
  expected_version_id?: number;
}

/**
 * Records one signature per document, after verifySigner said yes. Each document is checked again here, with no await between the
 * check and the write. Returns one result per item, in order.
 */
export function recordStaffSignatures(sqlite: any, who: StaffSigner, items: StaffSignItem[], signer: { typedName: string; signedWith: SignedWith }, o: { several: boolean }): StaffSignResult[] {
  const assigned = assignedDocumentIds(sqlite, who.labId, { employeeId: who.employeeId, userId: who.userId });
  const checks = items.map((item) => ({ item, check: staffSignCheck(sqlite, who, item, { several: o.several, assigned }) }));
  const fresh = checks.filter((c) => c.check.ok && !c.check.existing);
  const together = fresh.length > 1 ? fresh.length : null;
  const [method, provider] = signedWithValues(signer.signedWith);
  const typed = signer.typedName.trim();
  const written = new Map<number, { id: number; signed_at: string }>();
  const insert = sqlite.prepare(
    `INSERT INTO staff_portal_policy_signatures
       (lab_id, document_id, version_id, staff_employee_id, signed_document_hash, typed_signature, ip_address, user_agent,
        signed_with, signed_with_provider, signed_together)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  sqlite.transaction(() => {
    for (const { item, check } of fresh) {
      if (!check.ok) continue;
      const r = insert.run(who.labId, item.documentId, item.versionId, who.employeeId, check.hash, typed, who.ip, who.userAgent, method, provider, together);
      const row = sqlite.prepare("SELECT id, signed_at FROM staff_portal_policy_signatures WHERE id = ?").get(r.lastInsertRowid) as any;
      written.set(item.documentId, row);
      // Who (the user and the roster person), when (the row's own time), what it was before and after.
      writeAuditLog(sqlite, {
        labId: who.labId, documentId: item.documentId, userId: who.userId, action: "read_and_signed",
        details: {
          version: check.versionLabel, signed_with: method, document_hash: check.hash, signed_with_provider: provider,
          signed_together: together, version_id: item.versionId, signature_id: row.id, staff_employee_id: who.employeeId,
          before: { signed: false }, after: { signed: true, signed_at: row.signed_at },
        },
        ipAddress: who.ip, userAgent: who.userAgent,
      });
    }
  })();
  // If this document was assigned to them in VeritaDC, this signature answers it (2026-11-04, Q161).
  for (const { item, check } of checks) if (check.ok) closeAttestationsCoveredByStaffSignatures(sqlite, who.labId, { documentId: item.documentId, userId: who.userId });
  return checks.map(({ item, check }) => {
    if (!check.ok) {
      return {
        document_id: item.documentId, title: check.title, version_label: check.versionLabel, ok: false, already_signed: false, signature_id: null,
        signed_at: null, status: check.refusal.status, code: check.refusal.body.code, message: check.refusal.body.error,
        ...(check.refusal.body.expected_version_id != null ? { expected_version_id: check.refusal.body.expected_version_id } : {}),
      };
    }
    const row = check.existing ?? written.get(item.documentId) ?? null;
    return {
      document_id: item.documentId, title: check.title, version_label: check.versionLabel, ok: true, already_signed: !!check.existing,
      signature_id: row?.id ?? null, signed_at: row?.signed_at ?? null, status: 200, code: null, message: null,
    };
  });
}
