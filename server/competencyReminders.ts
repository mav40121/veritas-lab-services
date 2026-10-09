// server/competencyReminders.ts
//
// Competency reminders and escalation (2026-10-08). St. Charles' evaluation
// opens with "POCT competency compliance ... oversight gaps, and Joint
// Commission readiness" and asks for "automatic reminders and escalations".
// Michael's design (2026-10-08, "1, but give a 90/60/30 report monthly"):
//   - WEEKLY DIGEST to supervisors: who is coming due in the next `lead_days`
//     (default 30) and who is already overdue.
//   - ESCALATION to the director the day a competency goes overdue, then on the
//     same weekly cadence until it is done.
//   - MONTHLY 90/60/30 REPORT (first run of each month): overdue, due within 30,
//     31-60 and 61-90 days, to supervisors and the director.
// Per-lab opt-in (competency_reminder_config.enabled). Dedupe and history in
// competency_reminder_log. No-op without RESEND_API_KEY (nothing is logged, so
// it retries once mail is configured). Dry-run returns the planned emails
// without sending or logging; the admin endpoint and the settings preview use it.
//
// The "who is due when" walk lives here (deriveCompetencyStatus) and the
// /competency/owed route uses the same function, so the emails and the owed
// list can never disagree.

import { db } from "./db";

const DAY = 24 * 60 * 60 * 1000;

// Initial competency due date, from the hire date OR the date the employee was
// added to the roster, whichever is later (moved here from routes.ts so the
// reminder engine and the routes share one copy). Returns the LATER of hire+90
// and added+90; null only when neither date parses.
export function initialCompetencyDueDate(hireDate: string | null | undefined, createdAt: string | null | undefined): Date | null {
  const D = 90 * DAY;
  const cands: number[] = [];
  const h = hireDate ? Date.parse(hireDate) : NaN;
  const c = createdAt ? Date.parse(createdAt) : NaN;
  if (Number.isFinite(h)) cands.push(h + D);
  if (Number.isFinite(c)) cands.push(c + D);
  return cands.length ? new Date(Math.max(...cands)) : null;
}

export type CompetencyBucket = "overdue" | "dueSoon30" | "dueSoon90" | "compliant";

