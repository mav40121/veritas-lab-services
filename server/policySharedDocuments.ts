// server/policySharedDocuments.ts
//
// One controlled procedure for several laboratories (B1). Nothing here is a second document system:
//   - A system document (the master) is an ordinary VeritaDC document in the organization's repository lab (labs.is_repository), so
//     it has VeritaDC's own versions, approval route, file fingerprint and audit. The people who can edit VeritaDC in that lab (its
//     owner and admins, the organization's owner and admins, and editors they seat there) manage and send it.
//   - Sending its approved version gives a laboratory of the organization its own VeritaDC document, a draft in its own manual and on
//     its own route, with its own copy of the file (policy_shared_copies, policy_shared_versions). It takes effect only when that
//     laboratory approves it. No signature is copied, and nothing is submitted or approved for anyone.
//   - When the master's next version is approved, each following laboratory gets it as a draft revision over its own approved
//     version. If a revision is already open there, the new one waits and nothing is overwritten.
//   - A document that follows the system's takes no uploaded file of the laboratory's own. What is particular to the laboratory goes
//     in an addendum: another VeritaDC document of that laboratory (policy_addenda), with its own versions and approval, shown and
//     printed after it. To change the file itself the laboratory stops following and keeps its history.
//   - Read-and-sign, review dates and everything else are the laboratory's own. Only counts are read across laboratories
//     (systemDocumentsView), in the labs the reader's roll-up already shows (rollupLabsFor), and no person is named there.
// A support login sends, declines, links, follows and stops nothing (server/vlsSupport.ts, and ownEditor below).

import { orderManualTree } from "@shared/manualTree";
import { detectPhi } from "@shared/phiPatterns";
import {
  DECLINE_REASON_MAX, SEND_LABS_MAX, SYSTEM_LAB_STATE_LABEL, type SystemCopyState, type SystemLabState,
} from "@shared/systemDocuments";
import { docNumberKey, nextVersionParts, versionLabel, versionParts } from "../shared/policyVersion";
import { docTypeLabel } from "../shared/policyDocTypes";
import { approvedReadVersionId, revisionInProgress } from "./policyApprovedVersion";
import { addendaOf } from "./policyAddenda";
import {
  ACCEPTED_DOC_DESCRIPTION, buildVersionRelativePath, canonicalFormatFromMimeAndName, hashBuffer, readVersionBuffer, writeAuditLog, writeVersionBuffer,
} from "./veritapolicyApproval";
import { checkUploadForPhi } from "./phiUploadCheck";
import { defaultReviewIntervalMonthsForState } from "./policyReviewInterval";
import { documentSignCounts } from "./policyReadSign";
import { notifyDraftReceived } from "./policyNotices";
import { managedOrganizations, rollupGroupsFor, type RollupLabRow } from "./rollupGroups";
import { staffOwnScope } from "./competencySelfEntry";
import { isVlsSupportUser } from "./vlsSupport";
import { documentPrintPdf, usDate, CannotCombine, type PrintStatus } from "./policyDocumentPrint";
import { labLocalDate, labTimeZoneById } from "./dateLocal";

// The audit trail's "nobody pressed anything": a version that arrived because the master's was approved.
const SYSTEM_USER_ID = -1;

type CanEdit = (labId: number, userId: number) => boolean;

const COPY_SQL = `
  SELECT c.*, o.name AS organization_name, l.organization_id AS lab_org, l.lab_name,
         m.id AS master_id, m.archived_at AS master_archived_at, m.status AS master_status, m.current_version_id AS master_current, m.approved_version_id AS master_approved,
         ml.organization_id AS master_org, ml.is_repository AS master_is_repository
    FROM policy_shared_copies c
    JOIN labs l ON l.id = c.lab_id
    LEFT JOIN organizations o ON o.id = c.organization_id
    LEFT JOIN policy_documents m ON m.id = c.master_document_id
    LEFT JOIN labs ml ON ml.id = c.master_lab_id`;

export function copyState(c: any): SystemCopyState {
  if (c.status === "declined" || c.status === "own_copy") return c.status;
  if (c.lab_org == null || c.lab_org !== c.organization_id) return "left";
  if (c.master_id == null || c.master_archived_at || c.master_org !== c.organization_id) return "retired";
  return "following";
}

const copyOfDocument = (sqlite: any, documentId: number): any =>
  sqlite.prepare(`${COPY_SQL} WHERE c.document_id = ? ORDER BY c.id DESC LIMIT 1`).get(documentId) ?? null;

/** The organization's repository lab behind this lab id, or null when it isn't one. */
export function repositoryLab(sqlite: any, labId: number): { labId: number; organizationId: number; organizationName: string | null } | null {
  const r = sqlite.prepare(
    "SELECT l.id, l.organization_id, o.name FROM labs l LEFT JOIN organizations o ON o.id = l.organization_id WHERE l.id = ? AND l.is_repository = 1 AND l.organization_id IS NOT NULL AND l.retired_at IS NULL"
  ).get(labId) as any;
  return r ? { labId: r.id, organizationId: r.organization_id, organizationName: r.name ?? null } : null;
}

interface MasterVersion { doc: any; version: any; label: string | null }

/** The master's approved version right now (the version a reader limited to approved procedures reads), or null. */
export function masterInEffect(sqlite: any, masterDocumentId: number): MasterVersion | null {
  const doc = sqlite.prepare("SELECT * FROM policy_documents WHERE id = ?").get(masterDocumentId) as any;
  const id = approvedReadVersionId(doc);
  const version = id == null ? null : (sqlite.prepare("SELECT * FROM policy_versions WHERE id = ? AND document_id = ?").get(id, masterDocumentId) as any);
  return version ? { doc, version, label: versionLabel(version) } : null;
}

// The master's file, checked against its fingerprint: a file that no longer matches is sent to nobody.
function masterFile(master: MasterVersion): Buffer {
  const buffer = readVersionBuffer(master.version.file_path);
  if (hashBuffer(buffer) !== master.version.file_hash_sha256) throw new FileChanged();
  return buffer;
}
class FileChanged extends Error { constructor() { super("The master's file no longer matches its fingerprint."); } }

// ── A laboratory's own structure ─────────────────────────────────────────────

const activeManuals = (sqlite: any, labId: number) =>
  orderManualTree(sqlite.prepare("SELECT id, parent_id, name, display_order FROM policy_manuals WHERE lab_id = ? AND archived_at IS NULL").all(labId) as any[]) as any[];

/** The laboratory's manual that matches the master's, by full path or by a name only one of its manuals has. Never creates one. */
function matchingManual(sqlite: any, labId: number, master: any): number | null {
  if (master.manual_id == null) return null;
  const theirs = activeManuals(sqlite, master.lab_id).find((m) => m.id === master.manual_id);
  if (!theirs) return null;
  const key = (s: string) => s.trim().toLowerCase();
  const mine = activeManuals(sqlite, labId);
  const byPath = mine.filter((m) => key(m.path) === key(theirs.path));
  if (byPath.length === 1) return byPath[0].id;
  const byName = mine.filter((m) => key(m.name) === key(theirs.name));
  return byName.length === 1 ? byName[0].id : null;
}

const defaultRoute = (sqlite: any, labId: number): number | null =>
  (sqlite.prepare("SELECT id FROM policy_approval_workflows WHERE lab_id = ? AND archived_at IS NULL AND is_default = 1 ORDER BY id LIMIT 1").get(labId) as any)?.id ?? null;

function reviewMonths(sqlite: any, labId: number, docType: string | null): number {
  const rule = docType
    ? (sqlite.prepare("SELECT default_review_months AS m FROM policy_doc_type_settings WHERE lab_id = ? AND doc_type = ?").get(labId, docType) as any)
    : null;
  if (rule?.m) return Number(rule.m);
  const state = sqlite.prepare(
    "SELECT (SELECT sl.lab_address_state FROM staff_labs sl WHERE sl.user_id = l.owner_user_id ORDER BY sl.id DESC LIMIT 1) AS state FROM labs l WHERE l.id = ?"
  ).get(labId) as any;
  return defaultReviewIntervalMonthsForState(state?.state);
}

const numberFree = (sqlite: any, labId: number, number: string | null, exceptId = -1): boolean =>
  !!number && !(sqlite.prepare("SELECT doc_number FROM policy_documents WHERE lab_id = ? AND archived_at IS NULL AND doc_number IS NOT NULL AND id <> ?").all(labId, exceptId) as any[])
    .some((r) => docNumberKey(r.doc_number) === docNumberKey(number));

/** Store a file as the next version of a document and point the document at it, as a draft. Returns the version id. */
function addVersion(sqlite: any, o: {
  labId: number; documentId: number; buffer: Buffer; format: string; summary: string; major: boolean; uploadedBy: number; parts?: { major: number; minor: number };
}): { versionId: number; label: string } {
  const prior = sqlite.prepare("SELECT version_number, version_major, version_minor FROM policy_versions WHERE document_id = ?").all(o.documentId) as any[];
  const next = prior.reduce((n, v) => Math.max(n, Number(v.version_number)), 0) + 1;
  // A laboratory's version carries the system's own number while that still moves forward here; otherwise its next number.
  const ahead = !!o.parts && prior.map(versionParts).every((p) => o.parts!.major > p.major || (o.parts!.major === p.major && o.parts!.minor > p.minor));
  const parts = ahead ? o.parts! : nextVersionParts(prior, o.major);
  const rel = buildVersionRelativePath(o.labId, o.documentId, next, o.format);
  writeVersionBuffer(rel, o.buffer);
  const versionId = Number(sqlite.prepare(
    `INSERT INTO policy_versions (document_id, version_number, file_path, file_format, file_size_bytes, file_hash_sha256, change_summary, is_major_revision, uploaded_by, uploaded_at, version_major, version_minor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`
  ).run(o.documentId, next, rel, o.format, o.buffer.length, hashBuffer(o.buffer), o.summary, o.major ? 1 : 0, o.uploadedBy, parts.major, parts.minor).lastInsertRowid);
  // The version that was approved stays recorded as the approved one while this draft is open (BUG-151).
  sqlite.prepare(
    `UPDATE policy_documents
        SET approved_version_id = CASE WHEN status IN ('approved', 'expired') THEN current_version_id ELSE approved_version_id END,
            current_version_id = ?, status = 'draft', updated_at = datetime('now')
      WHERE id = ?`
  ).run(versionId, o.documentId);
  return { versionId, label: `${parts.major}.${parts.minor}` };
}

