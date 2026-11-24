// server/staffInvites.ts
//
// One read-and-sign login in several labs (B3, BUG-193, Sanford, 2026-11-24). A floating person works in several labs of one system.
// The Staff login invite refused any address that already had an account (409), so a second lab couldn't invite the same person.
//
// Rules:
//   - A lab's owner or admin can invite an address that already has an account. The invite is the same pending seat row and email as
//     any other, and the inviter's answer is the same, so nothing new is learned about the address.
//   - Nothing is granted until that person accepts, signed in to the account at the invited address: from the banner in the app, or
//     from the emailed link followed by signing in. An account at any other address is refused, and by seat id it's told nothing.
//   - Accepting ties the seat to that lab's own roster entry and gives a 'staff' membership in that lab only. A role, seat or
//     membership anywhere else isn't read or written, and neither is the account's home or default lab, so a Staff seat never
//     lowers or raises anyone. Someone who already owns or manages the lab, holds a seat there, or is its medical director and a
//     member is refused, at the invite and again when accepting.
//   - Veritas support accounts and Veritas logins can't be invited or accept; neither can a script token or the public demo.
//   - A lab that requires two-factor sign-in is joined only by a sign-in that has it, as at sign-up.
//   - Seats are counted as they were: the lab's own Staff seats (server/labSeats.ts).
// What Staff may do is judged per lab on every request: server/seatContext.ts (staffLabForRequest), labAccessGuard.ts
// (staffOutsideRecordLab), competencySelfEntry.ts (staffOwnScope).
import type { Express } from "express";
import { logAudit } from "./audit";
import { isVeritasLogin } from "./labSeats";
import { editSeatInLab, managesLab } from "./seatContext";
import { isUnconfirmed } from "./emailVerification";
import { reattachOrphanStaffInvites } from "./rosterMembers";
import { getMfa, isEnrolled, labSystemOwner } from "./twoFactor";

export const STAFF_INVITE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
/** The join page's and sign-up's rule: an invitation's link dies 30 days after it was sent. */
const isExpired = (invitedAt: unknown) => Date.now() - new Date(String(invitedAt)).getTime() > STAFF_INVITE_DAYS * DAY_MS;

export type StaffInviteRefusal = { status: number; error: string; code: string };
type Account = { id: number; email: string };

/** A Veritas support account, the operator's login, or any Veritas address. */
export function isVeritasAccount(sqlite: any, account: Account): boolean {
  if (isVeritasLogin(account.email)) return true;
  return Number((sqlite.prepare("SELECT COALESCE(vls_support, 0) AS v FROM users WHERE id = ?").get(account.id) as any)?.v) === 1;
}

/** Why this account can't be given a Staff login in this lab, or null. */
export function staffInviteRefusal(sqlite: any, labId: number, account: Account): StaffInviteRefusal | null {
  if (isVeritasAccount(sqlite, account)) {
    return { status: 409, error: "This address can't be invited as a staff login. Use a different email.", code: "STAFF_INVITE_NOT_ALLOWED" };
  }
  if (managesLab(sqlite, account.id, labId)) {
    return { status: 409, error: "This person already manages this lab, so they don't need a staff login here. Link them to their roster entry in VeritaStaff™ instead.", code: "ALREADY_IN_LAB" };
  }
  if (editSeatInLab(sqlite, account.id, labId, "id")) {
    return { status: 409, error: "This email already has a seat on this lab. Use the seat list to manage it.", code: "ALREADY_IN_LAB" };
  }
  const director = sqlite.prepare(
    `SELECT 1 FROM labs l JOIN lab_members lm ON lm.lab_id = l.id AND lm.user_id = ? AND lm.status = 'active'
      WHERE l.id = ? AND lower(trim(COALESCE(l.medical_director_email, ''))) = ?`
  ).get(account.id, labId, lower(account.email));
  if (director) return { status: 409, error: "This person is already the lab's medical director.", code: "ALREADY_IN_LAB" };
  return null;
}

/** Another sign-in already stands for this roster entry. `accountId` is the invited address's own account, when it has one. */
export function rosterEntryTaken(sqlite: any, labId: number, employeeId: number, accountId: number | null): boolean {
  const row = sqlite.prepare("SELECT login_user_id FROM staff_employees WHERE id = ? AND tier2_lab_id = ?").get(employeeId, labId) as any;
  return row?.login_user_id != null && Number(row.login_user_id) !== Number(accountId ?? 0);
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);

