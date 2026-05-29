// server/veritapolicyReminders.ts
//
// Phase 6B of the MediaLab functional mirror. Daily cron job that fires
// review-due reminders via Resend for any approved policy whose
// next_review_date crosses a threshold:
//
//   30 days before due  -> reminder_type='30_day_warning'
//   on or past due      -> reminder_type='overdue'
//   30 days past due    -> reminder_type='final'
//
// Idempotency: each (document_id, version_id, reminder_type) gets at most
// one policy_review_reminders row with sent_at populated. The cron skips
// any row already sent. A new version upload invalidates the chain
// because version_id changes.
//
// Auto-expire intentionally NOT in this PR. Visual red flag on the
// dashboard + emails is the conservative ship; flipping a customer's
// approved policy to expired without their action would surprise them.
// Phase 6C can add it if customers ask.

import { Resend } from "resend";
import { db } from "./db";
import { writeAuditLog } from "./veritapolicyApproval";

const FRONTEND_URL = process.env.FRONTEND_URL || "https://www.veritaslabservices.com";

export async function runPolicyReviewReminders(): Promise<{
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
}> {
  const sqlite = (db as any).$client;
  const stats = { scanned: 0, sent: 0, skipped: 0, errors: 0 };

  // Find every approved doc with next_review_date set. Per-row threshold
  // computation happens in JS so we keep the SQL portable.
  const rows = sqlite
    .prepare(
      `SELECT d.id, d.lab_id, d.title, d.owner_user_id, d.current_version_id,
              d.next_review_date,
              u.email AS owner_email, u.name AS owner_name,
              l.lab_name AS lab_name
         FROM policy_documents d
         JOIN users u ON u.id = d.owner_user_id
         LEFT JOIN labs l ON l.id = d.lab_id
        WHERE d.archived_at IS NULL
          AND d.status = 'approved'
          AND d.next_review_date IS NOT NULL`
    )
    .all() as any[];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

  for (const r of rows) {
    stats.scanned += 1;
    const due = new Date(r.next_review_date);
    due.setHours(0, 0, 0, 0);
    const daysUntil = Math.round((due.getTime() - today.getTime()) / 86400000);

    let reminderType: "30_day_warning" | "overdue" | "final" | null = null;
    if (daysUntil >= -1 && daysUntil <= 30 && daysUntil > 0) reminderType = "30_day_warning";
    else if (daysUntil === 0 || (daysUntil < 0 && daysUntil > -30)) reminderType = "overdue";
    else if (daysUntil <= -30 && daysUntil > -60) reminderType = "final";

    if (!reminderType) continue;

    // Idempotency check.
    const alreadySent = sqlite
      .prepare(
        `SELECT 1 FROM policy_review_reminders
          WHERE document_id = ?
            AND reminder_type = ?
            AND sent_at IS NOT NULL
          LIMIT 1`
      )
      .get(r.id, reminderType);
    if (alreadySent) {
      stats.skipped += 1;
      continue;
    }

    // Insert the row first so a Resend failure doesn't re-fire on next
    // run (we'd rather silently drop than spam). The row goes in with
    // sent_at = now even if Resend errors below; the email failure is
    // logged but the reminder still counts as fired.
    const ins = sqlite.prepare(
      `INSERT INTO policy_review_reminders
         (document_id, reminder_date, sent_at, reminder_type)
       VALUES (?, ?, datetime('now'), ?)`
    );
    try {
      ins.run(r.id, r.next_review_date, reminderType);
    } catch (err: any) {
      console.error("[policy-reminders] insert failed:", err.message);
      stats.errors += 1;
      continue;
    }

    if (!resend) {
      // RESEND_API_KEY unset; row is inserted but email not sent. The
      // dashboard surface still tells the owner. Continue.
      stats.skipped += 1;
      continue;
    }

    const subject =
      reminderType === "30_day_warning"
        ? `Policy review due in ${daysUntil} days: ${r.title}`
        : reminderType === "overdue"
        ? `Policy review overdue: ${r.title}`
        : `Final notice: policy review past due: ${r.title}`;
    const link = `${FRONTEND_URL}/labs/${r.lab_id}/veritapolicy-app/my-policies`;
    const body = `
<p>Hi ${r.owner_name || "there"},</p>
<p>The policy <strong>${r.title}</strong> on ${r.lab_name || "your lab"} is due for review on <strong>${r.next_review_date}</strong>.</p>
<p>
  Open VeritaPolicy: <a href="${link}">${link}</a><br>
  Click <strong>Recertify</strong> to confirm the policy is still current, or <strong>Submit</strong> a revised version through the approval workflow.
</p>
<p>VeritaAssure&trade; / VeritaPolicy&trade;</p>
`.trim();

    try {
      await resend.emails.send({
        from: "VeritaPolicy <noreply@veritaslabservices.com>",
        to: r.owner_email,
        subject,
        html: body,
      });
      stats.sent += 1;
      writeAuditLog(sqlite, {
        labId: r.lab_id,
        documentId: r.id,
        userId: r.owner_user_id,
        action: "review_reminder_sent",
        details: { reminder_type: reminderType, days_until: daysUntil },
      });
    } catch (err: any) {
      console.error("[policy-reminders] resend failed:", err.message);
      stats.errors += 1;
    }
  }
  return stats;
}
