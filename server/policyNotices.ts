// server/policyNotices.ts
//
// VeritaDC email notices (B13). Two of them, each off for a lab until its owner or an admin turns it on (labs.dc_notify_*, set
// in routes registered by server/policyDocumentControl.ts), so no lab starts getting mail because this shipped:
//
//   1. Approval. When a document reaches an approval step (on submit, or when the step before it is signed), the people who can
//      sign that step are emailed, once per submission per step. Nothing new is asked of anyone: the list is worked out with the
//      same rule that decides who may sign (canUserApproveStepDelegated), so a delegate is emailed while the delegation runs,
//      an author the step blocks isn't, and a group step goes to each of its members. Documents that reach the same person
//      together (a bulk approval) come in one email.
//   2. Overdue read-and-sign. One email a week at most to a person, naming the documents they're overdue to sign, and to a
//      document's owner, how many people are overdue on each document they own. Someone who is both gets one email with both
//      parts, and someone in two labs that turned it on gets one email for both: never more than one per person in 7 days.
//
// Only a person with an active login in the lab is ever emailed (activeLogin), never a Veritas support account. Each email's
// rows are written before it is sent, so a failed send, a second click or a restart never becomes a second email. Emails go
// through readSignMailer (server/policyReadSign.ts), the one Resend sender VeritaDC already uses.

import { addLabDays, labLocalDate, labTimeZoneById, labToday, withLabClock } from "./dateLocal";
import { EMAIL_RE, labGroupSignerIds } from "./labGroups";
import { staffOwnScope, staffSelfSeat } from "./competencySelfEntry";
import { attestationStillCurrent, closeAttestationsCoveredByStaffSignatures } from "./policySignatureStatus";
import { loadReadSignContext, peopleOfRule, readSignMailer, rulesForDocument, signedLookup, staffLabIdFor } from "./policyReadSign";
import {
  canUserApproveStep, canUserApproveStepDelegated, eligibleReviewerIdsForStep, getCurrentPendingStep, isVersionMajorRevision,
  manualApproverUserIds, resolveActiveMedicalDirectorUserId, writeAuditLog,
} from "./veritapolicyApproval";
import { versionLabel } from "../shared/policyVersion";
import { DEFAULT_OVERDUE_SIGN_DAYS } from "../shared/policyNotices";

const SYSTEM_USER_ID = -1;
const NOTICE_DAYS = 7;
const LIST_MAX = 50;

export interface LabNoticeSettings { approvalEmails: boolean; overdueEmails: boolean; overdueDays: number }

export function labNoticeSettings(sqlite: any, labId: number): LabNoticeSettings {
  const row = sqlite.prepare("SELECT dc_notify_approvers AS a, dc_notify_overdue_signs AS o, dc_overdue_sign_days AS d FROM labs WHERE id = ?").get(labId) as any;
  return { approvalEmails: row?.a === 1, overdueEmails: row?.o === 1, overdueDays: Number(row?.d) > 0 ? Number(row.d) : DEFAULT_OVERDUE_SIGN_DAYS };
}

/**
 * Who this person is when they can sign in to this lab today, else null: a confirmed account with an address that isn't Veritas
 * support's, and the lab's owner, an active member, or an active seat here. Someone whose every seat here was deactivated can't.
 */
export function activeLogin(sqlite: any, labId: number, userId: number | null | undefined): { userId: number; email: string; name: string | null } | null {
  if (userId == null) return null;
  const u = sqlite.prepare(
    "SELECT id, email, name, COALESCE(vls_support, 0) AS vls, COALESCE(email_verification_pending, 0) AS pending FROM users WHERE id = ?"
  ).get(userId) as any;
  if (!u || u.vls || u.pending || !EMAIL_RE.test(String(u.email || ""))) return null;
  const lab = sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(labId) as any;
  if (!lab) return null;
  const me = { userId: Number(u.id), email: String(u.email), name: u.name || null };
  if (lab.owner_user_id === u.id) return me;
  const member = sqlite.prepare("SELECT role FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active' LIMIT 1").get(labId, userId) as any;
  if (member && (member.role === "owner" || member.role === "admin")) return me;
  const seats = sqlite.prepare(
    "SELECT status, lab_id FROM user_seats WHERE seat_user_id = ? AND (lab_id = ? OR (lab_id IS NULL AND owner_user_id = ?))"
  ).all(userId, labId, lab.owner_user_id) as any[];
  // A seat with no lab counts here only for an active member of the lab (server/seatContext.ts).
  const live = seats.some((s) => s.status === "active" && (s.lab_id != null || !!member));
  if (live) return me;
  return member && seats.length === 0 ? me : null;
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const oneLine = (s: unknown, max = 140) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const baseUrl = () => process.env.FRONTEND_URL || "https://www.veritaslabservices.com";
const documentsWord = (n: number) => `${n} ${n === 1 ? "document" : "documents"}`;
const peopleWord = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const usDay = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return `${m}/${d}/${y}`; };
const named = (d: { doc_number?: string | null; title: string }) => `${d.doc_number ? `${esc(d.doc_number)} ` : ""}${esc(d.title)}`;
const list = (lines: string[]) => `<ul>${lines.slice(0, LIST_MAX).map((l) => `<li>${l}</li>`).join("")}${lines.length > LIST_MAX ? `<li>and ${lines.length - LIST_MAX} more</li>` : ""}</ul>`;