/** The invite email for an address that already has an account. Only the invited person sees it. */
export function staffInviteEmailForAccount(a: { inviterName: string; labName: string; personName: string; url: string }): string {
  return `
              <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
                <h2 style="color:#01696F">VeritaAssure® staff login</h2>
                <p style="font-size:15px;color:#1B2B2B;line-height:1.6">${esc(a.inviterName)} at <strong>${esc(a.labName)}</strong> has invited ${esc(a.personName)} to a read-and-sign staff login in that lab.</p>
                <p style="font-size:15px;color:#1B2B2B;line-height:1.6">You already have a VeritaAssure® login, so there's nothing to set up. Sign in with it and accept. Nothing changes until you do, and your access in any other lab stays as it is.</p>
                <a href="${esc(a.url)}" style="display:inline-block;background:#01696F;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">Review the invitation</a>
                <p style="font-size:13px;color:#6B7280;margin-top:16px">This invitation expires in 30 days. If you weren't expecting it, you can ignore it.</p>
                <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
                <p style="color:#999;font-size:12px">VeritaAssure® | Veritas Lab Services, LLC<br/>veritaslabservices.com</p>
              </div>
            `;
}

/** Waiting Staff invitations addressed to this account, for the banner. */
export function waitingStaffInvites(sqlite: any, account: Account): { id: number; labName: string; invitedAt: string; expiresAt: string }[] {
  const rows = sqlite.prepare(
    `SELECT us.id, us.invited_at, l.lab_name FROM user_seats us JOIN labs l ON l.id = us.lab_id
      WHERE us.status = 'pending' AND us.seat_type = 'staff_portal' AND us.seat_user_id IS NULL
        AND lower(us.seat_email) = ? AND l.retired_at IS NULL
      ORDER BY us.invited_at DESC, us.id DESC`
  ).all(lower(account.email)) as any[];
  return rows.filter((r) => !isExpired(r.invited_at)).map((r) => ({
    id: Number(r.id), labName: r.lab_name || "a laboratory", invitedAt: r.invited_at,
    expiresAt: new Date(new Date(r.invited_at).getTime() + STAFF_INVITE_DAYS * DAY_MS).toISOString(),
  }));
}

const notFound: StaffInviteRefusal = { status: 404, error: "This invitation isn't available. Ask the lab to send it again.", code: "INVITE_NOT_FOUND" };

/**
 * Accept one Staff invitation as this account. `byLink` is the emailed link's path, where a wrong account is told so; by seat id
 * someone else's invitation is the same 404 as one that doesn't exist.
 */
