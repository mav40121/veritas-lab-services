// server/digestIssues.ts
//
// The compliance digest's issue builder (Michael's approved spec, 2026-11-10, Q281 = 1; PR 3 of 5). Routes and storage only:
// the reading screens are PR 4, the notice email and the PDF PR 5. A feature of VeritaAssure, not a module: no module name,
// no seat permission, included in every subscription plan (the readiness dashboard's allowlist).
//
// Settings (digest_settings, one row per lab): which sections, the audience, monthly or quarterly, whether a new issue asks
// readers to acknowledge it, and whether its PDF carries the medical director or designee review box (Q284 = 1). Any member
// reads them; only the lab's owner or an admin changes them (403 OWNER_OR_ADMIN_ONLY, the VeritaComp non-technical frequency
// pattern). `enabled` turns on the daily draft job (below) for the lab; drafting by hand doesn't need it.
//
// An issue (digest_issues) covers one finished month, or calendar quarter, on the lab's own clock. The owner or an admin
// drafts it (it takes the lab's settings at that moment), edits the note, sections, audience and flags, then publishes or
// withdraws it. A draft shows live counts from digestCountsForLab (server/digestCounts.ts); publish freezes them in
// counts_json with the moment they were taken, so each issue stays a dated record. Only the sections the issue includes
// are stored. Nothing is published on its own, and nothing here sends email or rings the bell.
//
// Who reads a published issue: leadership = the lab's owner, admins and its medical director (labs.medical_director_email
// matching the reader's login); staff = every active member and Staff login of the lab; groups = the members of the named
// lab_groups (server/labGroups.ts, the VeritaDC read-and-sign groups). The owner and admins see every issue in any state. A
// limited Staff login (staffOwnScope) never reads a leadership issue. Anyone else gets 404 for an issue they can't see, the
// same answer as an id that doesn't exist, so issue ids don't leak.
//
// Read and acknowledgment (digest_issue_acks): the signed-in reader, each recorded once; acknowledgment only when the issue
// asks for it. The roster of who has and hasn't is the owner's and admins' only, and it names lab members; anyone else gets
// their own status. counts_json never carries a name, email or person id (PR 2 guarantees it).
//
// The reading screens (PR 4, client/src/pages/DigestPage.tsx) added three read-only fields: GET issues/:id
// carries `previous` (the lab's prior published issue of the same frequency, with the counts it stored, for the change lines)
// and `audience_groups` (the names of a group issue's groups), and GET settings gives the owner and admins the lab's active
// `groups` to pick from. Nothing new is stored.
//
// Every text in a write goes through the patient-information refusal (shared/phiPatterns.ts detectPhi): 400 PHI_REFUSED
// with the field, refused rather than warned, as the tissue and stain logs do. Create, edit, publish and withdraw each write
// an audit_log row (logAudit; module "account", the lab-wide one, since the digest is no module of its own).
//
// PR 5 (the last): the issue PDF and the notice email.
//   GET issues/:id/pdf: a published issue's PDF (server/digestPdf.ts, the approved PDF mock of 2026-11-11), with the issue
//     GET's reach exactly (visibleIssue): whoever can open the issue gets its PDF, anyone else the same 404. A draft or
//     withdrawn issue has no PDF: 409 NOT_PUBLISHED for the owner and admins (the read and ack routes' answer), and the
//     issue GET's 404 for anyone else, who can't see it. It prints what GET issues/:id gives that reader (detail()), so the
//     numbers and change words are the screen's.
//   The notice (decided 2026-11-11): publishing sends nothing. The owner or an admin sends one notice per published issue,
//     once (digest_issues.notice_sent_at, notice_sent_count, notice_sent_by_user_id; 409 NOTICE_SENT after that):
//     GET issues/:id/notice gives the count first, POST issues/:id/notice {expectedCount} sends one email per person the
//     audience reaches (audiencePeople, the roster's list) who has a login with an address, and is refused 409
//     COUNT_CHANGED when that count isn't the one the screen showed, 409 NOT_PUBLISHED for a draft or withdrawn issue. The
//     email says the issue is ready, whether acknowledgment is asked, and links to it; it carries no counts and no name but
//     the recipient's own greeting. It goes through the read-and-sign notice's mailer (policyReadSign.ts readSignMailer, the
//     one the tests swap out) from info@veritaslabservices.com, in the background at that mailer's pace. Sent and finished
//     each write an audit row. Veritas support can't send it (server/vlsSupport.ts).
//
// The daily draft job (runDigestAutoDrafts, scheduled in server/index.ts): for each lab whose settings have `enabled` on and
// whose plan is on DIGEST_PLANS, on that lab's own calendar day, it drafts the last finished month (or calendar quarter)
// through createDigestDraft, the function POST issues uses, so the draft takes the lab's settings at that moment exactly as
// a manual draft does. A period another non-withdrawn issue holds is 409 PERIOD_HAS_ISSUE there, which the job counts as
// already done, so a second run (or a later day's) never makes a second draft. The issue is marked created_by_job = 1 (the
// list's "Drafted automatically on <date>"), and its audit row is the manual one's with user id 0, the codebase's system
// actor in audit_log. It only drafts: it never publishes and never sends the notice or any other email.

import type { Express } from "express";
import { db } from "./db";
import { logAudit, type AuditAction } from "./audit";
import { digestCountsForLab, type DigestCounts } from "./digestCounts";
import { addLabDays, labLocalDate, labTimeZoneById, labToday, withLabClock } from "./dateLocal";
import { staffOwnScope } from "./competencySelfEntry";
import { EMAIL_RE, labGroupSignerIds } from "./labGroups";
import { readSignMailer } from "./policyReadSign";
import { digestPdfFilename, generateDigestPDF } from "./digestPdf";
import { detectPhi } from "@shared/phiPatterns";
import { periodTitle } from "@shared/digestCards";

const sqliteOf = () => (db as any).$client;
const BASE = "/api/labs/:labId/digest";

export const DIGEST_SECTION_KEYS = [
  "competencies", "studies", "newTests", "pt", "documents", "certificates", "maintenance", "qc", "stock", "tasks", "findings", "scan",
] as const;
export type DigestSectionKey = typeof DIGEST_SECTION_KEYS[number];
/** Every section but the optional survey-readiness scan. */
export const DEFAULT_DIGEST_SECTIONS: DigestSectionKey[] = DIGEST_SECTION_KEYS.filter((k) => k !== "scan");
export const DIGEST_FREQUENCIES = ["monthly", "quarterly"] as const;
export type DigestFrequency = typeof DIGEST_FREQUENCIES[number];
export const DIGEST_AUDIENCES = ["leadership", "staff", "groups"] as const;
export type DigestAudience = typeof DIGEST_AUDIENCES[number];
const NOTE_MAX = 4000;
const REASON_MAX = 1000;

// Included in every subscription plan (Q281 = 1): the readiness dashboard's explicit allowlist.
const DIGEST_PLANS = ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "clinic", "waived", "community", "hospital", "large_hospital", "enterprise"];
export const hasDigestAccess = (lab: any): boolean => DIGEST_PLANS.includes(String(lab?.plan ?? ""));

