// server/approvedDocumentView.ts
//
// A VeritaDC document opened from another module's link (VeritaMaintain's IFU and a schedule's SOP; B9 and B10, 2026-11-24). Always its
// current approved version, the one a limited Staff login, a share link and a surveyor read (server/policyApprovedVersion.ts), never the
// working revision, so a link in a maintenance record can't show a draft. The caller has already checked the reader's lab; the document
// must be that lab's. Sent as the share link sends it: PDF and images as the file, Word and the rest as JSON holding HTML.
// A system document's site addenda (server/policyAddenda.ts) open with it, each at its own approved version and only through the same
// link: `?addenda=1` lists them and `?addendum=N` is the Nth. A document with none is sent exactly as before.
import { addendaOf, approvedAddendumAt } from "./policyAddenda";
import { sharedVersionFor } from "./policyShareLinks";
import { hashBuffer, htmlForStoredFormat, inlineDocContentType, readVersionBuffer, renderDocxToHtml, writeAuditLog } from "./veritapolicyApproval";
import { versionLabel } from "../shared/policyVersion";

export async function sendApprovedDocument(sqlite: any, req: any, res: any, o: { labId: number; documentId: number; surface: string }) {
  const linked = sharedVersionFor(sqlite, o.documentId, o.labId);
  if (!linked) return res.status(404).json({ error: "That document has no approved version to open.", code: "NO_APPROVED_VERSION" });
  const addenda = addendaOf(sqlite, o.labId, o.documentId, true);
  if (req.query?.addenda === "1") return res.json({ addenda: addenda.map((a) => ({ title: a.title, version: a.version_label })) });
  const asked = req.query?.addendum === undefined ? null : approvedAddendumAt(sqlite, o.labId, o.documentId, req.query.addendum);
  const v = req.query?.addendum === undefined ? linked : asked && sharedVersionFor(sqlite, asked.document_id, o.labId);
  if (!v) return res.status(404).json({ error: "That addendum isn't on this document." });
  let buffer: Buffer;
  try {
    buffer = readVersionBuffer(v.file_path);
  } catch {
    return res.status(500).json({ error: "The file could not be read." });
  }
  const tampered = !!v.expected_hash && hashBuffer(buffer) !== v.expected_hash;
  writeAuditLog(sqlite, {
    labId: o.labId, documentId: v.document_id, userId: req.userId, action: "viewed",
    details: { surface: o.surface, version_id: v.version_id, ...(asked ? { addendum_to_document_id: o.documentId } : {}) }, ipAddress: req.ip, userAgent: req.headers["user-agent"] as string | undefined,
  });
  const about = { title: v.title, doc_number: v.doc_number, version: versionLabel(v), revision_in_progress: v.revision_in_progress, ...(!asked && addenda.length ? { addenda_count: addenda.length } : {}) };
  // Header values are ASCII only, so a title with other letters is encoded.
  res.setHeader("X-Document", encodeURIComponent(JSON.stringify(about)));
  if (tampered) res.setHeader("X-VeritaPolicy-Tamper", "yes");
  res.setHeader("Access-Control-Expose-Headers", "X-Document, X-VeritaPolicy-Tamper");
  if (v.file_format === "docx") {
    try {
      const rendered = await renderDocxToHtml(buffer);
      return res.json({ format: "html", html: rendered.html, tampered, ...about });
    } catch {
      return res.status(500).json({ error: "The file could not be shown." });
    }
  }
  const inline = inlineDocContentType(v.file_format);
  if (inline) {
    res.setHeader("Content-Type", inline);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    return res.send(buffer);
  }
  return res.json({ format: "html", html: await htmlForStoredFormat(buffer, v.file_format), tampered, ...about });
}
