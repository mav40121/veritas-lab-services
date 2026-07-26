// server/veritatrackReminders.ts
//
// Nightly VeritaTrack due-date reminders (2026-07-26, Longstreth). For each lab
// that has enabled reminders, email the configured recipient list a digest of
// tasks that are approaching or overdue their next-due date. Approaching tasks
// fire once on a fixed ladder; overdue tasks repeat on the lab's cadence (his
// every-2-days) until signed off. Mirrors server/audit.ts runFindingReminders:
// pull Resend at call time, dedup via a log table, log-and-skip when unset.
//
// Due dates reuse veritatrack.ts nextDue()/daysUntilDateOnly() so the reminder
// date always equals the date shown on the VeritaTrack screen (no drift).
import { db } from "./db";
import { nextDue, daysUntilDateOnly } from "./veritatrack";

// Approaching-reminder ladder (days before due). Filtered to <= the lab's
// lead_days at decision time, so a 14-day lead uses [14,7,3,1].
export const APPROACHING_LADDER = [30, 14, 7, 3, 1] as const;

export interface ReminderDecision {
  notify: boolean;
  kind: string | null; // 'approaching-<N>' | 'overdue' | null
}

/**
 * Pure decision: should this task be reminded today, and with what kind?
 * daysUntilDue: nextDue - today, or null when the task has never been signed off
 * (treated as overdue). Exported so scripts/verify-veritatrack-reminders.mts can
 * exercise the ladder, the lead window, the overdue cadence, and the dedup.
 */
export function decideTaskReminder(opts: {
  daysUntilDue: number | null;
  leadDays: number;
  overdueCadenceDays: number;
  approachingKindsSent: Set<string>;
  daysSinceLastOverdue: number | null;
}): ReminderDecision {
  const { daysUntilDue, leadDays, overdueCadenceDays, approachingKindsSent, daysSinceLastOverdue } = opts;

  // Overdue (or never signed off): repeat on the cadence.
  if (daysUntilDue === null || daysUntilDue <= 0) {
    if (daysSinceLastOverdue === null) return { notify: true, kind: "overdue" };
    return { notify: daysSinceLastOverdue >= overdueCadenceDays, kind: "overdue" };
  }

  // Approaching: only on a ladder step inside the lead window, once each.
  if (daysUntilDue > leadDays) return { notify: false, kind: null };
  const steps = APPROACHING_LADDER.filter(d => d <= leadDays);
  if (!steps.includes(daysUntilDue as any)) return { notify: false, kind: null };
  const kind = `approaching-${daysUntilDue}`;
  return { notify: !approachingKindsSent.has(kind), kind };
}

export interface VeritaTrackReminderSummary {
  labs: number; tasksChecked: number; notifiable: number; emailsSent: number; skipped: number; errors: number;
}

export async function runVeritaTrackReminders(): Promise<VeritaTrackReminderSummary> {
  const summary: VeritaTrackReminderSummary = { labs: 0, tasksChecked: 0, notifiable: 0, emailsSent: 0, skipped: 0, errors: 0 };
  const sqlite = (db as any).$client;
  const today = new Date().toISOString().slice(0, 10);

  let resend: any = null;
  try {
    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import("resend");
      resend = new Resend(process.env.RESEND_API_KEY);
    }
  } catch (err: any) {
    console.error("[veritatrack-reminder] Resend init failed:", err?.message || err);
  }

  let configs: any[] = [];
  try {
    configs = sqlite.prepare("SELECT * FROM veritatrack_reminder_config WHERE enabled = 1").all() as any[];
  } catch (err: any) {
    console.error("[veritatrack-reminder] Query failed:", err?.message || err);
    return summary;
  }

  for (const cfg of configs) {
    summary.labs++;
    // Recipients: the configured list, else fall back to the lab owner so it is
    // never silently off.
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

    const tasks = sqlite.prepare("SELECT * FROM veritatrack_tasks WHERE lab_id = ? AND active = 1").all(cfg.lab_id) as any[];
    const notifiable: { task: any; kind: string; dueDate: string | null; days: number | null }[] = [];

    for (const t of tasks) {
      summary.tasksChecked++;
      const last = sqlite.prepare(
        "SELECT completed_date FROM veritatrack_signoffs WHERE task_id = ? ORDER BY completed_date DESC LIMIT 1"
      ).get(t.id) as any;
      const due = last ? nextDue(last.completed_date, t.frequency_months) : null;
      const days = due ? daysUntilDateOnly(due) : null;

      const approachingKindsSent = new Set<string>(
        (sqlite.prepare(
          "SELECT DISTINCT reminder_kind FROM veritatrack_reminder_log WHERE task_id = ? AND reminder_kind LIKE 'approaching-%' AND due_date IS ?"
        ).all(t.id, due) as any[]).map(r => r.reminder_kind)
      );
      const lastOverdueRow = sqlite.prepare(
        "SELECT MAX(sent_on) AS s FROM veritatrack_reminder_log WHERE task_id = ? AND reminder_kind = 'overdue'"
      ).get(t.id) as any;
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
        notifiable.push({ task: t, kind: decision.kind, dueDate: due, days });
      }
    }

    if (notifiable.length === 0) continue;
    summary.notifiable += notifiable.length;

    if (!resend) { summary.skipped++; continue; } // configured labs but no mailer: don't log, retry when set

    const lines = notifiable.map(n => {
      const when = n.days === null ? "never completed"
        : n.days <= 0 ? `overdue by ${Math.abs(n.days)} day${Math.abs(n.days) === 1 ? "" : "s"} (due ${n.dueDate})`
        : `due in ${n.days} day${n.days === 1 ? "" : "s"} (${n.dueDate})`;
      const instr = n.task.instrument ? ` [${n.task.instrument}]` : "";
      return `- ${n.task.name}${instr}: ${when}`;
    });
    const overdueN = notifiable.filter(n => n.days === null || (n.days as number) <= 0).length;
    const subject = `VeritaTrack reminder: ${notifiable.length} task${notifiable.length === 1 ? "" : "s"} due or overdue at ${labLabel}`;
    const text = [
      `Hello,`,
      ``,
      `This is an automated VeritaTrack reminder for ${labLabel}.`,
      ``,
      `${notifiable.length} task${notifiable.length === 1 ? "" : "s"} need attention (${overdueN} overdue):`,
      ``,
      ...lines,
      ``,
      `Sign in to VeritaAssure and record the sign-off to clear these reminders.`,
      ``,
      `Sent automatically by VeritaTrack from VeritaAssure. To change who receives these or turn them off, update the reminder settings in VeritaTrack.`,
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
        "INSERT INTO veritatrack_reminder_log (task_id, lab_id, reminder_kind, due_date, sent_on, recipient_email) VALUES (?,?,?,?,?,?)"
      );
      for (const n of notifiable) insert.run(n.task.id, cfg.lab_id, n.kind, n.dueDate, today, recipientList);
    } catch (err: any) {
      summary.errors++;
      console.error(`[veritatrack-reminder] send failed for lab ${cfg.lab_id}:`, err?.message || err);
    }
  }

  return summary;
}
