// server/policyShareLinks.ts
//
// VeritaDC share link for ONE document (Michael 2026-11-09: "If a lab wants to give access to a specimen collection
// policy to say nursing, how can we hyperlink that out?"). Surveyor links (routes.ts "Phase 8") open the whole approved
// library for at most 90 days, and Staff Portal logins need an account; neither fits handing nursing one document.
//
// The rules:
//   - An editor (VeritaDC edit, write access, the lab's own document) creates a link with an optional label. The token is
//     crypto.randomUUID(). A document with no approved current version (a draft, one in review, or retired) is refused 409.
//   - The link never pins a version. Every public read looks up the document's CURRENT version at request time, and shows
//     it only while the document is approved or review-overdue ('expired') and not retired, the same rule a limited Staff
//     login reads by (server/policyReadSign.ts veritaDcStaffGuard). So a newly approved revision shows on the same link,
//     and while a revision sits in draft or review the link reads as not active.
//   - Unknown, revoked, or a document with no approved version right now: one identical 404 body, so a token can't be
//     probed. The public routes take only the token: no document id, version id or lab id is read from the request.
//   - The public answers carry the lab's name and CLIA, the document's number, title, version, effective date and approval
//     date, and the file. Never signatures, the sign-off list, the audit trail, other documents or anyone's name.
//   - Revoking keeps the row (revoked_at, revoked_by). Create and revoke write policy_audit_log rows.

import crypto from "crypto";
import { versionLabel } from "../shared/policyVersion";
import {
  DOC_MIME,
  hashBuffer,
  htmlForStoredFormat,
  inlineDocContentType,
  readVersionBuffer,
  renderDocxToHtml,
  writeAuditLog,
} from "./veritapolicyApproval";

export const SHARE_LINK_NOT_ACTIVE = "This link is not active. Contact the laboratory.";
// Document states a share link shows: approved, or approved with its review overdue. Draft, in review and retired never.
export const SHARE_LINK_STATUSES = ["approved", "expired"] as const;
const LABEL_MAX = 120;

type SharedVersion = {
  document_id: number;
  lab_id: number;
  title: string;
  doc_number: string | null;
  effective_date: string | null;
  version_id: number;
  version_number: number;
  version_major: number | null;
  version_minor: number | null;
  file_path: string;
  file_format: string;
  expected_hash: string | null;
  lab_name: string | null;
  clia_number: string | null;
};

/** The version a share link shows for this document right now, or null when it shows nothing. Read at request time. */
export function sharedVersionFor(sqlite: any, documentId: number, labId: number): SharedVersion | null {
  return (
    (sqlite
      .prepare(
        `SELECT d.id AS document_id, d.lab_id, d.title, d.doc_number, d.effective_date,
                v.id AS version_id, v.version_number, v.version_major, v.version_minor, v.file_path, v.file_format,
                v.file_hash_sha256 AS expected_hash,
                l.lab_name, l.clia_number
           FROM policy_documents d
           JOIN policy_versions v ON v.id = d.current_version_id AND v.document_id = d.id
           JOIN labs l ON l.id = d.lab_id
          WHERE d.id = ? AND d.lab_id = ? AND d.archived_at IS NULL
            AND d.status IN (${SHARE_LINK_STATUSES.map(() => "?").join(", ")})`
      )
      .get(documentId, labId, ...SHARE_LINK_STATUSES) as SharedVersion | undefined) ?? null
  );
}

/** The live link and the version it shows, or null for an unknown token, a revoked link, or no approved version now. */
export function resolveShareToken(sqlite: any, token: string): { linkId: number; version: SharedVersion } | null {
  if (!token || token.length > 64) return null;
  const link = sqlite
    .prepare("SELECT id, lab_id, document_id, revoked_at FROM policy_share_links WHERE token = ?")
    .get(token) as { id: number; lab_id: number; document_id: number; revoked_at: string | null } | undefined;
  if (!link || link.revoked_at) return null;
  const version = sharedVersionFor(sqlite, link.document_id, link.lab_id);
  return version ? { linkId: link.id, version } : null;
}