export function acceptStaffInvite(sqlite: any, seatId: number, account: Account, opts: { byLink?: boolean; sid?: string | null } = {}):
  { ok: true; seatId: number; labId: number; labName: string; ownerUserId: number; employeeId: number; membership: any; membershipBefore: any } | { ok: false; refusal: StaffInviteRefusal } {
  const no = (refusal: StaffInviteRefusal) => ({ ok: false as const, refusal });
  const seat = sqlite.prepare(
    "SELECT id, owner_user_id, seat_email, seat_user_id, status, invited_at, lab_id, seat_type, staff_employee_id FROM user_seats WHERE id = ?"
  ).get(seatId) as any;
  if (!seat || seat.seat_type !== "staff_portal" || !seat.lab_id) return no(notFound);
  const mine = lower(seat.seat_email) === lower(account.email);
  if (!mine) {
    return no(opts.byLink && seat.status === "pending"
      ? { status: 403, error: "This invitation was sent to a different email address. Sign in with that address to accept it.", code: "INVITE_OTHER_ACCOUNT" }
      : notFound);
  }
  if (seat.status === "active" && Number(seat.seat_user_id) === account.id) return no({ status: 409, error: "You've already accepted this invitation.", code: "ALREADY_ACCEPTED" });
  if (seat.status !== "pending" || seat.seat_user_id != null) return no(notFound);
  if (isExpired(seat.invited_at)) return no({ status: 400, error: "This invitation has expired. Ask your lab to send it again.", code: "INVITE_EXPIRED" });
  if (isUnconfirmed(sqlite, account.id)) return no({ status: 403, error: "Confirm your email address first.", code: "EMAIL_NOT_CONFIRMED" });

  const labId = Number(seat.lab_id);
  const lab = sqlite.prepare("SELECT id, lab_name, owner_user_id, retired_at, COALESCE(mfa_required, 0) AS mfa FROM labs WHERE id = ?").get(labId) as any;
  if (!lab || lab.retired_at) return no(notFound);
  const refusal = staffInviteRefusal(sqlite, labId, account);
  if (refusal) {
    return no(refusal.code === "STAFF_INVITE_NOT_ALLOWED"
      ? { status: 403, error: "Veritas accounts can't hold a lab's staff login.", code: refusal.code }
      : { status: 409, error: "You already have access to this lab, so there's nothing to accept.", code: refusal.code });
  }

  if ((Number(lab.mfa) === 1 || labSystemOwner(sqlite, labId)) && !isEnrolled(getMfa(sqlite, account.id))) {
    // Two-factor turned on, or a sign-in that did it elsewhere (single sign-on).
    const method = opts.sid ? (sqlite.prepare("SELECT mfa_method AS m FROM user_sessions WHERE session_token = ? AND user_id = ?").get(opts.sid, account.id) as any)?.m : null;
    if (!method) return no({ status: 403, error: `${lab.lab_name || "This lab"} requires two-factor sign-in. Turn it on in Account settings, then accept.`, code: "TWO_FACTOR_REQUIRED" });
  }

  // The roster entry is this lab's own and still active (a cleaned-up duplicate is moved to the real entry first, as the lists do).
  reattachOrphanStaffInvites(sqlite, labId);
  const employeeId = Number((sqlite.prepare("SELECT staff_employee_id FROM user_seats WHERE id = ?").get(seatId) as any)?.staff_employee_id) || 0;
  const onRoster = employeeId ? sqlite.prepare("SELECT 1 FROM staff_employees WHERE id = ? AND tier2_lab_id = ? AND status = 'active'").get(employeeId, labId) : null;
  if (!onRoster) return no({ status: 409, error: "This invitation's roster entry is no longer active. Ask the lab to invite you again.", code: "ROSTER_ENTRY_GONE" });
  const otherSeat = sqlite.prepare("SELECT 1 FROM user_seats WHERE staff_employee_id = ? AND seat_type = 'staff_portal' AND status = 'active' AND id <> ? LIMIT 1").get(employeeId, seatId);
  if (otherSeat || rosterEntryTaken(sqlite, labId, employeeId, account.id)) {
    return no({ status: 409, error: "Someone else's sign-in is already on this roster entry. Ask the lab to check it.", code: "ROSTER_ENTRY_TAKEN" });
  }

  const now = new Date().toISOString();
  return sqlite.transaction(() => {
    const took = sqlite.prepare("UPDATE user_seats SET seat_user_id = ?, status = 'active', accepted_at = ? WHERE id = ? AND status = 'pending' AND seat_user_id IS NULL").run(account.id, now, seatId);
    if (Number(took.changes) !== 1) return no(notFound);
    // A membership already active keeps its role; only an owner, an admin or a seat holder could hold more, and they were refused above.
    const before = sqlite.prepare("SELECT * FROM lab_members WHERE lab_id = ? AND user_id = ?").get(labId, account.id) as any;
    if (!before) {
      sqlite.prepare(
        `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at)
         VALUES (?, ?, 'staff', '{}', 'active', 0, ?, ?, ?)`
      ).run(labId, account.id, now, now, now);
    } else if (before.status !== "active") {
      sqlite.prepare("UPDATE lab_members SET role = 'staff', status = 'active', accepted_at = ?, updated_at = ? WHERE id = ?").run(now, now, before.id);
    }
    const membership = sqlite.prepare("SELECT * FROM lab_members WHERE lab_id = ? AND user_id = ?").get(labId, account.id) as any;
    return { ok: true as const, seatId, labId, labName: lab.lab_name || "the lab", ownerUserId: Number(lab.owner_user_id), employeeId, membership, membershipBefore: before ?? null };
  })();
}

/**
 * Does this person also work in a lab the actor doesn't own or manage? A shared login's email, name and two-factor belong to the
 * person in every lab, so one lab's admin can't change them for the others. With `moreThanStaff`, only a lab where they own,
 * manage or hold a writer seat counts. Demo and retired labs don't.
 */
export function worksBeyond(sqlite: any, targetUserId: number, actorUserId: number, opts: { moreThanStaff?: boolean } = {}): boolean {
  const role = opts.moreThanStaff ? "AND lm.role IN ('owner','admin')" : "";
  const seat = opts.moreThanStaff ? "AND COALESCE(us.seat_type, 'active') NOT IN ('staff_portal','view_only')" : "";
  return !!sqlite.prepare(
    `SELECT 1 FROM labs l
      WHERE l.retired_at IS NULL AND COALESCE(l.is_demo, 0) = 0
        AND (l.owner_user_id = @target
          OR EXISTS (SELECT 1 FROM lab_members lm WHERE lm.lab_id = l.id AND lm.user_id = @target AND lm.status = 'active' ${role})
          OR EXISTS (SELECT 1 FROM user_seats us WHERE us.lab_id = l.id AND us.seat_user_id = @target AND us.status = 'active' ${seat}))
        AND l.owner_user_id <> @actor
        AND NOT EXISTS (SELECT 1 FROM lab_members am WHERE am.lab_id = l.id AND am.user_id = @actor AND am.status = 'active' AND am.role IN ('owner','admin'))
        AND NOT EXISTS (SELECT 1 FROM organization_members om WHERE om.organization_id = l.organization_id AND om.user_id = @actor AND om.status = 'active' AND om.org_role IN ('org_owner','org_admin'))
      LIMIT 1`
  ).get({ target: targetUserId, actor: actorUserId });
}

