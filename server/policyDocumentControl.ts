// server/policyDocumentControl.ts
//
// VeritaDC document control (B13, part 1), each on the rules the module already has. A limited Staff login gets none of it: it
// reads the approved version only (BUG-151), and every route here answers it 404, as if it weren't there.
//   - earlier versions open for editors and for the approvers on a document's route, and nobody else;
//   - archived documents: editors list them, open them and restore one; nobody else reads one by any document route;
//   - restore puts a document back exactly as it was archived. It approves nothing, and Veritas support can't do it, because it
//     can put an approved procedure back in use (server/vlsSupport.ts);
//   - bulk approval: the documents waiting on the signed-in person's own step, signed with one typed name and one password,
//     each through the same function a single approval uses (recordApprovalDecision in routes.ts), so each has its own
//     signature row and audit row. A document that moved since the list was shown is refused and the rest still go. There is
//     no bulk reject: a rejection is written about one document;
//   - the lab's email notice choices (server/policyNotices.ts), changed by the lab's own owner or an admin.

import { checkAuthToken } from "./sessionAuth";
import { isVlsSupportUser, labAllowsVlsSupport } from "./vlsSupport";
import { canUserApproveStepDelegated, isVersionMajorRevision, versionAuthorId, writeAuditLog } from "./veritapolicyApproval";
import { staffOwnScope, staffSelfSeat } from "./competencySelfEntry";
import { labTimeZoneById, labToday } from "./dateLocal";
import { labNoticeSettings, notifyStepSigners } from "./policyNotices";
import { noteMasterArchived } from "./policySharedDocuments";
import { orderManualTree } from "@shared/manualTree";
import { docNumberKey, versionLabel } from "../shared/policyVersion";
import { BULK_APPROVE_MAX, OVERDUE_SIGN_DAYS } from "../shared/policyNotices";

type CanEdit = (labId: number, userId: number, module: string) => boolean;

/**
 * In front of every read under /documents/:id: an archived document reads as not found to anyone who can't edit VeritaDC. Before
 * B13 nothing listed one, and a member who knew its number could still open it. A limited Staff login is already refused by
 * veritaDcStaffGuard, and the writes have their own checks.
 */
export function archivedDocumentGuard(sqlite: any, hasModuleEditAccess: CanEdit) {
  return (req: any, res: any, next: any) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const id = Number(req.params?.id); // as the routes below read it, so no other spelling of a number gets past
    const labId = Number(req.params?.labId);
    if (!Number.isFinite(id) || !Number.isFinite(labId)) return next();
    const doc = sqlite.prepare("SELECT archived_at FROM policy_documents WHERE id = ? AND lab_id = ?").get(id, labId) as any;
    if (!doc?.archived_at) return next();
    const auth = req.headers?.authorization;
    const check: any = auth?.startsWith("Bearer ") ? checkAuthToken(sqlite, auth.slice(7)) : { ok: false };
    if (!check.ok) return next(); // the route's own check answers
    if (mayReadArchived(sqlite, labId, check.userId, hasModuleEditAccess)) return next();
    return res.status(404).json({ error: "Not found" });
  };
}

export function mayReadArchived(sqlite: any, labId: number, userId: number, hasModuleEditAccess: CanEdit): boolean {
  return hasModuleEditAccess(labId, userId, "veritapolicy") || (isVlsSupportUser(sqlite, userId) && labAllowsVlsSupport(sqlite, labId));
}

/**
 * Whether this person may open a document's earlier versions: a VeritaDC editor (or support, which sets VeritaDC up), or someone
 * who can sign a step of the document's route today. Never a limited Staff login, even one named on a step: a tech reads the
 * approved version only. A reviewer who can only view has no screen to sign on, so isn't an approver and reads as before.
 */
