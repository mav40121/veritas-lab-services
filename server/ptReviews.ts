// server/ptReviews.ts
//
// The laboratory's review of a whole VeritaPT event (B11, 2026-11-24; 42 CFR §493.1236(a): the laboratory must review and
// evaluate the results obtained on proficiency testing). A review keeps what was seen: every result's status, numbers and newest
// evaluation. A result added, changed or evaluated afterwards shows the event as changed since its review, and a new review is
// added in front of the old one. A review is never edited or removed.
//
// Unacceptable results, and ungraded ones the laboratory hasn't evaluated or found unacceptable, need the corrective action or
// investigation the review links to: a VeritaPT corrective action of this event, or a VeritaResponse finding of this lab.
// Linking opens, changes and closes nothing; the record stays where it is.
//
// The laboratory director or designee review is the module's own record, director_reviewed_at and director_id, as on an
// alternative assessment record: recorded by someone with VeritaPT edit, never by Veritas support (server/vlsSupport.ts), and
// here only for the person signed in, once, at the server's time. It isn't an electronic signature.
import type { Express } from "express";
import { createHash } from "node:crypto";
import { PT_REVIEW_NONE, type PtEvent, type PtEventReview, type PtLinkedAction, type PtLinkedFinding, type PtResult } from "@shared/ptEvents";
import { ptAudit, ptEventOfResult, ptEventsOfLab, type PtDeps } from "./ptEvents";

const txt = (v: unknown, max = 4000): string => String(v ?? "").trim().slice(0, max);
const ids = (v: unknown): number[] => Array.from(new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0)));
const parse = (s: unknown): number[] => { try { return ids(JSON.parse(String(s || "[]"))); } catch { return []; } };

/** What a reviewer sees of an event: one line per result, in id order. */
const seenOf = (results: PtResult[]): unknown[][] => results.slice().sort((a, b) => a.id - b.id)
  .map((r) => [r.id, r.analyte, r.status, r.ungraded_reason, r.your_result, r.peer_mean, r.peer_sd, r.acceptable_low, r.acceptable_high, r.evaluations[0]?.id ?? null]);
export const ptReviewToken = (results: PtResult[]): string => createHash("sha256").update(JSON.stringify(seenOf(results))).digest("hex").slice(0, 32);

/** Which event a stored list of results belongs to now: the one that holds most of them. */
export function ptEventHolding(events: PtEvent[], resultIds: number[]): PtEvent | null {
  let best: PtEvent | null = null, most = 0;
  for (const e of events) {
    const n = e.results.filter((r) => resultIds.includes(r.id)).length;
    if (n > most) { best = e; most = n; }
  }
  return best;
}

/** Why a review of these results needs a link, or none. */
export const ptNeedsLink = (results: PtResult[]): boolean => results.some((r) =>
  r.status === "unacceptable" || (r.status === "ungraded" && (r.evaluations.length === 0 || r.evaluations[0].conclusion === "fail")));

/** The events with their reviews: newest first, and where the newest stands against the results now. */
export function withPtReviews(sqlite: any, labId: number, events: PtEvent[]): PtEvent[] {
  const byKey = new Map<string, any[]>();
  for (const row of sqlite.prepare("SELECT * FROM pt_event_reviews WHERE lab_id = ? ORDER BY id DESC").all(labId) as any[]) {
    const e = ptEventHolding(events, parse(row.result_ids_json));
    if (e) byKey.set(e.key, [...(byKey.get(e.key) ?? []), row]);
  }
  return events.map((e) => {
    const rows = byKey.get(e.key) ?? [];
    if (!rows.length) return { ...e, review: PT_REVIEW_NONE };
    const now = JSON.stringify(seenOf(e.results)), r = rows[0];
    return { ...e, review: { id: Number(r.id), state: r.results_json === now ? "reviewed" as const : "changed" as const, reviewed_by_name: r.reviewed_by_name, reviewed_at: r.reviewed_at, director_reviewed_at: r.director_reviewed_at, director_name: r.director_name } };
  });
}

