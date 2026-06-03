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

// ── Phase 2: workflow engine ────────────────────────────────────────────
//
// State machine:
//
//     draft ───── submit-for-review ─────> in_review
//     in_review ─ approve (final step) ──> approved
//     in_review ─ reject ────────────────> draft
//     approved ── periodic review trigger > expired (Phase 5)
//     any state ─ archive ───────────────> archived
//
// Self-approval rule: blocked unless step.allow_self_approval = 1.
// Owner of the document cannot approve a step assigned to them unless the
// workflow step explicitly allows it.
//
// required_role values accepted in Phase 2:
//   'specific_user'         -> only step.specific_user_id can approve
//   'any_active_seat'       -> owner, admin, or any user with active seat
//   'any_view_only_seat'    -> any user with a view-only seat
//   'medical_director'      -> Phase 3 will tag specific users with this
//                              CLIA role; in Phase 2 it falls back to
//                              "any view-only seat".
//   'technical_consultant'  -> same fallback as medical_director.
//   'technical_supervisor'  -> same fallback as medical_director.
//
// Default workflow library seeded the first time a lab queries workflows.
export const DEFAULT_WORKFLOWS: {
  name: string;
  description: string;
  steps: { name: string; required_role: string }[];
}[] = [
  {
    name: "Lab Director approval (1 step)",
    description: "Single-step approval by the medical director or designee.",
    steps: [
      {
        name: "Medical Director or Designee Approval",
        required_role: "medical_director",
      },
    ],
  },
  {
    name: "TC review then LD approval (2 step)",
    description:
      "Technical Consultant reviews technical accuracy, then Medical Director or Designee approves.",
    steps: [
      { name: "Technical Consultant Review", required_role: "technical_consultant" },
      { name: "Medical Director or Designee Approval", required_role: "medical_director" },
    ],
  },
];

export function seedDefaultWorkflowsIfEmpty(sqlite: any, labId: number): void {
  const existing = sqlite
    .prepare(
      "SELECT COUNT(*) as cnt FROM policy_approval_workflows WHERE lab_id = ? AND archived_at IS NULL"
    )
    .get(labId) as { cnt: number };
  if (existing && existing.cnt > 0) return;
  DEFAULT_WORKFLOWS.forEach((wf, idx) => {
    try {
      const result = sqlite
        .prepare(
          "INSERT INTO policy_approval_workflows (lab_id, name, description, is_default) VALUES (?, ?, ?, ?)"
        )
        .run(labId, wf.name, wf.description, idx === 0 ? 1 : 0);
      const workflowId = Number(result.lastInsertRowid);
      wf.steps.forEach((step, stepIdx) => {
        sqlite
          .prepare(
            "INSERT INTO policy_approval_steps (workflow_id, step_order, step_name, required_role) VALUES (?, ?, ?, ?)"
          )
          .run(workflowId, stepIdx + 1, step.name, step.required_role);
      });
    } catch (err: any) {
      console.error("[veritapolicyApproval seedDefaultWorkflows]", err.message);
    }
  });
}

// Resolve whether a user can approve a given workflow step. Returns
// { ok: true } or { ok: false, reason } so callers can return a useful
// 403 message to the client.
export function canUserApproveStep(
  sqlite: any,
  args: {
    userId: number;
    labId: number;
    documentOwnerId: number;
    stepRow: {
      required_role: string;
      specific_user_id: number | null;
      allow_self_approval: number;
    };
  }
): { ok: true } | { ok: false; reason: string } {
  const { userId, labId, documentOwnerId, stepRow } = args;
  // Self-approval guard first: blocks regardless of role match unless
  // allow_self_approval is explicitly enabled on the step.
  if (userId === documentOwnerId && !stepRow.allow_self_approval) {
    return {
      ok: false,
      reason: "Self-approval is blocked on this workflow step. Ask a different reviewer.",
    };
  }
  const role = stepRow.required_role;
  if (role === "specific_user") {
    if (stepRow.specific_user_id == null)
      return { ok: false, reason: "Step misconfigured: specific user not set" };
    return userId === stepRow.specific_user_id
      ? { ok: true }
      : { ok: false, reason: "This step is assigned to a specific user other than you." };
  }
  // For everything else, check the user's relationship to this lab.
  const member = sqlite
    .prepare(
      `SELECT lm.role, COALESCE(us.seat_type, 'active') AS seat_type
         FROM lab_members lm
         LEFT JOIN user_seats us
           ON us.seat_user_id = lm.user_id
          AND us.owner_user_id = (SELECT owner_user_id FROM labs WHERE id = ?)
          AND us.status = 'active'
        WHERE lm.user_id = ? AND lm.lab_id = ? AND lm.status = 'active'
        LIMIT 1`
    )
    .get(labId, userId, labId) as { role?: string; seat_type?: string } | undefined;
  if (!member) return { ok: false, reason: "Not a member of this lab" };
  if (role === "any_active_seat") {
    if (member.seat_type === "active" || member.role === "owner" || member.role === "admin") {
      return { ok: true };
    }
    return { ok: false, reason: "This step requires an active (writer) seat." };
  }
  // any_view_only_seat, medical_director, technical_consultant,
  // technical_supervisor all collapse to "any view-only seat" in Phase 2.
  // Phase 3 will tag specific users with CLIA roles and tighten this.
  if (
    role === "any_view_only_seat" ||
    role === "medical_director" ||
    role === "technical_consultant" ||
    role === "technical_supervisor" ||
    role === "general_supervisor"
  ) {
    if (
      member.seat_type === "view_only" ||
      member.seat_type === "active" ||
      member.role === "owner" ||
      member.role === "admin"
    ) {
      return { ok: true };
    }
    return { ok: false, reason: "This step requires a reviewer seat." };
  }
  return { ok: false, reason: `Unknown required_role: ${role}` };
}