export function mayOpenEarlierVersions(sqlite: any, labId: number, documentId: number, userId: number, hasModuleEditAccess: CanEdit): boolean {
  if (staffOwnScope(sqlite, userId, labId, "veritapolicy")) return false;
  if (mayReadArchived(sqlite, labId, userId, hasModuleEditAccess)) return true;
  if (!staffSelfSeat(sqlite, userId, labId)) return false; // without edit, signing is done from My sign-offs
  const doc = sqlite.prepare("SELECT owner_user_id, manual_id, current_version_id, workflow_id FROM policy_documents WHERE id = ? AND lab_id = ?").get(documentId, labId) as any;
  if (!doc?.workflow_id) return false;
  const today = labToday(labTimeZoneById(sqlite, labId));
  return (sqlite.prepare(
    "SELECT required_role, specific_user_id, approver_group_id, allow_self_approval FROM policy_approval_steps WHERE workflow_id = ? AND archived_at IS NULL"
  ).all(doc.workflow_id) as any[]).some((stepRow) => canUserApproveStepDelegated(sqlite, {
    userId, labId, documentOwnerId: versionAuthorId(sqlite, doc), stepRow, isMajorRevision: isVersionMajorRevision(sqlite, doc.current_version_id), manualId: doc.manual_id ?? null,
  }, today).ok);
}

export interface ApprovalDecision { status: number; body: any }
export interface ApprovalDecisionInput {
  action: "approved" | "rejected";
  documentId: number;
  labId: number;
  userId: number;
  typedSignature: string;
  comment?: string | null;
  ip?: string | null;
  userAgent?: string;
  // What the signer was shown. When given, a document on another version or step is refused (code MOVED).
  expect?: { versionId: number; stepId: number };
}

