// server/labInvites.ts
//
// Joining a lab with an account you already have (B3, BUG-193, Sanford, 2026-11-24; every invite since Michael's decision the same day).
// A floating person works in several labs with one login, so an invite goes to an address that already has an account; and an account
// joins a lab only when its own person accepts. Before, a Staff login invite refused such an address (409) and an admin, editor,
// reviewer or medical director invite added the person at once.
//
// Rules:
//   - POST /api/labs/:labId/members, /staff-portal-invites and /api/account/seats make the same pending seat row for any address, with
//     no account on it, and give the inviter the same answer whether or not the address has an account. The seat holds its place.
//   - Until the person accepts there is no membership, no roster link and no medical director acting for the lab. They accept signed in
//     as the invited address: the banner in the app, or the emailed link followed by signing in. Any other account is refused, and by
//     seat id it's told nothing. A brand-new address still signs up from its link (POST /api/auth/register), as before.
//   - Accepting gives the role that was offered, in that lab only. A role, seat or membership anywhere else isn't read or written, and
//     neither is the account's home or default lab. A Staff seat (read and sign) is tied to that lab's own roster entry and is refused
//     to someone who owns, manages, holds a seat in or directs the lab, at the invite and again when accepting.
//   - Veritas support accounts can't be invited or accept, because support never signs for a lab; a Staff login can't go to any Veritas
//     address. A script's token and the public demo can't accept. A lab that requires two-factor is joined only with it.
//   - Declined, cancelled or expired: no seat, membership or link stays. A medical director invite's designation goes back to what it
//     was (endInviteDesignation), so only the audit rows are left.
// What Staff may do is judged per lab on every request: server/seatContext.ts (staffLabForRequest), labAccessGuard.ts
// (staffOutsideRecordLab), competencySelfEntry.ts (staffOwnScope).
import type { Express } from "express";
import { logAudit } from "./audit";
import { isVeritasLogin } from "./labSeats";
import { editSeatInLab, managesLab, stampLablessSeatLab } from "./seatContext";
import { isUnconfirmed } from "./emailVerification";
import { linkInvitedMemberToRoster, reattachOrphanStaffInvites } from "./rosterMembers";
import { promoteMedicalDirectorToAdmin } from "./medicalDirectorRole";
import { getMfa, isEnrolled, labSystemOwner } from "./twoFactor";

export const INVITE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
/** The join page's and sign-up's rule: an invitation's link dies 30 days after it was sent. */
const isExpired = (invitedAt: unknown) => Date.now() - new Date(String(invitedAt)).getTime() > INVITE_DAYS * DAY_MS;

export type InviteRefusal = { status: number; error: string; code: string };
type Account = { id: number; email: string };

const isSupport = (sqlite: any, id: number) => Number((sqlite.prepare("SELECT COALESCE(vls_support, 0) AS v FROM users WHERE id = ?").get(id) as any)?.v) === 1;
const notAllowed: InviteRefusal = { status: 409, error: "This address can't be invited to a lab. Use a different email.", code: "INVITE_NOT_ALLOWED" };