function insertDocument(sqlite: any, o: { labId: number; manualId: number | null; title: string; description: string | null; ownerId: number; months: number; routeId: number | null; number: string | null; type: string | null }): number {
  return Number(sqlite.prepare(
    `INSERT INTO policy_documents (lab_id, manual_id, title, description, status, owner_user_id, review_interval_months, workflow_id, doc_number, doc_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).run(o.labId, o.manualId, o.title, o.description, o.ownerId, o.months, o.routeId, o.number, o.type).lastInsertRowid);
}

// ── Receiving a version ──────────────────────────────────────────────────────

type How = "sent" | "new_version" | "linked" | "taken" | "resumed";
interface Received { labId: number; documentId: number; versionId: number; auditId: number }

const summaryOf = (master: MasterVersion) => {
  const s = String(master.version.change_summary ?? "").trim();
  return `System version ${master.label}${s ? `: ${s}` : ""}`;
};

const hasReceived = (sqlite: any, copyId: number, documentId: number, masterVersionId: number): boolean =>
  !!sqlite.prepare("SELECT 1 FROM policy_shared_versions WHERE copy_id = ? AND document_id = ? AND master_version_id = ? LIMIT 1").get(copyId, documentId, masterVersionId);

const isReceivedVersion = (sqlite: any, versionId: number | null): boolean =>
  versionId != null && !!sqlite.prepare("SELECT 1 FROM policy_shared_versions WHERE version_id = ?").get(versionId);

/** The laboratory's document gets this master version as a draft. Inside the caller's transaction. */
function receiveInto(sqlite: any, o: { copy: any; documentId: number; master: MasterVersion; buffer: Buffer; how: How; by: number; first: boolean }): Received {
  const { copy, master } = o;
  const before = sqlite.prepare("SELECT status, current_version_id, approved_version_id FROM policy_documents WHERE id = ?").get(o.documentId) as any;
  const made = addVersion(sqlite, {
    labId: copy.lab_id, documentId: o.documentId, buffer: o.buffer, format: master.version.file_format, summary: summaryOf(master),
    // A major revision asks for the director in person. A laboratory's first receipt of a procedure isn't a revision of it.
    major: !o.first && Number(master.version.is_major_revision) === 1,
    uploadedBy: master.version.uploaded_by, parts: versionParts(master.version),
  });
  sqlite.prepare("UPDATE policy_documents SET workflow_id = COALESCE((SELECT w.id FROM policy_approval_workflows w WHERE w.id = policy_documents.workflow_id AND w.lab_id = ? AND w.archived_at IS NULL), ?) WHERE id = ?")
    .run(copy.lab_id, defaultRoute(sqlite, copy.lab_id), o.documentId);
  sqlite.prepare(
    `INSERT INTO policy_shared_versions (copy_id, lab_id, document_id, version_id, master_version_id, master_label, how, received_by, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(copy.id, copy.lab_id, o.documentId, made.versionId, master.version.id, master.label, o.how, o.by);
  sqlite.prepare(
    `UPDATE policy_shared_copies SET document_id = ?, master_title = ?, master_doc_number = ?, waiting_master_version_id = NULL, waiting_master_label = NULL, waiting_since = NULL,
            declined_master_version_id = NULL, declined_label = NULL, declined_reason = NULL, declined_by = NULL, declined_at = NULL, updated_at = datetime('now') WHERE id = ?`
  ).run(o.documentId, master.doc.title, master.doc.doc_number ?? null, copy.id);
  writeAuditLog(sqlite, {
    labId: copy.lab_id, documentId: o.documentId, userId: o.by, action: "system_version_received",
    details: {
      organization_id: copy.organization_id, master_document_id: copy.master_document_id, master_version_id: master.version.id, system_version: master.label, how: o.how,
      version_label: made.label, file_hash_sha256: master.version.file_hash_sha256,
      before: { status: before?.status ?? null, version_id: before?.current_version_id ?? null }, after: { status: "draft", version_id: made.versionId, approved_version_id: before?.approved_version_id ?? null },
    },
  });
  const auditId = Number((sqlite.prepare("SELECT MAX(id) AS id FROM policy_audit_log WHERE document_id = ? AND action = 'system_version_received'").get(o.documentId) as any)?.id ?? 0);
  return { labId: copy.lab_id, documentId: o.documentId, versionId: made.versionId, auditId };
}

/** A new document for the laboratory, holding the master's approved version as its first draft. Inside the caller's transaction. */
function receiveAsNew(sqlite: any, copy: any, master: MasterVersion, buffer: Buffer, how: How, by: number): Received {
  const owner = sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(copy.lab_id) as any;
  const number = numberFree(sqlite, copy.lab_id, master.doc.doc_number) ? master.doc.doc_number : null;
  const documentId = insertDocument(sqlite, {
    labId: copy.lab_id, manualId: matchingManual(sqlite, copy.lab_id, master.doc), title: master.doc.title, description: master.doc.description ?? null,
    ownerId: owner.owner_user_id, months: reviewMonths(sqlite, copy.lab_id, master.doc.doc_type ?? null), routeId: defaultRoute(sqlite, copy.lab_id),
    number, type: master.doc.doc_type ?? null,
  });
  return receiveInto(sqlite, { copy, documentId, master, buffer, how, by, first: true });
}

const setWaiting = (sqlite: any, copyId: number, master: MasterVersion) =>
  sqlite.prepare(
    `UPDATE policy_shared_copies SET waiting_since = CASE WHEN waiting_master_version_id = ? THEN waiting_since ELSE datetime('now') END,
            waiting_master_version_id = ?, waiting_master_label = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(master.version.id, master.version.id, master.label, copyId);

type Delivery = { outcome: "delivered"; received: Received } | { outcome: "waiting" | "already" | "nothing" };

/**
 * Put the master's approved version in front of one following laboratory. A document with a draft or a review already open is left
 * exactly as it is and the version waits, unless `replaceDraft` (the laboratory asked, and the open draft is an earlier system
 * version nobody here wrote).
 */
function deliver(sqlite: any, copy: any, master: MasterVersion, buffer: Buffer, how: How, by: number, replaceDraft = false): Delivery {
  if (copyState(copy) !== "following" || copy.document_id == null) return { outcome: "nothing" };
  const doc = sqlite.prepare("SELECT * FROM policy_documents WHERE id = ? AND lab_id = ?").get(copy.document_id, copy.lab_id) as any;
  if (!doc) return { outcome: "nothing" };
  if (hasReceived(sqlite, copy.id, doc.id, master.version.id)) {
    sqlite.prepare("UPDATE policy_shared_copies SET waiting_master_version_id = NULL, waiting_master_label = NULL, waiting_since = NULL WHERE id = ?").run(copy.id);
    return { outcome: "already" };
  }
  const open = doc.status === "draft" || doc.status === "in_review";
  const mayReplace = replaceDraft && doc.status === "draft" && isReceivedVersion(sqlite, doc.current_version_id);
  if (doc.archived_at || (open && !mayReplace)) {
    setWaiting(sqlite, copy.id, master);
    return { outcome: "waiting" };
  }
  const first = approvedReadVersionId(doc) == null;
  return { outcome: "delivered", received: receiveInto(sqlite, { copy, documentId: doc.id, master, buffer, how, by, first }) };
}

// ── Where a lab can receive ──────────────────────────────────────────────────

export interface SharedDeps {
  // The plans VeritaDC is part of (the same allowlist its page uses).
  planHasDc: (plan: string | null | undefined) => boolean;
  // False for a laboratory whose subscription ended (read-only or locked).
  labTakesWrites: (labId: number) => boolean;
  canEdit: CanEdit;
}

interface LabRow { id: number; lab_name: string | null; clia_number: string | null; plan: string | null; org_plan: string | null; retired_at: string | null; is_trial: number | null; subscription_expires_at: string | null }

/** The laboratories of an organization a system document can go to: everything but its repository labs. */
const organizationLabs = (sqlite: any, organizationId: number): LabRow[] =>
  sqlite.prepare(
    `SELECT l.id, l.lab_name, l.clia_number, l.plan, o.plan AS org_plan, l.retired_at, l.is_trial, l.subscription_expires_at
       FROM labs l LEFT JOIN organizations o ON o.id = l.organization_id
      WHERE l.organization_id = ? AND (l.is_repository IS NULL OR l.is_repository = 0)
      ORDER BY l.lab_name COLLATE NOCASE, l.id`
  ).all(organizationId) as LabRow[];

const labLabel = (l: { id: number; lab_name: string | null }) => l.lab_name || `Laboratory ${l.id}`;

function labRefusal(l: LabRow, deps: SharedDeps): string | null {
  if (l.retired_at) return "This laboratory is closed.";
  if (Number(l.is_trial) === 1 && l.subscription_expires_at && new Date() >= new Date(l.subscription_expires_at)) return "This laboratory's trial has ended.";
  if (!deps.planHasDc(l.plan) && !deps.planHasDc(l.org_plan)) return "This laboratory's plan doesn't include VeritaDC™.";
  if (!deps.labTakesWrites(l.id)) return "This laboratory's subscription has ended, so it is read-only.";
  return null;
}

const tell = (sqlite: any, deps: SharedDeps, r: Received, from: string | null, label: string | null, actor: number) =>
  notifyDraftReceived(sqlite, { labId: r.labId, documentId: r.documentId, receivedAuditId: r.auditId, from: from || "your system", systemVersion: label, actorUserId: actor, canEdit: deps.canEdit });

// ── Hooks from VeritaDC's own routes ─────────────────────────────────────────

/**
 * A document's last approval step was just signed (recordApprovalDecision in routes.ts). When it is a master, each following
 * laboratory gets the new version; when it is a laboratory's document with a newer version waiting, that one comes in now. Never
 * throws: the approval it follows is already recorded.
 */
export function afterDocumentApproved(sqlite: any, documentId: number, deps: SharedDeps): void {
  try {
    const asMaster = sqlite.prepare(`${COPY_SQL} WHERE c.master_document_id = ? AND c.status = 'following'`).all(documentId) as any[];
    if (asMaster.length) {
      const master = masterInEffect(sqlite, documentId);
      if (!master) return;
      const following = asMaster.filter((c) => copyState(c) === "following" && Number(c.master_is_repository) === 1);
      // Recorded as waiting first, so a laboratory that isn't reached below (a full disk, a restart) still shows it waiting.
      sqlite.transaction(() => { for (const c of following) if (c.document_id != null && !hasReceived(sqlite, c.id, c.document_id, master.version.id)) setWaiting(sqlite, c.id, master); })();
      const labs = new Map(organizationLabs(sqlite, following[0]?.organization_id ?? -1).map((l) => [l.id, l]));
      const buffer = masterFile(master);
      for (const c of following) {
        const lab = labs.get(c.lab_id);
        if (!lab || labRefusal(lab, deps)) continue;
        try {
          const out = sqlite.transaction(() => deliver(sqlite, c, master, buffer, "new_version", SYSTEM_USER_ID))() as Delivery;
          if (out.outcome === "delivered") tell(sqlite, deps, out.received, c.organization_name, master.label, SYSTEM_USER_ID);
        } catch (err: any) {
          console.error("[dc shared] new version not delivered to lab", c.lab_id, err?.message || err);
        }
      }
      return;
    }
    deliverWaiting(sqlite, documentId, deps);
  } catch (err: any) {
    console.error("[dc shared] after approval:", err?.message || err);
  }
}

function deliverWaiting(sqlite: any, documentId: number, deps: SharedDeps): void {
  const copy = copyOfDocument(sqlite, documentId);
  if (!copy || copy.waiting_master_version_id == null || copyState(copy) !== "following") return;
  const master = masterInEffect(sqlite, copy.master_document_id);
  if (!master) return;
  const buffer = masterFile(master);
  const out = sqlite.transaction(() => deliver(sqlite, copy, master, buffer, "new_version", SYSTEM_USER_ID))() as Delivery;
  if (out.outcome === "delivered") tell(sqlite, deps, out.received, copy.organization_name, master.label, SYSTEM_USER_ID);
}

/** The master was archived, or restored: each laboratory's own trail says so. Its copy stays exactly as it is. */
export function noteMasterArchived(sqlite: any, documentId: number, restored: boolean): void {
  try {
    for (const c of sqlite.prepare(`${COPY_SQL} WHERE c.master_document_id = ? AND c.status = 'following' AND c.document_id IS NOT NULL`).all(documentId) as any[]) {
      if (c.lab_org !== c.organization_id) continue;
      writeAuditLog(sqlite, { labId: c.lab_id, documentId: c.document_id, userId: SYSTEM_USER_ID, action: restored ? "system_document_back_in_use" : "system_document_retired", details: { organization_id: c.organization_id, master_document_id: documentId, title: c.master_title } });
    }
  } catch (err: any) {
    console.error("[dc shared] master archived:", err?.message || err);
  }
}

/** Why this document can't take an uploaded file of the laboratory's own, or null. */
export function followedUploadProblem(sqlite: any, documentId: number): { error: string; code: string } | null {
  const c = copyOfDocument(sqlite, documentId);
  const state = c ? copyState(c) : null;
  if (state !== "following" && state !== "retired") return null;
  return {
    error: "This document follows a system document, so its file comes from the system. Add a site addendum for what is particular to your laboratory, or make it your own copy to change the file.",
    code: "SYSTEM_DOCUMENT",
  };
}

/** Why a document can't be deleted, or null: a system document that was sent is retired by archiving it, so laboratories are told. */
export function masterDeleteProblem(sqlite: any, documentId: number): { error: string; code: string } | null {
  const n = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM policy_shared_copies WHERE master_document_id = ?").get(documentId) as any).n);
  return n ? { error: "This document was sent to laboratories. Archive it to retire it; each laboratory is told and keeps its own copy.", code: "SYSTEM_DOCUMENT_SENT" } : null;
}

/** A laboratory deleted one of its documents: its links go, and the organization's view says it was deleted. In the caller's transaction. */
export function forgetDeletedDocument(sqlite: any, documentId: number): void {
  sqlite.prepare("UPDATE policy_shared_copies SET document_id = NULL, waiting_master_version_id = NULL, waiting_master_label = NULL, waiting_since = NULL, updated_at = datetime('now') WHERE document_id = ?").run(documentId);
  sqlite.prepare("DELETE FROM policy_addenda WHERE document_id = ? OR addendum_document_id = ?").run(documentId, documentId);
}

// ── What a laboratory's screens read ─────────────────────────────────────────

/** What the document list adds to a row that came from the system, or is an addendum. Null when this lab has neither. */
export function sharedMarks(sqlite: any, labId: number): ((row: any) => Record<string, unknown>) | null {
  const copies = sqlite.prepare(`${COPY_SQL} WHERE c.lab_id = ? AND c.document_id IS NOT NULL`).all(labId) as any[];
  const addenda = sqlite.prepare(
    `SELECT a.document_id, a.addendum_document_id, d.title, x.archived_at FROM policy_addenda a JOIN policy_documents d ON d.id = a.document_id
       JOIN policy_documents x ON x.id = a.addendum_document_id WHERE a.lab_id = ? AND a.removed_at IS NULL`
  ).all(labId) as any[];
  if (!copies.length && !addenda.length) return null;
  const byDoc = new Map<number, any>(copies.map((c) => [c.document_id, c]));
  const labels = new Map<number, string | null>((sqlite.prepare("SELECT version_id, master_label FROM policy_shared_versions WHERE lab_id = ?").all(labId) as any[]).map((v) => [v.version_id, v.master_label]));
  const parent = new Map<number, any>(addenda.map((a) => [a.addendum_document_id, a]));
  const counts = new Map<number, number>();
  for (const a of addenda) if (!a.archived_at) counts.set(a.document_id, (counts.get(a.document_id) ?? 0) + 1);
  return (row) => {
    const c = byDoc.get(row.id);
    const a = parent.get(row.id);
    return {
      ...(c ? {
        system_document: {
          copy_id: c.id, state: copyState(c), organization_name: c.organization_name ?? null,
          version_label: labels.get(row.current_version_id) ?? null, waiting_label: copyState(c) === "following" ? c.waiting_master_label ?? null : null,
          addenda: counts.get(row.id) ?? 0,
        },
      } : {}),
      ...(a ? { addendum_to: { document_id: a.document_id, title: a.title } } : {}),
    };
  };
}

/** What one document's own screen adds. `limited` is a reader held to approved procedures (a Staff login). */
export function sharedDetail(sqlite: any, labId: number, row: any, limited: boolean): Record<string, unknown> {
  const c = copyOfDocument(sqlite, row.id);
  const addenda = addendaOf(sqlite, labId, row.id, limited);
  const of = sqlite.prepare(
    "SELECT a.document_id, d.title FROM policy_addenda a JOIN policy_documents d ON d.id = a.document_id WHERE a.lab_id = ? AND a.addendum_document_id = ? AND a.removed_at IS NULL"
  ).get(labId, row.id) as any;
  return {
    ...(c && c.lab_id === labId ? { system_document: limited ? { state: copyState(c), organization_name: c.organization_name ?? null, version_label: labelOf(sqlite, row.current_version_id) } : copyView(sqlite, c) } : {}),
    ...(addenda.length ? { addenda } : {}),
    ...(of ? { addendum_to: { document_id: of.document_id, title: of.title } } : {}),
  };
}

const labelOf = (sqlite: any, versionId: number | null | undefined): string | null =>
  versionId == null ? null : (sqlite.prepare("SELECT master_label FROM policy_shared_versions WHERE version_id = ?").get(versionId) as any)?.master_label ?? null;

/** One received document, for the laboratory's own editors and readers. */
export function copyView(sqlite: any, c: any) {
  const state = copyState(c);
  const doc = c.document_id == null ? null : (sqlite.prepare("SELECT * FROM policy_documents WHERE id = ?").get(c.document_id) as any);
  const inForceId = approvedReadVersionId(doc ? { ...doc, archived_at: null } : null);
  const inForce = inForceId == null ? null : (sqlite.prepare("SELECT version_number, version_major, version_minor FROM policy_versions WHERE id = ?").get(inForceId) as any);
  const receivedOf = doc?.current_version_id == null ? null : (sqlite.prepare("SELECT master_label, received_at FROM policy_shared_versions WHERE version_id = ?").get(doc.current_version_id) as any);
  const open = !!doc && !doc.archived_at && !!receivedOf && (doc.status === "draft" || doc.status === "in_review");
  const sender = sqlite.prepare("SELECT name, email FROM users WHERE id = ?").get(c.sent_by) as any;
  const owner = doc ? (sqlite.prepare("SELECT name, email FROM users WHERE id = ?").get(doc.owner_user_id) as any) : null;
  const inForceLabel = labelOf(sqlite, inForceId);
  return {
    copy_id: c.id, document_id: c.document_id ?? null, state,
    organization_name: c.organization_name ?? null, master_title: c.master_title ?? null, master_doc_number: c.master_doc_number ?? null,
    sent_at: c.sent_at, sent_by: sender?.name || sender?.email || null,
    title: doc?.title ?? null, doc_number: doc?.doc_number ?? null, status: doc?.status ?? null, archived: !!doc?.archived_at,
    owner_user_id: doc?.owner_user_id ?? null, owner_name: owner?.name || owner?.email || null,
    version_label: receivedOf?.master_label ?? null, received_at: receivedOf?.received_at ?? null, open,
    in_force_label: inForceLabel, in_force_own: inForceId != null && inForceLabel == null, in_force_own_label: inForceId != null && inForceLabel == null ? versionLabel(inForce) : null,
    waiting_label: state === "following" ? c.waiting_master_label ?? null : null, waiting_since: state === "following" ? c.waiting_since ?? null : null,
    declined_label: c.declined_label ?? null, declined_reason: c.declined_reason ?? null, declined_at: c.declined_at ?? null,
    addenda: doc ? addendaOf(sqlite, c.lab_id, doc.id, false).length : 0,
  };
}

// ── The organization's view ──────────────────────────────────────────────────

export interface SystemLabRow {
  lab_id: number; lab_name: string | null; clia_number: string | null; document_id: number | null; state: SystemLabState;
  approved_label: string | null; approved_own: boolean; approved_own_label: string | null;
  open_label: string | null; queued_label: string | null; waiting_since: string | null;
  declined_label: string | null; declined_reason: string | null; declined_at: string | null;
  next_review_date: string | null; review_overdue: boolean; signed: number; owed: number; addenda: number;
}
export interface SystemDocumentRow {
  master_document_id: number; organization_id: number; organization_name: string | null; title: string; doc_number: string | null; doc_type: string | null;
  version_label: string | null; retired: boolean; labs: SystemLabRow[];
}

/**
 * Every system document sent to a lab in `labs` (the reader's readiness roll-up), one row per lab, counts only. A lab where the
 * reader is only a Staff login, which doesn't read who has signed, is left out.
 */
export function systemDocumentsView(sqlite: any, userId: number, labs: RollupLabRow[]): SystemDocumentRow[] {
  const readable = labs.filter((l) => !staffOwnScope(sqlite, userId, l.id, "veritapolicy"));
  const out = new Map<number, SystemDocumentRow>();
  const masters = new Map<number, { doc: any; version: any; label: string | null } | null>();
  for (const l of readable) {
    const copies = sqlite.prepare(`${COPY_SQL} WHERE c.lab_id = ? ORDER BY c.id`).all(l.id) as any[];
    if (!copies.length) continue;
    const docs = new Map<number, any>();
    for (const c of copies) if (c.document_id != null) {
      const d = sqlite.prepare("SELECT * FROM policy_documents WHERE id = ? AND lab_id = ?").get(c.document_id, l.id) as any;
      if (d) docs.set(c.document_id, d);
    }
    const counts = documentSignCounts(sqlite, l.id, [...docs.values()].filter((d) => !d.archived_at).map((d) => ({ id: d.id, manual_id: d.manual_id ?? null, current_version_id: approvedReadVersionId(d), doc_type: d.doc_type ?? null })));
    for (const c of copies) {
      if (!masters.has(c.master_document_id)) masters.set(c.master_document_id, masterInEffect(sqlite, c.master_document_id));
      const master = masters.get(c.master_document_id) ?? null;
      const raw = sqlite.prepare("SELECT title, doc_number, doc_type, archived_at FROM policy_documents WHERE id = ?").get(c.master_document_id) as any;
      let row = out.get(c.master_document_id);
      if (!row) {
        row = {
          master_document_id: c.master_document_id, organization_id: c.organization_id, organization_name: c.organization_name ?? null,
          title: raw?.title ?? c.master_title ?? "A system document", doc_number: raw?.doc_number ?? c.master_doc_number ?? null, doc_type: raw?.doc_type ?? null,
          version_label: master?.label ?? null, retired: !raw || !!raw.archived_at, labs: [],
        };
        out.set(c.master_document_id, row);
      }
      const doc = c.document_id == null ? null : docs.get(c.document_id) ?? null;
      const v = copyView(sqlite, c);
      const state: SystemLabState = !doc && c.status !== "declined" ? "removed"
        : v.state === "declined" ? "declined"
          : v.state === "own_copy" ? "own_copy"
            : v.state === "left" ? "left"
              : doc?.archived_at ? "archived"
                : v.open ? "waiting"
                  : v.in_force_label != null && (v.in_force_label === row.version_label || row.retired) ? "current"
                    : "behind";
      const count = doc ? counts.get(doc.id) : null;
      row.labs.push({
        lab_id: l.id, lab_name: l.lab_name, clia_number: l.clia_number, document_id: doc?.id ?? null, state,
        approved_label: v.in_force_label, approved_own: v.in_force_own, approved_own_label: v.in_force_own_label,
        open_label: v.open ? v.version_label : null, queued_label: v.waiting_label, waiting_since: v.open ? v.received_at : v.waiting_since,
        declined_label: v.declined_label, declined_reason: v.declined_reason, declined_at: v.declined_at,
        next_review_date: doc && !doc.archived_at ? doc.next_review_date ?? null : null, review_overdue: doc?.status === "expired" && !doc.archived_at,
        signed: count?.signed ?? 0, owed: count?.owed ?? 0, addenda: v.addenda,
      });
    }
  }
  return [...out.values()].sort((a, b) => a.title.localeCompare(b.title) || a.master_document_id - b.master_document_id);
}

async function systemDocumentsWorkbook(rows: SystemDocumentRow[], about: { forWhom: string; filter: string; today: string }, stamp: (wb: any) => void): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Veritas Lab Services";
  const teal = "FF01696F", tint = "FFE6F2F2", accent = "FF0A3A3D", ink = "FF28251D", alt = "FFEBF3F8";
  const pwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";
  const identity = `${about.forWhom}    CLIA: each laboratory's own, on its row`;
  const page = { headerFooter: { oddHeader: `&R${about.forWhom}    CLIA: per row`, oddFooter: `&L${about.forWhom}    CLIA: per row` } };
  const a = wb.addWorksheet("About", page);
  a.getColumn(1).width = 110;
  let r = 1;
  const line = (text: string, kind: "title" | "identity" | "section" | "body") => {
    const c = a.getCell(`A${r}`);
    c.value = text;
    c.font = { name: "Calibri", size: kind === "title" ? 14 : kind === "section" ? 12 : 11, bold: kind !== "body", color: { argb: kind === "title" ? "FFFFFFFF" : kind === "body" ? ink : accent } };
    if (kind !== "body") c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: kind === "title" ? teal : tint } };
    c.alignment = { vertical: kind === "title" ? "middle" : "top", wrapText: true, indent: 1 };
    a.getRow(r).height = kind === "title" ? 30 : kind === "body" ? Math.max(1, Math.ceil(text.length / 100)) * 16 + 4 : 22;
    r += 1;
  };
  line("VeritaDC System Documents", "title");
  line(`Prepared for: ${identity}`, "identity");
  line("This is a snapshot, not the authoritative record. Each laboratory's live VeritaDC™ record is. The laboratory director or designee decides what is approved in that laboratory.", "body");
  line("How to use this workbook", "section");
  line("Each row is one system document in one laboratory: the version that laboratory has approved, what it has waiting and since when, its review date, and how many people have signed and still owe a signature on the version in force. No staff member is named.", "body");
  line("Approved version is the system's version number. Own version means the laboratory approved a version of its own that didn't come from the system.", "body");
  line("Where it comes from", "section");
  line(`VeritaDC™ on ${about.today}. ${about.filter}`, "body");
  line("Coverage gaps", "section");
  line("Only laboratories in your readiness roll-up are listed. A laboratory that has left the system is not followed. Questions: info@veritaslabservices.com.", "body");
  await a.protect(pwd, { selectLockedCells: false, selectUnlockedCells: false });

  const ws = wb.addWorksheet("System documents", { ...page, views: [{ state: "frozen", xSplit: 2, ySplit: 1, topLeftCell: "C2" }] });
  const cols: Array<[string, number]> = [
    ["Number", 14], ["Document", 38], ["Type", 16], ["System version", 14], ["Laboratory", 30], ["CLIA", 14], ["Status", 24], ["Approved version", 18],
    ["Waiting version", 16], ["Waiting since", 14], ["Next in line", 14], ["Declined", 34], ["Next review", 14], ["Review", 14], ["Signed", 10], ["Owed", 10], ["Site addenda", 12],
  ];
  cols.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });
  const head = ws.getRow(1);
  head.values = cols.map(([h]) => h);
  head.height = 20;
  const border = { style: "thin" as const, color: { argb: "FFD0D0D0" } };
  const borders = { top: border, bottom: border, left: border, right: border };
  head.eachCell((c: any) => { c.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } }; c.alignment = { vertical: "middle", wrapText: true }; c.border = borders; });
  const color: Partial<Record<SystemLabState, string>> = { current: "FF437A22", waiting: "FF964219", behind: "FF964219", declined: "FFA12C7B" };
  const day = (s: string | null) => (s ? s.slice(0, 10) : "");
  let n = 0;
  for (const d of rows) for (const l of d.labs) {
    const row = ws.getRow(n + 2);
    row.values = [
      d.doc_number ?? "", d.title, docTypeLabel(d.doc_type) ?? "", d.retired ? `${d.version_label ?? ""} retired`.trim() : d.version_label ?? "", l.lab_name ?? "", l.clia_number ?? "", SYSTEM_LAB_STATE_LABEL[l.state],
      l.approved_label ?? (l.approved_own ? `Own version ${l.approved_own_label ?? ""}`.trim() : ""), l.open_label ?? "", day(l.waiting_since), l.queued_label ?? "",
      l.declined_reason ? `${l.declined_label ? `Version ${l.declined_label}: ` : ""}${l.declined_reason}` : "", day(l.next_review_date), l.review_overdue ? "Overdue" : l.next_review_date ? "On schedule" : "", l.signed, l.owed, l.addenda,
    ];
    row.eachCell({ includeEmpty: true }, (c: any) => { c.font = { name: "Calibri", size: 10, color: { argb: ink } }; c.alignment = { vertical: "middle", wrapText: true }; c.border = borders; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: n % 2 ? alt : "FFFFFFFF" } }; });
    row.getCell(7).font = { name: "Calibri", size: 10, bold: true, color: { argb: color[l.state] ?? "FF7A7974" } };
    if (l.review_overdue) row.getCell(14).font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFA12C7B" } };
    n += 1;
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, n + 1), column: cols.length } };
  await ws.protect(pwd, { selectLockedCells: true, selectUnlockedCells: true, autoFilter: true, sort: false });
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" }];
  stamp(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function registerPolicySharedDocumentRoutes(app: any, deps: {
  sqlite: () => any;
  authMiddleware: any;
  labScopeMiddleware: any;
  requireWriteAccess: any;
  requireModuleEdit: (module: string) => any;
  hasModuleEditAccess: (labId: number, userId: number, module: string) => boolean;
  shared: SharedDeps;
  upload: any; // VeritaDC's own multer
  rollupLabsForRequest: (sqlite: any, req: any) => RollupLabRow[] | null;
  stampWorkbook: (wb: any, req: any) => void;
  today: () => string;
}) {
  const { sqlite, authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit, hasModuleEditAccess, shared } = deps;
  const R = "/api/labs/:labId/veritapolicy";
  const closedToStaff = (req: any, res: any, next: any) => (req.dcStaff ? res.status(404).json({ error: "Not found" }) : next());
  // A laboratory's own editor: never support, and never someone who only reached the lab by an older pass-through.
  const ownEditor = (req: any, res: any, next: any) => {
    if (req.scope?.viaVlsSupport || isVlsSupportUser(sqlite(), req.userId)) return res.status(403).json({ error: "Veritas support can't do this. It belongs to the laboratory's own staff.", code: "VLS_SUPPORT_CANNOT_SIGN" });
    if (!hasModuleEditAccess(req.scope.labId, req.userId, "veritapolicy")) return res.status(403).json({ error: "This needs VeritaDC™ edit access in this laboratory." });
    next();
  };
  const read = [authMiddleware, labScopeMiddleware, closedToStaff];
  const edit = [authMiddleware, labScopeMiddleware, closedToStaff, requireWriteAccess, requireModuleEdit("veritapolicy"), ownEditor];
  const agent = (req: any) => req.headers["user-agent"] as string | undefined;
  const audit = (req: any, o: { labId: number; documentId: number | null; action: string; details: Record<string, unknown> }) =>
    writeAuditLog(sqlite(), { ...o, userId: req.userId, ipAddress: req.ip, userAgent: agent(req) });
  const whole = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

  // ── The organization's side: in its repository lab ──

  const repository = (req: any, res: any, next: any) => {
    const repo = repositoryLab(sqlite(), req.scope.labId);
    if (!repo) return res.status(409).json({ error: "System documents are kept in your organization's repository laboratory.", code: "NOT_A_REPOSITORY" });
    req.repository = repo;
    next();
  };
  const masterDoc = (req: any, res: any): any => {
    const id = whole(req.params.id);
    const doc = id == null ? null : (sqlite().prepare("SELECT * FROM policy_documents WHERE id = ? AND lab_id = ?").get(id, req.scope.labId) as any);
    if (!doc) res.status(404).json({ error: "Not found" });
    return doc;
  };

  // Which of the repository's documents have been sent, and how far each got. Counts only; another lab answers repository: false.
  app.get(`${R}/shared/masters`, ...read, (req: any, res: any) => {
    const db = sqlite();
    const repo = repositoryLab(db, req.scope.labId);
    if (!repo) return res.json({ repository: false });
    const documents: Record<number, { sent: number; waiting: number; approved: number }> = {};
    for (const c of db.prepare(`${COPY_SQL} WHERE c.master_lab_id = ?`).all(repo.labId) as any[]) {
      const m = (documents[c.master_document_id] ??= { sent: 0, waiting: 0, approved: 0 });
      m.sent += 1;
      const v = copyView(db, c);
      if (v.open || v.waiting_label) m.waiting += 1;
      if (v.in_force_label != null && v.in_force_label === masterInEffect(db, c.master_document_id)?.label) m.approved += 1;
    }
    res.json({ repository: true, organization_id: repo.organizationId, organization_name: repo.organizationName, can_send: hasModuleEditAccess(repo.labId, req.userId, "veritapolicy"), documents });
  });

  // Where one master can go: every laboratory of the organization, and why one can't. Names of laboratories only.
  app.get(`${R}/shared/masters/:id/targets`, authMiddleware, labScopeMiddleware, closedToStaff, requireModuleEdit("veritapolicy"), repository, (req: any, res: any) => {
    const db = sqlite();
    const doc = masterDoc(req, res);
    if (!doc) return;
    const master = doc.archived_at ? null : masterInEffect(db, doc.id);
    const copies = new Map<number, any>((db.prepare(`${COPY_SQL} WHERE c.master_document_id = ?`).all(doc.id) as any[]).map((c) => [c.lab_id, c]));
    const labs = organizationLabs(db, req.repository.organizationId).map((l) => {
      const c = copies.get(l.id);
      const refusal = labRefusal(l, shared);
      const state = c ? copyState(c) : null;
      const has = !!c && !!master && c.document_id != null && hasReceived(db, c.id, c.document_id, master.version.id);
      return {
        lab_id: l.id, lab_name: labLabel(l), clia_number: l.clia_number,
        state: state ?? "not_sent", has_version: has, waiting: c?.waiting_master_version_id != null,
        can_send: !refusal && (state == null || (state === "following" && !has)),
        why: refusal ?? (state === "declined" ? "It declined this document. It can take it up again itself." : state === "own_copy" ? "It keeps its own copy. It can follow again itself." : has ? "It already has this version." : null),
      };
    });
    const inOrg = new Set(labs.map((l) => l.lab_id));
    const groups = rollupGroupsFor(db, req.userId).groups
      .filter((g) => g.organization_id == null || g.organization_id === req.repository.organizationId)
      .map((g) => ({ id: g.id, name: g.name, kind: g.kind, lab_ids: g.lab_ids.filter((id) => inOrg.has(id)) })).filter((g) => g.lab_ids.length);
    res.json({
      document: { id: doc.id, title: doc.title, doc_number: doc.doc_number ?? null, approved_label: master?.label ?? null, revision_in_progress: revisionInProgress(doc), archived: !!doc.archived_at },
      organization_name: req.repository.organizationName, labs, groups,
    });
  });

  // POST body: { all?: true, groupId?, labIds? }. Each laboratory is its own transaction; a lab outside the organization refuses the
  // whole request and nothing is sent.
  app.post(`${R}/shared/masters/:id/send`, ...edit, repository, (req: any, res: any) => {
    const db = sqlite();
    const doc = masterDoc(req, res);
    if (!doc) return;
    if (doc.archived_at) return res.status(409).json({ error: "This document is archived. Restore it before sending it.", code: "ARCHIVED" });
    const master = masterInEffect(db, doc.id);
    if (!master) return res.status(409).json({ error: "Only an approved version can be sent. Finish this document's approval first.", code: "NOT_APPROVED" });
    const labs = new Map(organizationLabs(db, req.repository.organizationId).map((l) => [l.id, l]));
    let ids: number[];
    if (req.body?.all === true) ids = [...labs.keys()];
    else if (req.body?.groupId != null) {
      const g = rollupGroupsFor(db, req.userId).groups.find((x) => x.id === Number(req.body.groupId) && (x.organization_id == null || x.organization_id === req.repository.organizationId));
      if (!g) return res.status(404).json({ error: "That group isn't one of yours.", code: "GROUP_NOT_FOUND" });
      ids = g.lab_ids.filter((id) => labs.has(id));
    } else {
      if (!Array.isArray(req.body?.labIds)) return res.status(400).json({ error: "Pick the laboratories to send it to.", code: "NO_LABS" });
      const asked = (req.body.labIds as unknown[]).map(whole);
      if (asked.some((n) => n == null)) return res.status(400).json({ error: "Pick the laboratories to send it to.", code: "NO_LABS" });
      ids = [...new Set(asked as number[])];
      const outside = ids.filter((id) => !labs.has(id));
      if (outside.length) return res.status(400).json({ error: "A laboratory on that list isn't in this organization. Nothing was sent.", code: "LAB_NOT_IN_ORGANIZATION" });
    }
    if (!ids.length) return res.status(400).json({ error: "Pick the laboratories to send it to.", code: "NO_LABS" });
    if (ids.length > SEND_LABS_MAX) return res.status(400).json({ error: `Send to up to ${SEND_LABS_MAX} laboratories at a time.`, code: "TOO_MANY" });
    let buffer: Buffer;
    try {
      buffer = masterFile(master);
    } catch (err: any) {
      return res.status(409).json({ error: err instanceof FileChanged ? "The file on record no longer matches its fingerprint, so it can't be sent. Upload and approve it again." : "The file couldn't be read.", code: "FILE_CHANGED" });
    }
    const received: Received[] = [];
    const results = ids.map((labId) => {
      const lab = labs.get(labId)!;
      const base = { lab_id: labId, lab_name: labLabel(lab) };
      const refusal = labRefusal(lab, shared);
      if (refusal) return { ...base, outcome: "refused", message: refusal };
      try {
        return db.transaction(() => {
          // The row is made once per master and laboratory, so the same send twice, or two at once, finds it here.
          db.prepare(
            `INSERT OR IGNORE INTO policy_shared_copies (organization_id, master_lab_id, master_document_id, master_title, master_doc_number, lab_id, sent_by, sent_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
          ).run(req.repository.organizationId, req.repository.labId, doc.id, doc.title, doc.doc_number ?? null, labId, req.userId);
          const copy = db.prepare(`${COPY_SQL} WHERE c.master_document_id = ? AND c.lab_id = ?`).get(doc.id, labId) as any;
          const state = copyState(copy);
          if (state === "declined") return { ...base, outcome: "refused", message: "It declined this document. It can take it up again itself." };
          if (state === "own_copy") return { ...base, outcome: "refused", message: "It keeps its own copy. It can follow again itself." };
          if (copy.document_id == null) {
            received.push(receiveAsNew(db, copy, master, buffer, "sent", req.userId));
            return { ...base, outcome: "sent", message: `Version ${master.label} is a draft there.` };
          }
          const out = deliver(db, copy, master, buffer, "sent", req.userId);
          if (out.outcome === "delivered") { received.push(out.received); return { ...base, outcome: "revision", message: `Version ${master.label} is a draft revision there.` }; }
          if (out.outcome === "waiting") return { ...base, outcome: "waiting", message: `A revision is already open there, so version ${master.label} waits.` };
          return { ...base, outcome: "already", message: `It already has version ${master.label}.` };
        })();
      } catch (err: any) {
        console.error("[dc shared] send", labId, err?.message || err);
        return { ...base, outcome: "refused", message: "It couldn't be sent there. Try that laboratory again." };
      }
    });
    const arrived = results.filter((r) => r.outcome === "sent" || r.outcome === "revision").map((r) => r.lab_id);
    audit(req, { labId: req.scope.labId, documentId: doc.id, action: "system_document_sent", details: { master_version_id: master.version.id, version: master.label, lab_ids: arrived, outcomes: results.map((r) => ({ lab_id: r.lab_id, outcome: r.outcome })) } });
    for (const r of received) tell(db, shared, r, req.repository.organizationName, master.label, req.userId);
    res.json({ version: master.label, results, sent: arrived.length });
  });

  // ── The laboratory's side ──

  const ownCopy = (req: any, res: any): any => {
    const id = whole(req.params.copyId);
    const c = id == null ? null : (sqlite().prepare(`${COPY_SQL} WHERE c.id = ? AND c.lab_id = ?`).get(id, req.scope.labId) as any);
    if (!c) res.status(404).json({ error: "Not found" });
    return c;
  };
  const docOf = (c: any): any => (c.document_id == null ? null : (sqlite().prepare("SELECT * FROM policy_documents WHERE id = ? AND lab_id = ?").get(c.document_id, c.lab_id) as any));
  const after = (req: any, res: any, copyId: number) => res.json({ ok: true, copy: copyView(sqlite(), sqlite().prepare(`${COPY_SQL} WHERE c.id = ?`).get(copyId)) });

  app.get(`${R}/shared/received`, ...read, (req: any, res: any) => {
    const db = sqlite();
    const labId = req.scope.labId;
    const canAct = !req.scope?.viaVlsSupport && hasModuleEditAccess(labId, req.userId, "veritapolicy");
    const items = (db.prepare(`${COPY_SQL} WHERE c.lab_id = ? ORDER BY c.master_title COLLATE NOCASE, c.id`).all(labId) as any[]).map((c) => copyView(db, c));
    res.json({ items, can_act: canAct, waiting: items.filter((i) => needsLab(i)).length });
  });

  // Decline. A document this laboratory never approved is archived with the reason. A new version of one it has is withdrawn, and
  // the document stands again as it was approved. Body: { reason }.
  app.post(`${R}/shared/received/:copyId/decline`, ...edit, (req: any, res: any) => {
    const db = sqlite();
    const c = ownCopy(req, res);
    if (!c) return;
    const reason = String(req.body?.reason ?? "").replace(/\s+/g, " ").trim();
    if (reason.length < 3) return res.status(400).json({ error: "Say why, so the system can read it.", code: "REASON_REQUIRED" });
    if (reason.length > DECLINE_REASON_MAX) return res.status(400).json({ error: `Keep the reason to ${DECLINE_REASON_MAX} characters.`, code: "REASON_TOO_LONG" });
    const phi = detectPhi(reason);
    if (phi.length) return res.status(400).json({ error: "That reason looks like patient information. Say why without it.", code: "PHI_REFUSED", matched: phi });
    const doc = docOf(c);
    if (c.status !== "following" || !doc || doc.archived_at) return res.status(409).json({ error: "There's nothing here to decline.", code: "NOTHING_TO_DECLINE" });
    if (doc.status === "in_review") return res.status(409).json({ error: "It's in review. Reject it or recall it first.", code: "IN_REVIEW" });
    if (doc.status !== "draft" || !isReceivedVersion(db, doc.current_version_id)) return res.status(409).json({ error: "There's no version from the system waiting here. To stop following it, make it your own copy.", code: "NOTHING_TO_DECLINE" });
    const label = labelOf(db, doc.current_version_id);
    const declinedMaster = (db.prepare("SELECT master_version_id FROM policy_shared_versions WHERE version_id = ?").get(doc.current_version_id) as any)?.master_version_id ?? null;
    const neverApproved = doc.approved_version_id == null;
    db.transaction(() => {
      const before = { status: doc.status, version_id: doc.current_version_id, archived_at: doc.archived_at };
      if (neverApproved) db.prepare("UPDATE policy_documents SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(doc.id);
      else db.prepare("UPDATE policy_documents SET current_version_id = approved_version_id, status = 'approved', updated_at = datetime('now') WHERE id = ?").run(doc.id);
      db.prepare(
        `UPDATE policy_shared_copies SET status = ?, declined_master_version_id = ?, declined_label = ?, declined_reason = ?, declined_by = ?, declined_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      ).run(neverApproved ? "declined" : "following", declinedMaster, label, reason, req.userId, c.id);
      audit(req, { labId: c.lab_id, documentId: doc.id, action: neverApproved ? "system_document_declined" : "system_version_declined", details: { system_version: label, reason, before, after: neverApproved ? { archived: true } : { status: "approved", version_id: doc.approved_version_id } } });
    })();
    if (!neverApproved) { try { deliverWaiting(db, doc.id, shared); } catch (err: any) { console.error("[dc shared] waiting after decline:", err?.message || err); } }
    after(req, res, c.id);
  });

  // Follow again, after declining or keeping its own copy: the document comes back as it was, and the system's approved version comes
  // in as a draft if this laboratory doesn't have it.
  app.post(`${R}/shared/received/:copyId/resume`, ...edit, (req: any, res: any) => {
    const db = sqlite();
    const c = ownCopy(req, res);
    if (!c) return;
    if (c.status === "following") return res.status(409).json({ error: "Your laboratory already follows it.", code: "ALREADY_FOLLOWING" });
    if (copyState({ ...c, status: "following" }) !== "following") return res.status(409).json({ error: "The system document isn't available to your laboratory now.", code: "NOT_AVAILABLE" });
    const master = masterInEffect(db, c.master_document_id);
    let buffer: Buffer | null = null;
    try { buffer = master ? masterFile(master) : null; } catch { buffer = null; }
    let got: Received | null = null;
    db.transaction(() => {
      const doc = docOf(c);
      db.prepare("UPDATE policy_shared_copies SET status = 'following', detached_by = NULL, detached_at = NULL, declined_master_version_id = NULL, declined_label = NULL, declined_reason = NULL, declined_by = NULL, declined_at = NULL, updated_at = datetime('now') WHERE id = ?").run(c.id);
      if (doc?.archived_at && c.status === "declined") {
        db.prepare("UPDATE policy_documents SET archived_at = NULL, doc_number = ?, updated_at = datetime('now') WHERE id = ?").run(numberFree(db, c.lab_id, doc.doc_number, doc.id) ? doc.doc_number : null, doc.id);
      }
      audit(req, { labId: c.lab_id, documentId: doc?.id ?? null, action: "system_document_followed", details: { before: { status: c.status, reason: c.declined_reason ?? null }, after: { status: "following" } } });
      if (!master || !buffer) return;
      const fresh = db.prepare(`${COPY_SQL} WHERE c.id = ?`).get(c.id) as any;
      if (!doc) got = receiveAsNew(db, fresh, master, buffer, "resumed", req.userId);
      else {
        const out = deliver(db, fresh, master, buffer, "resumed", req.userId, c.status === "declined");
        if (out.outcome === "delivered") got = out.received;
      }
    })();
    if (got && master) tell(db, shared, got, c.organization_name, master.label, req.userId);
    after(req, res, c.id);
  });

  // "Make it our own copy": stops following, keeps the document, its versions, its signatures and its trail.
  app.post(`${R}/shared/received/:copyId/own-copy`, ...edit, (req: any, res: any) => {
    const db = sqlite();
    const c = ownCopy(req, res);
    if (!c) return;
    if (c.status !== "following" || c.document_id == null) return res.status(409).json({ error: "Your laboratory doesn't follow it.", code: "NOT_FOLLOWING" });
    db.transaction(() => {
      db.prepare("UPDATE policy_shared_copies SET status = 'own_copy', detached_by = ?, detached_at = datetime('now'), waiting_master_version_id = NULL, waiting_master_label = NULL, waiting_since = NULL, updated_at = datetime('now') WHERE id = ?").run(req.userId, c.id);
      audit(req, { labId: c.lab_id, documentId: c.document_id, action: "system_document_own_copy", details: { before: { status: "following" }, after: { status: "own_copy" } } });
    })();
    after(req, res, c.id);
  });

  // This laboratory already has its own procedure: the received version becomes a draft revision of that document, whose approved
  // version stays in force, and the received draft is archived. Body: { documentId }.
  app.post(`${R}/shared/received/:copyId/use-existing`, ...edit, (req: any, res: any) => {
    const db = sqlite();
    const c = ownCopy(req, res);
    if (!c) return;
    const placeholder = docOf(c);
    if (copyState(c) !== "following" || !placeholder || placeholder.archived_at || placeholder.status !== "draft" || placeholder.approved_version_id != null || !isReceivedVersion(db, placeholder.current_version_id)) {
      return res.status(409).json({ error: "Your own document can be used only while the received one is a draft nobody has approved.", code: "NOT_A_NEW_DRAFT" });
    }
    const targetId = whole(req.body?.documentId);
    const target = targetId == null ? null : (db.prepare("SELECT * FROM policy_documents WHERE id = ? AND lab_id = ?").get(targetId, c.lab_id) as any);
    if (!target || target.archived_at || target.id === placeholder.id) return res.status(404).json({ error: "That document isn't in this laboratory.", code: "DOCUMENT_NOT_FOUND" });
    if (target.status !== "approved" && target.status !== "expired") return res.status(409).json({ error: "A draft or a review is open on that document. Finish it first, so nobody's work is replaced.", code: "REVISION_OPEN" });
    if (copyOfDocument(db, target.id)) return res.status(409).json({ error: "That document already came from a system document.", code: "ALREADY_SHARED" });
    if (db.prepare("SELECT 1 FROM policy_addenda WHERE addendum_document_id = ? AND removed_at IS NULL").get(target.id)) return res.status(409).json({ error: "That document is a site addendum. Pick the procedure itself.", code: "IS_ADDENDUM" });
    const master = masterInEffect(db, c.master_document_id);
    if (!master) return res.status(409).json({ error: "The system document has no approved version now.", code: "NOT_APPROVED" });
    let buffer: Buffer;
    try { buffer = masterFile(master); } catch { return res.status(409).json({ error: "The system's file couldn't be read.", code: "FILE_CHANGED" }); }
    let got!: Received;
    db.transaction(() => {
      got = receiveInto(db, { copy: c, documentId: target.id, master, buffer, how: "linked", by: req.userId, first: false });
      // An addendum written on the received draft goes with the procedure it is for.
      db.prepare("UPDATE policy_addenda SET document_id = ? WHERE lab_id = ? AND document_id = ? AND removed_at IS NULL").run(target.id, c.lab_id, placeholder.id);
      db.prepare("UPDATE policy_documents SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(placeholder.id);
      audit(req, { labId: c.lab_id, documentId: placeholder.id, action: "archived", details: { title: placeholder.title, replaced_by_document_id: target.id } });
      audit(req, { labId: c.lab_id, documentId: target.id, action: "system_document_linked", details: { system_version: master.label, received_draft_document_id: placeholder.id, before: { status: target.status, version_id: target.current_version_id }, after: { status: "draft", version_id: got.versionId, approved_version_id: target.current_version_id } } });
    })();
    tell(db, shared, got, c.organization_name, master.label, req.userId);
    after(req, res, c.id);
  });

  // Take the version that is waiting, now. It replaces an open draft only when that draft is an earlier system version still in draft.
  app.post(`${R}/shared/received/:copyId/take`, ...edit, (req: any, res: any) => {
    const db = sqlite();
    const c = ownCopy(req, res);
    if (!c) return;
    const doc = docOf(c);
    if (copyState(c) !== "following" || c.waiting_master_version_id == null || !doc || doc.archived_at) return res.status(409).json({ error: "No newer version is waiting.", code: "NOTHING_WAITING" });
    if (doc.status === "in_review") return res.status(409).json({ error: "The open version is in review. Reject it or recall it first.", code: "IN_REVIEW" });
    if (doc.status === "draft" && !isReceivedVersion(db, doc.current_version_id)) return res.status(409).json({ error: "The open draft is your laboratory's own. Finish it first, so nobody's work is replaced.", code: "REVISION_OPEN" });
    const master = masterInEffect(db, c.master_document_id);
    if (!master) return res.status(409).json({ error: "The system document has no approved version now.", code: "NOT_APPROVED" });
    let buffer: Buffer;
    try { buffer = masterFile(master); } catch { return res.status(409).json({ error: "The system's file couldn't be read.", code: "FILE_CHANGED" }); }
    const out = db.transaction(() => deliver(db, c, master, buffer, "taken", req.userId, true))() as Delivery;
    if (out.outcome === "delivered") tell(db, shared, out.received, c.organization_name, master.label, req.userId);
    after(req, res, c.id);
  });

  // Who owns the document here: recall, review reminders and the overdue notice go to this person. Body: { userId }.
  app.get(`${R}/shared/received/:copyId/owners`, ...edit, (req: any, res: any) => {
    const c = ownCopy(req, res);
    if (!c) return;
    const people = (sqlite().prepare(
      `SELECT u.id AS user_id, u.name, u.email FROM users u
        WHERE COALESCE(u.vls_support, 0) = 0 AND (u.id = (SELECT owner_user_id FROM labs WHERE id = ?) OR EXISTS (SELECT 1 FROM lab_members m WHERE m.lab_id = ? AND m.user_id = u.id AND m.status = 'active'))
        ORDER BY COALESCE(u.name, u.email) COLLATE NOCASE`
    ).all(c.lab_id, c.lab_id) as any[]).filter((p) => hasModuleEditAccess(c.lab_id, p.user_id, "veritapolicy"));
    res.json({ people: people.map((p) => ({ user_id: p.user_id, name: p.name || p.email })) });
  });
  app.put(`${R}/shared/received/:copyId/owner`, ...edit, (req: any, res: any) => {
    const db = sqlite();
    const c = ownCopy(req, res);
    if (!c) return;
    const doc = docOf(c);
    const userId = whole(req.body?.userId);
    const here = userId != null && (db.prepare("SELECT 1 FROM labs WHERE id = ? AND owner_user_id = ? UNION SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active'").get(c.lab_id, userId, c.lab_id, userId));
    if (!doc || !here || isVlsSupportUser(db, userId!) || !hasModuleEditAccess(c.lab_id, userId!, "veritapolicy")) return res.status(400).json({ error: "Pick someone in this laboratory who can edit VeritaDC™.", code: "NOT_AN_EDITOR" });
    if (doc.owner_user_id !== userId) {
      db.prepare("UPDATE policy_documents SET owner_user_id = ?, updated_at = datetime('now') WHERE id = ?").run(userId, doc.id);
      audit(req, { labId: c.lab_id, documentId: doc.id, action: "document_owner_changed", details: { before: { owner_user_id: doc.owner_user_id }, after: { owner_user_id: userId } } });
    }
    after(req, res, c.id);
  });

  // ── Addenda ──

  // Add one: a file, or typed text. It is a VeritaDC document of this laboratory, a draft until it is approved here.
  app.post(`${R}/documents/:id/addenda`, ...edit, deps.upload.single("file"), async (req: any, res: any) => {
    const db = sqlite();
    const labId = req.scope.labId;
    const id = whole(req.params.id);
    const parent = id == null ? null : (db.prepare("SELECT * FROM policy_documents WHERE id = ? AND lab_id = ?").get(id, labId) as any);
    if (!parent) return res.status(404).json({ error: "Not found" });
    const c = copyOfDocument(db, parent.id);
    if (parent.archived_at || !c || c.status === "declined") return res.status(409).json({ error: "An addendum goes on a document your laboratory received from its system.", code: "NOT_A_SYSTEM_DOCUMENT" });
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!req.file && !text) return res.status(400).json({ error: "Choose a file or type the addendum.", code: "NOTHING_TO_ADD" });
    if (text.length > 100_000) return res.status(400).json({ error: "That text is too long. Upload it as a file.", code: "TEXT_TOO_LONG" });
    const buffer: Buffer = req.file ? req.file.buffer : Buffer.from(text, "utf-8");
    const format = req.file ? canonicalFormatFromMimeAndName(req.file.mimetype, req.file.originalname, buffer) : "txt";
    if (!format) return res.status(400).json({ error: `Accepted files: ${ACCEPTED_DOC_DESCRIPTION}. The file's contents must match its type.` });
    const phi = await checkUploadForPhi(buffer, format);
    const title = String(req.body?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || `${parent.title}: site addendum`;
    let documentId = 0, versionId = 0;
    try {
      db.transaction(() => {
        documentId = insertDocument(db, {
          labId, manualId: parent.manual_id ?? null, title, description: null, ownerId: req.userId, months: reviewMonths(db, labId, parent.doc_type ?? null),
          routeId: defaultRoute(db, labId), number: null, type: parent.doc_type ?? null,
        });
        versionId = addVersion(db, { labId, documentId, buffer, format, summary: "Initial upload", major: false, uploadedBy: req.userId }).versionId;
        db.prepare("INSERT INTO policy_addenda (lab_id, document_id, addendum_document_id, created_by) VALUES (?, ?, ?, ?)").run(labId, parent.id, documentId, req.userId);
        audit(req, { labId, documentId, action: "uploaded", details: { version_number: 1, version_label: "1.0", file_format: format, file_size_bytes: buffer.length, file_hash_sha256: hashBuffer(buffer), addendum_to_document_id: parent.id } });
        audit(req, { labId, documentId: parent.id, action: "addendum_added", details: { addendum_document_id: documentId, title } });
      })();
    } catch (err: any) {
      console.error("[dc shared] addendum", err?.message || err);
      return res.status(500).json({ error: "The addendum couldn't be saved." });
    }
    res.status(201).json({ id: documentId, version_id: versionId, title, phiWarning: phi.message ?? null });
  });

  // Take an addendum off the document. The addendum stays a document of this laboratory, with its history.
  app.delete(`${R}/documents/:id/addenda/:addendumId`, ...edit, (req: any, res: any) => {
    const db = sqlite();
    const row = db.prepare("SELECT * FROM policy_addenda WHERE lab_id = ? AND document_id = ? AND addendum_document_id = ? AND removed_at IS NULL")
      .get(req.scope.labId, whole(req.params.id) ?? -1, whole(req.params.addendumId) ?? -1) as any;
    if (!row) return res.status(404).json({ error: "Not found" });
    db.prepare("UPDATE policy_addenda SET removed_at = datetime('now'), removed_by = ? WHERE id = ?").run(req.userId, row.id);
    audit(req, { labId: req.scope.labId, documentId: row.document_id, action: "addendum_removed", details: { addendum_document_id: row.addendum_document_id, before: { on: true }, after: { on: false } } });
    res.json({ ok: true });
  });

  // Who approved a version and when, as its signatures in VeritaDC say. A document brought over from a prior system has that system's
  // own record, and a completed IQCP its approver's.
  const approvedByOf = (db: any, labId: number, documentId: number, versionId: number): string[] => {
    const tz = labTimeZoneById(db, labId);
    const day = (at: string | null) => (at ? usDate(labLocalDate(/[TZ]/.test(at) ? at : `${at.replace(" ", "T")}Z`, false, tz)) : "");
    const signed = db.prepare(
      `SELECT s.typed_signature, s.signed_at, s.comment, st.step_name FROM policy_signoffs s LEFT JOIN policy_approval_steps st ON st.id = s.workflow_step_id
        WHERE s.document_id = ? AND s.version_id = ? AND s.action = 'approved' ORDER BY s.signed_at, s.id`
    ).all(documentId, versionId) as any[];
    if (signed.length) {
      return signed.map((s) => {
        const delegate = String(s.comment ?? "").match(/[Signed as delegate for (.+?) (user #d+)]/);
        return `${s.typed_signature}${delegate ? `, as delegate for ${delegate[1]}` : ""}, ${day(s.signed_at)}${s.step_name ? ` (${s.step_name})` : ""}`;
      });
    }
    const carried = db.prepare("SELECT source_system, last_approval_or_review FROM policy_carried_records WHERE document_id = ? AND version_id = ?").get(documentId, versionId) as any;
    if (carried) {
      const last = usDate(carried.last_approval_or_review);
      return [`Approved in ${carried.source_system}${last ? `, last approval or review ${last}` : ""}. The signature face page on this document's VeritaDC™ record shows who signed and when.`];
    }
    const iqcp = db.prepare("SELECT approved_by_name, approved_at FROM iqcp_plans WHERE document_id = ? AND lab_id = ?").get(documentId, labId) as any;
    return iqcp?.approved_by_name ? [[iqcp.approved_by_name, day(iqcp.approved_at ?? null)].filter(Boolean).join(", ")] : [];
  };

  // One print order: the document, then its addenda, as one PDF. A Staff login gets the approved versions.
  app.get(`${R}/documents/:id/print.pdf`, authMiddleware, labScopeMiddleware, async (req: any, res: any) => {
    const db = sqlite();
    const labId = req.scope.labId;
    const id = whole(req.params.id);
    const doc = id == null ? null : (db.prepare("SELECT * FROM policy_documents WHERE id = ? AND lab_id = ?").get(id, labId) as any);
    if (!doc) return res.status(404).json({ error: "Not found" });
    const limited = !!req.dcStaff;
    const versionId = limited ? req.dcStaffRead?.versionId ?? null : doc.current_version_id;
    const v = versionId == null ? null : (db.prepare("SELECT * FROM policy_versions WHERE id = ? AND document_id = ?").get(versionId, doc.id) as any);
    if (!v) return res.status(404).json({ error: "Not found" });
    const lab = db.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(labId) as any;
    const c = copyOfDocument(db, doc.id);
    const today = deps.today();
    // What page 1 says of a part: how it stands, its dates, and who approved it.
    const standing = (d: any, vid: number) => {
      const live = approvedReadVersionId(d);
      const status: PrintStatus = d.archived_at ? "archived" : live === vid ? "in_force" : "draft";
      const other = status === "draft" && live != null ? (db.prepare("SELECT version_number, version_major, version_minor FROM policy_versions WHERE id = ?").get(live) as any) : null;
      return {
        status, inForceVersion: versionLabel(other), effective: d.effective_date ?? null, nextReview: d.next_review_date ?? null,
        reviewOverdue: status === "in_force" && (d.status === "expired" || (!!d.next_review_date && String(d.next_review_date).slice(0, 10) < today)),
        approvedBy: status === "in_force" ? approvedByOf(db, labId, d.id, vid) : [],
      };
    };
    const fillOf = (documentId: number, effective: string | null): Record<string, string> => ({
      LAB_NAME: lab?.lab_name || "", CLIA_NUMBER: lab?.clia_number || "Not on file", EFFECTIVE_DATE: effective || "Upon approval",
      DIRECTOR_NAME: (db.prepare("SELECT typed_signature FROM policy_signoffs WHERE document_id = ? AND action = 'approved' ORDER BY signed_at DESC LIMIT 1").get(documentId) as any)?.typed_signature || "Medical Director or Designee",
    });
    const parts = [
      { fill: fillOf(doc.id, doc.effective_date ?? null), heading: c ? "System document" : "Document", title: doc.title, number: doc.doc_number ?? null, version: versionLabel(v), systemVersion: labelOf(db, v.id), ...standing(doc, v.id), format: v.file_format, file: v.file_path, hash: v.file_hash_sha256 },
      ...addendaOf(db, labId, doc.id, limited).filter((x) => x.version_id != null).map((x, i) => {
        const av = db.prepare("SELECT * FROM policy_versions WHERE id = ?").get(x.version_id) as any;
        const ad = db.prepare("SELECT * FROM policy_documents WHERE id = ?").get(x.document_id) as any;
        return { fill: fillOf(x.document_id, ad.effective_date ?? null), heading: `Site addendum ${i + 1}`, title: x.title, number: x.doc_number, version: x.version_label, systemVersion: null, ...standing(ad, av.id), format: av.file_format, file: av.file_path, hash: av.file_hash_sha256 };
      }),
    ];
    try {
      const pdf = await documentPrintPdf(parts.map((p) => ({ ...p, buffer: readVersionBuffer(p.file) })), { labName: lab?.lab_name ?? null, clia: lab?.clia_number ?? null, from: c?.organization_name ?? null, printedOn: today });
      audit(req, { labId, documentId: doc.id, action: "printed", details: { version_id: v.id, parts: parts.length } });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${String(doc.title).replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80)}.pdf"`);
      res.send(pdf);
    } catch (err: any) {
      if (err instanceof CannotCombine) return res.status(409).json({ error: err.message, code: "CANNOT_COMBINE" });
      console.error("[dc print]", err?.message || err);
      res.status(500).json({ error: "The print copy couldn't be made. Download each file instead." });
    }
  });

  // ── Across the organization ──

  const viewFor = (req: any, res: any): { rows: SystemDocumentRow[]; labs: RollupLabRow[] } | null => {
    const labs = deps.rollupLabsForRequest(sqlite(), req);
    if (!labs) { res.status(403).json({ error: "A VeritaAssure subscription is required", code: "PLAN_REQUIRED" }); return null; }
    return { rows: systemDocumentsView(sqlite(), req.userId, labs), labs };
  };

  app.get("/api/system-documents", authMiddleware, (req: any, res: any) => {
    const v = viewFor(req, res);
    if (!v) return;
    // The organizations this person runs, or whose documents are listed, and the repository lab of each, named only to someone who can work in it.
    const runs = managedOrganizations(sqlite(), req.userId);
    const orgs = [...new Set([...runs.map((o) => o.id), ...v.rows.map((r) => r.organization_id)])];
    const repositories = orgs.flatMap((o) => {
      const l = sqlite().prepare("SELECT id FROM labs WHERE organization_id = ? AND is_repository = 1 AND retired_at IS NULL ORDER BY id LIMIT 1").get(o) as any;
      const org = runs.find((x) => x.id === o);
      if (l && hasModuleEditAccess(l.id, req.userId, "veritapolicy")) return [{ organization_id: o, organization_name: org?.name ?? null, lab_id: l.id as number | null }];
      return org && !l ? [{ organization_id: o, organization_name: org.name, lab_id: null }] : [];
    });
    res.json({ documents: v.rows, labs: v.labs.map((l) => ({ lab_id: l.id, lab_name: l.lab_name, clia_number: l.clia_number, organization_id: l.organization_id, organization_name: l.organization_name })), repositories });
  });

  // ?org=<id>&group=<id|none>&state=<state>, the screen's own filters.
  app.get("/api/system-documents/export.xlsx", authMiddleware, async (req: any, res: any) => {
    const v = viewFor(req, res);
    if (!v) return;
    const org = whole(req.query?.org);
    const groups = rollupGroupsFor(sqlite(), req.userId).groups;
    const groupRaw = String(req.query?.group ?? "");
    const group = groups.find((g) => g.id === Number(groupRaw)) ?? null;
    if (groupRaw && groupRaw !== "none" && groupRaw !== "all" && !group) return res.status(404).json({ error: "That group isn't one of yours.", code: "GROUP_NOT_FOUND" });
    const grouped = new Set(groups.flatMap((g) => g.lab_ids));
    const state = String(req.query?.state ?? "");
    const keep = (l: SystemLabRow) => (group ? group.lab_ids.includes(l.lab_id) : groupRaw === "none" ? !grouped.has(l.lab_id) : true) && (!state || l.state === state);
    const rows = v.rows.filter((r) => org == null || r.organization_id === org).map((r) => ({ ...r, labs: r.labs.filter(keep) })).filter((r) => r.labs.length);
    const names = [...new Set(rows.map((r) => r.organization_name).filter(Boolean))].join(", ") || "Your laboratories";
    try {
      const filter = [group ? `Lab group: ${group.name}.` : groupRaw === "none" ? "Laboratories not in a group." : "All laboratories in your readiness roll-up.", state && (SYSTEM_LAB_STATE_LABEL as any)[state] ? `Status: ${(SYSTEM_LAB_STATE_LABEL as any)[state]}.` : ""].filter(Boolean).join(" ");
      const buf = await systemDocumentsWorkbook(rows, { forWhom: names, filter, today: deps.today() }, (wb) => deps.stampWorkbook(wb, req));
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="VeritaDC_System_Documents_${deps.today()}.xlsx"`);
      res.send(buf);
    } catch (err: any) {
      console.error("[system-documents export]", err?.message || err);
      res.status(500).json({ error: "The Excel file couldn't be made." });
    }
  });
}

/** True when a received document is waiting on its laboratory: a version to approve, one in line behind it, or a retired master. */
export function needsLab(i: { state: SystemCopyState; open: boolean; waiting_label: string | null; document_id: number | null; archived: boolean }): boolean {
  if (i.document_id == null || i.archived) return false;
  return (i.state === "following" && (i.open || i.waiting_label != null)) || i.state === "retired";
}
