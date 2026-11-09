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
import { labToday, labTimeZoneById } from "./dateLocal";
import { nextDue, daysUntilDateOnly, LIVE_SIGNOFF } from "./veritatrack";
import { resolveLabGroup, type ResolvedGroup } from "./labGroups";

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

export interface NotifiableItem { task: any; kind: string; dueDate: string | null; days: number | null; }
export interface ReminderGroup { recipients: { email: string; name?: string }[]; items: NotifiableItem[]; }

/**
 * Split a lab's notifiable tasks into the email digests to send. Who gets a task:
 * - Owner-only OFF: the lab recipient list.
 * - Owner-only ON (#51): the task's OWNER (task.owner_email), so the heme owner
 *   never gets the chemistry reminders.
 * - Either way, the task's group when it names one (Michael 2026-11-04).
 * - A task that reaches nobody that way falls back to the lab recipient list, so a
 *   task is never silently dropped from reminders.
 * Each person gets one email a run holding only their tasks, even when they are in
 * two groups or on the list as well; people with the same tasks share that email.
 * taskGroup answers the group a task reaches, or null when it has none, the group is
 * retired, or nobody in it has an address.
 * Exported pure so scripts/verify-veritatrack-owner-reminders.mts can exercise it.
 */
export function groupNotifiableForSend(
  notifiable: NotifiableItem[],
  ownerOnly: boolean,
  labRecipients: { email: string; name?: string }[],
  taskGroup: (task: any) => ResolvedGroup | null = () => null,
): ReminderGroup[] {
  const people = new Map<string, { recipient: { email: string; name?: string }; items: NotifiableItem[] }>();
  for (const n of notifiable) {
    const targets: { email: string; name?: string }[] = [];
    if (ownerOnly) {
      const email = String((n.task as any).owner_email || "").trim();
      if (email && email.includes("@")) targets.push({ email, name: (n.task as any).owner || undefined });
    } else {
      targets.push(...labRecipients);
    }
    targets.push(...(taskGroup(n.task)?.recipients || []));
    if (targets.length === 0) targets.push(...labRecipients);
    const counted = new Set<string>();
    for (const r of targets) {
      const key = r.email.toLowerCase();
      if (counted.has(key)) continue;
      counted.add(key);
      if (!people.has(key)) people.set(key, { recipient: r, items: [] });
      people.get(key)!.items.push(n);
    }
  }
  const digests = new Map<string, ReminderGroup>();
  for (const { recipient, items } of people.values()) {
    const key = items.map(i => i.task.id).join(",");
    if (!digests.has(key)) digests.set(key, { recipients: [], items });
    digests.get(key)!.recipients.push(recipient);
  }
  return [...digests.values()];
}

export interface VeritaTrackReminderSummary {
  labs: number; tasksChecked: number; notifiable: number; emailsSent: number; skipped: number; errors: number;
}