// The CLIA milestone walk: initial, 6-month, 1st annual, then annual (rolled
// forward a year when the last annual was completed inside the current cycle).
export function deriveCompetencyStatus(e: any, today: Date): { bucket: CompetencyBucket; reason: string; nextDue: string | null; scheduled: boolean } {
  const parseDate = (s: string | null): Date | null => {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const plus30 = today.getTime() + 30 * DAY;
  const plus90 = today.getTime() + 90 * DAY;
  const scheduled = !!(e.initial_completed_at || e.six_month_due_at || e.first_annual_due_at || e.annual_due_at);
  let nextDue: Date | null = null;
  let reason = "";
  if (!e.initial_completed_at) {
    nextDue = initialCompetencyDueDate(e.hire_date, e.created_at) ?? today;
    reason = "Initial competency not completed";
  } else if (e.six_month_due_at && !e.six_month_completed_at) {
    nextDue = parseDate(e.six_month_due_at); reason = "6-month competency due";
  } else if (e.first_annual_due_at && !e.first_annual_completed_at) {
    nextDue = parseDate(e.first_annual_due_at); reason = "1st annual competency due";
  } else if (e.annual_due_at) {
    const due = parseDate(e.annual_due_at);
    const lastDone = parseDate(e.last_annual_completed_at);
    if (due) {
      if (lastDone && lastDone.getTime() > due.getTime() - 365 * DAY) {
        const next = new Date(due.getTime() + 365 * DAY);
        nextDue = next; reason = next.getTime() < today.getTime() ? "Annual cycle overdue" : "Annual due";
      } else { nextDue = due; reason = "Annual competency due"; }
    }
  }
  let bucket: CompetencyBucket = "compliant";
  if (nextDue === null) bucket = "compliant";
  else if (nextDue.getTime() < today.getTime()) bucket = "overdue";
  else if (nextDue.getTime() <= plus30) bucket = "dueSoon30";
  else if (nextDue.getTime() <= plus90) bucket = "dueSoon90";
  return { bucket, reason, nextDue: nextDue ? nextDue.toISOString().slice(0, 10) : null, scheduled };
}

export interface CompetencyDueItem {
  employeeId: number;
  name: string;
  title: string | null;
  reason: string;
  nextDue: string;
  daysUntil: number; // negative = overdue by that many days
}

// Every active testing employee with a next due date, with days until due.
export function computeCompetencyDue(sqlite: any, labId: number, todayIso: string): CompetencyDueItem[] {
  const today = new Date(todayIso + "T00:00:00");
  const rows = sqlite.prepare(
    `SELECT e.id, e.first_name, e.last_name, e.title, e.hire_date, e.created_at,
            s.initial_completed_at, s.six_month_due_at, s.six_month_completed_at,
            s.first_annual_due_at, s.first_annual_completed_at, s.annual_due_at, s.last_annual_completed_at
     FROM staff_employees e
     LEFT JOIN staff_competency_schedules s ON s.employee_id = e.id
     WHERE e.tier2_lab_id = ? AND e.status = 'active' AND e.performs_testing = 1
     ORDER BY e.last_name, e.first_name`
  ).all(labId) as any[];
  const out: CompetencyDueItem[] = [];
  for (const e of rows) {
    const st = deriveCompetencyStatus(e, today);
    if (!st.nextDue) continue;
    const daysUntil = Math.round((Date.parse(st.nextDue + "T00:00:00Z") - Date.parse(todayIso + "T00:00:00Z")) / DAY);
    out.push({
      employeeId: e.id,
      name: `${e.first_name || ""} ${e.last_name || ""}`.trim() || `Employee ${e.id}`,
      title: e.title || null,
      reason: st.reason,
      nextDue: st.nextDue,
      daysUntil,
    });
  }
  return out;
}

// ── Settings ────────────────────────────────────────────────────────────────
export interface CompetencyReminderConfig {
  lab_id: number;
  enabled: boolean;
  lead_days: number;
  cadence_days: number;
  monthly_report: boolean;
  supervisor_recipients: { email: string; name?: string }[];
  escalation_recipients: { email: string; name?: string }[];
  configured: boolean;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function cleanRecipients(list: any): { email: string; name?: string }[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: { email: string; name?: string }[] = [];
  for (const r of list) {
    const email = String(typeof r === "string" ? r : r?.email || "").trim();
    if (!EMAIL_RE.test(email) || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    const name = typeof r === "object" && r?.name ? String(r.name).trim() : "";
    out.push(name ? { email, name } : { email });
  }
  return out;
}

export function readCompetencyReminderConfig(sqlite: any, labId: number): CompetencyReminderConfig {
  const row = sqlite.prepare("SELECT * FROM competency_reminder_config WHERE lab_id = ?").get(labId) as any;
  const parse = (s: any) => { try { return cleanRecipients(JSON.parse(s || "[]")); } catch { return []; } };
  return {
    lab_id: labId,
    enabled: row ? !!row.enabled : false,
    lead_days: row ? row.lead_days : 30,
    cadence_days: row ? row.cadence_days : 7,
    monthly_report: row ? !!row.monthly_report : true,
    supervisor_recipients: row ? parse(row.supervisor_recipients_json) : [],
    escalation_recipients: row ? parse(row.escalation_recipients_json) : [],
    configured: !!row,
  };
}

export function writeCompetencyReminderConfig(sqlite: any, labId: number, body: any): CompetencyReminderConfig {
  const b = body || {};
  const lead = Math.max(1, Math.min(90, Number.isFinite(+b.lead_days) ? Math.round(+b.lead_days) : 30));
  const cadence = Math.max(1, Math.min(30, Number.isFinite(+b.cadence_days) ? Math.round(+b.cadence_days) : 7));
  const sup = cleanRecipients(b.supervisor_recipients);
  const esc = cleanRecipients(b.escalation_recipients);
  const now = new Date().toISOString();
  const existing = sqlite.prepare("SELECT id FROM competency_reminder_config WHERE lab_id = ?").get(labId) as any;
  const vals = [b.enabled ? 1 : 0, lead, cadence, b.monthly_report === false ? 0 : 1, JSON.stringify(sup), JSON.stringify(esc)];
  if (existing) {
    sqlite.prepare(
      "UPDATE competency_reminder_config SET enabled=?, lead_days=?, cadence_days=?, monthly_report=?, supervisor_recipients_json=?, escalation_recipients_json=?, updated_at=? WHERE lab_id=?"
    ).run(...vals, now, labId);
  } else {
    sqlite.prepare(
      "INSERT INTO competency_reminder_config (lab_id, enabled, lead_days, cadence_days, monthly_report, supervisor_recipients_json, escalation_recipients_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(labId, ...vals, now, now);
  }
  return readCompetencyReminderConfig(sqlite, labId);
}

// ── Planning ────────────────────────────────────────────────────────────────
export type ReminderKind = "digest" | "escalation" | "monthly";
export interface PlannedEmail {
  kind: ReminderKind;
  send: boolean;
  why: string;
  recipients: { email: string; name?: string }[];
  recipientsSource: string;
  subject: string;
  text: string;
  html: string;
  items: CompetencyDueItem[];
  newlyOverdueKeys?: string[];
}

const itemKey = (i: CompetencyDueItem) => `${i.employeeId}|${i.nextDue}|${i.reason}`;
const daysBetween = (aIso: string, bIso: string) =>
  Math.round((Date.parse(bIso.slice(0, 10) + "T00:00:00Z") - Date.parse(aIso.slice(0, 10) + "T00:00:00Z")) / DAY);
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const when = (i: CompetencyDueItem) => i.daysUntil < 0
  ? `overdue by ${-i.daysUntil} day${i.daysUntil === -1 ? "" : "s"} (due ${i.nextDue})`
  : i.daysUntil === 0 ? `due today (${i.nextDue})` : `due in ${i.daysUntil} day${i.daysUntil === 1 ? "" : "s"} (${i.nextDue})`;
const line = (i: CompetencyDueItem) => `- ${i.name}${i.title ? `, ${i.title}` : ""}: ${i.reason}, ${when(i)}`;

function section(title: string, items: CompetencyDueItem[]): { text: string[]; html: string } {
  if (!items.length) return { text: [], html: "" };
  return {
    text: [`${title} (${items.length}):`, ...items.map(line), ""],
    html: `<p style="margin:16px 0 6px;font-weight:600;color:#0A3A3D">${esc(title)} (${items.length})</p>`
      + `<table style="border-collapse:collapse;font-size:13px;width:100%">`
      + items.map((i) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #D0D0D0">${esc(i.name)}${i.title ? `, ${esc(i.title)}` : ""}</td>`
        + `<td style="padding:4px 8px;border-bottom:1px solid #D0D0D0">${esc(i.reason)}</td>`
        + `<td style="padding:4px 8px;border-bottom:1px solid #D0D0D0;color:${i.daysUntil < 0 ? "#A12C7B" : "#964219"}">${esc(when(i))}</td></tr>`).join("")
      + `</table>`,
  };
}

function wrapHtml(intro: string, body: string, footer: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#28251D;max-width:680px">`
    + `<p style="margin:0 0 4px;font-weight:700;color:#01696F">VeritaComp&trade; competency reminders</p>`
    + `<p style="margin:0 0 8px">${intro}</p>${body}`
    + `<p style="margin:18px 0 0;font-size:12px;color:#7A7974">${footer}</p></div>`;
}

export function planCompetencyReminders(sqlite: any, labId: number, cfg: CompetencyReminderConfig, todayIso: string): PlannedEmail[] {
  const lab = sqlite.prepare("SELECT lab_name, clia_number, medical_director_email, owner_user_id FROM labs WHERE id = ?").get(labId) as any;
  const labLabel = lab?.lab_name || lab?.clia_number || "your lab";
  const owner = lab?.owner_user_id ? sqlite.prepare("SELECT email, name FROM users WHERE id = ?").get(lab.owner_user_id) as any : null;
  const ownerList = owner?.email ? [{ email: owner.email, ...(owner.name ? { name: owner.name } : {}) }] : [];

  let supervisors = cfg.supervisor_recipients, supSource = "supervisor list";
  if (!supervisors.length) { supervisors = ownerList; supSource = "lab owner (no supervisor list set)"; }
  let directors = cfg.escalation_recipients, dirSource = "escalation list";
  if (!directors.length && lab?.medical_director_email && EMAIL_RE.test(lab.medical_director_email)) {
    directors = [{ email: lab.medical_director_email }]; dirSource = "medical director on file (no escalation list set)";
  }
  if (!directors.length) { directors = ownerList; dirSource = "lab owner (no escalation list or medical director set)"; }

  const all = computeCompetencyDue(sqlite, labId, todayIso);
  const overdue = all.filter((i) => i.daysUntil < 0).sort((a, b) => a.daysUntil - b.daysUntil);
  const coming = all.filter((i) => i.daysUntil >= 0 && i.daysUntil <= cfg.lead_days).sort((a, b) => a.daysUntil - b.daysUntil);
  const lastSent = (kind: ReminderKind) => (sqlite.prepare(
    "SELECT MAX(sent_on) AS s FROM competency_reminder_log WHERE lab_id = ? AND kind = ?"
  ).get(labId, kind) as any)?.s as string | null;
  const footer = `Sent automatically by VeritaAssure for ${esc(labLabel)}. To change who receives these or turn them off, open VeritaComp and update Reminders and escalation.`;
  const footerText = `Sent automatically by VeritaAssure for ${labLabel}. To change who receives these or turn them off, open VeritaComp and update Reminders and escalation.`;
  const plans: PlannedEmail[] = [];

  // Weekly digest to supervisors.
  {
    const items = [...overdue, ...coming];
    const last = lastSent("digest");
    const sinceLast = last ? daysBetween(last, todayIso) : null;
    const due = items.length > 0 && (sinceLast === null || sinceLast >= cfg.cadence_days);
    const s1 = section("Overdue", overdue), s2 = section(`Coming due in the next ${cfg.lead_days} days`, coming);
    plans.push({
      kind: "digest", send: due,
      why: !items.length ? "nobody overdue or coming due" : due ? (last ? `last digest ${sinceLast} days ago` : "first digest") : `last digest ${sinceLast} days ago (cadence ${cfg.cadence_days})`,
      recipients: supervisors, recipientsSource: supSource,
      subject: `VeritaComp: ${coming.length} competenc${coming.length === 1 ? "y" : "ies"} coming due, ${overdue.length} overdue at ${labLabel}`,
      text: [`Hello,`, ``, `Competency status for ${labLabel} as of ${todayIso}.`, ``, ...s1.text, ...s2.text, footerText].join("\n"),
      html: wrapHtml(`Competency status for <b>${esc(labLabel)}</b> as of ${todayIso}.`, s1.html + s2.html, footer),
      items,
    });
  }

  // Escalation to the director: the day a competency goes overdue, then weekly.
  {
    const escalated = new Set<string>((sqlite.prepare(
      "SELECT DISTINCT item_key FROM competency_reminder_log WHERE lab_id = ? AND kind = 'escalation' AND item_key IS NOT NULL"
    ).all(labId) as any[]).map((r) => r.item_key));
    const newly = overdue.filter((i) => !escalated.has(itemKey(i)));
    const last = lastSent("escalation");
    const sinceLast = last ? daysBetween(last, todayIso) : null;
    const due = overdue.length > 0 && (newly.length > 0 || sinceLast === null || sinceLast >= cfg.cadence_days);
    const sNew = section("Newly overdue", newly), sStill = section("Still overdue", overdue.filter((i) => !newly.includes(i)));
    plans.push({
      kind: "escalation", send: due,
      why: !overdue.length ? "nothing overdue" : newly.length ? `${newly.length} newly overdue` : due ? `repeat, last escalation ${sinceLast} days ago` : `already escalated ${sinceLast} days ago (cadence ${cfg.cadence_days})`,
      recipients: directors, recipientsSource: dirSource,
      subject: `Escalation: ${overdue.length} overdue competenc${overdue.length === 1 ? "y" : "ies"} at ${labLabel}`,
      text: [`Hello,`, ``, `The competencies below are past due at ${labLabel} (as of ${todayIso}). Please make sure each one is completed and documented.`, ``, ...sNew.text, ...sStill.text, footerText].join("\n"),
      html: wrapHtml(`The competencies below are past due at <b>${esc(labLabel)}</b> (as of ${todayIso}). Please make sure each one is completed and documented.`, sNew.html + sStill.html, footer),
      items: overdue,
      newlyOverdueKeys: newly.map(itemKey),
    });
  }

  // Monthly 90/60/30 report, first run of each month.
  {
    const period = todayIso.slice(0, 7);
    const already = sqlite.prepare("SELECT 1 FROM competency_reminder_log WHERE lab_id = ? AND kind = 'monthly' AND period_key = ? LIMIT 1").get(labId, period);
    const d30 = all.filter((i) => i.daysUntil >= 0 && i.daysUntil <= 30).sort((a, b) => a.daysUntil - b.daysUntil);
    const d60 = all.filter((i) => i.daysUntil > 30 && i.daysUntil <= 60).sort((a, b) => a.daysUntil - b.daysUntil);
    const d90 = all.filter((i) => i.daysUntil > 60 && i.daysUntil <= 90).sort((a, b) => a.daysUntil - b.daysUntil);
    const monthName = new Date(todayIso + "T00:00:00Z").toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const merged = [...supervisors];
    for (const d of directors) if (!merged.some((m) => m.email.toLowerCase() === d.email.toLowerCase())) merged.push(d);
    const parts = [section("Overdue", overdue), section("Due within 30 days", d30), section("Due in 31 to 60 days", d60), section("Due in 61 to 90 days", d90)];
    const none = !overdue.length && !d30.length && !d60.length && !d90.length;
    plans.push({
      kind: "monthly", send: cfg.monthly_report && !already,
      why: !cfg.monthly_report ? "monthly report turned off" : already ? `already sent for ${period}` : `first run of ${period}`,
      recipients: merged, recipientsSource: `${supSource} + ${dirSource}`,
      subject: `VeritaComp monthly competency report, ${monthName}: ${labLabel}`,
      text: [`Hello,`, ``, `Monthly competency report for ${labLabel}, ${monthName}: overdue ${overdue.length}, due within 30 days ${d30.length}, 31 to 60 days ${d60.length}, 61 to 90 days ${d90.length}.`, ``,
        ...(none ? ["No competencies are overdue or due in the next 90 days.", ""] : parts.flatMap((p) => p.text)), footerText].join("\n"),
      html: wrapHtml(`Monthly competency report for <b>${esc(labLabel)}</b>, ${monthName}: overdue <b>${overdue.length}</b>, due within 30 days <b>${d30.length}</b>, 31 to 60 days <b>${d60.length}</b>, 61 to 90 days <b>${d90.length}</b>.`,
        none ? `<p>No competencies are overdue or due in the next 90 days.</p>` : parts.map((p) => p.html).join(""), footer),
      items: [...overdue, ...d30, ...d60, ...d90],
    });
  }
  return plans;
}

// ── Run ─────────────────────────────────────────────────────────────────────
export interface CompetencyReminderRunResult {
  labs: number;
  emailsSent: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
  plans: { labId: number; emails: Omit<PlannedEmail, "html">[] }[];
}

export async function runCompetencyReminders(opts: { labId?: number; dryRun?: boolean; todayIso?: string } = {}): Promise<CompetencyReminderRunResult> {
  const sqlite = (db as any).$client;
  const todayIso = opts.todayIso && /^\d{4}-\d{2}-\d{2}$/.test(opts.todayIso) ? opts.todayIso : new Date().toISOString().slice(0, 10);
  const dryRun = !!opts.dryRun;
  const result: CompetencyReminderRunResult = { labs: 0, emailsSent: 0, skipped: 0, errors: 0, dryRun, plans: [] };

  let resend: any = null;
  if (!dryRun) {
    try {
      if (process.env.RESEND_API_KEY) {
        const { Resend } = await import("resend");
        resend = new Resend(process.env.RESEND_API_KEY);
      }
    } catch (err: any) {
      console.error("[competency-reminders] Resend init failed:", err?.message || err);
    }
  }

  let labIds: number[] = [];
  try {
    labIds = opts.labId
      ? [Number(opts.labId)]
      : (sqlite.prepare("SELECT lab_id FROM competency_reminder_config WHERE enabled = 1").all() as any[]).map((r) => r.lab_id);
  } catch (err: any) {
    console.error("[competency-reminders] Query failed:", err?.message || err);
    return result;
  }

  const insert = sqlite.prepare(
    "INSERT INTO competency_reminder_log (lab_id, kind, item_key, period_key, sent_on, recipient_emails, item_count, created_at) VALUES (?,?,?,?,?,?,?,?)"
  );
  for (const labId of labIds) {
    const cfg = readCompetencyReminderConfig(sqlite, labId);
    if (!opts.labId && !cfg.enabled) continue;
    result.labs++;
    const plans = planCompetencyReminders(sqlite, labId, cfg, todayIso);
    result.plans.push({ labId, emails: plans.map(({ html, ...p }) => p) });
    if (dryRun) continue;
    if (!cfg.enabled) { result.skipped++; continue; } // never send for a lab that has not turned it on
    for (const p of plans) {
      if (!p.send) continue;
      if (!p.recipients.length || !resend) { result.skipped++; continue; }
      try {
        await resend.emails.send({
          from: "VeritaAssure <info@veritaslabservices.com>",
          to: p.recipients.map((r) => r.email),
          subject: p.subject,
          text: p.text,
          html: p.html,
        });
        result.emailsSent++;
        const to = p.recipients.map((r) => r.email).join(",");
        const now = new Date().toISOString();
        if (p.kind === "escalation") {
          for (const i of p.items) insert.run(labId, "escalation", itemKey(i), null, todayIso, to, 1, now);
        } else {
          insert.run(labId, p.kind, null, p.kind === "monthly" ? todayIso.slice(0, 7) : null, todayIso, to, p.items.length, now);
        }
      } catch (err: any) {
        result.errors++;
        console.error(`[competency-reminders] send failed for lab ${labId} (${p.kind}):`, err?.message || err);
      }
    }
  }
  return result;
}