// ── Periods ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// A real calendar day. "2026-13-01" or "2026-02-30" is not (an invalid Date's toISOString throws, so test the time first).
const validDay = (d: string) => { if (!DAY_RE.test(d)) return false; const t = new Date(`${d}T00:00:00Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d; };
const monthsPer = (f: DigestFrequency) => (f === "quarterly" ? 3 : 1);
export interface DigestPeriod { start: string; end: string }

/** The month, or calendar quarter, that starts on `start`, or why one can't start there. */
export function digestPeriodFrom(start: unknown, frequency: DigestFrequency): DigestPeriod | { error: string } {
  const s = String(start ?? "").trim();
  if (!validDay(s)) return { error: "Enter the period's first day as YYYY-MM-DD." };
  const quarterStart = (Number(s.slice(5, 7)) - 1) % 3 === 0;
  if (frequency === "quarterly" && (s.slice(8) !== "01" || !quarterStart)) return { error: "A quarter starts on the first of January, April, July or October." };
  if (s.slice(8) !== "01") return { error: "A month's issue starts on the first of the month." };
  return { start: s, end: addLabDays(s, -1, monthsPer(frequency)) };
}

/** Whether an issue's stored period is a month or a calendar quarter (null for a range that is neither). */
export function digestPeriodFrequency(row: { period_start: string; period_end: string }): DigestFrequency | null {
  for (const f of DIGEST_FREQUENCIES) {
    const p = digestPeriodFrom(row.period_start, f);
    if (!("error" in p) && p.end === row.period_end) return f;
  }
  return null;
}

/** The last month, or calendar quarter, finished by `today` (a day on the lab's own calendar). */
export function lastFinishedDigestPeriod(today: string, frequency: DigestFrequency): DigestPeriod {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const first = frequency === "quarterly" ? Math.floor((m - 1) / 3) * 3 + 1 : m;
  const current = `${y}-${String(first).padStart(2, "0")}-01`;
  return digestPeriodFrom(addLabDays(current, 0, -monthsPer(frequency)), frequency) as DigestPeriod;
}

// ── Settings ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface DigestSettings {
  enabled: boolean;
  frequency: DigestFrequency;
  sections: DigestSectionKey[];
  audience: DigestAudience;
  audience_group_ids: number[];
  ack_default: boolean;
  review_box: boolean;
  updated_at: string | null;
  updated_by_user_id: number | null;
}

const parseJsonArray = (v: unknown): unknown[] => { try { const x = JSON.parse(String(v ?? "")); return Array.isArray(x) ? x : []; } catch { return []; } };
const storedSections = (v: unknown, fallback: readonly DigestSectionKey[]): DigestSectionKey[] => {
  if (v == null) return [...fallback];
  const set = new Set(parseJsonArray(v).map(String));
  return DIGEST_SECTION_KEYS.filter((k) => set.has(k));
};
const storedIds = (v: unknown): number[] => parseJsonArray(v).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => ((list as readonly string[]).includes(String(v)) ? (String(v) as T) : fallback);

export function readDigestSettings(sqlite: any, labId: number): DigestSettings {
  const r = sqlite.prepare("SELECT * FROM digest_settings WHERE lab_id = ?").get(labId) as any;
  return {
    enabled: Number(r?.enabled) === 1,
    frequency: oneOf(DIGEST_FREQUENCIES, r?.frequency, "monthly"),
    sections: storedSections(r?.sections, DEFAULT_DIGEST_SECTIONS),
    audience: oneOf(DIGEST_AUDIENCES, r?.audience, "leadership"),
    audience_group_ids: storedIds(r?.audience_group_ids),
    ack_default: Number(r?.ack_default) === 1,
    review_box: Number(r?.review_box) === 1,
    updated_at: r?.updated_at ?? null,
    updated_by_user_id: r?.updated_by_user_id ?? null,
  };
}

// ── Input ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
type Clean<T> = { value: T } | { error: string; code: string };
const failed = <T>(c: Clean<T>): c is { error: string; code: string } => "error" in c;
const has = (o: any, k: string) => o != null && Object.prototype.hasOwnProperty.call(o, k);

function cleanFlag(v: unknown, label: string): Clean<boolean> {
  if (v === true || v === 1 || v === "1" || v === "true") return { value: true };
  if (v === false || v === 0 || v === "0" || v === "false") return { value: false };
  return { error: `${label}: answer yes or no.`, code: "BAD_VALUE" };
}

function cleanSections(v: unknown): Clean<DigestSectionKey[]> {
  if (!Array.isArray(v)) return { error: "Sections: send a list of section names.", code: "BAD_SECTIONS" };
  const names = v.map(String);
  const unknown = names.filter((k) => !(DIGEST_SECTION_KEYS as readonly string[]).includes(k));
  if (unknown.length) return { error: `Unknown section: ${unknown.join(", ")}.`, code: "BAD_SECTIONS" };
  const set = new Set(names);
  const out = DIGEST_SECTION_KEYS.filter((k) => set.has(k));
  if (!out.length) return { error: "Pick at least one section.", code: "BAD_SECTIONS" };
  return { value: out };
}

/** The lab's groups among these ids that are still in use (not retired). */
function activeGroupIds(sqlite: any, labId: number, ids: number[]): number[] {
  if (!ids.length) return [];
  return (sqlite.prepare(`SELECT id FROM lab_groups WHERE lab_id = ? AND retired = 0 AND id IN (${ids.map(() => "?").join(", ")})`).all(labId, ...ids) as any[]).map((r) => Number(r.id));
}

/** An audience, and the groups when it's groups: each one an active group in this lab. Other audiences carry no groups. */
function cleanAudience(sqlite: any, labId: number, audience: unknown, groupIds: unknown): Clean<{ audience: DigestAudience; groupIds: number[] }> {
  if (!(DIGEST_AUDIENCES as readonly string[]).includes(String(audience))) return { error: "Audience: choose leadership, staff or groups.", code: "BAD_AUDIENCE" };
  const a = String(audience) as DigestAudience;
  if (a !== "groups") return { value: { audience: a, groupIds: [] } };
  const raw = Array.isArray(groupIds) ? groupIds.map(Number) : [];
  const ids = Array.from(new Set(raw)).sort((x, y) => x - y);
  if (!ids.length) return { error: "Pick at least one group for a group audience.", code: "BAD_GROUPS" };
  if (ids.some((n) => !Number.isInteger(n) || n <= 0) || activeGroupIds(sqlite, labId, ids).length !== ids.length) {
    return { error: "One of those groups isn't an active group in this lab.", code: "BAD_GROUPS" };
  }
  return { value: { audience: a, groupIds: ids } };
}

/** The first string anywhere in a request body that looks like patient information: which field, and what it looks like. Never the text. */
export function findDigestPhi(body: unknown, path = ""): { field: string; labels: string[] } | null {
  if (typeof body === "string") {
    const labels = detectPhi(body);
    return labels.length ? { field: path, labels } : null;
  }
  if (Array.isArray(body)) {
    for (let i = 0; i < body.length; i++) { const hit = findDigestPhi(body[i], `${path}[${i}]`); if (hit) return hit; }
    return null;
  }
  if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) { const hit = findDigestPhi(v, path ? `${path}.${k}` : k); if (hit) return hit; }
  }
  return null;
}
export function digestPhiMessage(labels: string[]): string {
  const what = labels.map((l) => l.toLowerCase().replace("labeled ", "")).join(" and ");
  return `This looks like patient information (${what}). A compliance digest never holds a patient's details. Remove it and save again.`;
}

// ── Who reads what ────────────────────────────────────────────────────────────────────────────────────────────────────
const isManager = (req: any) => req.scope?.role === "owner" || req.scope?.role === "admin";

/** Every active member and active Staff login of the lab, by user id. */
function labPeople(sqlite: any, labId: number): Set<number> {
  return new Set((sqlite.prepare(
    `SELECT user_id AS id FROM lab_members WHERE lab_id = ? AND status = 'active'
     UNION SELECT seat_user_id AS id FROM user_seats WHERE lab_id = ? AND seat_type = 'staff_portal' AND status = 'active' AND seat_user_id IS NOT NULL`
  ).all(labId, labId) as any[]).map((r) => Number(r.id)));
}

/** The users whose login is the lab's medical director's address (labs.medical_director_email). */
function medicalDirectorIds(sqlite: any, labId: number): number[] {
  return (sqlite.prepare(
    `SELECT u.id FROM labs l JOIN users u ON lower(u.email) = lower(TRIM(l.medical_director_email))
      WHERE l.id = ? AND TRIM(COALESCE(l.medical_director_email, '')) <> ''`
  ).all(labId) as any[]).map((r) => Number(r.id));
}

/** Which audiences reach a person who isn't the owner or an admin. A limited Staff login is never leadership. */
interface Reach { leadership: boolean; staff: boolean; groups: Set<number> }
function readerReach(sqlite: any, labId: number, userId: number): Reach {
  const limited = !!staffOwnScope(sqlite, userId, labId, "digest");
  const groups = new Set<number>();
  for (const g of sqlite.prepare("SELECT id FROM lab_groups WHERE lab_id = ? AND retired = 0").all(labId) as any[]) {
    if (labGroupSignerIds(sqlite, labId, Number(g.id)).includes(userId)) groups.add(Number(g.id));
  }
  return { leadership: !limited && medicalDirectorIds(sqlite, labId).includes(userId), staff: labPeople(sqlite, labId).has(userId), groups };
}
function reaches(issue: any, reach: Reach): boolean {
  if (issue.audience === "leadership") return reach.leadership;
  if (issue.audience === "staff") return reach.staff;
  if (issue.audience === "groups") return storedIds(issue.audience_group_ids).some((g) => reach.groups.has(g));
  return false;
}

/** Everyone an issue's audience reaches today, by user id: what the roster counts against. */
function audiencePeople(sqlite: any, labId: number, issue: any): Set<number> {
  const people = labPeople(sqlite, labId);
  if (issue.audience === "staff") return people;
  const out = new Set<number>();
  if (issue.audience === "groups") {
    for (const g of activeGroupIds(sqlite, labId, storedIds(issue.audience_group_ids))) for (const u of labGroupSignerIds(sqlite, labId, g)) out.add(u);
    return out;
  }
  for (const r of sqlite.prepare("SELECT user_id FROM lab_members WHERE lab_id = ? AND status = 'active' AND role IN ('owner', 'admin')").all(labId) as any[]) out.add(Number(r.user_id));
  for (const id of medicalDirectorIds(sqlite, labId)) if (people.has(id) && !staffOwnScope(sqlite, id, labId, "digest")) out.add(id);
  return out;
}

// ── The notice email (PR 5) ───────────────────────────────────────────────────────────────────────────────────────────
export const DIGEST_NOTICE_FROM = "VeritaAssure® <info@veritaslabservices.com>";
export interface DigestNoticeRecipient { user_id: number; email: string; name: string | null }

/**
 * Who the notice goes to: everyone the issue's audience reaches today (audiencePeople, the roster's list) who has a login
 * with an address, one email per address, in user id order. noAddress counts the people it reaches without one.
 */
export function digestNoticeRecipients(sqlite: any, labId: number, issue: any): { recipients: DigestNoticeRecipient[]; noAddress: number } {
  const ids = Array.from(audiencePeople(sqlite, labId, issue)).sort((a, b) => a - b);
  if (!ids.length) return { recipients: [], noAddress: 0 };
  const users = new Map((sqlite.prepare(`SELECT id, name, email FROM users WHERE id IN (${ids.map(() => "?").join(", ")})`).all(...ids) as any[]).map((u) => [Number(u.id), u]));
  const seen = new Set<string>();
  const recipients: DigestNoticeRecipient[] = [];
  let noAddress = 0;
  for (const id of ids) {
    const u = users.get(id);
    const email = String(u?.email ?? "").trim();
    if (!u || !EMAIL_RE.test(email)) { noAddress += 1; continue; }
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    recipients.push({ user_id: id, email, name: String(u.name ?? "").trim() || null });
  }
  return { recipients, noAddress };
}

const escHtml = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const oneLine = (s: unknown) => String(s ?? "").replace(/[\r\n\t]+/g, " ").trim();

/**
 * One recipient's notice: the issue is ready, whether acknowledgment is asked, and a link to it. No counts, and no name but
 * the recipient's own in the greeting. Paragraphs as <div>...</div><div><br></div>, the read-and-sign notice's spacing.
 */
export function digestNoticeEmail(p: { labName: string; periodStart: string; periodEnd: string; ackRequested: boolean; link: string; recipientName: string | null }) {
  const period = periodTitle(p.periodStart, p.periodEnd);
  const lab = oneLine(p.labName) || "Your lab";
  const para = (html: string) => `<div>${html}</div><div><br></div>`;
  return {
    subject: `${lab}: ${period} compliance digest is ready`,
    html: para(p.recipientName ? `Hello ${escHtml(oneLine(p.recipientName))},` : "Hello,")
      + para(`The ${escHtml(period)} compliance digest for ${escHtml(lab)} is ready to read in VeritaAssure&reg;.`)
      + para(p.ackRequested
        ? "Your lab asks each reader to acknowledge this issue. Open it and select &quot;I've read this&quot;."
        : "No acknowledgment is needed for this issue.")
      + para(`<a href="${escHtml(p.link)}" style="display:inline-block;background:#01696F;color:#ffffff;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:6px;">Open the digest</a>`)
      + `<div>The numbers are in the issue itself, so you'll need to sign in to see them. Your lab sends this notice once for each issue.</div>`,
  };
}

// ── Issues ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The counts an issue stores: the range and as-of day, and only the sections it includes. */
export function pickDigestSections(c: DigestCounts, sections: readonly DigestSectionKey[]): Record<string, unknown> {
  const out: Record<string, unknown> = { monthStart: c.monthStart, monthEnd: c.monthEnd, asOf: c.asOf, timeZone: c.timeZone };
  for (const k of sections) out[k] = c[k];
  return out;
}

const fetchIssue = (sqlite: any, labId: number, id: unknown) => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? (sqlite.prepare("SELECT * FROM digest_issues WHERE id = ? AND lab_id = ?").get(n, labId) as any) : undefined;
};