// When this version was approved: the last approval signature on it in VeritaAssure, or, for a document carried over from
// the lab's prior system with no approval here, that system's last approval or review date for the same version.
function approvedDateFor(sqlite: any, v: SharedVersion): string | null {
  const signed = sqlite
    .prepare("SELECT MAX(signed_at) AS at FROM policy_signoffs WHERE document_id = ? AND version_id = ? AND action = 'approved'")
    .get(v.document_id, v.version_id) as { at: string | null } | undefined;
  if (signed?.at) return signed.at;
  const carried = sqlite
    .prepare("SELECT last_approval_or_review FROM policy_carried_records WHERE document_id = ? AND version_id = ?")
    .get(v.document_id, v.version_id) as { last_approval_or_review: string | null } | undefined;
  return carried?.last_approval_or_review ?? null;
}

function publicHeaders(res: any) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
}

function notActive(res: any) {
  return res.status(404).json({ error: SHARE_LINK_NOT_ACTIVE });
}

function fileName(v: SharedVersion): string {
  const base = [v.doc_number, v.title, `v${versionLabel(v) ?? v.version_number}`].filter(Boolean).join(" ");
  return `${base.replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "document"}.${v.file_format}`;
}

export function registerPolicyShareLinkRoutes(app: any, deps: {
  sqlite: () => any;
  authMiddleware: any;
  labScopeMiddleware: any;
  requireWriteAccess: any;
  requireModuleEdit: (module: string) => any;
  frontendUrl: string;
}) {
  const { sqlite, authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit } = deps;
  const BASE = "/api/labs/:labId/veritapolicy/documents/:id/share-links";
  const edit = [authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritapolicy")];

  // The document named in the path, only when it is this lab's (labScopeMiddleware has already checked the caller's
  // membership in the lab, which is where the sister-lab rule lives). Another lab's document reads as not found.
  const docInLab = (req: any) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return null;
    const doc = sqlite()
      .prepare("SELECT id, lab_id, title, status, archived_at FROM policy_documents WHERE id = ?")
      .get(id) as { id: number; lab_id: number; title: string; status: string; archived_at: string | null } | undefined;
    return doc && doc.lab_id === req.scope.labId ? doc : null;
  };

  // POST — create. Body: { label? }.
  app.post(BASE, ...edit, (req: any, res: any) => {
    const doc = docInLab(req);
    if (!doc) return res.status(404).json({ error: "Not found" });
    if (!sharedVersionFor(sqlite(), doc.id, doc.lab_id)) {
      const why = doc.archived_at ? "is retired" : doc.status === "in_review" ? "is in review" : doc.status === "draft" ? "is a draft" : `is ${doc.status}`;
      return res.status(409).json({
        error: `Only an approved document can be shared. This document ${why}, so it has no approved version to show.`,
        code: "NO_APPROVED_VERSION",
      });
    }
    const raw = req.body?.label;
    const label = typeof raw === "string" && raw.trim() ? raw.trim().slice(0, LABEL_MAX) : null;
    const token = crypto.randomUUID();
    const result = sqlite()
      .prepare("INSERT INTO policy_share_links (lab_id, document_id, token, label, created_by) VALUES (?, ?, ?, ?, ?)")
      .run(doc.lab_id, doc.id, token, label, req.userId);
    const id = Number(result.lastInsertRowid);
    writeAuditLog(sqlite(), {
      labId: doc.lab_id,
      documentId: doc.id,
      userId: req.userId,
      action: "share_link_created",
      details: { link_id: id, label },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
    });
    res.status(201).json({ id, token, url: `${deps.frontendUrl || ""}/policy/${token}` });
  });

  // GET — this document's links, active and revoked, with view counts. Each row carries the token, which opens the
  // document without a login, so it takes the same edit check as the surveyor link list.
  app.get(BASE, authMiddleware, labScopeMiddleware, requireModuleEdit("veritapolicy"), (req: any, res: any) => {
    const doc = docInLab(req);
    if (!doc) return res.status(404).json({ error: "Not found" });
    const shareable = !!sharedVersionFor(sqlite(), doc.id, doc.lab_id);
    const rows = sqlite()
      .prepare(
        `SELECT s.id, s.token, s.label, s.created_at, s.revoked_at, s.view_count, s.last_viewed_at,
                cu.name AS created_by_name, ru.name AS revoked_by_name
           FROM policy_share_links s
           LEFT JOIN users cu ON cu.id = s.created_by
           LEFT JOIN users ru ON ru.id = s.revoked_by
          WHERE s.lab_id = ? AND s.document_id = ?
          ORDER BY s.revoked_at IS NOT NULL, s.created_at DESC, s.id DESC`
      )
      .all(doc.lab_id, doc.id) as any[];
    res.json({
      shareable,
      links: rows.map((r) => ({
        ...r,
        path: `/policy/${r.token}`,
        status: r.revoked_at ? "revoked" : shareable ? "active" : "not_showing",
      })),
    });
  });

  // DELETE /:linkId — revoke. Keeps the row.
  app.delete(`${BASE}/:linkId`, ...edit, (req: any, res: any) => {
    const doc = docInLab(req);
    if (!doc) return res.status(404).json({ error: "Not found" });
    const linkId = Number(req.params.linkId);
    const link = Number.isInteger(linkId)
      ? (sqlite().prepare("SELECT id, revoked_at FROM policy_share_links WHERE id = ? AND document_id = ? AND lab_id = ?").get(linkId, doc.id, doc.lab_id) as
          | { id: number; revoked_at: string | null }
          | undefined)
      : undefined;
    if (!link) return res.status(404).json({ error: "Not found" });
    if (link.revoked_at) return res.json({ ok: true, alreadyRevoked: true });
    sqlite().prepare("UPDATE policy_share_links SET revoked_at = datetime('now'), revoked_by = ? WHERE id = ?").run(req.userId, link.id);
    writeAuditLog(sqlite(), {
      labId: doc.lab_id,
      documentId: doc.id,
      userId: req.userId,
      action: "share_link_revoked",
      details: { link_id: link.id },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
    });
    res.json({ ok: true });
  });

  // ── Public, no login ──────────────────────────────────────────────────────────

  // GET — what the page shows about the document. Counts a view.
  app.get("/api/public/policy-share/:token", (req: any, res: any) => {
    publicHeaders(res);
    const db = sqlite();
    const r = resolveShareToken(db, String(req.params.token || ""));
    if (!r) return notActive(res);
    const v = r.version;
    try {
      db.prepare("UPDATE policy_share_links SET view_count = view_count + 1, last_viewed_at = datetime('now') WHERE id = ?").run(r.linkId);
    } catch {}
    res.json({
      lab_name: v.lab_name,
      clia_number: v.clia_number,
      doc_number: v.doc_number,
      title: v.title,
      version: versionLabel(v),
      effective_date: v.effective_date,
      approved_date: approvedDateFor(db, v),
    });
  });

  // GET /file — the version's file, the way the surveyor view serves it: PDF and images as the file, inline; Word and the
  // other formats as JSON holding HTML. ?download=1 sends the original file as an attachment.
  app.get("/api/public/policy-share/:token/file", async (req: any, res: any) => {
    publicHeaders(res);
    const r = resolveShareToken(sqlite(), String(req.params.token || ""));
    if (!r) return notActive(res);
    const v = r.version;
    let buffer: Buffer;
    try {
      buffer = readVersionBuffer(v.file_path);
    } catch {
      return res.status(500).json({ error: "The file could not be read. Contact the laboratory." });
    }
    const tampered = !!v.expected_hash && hashBuffer(buffer) !== v.expected_hash;
    if (tampered) res.setHeader("X-VeritaPolicy-Tamper", "yes");
    res.setHeader("Access-Control-Expose-Headers", "X-VeritaPolicy-Tamper");
    const name = fileName(v);
    if (String(req.query?.download || "") === "1") {
      res.setHeader("Content-Type", (DOC_MIME as any)[v.file_format] || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
      return res.send(buffer);
    }
    if (v.file_format === "docx") {
      try {
        const rendered = await renderDocxToHtml(buffer);
        return res.json({ format: "html", html: rendered.html, tampered });
      } catch {
        return res.status(500).json({ error: "The file could not be shown. Use Download." });
      }
    }
    const inline = inlineDocContentType(v.file_format);
    if (inline) {
      res.setHeader("Content-Type", inline);
      res.setHeader("Content-Disposition", `inline; filename="${name}"`);
      return res.send(buffer);
    }
    res.json({ format: "html", html: await htmlForStoredFormat(buffer, v.file_format), tampered });
  });
}