/** Why this account can't be given a Staff login in this lab, or null. */
export function staffInviteRefusal(sqlite: any, labId: number, account: Account): InviteRefusal | null {
  if (isVeritasLogin(account.email) || isSupport(sqlite, account.id)) return notAllowed;
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

/** Why this account can't be invited as an admin, editor, reviewer or medical director, or null. A current member is the route's own check. */
export function memberInviteRefusal(sqlite: any, labId: number, account: Account): InviteRefusal | null {
  if (isSupport(sqlite, account.id)) return notAllowed;
  if (sqlite.prepare("SELECT 1 FROM labs WHERE id = ? AND owner_user_id = ?").get(labId, account.id)) {
    return { status: 409, error: "User is already a member of this lab", code: "ALREADY_IN_LAB" };
  }
  return null;
}

/** Another sign-in already stands for this roster entry. `accountId` is the invited address's own account, when it has one. */
export function rosterEntryTaken(sqlite: any, labId: number, employeeId: number, accountId: number | null): boolean {
  const row = sqlite.prepare("SELECT login_user_id FROM staff_employees WHERE id = ? AND tier2_lab_id = ?").get(employeeId, labId) as any;
  return row?.login_user_id != null && Number(row.login_user_id) !== Number(accountId ?? 0);
}

type InviteSeat = { owner_user_id: number; lab_id: number | null; seat_email: string; seat_type: string | null; invite_role: string | null; permissions: string | null };

/** The lab an invitation is for: its own, else (an older account-level one) the inviting owner's primary lab, as sign-up has it, else their first. */
export function inviteLabId(sqlite: any, seat: Pick<InviteSeat, "lab_id" | "owner_user_id" | "seat_type">): number | null {
  if (seat.lab_id) return Number(seat.lab_id);
  if (seat.seat_type === "staff_portal") return null;
  const row = (sqlite.prepare("SELECT lab_id FROM lab_members WHERE user_id = ? AND is_primary_lab = 1 AND status = 'active' LIMIT 1").get(seat.owner_user_id)
    ?? sqlite.prepare("SELECT id AS lab_id FROM labs WHERE owner_user_id = ? AND retired_at IS NULL ORDER BY id LIMIT 1").get(seat.owner_user_id)) as any;
  return row?.lab_id ? Number(row.lab_id) : null;
}

/** What the invitation offers, in words: "as an admin". */
export function inviteRoleLabel(sqlite: any, seat: InviteSeat, labId: number | null): string {
  if (seat.seat_type === "staff_portal") return "staff (read and sign)";
  const md = labId ? lower((sqlite.prepare("SELECT medical_director_email AS e FROM labs WHERE id = ?").get(labId) as any)?.e) : "";
  if (md && md === lower(seat.seat_email)) return "medical director";
  if (seat.seat_type === "view_only") return "a reviewer (view only)";
  if (seat.invite_role === "admin") return "an admin";
  try { if (JSON.parse(seat.permissions || "{}")?.mode === "view_all") return "a member (view only)"; } catch { /* an unreadable value is an editor's older shape */ }
  return "an editor";
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);

/** The invite email for an address that already has an account. Only the invited person sees it. */
export function inviteEmailForAccount(a: { inviterName: string; labName: string; offer: string; url: string }): string {
  return `
              <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
                <h2 style="color:#01696F">VeritaAssure®</h2>
                <p style="font-size:15px;color:#1B2B2B;line-height:1.6">${esc(a.inviterName)} has invited you to <strong>${esc(a.labName)}</strong> as ${esc(a.offer)}.</p>
                <p style="font-size:15px;color:#1B2B2B;line-height:1.6">You already have a VeritaAssure® login, so there's nothing to set up. Sign in with it and accept. Nothing changes until you do, and your access in any other lab stays as it is.</p>
                <a href="${esc(a.url)}" style="display:inline-block;background:#01696F;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">Review the invitation</a>
                <p style="font-size:13px;color:#6B7280;margin-top:16px">This invitation expires in 30 days. If you weren't expecting it, you can ignore it.</p>
                <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
                <p style="color:#999;font-size:12px">VeritaAssure® | Veritas Lab Services, LLC<br/>veritaslabservices.com</p>
              </div>
            `;
}

// ── A medical director invite names the director at once, as it always has; nothing acts on the name until the person is a member ──
// (resolveActiveMedicalDirectorUserId and every other reader join an active membership). What the name replaced is kept in
// lab_audit_log under the invitation, so an invitation that ends puts it back.
const designationReason = (seatId: number) => `lab invite ${seatId}`;

export function recordInviteDesignation(sqlite: any, labId: number, seatId: number, byUserId: number, before: { email: string | null; name: string | null }, after: { email: string | null; name: string | null }): void {
  const ins = sqlite.prepare("INSERT INTO lab_audit_log (lab_id, changed_by_user_id, field_name, old_value, new_value, change_reason) VALUES (?, ?, ?, ?, ?, ?)");
  ins.run(labId, byUserId, "medical_director_email", before.email, after.email, designationReason(seatId));
  ins.run(labId, byUserId, "medical_director_name", before.name, after.name, designationReason(seatId));
}

/** An invitation ended without being accepted: if it named the medical director and nobody has changed that since, undo it. */
export function endInviteDesignation(sqlite: any, seatId: number, byUserId: number): boolean {
  const seat = sqlite.prepare("SELECT lab_id, seat_email FROM user_seats WHERE id = ?").get(seatId) as any;
  if (!seat?.lab_id) return false;
  const labId = Number(seat.lab_id);
  const lab = sqlite.prepare("SELECT medical_director_email AS e, medical_director_name AS n FROM labs WHERE id = ?").get(labId) as any;
  const last = sqlite.prepare("SELECT old_value, change_reason FROM lab_audit_log WHERE lab_id = ? AND field_name = 'medical_director_email' ORDER BY id DESC LIMIT 1").get(labId) as any;
  if (!lab || last?.change_reason !== designationReason(seatId) || lower(lab.e) !== lower(seat.seat_email)) return false;
  // They belong to the lab some other way: the name stands.
  if (sqlite.prepare("SELECT 1 FROM lab_members lm JOIN users u ON u.id = lm.user_id WHERE lm.lab_id = ? AND lm.status = 'active' AND lower(u.email) = ?").get(labId, lower(seat.seat_email))) return false;
  const oldName = (sqlite.prepare("SELECT old_value FROM lab_audit_log WHERE lab_id = ? AND field_name = 'medical_director_name' AND change_reason = ? ORDER BY id DESC LIMIT 1").get(labId, designationReason(seatId)) as any)?.old_value ?? null;
  sqlite.prepare("UPDATE labs SET medical_director_email = ?, medical_director_name = ?, updated_at = ? WHERE id = ?").run(last.old_value ?? null, oldName, new Date().toISOString(), labId);
  const ins = sqlite.prepare("INSERT INTO lab_audit_log (lab_id, changed_by_user_id, field_name, old_value, new_value, change_reason) VALUES (?, ?, ?, ?, ?, ?)");
  ins.run(labId, byUserId, "medical_director_email", lab.e ?? null, last.old_value ?? null, `${designationReason(seatId)} ended`);
  return true;
}

/** Waiting invitations addressed to this account, for the banner. */
export function waitingInvites(sqlite: any, account: Account): { id: number; labName: string; offer: string; invitedAt: string; expiresAt: string }[] {
  const rows = sqlite.prepare(
    `SELECT id, owner_user_id, lab_id, seat_email, seat_type, invite_role, permissions, invited_at FROM user_seats
      WHERE status = 'pending' AND seat_user_id IS NULL AND lower(seat_email) = ? ORDER BY invited_at DESC, id DESC`
  ).all(lower(account.email)) as any[];
  const out: { id: number; labName: string; offer: string; invitedAt: string; expiresAt: string }[] = [];
  for (const r of rows) {
    const labId = inviteLabId(sqlite, r);
    const lab = labId ? sqlite.prepare("SELECT lab_name, retired_at FROM labs WHERE id = ?").get(labId) as any : null;
    if (!lab || lab.retired_at || isExpired(r.invited_at)) continue;
    out.push({
      id: Number(r.id), labName: lab.lab_name || "a laboratory", offer: inviteRoleLabel(sqlite, r, labId), invitedAt: r.invited_at,
      expiresAt: new Date(new Date(r.invited_at).getTime() + INVITE_DAYS * DAY_MS).toISOString(),
    });
  }
  return out;
}

const notFound: InviteRefusal = { status: 404, error: "This invitation isn't available. Ask the lab to send it again.", code: "INVITE_NOT_FOUND" };

export type AcceptedInvite = {
  ok: true; seatId: number; labId: number; labName: string; ownerUserId: number; staff: boolean; employeeId: number | null;
  membership: any; membershipBefore: any; linked: { labId: number; userId: number; employeeId: number } | null;
};

/**
 * Accept one invitation as this account. `byLink` is the emailed link's path, where a wrong account is told so; by seat id someone
 * else's invitation is the same 404 as one that doesn't exist.
 */
export function acceptInvite(sqlite: any, seatId: number, account: Account, opts: { byLink?: boolean; sid?: string | null } = {}): AcceptedInvite | { ok: false; refusal: InviteRefusal } {
  const no = (refusal: InviteRefusal) => ({ ok: false as const, refusal });
  const seat = sqlite.prepare(
    "SELECT id, owner_user_id, seat_email, seat_user_id, status, invited_at, lab_id, seat_type, staff_employee_id, invite_role, permissions FROM user_seats WHERE id = ?"
  ).get(seatId) as any;
  if (!seat) return no(notFound);
  const staff = seat.seat_type === "staff_portal";
  if (lower(seat.seat_email) !== lower(account.email)) {
    return no(opts.byLink && seat.status === "pending"
      ? { status: 403, error: "This invitation was sent to a different email address. Sign in with that address to accept it.", code: "INVITE_OTHER_ACCOUNT" }
      : notFound);
  }
  if (seat.status === "active" && Number(seat.seat_user_id) === account.id) return no({ status: 409, error: "You've already accepted this invitation.", code: "ALREADY_ACCEPTED" });
  if (seat.status !== "pending" || seat.seat_user_id != null) return no(notFound);
  if (isExpired(seat.invited_at)) return no({ status: 400, error: "This invitation has expired. Ask your lab to send it again.", code: "INVITE_EXPIRED" });
  if (isUnconfirmed(sqlite, account.id)) return no({ status: 403, error: "Confirm your email address first.", code: "EMAIL_NOT_CONFIRMED" });

  const labId = inviteLabId(sqlite, seat);
  const lab = labId ? sqlite.prepare("SELECT id, lab_name, owner_user_id, retired_at, medical_director_email, medical_director_name, COALESCE(mfa_required, 0) AS mfa FROM labs WHERE id = ?").get(labId) as any : null;
  if (!labId || !lab || lab.retired_at) return no(notFound);
  const refusal = staff ? staffInviteRefusal(sqlite, labId, account) : memberInviteRefusal(sqlite, labId, account);
  if (refusal) {
    return no(refusal.code === "INVITE_NOT_ALLOWED"
      ? { status: 403, error: "Veritas accounts can't join a lab by invitation.", code: refusal.code }
      : { status: 409, error: "You already have access to this lab, so there's nothing to accept.", code: refusal.code });
  }
  if (!staff && editSeatInLab(sqlite, account.id, labId, "id")) return no({ status: 409, error: "You already have access to this lab, so there's nothing to accept.", code: "ALREADY_IN_LAB" });
  if ((Number(lab.mfa) === 1 || labSystemOwner(sqlite, labId)) && !isEnrolled(getMfa(sqlite, account.id))) {
    // Two-factor turned on, or a sign-in that did it elsewhere (single sign-on).
    const method = opts.sid ? (sqlite.prepare("SELECT mfa_method AS m FROM user_sessions WHERE session_token = ? AND user_id = ?").get(opts.sid, account.id) as any)?.m : null;
    if (!method) return no({ status: 403, error: `${lab.lab_name || "This lab"} requires two-factor sign-in. Turn it on in Account settings, then accept.`, code: "TWO_FACTOR_REQUIRED" });
  }

  let employeeId: number | null = null;
  if (staff) {
    // The roster entry is this lab's own and still active (a cleaned-up duplicate is moved to the real entry first, as the lists do).
    reattachOrphanStaffInvites(sqlite, labId);
    employeeId = Number((sqlite.prepare("SELECT staff_employee_id FROM user_seats WHERE id = ?").get(seatId) as any)?.staff_employee_id) || null;
    const onRoster = employeeId ? sqlite.prepare("SELECT 1 FROM staff_employees WHERE id = ? AND tier2_lab_id = ? AND status = 'active'").get(employeeId, labId) : null;
    if (!employeeId || !onRoster) return no({ status: 409, error: "This invitation's roster entry is no longer active. Ask the lab to invite you again.", code: "ROSTER_ENTRY_GONE" });
    const otherSeat = sqlite.prepare("SELECT 1 FROM user_seats WHERE staff_employee_id = ? AND seat_type = 'staff_portal' AND status = 'active' AND id <> ? LIMIT 1").get(employeeId, seatId);
    if (otherSeat || rosterEntryTaken(sqlite, labId, employeeId, account.id)) {
      return no({ status: 409, error: "Someone else's sign-in is already on this roster entry. Ask the lab to check it.", code: "ROSTER_ENTRY_TAKEN" });
    }
  }

  const now = new Date().toISOString();
  const role = !staff && seat.invite_role === "admin" ? "admin" : "staff";
  const done = sqlite.transaction(() => {
    const took = sqlite.prepare("UPDATE user_seats SET seat_user_id = ?, status = 'active', accepted_at = ? WHERE id = ? AND status = 'pending' AND seat_user_id IS NULL").run(account.id, now, seatId);
    if (Number(took.changes) !== 1) return null;
    // A membership already active keeps its role.
    const before = sqlite.prepare("SELECT * FROM lab_members WHERE lab_id = ? AND user_id = ?").get(labId, account.id) as any;
    if (!before) {
      sqlite.prepare(
        `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at)
         VALUES (?, ?, ?, '{}', 'active', 0, ?, ?, ?)`
      ).run(labId, account.id, role, now, now, now);
    } else if (before.status !== "active") {
      sqlite.prepare("UPDATE lab_members SET role = ?, status = 'active', accepted_at = ?, updated_at = ? WHERE id = ?").run(role, now, now, before.id);
    }
    if (!staff) {
      // The lab's medical director is an admin (2026-10-23), from the moment they join.
      promoteMedicalDirectorToAdmin(sqlite, labId);
      if (lower(lab.medical_director_email) === lower(account.email) && !String(lab.medical_director_name || "").trim()) {
        const name = (sqlite.prepare("SELECT name FROM users WHERE id = ?").get(account.id) as any)?.name || null;
        if (name) sqlite.prepare("UPDATE labs SET medical_director_name = ?, updated_at = ? WHERE id = ?").run(name, now, labId);
      }
    }
    const membership = sqlite.prepare("SELECT * FROM lab_members WHERE lab_id = ? AND user_id = ?").get(labId, account.id) as any;
    return { membership, membershipBefore: before ?? null };
  })();
  if (!done) return no(notFound);
  let linked: AcceptedInvite["linked"] = null;
  if (!staff) {
    // As sign-up does: an older seat with no lab takes it (Q287), then the roster entry with the name the director typed (BUG-183).
    try { stampLablessSeatLab(sqlite, seatId); linked = linkInvitedMemberToRoster(sqlite, seatId); } catch (err: any) { console.error("[lab-invites] roster link failed (non-fatal):", err?.message); }
  }
  return { ok: true, seatId, labId, labName: lab.lab_name || "the lab", ownerUserId: Number(lab.owner_user_id), staff, employeeId, linked, ...done };
}

/** The audit row an invite leaves: who, which lab, what was offered. No address and no link. */
export function auditInvite(o: { userId: number; ownerUserId: number; seatId: number; labId: number | null; offer: string; employeeId?: number | null; ip?: string }): void {
  logAudit({
    userId: o.userId, ownerUserId: o.ownerUserId, module: "account", action: "create", entityType: "lab_invite", entityId: o.seatId,
    entityLabel: `Invited to lab ${o.labId ?? "(none)"} as ${o.offer}`, after: { status: "pending", lab_id: o.labId, ...(o.employeeId ? { staff_employee_id: o.employeeId } : {}) }, ipAddress: o.ip,
  });
}

export function registerLabInviteRoutes(app: Express, deps: {
  sqlite: any;
  authMiddleware: any;
  getUserById: (id: number) => { id: number; email: string } | undefined;
  auditLabMembership: (action: string, membership: any, actorUserId: number, ip: string | null, source: string, before?: any) => void;
}) {
  const { sqlite, authMiddleware, getUserById, auditLabMembership } = deps;
  // A person, signed in as themselves: never a script's token or the public demo.
  const account = (req: any): Account | null => (req.isDemo || req.authKind === "service" ? null : getUserById(req.userId) ?? null);
  const notAPerson = (res: any) => res.status(403).json({ error: "Sign in as yourself to answer an invitation.", code: "NOT_A_PERSON" });
  const refuse = (res: any, r: InviteRefusal) => res.status(r.status).json({ error: r.error, code: r.code });

  app.get("/api/me/lab-invites", authMiddleware, (req: any, res: any) => {
    const me = account(req);
    if (!me || isUnconfirmed(sqlite, me.id) || isSupport(sqlite, me.id)) return res.json([]);
    res.json(waitingInvites(sqlite, me));
  });

  const accept = (req: any, res: any, seatId: number, byLink: boolean) => {
    const me = account(req);
    if (!me) return notAPerson(res);
    const r = acceptInvite(sqlite, seatId, me, { byLink, sid: req.sessionSid });
    if (!r.ok) return refuse(res, r.refusal);
    const ip = (req.headers["x-forwarded-for"] as string) || null;
    if (!r.membershipBefore || r.membershipBefore.status !== "active") {
      auditLabMembership(r.membershipBefore ? "update_status" : "create", r.membership, me.id, ip, "lab-invite:accept", r.membershipBefore);
    }
    logAudit({
      userId: me.id, ownerUserId: r.ownerUserId, module: "account", action: "update", entityType: "lab_invite", entityId: r.seatId,
      entityLabel: `Invitation accepted in lab ${r.labId}`, before: { status: "pending" },
      after: { status: "active", lab_id: r.labId, role: r.membership?.role, ...(r.employeeId ? { staff_employee_id: r.employeeId } : {}), user_id: me.id }, ipAddress: req.ip,
    });
    if (r.linked) logAudit({ userId: me.id, ownerUserId: r.ownerUserId, module: "veritastaff", action: "update", entityType: "staff_employee.login_link", entityId: r.linked.employeeId, entityLabel: "linked on invite accept", after: { login_user_id: r.linked.userId, lab_id: r.linked.labId }, ipAddress: req.ip });
    console.log(`[lab-invites] seat ${r.seatId} accepted by user ${me.id} in lab ${r.labId}`);
    res.json({ ok: true, labId: r.labId, labName: r.labName });
  };

  // The emailed link, after signing in. Registered before /:id so "accept" is never read as an id.
  app.post("/api/me/lab-invites/accept", authMiddleware, (req: any, res: any) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const seat = token ? sqlite.prepare("SELECT id FROM user_seats WHERE invite_token = ?").get(token) as any : null;
    if (!seat) return account(req) ? refuse(res, notFound) : notAPerson(res);
    accept(req, res, Number(seat.id), true);
  });

  app.post("/api/me/lab-invites/:id/accept", authMiddleware, (req: any, res: any) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return refuse(res, notFound);
    accept(req, res, id, false);
  });

  // "Not me", or not wanted: the invitation ends and its seat is free again. Nothing else changes.
  app.post("/api/me/lab-invites/:id/decline", authMiddleware, (req: any, res: any) => {
    const me = account(req);
    if (!me) return notAPerson(res);
    const id = Number(req.params.id);
    const waiting = Number.isInteger(id) ? waitingInvites(sqlite, me).find((w) => w.id === id) : undefined;
    const ended = waiting ? sqlite.prepare("UPDATE user_seats SET status = 'dismissed' WHERE id = ? AND status = 'pending' AND seat_user_id IS NULL").run(id) : null;
    if (!ended || Number(ended.changes) !== 1) return refuse(res, notFound);
    const seat = sqlite.prepare("SELECT lab_id, owner_user_id FROM user_seats WHERE id = ?").get(id) as any;
    const undone = endInviteDesignation(sqlite, id, me.id);
    logAudit({
      userId: me.id, ownerUserId: Number(seat.owner_user_id), module: "account", action: "update", entityType: "lab_invite", entityId: id,
      entityLabel: `Invitation declined in lab ${seat.lab_id ?? "(none)"}`, before: { status: "pending" }, after: { status: "dismissed", ...(undone ? { medical_director_designation: "put back" } : {}) }, ipAddress: req.ip,
    });
    res.json({ ok: true });
  });
}
