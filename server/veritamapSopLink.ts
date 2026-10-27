// server/veritamapSopLink.ts
//
// Parking lot #93 (Michael Q85 = 1, Q86 = 1, 2026-10-11): a VeritaMap test's SOP links to a VeritaDC policy, and the
// map reads that policy's review state instead of a hand-entered date. veritamap_tests.sop_document_id holds the link;
// a test with no link keeps last_sop_review exactly as before (24-month cycle).
//
// For a linked test:
//   last_review = the newest approval or recertification of the policy (policy_signoffs action 'approved' or
//                 'recertified'), as the lab's calendar day
//   next_review = policy_documents.next_review_date
//   overdue     = the policy is missing, archived or not approved, or its next review date has passed (lab day)
import { labLocalDate, labToday } from "./dateLocal";

export interface SopLink {
  document_id: number;
  title: string | null;
  status: string | null;
  last_review: string | null;
  next_review: string | null;
  overdue: boolean;
  reason: string | null;
}

// policy_signoffs.signed_at is SQLite datetime('now'), "YYYY-MM-DD HH:MM:SS" in UTC.
const signedDay = (v: unknown): string | null => {
  if (!v) return null;
  const t = String(v);
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t.replace(" ", "T") + "Z";
  return labLocalDate(iso) || null;
};

export function sopLinksByDocument(sqlite: any, labId: number, documentIds: number[], today: string = labToday()): Map<number, SopLink> {
  const out = new Map<number, SopLink>();
  const ids = [...new Set(documentIds.filter((x) => Number.isFinite(Number(x)) && Number(x) > 0).map(Number))];
  if (ids.length === 0) return out;
  const ph = ids.map(() => "?").join(",");
  const docs = sqlite.prepare(
    `SELECT id, title, status, next_review_date, archived_at FROM policy_documents WHERE lab_id = ? AND id IN (${ph})`
  ).all(labId, ...ids) as any[];
  const lastByDoc = new Map<number, string | null>();
  for (const r of sqlite.prepare(
    `SELECT document_id, MAX(signed_at) AS last FROM policy_signoffs WHERE document_id IN (${ph}) AND action IN ('approved', 'recertified') GROUP BY document_id`
  ).all(...ids) as any[]) {
    lastByDoc.set(Number(r.document_id), signedDay(r.last));
  }
  const byId = new Map<number, any>(docs.map((d) => [Number(d.id), d]));
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) { out.set(id, { document_id: id, title: null, status: null, last_review: null, next_review: null, overdue: true, reason: "The linked policy is no longer in this lab." }); continue; }
    const next = d.next_review_date ? String(d.next_review_date).slice(0, 10) : null;
    let reason: string | null = null;
    if (d.archived_at) reason = "The linked policy is archived.";
    else if (d.status !== "approved") reason = `The linked policy is ${String(d.status || "not approved").replace(/_/g, " ")}, not approved.`;
    else if (next && next < today) reason = `The linked policy's review was due ${next}.`;
    out.set(id, { document_id: id, title: d.title ?? null, status: d.status ?? null, last_review: lastByDoc.get(id) ?? null, next_review: next, overdue: !!reason, reason });
  }
  return out;
}

// Adds sop_link to each row that has a sop_document_id (rows must carry sop_document_id).
export function attachSopLinks<T extends { sop_document_id?: number | null }>(sqlite: any, labId: number, rows: T[]): (T & { sop_link: SopLink | null })[] {
  const links = sopLinksByDocument(sqlite, labId, rows.map((r) => Number(r.sop_document_id)).filter(Boolean));
  return rows.map((r) => ({ ...r, sop_link: r.sop_document_id ? links.get(Number(r.sop_document_id)) ?? null : null }));
}

// The SOP state a consumer should use: the linked policy when there is one, else the hand-entered date.
export function effectiveSop(row: { last_sop_review?: string | null; sop_link?: SopLink | null }): { date: string | null; linked: boolean; overdue: boolean | null } {
  if (row.sop_link) return { date: row.sop_link.last_review, linked: true, overdue: row.sop_link.overdue };
  return { date: row.last_sop_review ?? null, linked: false, overdue: null };
}
