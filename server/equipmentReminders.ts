// server/equipmentReminders.ts
//
// MLC-1 Phase 2 (2026-08-11): nightly equipment maintenance-due reminders. For
// each lab that has enabled reminders (equipment_reminder_config.enabled = 1),
// email the configured recipients a digest of instruments whose next-due date is
// approaching or overdue. Instrument calibration / preventive maintenance
// supports CLIA 42 CFR 493.1254 and competency Element 4.
//
// Mirrors server/ptReminders.ts / veritatrackReminders.ts: reuses
// decideTaskReminder + daysUntilDateOnly, pulls Resend at call time, dedups via
// equipment_reminder_log, log-and-skip when the mailer is unset.
import { db } from "./db";
import { decideTaskReminder } from "./veritatrackReminders";
import { daysUntilDateOnly } from "./veritatrack";

export interface EquipmentReminderSummary {
  labs: number; equipmentChecked: number; notifiable: number; emailsSent: number; skipped: number; errors: number;
}

export async function runEquipmentReminders(): Promise<EquipmentReminderSummary> {
  const summary: EquipmentReminderSummary = { labs: 0, equipmentChecked: 0, notifiable: 0, emailsSent: 0, skipped: 0, errors: 0 };
  const sqlite = (db as any).$client;
  const today = new Date().toISOString().slice(0, 10);

  let resend: any = null;
  try {
    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import("resend");
      resend = new Resend(process.env.RESEND_API_KEY);
    }
  } catch (err: any) {
    console.error("[equipment-reminder] Resend init failed:", err?.message || err);
  }

  let configs: any[] = [];
  try {
    configs = sqlite.prepare("SELECT * FROM equipment_reminder_config WHERE enabled = 1").all() as any[];
  } catch (err: any) {
    console.error("[equipment-reminder] Query failed:", err?.message || err);
    return summary;
  }

  for (const cfg of configs) {
    summary.labs++;
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

    // Active instruments with a next-due date are the reminder candidates.
    const equipment = sqlite.prepare(
      "SELECT * FROM lab_equipment WHERE lab_id = ? AND status <> 'retired' AND next_due_date IS NOT NULL AND TRIM(next_due_date) <> ''"
    ).all(cfg.lab_id) as any[];
    const notifiable: { eq: any; kind: string; dueDate: string; days: number }[] = [];

    for (const eq of equipment) {
      summary.equipmentChecked++;
      const due = eq.next_due_date;
      const days = daysUntilDateOnly(due);

      const approachingKindsSent = new Set<string>(
        (sqlite.prepare(
          "SELECT DISTINCT reminder_kind FROM equipment_reminder_log WHERE equipment_id = ? AND reminder_kind LIKE 'approaching-%' AND due_date IS ?"
        ).all(eq.id, due) as any[]).map(r => r.reminder_kind)
      );
      const lastOverdueRow = sqlite.prepare(
        "SELECT MAX(sent_on) AS s FROM equipment_reminder_log WHERE equipment_id = ? AND reminder_kind = 'overdue'"
      ).get(eq.id) as any;
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
      if (decision.notify && decision.kind) notifiable.push({ eq, kind: decision.kind, dueDate: due, days });
    }

    if (notifiable.length === 0) continue;
    summary.notifiable += notifiable.length;
    if (!resend) { summary.skipped++; continue; }

    const lines = notifiable.map(n => {
      const when = n.days <= 0
        ? `overdue by ${Math.abs(n.days)} day${Math.abs(n.days) === 1 ? "" : "s"} (due ${n.dueDate})`
        : `due in ${n.days} day${n.days === 1 ? "" : "s"} (${n.dueDate})`;
      const loc = n.eq.location ? ` [${n.eq.location}]` : "";
      return `- ${n.eq.instrument_name}${loc}: ${when}`;
    });
    const overdueN = notifiable.filter(n => n.days <= 0).length;
    const subject = `Equipment maintenance reminder: ${notifiable.length} instrument${notifiable.length === 1 ? "" : "s"} due or overdue at ${labLabel}`;
    const text = [
      `Hello,`,
      ``,
      `This is an automated equipment maintenance reminder for ${labLabel}.`,
      ``,
      `${notifiable.length} instrument${notifiable.length === 1 ? "" : "s"} need attention (${overdueN} overdue):`,
      ``,
      ...lines,
      ``,
      `Instrument calibration and preventive maintenance support CLIA 42 CFR 493.1254 and competency Element 4. Complete the maintenance, then log it in VeritaAssure to clear these reminders.`,
      ``,
      `Sent automatically from VeritaAssure. To change who receives these or turn them off, update the reminder settings on the Equipment Maintenance page.`,
    ].join("\n");

    try {
      await resend.emails.send({ from: "VeritaAssure <info@veritaslabservices.com>", to: recipients.map(r => r.email), subject, text });
      summary.emailsSent++;
      const recipientList = recipients.map(r => r.email).join(",");
      const insert = sqlite.prepare(
        "INSERT INTO equipment_reminder_log (equipment_id, lab_id, reminder_kind, due_date, sent_on, recipient_email) VALUES (?,?,?,?,?,?)"
      );
      for (const n of notifiable) insert.run(n.eq.id, cfg.lab_id, n.kind, n.dueDate, today, recipientList);
    } catch (err: any) {
      summary.errors++;
      console.error(`[equipment-reminder] send failed for lab ${cfg.lab_id}:`, err?.message || err);
    }
  }

  return summary;
}
