// server/inspectionLinks.ts
//
// VeritaDC documents linked to inspection work (B8, 2026-11-24).
//
//   A VeritaScan item takes a VeritaDC document as evidence (veritascan_item_policy_links), beside the web-address evidence of
//   the evidence library. Like that evidence it belongs to the lab's checklist item, so every scan of the lab shows it. No file
//   is ever stored on an item (the June rule). Only a document with an approved version can be picked.
//   A VeritaResponse finding links VeritaDC documents too (finding_policy_links), a draft included, since a corrective action
//   may be the revision itself. Suggested SOPs (shared/sopSuggest.ts) are listed with their reasons and never linked by
//   themselves.
//   A VeritaDC document says what links to it (documents/:id/linked-from).
//
// A link holds no version: what opens is the document's current approved version (server/policyApprovedVersion.ts), through
// VeritaDC's own render routes, so VeritaDC's rules decide who reads it. A limited Staff login sees only linked documents that
// have one, as everywhere else. A document past its review date, not approved, or archived is flagged, on Inspection Proof too.
// An archived document reads as not found to anyone who can't edit VeritaDC (server/policyDocumentControl.ts), so its link
// carries no title or number for them.
import type { Express } from "express";
import { logAudit } from "./audit";
import { exportAllPlanBypass } from "./exportAllContext";
import { findingStudy, scanItem } from "./inspectionAssign";
import { approvedReadVersionId, approvedReadVersionSql, revisionInProgress } from "./policyApprovedVersion";
import { labTimeZoneById, labToday } from "./dateLocal";
import { staffOwnScope } from "./competencySelfEntry";
import { mayReadArchived } from "./policyDocumentControl";
import { veritaPolicyTracker } from "./veritapolicyTracker";
import { suggestDocuments, type SuggestRequirement } from "@shared/sopSuggest";

export type LinkedDocState = "current" | "past_review" | "not_approved" | "archived";

/** How a linked document stands today, on the lab's own day. */
export function linkedDocState(d: any, today: string): LinkedDocState {
  if (d.archived_at) return "archived";
  if (approvedReadVersionId(d) == null) return "not_approved";
  if (d.status === "expired" || (d.next_review_date && String(d.next_review_date).slice(0, 10) < today)) return "past_review";
  return "current";
}

const DOC_COLUMNS = "d.id AS document_id, d.title, d.doc_number, d.doc_type, d.description, d.status, d.archived_at, d.next_review_date, d.current_version_id, d.approved_version_id";

function docView(d: any, today: string, namesArchived = true) {
  if (d.archived_at && !namesArchived) {
    return {
      document_id: Number(d.document_id), title: "Archived document", doc_number: null, doc_type: null, next_review_date: null,
      state: "archived" as const, revision_in_progress: false, open_version_id: null, current_version_id: null,
    };
  }
  return {
    document_id: Number(d.document_id), title: d.title, doc_number: d.doc_number ?? null, doc_type: d.doc_type ?? null,
    next_review_date: d.next_review_date ? String(d.next_review_date).slice(0, 10) : null,
    state: linkedDocState(d, today), revision_in_progress: revisionInProgress(d),
    // What opens: the current approved version. The same version the document's own page shows means /render; another one
    // (a revision is a draft or in review) means /versions/:id/render.
    open_version_id: approvedReadVersionId(d), current_version_id: d.current_version_id ?? null,
  };
}

interface Deps {
  sqlite: () => any;
  authMiddleware: any;
  labScopeMiddleware: any;
  requireWriteAccess: any;
  requireModuleEdit: (module: string) => any;
  hasModuleEditAccess: (labId: number, userId: number, module: string) => boolean;
  hasScanAccess: (user: any, lab?: any) => boolean;
}

