// server/veritascanCarry.ts
//
// Starting a VeritaScan from an earlier scan, copying a scan's answers to another lab of the same organization, and setting
// several items at once (B7, 2026-11-24).
//
// What a copy takes: the status, notes, owner and due date of the items the person ticked. The status goes to carried_status
// and the item itself stays Not Assessed until someone reviews it (server/veritascanItems.ts), so a carried answer, N/A
// included, changes no percentage anywhere. What it never takes:
//   - an automatic mark (Compliant from VeritaCheck or VeritaComp), or the words those marks and the mark correction wrote;
//   - a carried answer nobody has reviewed in the scan it would come from;
//   - teaching notes, completion links, evidence, custom questions, and anything signed (a scan holds no signature).
// The person an item was assigned to comes along only when they are on the new scan's lab; no email goes out for a copy.
//
// Another lab: the new scan is made through that lab's own URL, so every check on writing there is that lab's. The scan it
// copies from is named by its own row, never by a lab id in the body: both labs must be in one organization the person runs
// (an active org_owner or org_admin), or the source reads as not found.
import type { Express } from "express";
import { logAudit } from "./audit";
import { assignablePerson, type AssignablePerson } from "./assignablePeople";
import { assignScanItems, NOT_ON_LAB, pickedUserId, scanItem } from "./inspectionAssign";
import { labRoleFromOrgRole, orgRoleForUserOnLab } from "./organizationRoles";
import { AUTOMATIC_MARK_SOURCES, SCAN_STATUSES } from "./veritascanCounts";
import { ensureScanRows, isCarriedPending, reviewCarried, scanActor, scanAuditOwner } from "./veritascanItems";
import { exportAllPlanBypass } from "./exportAllContext";

// Words an automatic mark, a study link, a coverage lapse or the mark correction wrote into notes (server/integrations.ts,
// server/veritascanMarkCorrection.ts): not the lab's own.
const SYSTEM_NOTE = /^(Auto-completed by Verita|Marked Compliant by VeritaCheck|Evidence from VeritaCheck|VeritaCheck® Coverage on |Veritas Lab Services moved this item back)/;

export interface CarryItem { item_id: number; status: string; notes: string | null; owner: string | null; owner_user_id: number | null; due_date: string | null }
export interface CarryCandidates { items: CarryItem[]; notCopied: { automatic: number[]; unreviewed: number[] } }

const blank = (v: unknown) => v == null || String(v).trim() === "";

/** What can be carried out of a scan, and what can't and why. */
export function carryCandidates(sqlite: any, scanId: number): CarryCandidates {
  const items: CarryItem[] = [], automatic: number[] = [], unreviewed: number[] = [];
  for (const r of sqlite.prepare("SELECT * FROM veritascan_items WHERE scan_id = ? ORDER BY item_id").all(scanId) as any[]) {
    const id = Number(r.item_id);
    if (!scanItem(id)) continue;
    if (isCarriedPending(r)) { unreviewed.push(id); continue; }
    if (r.status === "Compliant" && AUTOMATIC_MARK_SOURCES.has(String(r.completion_source || ""))) { automatic.push(id); continue; }
    const system = !blank(r.notes) && (r.notes === r.completion_note || SYSTEM_NOTE.test(String(r.notes)));
    const it: CarryItem = {
      item_id: id, status: (SCAN_STATUSES as readonly string[]).includes(r.status) ? r.status : "Not Assessed",
      notes: blank(r.notes) || system ? null : r.notes, owner: blank(r.owner) ? null : r.owner, owner_user_id: r.owner_user_id ?? null, due_date: blank(r.due_date) ? null : r.due_date,
    };
    if (it.status === "Not Assessed" && !it.notes && !it.owner && !it.due_date) continue; // nothing to carry
    items.push(it);
  }
  return { items, notCopied: { automatic, unreviewed } };
}

const isSystemLeader = (sqlite: any, userId: number, labId: number) => labRoleFromOrgRole(orgRoleForUserOnLab(sqlite, userId, labId)) === "admin";
const labOpen = (l: any) => !l.retired_at && !(Number(l.is_trial) === 1 && l.subscription_expires_at && new Date() >= new Date(l.subscription_expires_at));

