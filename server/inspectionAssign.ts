// server/inspectionAssign.ts
//
// Assigning inspection work to a person (B6, 2026-11-24).
//
//   A VeritaResponse finding has an assignee (findings.assignee_user_id), set, changed or cleared by someone with edit on
//   VeritaResponse. A VeritaScan item's owner can be a person (veritascan_items.owner_user_id), set by someone with edit on
//   VeritaScan; `owner` keeps the text every screen and export reads, so a name typed before stays as it is.
//
//   Who can be picked: the lab's owner, an active member, or a person on the lab's active roster with a Staff login. It is
//   read from the lab in the URL, never from a name or lab in the body. Being assigned gives no access: the person reads and
//   edits what their own login already allows.
//
//   Assigning sends one email to that person (readSignMailer, the Resend pattern the read-and-sign and digest notices use);
//   saving the same person again sends nothing. The email holds no description, notes or plan text. Each change is in the
//   finding's own history (finding_history) or the audit log (module veritascan).
//
//   A VeritaCheck study whose stored result is FAIL can open a finding (findings.study_id), an internal non-conforming event
//   that names the study. A FAIL overridden to PASS is stored 'pass', so it isn't offered. Nothing is opened by itself.
//
// Veritas support can't assign for a lab (server/vlsSupport.ts).
import type { Express } from "express";
import { SCAN_ITEMS } from "../client/src/lib/veritaScanData";
import { findingTemplate } from "@shared/findingTypes";
import { logAudit } from "./audit";
import { readSignMailer } from "./policyReadSign";
import { exportAllPlanBypass } from "./exportAllContext";
import { assignablePeople, assignablePerson, type AssignablePerson } from "./assignablePeople";

const SCAN_ITEM_BY_ID = new Map<number, { id: number; domain: string; question: string }>((SCAN_ITEMS as any[]).map((i) => [Number(i.id), i]));
export const scanItem = (id: unknown) => SCAN_ITEM_BY_ID.get(Number(id)) ?? null;

/** null when the body clears it, the id when it names one, undefined when it is neither (a 400). */
export function pickedUserId(v: unknown): number | null | undefined {
  if (v === null) return null;
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isInteger(n) && n > 0 ? n : undefined;
}

export const NOT_ON_LAB = { error: "That person isn't on this lab. Pick someone who can sign in to it.", code: "ASSIGNEE_NOT_ON_LAB" };
const BAD_PICK = { error: "Pick a person, or clear the assignment.", code: "ASSIGNEE_INVALID" };

// ── Email ───────────────────────────────────────────────────────────────────

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const base = () => process.env.FRONTEND_URL || "https://www.veritaslabservices.com";
const FROM = "VeritaAssure® <info@veritaslabservices.com>";
const para = (html: string) => `<div>${html}</div><div><br></div>`;

async function sendOne(to: string, subject: string, html: string): Promise<"sent" | "failed"> {
  try {
    await readSignMailer.send({ to, subject, html, from: FROM });
    return "sent";
  } catch (err: any) {
    console.error("[inspection-assign] email not sent:", err?.message || err);
    return "failed";
  }
}

export const findingLabel = (f: any) => (f.finding_number ? String(f.finding_number) : `#${f.id}`);
const oneLine = (s: unknown) => String(s ?? "").replace(/[\r\n]+/g, " ").trim();

export function findingAssignedEmail(f: any, labName: string, assignedBy: string): { subject: string; html: string } {
  const type = f.source_type && f.source_type !== "inspection" ? findingTemplate(f.source_type).label : f.accreditor;
  const facts = [
    `Finding: ${esc(findingLabel(f))}`,
    `Type: ${esc(type)}`,
    ...(f.standard_ref ? [`Standard cited: ${esc(f.standard_ref)}`] : []),
    `Due: ${f.due_date ? esc(String(f.due_date).slice(0, 10)) : "no due date"}`,
  ];
  return {
    subject: oneLine(`${labName}: VeritaResponse finding ${findingLabel(f)} is assigned to you`),
    html: para(`${esc(assignedBy)} assigned you a VeritaResponse&trade; finding at ${esc(labName)}.`)
      + para(facts.join("<br>"))
      + para(`<a href="${base()}/labs/${f.lab_id}/veritaresponse/${f.id}">Sign in and open the finding</a>`)
      + `<div>You get this email once. If the finding has a due date, its reminders come to you too while it is open.</div>`,
  };
}

