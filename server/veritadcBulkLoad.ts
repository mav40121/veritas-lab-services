// server/veritadcBulkLoad.ts
//
// Bulk load of a lab's current documents from its prior system into VeritaDC (Step E of Heywood's move out of MediaLab,
// 2026-11-06). scripts/veritadc-bulk-load.mts drives it one document at a time.
//
// What a carried-over document is: an approved document with the number, version and dates it held in the prior system.
// It never reads as approved on the load date. Its signature history is the prior system's signature face page, attached
// to the record; no policy_signoffs row is written, because those people did not sign in VeritaAssure.
//
// What the load never does: assign read-and-sign, or send any email. Review reminders stay held until the row's
// reminders_start_on (server/veritapolicyReminders.ts).
//
// Safe to rerun: a document already loaded is recognized by its number and left alone. Each document is one transaction,
// so a failure leaves nothing behind for that document and doesn't touch any other.

import fs from "fs";
import path from "path";
import { db } from "./db";
import { docNumberKey } from "../shared/policyVersion";
import { parseSourceVersion, validateCarriedMeta, type CarriedMeta } from "../shared/policyCarriedOver";
import {
  POLICY_STORAGE_ROOT,
  buildVersionRelativePath,
  canonicalFormatFromMimeAndName,
  hashBuffer,
  readVersionBuffer,
  resolveVersionFilePath,
  writeAuditLog,
  writeVersionBuffer,
} from "./veritapolicyApproval";
import { checkUploadForPhi } from "./phiUploadCheck";

// Stop before the volume fills: the database lives on the same volume, so a full disk would stop every customer.
export const DEFAULT_MIN_FREE_BYTES = 100 * 1024 * 1024;

export function volumeSpace(): { totalBytes: number; freeBytes: number } | null {
  try {
    fs.mkdirSync(POLICY_STORAGE_ROOT, { recursive: true });
    const s = fs.statfsSync(POLICY_STORAGE_ROOT);
    return { totalBytes: Number(s.blocks) * Number(s.bsize), freeBytes: Number(s.bavail) * Number(s.bsize) };
  } catch {
    return null;
  }
}

/** The manual at this path in this lab, creating whatever part of the path doesn't exist yet. Runs inside the document's transaction. */
function ensureManualPath(sqlite: any, labId: number, names: string[], ownerUserId: number, batch: string): number {
  const find = sqlite.prepare("SELECT id FROM policy_manuals WHERE lab_id = ? AND archived_at IS NULL AND name = ? AND parent_id IS ? ORDER BY id LIMIT 1");
  const add = sqlite.prepare("INSERT INTO policy_manuals (lab_id, name, description, display_order, parent_id) VALUES (?, ?, NULL, 0, ?)");
  let parent: number | null = null;
  for (const name of names) {
    const row = find.get(labId, name, parent) as { id: number } | undefined;
    if (row) {
      parent = row.id;
      continue;
    }
    const id: number = Number(add.run(labId, name, parent).lastInsertRowid);
    writeAuditLog(sqlite, {
      labId,
      userId: ownerUserId,
      action: "manual_created",
      details: { manual_id: id, name, parent_id: parent, bulk_load: batch },
    });
    parent = id;
  }
  return parent as number;
}