interface Deps {
  sqlite: () => any;
  authMiddleware: any;
  labScopeMiddleware: any;
  requireWriteAccess: any;
  requireModuleEdit: (module: string) => any;
  hasModuleEditAccess: (labId: number, userId: number, module: string) => boolean;
  hasScanAccess: (user: any, lab?: any) => boolean;
  emailScanItems: (req: any, scan: any, itemIds: number[], to: AssignablePerson, dueDate: string | null) => Promise<"none" | "sent" | "failed">;
}

type Refusal = { status: number; body: { error: string; code?: string; [k: string]: any } };
const NOT_FOUND: Refusal = { status: 404, body: { error: "Scan not found" } };

export function registerVeritaScanCarryRoutes(app: Express, deps: Deps) {
  const { sqlite, authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit, hasModuleEditAccess, hasScanAccess, emailScanItems } = deps;
  const edit = [authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritascan")];
  const scanPlan = (req: any, res: any) => {
    if (exportAllPlanBypass(req.scope?.lab) || hasScanAccess(req.user, req.scope?.lab)) return true;
    res.status(403).json({ error: "VeritaScan® subscription required" });
    return false;
  };
  const labRow = (id: number) => sqlite().prepare("SELECT id, lab_name, plan, owner_user_id, organization_id, retired_at, is_trial, subscription_expires_at FROM labs WHERE id = ?").get(id) as any;

  /** The scan an answer would come from, when this person may copy it into the lab in the URL; a refusal otherwise. */
  function sourceFor(req: any, scanId: unknown): { scan: any; from: string; sameLab: boolean } | Refusal {
    const id = Number(scanId);
    const scan = Number.isInteger(id) && id > 0 ? (sqlite().prepare("SELECT id, name, lab_id, updated_at, created_at FROM veritascan_scans WHERE id = ?").get(id) as any) : null;
    if (!scan || scan.lab_id == null) return NOT_FOUND;
    if (Number(scan.lab_id) === Number(req.scope.labId)) return { scan, from: scan.name, sameLab: true };
    if (req.scope.viaVlsSupport) return NOT_FOUND;
    const src = labRow(Number(scan.lab_id)), here = labRow(req.scope.labId);
    if (!src || !here || src.organization_id == null || src.organization_id !== here.organization_id || !labOpen(src)) return NOT_FOUND;
    if (!isSystemLeader(sqlite(), req.userId, src.id) || !isSystemLeader(sqlite(), req.userId, here.id) || !hasScanAccess(req.user, src)) return NOT_FOUND;
    return { scan, from: `${scan.name}, ${src.lab_name || "another lab"}`, sameLab: false };
  }

  // What a new scan can start from: the items worth carrying out of one of this lab's scans, and the count of those that can't.
  app.get("/api/labs/:labId/veritascan/scans/:id/carry-preview", authMiddleware, labScopeMiddleware, requireModuleEdit("veritascan"), (req: any, res: any) => {
    if (!scanPlan(req, res)) return;
    const scan = sqlite().prepare("SELECT id, name, updated_at, created_at FROM veritascan_scans WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!scan) return res.status(404).json(NOT_FOUND.body);
    const c = carryCandidates(sqlite(), scan.id);
    res.json({
      scan: { id: scan.id, name: scan.name, date: scan.updated_at || scan.created_at },
      items: c.items.map((i) => ({ ...i, domain: scanItem(i.item_id)?.domain ?? null, question: scanItem(i.item_id)?.question ?? null })),
      notCopied: { automatic: c.notCopied.automatic.length, unreviewed: c.notCopied.unreviewed.length },
    });
  });

  // Where a system's owner or admin can copy this lab's answers: the other open labs of the same organization.
  app.get("/api/labs/:labId/veritascan/copy-targets", authMiddleware, labScopeMiddleware, (req: any, res: any) => {
    if (!scanPlan(req, res)) return;
    const here = labRow(req.scope.labId);
    if (req.scope.viaVlsSupport || here?.organization_id == null || !isSystemLeader(sqlite(), req.userId, req.scope.labId)) return res.json({ allowed: false, labs: [] });
    const labs = (sqlite().prepare(
      "SELECT id, lab_name, plan, retired_at, is_trial, subscription_expires_at FROM labs WHERE organization_id = ? AND id <> ? AND (is_repository IS NULL OR is_repository = 0) ORDER BY lab_name COLLATE NOCASE, id"
    ).all(here.organization_id, req.scope.labId) as any[])
      .filter((l) => labOpen(l) && hasModuleEditAccess(l.id, req.userId, "veritascan") && hasScanAccess(req.user, l))
      .map((l) => ({ id: l.id, name: l.lab_name || `Lab ${l.id}` }));
    res.json({ allowed: labs.length > 0, labs });
  });

  // A new scan of the lab in the URL, begun from another scan. The existing POST .../scans calls this when the body has carryFrom.
  function createScanFrom(req: any, res: any) {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "Scan name required" });
    const src = sourceFor(req, req.body?.carryFrom?.scanId);
    if ("status" in src) return res.status(src.status).json(src.body);
    const wanted: unknown = req.body.carryFrom.itemIds;
    if (!Array.isArray(wanted) || wanted.length === 0) return res.status(400).json({ error: "Tick at least one item to carry over.", code: "NO_ITEMS" });
    const ids = [...new Set(wanted.map(Number))];
    const db = sqlite();
    const byId = new Map(carryCandidates(db, src.scan.id).items.map((i) => [i.item_id, i]));
    const cant = ids.filter((i) => !byId.has(i));
    if (cant.length) return res.status(400).json({ error: "Some of those items can't be carried over. Reload the list and try again.", code: "ITEM_NOT_COPYABLE", item_ids: cant });
    const now = new Date().toISOString();
    const here = labRow(req.scope.labId);
    const scanId = db.transaction(() => {
      const id = Number(db.prepare("INSERT INTO veritascan_scans (user_id, lab_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(here?.owner_user_id ?? req.userId, req.scope.labId, name, now, now).lastInsertRowid);
      const ins = db.prepare(
        `INSERT INTO veritascan_items (scan_id, item_id, status, notes, owner, owner_user_id, owner_assigned_at, owner_assigned_by_user_id, due_date,
                                       carried_status, carried_from_scan_id, carried_from_name, carried_from_date, carried_at, carried_by_user_id, updated_at)
         VALUES (?, ?, 'Not Assessed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const i of ids) {
        const it = byId.get(i)!;
        // The person comes along only when they are on this lab; their name stays as the owner either way.
        const p = it.owner_user_id ? assignablePerson(db, req.scope.labId, it.owner_user_id) : null;
        ins.run(id, i, it.notes, it.owner, p?.userId ?? null, p ? now : null, p ? req.userId : null, it.due_date,
          it.status, src.scan.id, src.from, src.scan.updated_at || src.scan.created_at, now, req.userId, now);
      }
      ensureScanRows(db, id, now);
      const row = { userId: req.userId, module: "veritascan" as const, action: "create" as const, entityType: "scan_carry", entityId: id,
        entityLabel: `Scan "${name}" begun with ${ids.length} answers carried from "${src.from}"`,
        after: { scan_id: id, lab_id: req.scope.labId, from_scan_id: src.scan.id, from_lab_id: src.scan.lab_id, item_ids: ids }, ipAddress: req.ip };
      const ownerHere = here?.owner_user_id ?? req.userId;
      logAudit({ ...row, ownerUserId: ownerHere });
      // Another lab's answers left it: its own owner's trail says so too.
      const srcOwner = src.sameLab ? null : labRow(Number(src.scan.lab_id))?.owner_user_id;
      if (srcOwner && srcOwner !== ownerHere) logAudit({ ...row, ownerUserId: srcOwner });
      return id;
    })();
    res.json({ id: scanId, name, created_at: now, updated_at: now, carried: ids.length });
  }

  // Status, owner and due date of several items together. The body names the items and how many the person confirmed.
  app.post("/api/labs/:labId/veritascan/scans/:id/items/bulk-set", ...edit, async (req: any, res: any) => {
    if (!scanPlan(req, res)) return;
    const db = sqlite();
    const b = req.body || {};
    const scan = db.prepare("SELECT id, name FROM veritascan_scans WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!scan) return res.status(404).json(NOT_FOUND.body);
    if (!Array.isArray(b.item_ids) || b.item_ids.length === 0) return res.status(400).json({ error: "Select at least one item.", code: "NO_ITEMS" });
    const ids = [...new Set((b.item_ids as unknown[]).map(Number))];
    if (ids.some((i) => !scanItem(i))) return res.status(400).json({ error: "One of those items isn't on the checklist.", code: "ITEM_UNKNOWN" });
    if (b.expected_count !== ids.length) return res.status(409).json({ error: `You confirmed ${b.expected_count ?? "no"} items and ${ids.length} were sent. Nothing was changed.`, code: "COUNT_CHANGED", count: ids.length });
    const hasStatus = b.status !== undefined, hasDue = b.due_date !== undefined, hasPerson = b.owner_user_id !== undefined, hasTyped = b.owner !== undefined;
    if (!hasStatus && !hasDue && !hasPerson && !hasTyped) return res.status(400).json({ error: "Pick a status, an owner or a due date to set.", code: "NOTHING_TO_SET" });
    if (hasStatus && !(SCAN_STATUSES as readonly string[]).includes(b.status)) return res.status(400).json({ error: "That isn't a VeritaScan status.", code: "STATUS_INVALID" });
    if (hasDue && b.due_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date))) return res.status(400).json({ error: "The due date must be a date.", code: "DUE_DATE_INVALID" });
    if (hasPerson && hasTyped) return res.status(400).json({ error: "Send a person or a typed name, not both.", code: "OWNER_INVALID" });
    const pick = hasPerson ? pickedUserId(b.owner_user_id) : undefined;
    if (hasPerson && pick === undefined) return res.status(400).json({ error: "Pick a person, or clear the owner.", code: "ASSIGNEE_INVALID" });
    const to = pick ? assignablePerson(db, req.scope.labId, pick) : null;
    if (pick && !to) return res.status(400).json(NOT_ON_LAB);
    const typed = hasTyped ? String(b.owner ?? "").trim().slice(0, 200) || null : null;

    const actor = scanActor(req);
    const owner = scanAuditOwner(db, scan.id);
    const now = new Date().toISOString();
    const get = db.prepare("SELECT * FROM veritascan_items WHERE scan_id = ? AND item_id = ?");
    if (actor.support && hasStatus && ids.some((i) => isCarriedPending(get.get(scan.id, i)))) {
      return res.status(403).json({ error: "Veritas support cannot review a carried answer. That belongs to the lab's own staff.", code: "VLS_SUPPORT_CANNOT_SIGN" });
    }
    const view = (r: any) => ({ status: r.status, owner: r.owner ?? null, owner_user_id: r.owner_user_id ?? null, due_date: r.due_date ?? null });
    let updated = 0, reviewed = 0;
    let newlyTheirs: number[] = [];
    db.transaction(() => {
      ensureScanRows(db, scan.id, now);
      const set = db.prepare("UPDATE veritascan_items SET status = ?, owner = ?, owner_user_id = ?, owner_assigned_at = CASE WHEN ? IS NULL THEN NULL ELSE owner_assigned_at END, owner_assigned_by_user_id = CASE WHEN ? IS NULL THEN NULL ELSE owner_assigned_by_user_id END, due_date = ?, updated_at = ? WHERE id = ?");
      for (const i of ids) {
        const row = get.get(scan.id, i) as any;
        const pending = isCarriedPending(row);
        const status = hasStatus ? b.status : row.status;
        const person = hasTyped || pick === null ? null : row.owner_user_id ?? null; // a picked person is written below, with the assignment's own audit row
        const ownerText = hasTyped ? typed : pick === null ? null : row.owner ?? null;
        const due = hasDue ? b.due_date : row.due_date ?? null;
        const before = view(row), after = { status, owner: ownerText, owner_user_id: person, due_date: due };
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          set.run(status, ownerText, person, person, person, due, now, row.id);
          logAudit({
            userId: req.userId, ownerUserId: owner.ownerUserId, module: "veritascan", action: "update", entityType: "veritascan_item", entityId: row.id,
            entityLabel: `${scan.name}: item ${i} set with ${ids.length} items`, before, after, ipAddress: req.ip,
          });
          updated++;
        }
        if (pending && status !== "Not Assessed") { reviewCarried(db, { row, after: { status }, scan: owner, actor, now }); reviewed++; }
      }
      if (to) newlyTheirs = assignScanItems(db, { req, scan, itemIds: ids, to });
      db.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?").run(now, scan.id);
    })();
    let email: "none" | "sent" | "failed" = "none";
    if (to && newlyTheirs.length) email = await emailScanItems(req, scan, newlyTheirs, to, hasDue ? b.due_date : null);
    const rows = db.prepare(`SELECT item_id, status, owner, owner_user_id, due_date FROM veritascan_items WHERE scan_id = ? AND item_id IN (${ids.map(() => "?").join(",")})`).all(scan.id, ...ids);
    res.json({ ok: true, count: ids.length, updated, assigned: newlyTheirs.length, reviewed, email, items: rows });
  });

  return { createScanFrom };
}