export function scanItemsAssignedEmail(o: { labId: number; labName: string; scanId: number; scanName: string; itemIds: number[]; dueDate?: string | null; assignedBy: string }): { subject: string; html: string } {
  const n = o.itemIds.length;
  const shown = o.itemIds.slice(0, 10).map((id) => esc(scanItem(id)?.question ?? `Item ${id}`));
  return {
    subject: oneLine(`${o.labName}: ${n} VeritaScan ${n === 1 ? "item is" : "items are"} assigned to you`),
    html: para(`${esc(o.assignedBy)} assigned you ${n} VeritaScan&reg; ${n === 1 ? "item" : "items"} in "${esc(o.scanName)}" at ${esc(o.labName)}${o.dueDate ? `, due ${esc(o.dueDate)}` : ""}.`)
      + para(shown.join("<br>") + (n > shown.length ? `<br>and ${n - shown.length} more` : ""))
      + para(`<a href="${base()}/labs/${o.labId}/veritascan-app/${o.scanId}">Sign in and open the scan</a>`)
      + `<div>You get this email once. Everything assigned to you is listed on VeritaScan under Assigned to me.</div>`,
  };
}

// ── The finding's study ─────────────────────────────────────────────────────

const STUDY_NAMES: Record<string, string> = {
  cal_ver: "Calibration Verification / Linearity", cal_ver_correlation: "Calibration Verification / Linearity and Correlation / Method Comparison",
  method_comparison: "Correlation / Method Comparison", correlation: "Correlation / Method Comparison", precision: "Precision",
  ref_interval: "Reference Range Verification", pt_coag: "PT/INR Geometric Mean Calculator", lot_to_lot: "Reagent Lot Verification",
  qc_range: "QC Lot Verification", multi_analyte_coag: "Multi-Analyte Lot Comparison", carryover: "Carryover Verification",
  accuracy_bias: "Accuracy / Bias Verification", linearity: "Linearity Verification", reportable_range: "Reportable Range Verification",
  sensitivity: "Analytical Sensitivity", manual_diff: "Manual Differential", heparin_range: "Heparin Therapeutic Range", cumsum: "CUMSUM",
};
export const studyName = (s: any) => [s.test_name, STUDY_NAMES[String(s.study_type)] ?? String(s.study_type ?? "").replace(/_/g, " ")].filter(Boolean).join(", ");

/** The study a finding was opened from, in the finding's own lab; null when there is none or it has been deleted. */
export function findingStudy(sqlite: any, finding: any): { id: number; name: string; date: string | null; status: string | null } | null {
  if (!finding?.study_id) return null;
  const s = sqlite.prepare("SELECT id, test_name, study_type, date, status FROM studies WHERE id = ? AND lab_id = ?").get(finding.study_id, finding.lab_id) as any;
  return s ? { id: Number(s.id), name: studyName(s), date: s.date ?? null, status: s.status ?? null } : null;
}

// ── Routes ──────────────────────────────────────────────────────────────────

interface Deps {
  sqlite: () => any;
  authMiddleware: any;
  labScopeMiddleware: any;
  requireWriteAccess: any;
  requireModuleEdit: (module: string) => any;
  hasModuleEditAccess: (labId: number, userId: number, module: string) => boolean;
  hasScanAccess: (user: any, lab?: any) => boolean;
}

// The plans whose screens include VeritaResponse (client/src/pages/VeritaResponseAppPage.tsx hasPlanAccess), so a lab on
// VeritaCheck alone isn't offered a finding it couldn't open.
const RESPONSE_PLANS = ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "clinic", "waived", "community", "hospital", "large_hospital", "enterprise"];
const responsePlan = (req: any) => RESPONSE_PLANS.includes(String(req.scope?.lab?.plan ?? req.user?.plan ?? ""));

