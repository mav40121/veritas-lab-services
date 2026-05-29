// server/veritapolicyApproval.ts
//
// Shared helpers for the VeritaPolicy approval workflow extension
// (parking-lot policy-approval, scoped 2026-05-29). Phase 1 surfaces:
// default-manuals seeding, file path resolution under /data/policies,
// SHA-256 hashing for tamper detection, DOCX -> HTML rendering via
// mammoth, and per-lab audit log writes.
//
// Storage layout on the Railway volume:
//   /data/policies/<lab_id>/<document_id>/v<version_number>/document.<ext>
// File path stored in policy_versions.file_path is RELATIVE to /data/policies
// (form: "<lab_id>/<document_id>/v<n>/document.<ext>") so the volume mount
// path can change without rewriting rows.

import fs from "fs";
import path from "path";
import crypto from "crypto";

export const POLICY_STORAGE_ROOT =
  process.env.POLICY_STORAGE_ROOT || "/data/policies";

// First-use defaults: seeded the first time a lab interacts with manuals.
// Matches CLIA-lab departmental organization most labs already use.
export const DEFAULT_MANUALS: { name: string; description: string }[] = [
  { name: "Chemistry", description: "Routine chemistry, immunochemistry, drug testing." },
  { name: "Hematology", description: "CBC, differentials, coagulation auxiliary tests." },
  { name: "Coagulation", description: "PT, PTT, fibrinogen, D-dimer, factor assays." },
  { name: "Microbiology", description: "Culture, identification, susceptibility, molecular." },
  { name: "Urinalysis", description: "Macroscopic, dipstick, microscopic." },
  { name: "Blood Bank / Transfusion Services", description: "Type and screen, crossmatch, antibody work." },
  { name: "Point of Care", description: "Glucose, blood gas, hCG, lactate, troponin POC." },
  { name: "Specimen Handling", description: "Collection, transport, processing, storage, rejection criteria." },
  { name: "Quality Assurance", description: "QC, PT, validation, verification, performance monitoring." },
  { name: "Safety and Compliance", description: "Chemical hygiene, biosafety, exposure control, OSHA." },
];

export function seedDefaultManualsIfEmpty(sqlite: any, labId: number): void {
  const existing = sqlite
    .prepare("SELECT COUNT(*) as cnt FROM policy_manuals WHERE lab_id = ? AND archived_at IS NULL")
    .get(labId) as { cnt: number };
  if (existing && existing.cnt > 0) return;
  const insert = sqlite.prepare(
    "INSERT INTO policy_manuals (lab_id, name, description, display_order) VALUES (?, ?, ?, ?)"
  );
  DEFAULT_MANUALS.forEach((m, idx) => {
    try {
      insert.run(labId, m.name, m.description, idx);
    } catch (err: any) {
      console.error(`[veritapolicyApproval seedDefaultManuals] insert failed:`, err.message);
    }
  });
}

// Build absolute filesystem path for a stored policy version.
export function resolveVersionFilePath(relativePath: string): string {
  return path.join(POLICY_STORAGE_ROOT, relativePath);
}

// Build the relative path that goes into policy_versions.file_path.
export function buildVersionRelativePath(
  labId: number,
  documentId: number,
  versionNumber: number,
  ext: string
): string {
  return path
    .join(String(labId), String(documentId), `v${versionNumber}`, `document.${ext}`)
    .replace(/\\/g, "/");
}

// Ensure parent directory exists, then write the buffer atomically (write
// to tmp, rename) so a crashed write does not leave a half-file in the
// version tree.
export function writeVersionBuffer(relativePath: string, buffer: Buffer): void {
  const abs = resolveVersionFilePath(relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + ".tmp";
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, abs);
}

// SHA-256 of a file content buffer. Used for tamper-detection at signature
// time (policy_signoffs.signed_document_hash) and at attestation
// (policy_attestations.attested_document_hash).
export function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// Read file content from the volume given the relative path.
export function readVersionBuffer(relativePath: string): Buffer {
  return fs.readFileSync(resolveVersionFilePath(relativePath));
}

// Map an uploaded MIME type to the canonical file extension we store.
// We accept DOCX, PDF, and plain HTML (rare; some labs export from
// SharePoint as HTML). Reject anything else; uploaders see a 400.
export function canonicalFormatFromMimeAndName(
  mimetype: string,
  originalName: string
): "docx" | "pdf" | "html" | null {
  const lowerName = originalName.toLowerCase();
  if (
    mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".docx")
  ) {
    return "docx";
  }
  if (mimetype === "application/pdf" || lowerName.endsWith(".pdf")) {
    return "pdf";
  }
  if (mimetype === "text/html" || lowerName.endsWith(".html") || lowerName.endsWith(".htm")) {
    return "html";
  }
  return null;
}

// Try to extract a clean title from the file. DOCX: pull from core
// properties via mammoth's docPropertiesReader if available, else strip
// the extension off the original filename. PDF / HTML: just use the
// filename. The lab user can rename afterward.
export async function extractTitle(
  buffer: Buffer,
  format: "docx" | "pdf" | "html",
  originalName: string
): Promise<string> {
  const fallback = originalName.replace(/\.[^/.]+$/, "").trim();
  if (format !== "docx") return fallback || "Untitled Policy";
  try {
    const mammoth: any = require("mammoth");
    // mammoth has no direct core-properties reader; convert to text
    // and use the first non-empty line as the title heuristic.
    const result = await mammoth.extractRawText({ buffer });
    const text = String(result?.value || "").trim();
    if (text) {
      const firstLine = text.split(/\r?\n/).find((line: string) => line.trim().length > 0);
      if (firstLine) {
        const trimmed = firstLine.trim().slice(0, 200);
        if (trimmed.length >= 3) return trimmed;
      }
    }
  } catch (err: any) {
    console.error("[veritapolicyApproval extractTitle docx]", err.message);
  }
  return fallback || "Untitled Policy";
}

// Render DOCX content to HTML for inline preview. Returns the HTML
// fragment plus any conversion messages (footnotes, unrecognized styles).
export async function renderDocxToHtml(
  buffer: Buffer
): Promise<{ html: string; messages: { type: string; message: string }[] }> {
  const mammoth: any = require("mammoth");
  const result = await mammoth.convertToHtml({ buffer });
  return {
    html: String(result.value || ""),
    messages: Array.isArray(result.messages) ? result.messages : [],
  };
}

// Per-lab audit log writer. Used by every Phase 1+ mutation so the
// audit trail is uniform and 21 CFR Part 11 reviewable.
export function writeAuditLog(
  sqlite: any,
  args: {
    labId: number;
    documentId?: number | null;
    userId: number;
    action: string;
    details?: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
): void {
  try {
    sqlite
      .prepare(
        `INSERT INTO policy_audit_log
           (lab_id, document_id, user_id, action, details, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        args.labId,
        args.documentId ?? null,
        args.userId,
        args.action,
        args.details ? JSON.stringify(args.details) : null,
        args.ipAddress ?? null,
        args.userAgent ?? null
      );
  } catch (err: any) {
    console.error("[veritapolicyApproval writeAuditLog]", err.message);
  }
}