const actionsOf = (sqlite: any, labId: number, e: PtEvent): PtLinkedAction[] => (sqlite.prepare(
  `SELECT ca.id, ca.corrective_action, ca.status, ca.date_initiated, ev.analyte FROM pt_corrective_actions ca JOIN pt_events ev ON ev.id = ca.event_id AND ev.lab_id = ca.lab_id
    WHERE ca.lab_id = ? AND ca.event_id IN (${e.results.map(() => "?").join(",")}) ORDER BY ca.date_initiated DESC, ca.id DESC`
).all(labId, ...e.results.map((r) => r.id)) as any[]).map((c) => ({ id: Number(c.id), analyte: c.analyte, corrective_action: c.corrective_action, status: c.status, date_initiated: c.date_initiated }));

const FINDING = "id, finding_number, accreditor, source_type, standard_ref, description, status, pt_analyte, pt_event";
const findingView = (f: any): PtLinkedFinding => ({
  id: Number(f.id), finding_number: f.finding_number ?? null, accreditor: f.accreditor, source_type: f.source_type, standard_ref: f.standard_ref ?? null,
  description: txt(f.description, 300) || null, status: f.status, pt_analyte: f.pt_analyte ?? null, pt_event: f.pt_event ?? null,
});

/** One event's reviews with what each links to, and, for an editor, what can be linked. */
export function ptReviewDetail(sqlite: any, labId: number, e: PtEvent, canEdit: boolean) {
  const events = ptEventsOfLab(sqlite, labId);
  const rows = (sqlite.prepare("SELECT * FROM pt_event_reviews WHERE lab_id = ? ORDER BY id DESC").all(labId) as any[]).filter((r) => ptEventHolding(events, parse(r.result_ids_json))?.key === e.key);
  const actions = new Map((sqlite.prepare("SELECT ca.id, ca.corrective_action, ca.status, ca.date_initiated, ev.analyte FROM pt_corrective_actions ca LEFT JOIN pt_events ev ON ev.id = ca.event_id WHERE ca.lab_id = ?").all(labId) as any[]).map((c) => [Number(c.id), c]));
  const findings = new Map((sqlite.prepare(`SELECT ${FINDING} FROM findings WHERE lab_id = ?`).all(labId) as any[]).map((f) => [Number(f.id), f]));
  const reviews: PtEventReview[] = rows.map((r) => ({
    id: Number(r.id), notes: r.notes ?? null, reviewed_by_name: r.reviewed_by_name ?? null, reviewed_at: r.reviewed_at, director_reviewed_at: r.director_reviewed_at ?? null, director_name: r.director_name ?? null,
    // A linked record since removed says so, rather than disappearing from the review.
    corrective_actions: parse(r.corrective_action_ids_json).map((id) => { const c = actions.get(id); return { id, analyte: c?.analyte ?? null, corrective_action: c?.corrective_action ?? null, status: c?.status ?? null, date_initiated: c?.date_initiated ?? null }; }),
    findings: parse(r.finding_ids_json).map((id) => (findings.has(id) ? findingView(findings.get(id)) : { id, finding_number: null, accreditor: null, source_type: null, standard_ref: null, description: null, status: null, pt_analyte: null, pt_event: null })),
  }));
  const analytes = new Set(e.analytes.map((a) => a.toLowerCase()));
  // A proficiency testing failure first, then one naming an analyte of this event, then the newest.
  const rank = (f: any) => (f.source_type === "pt_failure" ? 0 : 2) + (analytes.has(String(f.pt_analyte || "").toLowerCase()) ? 0 : 1);
  return {
    reviews, review_token: ptReviewToken(e.results), needs_link: ptNeedsLink(e.results),
    options: canEdit ? { corrective_actions: actionsOf(sqlite, labId, e), findings: Array.from(findings.values()).sort((a, b) => rank(a) - rank(b) || b.id - a.id).slice(0, 200).map(findingView) } : null,
  };
}

