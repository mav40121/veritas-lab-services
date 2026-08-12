// server/ptReminders.ts
//
// MLC-2b (2026-08-11): nightly VeritaPT submission-deadline reminders. For each
// lab that has enabled reminders (pt_reminder_config.enabled = 1), email the
// configured recipients a digest of PENDING PT events approaching or overdue
// their submission_due_date. A missed PT submission is an unsuccessful
// participation under 42 CFR 493.803, so this is the belt to the in-app banner.
//
// Mirrors server/veritatrackReminders.ts exactly: reuses decideTaskReminder
// (approaching ladder + lead window + overdue cadence) and daysUntilDateOnly so
// the reminder date equals the date shown on the VeritaPT screen (no drift).
// Pulls Resend at call time, dedups via pt_reminder_log, log-and-skip when the
// mailer is unset. The reminder trigger is submission_due_date (a fixed program
// deadline), NOT a recurring next-due, so no nextDue() computation is needed.
import { db } from "./db";
import { decideTaskReminder } from "./veritatrackReminders";
import { daysUntilDateOnly } from "./veritatrack";

export interface PtReminderSummary {
  labs: number; eventsChecked: number; notifiable: number; emailsSent: number; skipped: number; errors: number;
}

export async function runPtReminders(): Promise<PtReminderSummary> {
  const summary: PtReminderSummary = { labs: 0, eventsChecked: 0, notifiable: 0, emailsSent: 0, skipped: 0, errors: 0 };
  const sqlite = (db as any).$client;
  const today = new Date().toISOString().slice(0, 10);

  let resend: any = null;
  try {
    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import("resend");
      resend = new Resend(process.env.RESEND_API_KEY);
    }
  } catch (err: any) {
    console.error("[pt-reminder] Resend init failed:", err?.message || err);
  }

  let configs: any[] = [];
  try {
    configs = sqlite.prepare("SELECT * FROM pt_reminder_config WHERE enabled = 1").all() as any[];
  } catch (err: any) {
    console.error("[pt-reminder] Query failed:", err?.message || err);
    return summary;
  }

  for (const cfg of configs) {
    summary.labs++;
    // Recipients: the configured list, else the lab owner so it is never silently off.
    let recipients: { email: string; name?: string }[] = [];
    try { recipients = JSON.parse(cfg.recipients_json || "[]"); } catch { recipients = []; }
    recipients = recipients.filter(r => r && typeof r.email === "string" && r.email.includes("@"));
    if (recipients.length === 0) {
      const owner = sqlite.prepare(
        "SELECT u.email, u.name FROM labs l JOIN users u ON u.id = l.owner_user_id WHERE l.id = ?"
      ).get(cfg.lab_id) as any;
      if (owner?.email) recipients = [{ email: owner.email, name: owner.name }];
    }
    if (recipients.length === 0) { summary.skipped++; continue; }

    const lab = sqlite.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(cfg.lab_id) as any;
    const labLabel = lab?.lab_name || lab?.clia_number || "your lab";

    // Only PENDING events with a submission deadline are live risks; once the
    // result is graded (pass/fail) the deadline has been met and never reminds.
    const events = sqlite.prepare(
      "SELECT * FROM pt_events WHERE lab_id = ? AND pass_fail = 'pending' AND submission_due_date IS NOT NULL AND TRIM(submission_due_date) <> ''"
    ).all(cfg.lab_id) as any[];
    const notifiable: { event: any; kind: string; dueDate: string; days: number }[] = [];

    for (const ev of events) {
      summary.eventsChecked++;
      const due = ev.submission_due_date;
      const days = daysUntilDateOnly(due);

      const approachingKindsSent = new Set<string>(
        (sqlite.prepare(
          "SELECT DISTINCT reminder_kind FROM pt_reminder_log WHERE event_id = ? AND reminder_kind LIKE 'approaching-%' AND due_date IS ?"
        ).all(ev.id, due) as any[]).map(r => r.reminder_kind)
      );
      const lastOverdueRow = sqlite.prepare(
        "SELECT MAX(sent_on) AS s FROM pt_reminder_log WHERE event_id = ? AND reminder_kind = 'overdue'"
      ).get(ev.id) as any;
      const daysSinceLastOverdue = lastOverdueRow?.s
        ? Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(String(lastOverdueRow.s).slice(0, 10) + "T00:00:00Z")) / 86400000)
        : null;

      const decision = decideTaskReminder({
        daysUntilDue: days,
        leadDays: cfg.lead_days,
        overdueCadenceDays: cfg.overdue_cadence_days,
        approachingKindsSent,
        daysSinceLastOverdue,
      });
      if (decision.notify && decision.kind) {
        notifiable.push({ event: ev, kind: decision.kind, dueDate: due, days });
      }
    }

    if (notifiable.length === 0) continue;
    summary.notifiable += notifiable.length;

    if (!resend) { summary.skipped++; continue; } // configured but no mailer: don't log, retry when set

    const lines = notifiable.map(n => {
      const when = n.days <= 0
        ? `overdue by ${Math.abs(n.days)} day${Math.abs(n.days) === 1 ? "" : "s"} (due ${n.dueDate})`
        : `due in ${n.days} day${n.days === 1 ? "" : "s"} (${n.dueDate})`;
      const evName = n.event.event_name ? ` [${n.event.event_name}]` : "";
      return `- ${n.event.analyte}${evName}: ${when}`;
    });
    const overdueN = notifiable.filter(n => n.days <= 0).length;
    const subject = `VeritaPT reminder: ${notifiable.length} PT submission${notifiable.length === 1 ? "" : "s"} due or overdue at ${labLabel}`;
    const text = [
      `Hello,`,
      ``,
      `This is an automated VeritaPT reminder for ${labLabel}.`,
      ``,
      `${notifiable.length} proficiency-testing submission${notifiable.length === 1 ? "" : "s"} need attention (${overdueN} overdue):`,
      ``,
      ...lines,
      ``,
      `A missed PT submission is an unsuccessful participation under 42 CFR 493.803. Submit your results to the program, then record the event in VeritaAssure to clear these reminders.`,
      ``,
      `Sent automatically by VeritaPT from VeritaAssure. To change who receives these or turn them off, update the reminder settings in VeritaPT.`,
    ].join("\n");

    try {
      await resend.emails.send({
        from: "VeritaAssure <info@veritaslabservices.com>",
        to: recipients.map(r => r.email),
        subject,
        text,
      });
      summary.emailsSent++;
      const recipientList = recipients.map(r => r.email).join(",");
      const insert = sqlite.prepare(
        "INSERT INTO pt_reminder_log (event_id, lab_id, reminder_kind, due_date, sent_on, recipient_email) VALUES (?,?,?,?,?,?)"
      );
      for (const n of notifiable) insert.run(n.event.id, cfg.lab_id, n.kind, n.dueDate, today, recipientList);
    } catch (err: any) {
      summary.errors++;
      console.error(`[pt-reminder] send failed for lab ${cfg.lab_id}:`, err?.message || err);
    }
  }

  return summary;
}