export function registerPolicyDocumentControlRoutes(app: any, deps: {
  sqlite: () => any;
  authMiddleware: any;
  labScopeMiddleware: any;
  requireWriteAccess: any;
  requireModuleEdit: (module: string) => any;
  hasModuleEditAccess: CanEdit;
  verifyElectronicSignature: (userId: number, typedSignature: unknown, password: unknown) => Promise<ApprovalDecision | null>;
  recordApprovalDecision: (o: ApprovalDecisionInput) => ApprovalDecision;
}) {
  const { sqlite, authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit, hasModuleEditAccess } = deps;
  const R = "/api/labs/:labId/veritapolicy";
  const closedToStaff = (req: any, res: any, next: any) => (req.dcStaff ? res.status(404).json({ error: "Not found" }) : next());
  const read = [authMiddleware, labScopeMiddleware, closedToStaff];
  const edit = [authMiddleware, labScopeMiddleware, closedToStaff, requireWriteAccess, requireModuleEdit("veritapolicy")];
  const canEdit = (labId: number, userId: number) => hasModuleEditAccess(labId, userId, "veritapolicy");
  const agent = (req: any) => req.headers["user-agent"] as string | undefined;

  // ── Archived documents ──

  app.get(`${R}/archived-documents`, ...read, (req: any, res: any) => {
    const db = sqlite();
    const labId = req.scope.labId;
    if (!mayReadArchived(db, labId, req.userId, hasModuleEditAccess)) return res.status(403).json({ error: "Archived documents are for VeritaDC™ editors.", code: "EDITORS_ONLY" });
    const paths = new Map<number, string>(
      orderManualTree(db.prepare("SELECT id, parent_id, name, display_order FROM policy_manuals WHERE lab_id = ?").all(labId) as any[]).map((m: any): [number, string] => [m.id, m.path])
    );
    const rows = db.prepare(
      `SELECT d.id, d.lab_id, d.title, d.description, d.doc_number, d.doc_type, d.status, d.manual_id, d.owner_user_id, d.archived_at, d.effective_date, d.next_review_date,
              d.review_interval_months, d.workflow_id, d.current_version_id, d.created_at, d.updated_at,
              v.version_number, v.version_major, v.version_minor, v.file_format,
              (SELECT u.name FROM policy_audit_log a LEFT JOIN users u ON u.id = a.user_id
                WHERE a.document_id = d.id AND a.action = 'archived' ORDER BY a.id DESC LIMIT 1) AS archived_by
         FROM policy_documents d
         LEFT JOIN policy_versions v ON v.id = d.current_version_id
        WHERE d.lab_id = ? AND d.archived_at IS NOT NULL
        ORDER BY d.archived_at DESC, d.id DESC`
    ).all(labId) as any[];
    res.json({
      documents: rows.map(({ version_number, version_major, version_minor, file_format, ...d }) => ({
        ...d,
        manual_path: d.manual_id != null ? paths.get(d.manual_id) ?? null : null,
        current_version_number: version_number,
        current_version_label: versionLabel({ version_number, version_major, version_minor }),
        current_file_format: file_format,
      })),
      // The screen offers Restore only to someone the route below would let through.
      can_restore: canEdit(labId, req.userId),
    });
  });

  // POST /documents/:id/restore. The document comes back as it was archived: same status, version, approval and dates.
  app.post(`${R}/documents/:id/restore`, ...edit, (req: any, res: any) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Bad id" });
    const db = sqlite();
    const labId = req.scope.labId;
    const doc = db.prepare("SELECT id, lab_id, title, doc_number, status, archived_at, current_version_id, approved_version_id, next_review_date FROM policy_documents WHERE id = ?").get(id) as any;
    if (!doc) return res.status(404).json({ error: "Not found" });
    if (doc.lab_id !== labId) return res.status(403).json({ error: "Wrong lab" });
    if (!doc.archived_at) return res.status(409).json({ error: "This document isn't archived.", code: "NOT_ARCHIVED" });
    // Document numbers are unique among active documents, so its number may have been taken while it was archived.
    if (doc.doc_number) {
      const taken = (db.prepare("SELECT title, doc_number FROM policy_documents WHERE lab_id = ? AND archived_at IS NULL AND doc_number IS NOT NULL AND id <> ?").all(labId, id) as any[])
        .find((o) => docNumberKey(o.doc_number) === docNumberKey(doc.doc_number));
      if (taken) {
        return res.status(409).json({ error: `Document number ${doc.doc_number} is now on "${taken.title}". Change that document's number first.`, code: "DOC_NUMBER_TAKEN" });
      }
    }
    const done = db.prepare("UPDATE policy_documents SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL").run(id);
    if (done.changes !== 1) return res.status(409).json({ error: "This document isn't archived.", code: "NOT_ARCHIVED" });
    writeAuditLog(db, {
      labId, documentId: id, userId: req.userId, action: "restored",
      details: { title: doc.title, from: { archived_at: doc.archived_at }, to: { archived_at: null }, status: doc.status, version_id: doc.current_version_id, approved_version_id: doc.approved_version_id },
      ipAddress: req.ip, userAgent: agent(req),
    });
    noteMasterArchived(db, id, true);
    res.json({ ok: true, restored: id, status: doc.status, next_review_date: doc.next_review_date });
  });

  // ── Email notices ──

  app.get(`${R}/settings/email-notices`, ...read, (req: any, res: any) => {
    const manages = !req.scope?.viaVlsSupport && ["owner", "admin"].includes(String(req.scope?.role || ""));
    res.json({ ...labNoticeSettings(sqlite(), req.scope.labId), dayChoices: OVERDUE_SIGN_DAYS, canEdit: manages });
  });

  // PUT body: { approvalEmails?, overdueEmails?, overdueDays? }; what isn't sent stays as it is.
  app.put(`${R}/settings/email-notices`, ...edit, (req: any, res: any) => {
    if (req.scope?.viaVlsSupport || !["owner", "admin"].includes(String(req.scope?.role || ""))) {
      return res.status(403).json({ error: "Only the lab's owner or an admin can change the email notices.", code: "OWNER_OR_ADMIN_ONLY" });
    }
    const db = sqlite();
    const labId = req.scope.labId;
    const b = req.body || {};
    for (const k of ["approvalEmails", "overdueEmails"]) {
      if (b[k] !== undefined && typeof b[k] !== "boolean") return res.status(400).json({ error: `${k} must be true or false`, code: "BAD_VALUE" });
    }
    if (b.overdueDays !== undefined && !(OVERDUE_SIGN_DAYS as readonly number[]).includes(b.overdueDays)) {
      return res.status(400).json({ error: `Pick ${OVERDUE_SIGN_DAYS.join(", ")} days.`, code: "BAD_VALUE" });
    }
    const before = labNoticeSettings(db, labId);
    const after = { approvalEmails: b.approvalEmails ?? before.approvalEmails, overdueEmails: b.overdueEmails ?? before.overdueEmails, overdueDays: b.overdueDays ?? before.overdueDays };
    const changed = (Object.keys(after) as (keyof typeof after)[]).some((k) => after[k] !== before[k]);
    if (changed) {
      db.prepare("UPDATE labs SET dc_notify_approvers = ?, dc_notify_overdue_signs = ?, dc_overdue_sign_days = ? WHERE id = ?")
        .run(after.approvalEmails ? 1 : 0, after.overdueEmails ? 1 : 0, after.overdueDays, labId);
      writeAuditLog(db, { labId, userId: req.userId, action: "email_notices_changed", details: { from: before, to: after }, ipAddress: req.ip, userAgent: agent(req) });
    }
    res.json({ ok: true, ...after });
  });

  // ── Bulk approval ──

  // POST body: { typedSignature, password, items: [{ documentId, versionId, stepId }] }, the items as the signer's list showed
  // them (GET .../pending-reviews). The name and password are checked once; each document then stands on its own.
  app.post(`${R}/approvals/bulk`, ...edit, async (req: any, res: any) => {
    const labId = req.scope.labId;
    const { typedSignature, password, items } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "Pick the documents to approve.", code: "NO_ITEMS" });
    if (items.length > BULK_APPROVE_MAX) return res.status(400).json({ error: `Approve up to ${BULK_APPROVE_MAX} documents at a time.`, code: "TOO_MANY" });
    const picked: { documentId: number; versionId: number; stepId: number }[] = items.map((i: any) => ({ documentId: i?.documentId, versionId: i?.versionId, stepId: i?.stepId }));
    if (picked.some((i) => ![i.documentId, i.versionId, i.stepId].every((n) => Number.isInteger(n) && n > 0))) {
      return res.status(400).json({ error: "Each document needs its version and step as the list showed them.", code: "BAD_ITEM" });
    }
    if (new Set(picked.map((i) => i.documentId)).size !== picked.length) return res.status(400).json({ error: "A document is listed twice.", code: "DUPLICATE" });
    const refusal = await deps.verifyElectronicSignature(req.userId, typedSignature, password);
    if (refusal) return res.status(refusal.status).json(refusal.body);
    const db = sqlite();
    const results = picked.map((i) => {
      const row = db.prepare("SELECT title FROM policy_documents WHERE id = ? AND lab_id = ?").get(i.documentId, labId) as any;
      let out: ApprovalDecision;
      try {
        out = row
          ? deps.recordApprovalDecision({
              action: "approved", documentId: i.documentId, labId, userId: req.userId, typedSignature: String(typedSignature),
              ip: req.ip, userAgent: agent(req), expect: { versionId: i.versionId, stepId: i.stepId },
            })
          : { status: 404, body: { error: "That document isn't in this lab." } };
      } catch (err: any) {
        console.error("[dc bulk approve]", i.documentId, err?.message || err);
        out = { status: 500, body: { error: "This one couldn't be recorded. Try it on its own." } };
      }
      const ok = out.status === 200;
      return {
        documentId: i.documentId, title: row?.title ?? null, ok,
        status: ok ? out.body.status : null, nextStep: ok ? out.body.nextStep ?? null : null,
        code: ok ? null : out.body.code ?? null, message: ok ? null : out.body.error,
      };
    });
    notifyStepSigners(db, { labId, documentIds: results.filter((r) => r.ok && r.status === "in_review").map((r) => r.documentId), actorUserId: req.userId, canEdit });
    res.json({ results, signed: results.filter((r) => r.ok).length, refused: results.filter((r) => !r.ok).length });
  });
}
