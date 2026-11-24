// server/ptDocuments.ts
//
// The program's own report, a PDF or an image, attached to a VeritaPT event (B11, 2026-11-24). The bytes live in the row, as
// VeritaLab certificate documents do, and go out as a download. What it is comes from the file's own bytes, never the name or
// the type the browser sent. The file isn't read for results. A report can carry sample ids, so the upload gives the same
// patient-information warning the other uploads give: it warns and never blocks (server/phiUploadCheck.ts), and the screen says
// that a PDF or an image isn't read for it.
// An event is worked out from its results, so a report keeps their ids and shows on the event that holds most of them.
import type { Express } from "express";
import { createRequire } from "node:module";
import { checkUploadedFileForPhi } from "./phiUploadCheck";
import { ptAudit, ptEventOfResult, ptEventsOfLab, ptStaffOwn, type PtDeps } from "./ptEvents";
import { ptEventHolding } from "./ptReviews";
import { DOC_MIME, canonicalFormatFromMimeAndName } from "./veritapolicyApproval";
import type { PtEvent } from "@shared/ptEvents";

const MAX_BYTES = 20 * 1024 * 1024; // as VeritaLab certificate documents
const FORMATS = ["pdf", "png", "jpg"] as const;
const LIST = "id, result_ids_json, user_id, original_filename, file_size, mime_type, uploaded_at";
const idsOf = (s: unknown): number[] => { try { return (JSON.parse(String(s || "[]")) as unknown[]).map(Number); } catch { return []; } };

export interface PtEventDocument { id: number; original_filename: string; file_size: number; mime_type: string; uploaded_at: string; uploaded_by: string | null }

/** The reports attached to one event, newest first. */
export function ptEventDocuments(sqlite: any, labId: number, event: PtEvent, events: PtEvent[]): PtEventDocument[] {
  const names = sqlite.prepare("SELECT name FROM users WHERE id = ?");
  return (sqlite.prepare(`SELECT ${LIST} FROM pt_event_documents WHERE lab_id = ? ORDER BY id DESC`).all(labId) as any[])
    .filter((d) => ptEventHolding(events, idsOf(d.result_ids_json))?.key === event.key)
    .map((d) => ({ id: Number(d.id), original_filename: d.original_filename, file_size: Number(d.file_size), mime_type: d.mime_type, uploaded_at: d.uploaded_at, uploaded_by: (names.get(d.user_id) as any)?.name ?? null }));
}

export function registerPtDocumentRoutes(app: Express, deps: PtDeps) {
  const { sqlite, authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit, hasPTAccess } = deps;
  const multer = createRequire(import.meta.url)("multer");
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });
  const edit = [authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritapt")];
  const ROUTE = "/api/labs/:labId/pt/events/:resultId/documents";
  const plan = (req: any, res: any) => {
    if (hasPTAccess(req.user, req.scope?.lab)) return true;
    res.status(403).json({ error: "VeritaPT™ subscription required" });
    return false;
  };
  const oneFile = (req: any, res: any, next: any) => upload.single("file")(req, res, (err: any) => (err ? res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "The file is larger than 20 MB." : "The file could not be read." }) : next()));
  // A document of this lab that shows on this event, or null.
  const documentOf = (req: any): { doc: any; event: PtEvent } | null => {
    const labId = req.scope.labId, event = ptEventOfResult(sqlite(), labId, req.params.resultId);
    const doc = event ? (sqlite().prepare("SELECT * FROM pt_event_documents WHERE id = ? AND lab_id = ?").get(Number(req.params.docId), labId) as any) : null;
    return event && doc && ptEventHolding(ptEventsOfLab(sqlite(), labId), idsOf(doc.result_ids_json))?.key === event.key ? { doc, event } : null;
  };

  app.post(ROUTE, ...edit, oneFile, async (req: any, res: any) => {
    if (!plan(req, res)) return;
    const labId = req.scope.labId, event = ptEventOfResult(sqlite(), labId, req.params.resultId);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (!req.file?.buffer?.length) return res.status(400).json({ error: "No file uploaded" });
    const format = canonicalFormatFromMimeAndName(String(req.file.mimetype || ""), String(req.file.originalname || ""), req.file.buffer);
    if (!format || !(FORMATS as readonly string[]).includes(format)) return res.status(400).json({ error: "Attach a PDF or an image (PNG or JPG).", code: "FORMAT_NOT_ALLOWED" });
    const row = {
      lab_id: labId, result_ids_json: JSON.stringify(event.results.map((r) => r.id).sort((a, b) => a - b)), user_id: req.userId,
      original_filename: String(req.file.originalname || `report.${format}`).replace(/[\\/]/g, "_").slice(0, 200), file_size: req.file.size, mime_type: DOC_MIME[format], uploaded_at: new Date().toISOString(),
    };
    const id = Number(sqlite().prepare(
      "INSERT INTO pt_event_documents (lab_id, result_ids_json, user_id, original_filename, file_size, mime_type, file_data, uploaded_at) VALUES (@lab_id, @result_ids_json, @user_id, @original_filename, @file_size, @mime_type, @file_data, @uploaded_at)"
    ).run({ ...row, file_data: req.file.buffer }).lastInsertRowid);
    ptAudit(req, "create", "pt_event_document", id, `${event.program}, ${event.name}: ${row.original_filename}`, null, row);
    res.status(201).json({ id, original_filename: row.original_filename, file_size: row.file_size, mime_type: row.mime_type, uploaded_at: row.uploaded_at, phiWarning: (await checkUploadedFileForPhi(req.file)).message });
  });

  app.get(`${ROUTE}/:docId`, authMiddleware, labScopeMiddleware, (req: any, res: any) => {
    if (!plan(req, res)) return;
    if (ptStaffOwn(sqlite(), req)) return res.status(403).json({ error: "A staff login can't open an event's record.", code: "STAFF_OWN_ONLY" });
    const found = documentOf(req);
    if (!found) return res.status(404).json({ error: "Document not found" });
    res.setHeader("Content-Type", found.doc.mime_type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${String(found.doc.original_filename).replace(/[^\x20-\x7e]|["\\]/g, "_")}"`);
    res.send(found.doc.file_data);
  });

  app.delete(`${ROUTE}/:docId`, ...edit, (req: any, res: any) => {
    if (!plan(req, res)) return;
    const found = documentOf(req);
    if (!found) return res.status(404).json({ error: "Document not found" });
    const { file_data: _bytes, ...before } = found.doc;
    ptAudit(req, "delete", "pt_event_document", found.doc.id, `${found.event.program}, ${found.event.name}: ${found.doc.original_filename}`, before, null);
    sqlite().prepare("DELETE FROM pt_event_documents WHERE id = ?").run(found.doc.id);
    res.json({ ok: true });
  });
}