/** The carried-over record a screen shows, or null. File locations stay on the server. */
export function carriedRecordFor(sqlite: any, documentId: number) {
  const r = sqlite
    .prepare(
      `SELECT c.*, u.name AS owner_name, d.current_version_id, d.title AS current_title
         FROM policy_carried_records c
         JOIN policy_documents d ON d.id = c.document_id
         LEFT JOIN users u ON u.id = d.owner_user_id
        WHERE c.document_id = ?`
    )
    .get(documentId) as any;
  if (!r) return null;
  let alsoFiledIn: string[] = [];
  try {
    alsoFiledIn = JSON.parse(r.also_filed_in || "[]");
  } catch {
    alsoFiledIn = [];
  }
  return {
    source_system: r.source_system,
    source_number: r.source_number,
    source_version: r.source_version,
    title_as_exported: r.title_as_exported,
    effective_date: r.effective_date,
    last_approval_or_review: r.last_approval_or_review,
    next_review_due: r.next_review_due,
    author: r.author,
    approval_rows: r.approval_rows ?? 0,
    review_rows: r.review_rows ?? 0,
    version_count: r.version_count ?? 0,
    source_manual: r.source_manual,
    also_filed_in: alsoFiledIn,
    has_face_page: !!r.face_page_path,
    has_original: !!r.original_path,
    original_filename: r.original_filename,
    converted_from: r.converted_from,
    loaded_at: r.loaded_at,
    loaded_by: r.loaded_by,
    owner_name: r.owner_name,
    is_current_version: r.version_id === r.current_version_id,
  };
}

type LoadFiles = {
  document?: Express.Multer.File;
  face_page?: Express.Multer.File;
  original?: Express.Multer.File;
};