function issueView(row: any, manager: boolean) {
  const v: Record<string, unknown> = {
    id: row.id, lab_id: row.lab_id, period_start: row.period_start, period_end: row.period_end, status: row.status,
    note: row.note ?? null, sections: storedSections(row.sections, []), audience: row.audience,
    audience_group_ids: storedIds(row.audience_group_ids), ack_requested: Number(row.ack_requested) === 1,
    review_box: Number(row.review_box) === 1, counts_as_of: row.counts_as_of ?? null,
    created_at: row.created_at, published_at: row.published_at ?? null,
    withdrawn_at: row.withdrawn_at ?? null, withdrawn_reason: row.withdrawn_reason ?? null,
  };
  if (manager) {
    Object.assign(v, {
      created_by_user_id: row.created_by_user_id ?? null, published_by_user_id: row.published_by_user_id ?? null,
      // The daily draft job made it (the list's "Drafted automatically on <date>").
      created_by_job: Number(row.created_by_job) === 1,
      // PR 5: when the notice email went out and to how many people (the owner and admins only).
      notice_sent_at: row.notice_sent_at ?? null, notice_sent_count: row.notice_sent_count ?? null,
    });
  }
  return v;
}

const ownStatus = (sqlite: any, issueId: number, userId: number) => {
  const r = sqlite.prepare("SELECT read_at, acknowledged_at FROM digest_issue_acks WHERE issue_id = ? AND user_id = ?").get(issueId, userId) as any;
  return { read_at: r?.read_at ?? null, acknowledged_at: r?.acknowledged_at ?? null };
};

