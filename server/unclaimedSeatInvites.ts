// server/unclaimedSeatInvites.ts
//
// Michael 2026-11-16 (with Q345 = 1): "unclaimed seats after 30 days should be removed, and email sent to owner that it
// was unclaimed, and the seat returned." An invitation's link already stopped working after 30 days (the sign-up route's
// INVITE_EXPIRED), but the row stayed 'pending', so the seat stayed counted against the lab (labSeats.ts
// SEAT_HOLDS_PLACE) until /api/admin/report's silent auto-dismiss at 90 days, and the address couldn't sign up on its
// own (INVITE_LINK_REQUIRED).
//
// Rules:
//   - Unclaimed = status 'pending', no account attached (seat_user_id NULL), invited more than 30 days ago. Every seat
//     type (writer and Staff login). A pending row with an account attached is left alone and only counted: ending it
//     could change what that person reaches.
//   - The lab owner (labs.owner_user_id, else the seat's owner) gets ONE email per run listing their invitations that
//     ended: lab, the invitee's name and address, seat type, how many days ago it was sent, and a link to the lab's
//     Members page. No other email: the invitee isn't written to.
//   - A row ends only after the mail provider accepts the owner's email (then status 'deactivated', the state every seat
//     count and the re-invite path already read as no seat, and one audit_log row per seat). A failed send leaves the
//     rows pending, so the next run tries again.
//   - No mailer (RESEND_API_KEY unset: local and CI) ends nothing.
//   - dryRun returns the plan (counts and ids only) and writes and sends nothing.
import { db } from "./db";

export const UNCLAIMED_INVITE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type UnclaimedMail = { to: string; subject: string; html: string };
export type UnclaimedMailer = (m: UnclaimedMail) => Promise<void>;

let mailerOverride: UnclaimedMailer | null = null;
/** Test hook: capture mail instead of sending it. */
export function setUnclaimedSeatMailerForTest(m: UnclaimedMailer | null) { mailerOverride = m; }

async function getMailer(): Promise<UnclaimedMailer | null> {
  if (mailerOverride) return mailerOverride;
  if (!process.env.RESEND_API_KEY) return null;
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  return async (m) => {
    const r: any = await resend.emails.send({ from: "VeritaAssure® <info@veritaslabservices.com>", to: m.to, subject: m.subject, html: m.html });
    if (r?.error) throw new Error(r.error.message || String(r.error));
  };
}

/** invited_at as a time: an ISO string, or SQLite's "YYYY-MM-DD HH:MM:SS" (UTC). NaN when unreadable. */
export function invitedAtMs(v: unknown): number {
  const s = String(v ?? "").trim();
  if (!s) return NaN;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? s.replace(" ", "T") + "Z" : s;
  return Date.parse(iso);
}

export type UnclaimedInvite = {
  seatId: number; ownerUserId: number; labId: number | null; labName: string | null; seatEmail: string;
  inviteeName: string | null; seatLabel: string; daysAgo: number;
};

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);

function seatLabel(r: { seat_type: string | null; seat_email: string; md_email: string | null }): string {
  if (r.seat_type === "staff_portal") return "Staff login (read and sign)";
  if (r.md_email && String(r.md_email).trim().toLowerCase() === String(r.seat_email).toLowerCase()) return "Medical director";
  return "Active seat";
}

/** The invitations that have gone unclaimed, oldest first, and how many pending rows with an account were left alone. */
export function unclaimedInvites(sqlite: any, now: Date = new Date()): { invites: UnclaimedInvite[]; pendingWithAccount: number } {
  const cutoff = now.getTime() - UNCLAIMED_INVITE_DAYS * DAY_MS;
  const rows = sqlite.prepare(
    `SELECT us.id, COALESCE(l.owner_user_id, us.owner_user_id) AS owner_id, us.lab_id, l.lab_name, us.seat_email,
            us.seat_type, us.invited_at, us.invitee_name, us.seat_user_id, l.medical_director_email AS md_email
       FROM user_seats us LEFT JOIN labs l ON l.id = us.lab_id
      WHERE us.status = 'pending'
      ORDER BY us.id`
  ).all() as any[];
  let pendingWithAccount = 0;
  const invites: UnclaimedInvite[] = [];
  for (const r of rows) {
    const at = invitedAtMs(r.invited_at);
    if (!Number.isFinite(at) || at >= cutoff) continue;
    if (r.seat_user_id != null) { pendingWithAccount++; continue; }
    invites.push({
      seatId: r.id, ownerUserId: r.owner_id, labId: r.lab_id ?? null, labName: r.lab_name ?? null, seatEmail: r.seat_email,
      inviteeName: r.invitee_name ? String(r.invitee_name).trim() || null : null, seatLabel: seatLabel(r),
      daysAgo: Math.floor((now.getTime() - at) / DAY_MS),
    });
  }
  invites.sort((a, b) => b.daysAgo - a.daysAgo || a.seatId - b.seatId);
  return { invites, pendingWithAccount };
}