/** Load one document. Returns the HTTP status and body; never throws for a bad document. */
export async function loadOneDocument(sqlite: any, meta: CarriedMeta, files: LoadFiles, request: { ip?: string | null; userAgent?: string | null }) {
  const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => ({
    status,
    body: { result: "failed", code, error: message, docNumber: meta.docNumber, labId: meta.labId, ...extra },
  });

  const lab = sqlite.prepare("SELECT id, lab_name, owner_user_id FROM labs WHERE id = ?").get(meta.labId) as
    | { id: number; lab_name: string | null; owner_user_id: number }
    | undefined;
  if (!lab) return fail(404, "LAB_NOT_FOUND", "That lab doesn't exist.");
  // The name is checked so a wrong lab id in the plan can never put one customer's document in another customer's lab.
  if ((lab.lab_name || "") !== meta.expectedLabName) return fail(409, "LAB_MISMATCH", "That lab id doesn't match the lab name in the plan.");
  const ownerIsOnLab =
    lab.owner_user_id === meta.ownerUserId ||
    !!sqlite.prepare("SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active' LIMIT 1").get(meta.labId, meta.ownerUserId);
  if (!ownerIsOnLab) return fail(400, "OWNER_NOT_ON_LAB", "The document owner isn't an active member of this lab.");

  // Already loaded? A carried-over document counts even if the lab has since archived it, so a rerun never brings it back.
  const key = docNumberKey(meta.docNumber);
  const carried = (sqlite.prepare("SELECT document_id, source_number FROM policy_carried_records WHERE lab_id = ?").all(meta.labId) as any[]).find(
    (r) => docNumberKey(String(r.source_number)) === key
  );
  if (carried) return { status: 200, body: { result: "already_loaded", documentId: carried.document_id, docNumber: meta.docNumber, labId: meta.labId } };
  const sameNumber = (
    sqlite.prepare("SELECT id, doc_number FROM policy_documents WHERE lab_id = ? AND archived_at IS NULL AND doc_number IS NOT NULL").all(meta.labId) as any[]
  ).find((r) => docNumberKey(String(r.doc_number)) === key);
  if (sameNumber) return fail(409, "NUMBER_TAKEN", "A document the lab added itself already uses this number. It was left alone.", { documentId: sameNumber.id });

  const doc = files.document;
  if (!doc) return fail(400, "NO_FILE", "The document file is missing.");
  const face = files.face_page;
  if (!face) return fail(400, "NO_FACE_PAGE", "The signature face page is missing.");
  const format = canonicalFormatFromMimeAndName(doc.mimetype, doc.originalname, doc.buffer);
  if (!format) return fail(400, "BAD_FORMAT", "VeritaDC doesn't accept this file type, or the file's contents don't match its type.");
  if (canonicalFormatFromMimeAndName(face.mimetype, face.originalname, face.buffer) !== "html") {
    return fail(400, "BAD_FACE_PAGE", "The signature face page must be an HTML file.");
  }
  if (meta.convertedFrom && !files.original) return fail(400, "NO_ORIGINAL", "A converted document must keep its original file.");

  const incoming = doc.size + face.size + (files.original?.size ?? 0);
  const space = volumeSpace();
  const minFree = meta.minFreeBytes ?? DEFAULT_MIN_FREE_BYTES;
  if (space && space.freeBytes - incoming < minFree) {
    return fail(507, "VOLUME_LOW", "Not enough room on the volume. Nothing was written for this document.", {
      freeBytes: space.freeBytes,
      incomingBytes: incoming,
      minFreeBytes: minFree,
    });
  }

  // Warn, never block, the same as a person's upload. Labels only reach the result file.
  const phi = await checkUploadForPhi(doc.buffer, format);

  const parts = parseSourceVersion(meta.version)!;
  const docHash = hashBuffer(doc.buffer);
  const faceHash = hashBuffer(face.buffer);
  const originalHash = files.original ? hashBuffer(files.original.buffer) : null;
  const written: string[] = [];
  const save = (rel: string, buffer: Buffer) => {
    writeVersionBuffer(rel, buffer);
    written.push(rel);
    return rel;
  };

  const run = sqlite.transaction(() => {
    const manualId = ensureManualPath(sqlite, meta.labId, meta.manualPath, meta.ownerUserId, meta.batch);
    const documentId = Number(
      sqlite
        .prepare(
          `INSERT INTO policy_documents
             (lab_id, manual_id, title, status, owner_user_id, effective_date, next_review_date,
              review_interval_months, workflow_id, doc_number, created_at, updated_at)
           VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, NULL, ?, datetime('now'), ?)`
        )
        // updated_at is the screen's Updated column and the list's sort: the document last changed when it was last approved
        // or reviewed, not on the day it was loaded. created_at and the audit row hold the load date.
        .run(meta.labId, manualId, meta.title, meta.ownerUserId, meta.effectiveDate, meta.nextReviewDue, meta.reviewIntervalMonths, meta.docNumber, meta.lastApprovalOrReview ?? meta.effectiveDate).lastInsertRowid
    );
    const docRel = save(buildVersionRelativePath(meta.labId, documentId, 1, format), doc.buffer);
    const versionId = Number(
      sqlite
        .prepare(
          `INSERT INTO policy_versions
             (document_id, version_number, file_path, file_format, file_size_bytes, file_hash_sha256,
              change_summary, is_major_revision, uploaded_by, uploaded_at, version_major, version_minor)
           VALUES (?, 1, ?, ?, ?, ?, ?, 0, ?, datetime('now'), ?, ?)`
        )
        .run(documentId, docRel, format, doc.size, docHash, `Carried over from ${meta.sourceSystem}, version ${meta.version}`, meta.ownerUserId, parts.major, parts.minor)
        .lastInsertRowid
    );
    // Loaded approved, so this version is the approved version (BUG-151, server/policyApprovedVersion.ts).
    sqlite.prepare("UPDATE policy_documents SET current_version_id = ?, approved_version_id = ? WHERE id = ?").run(versionId, versionId, documentId);
    const faceRel = save(`${meta.labId}/${documentId}/carried/face-page.html`, face.buffer);
    let originalRel: string | null = null;
    if (files.original) {
      const ext = (path.extname(files.original.originalname).replace(".", "").toLowerCase().match(/^[a-z0-9]{1,8}$/) || ["bin"])[0];
      originalRel = save(`${meta.labId}/${documentId}/carried/original.${ext}`, files.original.buffer);
    }
    sqlite
      .prepare(
        `INSERT INTO policy_carried_records
           (lab_id, document_id, version_id, source_system, source_number, source_status, source_version, title_as_exported,
            effective_date, last_approval_or_review, next_review_due, author, approval_rows, review_rows, version_count,
            source_manual, also_filed_in, face_page_path, face_page_bytes, face_page_sha256,
            original_path, original_filename, original_bytes, original_sha256, converted_from, reminders_start_on, batch, loaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        meta.labId, documentId, versionId, meta.sourceSystem, meta.docNumber, meta.sourceStatus, meta.version, meta.titleAsExported,
        meta.effectiveDate, meta.lastApprovalOrReview, meta.nextReviewDue, meta.author, meta.approvalRows, meta.reviewRows, meta.versionCount,
        meta.manualPath.join(" / "), JSON.stringify(meta.alsoFiledIn), faceRel, face.size, faceHash,
        originalRel, files.original ? meta.originalFilename || files.original.originalname : null, files.original?.size ?? null, originalHash,
        meta.convertedFrom, meta.remindersStartOn, meta.batch, meta.loadedBy
      );
    // loaded_by comes first because the audit trail screen shows the first few details: this row is under the owner's id,
    // but the load was run by Veritas Lab Services and the document was approved long before it.
    writeAuditLog(sqlite, {
      labId: meta.labId,
      documentId,
      userId: meta.ownerUserId,
      action: "carried_over",
      details: {
        loaded_by: meta.loadedBy,
        source_system: meta.sourceSystem,
        source_version: meta.version,
        source_number: meta.docNumber,
        effective_date: meta.effectiveDate,
        last_approval_or_review: meta.lastApprovalOrReview,
        next_review_due: meta.nextReviewDue,
        file_format: format,
        file_size_bytes: doc.size,
        file_hash_sha256: docHash,
        face_page_sha256: faceHash,
        original_sha256: originalHash,
        converted_from: meta.convertedFrom,
        batch: meta.batch,
        phi_found: phi.found,
      },
      ipAddress: request.ip ?? null,
      userAgent: request.userAgent ?? null,
    });
    return { documentId, versionId, manualId };
  });

  try {
    const out = run();
    return {
      status: 201,
      body: {
        result: "loaded",
        docNumber: meta.docNumber,
        labId: meta.labId,
        ...out,
        format,
        phiChecked: phi.checked,
        phiFound: phi.found,
        bytes: { document: doc.size, facePage: face.size, original: files.original?.size ?? 0 },
      },
    };
  } catch (err: any) {
    for (const rel of written) {
      try {
        fs.rmSync(resolveVersionFilePath(rel), { force: true });
      } catch {
        /* the row is gone either way; an orphan file is harmless */
      }
    }
    console.error("[veritadc bulk load] document failed:", err?.message);
    return fail(500, "WRITE_FAILED", "The document could not be saved. Nothing was kept for it.");
  }
}

/** Counts only, for the load script's preflight and the check after a load. Reads, and writes nothing. */
export function bulkLoadStatus(sqlite: any, labId: number) {
  const lab = sqlite.prepare("SELECT id, lab_name, owner_user_id FROM labs WHERE id = ?").get(labId) as any;
  if (!lab) return null;
  const n = (sql: string, ...args: unknown[]) => Number((sqlite.prepare(sql).get(...args) as { n: number }).n);
  const docs = sqlite
    .prepare("SELECT status, COUNT(*) AS n FROM policy_documents WHERE lab_id = ? AND archived_at IS NULL GROUP BY status")
    .all(labId) as { status: string; n: number }[];
  const carriedDocs = "(SELECT document_id FROM policy_carried_records WHERE lab_id = ?)";
  return {
    labId,
    labName: lab.lab_name,
    ownerUserId: lab.owner_user_id,
    documents: {
      active: docs.reduce((a, d) => a + d.n, 0),
      byStatus: Object.fromEntries(docs.map((d) => [d.status, d.n])),
      carried: n("SELECT COUNT(*) AS n FROM policy_carried_records WHERE lab_id = ?", labId),
      carriedWithFacePage: n("SELECT COUNT(*) AS n FROM policy_carried_records WHERE lab_id = ? AND face_page_path IS NOT NULL", labId),
      carriedWithOriginal: n("SELECT COUNT(*) AS n FROM policy_carried_records WHERE lab_id = ? AND original_path IS NOT NULL", labId),
    },
    manuals: { active: n("SELECT COUNT(*) AS n FROM policy_manuals WHERE lab_id = ? AND archived_at IS NULL", labId) },
    // These stay 0 through a load: nobody signs, nobody is assigned, and no reminder has gone out.
    forCarried: {
      signoffs: n(`SELECT COUNT(*) AS n FROM policy_signoffs WHERE document_id IN ${carriedDocs}`, labId),
      attestations: n(`SELECT COUNT(*) AS n FROM policy_attestations WHERE document_id IN ${carriedDocs}`, labId),
      staffSignatures: n(`SELECT COUNT(*) AS n FROM staff_portal_policy_signatures WHERE document_id IN ${carriedDocs}`, labId),
      reminders: n(`SELECT COUNT(*) AS n FROM policy_review_reminders WHERE document_id IN ${carriedDocs}`, labId),
      // Read-and-sign history carried over afterward (server/veritadcHistoryLoad.ts): not a signature in VeritaAssure, so the three above stay 0.
      priorSignatures: n(`SELECT COUNT(*) AS n FROM policy_prior_signatures WHERE document_id IN ${carriedDocs}`, labId),
    },
    carriedNumbers: (sqlite.prepare("SELECT source_number FROM policy_carried_records WHERE lab_id = ? ORDER BY source_number").all(labId) as any[]).map((r) => r.source_number),
    volume: volumeSpace(),
    databaseBytes: n("SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()"),
  };
}

function sendStored(sqlite: any, res: any, row: any, which: "face" | "original", audit: { labId: number; userId?: number | null; documentId: number; ip?: string; userAgent?: string } | null) {
  const rel = which === "face" ? row.face_page_path : row.original_path;
  if (!rel) return res.status(404).json({ error: "Not on file" });
  let buffer: Buffer;
  try {
    buffer = readVersionBuffer(rel);
  } catch (err: any) {
    console.error("[carried file read]", err?.message);
    return res.status(500).json({ error: "File missing on server" });
  }
  const expected = which === "face" ? row.face_page_sha256 : row.original_sha256;
  const actual = hashBuffer(buffer);
  if (expected && actual !== expected) {
    res.setHeader("X-VeritaPolicy-Tamper", "yes");
    if (audit) {
      writeAuditLog(sqlite, {
        labId: audit.labId,
        documentId: audit.documentId,
        userId: audit.userId ?? row.owner_user_id,
        action: "tamper_detected",
        details: { expected_hash: expected, actual_hash: actual, surface: which === "face" ? "carried_face_page" : "carried_original" },
        ipAddress: audit.ip,
        userAgent: audit.userAgent,
      });
    }
  }
  res.setHeader("Access-Control-Expose-Headers", "X-VeritaPolicy-Tamper");
  if (which === "face") {
    // A page exported from another system: it never runs script, even opened directly.
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'");
    res.setHeader("Content-Disposition", 'inline; filename="signature-face-page.html"');
  } else {
    const safe = String(row.original_filename || "original").replace(/[^A-Za-z0-9._ -]+/g, "_").slice(0, 120);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  }
  return res.send(buffer);
}

const carriedFileRow = (sqlite: any, documentId: number) =>
  sqlite
    .prepare(
      `SELECT c.face_page_path, c.face_page_sha256, c.original_path, c.original_sha256, c.original_filename,
              d.lab_id, d.status, d.owner_user_id
         FROM policy_carried_records c JOIN policy_documents d ON d.id = c.document_id
        WHERE c.document_id = ?`
    )
    .get(documentId) as any;

export function registerBulkLoadRoutes(
  app: any,
  deps: {
    adminSecret: string | undefined;
    authMiddleware: any;
    labScopeMiddleware: any;
    resolveSurveyorToken: (token: string) => { ok: true; labId: number; linkId: number } | { ok: false; status: number; error: string };
  }
) {
  const sqlite = () => (db as any).$client;
  const upload = require("multer")({
    storage: require("multer").memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024, files: 3 },
  });
  const adminOnly = (req: any, res: any, next: any) => {
    const secret = req.headers["x-admin-secret"] as string | undefined;
    if (!deps.adminSecret || !secret || secret !== deps.adminSecret) return res.status(403).json({ error: "Forbidden" });
    next();
  };

  // POST /api/admin/veritadc/bulk-load/document. Multipart: meta (JSON, shared/policyCarriedOver.ts), document, face_page, original.
  app.post(
    "/api/admin/veritadc/bulk-load/document",
    adminOnly,
    upload.fields([{ name: "document", maxCount: 1 }, { name: "face_page", maxCount: 1 }, { name: "original", maxCount: 1 }]),
    async (req: any, res: any) => {
      let parsed: any = null;
      try {
        parsed = JSON.parse(String(req.body?.meta ?? ""));
      } catch {
        return res.status(400).json({ result: "failed", code: "BAD_META", error: "meta must be JSON" });
      }
      const check = validateCarriedMeta(parsed);
      if (!check.ok) return res.status(400).json({ result: "failed", code: "BAD_META", error: "The record is missing or has a bad value.", problems: check.problems });
      const f = req.files || {};
      const out = await loadOneDocument(
        sqlite(),
        check.value,
        { document: f.document?.[0], face_page: f.face_page?.[0], original: f.original?.[0] },
        { ip: req.ip, userAgent: String(req.headers["user-agent"] || "").slice(0, 200) }
      );
      res.status(out.status).json(out.body);
    }
  );

  // GET /api/admin/veritadc/bulk-load/status?labId=N. Counts and document numbers, nothing else.
  app.get("/api/admin/veritadc/bulk-load/status", adminOnly, (req: any, res: any) => {
    const labId = Number(req.query.labId);
    if (!Number.isInteger(labId) || labId <= 0) return res.status(400).json({ error: "labId required" });
    const out = bulkLoadStatus(sqlite(), labId);
    if (!out) return res.status(404).json({ error: "Lab not found" });
    res.json(out);
  });

  // The signature face page and the kept original, for anyone who can read the lab's documents.
  for (const [segment, which] of [["face-page", "face"], ["original", "original"]] as const) {
    app.get(`/api/labs/:labId/veritapolicy/documents/:id/carried/${segment}`, deps.authMiddleware, deps.labScopeMiddleware, (req: any, res: any) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
      const row = carriedFileRow(sqlite(), id);
      if (!row) return res.status(404).json({ error: "Not found" });
      if (row.lab_id !== req.scope.labId) return res.status(403).json({ error: "Wrong lab" });
      writeAuditLog(sqlite(), {
        labId: req.scope.labId,
        documentId: id,
        userId: req.userId,
        action: which === "face" ? "carried_face_page_opened" : "carried_original_downloaded",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] as string | undefined,
      });
      return sendStored(sqlite(), res, row, which, { labId: req.scope.labId, userId: req.userId, documentId: id, ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined });
    });
  }

  // The inspector link: the face page of an approved document in the link's lab.
  app.get("/api/surveyor/:token/policies/:id/carried/face-page", (req: any, res: any) => {
    const r = deps.resolveSurveyorToken(String(req.params.token || ""));
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const row = carriedFileRow(sqlite(), id);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.lab_id !== r.labId) return res.status(403).json({ error: "Wrong lab" });
    if (row.status !== "approved") return res.status(403).json({ error: "Not approved" });
    return sendStored(sqlite(), res, row, "face", { labId: r.labId, documentId: id });
  });
}
