// server/certificateReminders.ts
//
// BUG-021 (2026-10-10, Michael Q62 = 1): VeritaLab certificate renewal reminders never sent. The page says
// "Automated email reminders fire at 9 months, 6 months, ...", but the only sender was the admin-only
// POST /api/veritalab/check-reminders and nothing called it (production 2026-10-09: 30 scheduled, 0 sent,
// 11 past due). This module is the one sender, used by that endpoint and by the nightly job in server/index.ts.
//
// Rules:
//   - Per certificate, only the NEWEST due stage is emailed (9month, 6month, 3month, 30day, expired). Older
//     due stages are marked skipped (skipped_at, skip_reason) and never sent, so a lab never gets a burst of
//     stale reminders when sending is switched on or after an outage.
//   - The email goes to the certificate's lab owner (labs.owner_user_id), falling back to the reminder's
//     user for legacy certificates with no lab; the lab name and the lab-scoped VeritaLab link come from the
//     lab row.
//   - A reminder is marked sent only after the mail provider accepts it; a failure stays unsent and retries
//     on the next run.
//   - dryRun returns the plan (what would be sent and skipped) and writes nothing.
import { db } from "./db";

export type ReminderMail = { to: string; subject: string; html: string };
export type ReminderMailer = (m: ReminderMail) => Promise<void>;

let mailerOverride: ReminderMailer | null = null;
/** Test hook: capture mail instead of sending it. */
export function setCertificateReminderMailerForTest(m: ReminderMailer | null) { mailerOverride = m; }

async function getMailer(): Promise<ReminderMailer | null> {
  if (mailerOverride) return mailerOverride;
  if (!process.env.RESEND_API_KEY) return null;
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  return async (m) => {
    const r: any = await resend.emails.send({ from: "VeritaAssure™ <info@veritaslabservices.com>", to: m.to, subject: m.subject, html: m.html });
    if (r?.error) throw new Error(r.error.message || String(r.error));
  };
}

const STAGE_ORDER: Record<string, number> = { "9month": 1, "6month": 2, "3month": 3, "30day": 4, expired: 5 };
const STAGE_LABEL: Record<string, string> = {
  "9month": "9-Month Reminder", "6month": "6-Month Reminder", "3month": "3-Month Reminder", "30day": "30-Day Reminder", expired: "Expiration Notice",
};
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
const usDate = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "Unknown";
};