// ── 1. Approval ──────────────────────────────────────────────────────────────

export interface StepRecipient { userId: number; email: string; name: string | null; forUserId: number | null }

/**
 * The people to email about one document's pending step: everyone the signing rule would accept today who can reach a screen to
 * sign on (VeritaDC edit, or a Staff login), with a live login. A medical director step goes to the designated director when the
 * lab has one who can sign; the owner and admins, who may sign as designee, are emailed only when there's no director to email.
 */
export function stepNoticeRecipients(sqlite: any, labId: number, documentId: number, canEdit: (labId: number, userId: number) => boolean): StepRecipient[] {
  const doc = sqlite.prepare("SELECT id, owner_user_id, manual_id, current_version_id, archived_at FROM policy_documents WHERE id = ? AND lab_id = ?").get(documentId, labId) as any;
  const step = doc && !doc.archived_at ? getCurrentPendingStep(sqlite, documentId).step : null;
  if (!step) return [];
  const today = labToday(labTimeZoneById(sqlite, labId));
  const rule = {
    labId, documentOwnerId: doc.owner_user_id, stepRow: step,
    isMajorRevision: isVersionMajorRevision(sqlite, doc.current_version_id), manualId: doc.manual_id ?? null,
  };
  const direct = step.required_role === "specific_user" ? (step.specific_user_id != null ? [step.specific_user_id] : [])
    : step.required_role === "group" ? (step.approver_group_id != null ? labGroupSignerIds(sqlite, labId, step.approver_group_id) : [])
      : [...eligibleReviewerIdsForStep(sqlite, rule)];
  const delegates = sqlite.prepare(
    `SELECT DISTINCT to_user_id FROM policy_approval_delegations
      WHERE lab_id = ? AND from_user_id = ? AND revoked_at IS NULL AND starts_on <= ? AND ends_on >= ?
        AND (required_role IS NULL OR required_role = ?) AND (manual_id IS NULL OR manual_id = ?)`
  );
  const reach = (userId: number) => canEdit(labId, userId) || staffSelfSeat(sqlite, userId, labId) != null;
  const people = (ids: number[]): StepRecipient[] => {
    const out = new Map<number, StepRecipient>();
    const add = (userId: number, forUserId: number | null) => {
      if (out.has(userId) || !reach(userId)) return;
      const who = activeLogin(sqlite, labId, userId);
      if (who) out.set(userId, { ...who, forUserId });
    };
    const able = ids.filter((id) => canUserApproveStep(sqlite, { ...rule, userId: id }).ok);
    for (const id of able) add(id, null);
    for (const id of able) {
      for (const d of delegates.all(labId, id, today, today, step.required_role, doc.manual_id ?? null) as any[]) {
        if (canUserApproveStepDelegated(sqlite, { ...rule, userId: d.to_user_id }, today).ok) add(d.to_user_id, id);
      }
    }
    return [...out.values()];
  };
  if (step.required_role === "medical_director" && !manualApproverUserIds(sqlite, labId, doc.manual_id ?? null, "medical_director")) {
    const director = resolveActiveMedicalDirectorUserId(sqlite, labId);
    const told = director != null ? people([director]) : [];
    if (told.length) return told;
  }
  return people(direct);
}

interface ApprovalItem { noticeId: number; documentId: number; title: string; doc_number: string | null; version: string | null; step: string; forName: string | null }