// deps.send stands in for Resend in tests/integration/veritatrack-reminder-groups.test.ts, which reads what each email
// would say and who it would go to; nothing is mailed.
export async function runVeritaTrackReminders(deps: { send?: (msg: { from: string; to: string[]; subject: string; text: string }) => Promise<any> } = {}): Promise<VeritaTrackReminderSummary> {
  const summary: VeritaTrackReminderSummary = { labs: 0, tasksChecked: 0, notifiable: 0, emailsSent: 0, skipped: 0, errors: 0 };
  const sqlite = (db as any).$client;
  // "today" is now per lab, set at the top of the lab loop below.

  let send = deps.send ?? null;
  try {
    if (!send && process.env.RESEND_API_KEY) {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      send = (msg) => resend.emails.send(msg);
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
    // Per-lab time zone (2026-10-26): each lab's reminders count from that lab's calendar day.
    const today = labToday(labTimeZoneById(sqlite, cfg.lab_id));
    // Recipients: the configured list, else fall back to the lab owner so it is
    // never silently off.
    let recipients: { email: string; name?: string }[] = [];
    try { recipients = JSON.parse(cfg.recipients_json || "[]"); } catch { recipients = []; }
    recipients = recipients.filter(r => r && typeof r.email === "string" && r.email.includes("@"));
    // Whole groups on the lab's list, and the group a task names. One lookup per group per lab per run.
    const groupCache = new Map<number, ResolvedGroup | null>();
    const groupById = (id: number) => {
      if (!groupCache.has(id)) groupCache.set(id, resolveLabGroup(sqlite, cfg.lab_id, id));
      return groupCache.get(id)!;
    };
    const taskGroup = (task: any) => (task.reminder_group_id ? groupById(Number(task.reminder_group_id)) : null);
    let listGroupIds: number[] = [];
    try { listGroupIds = JSON.parse(cfg.recipient_group_ids_json || "[]"); } catch { listGroupIds = []; }
    for (const id of Array.isArray(listGroupIds) ? listGroupIds : []) {
      for (const r of groupById(Number(id))?.recipients || []) {
        if (!recipients.some(x => x.email.toLowerCase() === r.email.toLowerCase())) recipients.push(r);
      }
    }
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
        `SELECT completed_date FROM veritatrack_signoffs WHERE task_id = ? AND ${LIVE_SIGNOFF} ORDER BY completed_date DESC LIMIT 1`
      ).get(t.id) as any;
      const due = last ? nextDue(last.completed_date, t.frequency_months, t.frequency_days) : null;
      const days = due ? daysUntilDateOnly(due, today) : null;

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
        // #111: a weekly task gets one reminder the day before, not the 30/14/7/3/1 ladder (three emails a week).
        leadDays: t.frequency_days && t.frequency_days <= 7 ? Math.min(cfg.lead_days, 1) : cfg.lead_days,
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

    if (!send) { summary.skipped++; continue; } // configured labs but no mailer: don't log, retry when set

    // #51 owner-only routing and the tasks' groups decide who gets which tasks.
    const groups = groupNotifiableForSend(notifiable, !!cfg.owner_only, recipients, taskGroup);
    const insert = sqlite.prepare(
      "INSERT INTO veritatrack_reminder_log (task_id, lab_id, reminder_kind, due_date, sent_on, recipient_email) VALUES (?,?,?,?,?,?)"
    );
    for (const group of groups) {
      if (!group.recipients.length) continue;
      const lines = group.items.map(n => {
        const when = n.days === null ? "never completed"
          : n.days <= 0 ? `overdue by ${Math.abs(n.days)} day${Math.abs(n.days) === 1 ? "" : "s"} (due ${n.dueDate})`
          : `due in ${n.days} day${n.days === 1 ? "" : "s"} (${n.dueDate})`;
        const instr = n.task.instrument ? ` [${n.task.instrument}]` : "";
        const groupName = taskGroup(n.task)?.name;
        return `- ${n.task.name}${instr}: ${when}${groupName ? ` - Group: ${groupName}` : ""}`;
      });
      const overdueN = group.items.filter(n => n.days === null || (n.days as number) <= 0).length;
      const subject = `VeritaTrack reminder: ${group.items.length} task${group.items.length === 1 ? "" : "s"} due or overdue at ${labLabel}`;
      const text = [
        `Hello,`,
        ``,
        `This is an automated VeritaTrack reminder for ${labLabel}.`,
        ``,
        `${group.items.length} task${group.items.length === 1 ? "" : "s"} need attention (${overdueN} overdue):`,
        ``,
        ...lines,
        ``,
        `Sign in to VeritaAssure and record the sign-off to clear these reminders.`,
        ``,
        `Sent automatically by VeritaTrack from VeritaAssure. To change who receives these or turn them off, update the reminder settings in VeritaTrack.`,
      ].join("\n");

      try {
        const sent = await send({
          from: "VeritaAssure <info@veritaslabservices.com>",
          to: group.recipients.map(r => r.email),
          subject,
          text,
        });
        // Resend answers a refusal (a bad address, the rate limit) with { error } and does not throw. Count it as a
        // failure so these tasks are not logged as reminded when nobody got the email.
        if (sent?.error) throw new Error(sent.error.message || "Resend refused the email");
        if (!deps.send) await new Promise(r => setTimeout(r, 600)); // Resend allows about 2 sends a second
        summary.emailsSent++;
        const recipientList = group.recipients.map(r => r.email).join(",");
        for (const n of group.items) insert.run(n.task.id, cfg.lab_id, n.kind, n.dueDate, today, recipientList);
      } catch (err: any) {
        summary.errors++;
        console.error(`[veritatrack-reminder] send failed for lab ${cfg.lab_id}:`, err?.message || err);
      }
    }
  }

  return summary;
}