export function registerPtReviewRoutes(app: Express, deps: PtDeps) {
  const { sqlite, authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit, hasPTAccess } = deps;
  const edit = [authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritapt")];
  const plan = (req: any, res: any) => {
    if (hasPTAccess(req.user, req.scope?.lab)) return true;
    res.status(403).json({ error: "VeritaPT™ subscription required" });
    return false;
  };
  const nameOf = (userId: number) => (sqlite().prepare("SELECT name FROM users WHERE id = ?").get(userId) as any)?.name ?? null;
  const CHANGED = { error: "A result of this event changed after you opened it. Read it again, then record the review.", code: "EVENT_CHANGED" };

  app.post("/api/labs/:labId/pt/event-reviews", ...edit, (req: any, res: any) => {
    if (!plan(req, res)) return;
    const labId = req.scope.labId, b = req.body ?? {};
    const event = ptEventOfResult(sqlite(), labId, b.result_id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (event.counts.not_graded > 0) return res.status(409).json({ error: "Record the status of every result first: some are not yet graded.", code: "NOT_GRADED" });
    if (b.review_token !== ptReviewToken(event.results)) return res.status(409).json(CHANGED);
    const actions = ids(b.corrective_action_ids), findings = ids(b.finding_ids), offered = new Set(actionsOf(sqlite(), labId, event).map((c) => c.id));
    if (actions.some((id) => !offered.has(id))) return res.status(400).json({ error: "Link a corrective action of this event." });
    if (findings.some((id) => !sqlite().prepare("SELECT 1 FROM findings WHERE id = ? AND lab_id = ?").get(id, labId))) return res.status(400).json({ error: "Link a VeritaResponse™ finding of this laboratory." });
    if (ptNeedsLink(event.results) && !actions.length && !findings.length) {
      return res.status(400).json({ error: "This event has an unacceptable result, or an ungraded one without an acceptable evaluation. Link its corrective action or investigation.", code: "LINK_REQUIRED" });
    }
    const row = {
      lab_id: labId, result_ids_json: JSON.stringify(event.results.map((r) => r.id).sort((x, y) => x - y)), results_json: JSON.stringify(seenOf(event.results)),
      event_label: event.name, program_label: event.program, notes: txt(b.notes) || null, corrective_action_ids_json: JSON.stringify(actions), finding_ids_json: JSON.stringify(findings),
      reviewed_by_user_id: req.userId, reviewed_by_name: nameOf(req.userId), reviewed_at: new Date().toISOString(),
    };
    const keys = Object.keys(row);
    const id = Number(sqlite().prepare(`INSERT INTO pt_event_reviews (${keys.join(", ")}) VALUES (${keys.map((k) => `@${k}`).join(", ")})`).run(row).lastInsertRowid);
    ptAudit(req, "create", "pt_event_review", id, `${event.program}, ${event.name}`, event.review.id ? { earlier_review_id: event.review.id, state: event.review.state } : null, row);
    res.status(201).json({ id });
  });

  app.post("/api/labs/:labId/pt/event-reviews/:id/director-review", ...edit, (req: any, res: any) => {
    if (!plan(req, res)) return;
    const labId = req.scope.labId;
    const row = sqlite().prepare("SELECT * FROM pt_event_reviews WHERE id = ? AND lab_id = ?").get(Number(req.params.id), labId) as any;
    if (!row) return res.status(404).json({ error: "Review not found" });
    if (row.director_reviewed_at) return res.status(409).json({ error: "The laboratory director or designee review is already recorded.", code: "ALREADY_REVIEWED" });
    const event = ptEventHolding(ptEventsOfLab(sqlite(), labId), parse(row.result_ids_json));
    if (!event || event.review.id !== Number(row.id) || event.review.state !== "reviewed") return res.status(409).json(CHANGED);
    const after = { director_reviewed_at: new Date().toISOString(), director_id: req.userId, director_name: nameOf(req.userId) };
    const n = sqlite().prepare("UPDATE pt_event_reviews SET director_reviewed_at = @director_reviewed_at, director_id = @director_id, director_name = @director_name WHERE id = @id AND director_reviewed_at IS NULL").run({ ...after, id: row.id }).changes;
    if (!n) return res.status(409).json({ error: "The laboratory director or designee review is already recorded.", code: "ALREADY_REVIEWED" });
    ptAudit(req, "update", "pt_event_review", row.id, `${row.program_label}, ${row.event_label}: laboratory director or designee review`, { director_reviewed_at: null, director_id: null }, after);
    res.json({ ok: true, ...after });
  });
}