/** The lab's groups by id with their names, in the order given (a retired group keeps its name, marked retired). Names, never members. */
function groupNames(sqlite: any, labId: number, ids: number[]): Array<{ id: number; name: string; retired: boolean }> {
  if (!ids.length) return [];
  const rows = new Map((sqlite.prepare(`SELECT id, name, retired FROM lab_groups WHERE lab_id = ? AND id IN (${ids.map(() => "?").join(", ")})`).all(labId, ...ids) as any[])
    .map((g) => [Number(g.id), { id: Number(g.id), name: String(g.name), retired: Number(g.retired) === 1 }]));
  return ids.map((id) => rows.get(id)).filter((g): g is { id: number; name: string; retired: boolean } => !!g);
}

/**
 * The change lines' comparison (PR 4, the reading screen): the lab's previous published issue of the same frequency
 * (a withdrawn one never counts; the one whose period starts latest before this issue's), with its id, period and the
 * counts it stored at publish, picked to this issue's sections. Never recomputed: a section the prior issue didn't
 * include is simply absent. Inside the reach rules: someone who isn't the owner or an admin gets it only when that
 * issue's audience reaches them too; otherwise null, as when there is no prior issue.
 */
function previousIssue(sqlite: any, row: any, manager: boolean, reach: () => Reach) {
  const frequency = digestPeriodFrequency(row);
  if (!frequency) return null;
  const prior = (sqlite.prepare(
    "SELECT * FROM digest_issues WHERE lab_id = ? AND status = 'published' AND period_start < ? AND id <> ? ORDER BY period_start DESC, id DESC"
  ).all(row.lab_id, row.period_start, row.id) as any[]).find((r) => digestPeriodFrequency(r) === frequency);
  if (!prior || (!manager && !reaches(prior, reach()))) return null;
  let stored: any = null;
  try { stored = prior.counts_json ? JSON.parse(prior.counts_json) : null; } catch { stored = null; }
  if (!stored || typeof stored !== "object") return null;
  const counts: Record<string, unknown> = {};
  for (const k of storedSections(row.sections, [])) if (has(stored, k)) counts[k] = stored[k];
  return { id: prior.id, period_start: prior.period_start, period_end: prior.period_end, counts_as_of: prior.counts_as_of ?? null, counts };
}

const periodLabel = (row: { period_start: string; period_end: string }) => `Compliance digest ${row.period_start} to ${row.period_end}`;
// The digest's columns an audit row records (not the counts: they are on the issue).
const auditFields = (row: any) => ({
  status: row.status, note: row.note ?? null, sections: storedSections(row.sections, []), audience: row.audience,
  audience_group_ids: storedIds(row.audience_group_ids), ack_requested: Number(row.ack_requested) === 1, review_box: Number(row.review_box) === 1,
});

/** audit_log's system actor: the user id the codebase writes for an action no signed-in person took. */
export const DIGEST_SYSTEM_USER_ID = 0;
/** Who drafts: a person through POST issues, or the daily job (DIGEST_SYSTEM_USER_ID, byJob). */
export interface DigestDraftActor { userId: number; ownerUserId: number; ipAddress?: string; byJob?: boolean }
export type DigestDraftOutcome =
  | { ok: true; row: any }
  | { ok: false; status: 400 | 409; body: { error: string; code: string; field?: string; issueId?: number } };

/**
 * Draft one period's issue for a lab: the given period's first day, or the last finished month (or quarter) on the lab's clock
 * when none is given. It takes the lab's settings now. Refused 400 BAD_PERIOD or PERIOD_NOT_FINISHED, and 409 PERIOD_HAS_ISSUE
 * while another non-withdrawn issue holds the period. Writes the issue's create audit row. POST issues and the daily job both
 * draft through here; `at` is the moment the lab's day is read from (now, unless a test says otherwise).
 */