export function buildReminderEmail(r: { reminder_type: string; cert_name: string; cert_number: string | null; expiration_date: string | null; lab_name: string | null; lab_id: number | null }, today: string) {
  const exp = usDate(r.expiration_date);
  const expired = r.reminder_type === "expired" || (!!r.expiration_date && String(r.expiration_date).slice(0, 10) < today);
  const label = STAGE_LABEL[r.reminder_type] || r.reminder_type;
  const subject = expired ? `${label}: ${r.cert_name} expired ${exp}` : `${label}: ${r.cert_name} expires ${exp}`;
  const heading = expired ? `Your ${esc(r.cert_name)} expired on ${exp}.` : `Your ${esc(r.cert_name)} expires on ${exp}.`;
  const link = r.lab_id ? `https://www.veritaslabservices.com/labs/${r.lab_id}/veritalab-app` : "https://www.veritaslabservices.com/veritalab-app";
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#01696F;margin-bottom:16px">${heading}</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr><td style="padding:6px 0;color:#666">Certificate:</td><td style="padding:6px 0;font-weight:600">${esc(r.cert_name)}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Number:</td><td style="padding:6px 0">${esc(r.cert_number || "N/A")}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Expiration:</td><td style="padding:6px 0;font-weight:600;color:#A12C7B">${exp}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Lab:</td><td style="padding:6px 0">${esc(r.lab_name || "Your laboratory")}</td></tr>
      </table>
      <p style="margin-bottom:20px">Open VeritaLab™ to review the certificate and upload renewal documentation.</p>
      <a href="${link}" style="display:inline-block;background:#01696F;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Open VeritaLab™</a>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
      <p style="color:#999;font-size:12px">VeritaAssure™ | Veritas Lab Services, LLC</p>
    </div>`;
  return { subject, html };
}

export type ReminderPlanRow = { reminder_id: number; certificate_id: number; lab_id: number | null; stage: string; scheduled_date: string; to: string | null; subject: string };
export type ReminderRunResult = { today: string; dryRun: boolean; due: number; toSend: ReminderPlanRow[]; skipped: { reminder_id: number; certificate_id: number; stage: string; scheduled_date: string }[]; sent: number; errors: number; noMailer: boolean };

export async function runCertificateReminders(opts: { today?: string; dryRun?: boolean } = {}): Promise<ReminderRunResult> {
  const sqlite = (db as any).$client;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const dryRun = !!opts.dryRun;
  const due = sqlite.prepare(`
    SELECT r.id, r.certificate_id, r.user_id, r.reminder_type, r.scheduled_date,
           c.cert_name, c.cert_number, c.expiration_date, c.lab_id, l.lab_name, l.owner_user_id
      FROM lab_certificate_reminders r
      JOIN lab_certificates c ON c.id = r.certificate_id
      LEFT JOIN labs l ON l.id = c.lab_id
     WHERE r.scheduled_date <= ? AND r.is_sent = 0 AND r.skipped_at IS NULL AND c.is_active = 1
  `).all(today) as any[];
  const byCert = new Map<number, any[]>();
  for (const r of due) (byCert.get(r.certificate_id) ?? byCert.set(r.certificate_id, []).get(r.certificate_id)!).push(r);
  const toSend: any[] = [], skipped: any[] = [];
  for (const rows of byCert.values()) {
    rows.sort((a, b) => (a.scheduled_date === b.scheduled_date ? (STAGE_ORDER[a.reminder_type] ?? 0) - (STAGE_ORDER[b.reminder_type] ?? 0) : a.scheduled_date < b.scheduled_date ? -1 : 1));
    const newest = rows[rows.length - 1];
    toSend.push(newest);
    for (const r of rows.slice(0, -1)) skipped.push(r);
  }
  const emailOf = sqlite.prepare("SELECT email FROM users WHERE id = ?");
  const plan: ReminderPlanRow[] = toSend.map((r) => {
    const to = (emailOf.get(r.owner_user_id ?? r.user_id) as any)?.email ?? null;
    return { reminder_id: r.id, certificate_id: r.certificate_id, lab_id: r.lab_id ?? null, stage: r.reminder_type, scheduled_date: r.scheduled_date, to, subject: buildReminderEmail(r, today).subject };
  });
  const result: ReminderRunResult = {
    today, dryRun, due: due.length, toSend: plan,
    skipped: skipped.map((r) => ({ reminder_id: r.id, certificate_id: r.certificate_id, stage: r.reminder_type, scheduled_date: r.scheduled_date })),
    sent: 0, errors: 0, noMailer: false,
  };
  if (dryRun) return result;
  const now = new Date().toISOString();
  const skip = sqlite.prepare("UPDATE lab_certificate_reminders SET skipped_at = ?, skip_reason = ? WHERE id = ? AND is_sent = 0");
  for (const r of skipped) skip.run(now, `superseded by the ${r.reminder_type === "expired" ? "expiration" : "later"} notice dated ${toSend.find((t) => t.certificate_id === r.certificate_id)?.scheduled_date}`, r.id);
  const mailer = toSend.length ? await getMailer() : null;
  if (!mailer) { result.noMailer = toSend.length > 0; return result; }
  const markSent = sqlite.prepare("UPDATE lab_certificate_reminders SET is_sent = 1, sent_at = ? WHERE id = ?");
  for (let i = 0; i < toSend.length; i++) {
    const r = toSend[i], p = plan[i];
    if (!p.to) { result.errors++; continue; }
    try {
      const { subject, html } = buildReminderEmail(r, today);
      await mailer({ to: p.to, subject, html });
      markSent.run(new Date().toISOString(), r.id);
      result.sent++;
    } catch (err: any) {
      console.error("[cert-reminders] send failed:", r.id, err?.message || err);
      result.errors++;
    }
  }
  return result;
}