export function registerInspectionLinkRoutes(app: Express, deps: Deps) {
  const { sqlite, authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit, hasModuleEditAccess, hasScanAccess } = deps;
  const read = [authMiddleware, labScopeMiddleware];
  const edit = (module: string) => [authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit(module)];
  const scanPlan = (req: any, res: any) => {
    if (exportAllPlanBypass(req.scope?.lab) || hasScanAccess(req.user, req.scope?.lab)) return true;
    res.status(403).json({ error: "VeritaScan® subscription required" });
    return false;
  };
  const today = (labId: number) => labToday(labTimeZoneById(sqlite(), labId));
  const ownerOf = (req: any) => req.scope?.lab?.owner_user_id ?? req.ownerUserId ?? req.userId;
  // A limited Staff login reads only documents with an approved version (server/policyReadSign.ts veritaDcStaffGuard).
  const limited = (req: any) => !!staffOwnScope(sqlite(), req.userId, req.scope.labId, "veritapolicy");
  const readable = (req: any, rows: any[]) => (limited(req) ? rows.filter((r) => approvedReadVersionId(r) != null) : rows);
  const namesArchived = (req: any) => mayReadArchived(sqlite(), req.scope.labId, req.userId, hasModuleEditAccess);
  const docInLab = (labId: number, id: unknown) => {
    const n = Number(id);
    return Number.isInteger(n) && n > 0 ? (sqlite().prepare(`SELECT ${DOC_COLUMNS} FROM policy_documents d WHERE d.id = ? AND d.lab_id = ?`).get(n, labId) as any) : null;
  };
  const search = (labId: number, q: unknown, approvedOnly: boolean) => {
    const term = String(q ?? "").trim();
    const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    return sqlite().prepare(
      `SELECT ${DOC_COLUMNS} FROM policy_documents d
        WHERE d.lab_id = @lab AND d.archived_at IS NULL ${approvedOnly ? `AND ${approvedReadVersionSql("d")} IS NOT NULL` : ""}
          ${term ? "AND (d.title LIKE @like ESCAPE '\\' OR d.doc_number LIKE @like ESCAPE '\\' OR d.description LIKE @like ESCAPE '\\')" : ""}
        ORDER BY d.title COLLATE NOCASE, d.id LIMIT 100`
    ).all(term ? { lab: labId, like } : { lab: labId }) as any[];
  };
  const NO_DOC = { error: "That document isn't available in this lab." };
  const duplicate = (err: any) => String(err?.message || "").includes("UNIQUE");

  // ── VeritaScan items ──────────────────────────────────────────────────────

  // Every VeritaDC document linked to this lab's checklist items, for the scan screen and Inspection Proof.
  app.get("/api/labs/:labId/veritascan/policy-links", ...read, (req: any, res: any) => {
    if (!scanPlan(req, res)) return;
    const rows = readable(req, sqlite().prepare(
      `SELECT l.id AS link_id, l.checklist_item_id, l.linked_at, ${DOC_COLUMNS}
         FROM veritascan_item_policy_links l JOIN policy_documents d ON d.id = l.document_id AND d.lab_id = l.lab_id
        WHERE l.lab_id = ? ORDER BY l.checklist_item_id, d.title COLLATE NOCASE`
    ).all(req.scope.labId) as any[]);
    const day = today(req.scope.labId), named = namesArchived(req);
    res.json(rows.map((r) => ({ link_id: r.link_id, checklist_item_id: r.checklist_item_id, linked_at: r.linked_at, ...docView(r, day, named) })));
  });

  // What an editor can pick: documents with an approved version.
  app.get("/api/labs/:labId/veritascan/policy-candidates", authMiddleware, labScopeMiddleware, requireModuleEdit("veritascan"), (req: any, res: any) => {
    if (!scanPlan(req, res)) return;
    const day = today(req.scope.labId);
    res.json(search(req.scope.labId, req.query.q, true).map((d) => docView(d, day)));
  });

  app.post("/api/labs/:labId/veritascan/checklist/items/:itemId/policy-links", ...edit("veritascan"), (req: any, res: any) => {
    if (!scanPlan(req, res)) return;
    const item = scanItem(req.params.itemId);
    if (!item) return res.status(404).json({ error: "Item not found" });
    const doc = docInLab(req.scope.labId, req.body?.document_id);
    if (!doc || doc.archived_at) return res.status(404).json(NO_DOC);
    if (approvedReadVersionId(doc) == null) return res.status(409).json({ error: "Only a document with an approved version can be linked as evidence.", code: "NO_APPROVED_VERSION" });
    try {
      const id = Number(sqlite().prepare("INSERT INTO veritascan_item_policy_links (lab_id, checklist_item_id, document_id, linked_by_user_id, linked_at) VALUES (?, ?, ?, ?, ?)")
        .run(req.scope.labId, item.id, doc.document_id, req.userId, new Date().toISOString()).lastInsertRowid);
      logAudit({
        userId: req.userId, ownerUserId: ownerOf(req), module: "veritascan", action: "create", entityType: "policy_link", entityId: id,
        entityLabel: `VeritaDC document ${doc.document_id} (${doc.title}) -> item ${item.id}`, after: { checklist_item_id: item.id, document_id: doc.document_id, lab_id: req.scope.labId }, ipAddress: req.ip,
      });
      res.status(201).json({ link_id: id, checklist_item_id: item.id, ...docView(doc, today(req.scope.labId)) });
    } catch (err: any) {
      if (duplicate(err)) return res.status(409).json({ error: "That document is already linked to this item.", code: "ALREADY_LINKED" });
      throw err;
    }
  });

  app.delete("/api/labs/:labId/veritascan/checklist/items/:itemId/policy-links/:linkId", ...edit("veritascan"), (req: any, res: any) => {
    if (!scanPlan(req, res)) return;
    const link = sqlite().prepare("SELECT * FROM veritascan_item_policy_links WHERE id = ? AND checklist_item_id = ? AND lab_id = ?")
      .get(Number(req.params.linkId), Number(req.params.itemId), req.scope.labId) as any;
    if (!link) return res.status(404).json({ error: "Link not found" });
    logAudit({
      userId: req.userId, ownerUserId: ownerOf(req), module: "veritascan", action: "delete", entityType: "policy_link", entityId: link.id,
      entityLabel: `VeritaDC document ${link.document_id} -> item ${link.checklist_item_id}`, before: link, ipAddress: req.ip,
    });
    sqlite().prepare("DELETE FROM veritascan_item_policy_links WHERE id = ?").run(link.id);
    res.json({ ok: true });
  });

  // ── Findings ──────────────────────────────────────────────────────────────

  const findingInLab = (req: any) => sqlite().prepare("SELECT * FROM findings WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
  const findingLinks = (labId: number, findingId: number) => sqlite().prepare(
    `SELECT l.id AS link_id, l.linked_at, ${DOC_COLUMNS}
       FROM finding_policy_links l JOIN policy_documents d ON d.id = l.document_id AND d.lab_id = l.lab_id
      WHERE l.lab_id = ? AND l.finding_id = ? ORDER BY d.title COLLATE NOCASE`
  ).all(labId, findingId) as any[];
  const history = (findingId: number, event: string, byUserId: number, payload: any) =>
    sqlite().prepare("INSERT INTO finding_history (finding_id, event, by_user_id, payload) VALUES (?, ?, ?, ?)").run(findingId, event, byUserId, JSON.stringify(payload));

  app.get("/api/labs/:labId/findings/:id/documents", ...read, (req: any, res: any) => {
    const f = findingInLab(req);
    if (!f) return res.status(404).json({ error: "Finding not found" });
    const day = today(req.scope.labId), named = namesArchived(req);
    res.json({ documents: readable(req, findingLinks(req.scope.labId, f.id)).map((r) => ({ link_id: r.link_id, linked_at: r.linked_at, ...docView(r, day, named) })) });
  });

  // For someone who can edit the finding: suggested SOPs with their reasons, and a search of the lab's documents.
  app.get("/api/labs/:labId/findings/:id/document-options", authMiddleware, labScopeMiddleware, requireModuleEdit("veritaresponse"), (req: any, res: any) => {
    const f = findingInLab(req);
    if (!f) return res.status(404).json({ error: "Finding not found" });
    const db = sqlite(), labId = req.scope.labId, day = today(labId);
    const linked = new Set(findingLinks(labId, f.id).map((r) => Number(r.document_id)));
    const docs = (db.prepare(`SELECT ${DOC_COLUMNS} FROM policy_documents d WHERE d.lab_id = ? AND d.archived_at IS NULL`).all(labId) as any[]).filter((d) => !linked.has(Number(d.document_id)));
    const lab = db.prepare("SELECT * FROM labs WHERE id = ?").get(labId) as any;
    const requirements: SuggestRequirement[] = veritaPolicyTracker(db, lab, lab?.owner_user_id).rows.filter((r) => !r.is_na)
      .map((r) => ({ policy_name: r.policy_name, our_policy_name: r.our_policy_name, citations: [r.cfr_citations, ...r.ao_citations.map((a) => a.value)].filter(Boolean).join("; ") }));
    const byId = new Map(docs.map((d) => [Number(d.document_id), d]));
    const suggested = suggestDocuments(
      { standard_ref: f.standard_ref, description: f.description, pt_analyte: f.pt_analyte, study: findingStudy(db, f)?.name ?? null },
      docs.map((d) => ({ id: Number(d.document_id), title: d.title, doc_number: d.doc_number, description: d.description })),
      requirements,
    ).map((s) => ({ ...docView(byId.get(s.id), day), reasons: s.reasons }));
    res.json({
      suggested,
      documents: search(labId, req.query.q, false).filter((d) => !linked.has(Number(d.document_id))).map((d) => docView(d, day)),
    });
  });

  app.post("/api/labs/:labId/findings/:id/documents", ...edit("veritaresponse"), (req: any, res: any) => {
    const f = findingInLab(req);
    if (!f) return res.status(404).json({ error: "Finding not found" });
    const doc = docInLab(req.scope.labId, req.body?.document_id);
    if (!doc || doc.archived_at) return res.status(404).json(NO_DOC);
    try {
      const id = sqlite().transaction(() => {
        const n = Number(sqlite().prepare("INSERT INTO finding_policy_links (lab_id, finding_id, document_id, linked_by_user_id, linked_at) VALUES (?, ?, ?, ?, ?)")
          .run(req.scope.labId, f.id, doc.document_id, req.userId, new Date().toISOString()).lastInsertRowid);
        history(f.id, "document_linked", req.userId, { document_id: doc.document_id, title: doc.title });
        return n;
      })();
      res.status(201).json({ link_id: id, ...docView(doc, today(req.scope.labId)) });
    } catch (err: any) {
      if (duplicate(err)) return res.status(409).json({ error: "That document is already linked to this finding.", code: "ALREADY_LINKED" });
      throw err;
    }
  });

  app.delete("/api/labs/:labId/findings/:id/documents/:linkId", ...edit("veritaresponse"), (req: any, res: any) => {
    const f = findingInLab(req);
    const link = f ? (sqlite().prepare("SELECT l.*, d.title FROM finding_policy_links l LEFT JOIN policy_documents d ON d.id = l.document_id WHERE l.id = ? AND l.finding_id = ? AND l.lab_id = ?")
      .get(Number(req.params.linkId), f.id, req.scope.labId) as any) : null;
    if (!link) return res.status(404).json({ error: "Link not found" });
    sqlite().transaction(() => {
      sqlite().prepare("DELETE FROM finding_policy_links WHERE id = ?").run(link.id);
      history(f.id, "document_unlinked", req.userId, { document_id: link.document_id, title: link.title ?? null });
    })();
    res.json({ ok: true });
  });

  // ── The document's side ───────────────────────────────────────────────────

  // What links to a VeritaDC document. Closed to a limited Staff login by veritaDcStaffGuard, as the document's other lists are.
  app.get("/api/labs/:labId/veritapolicy/documents/:id/linked-from", ...read, (req: any, res: any) => {
    const doc = docInLab(req.scope.labId, req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    const items = sqlite().prepare("SELECT checklist_item_id FROM veritascan_item_policy_links WHERE lab_id = ? AND document_id = ? ORDER BY checklist_item_id").all(req.scope.labId, doc.document_id) as any[];
    const findings = sqlite().prepare(
      `SELECT f.id, f.finding_number, f.accreditor, f.source_type, f.standard_ref, f.status
         FROM finding_policy_links l JOIN findings f ON f.id = l.finding_id AND f.lab_id = l.lab_id
        WHERE l.lab_id = ? AND l.document_id = ? ORDER BY f.id DESC`
    ).all(req.scope.labId, doc.document_id);
    res.json({
      scanItems: items.map((i) => ({ item_id: i.checklist_item_id, question: scanItem(i.checklist_item_id)?.question ?? `Item ${i.checklist_item_id}` })),
      findings,
    });
  });
}