export function registerStaffInviteRoutes(app: Express, deps: {
  sqlite: any;
  authMiddleware: any;
  getUserById: (id: number) => { id: number; email: string } | undefined;
  auditLabMembership: (action: string, membership: any, actorUserId: number, ip: string | null, source: string, before?: any) => void;
}) {
  const { sqlite, authMiddleware, getUserById, auditLabMembership } = deps;
  // A person, signed in as themselves: never a script's token or the public demo.
  const account = (req: any): Account | null => (req.isDemo || req.authKind === "service" ? null : getUserById(req.userId) ?? null);
  const notAPerson = (res: any) => res.status(403).json({ error: "Sign in as yourself to answer an invitation.", code: "NOT_A_PERSON" });
  const refuse = (res: any, r: StaffInviteRefusal) => res.status(r.status).json({ error: r.error, code: r.code });

  app.get("/api/me/staff-invites", authMiddleware, (req: any, res: any) => {
    const me = account(req);
    if (!me || isUnconfirmed(sqlite, me.id) || isVeritasAccount(sqlite, me)) return res.json([]);
    res.json(waitingStaffInvites(sqlite, me));
  });

  const accept = (req: any, res: any, seatId: number, byLink: boolean) => {
    const me = account(req);
    if (!me) return notAPerson(res);
    const r = acceptStaffInvite(sqlite, seatId, me, { byLink, sid: req.sessionSid });
    if (!r.ok) return refuse(res, r.refusal);
    const ip = (req.headers["x-forwarded-for"] as string) || null;
    if (!r.membershipBefore || r.membershipBefore.status !== "active") {
      auditLabMembership(r.membershipBefore ? "update_status" : "create", r.membership, me.id, ip, "staff-invite:accept", r.membershipBefore);
    }
    logAudit({
      userId: me.id, ownerUserId: r.ownerUserId, module: "account", action: "update", entityType: "staff_invite", entityId: r.seatId,
      entityLabel: `Staff login accepted in lab ${r.labId}`, before: { status: "pending" },
      after: { status: "active", lab_id: r.labId, staff_employee_id: r.employeeId, user_id: me.id }, ipAddress: req.ip,
    });
    console.log(`[staff-invites] seat ${r.seatId} accepted by user ${me.id} in lab ${r.labId}`);
    res.json({ ok: true, labId: r.labId, labName: r.labName });
  };

  // The emailed link, after signing in. Registered before /:id so "accept" is never read as an id.
  app.post("/api/me/staff-invites/accept", authMiddleware, (req: any, res: any) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const seat = token ? sqlite.prepare("SELECT id FROM user_seats WHERE invite_token = ? AND seat_type = 'staff_portal'").get(token) as any : null;
    if (!seat) return account(req) ? refuse(res, notFound) : notAPerson(res);
    accept(req, res, Number(seat.id), true);
  });

  app.post("/api/me/staff-invites/:id/accept", authMiddleware, (req: any, res: any) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return refuse(res, notFound);
    accept(req, res, id, false);
  });

  // "Not me", or not wanted: the invitation ends and its seat is free again. Nothing else changes.
  app.post("/api/me/staff-invites/:id/decline", authMiddleware, (req: any, res: any) => {
    const me = account(req);
    if (!me) return notAPerson(res);
    const id = Number(req.params.id);
    const waiting = Number.isInteger(id) ? waitingStaffInvites(sqlite, me).find((w) => w.id === id) : undefined;
    const ended = waiting ? sqlite.prepare("UPDATE user_seats SET status = 'dismissed' WHERE id = ? AND status = 'pending' AND seat_user_id IS NULL").run(id) : null;
    if (!ended || Number(ended.changes) !== 1) return refuse(res, notFound);
    const seat = sqlite.prepare("SELECT lab_id, owner_user_id FROM user_seats WHERE id = ?").get(id) as any;
    logAudit({
      userId: me.id, ownerUserId: Number(seat.owner_user_id), module: "account", action: "update", entityType: "staff_invite", entityId: id,
      entityLabel: `Staff login declined in lab ${seat.lab_id}`, before: { status: "pending" }, after: { status: "dismissed" }, ipAddress: req.ip,
    });
    res.json({ ok: true });
  });
}