export function registerInspectionAssignRoutes(app: Express, deps: Deps) {
  const { sqlite, authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit, hasModuleEditAccess, hasScanAccess } = deps;
  const read = [authMiddleware, labScopeMiddleware];
  const edit = (module: string) => [authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit(module)];
  const scanPlan = (req: any, res: any) => {
    if (exportAllPlanBypass(req.scope?.lab) || hasScanAccess(req.user, req.scope?.lab)) return true;
    res.status(403).json({ error: "VeritaScan® subscription required" });
    return false;
  };
  const mayAssign = (req: any, module: string) => !req.scope.viaVlsSupport && hasModuleEditAccess(req.scope.labId, req.userId, module);
  const labNameOf = (req: any) => String(req.scope?.lab?.lab_name || "Your lab");
  const nameOf = (userId: number) => String((sqlite().prepare("SELECT COALESCE(NULLIF(TRIM(name), ''), email) AS n FROM users WHERE id = ?").get(userId) as any)?.n || "Someone in your lab");
  const person = (userId: unknown, name?: string | null) => (userId ? { user_id: Number(userId), name: name ?? null } : null);
  const history = (findingId: number, event: string, byUserId: number, payload: any) =>
    sqlite().prepare("INSERT INTO finding_history (finding_id, event, by_user_id, payload) VALUES (?, ?, ?, ?)").run(findingId, event, byUserId, JSON.stringify(payload));

  // The people an editor can pick from. Only someone who can assign there reads the list, so a Staff login, a view-only
  // reviewer and Veritas support don't get the lab's people through it.
  app.get("/api/labs/:labId/assignable-people", ...read, (req: any, res: any) => {
    const module = String(req.query.module ?? "");
    if (module !== "veritaresponse" && module !== "veritascan") return res.status(400).json({ error: "module must be veritaresponse or veritascan" });
    if (!mayAssign(req, module)) return res.status(403).json({ error: "Only someone who can edit this module can assign in it.", code: "ASSIGN_EDIT_ONLY" });
    res.json({ people: assignablePeople(sqlite(), req.scope.labId) });
  });

  // ── Findings ──────────────────────────────────────────────────────────────

  const findingInLab = (req: any) => sqlite().prepare("SELECT * FROM findings WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
  const assigneeView = (req: any, f: any) => {
    if (!f.assignee_user_id) return null;
    const here = assignablePerson(sqlite(), req.scope.labId, f.assignee_user_id);
    return {
      user_id: Number(f.assignee_user_id), name: here?.name ?? nameOf(f.assignee_user_id), on_lab: !!here,
      assigned_at: f.assigned_at ?? null, assigned_by: f.assigned_by_user_id ? nameOf(f.assigned_by_user_id) : null,
    };
  };

  // Whoever reads the finding reads who it is assigned to.
  app.get("/api/labs/:labId/findings/:id/assignee", ...read, (req: any, res: any) => {
    const f = findingInLab(req);
    if (!f) return res.status(404).json({ error: "Finding not found" });
    res.json({ assignee: assigneeView(req, f), mine: Number(f.assignee_user_id) === Number(req.userId), canAssign: mayAssign(req, "veritaresponse") });
  });

  app.put("/api/labs/:labId/findings/:id/assignee", ...edit("veritaresponse"), async (req: any, res: any) => {
    const f = findingInLab(req);
    if (!f) return res.status(404).json({ error: "Finding not found" });
    const pick = pickedUserId(req.body?.user_id);
    if (pick === undefined) return res.status(400).json(BAD_PICK);
    const to = pick === null ? null : assignablePerson(sqlite(), req.scope.labId, pick);
    if (pick !== null && !to) return res.status(400).json(NOT_ON_LAB);
    const beforeId = f.assignee_user_id ? Number(f.assignee_user_id) : null;
    if (beforeId === pick) return res.json({ ok: true, unchanged: true, assignee: assigneeView(req, f), email: "none" });
    const before = beforeId ? person(beforeId, nameOf(beforeId)) : null;
    const now = new Date().toISOString();
    sqlite().transaction(() => {
      sqlite().prepare("UPDATE findings SET assignee_user_id = ?, assigned_at = ?, assigned_by_user_id = ? WHERE id = ?")
        .run(pick, pick === null ? null : now, pick === null ? null : req.userId, f.id);
      history(f.id, pick === null ? "assignment_cleared" : before ? "assignment_changed" : "assigned", req.userId, { before, after: to ? person(to.userId, to.name) : null });
    })();
    const saved = findingInLab(req);
    let email: "none" | "sent" | "failed" = "none";
    if (to && !req.isDemo) { // a public demo session sends nothing
      const m = findingAssignedEmail(saved, labNameOf(req), nameOf(req.userId));
      email = await sendOne(to.email, m.subject, m.html);
    }
    res.json({ ok: true, assignee: assigneeView(req, saved), email });
  });

  // ── VeritaScan items ──────────────────────────────────────────────────────

  app.put("/api/labs/:labId/veritascan/scans/:id/items/:itemId/assignee", ...edit("veritascan"), async (req: any, res: any) => {
    if (!scanPlan(req, res)) return;
    const db = sqlite();
    const scan = db.prepare("SELECT id, name FROM veritascan_scans WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    const item = scanItem(req.params.itemId);
    if (!scan || !item) return res.status(404).json({ error: "Item not found in this scan" });
    const pick = pickedUserId(req.body?.user_id);
    if (pick === undefined) return res.status(400).json(BAD_PICK);
    const to = pick === null ? null : assignablePerson(db, req.scope.labId, pick);
    if (pick !== null && !to) return res.status(400).json(NOT_ON_LAB);
    const row = db.prepare("SELECT id, owner, owner_user_id FROM veritascan_items WHERE scan_id = ? AND item_id = ?").get(scan.id, item.id) as any;
    const beforeId = row?.owner_user_id ? Number(row.owner_user_id) : null;
    if (beforeId === pick) return res.json({ ok: true, unchanged: true, owner: row?.owner ?? null, owner_user_id: beforeId, email: "none" });
    assignScanItems(db, { req, scan, itemIds: [item.id], to });
    let email: "none" | "sent" | "failed" = "none";
    if (to) email = await emailScanItems(req, scan, [item.id], to, null);
    const saved = db.prepare("SELECT owner, owner_user_id FROM veritascan_items WHERE scan_id = ? AND item_id = ?").get(scan.id, item.id) as any;
    res.json({ ok: true, owner: saved.owner ?? null, owner_user_id: saved.owner_user_id ?? null, email });
  });

  const emailScanItems = async (req: any, scan: any, itemIds: number[], to: AssignablePerson, dueDate: string | null): Promise<"none" | "sent" | "failed"> => {
    if (req.isDemo) return "none"; // a public demo session sends nothing
    const m = scanItemsAssignedEmail({ labId: req.scope.labId, labName: labNameOf(req), scanId: scan.id, scanName: scan.name, itemIds, dueDate, assignedBy: nameOf(req.userId) });
    return sendOne(to.email, m.subject, m.html);
  };

  // Everything in this lab's scans whose owner is the signed-in person, for "Assigned to me".
  app.get("/api/labs/:labId/veritascan/assigned-to-me", ...read, (req: any, res: any) => {
    if (!scanPlan(req, res)) return;
    const rows = sqlite().prepare(
      `SELECT s.id AS scan_id, s.name AS scan_name, i.item_id, i.status, i.due_date, i.owner_assigned_at
         FROM veritascan_items i JOIN veritascan_scans s ON s.id = i.scan_id
        WHERE s.lab_id = ? AND i.owner_user_id = ?
        ORDER BY s.updated_at DESC, s.id DESC, i.item_id`
    ).all(req.scope.labId, req.userId) as any[];
    res.json(rows.map((r) => ({ ...r, domain: scanItem(r.item_id)?.domain ?? null, question: scanItem(r.item_id)?.question ?? `Item ${r.item_id}` })));
  });

  // ── A failed study opens a finding ────────────────────────────────────────

  const studyInLab = (req: any) => sqlite().prepare("SELECT * FROM studies WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
  const studyFindings = (labId: number, studyId: number) => sqlite().prepare(
    "SELECT id, finding_number, status, source_type, created_at FROM findings WHERE lab_id = ? AND study_id = ? ORDER BY id DESC"
  ).all(labId, studyId) as any[];

  // The findings opened from a study (whoever opens the study reads them, as the lab's findings list already shows them).
  app.get("/api/labs/:labId/studies/:id/findings", ...read, (req: any, res: any) => {
    const s = studyInLab(req);
    if (!s) return res.status(404).json({ error: "Study not found" });
    res.json({
      failed: s.status === "fail",
      canOpen: s.status === "fail" && responsePlan(req) && (hasModuleEditAccess(req.scope.labId, req.userId, "veritaresponse") || !!req.scope.viaVlsSupport),
      findings: studyFindings(req.scope.labId, s.id),
    });
  });

  app.post("/api/labs/:labId/studies/:id/open-finding", ...edit("veritaresponse"), (req: any, res: any) => {
    const db = sqlite();
    const s = studyInLab(req);
    if (!s) return res.status(404).json({ error: "Study not found" });
    if (!responsePlan(req)) return res.status(403).json({ error: "VeritaResponse™ is not on this lab's plan.", code: "PLAN_REQUIRED" });
    if (s.status !== "fail") return res.status(409).json({ error: "Only a study whose result is FAIL can open a finding.", code: "STUDY_NOT_FAILED" });
    const name = studyName(s);
    const day = /^\d{4}-\d{2}-\d{2}/.test(String(s.date ?? "")) ? String(s.date).slice(0, 10) : null;
    const owner = db.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(req.scope.labId) as any;
    const out = db.transaction(() => {
      // One open finding per study: a second click, or a second person, gets the one already there.
      const open = studyFindings(req.scope.labId, s.id).find((f) => f.status !== "closed" && f.status !== "accepted");
      if (open) return { open };
      const id = Number(db.prepare(
        `INSERT INTO findings (user_id, lab_id, accreditor, source_type, status, study_id, event_date, anchor_date, discovered_by, description)
         VALUES (?, ?, 'Other', 'internal_nce', 'open', ?, ?, ?, ?, ?)`
      ).run(owner?.owner_user_id ?? req.userId, req.scope.labId, s.id, day, day, req.scope.viaVlsSupport ? null : nameOf(req.userId),
        `VeritaCheck® study ${s.id}: ${name}${s.instrument ? `, ${s.instrument}` : ""}${day ? `, dated ${day}` : ""}. The study's result is FAIL.`).lastInsertRowid);
      history(id, "created", req.userId, { accreditor: "Other", source_type: "internal_nce", status: "open", study_id: s.id, study: name });
      logAudit({
        userId: req.userId, ownerUserId: owner?.owner_user_id ?? req.userId, module: "veritacheck", action: "create", entityType: "study_finding",
        entityId: s.id, entityLabel: `${name}: opened VeritaResponse finding #${id}`, after: { finding_id: id, study_id: s.id }, ipAddress: req.ip,
      });
      return { id };
    })();
    if ("open" in out && out.open) return res.status(409).json({ error: `Finding ${findingLabel(out.open)} is already open for this study.`, code: "FINDING_EXISTS", finding_id: out.open.id });
    res.status(201).json(db.prepare("SELECT * FROM findings WHERE id = ?").get((out as any).id));
  });

  return { emailScanItems };
}

/**
 * Sets or clears the person on items of one scan and writes one audit row per item whose person changed. A row that doesn't
 * exist yet is made as Not Assessed. Returns the item ids whose person changed.
 */
export function assignScanItems(db: any, o: { req: any; scan: { id: number; name: string }; itemIds: number[]; to: AssignablePerson | null }): number[] {
  const now = new Date().toISOString();
  const get = db.prepare("SELECT id, owner, owner_user_id FROM veritascan_items WHERE scan_id = ? AND item_id = ?");
  const make = db.prepare("INSERT INTO veritascan_items (scan_id, item_id, status, updated_at) VALUES (?, ?, 'Not Assessed', ?) ON CONFLICT(scan_id, item_id) DO NOTHING");
  const set = db.prepare("UPDATE veritascan_items SET owner = ?, owner_user_id = ?, owner_assigned_at = ?, owner_assigned_by_user_id = ?, updated_at = ? WHERE id = ?");
  const changed: number[] = [];
  db.transaction(() => {
    for (const itemId of o.itemIds) {
      make.run(o.scan.id, itemId, now);
      const row = get.get(o.scan.id, itemId) as any;
      const toId = o.to?.userId ?? null;
      if ((row.owner_user_id ?? null) === toId) continue;
      set.run(o.to?.name ?? null, toId, o.to ? now : null, o.to ? o.req.userId : null, now, row.id);
      changed.push(itemId);
      logAudit({
        userId: o.req.userId, ownerUserId: o.req.scope?.lab?.owner_user_id ?? o.req.ownerUserId ?? o.req.userId, module: "veritascan", action: "update",
        entityType: "veritascan_item", entityId: row.id, entityLabel: `${o.scan.name}: item ${itemId} ${o.to ? `assigned to ${o.to.name}` : "assignment cleared"}`,
        before: { owner: row.owner ?? null, owner_user_id: row.owner_user_id ?? null }, after: { owner: o.to?.name ?? null, owner_user_id: toId }, ipAddress: o.req.ip,
      });
    }
    if (changed.length) db.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?").run(now, o.scan.id);
  })();
  return changed;
}