// Resolve the current pending step for a document. Returns the step row
// or null if no step pending (document not in_review, or all steps
// already approved).
export function getCurrentPendingStep(
  sqlite: any,
  documentId: number
): {
  step: {
    id: number;
    workflow_id: number;
    step_order: number;
    step_name: string;
    required_role: string;
    specific_user_id: number | null;
    allow_self_approval: number;
  } | null;
  totalSteps: number;
  completedSteps: number;
} {
  const doc = sqlite
    .prepare(
      "SELECT id, workflow_id, status, current_version_id FROM policy_documents WHERE id = ?"
    )
    .get(documentId) as any;
  if (!doc || doc.status !== "in_review" || !doc.workflow_id) {
    return { step: null, totalSteps: 0, completedSteps: 0 };
  }
  const steps = sqlite
    .prepare(
      `SELECT id, workflow_id, step_order, step_name, required_role,
              specific_user_id, allow_self_approval
         FROM policy_approval_steps
        WHERE workflow_id = ?
        ORDER BY step_order ASC`
    )
    .all(doc.workflow_id) as any[];
  if (steps.length === 0) {
    return { step: null, totalSteps: 0, completedSteps: 0 };
  }
  // Find first step that has no 'approved' signoff for the current version.
  for (const s of steps) {
    const signoff = sqlite
      .prepare(
        `SELECT 1 FROM policy_signoffs
          WHERE document_id = ?
            AND version_id = ?
            AND workflow_step_id = ?
            AND action = 'approved'
          LIMIT 1`
      )
      .get(documentId, doc.current_version_id, s.id);
    if (!signoff) {
      return {
        step: s,
        totalSteps: steps.length,
        completedSteps: steps.findIndex((x) => x.id === s.id),
      };
    }
  }
  // All steps approved for this version: the caller (approve handler)
  // should flip the document to status='approved'.
  return { step: null, totalSteps: steps.length, completedSteps: steps.length };
}

// Count eligible reviewers for a single workflow step, excluding the
// document owner (because self-approval is blocked unless step
// explicitly opts in). Phase 2.1: lets the client warn the owner at
// submit time if a step has zero eligible approvers, which would leave
// the document stuck in_review forever.
export function countEligibleReviewersForStep(
  sqlite: any,
  args: {
    labId: number;
    documentOwnerId: number;
    stepRow: {
      required_role: string;
      specific_user_id: number | null;
      allow_self_approval: number;
    };
  }
): number {
  const { labId, documentOwnerId, stepRow } = args;
  if (stepRow.required_role === "specific_user") {
    if (stepRow.specific_user_id == null) return 0;
    if (stepRow.specific_user_id === documentOwnerId && !stepRow.allow_self_approval) return 0;
    // Confirm the specific user is an active member of this lab.
    const exists = sqlite
      .prepare(
        `SELECT 1 FROM lab_members WHERE user_id = ? AND lab_id = ? AND status = 'active' LIMIT 1`
      )
      .get(stepRow.specific_user_id, labId);
    return exists ? 1 : 0;
  }
  // Pull all active members on the lab with their seat_type, exclude
  // owner unless allow_self_approval=1, then filter by role.
  const members = sqlite
    .prepare(
      `SELECT lm.user_id, lm.role, COALESCE(us.seat_type, 'active') AS seat_type
         FROM lab_members lm
         LEFT JOIN user_seats us
           ON us.seat_user_id = lm.user_id
          AND us.owner_user_id = (SELECT owner_user_id FROM labs WHERE id = ?)
          AND us.status = 'active'
        WHERE lm.lab_id = ? AND lm.status = 'active'`
    )
    .all(labId, labId) as { user_id: number; role: string; seat_type: string }[];
  let count = 0;
  for (const m of members) {
    if (m.user_id === documentOwnerId && !stepRow.allow_self_approval) continue;
    if (stepRow.required_role === "any_active_seat") {
      if (m.seat_type === "active" || m.role === "owner" || m.role === "admin") count += 1;
    } else {
      // any_view_only_seat + CLIA role aliases all accept view_only OR
      // active OR owner OR admin in Phase 2.
      if (
        m.seat_type === "view_only" ||
        m.seat_type === "active" ||
        m.role === "owner" ||
        m.role === "admin"
      ) {
        count += 1;
      }
    }
  }
  return count;
}

// Edit-lock helper for status='expired' policies. Used by every write
// path that should refuse to mutate a doc whose state machine has
// already terminated. The recovery path (uploading a new version) is
// NOT routed through this guard; that operation creates a fresh
// policy_versions row and re-enters the workflow.
//
// Returns 409 Conflict with a body that the client can show as a
// recovery hint. The 409 status (not 403) reflects that the failure
// is a state-machine condition, not a permission denial.
export function isPolicyExpired(sqlite: any, documentId: number): boolean {
  const row = sqlite
    .prepare("SELECT status FROM policy_documents WHERE id = ?")
    .get(documentId) as { status: string } | undefined;
  return row?.status === "expired";
}

export const POLICY_EXPIRED_RESPONSE = {
  error: "Policy is expired",
  message:
    "This policy is expired and cannot be edited or further actioned. To revise it, upload a new version, which restarts the approval workflow.",
  code: "POLICY_EXPIRED",
};

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
