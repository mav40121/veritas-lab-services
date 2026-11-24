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
import { labToday, labTimeZoneById } from "./dateLocal";
import { reminderLeadDays } from "../shared/equipmentSchedules";
import { PRIMARY_NAME } from "./equipmentScheduleData";

// B10 (2026-11-24): the digest covers every schedule on an instrument, not only its PM date. A schedule with its own recipients goes to them;
// the rest go to the lab's list (or its owner), as before, so someone on both gets one email per list.
export const equipmentMailer = {
  ready: (): boolean => !!process.env.RESEND_API_KEY,
  send: async (message: { to: string[]; subject: string; text: string }): Promise<void> => {
    const { Resend } = await import("resend");
    const out: any = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: "VeritaAssure <info@veritaslabservices.com>", ...message });
    if (out?.error) throw new Error(out.error.message || "Resend refused the message");
  },
};

export interface EquipmentReminderSummary {
  labs: number; equipmentChecked: number; notifiable: number; emailsSent: number; skipped: number; errors: number;
}

export async function runEquipmentReminders(): Promise<EquipmentReminderSummary> {
  const summary: EquipmentReminderSummary = { labs: 0, equipmentChecked: 0, notifiable: 0, emailsSent: 0, skipped: 0, errors: 0 };
  const sqlite = (db as any).$client;
  // "today" is per lab, set at the top of the lab loop below.

  let configs: any[] = [];
  try {
    configs = sqlite.prepare("SELECT * FROM equipment_reminder_config WHERE enabled = 1").all() as any[];
  } catch (err: any) {
    console.error("[equipment-reminder] Query failed:", err?.message || err);
    return summary;
  }

  for (const cfg of configs) {
    summary.labs++;
    // Per-lab time zone (2026-10-27): this job runs at midnight UTC, when the UTC day is already tomorrow for every US
    // lab, so count from each lab's own calendar day (reminders were going out a day early).
    const today = labToday(labTimeZoneById(sqlite, cfg.lab_id));
    let recipients: { email: string; name?: string }[] = [];
    try { recipients = JSON.parse(cfg.recipients_json || "[]"); } catch { recipients = []; }
    recipients = recipients.filter(r => r && typeof r.email === "string" && r.email.includes("@"));
    if (recipients.length === 0) {
      const owner = sqlite.prepare(
        "SELECT u.email, u.name FROM labs l JOIN users u ON u.id = l.owner_user_id WHERE l.id = ?"
      ).get(cfg.lab_id) as any;
      if (owner?.email) recipients = [{ email: owner.email, name: owner.name }];
    }
    const lab = sqlite.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(cfg.lab_id) as any;
    const labLabel = lab?.lab_name || lab?.clia_number || "your lab";

    // Every schedule with a due date on an active instrument. An instrument with no schedule row yet is reminded by its own PM date.
    const equipment = sqlite.prepare(
      "SELECT * FROM lab_equipment WHERE lab_id = ? AND status <> 'retired'"
    ).all(cfg.lab_id) as any[];
    const schedules = sqlite.prepare("SELECT * FROM equipment_schedules WHERE lab_id = ? AND active = 1").all(cfg.lab_id) as any[];
    interface Due { eq: any; scheduleId: number | null; name: string; frequency: string; intervalDays: number | null; primary: boolean; due: string; to: { email: string }[] }
    const dues: Due[] = [];
    for (const eq of equipment) {
      const own = schedules.filter((x) => x.equipment_id === eq.id);
      const rows = own.some((x) => x.is_primary)
        ? own
        : [{ id: null, name: PRIMARY_NAME, frequency: "every_n_days", interval_days: eq.pm_interval_days, is_primary: 1, next_due_date: eq.next_due_date, recipients_json: "[]" }, ...own];
      for (const x of rows) {
        const due = String(x.next_due_date || "").trim();
        if (!due) continue;
        let to: any[] = [];
        try { to = JSON.parse(x.recipients_json || "[]"); } catch { to = []; }
        to = Array.isArray(to) ? to.filter((r) => r && typeof r.email === "string" && r.email.includes("@")) : [];
        dues.push({ eq, scheduleId: x.id, name: x.name, frequency: x.frequency, intervalDays: x.interval_days, primary: !!x.is_primary, due, to });
      }
    }
    interface Notice extends Due { kind: string; days: number }
    const notifiable: Notice[] = [];

    for (const d of dues) {
      summary.equipmentChecked++;
      const days = daysUntilDateOnly(d.due, today);
      // A reminder sent before schedules existed has no schedule on it: it was for the instrument's first one.
      const mine = d.primary ? "(schedule_id IS NULL OR schedule_id IS ?)" : "schedule_id IS ?";
      const approachingKindsSent = new Set<string>(
        (sqlite.prepare(
          `SELECT DISTINCT reminder_kind FROM equipment_reminder_log WHERE equipment_id = ? AND ${mine} AND reminder_kind LIKE 'approaching-%' AND due_date IS ?`
        ).all(d.eq.id, d.scheduleId, d.due) as any[]).map(r => r.reminder_kind)
      );
      const lastOverdueRow = sqlite.prepare(
        `SELECT MAX(sent_on) AS s FROM equipment_reminder_log WHERE equipment_id = ? AND ${mine} AND reminder_kind = 'overdue'`
      ).get(d.eq.id, d.scheduleId) as any;
      const daysSinceLastOverdue = lastOverdueRow?.s
        ? Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(String(lastOverdueRow.s).slice(0, 10) + "T00:00:00Z")) / 86400000)
        : null;

      const decision = decideTaskReminder({
        daysUntilDue: days,
        leadDays: reminderLeadDays(d.frequency, d.intervalDays, d.primary, cfg.lead_days),
        overdueCadenceDays: cfg.overdue_cadence_days,
        approachingKindsSent,
        daysSinceLastOverdue,
      });
      if (decision.notify && decision.kind) notifiable.push({ ...d, kind: decision.kind, days });
    }

    if (notifiable.length === 0) continue;

    // One email per list of people: the lab's own, and each different list a schedule names.
    const groups = new Map<string, { to: string[]; items: Notice[] }>();
    for (const n of notifiable) {
      const to = (n.to.length ? n.to : recipients).map((r) => r.email);
      if (!to.length) { summary.skipped++; continue; }
      const key = [...to].map((e) => e.toLowerCase()).sort().join(",");
      if (!groups.has(key)) groups.set(key, { to, items: [] });
      groups.get(key)!.items.push(n);
    }
    for (const { to, items } of groups.values()) {
      summary.notifiable += items.length;
      if (!equipmentMailer.ready()) { summary.skipped++; continue; }

      const lines = items.map(n => {
        const when = n.days === 0
          ? `due today (${n.due})`
          : n.days < 0
          ? `overdue by ${Math.abs(n.days)} day${Math.abs(n.days) === 1 ? "" : "s"} (due ${n.due})`
          : `due in ${n.days} day${n.days === 1 ? "" : "s"} (${n.due})`;
        const loc = n.eq.location ? ` [${n.eq.location}]` : "";
        return `- ${n.eq.instrument_name}${loc}, ${n.name}: ${when}`;
      });
      const overdueN = items.filter(n => n.days <= 0).length;
      const instruments = new Set(items.map(n => n.eq.id)).size;
      const subject = `Equipment maintenance reminder: ${instruments} instrument${instruments === 1 ? "" : "s"} due or overdue at ${labLabel}`;
      const text = [
        `Hello,`,
        ``,
        `This is an automated equipment maintenance reminder for ${labLabel}.`,
        ``,
        `${items.length} schedule${items.length === 1 ? "" : "s"} on ${instruments} instrument${instruments === 1 ? "" : "s"} need attention (${overdueN} due today or overdue):`,
        ``,
        ...lines,
        ``,
        `Instrument calibration and preventive maintenance support CLIA 42 CFR 493.1254 and competency Element 4. Complete the maintenance, then log it in VeritaAssure to clear these reminders.`,
        ``,
        `Sent automatically from VeritaAssure. To change who receives these or turn them off, update the reminder settings on the VeritaMaintain™ page.`,
      ].join("\n");

      try {
        await equipmentMailer.send({ to, subject, text });
        summary.emailsSent++;
        const recipientList = to.join(",");
        const insert = sqlite.prepare(
          "INSERT INTO equipment_reminder_log (equipment_id, lab_id, reminder_kind, due_date, sent_on, recipient_email, schedule_id) VALUES (?,?,?,?,?,?,?)"
        );
        for (const n of items) insert.run(n.eq.id, cfg.lab_id, n.kind, n.due, today, recipientList, n.scheduleId);
      } catch (err: any) {
        summary.errors++;
        console.error(`[equipment-reminder] send failed for lab ${cfg.lab_id}:`, err?.message || err);
      }
    }
  }

  return summary;
}