export function createDigestDraft(sqlite: any, labId: number, periodStart: unknown, actor: DigestDraftActor, at: Date = new Date()): DigestDraftOutcome {
  const s = readDigestSettings(sqlite, labId);
  const today = labLocalDate(at.toISOString(), false, labTimeZoneById(sqlite, labId));
  const period = periodStart == null || periodStart === "" ? lastFinishedDigestPeriod(today, s.frequency) : digestPeriodFrom(periodStart, s.frequency);
  if ("error" in period) return { ok: false, status: 400, body: { error: period.error, code: "BAD_PERIOD", field: "periodStart" } };
  if (period.end >= today) {
    return { ok: false, status: 400, body: { error: `That ${s.frequency === "quarterly" ? "quarter" : "month"} hasn't finished yet on the lab's calendar (it ends ${period.end}).`, code: "PERIOD_NOT_FINISHED", field: "periodStart" } };
  }
  const byJob = !!actor.byJob;
  const created = sqlite.transaction(() => {
    const taken = sqlite.prepare("SELECT id, status FROM digest_issues WHERE lab_id = ? AND period_start = ? AND period_end = ? AND status <> 'withdrawn' LIMIT 1").get(labId, period.start, period.end) as any;
    if (taken) return { taken };
    const id = Number(sqlite.prepare(
      `INSERT INTO digest_issues (lab_id, period_start, period_end, status, note, sections, audience, audience_group_ids, ack_requested, review_box, created_at, created_by_user_id, created_by_job)
       VALUES (?, ?, ?, 'draft', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(labId, period.start, period.end, JSON.stringify(s.sections), s.audience, JSON.stringify(s.audience_group_ids), s.ack_default ? 1 : 0, s.review_box ? 1 : 0,
      at.toISOString(), actor.userId, byJob ? 1 : 0).lastInsertRowid);
    return { id };
  })();
  if (created.taken) {
    return { ok: false, status: 409, body: { error: `This period already has an issue (${created.taken.status}). Withdraw it to start a new one.`, code: "PERIOD_HAS_ISSUE", issueId: created.taken.id } };
  }
  const row = fetchIssue(sqlite, labId, created.id);
  logAudit({
    userId: actor.userId, ownerUserId: actor.ownerUserId, module: "account", action: "create", entityType: "digest_issue", entityId: row.id,
    entityLabel: `${periodLabel(row)}: draft created${byJob ? " automatically" : ""}`, after: { ...auditFields(row), created_by_job: byJob }, ipAddress: actor.ipAddress,
  });
  return { ok: true, row };
}

export interface DigestAutoDraftSummary {
  labs: number; drafted: number; alreadyDone: number; notOnPlan: number; errors: number;
  issues: Array<{ lab_id: number; issue_id: number; period_start: string; period_end: string }>;
}

/**
 * The daily draft job. Every lab with the digest's daily draft turned on (digest_settings.enabled = 1) whose plan is on
 * DIGEST_PLANS gets a draft of its last finished period on its own calendar day, as the system (DIGEST_SYSTEM_USER_ID). A
 * period that already has a non-withdrawn issue is already done. It drafts only: no publish, no notice, no email.
 * `labId` limits it to one lab; `at` stands in for now (tests).
 */
export function runDigestAutoDrafts(sqlite: any = sqliteOf(), opts: { at?: Date; labId?: number } = {}): DigestAutoDraftSummary {
  const at = opts.at ?? new Date();
  const one = Number.isInteger(opts.labId) && Number(opts.labId) > 0;
  const labs = sqlite.prepare(
    `SELECT l.id, l.plan, l.owner_user_id FROM digest_settings s JOIN labs l ON l.id = s.lab_id
      WHERE s.enabled = 1${one ? " AND l.id = ?" : ""} ORDER BY l.id`
  ).all(...(one ? [Number(opts.labId)] : [])) as Array<{ id: number; plan: string | null; owner_user_id: number | null }>;
  const out: DigestAutoDraftSummary = { labs: labs.length, drafted: 0, alreadyDone: 0, notOnPlan: 0, errors: 0, issues: [] };
  for (const lab of labs) {
    if (!hasDigestAccess(lab)) { out.notOnPlan += 1; continue; }
    try {
      const actor: DigestDraftActor = { userId: DIGEST_SYSTEM_USER_ID, ownerUserId: Number(lab.owner_user_id ?? DIGEST_SYSTEM_USER_ID), byJob: true };
      const r = withLabClock(labTimeZoneById(sqlite, lab.id), () => createDigestDraft(sqlite, Number(lab.id), null, actor, at));
      if (r.ok) {
        out.drafted += 1;
        out.issues.push({ lab_id: Number(lab.id), issue_id: Number(r.row.id), period_start: r.row.period_start, period_end: r.row.period_end });
      } else if (r.body.code === "PERIOD_HAS_ISSUE") {
        out.alreadyDone += 1;
      } else {
        out.errors += 1;
        console.warn(`[digest-autodraft] lab ${lab.id}: ${r.body.code}`);
      }
    } catch (err: any) {
      out.errors += 1;
      console.warn(`[digest-autodraft] lab ${lab.id} failed:`, err?.message || err);
    }
  }
  return out;
}

export function registerDigestIssueRoutes(app: Express, authMiddleware: any, requireWriteAccess: any) {
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (!labScopeMiddleware) throw new Error("registerDigestIssueRoutes: labScopeMiddleware not registered");

  const planGate = (req: any, res: any, next: any) =>
    (hasDigestAccess(req.scope?.lab) ? next() : res.status(403).json({ error: "The compliance digest comes with a VeritaAssure® subscription.", code: "PLAN_REQUIRED" }));
  // Refused on the server with the field, where the platform guard in the browser only warns.
  const noPhi = (req: any, res: any, next: any) => {
    const hit = findDigestPhi(req.body);
    if (hit) return res.status(400).json({ error: digestPhiMessage(hit.labels), code: "PHI_REFUSED", field: hit.field, labels: hit.labels });
    next();
  };
  const ownerOrAdmin = (res: any) => res.status(403).json({ error: "Only the lab's owner or an admin can do this.", code: "OWNER_OR_ADMIN_ONLY" });
  const notFound = (res: any) => res.status(404).json({ error: "Issue not found" });
  const read = [authMiddleware, labScopeMiddleware, planGate];
  const write = [authMiddleware, labScopeMiddleware, requireWriteAccess, planGate, noPhi];

  const audit = (req: any, action: AuditAction, issueId: number, label: string, before?: unknown, after?: unknown) => logAudit({
    userId: req.userId, ownerUserId: req.scope?.lab?.owner_user_id ?? req.userId, module: "account", action,
    entityType: "digest_issue", entityId: issueId, entityLabel: label, before, after, ipAddress: req.ip,
  });

  /** The issue at this id in this lab, if this person can see it: the owner and admins see every one, anyone else a published one their audience reaches. */
  const visibleIssue = (req: any): any | undefined => {
    const sqlite = sqliteOf();
    const row = fetchIssue(sqlite, req.scope.labId, req.params.id);
    if (!row) return undefined;
    if (isManager(req)) return row;
    if (row.status !== "published") return undefined;
    return reaches(row, readerReach(sqlite, req.scope.labId, Number(req.userId))) ? row : undefined;
  };

  // ── Settings ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const settingsView = (req: any) => {
    const sqlite = sqliteOf();
    const s = readDigestSettings(sqlite, req.scope.labId);
    const today = labToday(labTimeZoneById(sqlite, req.scope.labId));
    const manager = isManager(req);
    // The owner and admins pick a group audience from the lab's active groups (names only; PR 4's settings card).
    const groups = manager
      ? (sqlite.prepare("SELECT id, name FROM lab_groups WHERE lab_id = ? AND retired = 0 ORDER BY name COLLATE NOCASE, id").all(req.scope.labId) as any[]).map((g) => ({ id: Number(g.id), name: String(g.name) }))
      : undefined;
    return { ...s, can_edit: manager, section_keys: [...DIGEST_SECTION_KEYS], default_period: lastFinishedDigestPeriod(today, s.frequency), ...(groups ? { groups } : {}) };
  };
  app.get(`${BASE}/settings`, ...read, (req: any, res: any) => res.json(settingsView(req)));

  app.put(`${BASE}/settings`, ...write, (req: any, res: any) => {
    if (!isManager(req)) return ownerOrAdmin(res);
    const sqlite = sqliteOf();
    const labId = req.scope.labId;
    const b = req.body || {};
    const before = readDigestSettings(sqlite, labId);
    const next = { ...before };
    for (const [key, label] of [["enabled", "Draft each issue automatically"], ["ack_default", "Ask readers to acknowledge"], ["review_box", "Medical director or designee review box"]] as const) {
      if (!has(b, key)) continue;
      const c = cleanFlag(b[key], label);
      if (failed(c)) return res.status(400).json({ error: c.error, code: c.code, field: key });
      next[key] = c.value;
    }
    if (has(b, "frequency")) {
      if (!(DIGEST_FREQUENCIES as readonly string[]).includes(String(b.frequency))) return res.status(400).json({ error: "Frequency: choose monthly or quarterly.", code: "BAD_FREQUENCY", field: "frequency" });
      next.frequency = String(b.frequency) as DigestFrequency;
    }
    if (has(b, "sections")) {
      const c = cleanSections(b.sections);
      if (failed(c)) return res.status(400).json({ error: c.error, code: c.code, field: "sections" });
      next.sections = c.value;
    }
    if (has(b, "audience") || has(b, "audience_group_ids")) {
      const c = cleanAudience(sqlite, labId, has(b, "audience") ? b.audience : before.audience, has(b, "audience_group_ids") ? b.audience_group_ids : before.audience_group_ids);
      if (failed(c)) return res.status(400).json({ error: c.error, code: c.code, field: has(b, "audience_group_ids") ? "audience_group_ids" : "audience" });
      next.audience = c.value.audience;
      next.audience_group_ids = c.value.groupIds;
    }
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO digest_settings (lab_id, enabled, frequency, sections, audience, audience_group_ids, ack_default, review_box, updated_at, updated_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(lab_id) DO UPDATE SET enabled = excluded.enabled, frequency = excluded.frequency, sections = excluded.sections,
         audience = excluded.audience, audience_group_ids = excluded.audience_group_ids, ack_default = excluded.ack_default,
         review_box = excluded.review_box, updated_at = excluded.updated_at, updated_by_user_id = excluded.updated_by_user_id`
    ).run(labId, next.enabled ? 1 : 0, next.frequency, JSON.stringify(next.sections), next.audience, JSON.stringify(next.audience_group_ids),
      next.ack_default ? 1 : 0, next.review_box ? 1 : 0, now, req.userId);
    const strip = ({ updated_at: _u, updated_by_user_id: _b, ...rest }: DigestSettings) => rest;
    logAudit({
      userId: req.userId, ownerUserId: req.scope.lab?.owner_user_id ?? req.userId, module: "account", action: "update",
      entityType: "digest_settings", entityId: String(labId), entityLabel: "Compliance digest settings",
      before: strip(before), after: strip(next), ipAddress: req.ip,
    });
    res.json(settingsView(req));
  });

  // ── Issues ────────────────────────────────────────────────────────────────────────────────────────────────────────
  // One issue as GET issues/:id gives it. A draft: live counts for its period, as of now. Published or withdrawn: the counts
  // frozen at publish (none if it never was published).
  const detail = (req: any, row: any) => {
    const sqlite = sqliteOf();
    const manager = isManager(req);
    const live = row.status === "draft";
    const counts = live
      ? pickDigestSections(digestCountsForLab(sqlite, row.lab_id, row.period_start, row.period_end), storedSections(row.sections, []))
      : (() => { try { return row.counts_json ? JSON.parse(row.counts_json) : null; } catch { return null; } })();
    let reach: Reach | null = null;
    const readerReachOnce = (): Reach => { if (!reach) reach = readerReach(sqlite, row.lab_id, Number(req.userId)); return reach; };
    return {
      ...issueView(row, manager),
      ...(live ? { counts_as_of: new Date().toISOString() } : {}),
      counts, counts_live: live,
      // PR 4: the names of the groups a group issue is sent to (the header's "Sent to"), and the prior issue the change lines compare against.
      audience_groups: row.audience === "groups" ? groupNames(sqlite, row.lab_id, storedIds(row.audience_group_ids)) : [],
      previous: previousIssue(sqlite, row, manager, readerReachOnce),
      mine: ownStatus(sqlite, row.id, Number(req.userId)),
      can_edit: manager,
    };
  };

  // Draft one period's issue. Default: the last finished month (or quarter) on the lab's clock. It takes the lab's settings now.
  // createDigestDraft is the daily job's path too.
  app.post(`${BASE}/issues`, ...write, (req: any, res: any) => {
    if (!isManager(req)) return ownerOrAdmin(res);
    const r = createDigestDraft(sqliteOf(), req.scope.labId, req.body?.periodStart, {
      userId: req.userId, ownerUserId: req.scope?.lab?.owner_user_id ?? req.userId, ipAddress: req.ip,
    });
    if (!r.ok) return res.status(r.status).json(r.body);
    res.status(201).json(detail(req, r.row));
  });

  // Veritas admin: run the daily draft job now (the same run the schedule makes), for every lab or one ({ labId }).
  // It only drafts, as the schedule does; nothing is published or sent.
  app.post("/api/admin/digest-autodraft/run", (req: any, res: any) => {
    const ADMIN_SECRET = process.env.ADMIN_SECRET;
    const secret = req.body?.secret ?? req.headers["x-admin-secret"];
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    const labId = req.body?.labId == null || req.body.labId === "" ? undefined : Number(req.body.labId);
    if (labId !== undefined && !(Number.isInteger(labId) && labId > 0)) return res.status(400).json({ error: "labId: send a lab id.", code: "BAD_VALUE", field: "labId" });
    res.json(runDigestAutoDrafts(sqliteOf(), { labId }));
  });

  // The owner and admins: every issue. Anyone else: the published ones their audience reaches, with their own read status.
  app.get(`${BASE}/issues`, ...read, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const labId = req.scope.labId;
    const manager = isManager(req);
    const rows = sqlite.prepare("SELECT * FROM digest_issues WHERE lab_id = ? ORDER BY period_start DESC, id DESC").all(labId) as any[];
    const reach = manager ? null : readerReach(sqlite, labId, Number(req.userId));
    const shown = manager ? rows : rows.filter((r) => r.status === "published" && reaches(r, reach as Reach));
    res.json({
      issues: shown.map((r) => {
        const { note: _note, ...rest } = issueView(r, manager);
        return { ...rest, mine: ownStatus(sqlite, r.id, Number(req.userId)) };
      }),
      can_edit: manager,
    });
  });

  app.get(`${BASE}/issues/:id`, ...read, (req: any, res: any) => {
    const row = visibleIssue(req);
    if (!row) return notFound(res);
    res.json(detail(req, row));
  });

  // Edit a draft: the note, sections, audience and groups, and the two flags. Nothing else changes, and a published issue doesn't.
  app.put(`${BASE}/issues/:id`, ...write, (req: any, res: any) => {
    const row = visibleIssue(req);
    if (!row) return notFound(res);
    if (!isManager(req)) return ownerOrAdmin(res);
    if (row.status !== "draft") return res.status(409).json({ error: "Only a draft can be changed. A published issue stays as it was published.", code: "NOT_DRAFT" });
    const sqlite = sqliteOf();
    const labId = req.scope.labId;
    const b = req.body || {};
    const set: Record<string, unknown> = {};
    if (has(b, "note")) {
      const note = b.note == null ? "" : String(b.note).trim();
      if (note.length > NOTE_MAX) return res.status(400).json({ error: `Keep the note to ${NOTE_MAX} characters or fewer.`, code: "NOTE_TOO_LONG", field: "note" });
      set.note = note || null;
    }
    if (has(b, "sections")) {
      const c = cleanSections(b.sections);
      if (failed(c)) return res.status(400).json({ error: c.error, code: c.code, field: "sections" });
      set.sections = JSON.stringify(c.value);
    }
    if (has(b, "audience") || has(b, "audience_group_ids")) {
      const c = cleanAudience(sqlite, labId, has(b, "audience") ? b.audience : row.audience, has(b, "audience_group_ids") ? b.audience_group_ids : storedIds(row.audience_group_ids));
      if (failed(c)) return res.status(400).json({ error: c.error, code: c.code, field: has(b, "audience_group_ids") ? "audience_group_ids" : "audience" });
      set.audience = c.value.audience;
      set.audience_group_ids = JSON.stringify(c.value.groupIds);
    }
    for (const [key, label] of [["ack_requested", "Ask readers to acknowledge"], ["review_box", "Medical director or designee review box"]] as const) {
      if (!has(b, key)) continue;
      const c = cleanFlag(b[key], label);
      if (failed(c)) return res.status(400).json({ error: c.error, code: c.code, field: key });
      set[key] = c.value ? 1 : 0;
    }
    const keys = Object.keys(set);
    if (keys.length) {
      const changed = sqlite.prepare(`UPDATE digest_issues SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND status = 'draft'`).run(...keys.map((k) => set[k]), row.id).changes;
      if (!changed) return res.status(409).json({ error: "Only a draft can be changed. A published issue stays as it was published.", code: "NOT_DRAFT" });
      const after = fetchIssue(sqlite, labId, row.id);
      audit(req, "update", row.id, `${periodLabel(row)}: draft edited`, auditFields(row), auditFields(after));
      return res.json(detail(req, after));
    }
    res.json(detail(req, row));
  });

  // Publish: take the counts now and freeze them. expectedCountsAsOf (optional) is the as-of day the reviewer saw on the draft
  // (its counts.asOf); if the lab's day has turned since, the "now" counts would differ from what was reviewed, so it's refused.
  app.post(`${BASE}/issues/:id/publish`, ...write, (req: any, res: any) => {
    const row = visibleIssue(req);
    if (!row) return notFound(res);
    if (!isManager(req)) return ownerOrAdmin(res);
    if (row.status !== "draft") return res.status(409).json({ error: "Only a draft can be published.", code: "NOT_DRAFT" });
    const sqlite = sqliteOf();
    const labId = req.scope.labId;
    const sections = storedSections(row.sections, []);
    if (!sections.length) return res.status(400).json({ error: "Pick at least one section before publishing.", code: "BAD_SECTIONS" });
    if (row.audience === "groups" && !activeGroupIds(sqlite, labId, storedIds(row.audience_group_ids)).length) {
      return res.status(400).json({ error: "This issue's groups are no longer in use. Pick a group or another audience before publishing.", code: "BAD_GROUPS" });
    }
    const counts = digestCountsForLab(sqlite, labId, row.period_start, row.period_end);
    const expected = req.body?.expectedCountsAsOf;
    if (expected != null && expected !== "") {
      const e = String(expected).trim();
      const day = validDay(e) ? e : labLocalDate(e, false, counts.timeZone);
      if (!validDay(day)) return res.status(400).json({ error: "expectedCountsAsOf: send the counts' as-of day as YYYY-MM-DD.", code: "BAD_VALUE", field: "expectedCountsAsOf" });
      if (day !== counts.asOf) {
        return res.status(409).json({ error: `The counts are now as of ${counts.asOf}, not ${day}. Review the draft again before publishing.`, code: "COUNTS_AS_OF_CHANGED", asOf: counts.asOf });
      }
    }
    const at = new Date().toISOString();
    const changed = sqlite.prepare(
      "UPDATE digest_issues SET status = 'published', counts_json = ?, counts_as_of = ?, published_at = ?, published_by_user_id = ? WHERE id = ? AND status = 'draft'"
    ).run(JSON.stringify(pickDigestSections(counts, sections)), at, at, req.userId, row.id).changes;
    if (!changed) return res.status(409).json({ error: "Only a draft can be published.", code: "NOT_DRAFT" });
    const after = fetchIssue(sqlite, labId, row.id);
    audit(req, "update", row.id, `${periodLabel(row)}: published`, { status: row.status }, { ...auditFields(after), counts_as_of: at });
    res.json(detail(req, after));
  });

  // Withdraw a draft or a published issue. The reason is required, and the row stays, counts and all.
  app.post(`${BASE}/issues/:id/withdraw`, ...write, (req: any, res: any) => {
    const row = visibleIssue(req);
    if (!row) return notFound(res);
    if (!isManager(req)) return ownerOrAdmin(res);
    if (row.status === "withdrawn") return res.status(409).json({ error: "This issue is already withdrawn.", code: "ALREADY_WITHDRAWN" });
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) return res.status(400).json({ error: "Say why the issue is withdrawn.", code: "REASON_REQUIRED", field: "reason" });
    if (reason.length > REASON_MAX) return res.status(400).json({ error: `Keep the reason to ${REASON_MAX} characters or fewer.`, code: "REASON_TOO_LONG", field: "reason" });
    const sqlite = sqliteOf();
    const at = new Date().toISOString();
    sqlite.prepare("UPDATE digest_issues SET status = 'withdrawn', withdrawn_at = ?, withdrawn_reason = ? WHERE id = ? AND status <> 'withdrawn'").run(at, reason, row.id);
    const after = fetchIssue(sqlite, req.scope.labId, row.id);
    audit(req, "update", row.id, `${periodLabel(row)}: withdrawn`, { status: row.status }, { status: "withdrawn", withdrawn_reason: reason });
    res.json(detail(req, after));
  });

  // The signed-in reader marks a published issue read, or acknowledges it when it asks for that. Each is recorded once.
  const readOrAck = (ack: boolean) => (req: any, res: any) => {
    const row = visibleIssue(req);
    if (!row) return notFound(res);
    if (row.status !== "published") return res.status(409).json({ error: "Only a published issue can be read or acknowledged.", code: "NOT_PUBLISHED" });
    if (ack && Number(row.ack_requested) !== 1) return res.status(409).json({ error: "This issue doesn't ask readers to acknowledge it.", code: "ACK_NOT_REQUESTED" });
    const sqlite = sqliteOf();
    const at = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO digest_issue_acks (issue_id, user_id, read_at, acknowledged_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(issue_id, user_id) DO UPDATE SET read_at = COALESCE(digest_issue_acks.read_at, excluded.read_at),
         acknowledged_at = COALESCE(digest_issue_acks.acknowledged_at, excluded.acknowledged_at)`
    ).run(row.id, req.userId, at, ack ? at : null);
    res.json({ issue_id: row.id, mine: ownStatus(sqlite, row.id, Number(req.userId)) });
  };
  app.post(`${BASE}/issues/:id/read`, ...write, readOrAck(false));
  app.post(`${BASE}/issues/:id/ack`, ...write, readOrAck(true));

  // Who has read and acknowledged it. The owner and admins: counts and the roster, which names lab members. Anyone else who can
  // see the issue: their own status only.
  app.get(`${BASE}/issues/:id/acks`, ...read, (req: any, res: any) => {
    const row = visibleIssue(req);
    if (!row) return notFound(res);
    const sqlite = sqliteOf();
    const labId = req.scope.labId;
    const ackRequested = Number(row.ack_requested) === 1;
    const mine = ownStatus(sqlite, row.id, Number(req.userId));
    if (!isManager(req)) return res.json({ issue_id: row.id, ack_requested: ackRequested, mine });
    const audience = audiencePeople(sqlite, labId, row);
    const acks = new Map<number, any>((sqlite.prepare("SELECT user_id, read_at, acknowledged_at FROM digest_issue_acks WHERE issue_id = ?").all(row.id) as any[]).map((a) => [Number(a.user_id), a]));
    const ids = Array.from(new Set([...audience, ...acks.keys()]));
    const names = new Map<number, string>();
    if (ids.length) {
      for (const u of sqlite.prepare(`SELECT id, name, email FROM users WHERE id IN (${ids.map(() => "?").join(", ")})`).all(...ids) as any[]) names.set(Number(u.id), u.name || u.email || `User ${u.id}`);
    }
    const roster = ids.map((id) => ({
      user_id: id, name: names.get(id) ?? `User ${id}`, in_audience: audience.has(id),
      read_at: acks.get(id)?.read_at ?? null, acknowledged_at: acks.get(id)?.acknowledged_at ?? null,
    })).sort((a, b) => a.name.localeCompare(b.name) || a.user_id - b.user_id);
    const inAudience = roster.filter((r) => r.in_audience);
    const read = inAudience.filter((r) => r.read_at).length;
    const acknowledged = inAudience.filter((r) => r.acknowledged_at).length;
    res.json({
      issue_id: row.id, ack_requested: ackRequested, mine,
      totals: {
        audience: inAudience.length, read, not_read: inAudience.length - read,
        acknowledged: ackRequested ? acknowledged : null, not_acknowledged: ackRequested ? inAudience.length - acknowledged : null,
      },
      roster,
    });
  });

  // ── PR 5: the PDF ─────────────────────────────────────────────────────────────────────────────────────────────────
  // The issue GET's reach exactly, and only a published issue. It prints detail(): the same counts, previous and group names
  // the screen gets for this reader.
  const notPublished = (res: any, what: string) => res.status(409).json({ error: `Only a published issue ${what}.`, code: "NOT_PUBLISHED" });
  app.get(`${BASE}/issues/:id/pdf`, ...read, async (req: any, res: any) => {
    const row = visibleIssue(req);
    if (!row) return notFound(res);
    if (row.status !== "published") return notPublished(res, "has a PDF");
    const lab = sqliteOf().prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(req.scope.labId) as any;
    try {
      const { pdf } = await generateDigestPDF(detail(req, row) as any, {
        labName: String(lab?.lab_name ?? "").trim() || null, cliaNumber: String(lab?.clia_number ?? "").trim() || null,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${digestPdfFilename(row)}"`);
      res.setHeader("Content-Length", pdf.length);
      res.setHeader("Cache-Control", "no-store");
      res.send(pdf);
    } catch (err: any) {
      console.error("[digest] issue PDF failed:", err?.message || err);
      res.status(500).json({ error: "The PDF could not be built." });
    }
  });

  // ── PR 5: the notice email ────────────────────────────────────────────────────────────────────────────────────────
  const noticeState = (row: any) => ({ sent_at: row.notice_sent_at ?? null, sent_count: row.notice_sent_count ?? null });
  // What the notice would do, as a count, before anyone sends it (the owner and admins).
  app.get(`${BASE}/issues/:id/notice`, ...read, (req: any, res: any) => {
    const row = visibleIssue(req);
    if (!row) return notFound(res);
    if (!isManager(req)) return ownerOrAdmin(res);
    const plan = digestNoticeRecipients(sqliteOf(), req.scope.labId, row);
    res.json({
      issue_id: row.id, status: row.status, ack_requested: Number(row.ack_requested) === 1,
      recipients: plan.recipients.length, no_address: plan.noAddress, ...noticeState(row),
      can_send: row.status === "published" && !row.notice_sent_at && plan.recipients.length > 0,
    });
  });

  // Send it. Body: { expectedCount }, the count the screen showed. Once per issue.
  app.post(`${BASE}/issues/:id/notice`, ...write, (req: any, res: any) => {
    const row = visibleIssue(req);
    if (!row) return notFound(res);
    if (!isManager(req)) return ownerOrAdmin(res);
    if (row.status !== "published") return notPublished(res, "can have a notice sent");
    if (row.notice_sent_at) {
      return res.status(409).json({ error: "This issue's notice already went out. It is sent once per issue.", code: "NOTICE_SENT", ...noticeState(row) });
    }
    const sqlite = sqliteOf();
    const labId = req.scope.labId;
    const plan = digestNoticeRecipients(sqlite, labId, row);
    if (Number(req.body?.expectedCount) !== plan.recipients.length) {
      return res.status(409).json({ error: "The list changed. Check the new count before sending.", code: "COUNT_CHANGED", recipients: plan.recipients.length });
    }
    if (!plan.recipients.length) return res.status(400).json({ error: "Nobody this issue reaches has a login with an email address.", code: "NO_RECIPIENTS" });
    const at = new Date().toISOString();
    // Claimed in one statement, so two sends at once can't both go out.
    const claimed = sqlite.prepare(
      "UPDATE digest_issues SET notice_sent_at = ?, notice_sent_count = ?, notice_sent_by_user_id = ? WHERE id = ? AND status = 'published' AND notice_sent_at IS NULL"
    ).run(at, plan.recipients.length, req.userId, row.id).changes;
    if (!claimed) {
      const now = fetchIssue(sqlite, labId, row.id);
      if (now?.status !== "published") return notPublished(res, "can have a notice sent");
      return res.status(409).json({ error: "This issue's notice already went out. It is sent once per issue.", code: "NOTICE_SENT", ...noticeState(now) });
    }
    const label = periodLabel(row);
    audit(req, "update", row.id, `${label}: notice sent to ${plan.recipients.length}`, { notice_sent_at: null }, { notice_sent_at: at, notice_sent_count: plan.recipients.length });
    res.status(202).json({ issue_id: row.id, sending: plan.recipients.length, sent_at: at, sent_count: plan.recipients.length });

    // In the background, at the mailer's pace: a long list outlasts the request (the read-and-sign notice does the same).
    const lab = sqlite.prepare("SELECT lab_name FROM labs WHERE id = ?").get(labId) as any;
    const base = (process.env.FRONTEND_URL || "https://www.veritaslabservices.com").replace(/\/+$/, "");
    const link = `${base}/labs/${labId}/digest/${row.id}`;
    const by = { userId: req.userId, ownerUserId: req.scope?.lab?.owner_user_id ?? req.userId, ip: req.ip };
    (async () => {
      let sent = 0, failed = 0;
      for (let i = 0; i < plan.recipients.length; i++) {
        const r = plan.recipients[i];
        if (i > 0 && readSignMailer.pauseMs) await new Promise((done) => setTimeout(done, readSignMailer.pauseMs));
        try {
          await readSignMailer.send({
            from: DIGEST_NOTICE_FROM, to: r.email,
            ...digestNoticeEmail({ labName: lab?.lab_name || "", periodStart: row.period_start, periodEnd: row.period_end, ackRequested: Number(row.ack_requested) === 1, link, recipientName: r.name }),
          });
          sent += 1;
        } catch (err: any) {
          failed += 1;
          console.error("[digest notice] send failed:", err?.message || err);
        }
      }
      logAudit({
        userId: by.userId, ownerUserId: by.ownerUserId, module: "account", action: "update", entityType: "digest_issue", entityId: row.id,
        entityLabel: `${label}: notice finished, ${sent} sent, ${failed} not sent`, after: { sent, failed }, ipAddress: by.ip,
      });
    })().catch((err) => console.error("[digest notice]", err?.message || err));
  });
}