const approvalEmail = (labName: string, items: ApprovalItem[], link: string) => ({
  subject: items.length === 1 ? oneLine(`Approval needed: ${items[0].title}`) : `Approval needed: ${documentsWord(items.length)}`,
  html: `<div>${esc(labName)} has ${documentsWord(items.length)} waiting for your approval in VeritaDC&trade;.</div><div><br></div>`
    + list(items.map((i) => `${named(i)}${i.version ? `, version ${esc(i.version)}` : ""}. Step: ${esc(i.step)}.${i.forName ? ` You're standing in for ${esc(i.forName)}.` : ""}`))
    + `<div><a href="${link}">Sign in to read and approve</a></div><div><br></div>`
    + `<div>Your lab turned on this notice in VeritaDC&trade;. You get it once each time a document reaches a step you can sign.</div>`,
});

/**
 * Tell the signers of these documents' pending steps, when the lab has the notice on. The rows are written before this returns;
 * the emails go in the background. Never throws: a notice must not fail the submit or the approval it follows.
 */
export function notifyStepSigners(
  sqlite: any,
  o: { labId: number; documentIds: number[]; actorUserId: number; canEdit: (labId: number, userId: number) => boolean }
): { people: number; done: Promise<void> } {
  try {
    if (!o.documentIds.length || !labNoticeSettings(sqlite, o.labId).approvalEmails) return { people: 0, done: Promise.resolve() };
    const lab = sqlite.prepare("SELECT lab_name, retired_at FROM labs WHERE id = ?").get(o.labId) as any;
    if (!lab || lab.retired_at) return { people: 0, done: Promise.resolve() };
    const byPerson = new Map<number, { email: string; items: ApprovalItem[] }>();
    const claim = sqlite.prepare(
      `INSERT OR IGNORE INTO policy_approval_notices (lab_id, document_id, version_id, step_id, submission_id, user_id, for_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const documentId of o.documentIds) {
      const doc = sqlite.prepare(
        `SELECT d.title, d.doc_number, d.current_version_id, v.version_number, v.version_major, v.version_minor
           FROM policy_documents d LEFT JOIN policy_versions v ON v.id = d.current_version_id WHERE d.id = ? AND d.lab_id = ?`
      ).get(documentId, o.labId) as any;
      const step = doc ? getCurrentPendingStep(sqlite, documentId).step : null;
      const submission = (sqlite.prepare("SELECT MAX(id) AS id FROM policy_audit_log WHERE document_id = ? AND action = 'workflow_assigned'").get(documentId) as any)?.id;
      if (!doc || !step || submission == null) continue;
      for (const r of stepNoticeRecipients(sqlite, o.labId, documentId, o.canEdit)) {
        const made = claim.run(o.labId, documentId, doc.current_version_id, step.id, submission, r.userId, r.forUserId);
        if (!made.changes) continue; // already told, for this submission and step
        const forName = r.forUserId == null ? null : ((sqlite.prepare("SELECT name, email FROM users WHERE id = ?").get(r.forUserId) as any)?.name || "another reviewer");
        const mail = byPerson.get(r.userId) ?? { email: r.email, items: [] };
        mail.items.push({
          noticeId: Number(made.lastInsertRowid), documentId, title: doc.title, doc_number: doc.doc_number ?? null,
          version: doc.version_number == null ? null : versionLabel(doc), step: step.step_name, forName,
        });
        byPerson.set(r.userId, mail);
      }
    }
    const done = (async () => {
      const told = new Map<number, { sent: number; failed: number }>();
      let first = true;
      for (const [userId, mail] of byPerson) {
        if (!first && readSignMailer.pauseMs) await new Promise((r) => setTimeout(r, readSignMailer.pauseMs));
        first = false;
        const screen = o.canEdit(o.labId, userId) ? "veritapolicy-app/my-policies" : "my-signoffs";
        let error: string | null = null;
        try {
          await readSignMailer.send({ to: mail.email, ...approvalEmail(lab.lab_name || "Your lab", mail.items, `${baseUrl()}/labs/${o.labId}/${screen}`) });
        } catch (err: any) {
          error = oneLine(err?.message || err, 300);
          console.error("[dc approval notice] send failed:", error);
        }
        for (const i of mail.items) {
          sqlite.prepare("UPDATE policy_approval_notices SET sent_at = CASE WHEN ? IS NULL THEN datetime('now') END, error = ? WHERE id = ?").run(error, error, i.noticeId);
          const t = told.get(i.documentId) ?? { sent: 0, failed: 0 };
          if (error) t.failed += 1; else t.sent += 1;
          told.set(i.documentId, t);
        }
      }
      for (const [documentId, t] of told) {
        writeAuditLog(sqlite, { labId: o.labId, documentId, userId: o.actorUserId, action: "approval_notice_sent", details: { ...t } });
      }
    })().catch((err) => console.error("[dc approval notice]", err?.message || err));
    return { people: byPerson.size, done };
  } catch (err: any) {
    console.error("[dc approval notice]", err?.message || err);
    return { people: 0, done: Promise.resolve() };
  }
}

// ── 2. Overdue read-and-sign ─────────────────────────────────────────────────

export interface OverdueDocument { document_id: number; title: string; doc_number: string | null; due: string }
export interface OwnedOverdue { document_id: number; title: string; doc_number: string | null; people: number }

/**
 * Who is overdue on what in one lab, on the lab's calendar. A person owes a document by the same rule as the tracker
 * (server/policyReadSign.ts) and hasn't signed it. It's overdue when its due date has passed; with no due date, when `days`
 * have passed since they first owed it: the latest of the assignment, when they joined the group (or the roster, for everyone
 * in the lab), and when the version they owe took effect. A due date someone set for that person decides over the count of days.
 */
export function overdueReadAndSign(sqlite: any, labId: number, days: number, today: string) {
  const tz = labTimeZoneById(sqlite, labId);
  const dayOf = (stamp: string | null | undefined): string => {
    const s = String(stamp ?? "");
    if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return labLocalDate(/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : `${s.replace(" ", "T")}Z`, false, tz);
  };
  const latest = (...d: string[]) => d.reduce((m, x) => (x > m ? x : m), "");
  // A signature made under My sign-offs answers an open assignment before anyone is called overdue.
  closeAttestationsCoveredByStaffSignatures(sqlite, labId, {});
  const ctx = loadReadSignContext(sqlite, labId);
  const isSigned = signedLookup(sqlite, ctx);
  const docs = sqlite.prepare(
    `SELECT d.id, d.title, d.doc_number, d.manual_id, d.owner_user_id, d.current_version_id,
            COALESCE((SELECT MAX(s.signed_at) FROM policy_signoffs s WHERE s.document_id = d.id AND s.version_id = d.current_version_id AND s.action = 'approved'),
                     (SELECT c.loaded_at FROM policy_carried_records c WHERE c.document_id = d.id AND c.version_id = d.current_version_id),
                     v.uploaded_at) AS in_effect_at
       FROM policy_documents d LEFT JOIN policy_versions v ON v.id = d.current_version_id
      WHERE d.lab_id = ? AND d.status = 'approved' AND d.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM policy_doc_type_settings ts WHERE ts.lab_id = d.lab_id AND ts.doc_type = d.doc_type AND ts.requires_read_and_sign = 0)`
  ).all(labId) as any[];
  const docById = new Map<number, any>(docs.map((d) => [d.id, d]));
  const staffLab = staffLabIdFor(sqlite, labId);
  const added = new Map<number, string>((staffLab == null ? [] : sqlite.prepare("SELECT id, created_at FROM staff_employees WHERE lab_id = ?").all(staffLab) as any[])
    .map((e: any): [number, string] => [e.id, dayOf(e.created_at)]));
  // Each roster person's login, and the roster person behind a login, so one person is counted and emailed once.
  const loginOf = new Map<number, number>();
  const employeeOf = new Map<number, number>();
  const seats = sqlite.prepare(
    "SELECT staff_employee_id AS emp, seat_user_id AS usr FROM user_seats WHERE lab_id = ? AND seat_type = 'staff_portal' AND status = 'active' AND staff_employee_id IS NOT NULL AND seat_user_id IS NOT NULL"
  ).all(labId) as any[];
  for (const e of ctx.roster) if (e.login_user_id) employeeOf.set(e.login_user_id, e.id);
  for (const s of seats) employeeOf.set(s.usr, s.emp);
  for (const e of ctx.roster) {
    const mine = [e.login_user_id, ...seats.filter((s) => s.emp === e.id).map((s) => s.usr)].filter((u) => u != null && activeLogin(sqlite, labId, u));
    if (mine.length) loginOf.set(e.id, mine[0]);
  }
  const keyOfEmployee = (emp: number) => (loginOf.has(emp) ? `u${loginOf.get(emp)}` : `e${emp}`);
  const keyOfUser = (userId: number) => (employeeOf.has(userId) ? keyOfEmployee(employeeOf.get(userId) as number) : activeLogin(sqlite, labId, userId) ? `u${userId}` : null);

  const owed = new Map<number, Map<string, { due: string; set: boolean }>>();
  const owe = (documentId: number, key: string, due: string, set: boolean) => {
    const of = owed.get(documentId) ?? new Map<string, { due: string; set: boolean }>();
    const was = of.get(key);
    if (!was || (set && !was.set) || (set === was.set && due < was.due)) of.set(key, { due, set });
    owed.set(documentId, of);
  };
  for (const d of docs) {
    const effect = dayOf(d.in_effect_at);
    for (const r of rulesForDocument(ctx, d)) {
      for (const emp of peopleOfRule(ctx, r)) {
        if (isSigned(d, emp)) continue;
        const joined = r.target_type === "group" ? dayOf(ctx.groupSince.get(`${r.group_id}:${emp}`)) : r.target_type === "everyone" ? added.get(emp) ?? "" : "";
        const since = latest(dayOf(r.assigned_at), joined, effect);
        if (since) owe(d.id, keyOfEmployee(emp), addLabDays(since, days), false);
      }
    }
  }
  for (const a of sqlite.prepare(
    `SELECT a.document_id, a.assigned_to_user_id AS usr, a.assigned_at, a.due_date
       FROM policy_attestations a JOIN policy_documents d ON d.id = a.document_id
      WHERE d.lab_id = ? AND a.completed_at IS NULL`
  ).all(labId) as any[]) {
    const d = docById.get(a.document_id);
    const key = d ? keyOfUser(a.usr) : null;
    if (!d || !key) continue;
    const emp = employeeOf.get(a.usr);
    if ((emp != null && isSigned(d, emp)) || attestationStillCurrent(sqlite, labId, d.id, a.usr, d.current_version_id)) continue;
    const set = /^\d{4}-\d{2}-\d{2}/.test(String(a.due_date || ""));
    owe(d.id, key, set ? String(a.due_date).slice(0, 10) : addLabDays(latest(dayOf(a.assigned_at), dayOf(d.in_effect_at)), days), set);
  }

  const people = new Map<number, OverdueDocument[]>();
  const owners = new Map<number, OwnedOverdue[]>();
  for (const [documentId, of] of owed) {
    const d = docById.get(documentId);
    const late = [...of.entries()].filter(([, o]) => o.due < today);
    for (const [key, o] of late) {
      if (!key.startsWith("u")) continue; // on the roster with no login: counted for the owner, emailed nothing
      const userId = Number(key.slice(1));
      people.set(userId, [...(people.get(userId) ?? []), { document_id: d.id, title: d.title, doc_number: d.doc_number ?? null, due: o.due }]);
    }
    const others = late.filter(([key]) => key !== `u${d.owner_user_id}`).length;
    if (others) owners.set(d.owner_user_id, [...(owners.get(d.owner_user_id) ?? []), { document_id: d.id, title: d.title, doc_number: d.doc_number ?? null, people: others }]);
  }
  for (const l of people.values()) l.sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
  for (const l of owners.values()) l.sort((a, b) => b.people - a.people || a.title.localeCompare(b.title));
  return { people, owners };
}

interface SignMailLab { labId: number; labName: string; owed: OverdueDocument[]; owned: OwnedOverdue[]; signAt: string }

const signEmail = (labs: SignMailLab[]) => {
  const owed = labs.reduce((n, l) => n + l.owed.length, 0);
  const owned = labs.reduce((n, l) => n + l.owned.length, 0);
  const parts = labs.map((l) =>
    `<div><b>${esc(l.labName)}</b></div>`
    + (l.owed.length
      ? `<div>Yours to read and sign in VeritaDC&trade;, past the date your lab set:</div>${list(l.owed.map((d) => `${named(d)} (was due ${usDay(d.due)})`))}`
        + `<div><a href="${baseUrl()}/labs/${l.labId}/${l.signAt}">Sign in to read and sign</a></div><div><br></div>`
      : "")
    + (l.owned.length
      ? `<div>Documents you own that people are overdue to sign:</div>${list(l.owned.map((d) => `${named(d)}: ${peopleWord(d.people)}`))}`
        + `<div><a href="${baseUrl()}/labs/${l.labId}/veritapolicy-app/my-policies">Open VeritaDC&trade; to see who</a></div><div><br></div>`
      : ""));
  return {
    subject: owed ? `Read and sign: ${documentsWord(owed)} overdue` : `Overdue signatures on ${documentsWord(owned)} you own`,
    html: parts.join("") + `<div>Your lab turned on this reminder in VeritaDC&trade;. You get it once a week at most, and only while something is overdue.</div>`,
  };
};

export interface SignNoticeRun { labs: number; people: number; sent: number; failed: number; waiting: number }

/** The weekly email, run daily (server/index.ts). `waiting` is people left alone because their last one was under 7 days ago. */
export async function runOverdueSignNotices(sqlite: any, at: Date = new Date()): Promise<SignNoticeRun> {
  const out: SignNoticeRun = { labs: 0, people: 0, sent: 0, failed: 0, waiting: 0 };
  // The run's minute, so a run that starts a few milliseconds earlier than last week's isn't held over to the next day.
  const now = new Date(Math.floor(at.getTime() / 60000) * 60000);
  const labs = sqlite.prepare(
    `SELECT id, lab_name FROM labs
      WHERE dc_notify_overdue_signs = 1 AND retired_at IS NULL
        AND NOT (COALESCE(is_trial, 0) = 1 AND subscription_expires_at IS NOT NULL AND subscription_expires_at <= ?)
      ORDER BY id`
  ).all(now.toISOString()) as any[];
  const mails = new Map<number, { email: string; labs: SignMailLab[] }>();
  for (const lab of labs) {
    out.labs += 1;
    try {
      const tz = labTimeZoneById(sqlite, lab.id);
      const found = withLabClock(tz, () => overdueReadAndSign(sqlite, lab.id, labNoticeSettings(sqlite, lab.id).overdueDays, labLocalDate(now.toISOString(), false, tz)));
      for (const userId of new Set([...found.people.keys(), ...found.owners.keys()])) {
        const who = activeLogin(sqlite, lab.id, userId);
        if (!who) continue;
        const limited = staffOwnScope(sqlite, userId, lab.id, "veritapolicy") != null;
        const owed = found.people.get(userId) ?? [];
        // An owner who is now a limited Staff login no longer reads who owes their documents.
        const owned = limited ? [] : found.owners.get(userId) ?? [];
        if (!owed.length && !owned.length) continue;
        const mail = mails.get(userId) ?? { email: who.email, labs: [] };
        mail.labs.push({ labId: lab.id, labName: lab.lab_name || "Your lab", owed, owned, signAt: staffSelfSeat(sqlite, userId, lab.id) ? "my-signoffs" : "veritapolicy-app/my-policies" });
        mails.set(userId, mail);
      }
    } catch (err: any) {
      console.error("[dc overdue sign notice] lab", lab.id, err?.message || err);
    }
  }
  const tally = new Map<number, { sent: number; failed: number }>();
  let first = true;
  for (const [userId, mail] of mails) {
    const last = (sqlite.prepare("SELECT MAX(claimed_at) AS at FROM policy_sign_notices WHERE user_id = ?").get(userId) as any)?.at as string | null;
    if (last && now.getTime() - Date.parse(last) < NOTICE_DAYS * 86400000) { out.waiting += 1; continue; }
    out.people += 1;
    const ids = sqlite.transaction(() => mail.labs.map((l) => Number(sqlite.prepare(
      "INSERT INTO policy_sign_notices (lab_id, user_id, owed_documents, owned_documents, claimed_at) VALUES (?, ?, ?, ?, ?)"
    ).run(l.labId, userId, l.owed.length, l.owned.length, now.toISOString()).lastInsertRowid)))() as number[];
    if (!first && readSignMailer.pauseMs) await new Promise((r) => setTimeout(r, readSignMailer.pauseMs));
    first = false;
    let error: string | null = null;
    try {
      await readSignMailer.send({ to: mail.email, ...signEmail(mail.labs) });
      out.sent += 1;
    } catch (err: any) {
      error = oneLine(err?.message || err, 300);
      out.failed += 1;
      console.error("[dc overdue sign notice] send failed:", error);
    }
    for (const id of ids) sqlite.prepare("UPDATE policy_sign_notices SET sent_at = CASE WHEN ? IS NULL THEN datetime('now') END, error = ? WHERE id = ?").run(error, error, id);
    for (const l of mail.labs) {
      const t = tally.get(l.labId) ?? { sent: 0, failed: 0 };
      if (error) t.failed += 1; else t.sent += 1;
      tally.set(l.labId, t);
    }
  }
  for (const [labId, t] of tally) {
    writeAuditLog(sqlite, { labId, documentId: null, userId: SYSTEM_USER_ID, action: "overdue_sign_notice_sent", details: { ...t } });
  }
  return out;
}
