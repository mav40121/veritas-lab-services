// server/memberAccountControl.ts
//
// Which accounts a lab's owner or admin may correct (BUG-194, 2026-11-24). A sign-in email, a display name and two-factor belong
// to the person, not to one lab. A lab corrects an account only when all of these hold, read from the database at the time:
//   - it isn't a Veritas login, its owner owns no lab, and it holds no system (organization) role;
//   - everywhere it works (an active membership or seat) is a lab the person acting owns or manages;
//   - for the sign-in email and the name, the account was made by accepting an invitation to one of those labs.
// Anyone else changes their own, or asks Veritas Lab Services, who confirms who they are first.
import { isVeritasLogin } from "./labSeats";

export type AccountChange = "email" | "name" | "two_factor";

const at = (v: unknown): number => {
  const s = String(v ?? "");
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : s.replace(" ", "T") + "Z");
};

// Labs the person acting owns or manages: owner of record, an active owner or admin membership, or an active organization
// owner or admin of the lab's organization.
const MANAGED = `(l.owner_user_id = @actor
  OR EXISTS (SELECT 1 FROM lab_members am WHERE am.lab_id = l.id AND am.user_id = @actor AND am.status = 'active' AND am.role IN ('owner','admin'))
  OR EXISTS (SELECT 1 FROM organization_members om WHERE om.organization_id = l.organization_id AND om.user_id = @actor AND om.status = 'active' AND om.org_role IN ('org_owner','org_admin')))`;

export function accountChangeRefusal(sqlite: any, o: { actorUserId: number; targetUserId: number; change: AccountChange }): { status: number; body: { error: string; code: string } } | null {
  const what = o.change === "email" ? "sign-in email" : o.change === "name" ? "name" : "two-factor sign-in";
  const refuse = { status: 409, body: { code: "ACCOUNT_NOT_LABS", error: `This person's account isn't your lab's alone, so your lab can't change its ${what}. They can do it in Account Settings, or ask Veritas Lab Services.` } };
  const target = sqlite.prepare("SELECT id, email, created_at, COALESCE(vls_support, 0) AS support FROM users WHERE id = ?").get(o.targetUserId) as any;
  if (!target) return refuse;
  if (Number(target.support) === 1 || isVeritasLogin(target.email)) return refuse;
  const args = { actor: o.actorUserId, target: o.targetUserId };
  if (sqlite.prepare("SELECT 1 FROM labs WHERE owner_user_id = @target LIMIT 1").get({ target: args.target })) return refuse;
  if (sqlite.prepare("SELECT 1 FROM organization_members WHERE user_id = @target AND status = 'active' LIMIT 1").get({ target: args.target })) return refuse;
  const elsewhere = sqlite.prepare(
    `SELECT 1 FROM labs l
      WHERE (EXISTS (SELECT 1 FROM lab_members m WHERE m.lab_id = l.id AND m.user_id = @target AND m.status = 'active')
          OR EXISTS (SELECT 1 FROM user_seats s WHERE s.lab_id = l.id AND s.seat_user_id = @target AND s.status = 'active'))
        AND NOT ${MANAGED} LIMIT 1`
  ).get(args);
  if (elsewhere) return refuse;
  if (o.change === "two_factor") return null;
  const made = at(target.created_at);
  const invites = sqlite.prepare(`SELECT s.invited_at FROM user_seats s JOIN labs l ON l.id = s.lab_id WHERE s.seat_user_id = @target AND s.status = 'active' AND ${MANAGED}`).all(args) as any[];
  return invites.some((i) => Number.isFinite(made) && made >= at(i.invited_at)) ? null : refuse;
}

/** The note to the old address when a lab corrects someone's sign-in email. */
export function emailChangedNotice(o: { name: string | null; oldEmail: string; newEmail: string; labName: string }): { subject: string; html: string } {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    subject: "Your VeritaAssure® sign-in email was changed",
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px"><p style="font-size:15px;color:#1B2B2B;line-height:1.6">${o.name ? `Hi ${esc(o.name)},` : "Hello,"}</p><p style="font-size:15px;color:#1B2B2B;line-height:1.6">${esc(o.labName)} changed the email you sign in with on VeritaAssure® from ${esc(o.oldEmail)} to ${esc(o.newEmail)}. Use the new address next time you sign in.</p><p style="font-size:15px;color:#1B2B2B;line-height:1.6">If you didn't expect this, reply to this email and we will look into it.</p><p style="color:#999;font-size:12px">VeritaAssure® | Veritas Lab Services, LLC | veritaslabservices.com</p></div>`,
  };
}
