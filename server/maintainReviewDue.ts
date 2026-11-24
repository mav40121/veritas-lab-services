// server/maintainReviewDue.ts
//
// The email when a VeritaMaintain monthly review is due (B10, 2026-11-24): on the 5th of the lab's own month, when last month still has a
// record nobody signed, one email to each person who can sign it (the designated medical director, and whoever an active Letter of
// Delegation names for this review). Off for every lab until someone who can edit VeritaMaintain turns it on (maintain_settings.review_due_email).
// Once per month per lab: the period is claimed before anything is sent, and given back only when not one email went out, so the next
// night can try again. Only a person with an active login in the lab is ever emailed, never a Veritas support account (policyNotices.ts
// activeLogin), and the email says counts only, no record and no person's name.
import { labLocalDate, labTimeZoneById, withLabClock } from "./dateLocal";
import { logAudit } from "./audit";
import { activeLogin } from "./policyNotices";
import { readSignMailer } from "./policyReadSign";
import { monthReviewItems } from "./maintainRecordReview";

type Sqlite = any;
const GATE = "equipment_record_review";
export const REVIEW_DUE_DAY = 5;

export interface ReviewDuePerson { userId: number; email: string; name: string | null }

/** Who can sign this lab's review and can be emailed: the medical director and the designees in an active letter, each once. */
export function reviewDueRecipients(sqlite: Sqlite, labId: number): ReviewDuePerson[] {
  const ids: (number | null)[] = [];
  const md = sqlite.prepare(
    `SELECT u.id FROM lab_members lm JOIN users u ON u.id = lm.user_id JOIN labs l ON l.id = lm.lab_id
      WHERE lm.lab_id = ? AND lm.status = 'active' AND l.medical_director_email IS NOT NULL AND TRIM(l.medical_director_email) <> '' AND lower(u.email) = lower(l.medical_director_email) LIMIT 1`
  ).get(labId) as any;
  if (md) ids.push(md.id);
  const letters = sqlite.prepare("SELECT delegate_user_id, delegate_staff_employee_id, responsibilities_json FROM director_delegations WHERE lab_id = ? AND status = 'active'").all(labId) as any[];
  for (const l of letters) {
    let duties: any = {};
    try { duties = JSON.parse(l.responsibilities_json || "{}"); } catch { /* treated as no duties */ }
    if (duties[GATE] !== true) continue;
    if (l.delegate_user_id) ids.push(l.delegate_user_id);
    if (l.delegate_staff_employee_id) {
      // A letter can name a roster person: their Staff login here, or the sign-in linked to their roster entry (recordReviewCapacity's rule).
      const seat = sqlite.prepare("SELECT seat_user_id AS id FROM user_seats WHERE staff_employee_id = ? AND lab_id = ? AND seat_type = 'staff_portal' AND status = 'active' AND seat_user_id IS NOT NULL LIMIT 1").get(l.delegate_staff_employee_id, labId) as any;
      const linked = sqlite.prepare("SELECT login_user_id AS id FROM staff_employees WHERE id = ? AND status = 'active' AND login_user_id IS NOT NULL").get(l.delegate_staff_employee_id) as any;
      ids.push(seat?.id ?? null, linked?.id ?? null);
    }
  }
  const people = new Map<string, ReviewDuePerson>();
  for (const id of ids) {
    const p = activeLogin(sqlite, labId, id);
    if (p) people.set(p.email.toLowerCase(), p);
  }
  return [...people.values()];
}

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;

export function reviewDueEmail(o: { labName: string; period: string; open: number; total: number; link: string }): { subject: string; html: string } {
  const records = (n: number) => `${n} ${n === 1 ? "record" : "records"}`;
  return {
    subject: `${o.labName}: the ${monthName(o.period)} equipment and temperature review is due`,
    html: `<div>The ${esc(monthName(o.period))} review of instrument, temperature and stain log records for ${esc(o.labName)} isn't finished: ${o.open} of ${records(o.total)} ${o.open === 1 ? "is" : "are"} not signed.</div><div><br></div>`
      + `<div>The medical director or designee reviews each record at least monthly and records corrective action for any problem found.</div><div><br></div>`
      + `<div><a href="${esc(o.link)}">Open the monthly record review in VeritaMaintain&trade;</a></div><div><br></div>`
      + `<div>Your lab turned this email on in VeritaMaintain&trade;. It is sent once a month, on the ${REVIEW_DUE_DAY}th, only while last month's review is open.</div>`,
  };
}

export interface ReviewDueRun { labs: number; due: number; emailed: number; skipped: number; errors: number }

/** Every lab that turned it on. `now` is for the test. */
export async function runMaintainReviewDueEmails(sqlite: Sqlite, now: Date = new Date()): Promise<ReviewDueRun> {
  const out: ReviewDueRun = { labs: 0, due: 0, emailed: 0, skipped: 0, errors: 0 };
  const labs = sqlite.prepare(
    `SELECT s.lab_id, s.review_due_last_period, l.lab_name, l.owner_user_id FROM maintain_settings s JOIN labs l ON l.id = s.lab_id WHERE s.review_due_email = 1 AND l.retired_at IS NULL`
  ).all() as any[];
  for (const lab of labs) {
    out.labs += 1;
    const tz = labTimeZoneById(sqlite, lab.lab_id);
    const today = labLocalDate(now.toISOString(), false, tz);
    if (Number(today.slice(8, 10)) < REVIEW_DUE_DAY) continue;
    const [y, m] = today.split("-").map(Number);
    const period = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
    if (lab.review_due_last_period === period) continue;
    const items = withLabClock(tz, () => monthReviewItems(sqlite, lab.lab_id, period));
    const open = items.filter((i: any) => !i.review).length;
    if (!open) continue;
    out.due += 1;
    const people = reviewDueRecipients(sqlite, lab.lab_id);
    if (!people.length) { out.skipped += 1; continue; }
    // Claimed before anything is sent, so a second run or a restart never sends it twice.
    const claim = sqlite.prepare("UPDATE maintain_settings SET review_due_last_period = ? WHERE lab_id = ? AND COALESCE(review_due_last_period, '') <> ?").run(period, lab.lab_id, period);
    if (!claim.changes) continue;
    const link = `${process.env.FRONTEND_URL || "https://www.veritaslabservices.com"}/labs/${lab.lab_id}/equipment-app`;
    let sent = 0, failed = 0;
    for (const p of people) {
      try {
        await readSignMailer.send({ to: p.email, from: "VeritaAssure® <info@veritaslabservices.com>", ...reviewDueEmail({ labName: lab.lab_name || "Your lab", period, open, total: items.length, link }) });
        sent += 1;
      } catch (err: any) {
        failed += 1;
        console.error("[maintain-review-due] send failed:", err?.message || err);
      }
    }
    if (!sent) sqlite.prepare("UPDATE maintain_settings SET review_due_last_period = ? WHERE lab_id = ?").run(lab.review_due_last_period ?? null, lab.lab_id);
    out.emailed += sent;
    out.errors += failed;
    logAudit({
      userId: 0, ownerUserId: lab.owner_user_id, module: "veritamaintain", action: "create", entityType: "monthly_review_due_email", entityId: period,
      entityLabel: `${period}: review due email`, after: { lab_id: lab.lab_id, period, open, total: items.length, sent, failed },
    });
  }
  return out;
}