/** The owner's email: the invitations listed, and that their seats are back. */
export function buildUnclaimedEmail(invites: UnclaimedInvite[], frontendUrl = "https://www.veritaslabservices.com") {
  const n = invites.length;
  const subject = n === 1 ? "An invitation wasn't accepted in 30 days, and its seat is back" : `${n} invitations weren't accepted in 30 days, and their seats are back`;
  const rows = invites.map((i) => {
    const who = i.inviteeName ? `${esc(i.inviteeName)}<br/><span style="color:#666">${esc(i.seatEmail)}</span>` : esc(i.seatEmail);
    const lab = i.labId ? `<a href="${frontendUrl}/labs/${i.labId}/members" style="color:#01696F">${esc(i.labName || "Your laboratory")}</a>` : esc(i.labName || "Your laboratory");
    return `<tr><td style="padding:8px 6px;border-top:1px solid #eee;vertical-align:top">${who}</td>`
      + `<td style="padding:8px 6px;border-top:1px solid #eee;vertical-align:top">${lab}</td>`
      + `<td style="padding:8px 6px;border-top:1px solid #eee;vertical-align:top">${esc(i.seatLabel)}</td>`
      + `<td style="padding:8px 6px;border-top:1px solid #eee;vertical-align:top;white-space:nowrap">${i.daysAgo} days ago</td></tr>`;
  }).join("");
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#28251D">
      <h2 style="color:#01696F;margin-bottom:16px">${n === 1 ? "An invitation wasn't accepted in 30 days." : `${n} invitations weren't accepted in 30 days.`}</h2>
      <p style="margin-bottom:16px">${n === 1 ? "Its link had stopped working, so we cancelled it and gave the seat back to your lab. It no longer counts against your seats." : "Their links had stopped working, so we cancelled them and gave the seats back to your lab. They no longer count against your seats."}</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px">
        <tr><th style="text-align:left;padding:6px;color:#666;font-weight:600">Invited</th><th style="text-align:left;padding:6px;color:#666;font-weight:600">Lab</th><th style="text-align:left;padding:6px;color:#666;font-weight:600">Seat</th><th style="text-align:left;padding:6px;color:#666;font-weight:600">Sent</th></tr>
        ${rows}
      </table>
      <p style="margin-bottom:20px">To invite someone again, open Members for that lab and send a new invitation.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
      <p style="color:#999;font-size:12px">VeritaAssure® | Veritas Lab Services, LLC</p>
    </div>`;
  return { subject, html };
}

export type UnclaimedRunResult = {
  dryRun: boolean; noMailer: boolean; owners: number; invites: number; pendingWithAccount: number;
  ended: number; emailed: number; errors: number;
  plan: { ownerUserId: number; seatIds: number[]; labIds: (number | null)[] }[];
};

export async function runUnclaimedSeatInvites(opts: { now?: Date; dryRun?: boolean } = {}): Promise<UnclaimedRunResult> {
  const sqlite = (db as any).$client;
  const now = opts.now ?? new Date();
  const dryRun = !!opts.dryRun;
  const { invites, pendingWithAccount } = unclaimedInvites(sqlite, now);
  const byOwner = new Map<number, UnclaimedInvite[]>();
  for (const i of invites) byOwner.set(i.ownerUserId, [...(byOwner.get(i.ownerUserId) || []), i]);
  const plan = [...byOwner.entries()].map(([ownerUserId, list]) => ({
    ownerUserId, seatIds: list.map((i) => i.seatId), labIds: [...new Set(list.map((i) => i.labId))],
  }));
  const result: UnclaimedRunResult = { dryRun, noMailer: false, owners: byOwner.size, invites: invites.length, pendingWithAccount, ended: 0, emailed: 0, errors: 0, plan };
  if (dryRun || invites.length === 0) return result;
  const mailer = await getMailer();
  if (!mailer) { result.noMailer = true; return result; }

  const frontendUrl = process.env.FRONTEND_URL || "https://www.veritaslabservices.com";
  const end = sqlite.prepare("UPDATE user_seats SET status = 'deactivated' WHERE id = ? AND status = 'pending' AND seat_user_id IS NULL");
  const audit = sqlite.prepare(
    `INSERT INTO audit_log (user_id, owner_user_id, module, action, entity_type, entity_id, entity_label, before_json, after_json)
     VALUES (0, ?, 'account', 'seat_invite_unclaimed_ended', 'user_seat', ?, ?, ?, ?)`
  );
  for (const [ownerUserId, list] of byOwner) {
    const owner = sqlite.prepare("SELECT email FROM users WHERE id = ?").get(ownerUserId) as { email: string | null } | undefined;
    if (!owner?.email) { result.errors++; console.error(`[unclaimed-seats] owner ${ownerUserId} has no email; ${list.length} invitation(s) left pending`); continue; }
    const mail = buildUnclaimedEmail(list, frontendUrl);
    try {
      await mailer({ to: owner.email, subject: mail.subject, html: mail.html });
    } catch (err: any) {
      result.errors++;
      console.error(`[unclaimed-seats] email to owner ${ownerUserId} failed (${list.length} invitation(s) left pending): ${err?.message || err}`);
      continue;
    }
    result.emailed++;
    const at = new Date().toISOString();
    sqlite.transaction(() => {
      for (const i of list) {
        if (end.run(i.seatId).changes !== 1) continue; // accepted or changed since it was read
        result.ended++;
        audit.run(ownerUserId, String(i.seatId), `lab ${i.labId ?? "none"}`,
          JSON.stringify({ status: "pending", days_since_invited: i.daysAgo }),
          JSON.stringify({ status: "deactivated", reason: `not accepted in ${UNCLAIMED_INVITE_DAYS} days`, owner_notified_at: at }));
      }
    })();
  }
  return result;
}
