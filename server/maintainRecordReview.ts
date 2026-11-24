// server/maintainRecordReview.ts
//
// Monthly review of VeritaMaintain records (Michael 2026-11-04, Q161 = 1). CAP COM.04200 has the director or a designee review instrument
// and equipment maintenance and function check records at least monthly and record corrective action for problems; the same review is
// expected of temperature records. Until now the records had no review on them, only a VeritaTrack task that didn't touch them.
//
// A reviewer sees each instrument and temperature unit for one month, with what the system found, and signs with a typed name and password.
// One row per item per month, keeping what was seen, so an entry added after signing shows up as added after the review.
//
// Who signs: the designated medical director, or someone named in an active Letter of Delegation with this duty (any position the duty
// allows; this review doesn't depend on test complexity), or the account owner as a recorded override, the same way findings close.
// What counts as a problem needing corrective action: a temperature day short of its readings, or PM still overdue. Out-of-range readings
// and troubleshooting already carry their own action, so they're shown but don't force one. An instrument with no entries is normal in a
// month with no PM, so it's shown and nothing more.
//
// The stain log (Michael Q178 = 1, 2026-11-06; server/stainLog.ts) reviews here too. An instrument's grid is part of that instrument's record
// for the month, so one signature covers its maintenance and its stain log. The manual stain log is one more record for the month, when it has
// entries. shared/stainLogRules.ts says what counts as a problem on a stain log.
//
// The instrument's own record (B9, 2026-11-24; server/equipment.ts): standing entries only (a corrected or voided one is replaced by what
// stands, and a correction or void made after signing shows as added after the review), the files on them, and time out of service. A
// moved instrument's history stays with the lab that made it, so those months are reviewed there and not again in the new lab.
// Its schedules (B10; server/equipmentScheduleReview.ts): a day a daily schedule has no record, and any other schedule past due, are problems.
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { labLocalDate } from "./dateLocal";
import { logAudit } from "./audit";
import { exportAllPlanBypass } from "./exportAllContext";
import { isLabOwnerUser, mayAttestAsDirectorOrDesignee } from "./delegationGate";
import { staffOwnScope } from "./competencySelfEntry";
import { positionLabel, type DelegationPosition } from "./directorDelegation";
import { MANUAL_ITEM_TYPE, instrumentStainMonth, manualStainMonth } from "./stainLog";
import { durationLabel, minutesInMonth } from "../shared/equipmentPm";
import { scheduleMonth, scheduleReportRows } from "./equipmentScheduleReview";

const GATE = "equipment_record_review" as const;
const isMonth = (v: any): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const ms = (s: string | null | undefined) => (s ? Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`) : 0);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const lastOfMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

// Same explicit plan allowlist as VeritaMaintain equipment and temperature logs.
function hasReviewAccess(user: any, lab?: any): boolean {
  if (exportAllPlanBypass(lab)) return true;
  const plan = lab?.plan ?? user?.plan;
  return ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "clinic", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(plan);
}

export type ReviewCapacity = { capacity: "medical_director" | "designee" | "owner_override"; label: string; delegationId: number | null };

/** Who this person signs as, or null if they can't sign this review. */
export function recordReviewCapacity(sqlite: any, labId: number, userId: number): ReviewCapacity | null {
  // "moderate": every position the duty allows covers it, since this review isn't about a test's complexity.
  const attest = mayAttestAsDirectorOrDesignee(labId, userId, GATE, "moderate");
  if (attest.ok && attest.via === "medical_director") return { capacity: "medical_director", label: "Medical director", delegationId: null };
  if (attest.ok) return { capacity: "designee", label: `Designee, ${positionLabel(attest.position as DelegationPosition)}`, delegationId: attest.delegationId ?? null };
  // A letter can name a roster person rather than a login: match them through their Staff login or roster link.
  const letters = sqlite.prepare(
    `SELECT dd.id, dd.position, dd.responsibilities_json FROM director_delegations dd
      WHERE dd.lab_id = ? AND dd.status = 'active' AND dd.delegate_staff_employee_id IN (
        SELECT staff_employee_id FROM user_seats WHERE seat_user_id = ? AND lab_id = ? AND seat_type = 'staff_portal' AND status = 'active' AND staff_employee_id IS NOT NULL
        UNION SELECT id FROM staff_employees WHERE login_user_id = ? AND status = 'active')`
  ).all(labId, userId, labId, userId) as any[];
  for (const l of letters) {
    let duties: any = {};
    try { duties = JSON.parse(l.responsibilities_json || "{}"); } catch { /* treated as no duties */ }
    if (duties[GATE] === true) return { capacity: "designee", label: `Designee, ${positionLabel(l.position)}`, delegationId: l.id };
  }
  if (isLabOwnerUser(labId, userId)) return { capacity: "owner_override", label: "Account owner (override)", delegationId: null };
  return null;
}

function reviewRows(sqlite: any, labId: number, month: string): any[] {
  return sqlite.prepare("SELECT * FROM maintain_record_reviews WHERE lab_id = ? AND period = ?").all(labId, month) as any[];
}

/** Every instrument and temperature unit for one month, what the records show, and any review already signed. */
export function monthReviewItems(sqlite: any, labId: number, month: string) {
  const first = `${month}-01`;
  const last = lastOfMonth(month);
  const today = labLocalDate(new Date().toISOString());
  const asOf = last < today ? last : today;
  const nowLocal = labLocalDate(new Date().toISOString(), true).replace(" ", "T");
  const reviews = reviewRows(sqlite, labId, month);
  const reviewOf = (type: string, id: number) => reviews.find((r) => r.item_type === type && r.item_id === id) ?? null;
  const items: any[] = [];

  const finish = (type: string, id: number, name: string, detail: string | null, retired: boolean, summary: any, problems: string[], notes: string[], entryTimes: string[]) => {
    const r = reviewOf(type, id);
    const after = r ? entryTimes.filter((t) => ms(t) > ms(r.signed_at)).length : 0;
    items.push({
      key: `${type}-${id}`, type, id, name, detail, retired, summary, problems, notes,
      review: r ? {
        typed_signature: r.typed_signature, capacity_label: r.capacity_label, signed_at: r.signed_at, corrective_action: r.corrective_action,
        problems: JSON.parse(r.problems_json || "[]"), summary: JSON.parse(r.summary_json || "{}"),
      } : null,
      entries_after_review: after,
    });
  };

  // Instruments
  const equipment = sqlite.prepare("SELECT * FROM lab_equipment WHERE lab_id = ? ORDER BY instrument_name").all(labId) as any[];
  for (const e of equipment) {
    const monthEvents = sqlite.prepare(
      "SELECT id, root_event_id, event_type, event_date, created_at, corrects_event_id, superseded_by_event_id, voided_at, completes_pm, pm_complete FROM equipment_maintenance_events WHERE lab_id = ? AND equipment_id = ? AND substr(event_date, 1, 7) = ? AND carried_from_lab_id IS NULL"
    ).all(labId, e.id, month) as any[];
    const events = monthEvents.filter((v) => !v.superseded_by_event_id && !v.voided_at);
    const roots = new Set(events.map((v) => v.root_event_id ?? v.id));
    const files = (sqlite.prepare("SELECT event_id, uploaded_at, removed_at FROM equipment_files WHERE lab_id = ? AND equipment_id = ? AND event_id IS NOT NULL AND carried_from_lab_id IS NULL").all(labId, e.id) as any[]).filter((f) => roots.has(f.event_id));
    const attached = files.filter((f) => !f.removed_at).length;
    const periods = sqlite.prepare("SELECT down_from, down_until FROM equipment_downtime WHERE lab_id = ? AND equipment_id = ? AND carried_from_lab_id IS NULL AND substr(down_from, 1, 7) <= ? AND (down_until IS NULL OR substr(down_until, 1, 7) >= ?)").all(labId, e.id, month, month) as any[];
    const downMinutes = periods.reduce((n, p) => n + minutesInMonth(p, month, nowLocal), 0);
    const retired = e.status && e.status !== "active";
    const createdDay = String(e.created_at || "").slice(0, 10);
    const stain = instrumentStainMonth(sqlite, labId, e.id, month, today);
    const stainHeld = stain.entries.length + stain.voided.length;
    const scheduled = scheduleMonth(sqlite, labId, e, { first, last, asOf, today, periods });
    // An instrument retired during the month still answers for a daily record it owed before it left.
    const leftOwing = retired && String(e.removed_from_service_date || "").slice(0, 7) === month && scheduled.problems.length > 0;
    if (!reviewOf("equipment", e.id) && !events.length && !stainHeld && ((retired && !leftOwing) || createdDay > last)) continue;
    // A correction is made later than the entry it corrects, so it isn't itself a late entry.
    const late = events.filter((v) => !v.corrects_event_id && String(v.created_at || "").slice(0, 10) > addDays(v.event_date, 2)).length;
    const corrected = events.filter((v) => v.corrects_event_id).length;
    const voidedEvents = monthEvents.filter((v) => v.voided_at).length;
    const waiting = events.filter((v) => v.completes_pm === 1 && v.pm_complete === 0).length;
    const troubleshooting = events.filter((v) => v.event_type === "troubleshooting").length;
    const solutions = events.filter((v) => v.event_type === "solution_change").length;
    // A first schedule that is daily is judged by its days, below, not by its due date.
    const dailyPm = scheduled.lines.some((l) => l.schedule.is_primary && l.schedule.active && l.schedule.frequency === "daily");
    const overdue = e.next_due_date && e.next_due_date < asOf && !retired && !dailyPm ? e.next_due_date : null;
    const problems = [...(overdue ? [`PM was due ${overdue} and is not recorded as done`] : []), ...scheduled.problems, ...stain.findings.problems];
    const notes = [
      events.length ? plural(events.length, "entry", "entries") : stainHeld ? "" : "No entries this month",
      solutions ? plural(solutions, "solution change") : "",
      troubleshooting ? plural(troubleshooting, "troubleshooting entry", "troubleshooting entries") : "",
      late ? `${plural(late, "entry", "entries")} added more than 2 days after the date` : "",
      corrected ? plural(corrected, "corrected entry", "corrected entries") : "",
      voidedEvents ? plural(voidedEvents, "voided entry", "voided entries") : "",
      attached ? `${plural(attached, "file")} attached` : "",
      waiting ? `${plural(waiting, "vendor PM", "vendor PMs")} waiting for the vendor report` : "",
      downMinutes ? `Out of service ${durationLabel(downMinutes)}` : "",
      ...scheduled.notes,
      ...stain.findings.notes,
    ].filter(Boolean);
    const summary = {
      entries: events.length, solution_changes: solutions, troubleshooting, entered_late: late, pm_overdue: overdue,
      ...(corrected ? { corrected } : {}), ...(voidedEvents ? { voided_entries: voidedEvents } : {}), ...(attached ? { files_attached: attached } : {}),
      ...(waiting ? { vendor_reports_waiting: waiting } : {}), ...(downMinutes ? { out_of_service_minutes: downMinutes } : {}),
      ...(scheduled.summary.length ? { schedules: scheduled.summary } : {}), ...(stain.has_log ? stain.findings.summary : {}),
    };
    finish("equipment", e.id, e.instrument_name, e.location || null, !!retired, summary, problems, notes,
      [...events.map((v) => v.created_at), ...monthEvents.filter((v) => v.voided_at).map((v) => v.voided_at), ...files.map((f) => f.uploaded_at), ...files.filter((f) => f.removed_at).map((f) => f.removed_at), ...stain.entry_times]);
  }

  // Temperature and humidity units
  const units = sqlite.prepare("SELECT * FROM temp_log_units WHERE lab_id = ? ORDER BY name").all(labId) as any[];
  for (const u of units) {
    const readings = sqlite.prepare("SELECT reading_date, in_range, created_at FROM temp_log_readings WHERE lab_id = ? AND unit_id = ? AND substr(reading_date, 1, 7) = ?").all(labId, u.id, month) as any[];
    const createdDay = String(u.created_at || "").slice(0, 10);
    if (!reviewOf("temp_unit", u.id) && !readings.length && (!u.active || createdDay > last)) continue;
    const perDay = Number(u.readings_per_day || 1);
    const counts = new Map<string, number>();
    for (const r of readings) counts.set(r.reading_date, (counts.get(r.reading_date) || 0) + 1);
    // Today isn't over, so it can't be short yet. A retired unit stops expecting readings when it was retired.
    // A unit is in use from its first reading if that is earlier than the day it was added: a lab moving over back-enters its old
    // logs on a unit it added today, and a gap inside those logs is still a gap.
    const firstReading = (sqlite.prepare("SELECT MIN(reading_date) AS d FROM temp_log_readings WHERE lab_id = ? AND unit_id = ?").get(labId, u.id) as any)?.d as string | null;
    const inUseFrom = firstReading && firstReading < createdDay ? firstReading : createdDay;
    const start = inUseFrom > first ? inUseFrom : first;
    const retiredDay = !u.active ? String(u.updated_at || "").slice(0, 10) : "";
    let end = asOf === today ? addDays(today, -1) : asOf;
    if (retiredDay && retiredDay < end) end = retiredDay;
    const shortDays: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) if ((counts.get(d) || 0) < perDay) shortDays.push(d);
    const outOfRange = readings.filter((r) => !r.in_range).length;
    const late = readings.filter((r) => String(r.created_at || "").slice(0, 10) > addDays(r.reading_date, 2)).length;
    const problems = shortDays.length
      ? [`${plural(shortDays.length, "day")} short of ${perDay === 1 ? "a reading" : `${perDay} readings`}: ${shortDays.slice(0, 8).map(shortDay).join(", ")}${shortDays.length > 8 ? " and more" : ""}`]
      : [];
    const notes = [
      plural(readings.length, "reading"),
      outOfRange ? `${outOfRange} out of range, each with its corrective action` : "",
      late ? `${plural(late, "reading")} added more than 2 days after the date` : "",
    ].filter(Boolean);
    finish("temp_unit", u.id, u.name, u.location || null, !u.active, { readings: readings.length, out_of_range: outOfRange, short_days: shortDays.length, entered_late: late, unit_type: u.unit_type }, problems, notes, readings.map((r) => r.created_at));
  }

  // The manual stain log: one record for the lab, in a month it has entries. Its id is the lab's, since there's one per lab.
  const manual = manualStainMonth(sqlite, labId, month);
  if (manual.has_entries || reviewOf(MANUAL_ITEM_TYPE, labId)) {
    finish(MANUAL_ITEM_TYPE, labId, "Manual stain log", null, false, manual.summary, [], manual.notes, manual.entry_times);
  }

  // Signed for something since removed: the signed record still shows.
  for (const r of reviews) {
    if (items.some((i) => i.type === r.item_type && i.id === r.item_id)) continue;
    finish(r.item_type, r.item_id, r.item_name, null, true, JSON.parse(r.summary_json || "{}"), [], [], []);
  }
  return items;
}

export function registerMaintainRecordReviewRoutes(app: Express, authMiddleware: any, requireWriteAccess: any) {
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (!labScopeMiddleware) throw new Error("registerMaintainRecordReviewRoutes: labScopeMiddleware not registered");
  const sqlite = () => (db as any).$client;
  const gate = (req: any, res: any): boolean => {
    if (hasReviewAccess(req.user, req.scope?.lab)) return true;
    res.status(403).json({ error: "Monthly record review requires a suite subscription" });
    return false;
  };

  app.get("/api/labs/:labId/maintain-reviews", authMiddleware, labScopeMiddleware, (req: any, res: any) => {
    if (!gate(req, res)) return;
    const today = labLocalDate(new Date().toISOString());
    const month = isMonth(req.query.month) ? req.query.month : today.slice(0, 7);
    if (month > today.slice(0, 7)) return res.status(400).json({ error: "That month hasn't started" });
    const capacity = recordReviewCapacity(sqlite(), req.scope.labId, req.userId);
    const items = monthReviewItems(sqlite(), req.scope.labId, month);
    res.json({
      month, can_review: !!capacity, capacity_label: capacity?.label ?? null, items,
      counts: { total: items.length, reviewed: items.filter((i) => i.review).length, open: items.filter((i) => !i.review).length },
    });
  });

  app.post("/api/labs/:labId/maintain-reviews", authMiddleware, labScopeMiddleware, requireWriteAccess, async (req: any, res: any) => {
    if (!gate(req, res)) return;
    const db0 = sqlite();
    const labId = req.scope.labId;
    const capacity = recordReviewCapacity(db0, labId, req.userId);
    if (!capacity) {
      return res.status(403).json({ error: "Only the medical director, or someone named in a signed Letter of Delegation for this review, can sign it.", code: "NOT_DIRECTOR_OR_DESIGNEE" });
    }
    const { month, items: picked, typed_signature, password, corrective_action } = req.body || {};
    const today = labLocalDate(new Date().toISOString());
    if (!isMonth(month)) return res.status(400).json({ error: "month must be YYYY-MM" });
    if (month > today.slice(0, 7)) return res.status(400).json({ error: "That month hasn't started" });
    if (!Array.isArray(picked) || picked.length === 0) return res.status(400).json({ error: "Pick at least one record to review" });
    const typed = String(typed_signature || "").trim();
    if (typed.length < 2) return res.status(400).json({ error: "Type your full name to sign" });
    if (typed.length > 200) return res.status(400).json({ error: "The typed name is too long" });
    if (!password || typeof password !== "string") return res.status(400).json({ error: "Enter your password to sign" });

    const all = monthReviewItems(db0, labId, month);
    const chosen: any[] = [];
    for (const p of picked) {
      const item = all.find((i) => i.type === p?.type && i.id === Number(p?.id));
      if (!item) return res.status(404).json({ error: "One of those records isn't in this lab for this month" });
      if (!chosen.includes(item)) chosen.push(item);
    }
    const already = chosen.filter((i) => i.review);
    if (already.length) return res.status(409).json({ error: `Already reviewed: ${already.map((i) => i.name).join(", ")}`, code: "ALREADY_REVIEWED" });
    const action = String(corrective_action || "").trim();
    if (action.length > 4000) return res.status(400).json({ error: "The corrective action is too long" });
    if (!action && chosen.some((i) => i.problems.length)) {
      return res.status(400).json({ error: "These records have problems: record the corrective action.", code: "CORRECTIVE_ACTION_REQUIRED" });
    }

    const user = db0.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.userId) as any;
    if (!user?.password_hash) return res.status(401).json({ error: "User has no password set" });
    if (!(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: "Password incorrect; the review was not signed" });

    const signedAt = new Date().toISOString();
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").toString().split(",")[0].trim() || null;
    const ua = (req.headers["user-agent"] || "").toString().slice(0, 500) || null;
    const insert = db0.prepare(
      `INSERT INTO maintain_record_reviews (lab_id, period, item_type, item_id, item_name, summary_json, problems_json, corrective_action, reviewed_by_user_id, typed_signature, capacity, capacity_label, delegation_id, ip_address, user_agent, signed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    try {
      db0.transaction(() => {
        for (const i of chosen) {
          insert.run(labId, month, i.type, i.id, i.name, JSON.stringify({ ...i.summary, notes: i.notes }), JSON.stringify(i.problems), action || null, req.userId, typed, capacity.capacity, capacity.label, capacity.delegationId, ip, ua, signedAt);
        }
      })();
    } catch (err: any) {
      if (/UNIQUE/.test(err?.message || "")) return res.status(409).json({ error: "Someone just signed one of these. Reload to see it.", code: "ALREADY_REVIEWED" });
      throw err;
    }
    logAudit({
      userId: req.userId,
      ownerUserId: req.scope?.lab?.owner_user_id,
      module: "veritamaintain",
      action: "create",
      entityType: "monthly_record_review",
      entityId: month,
      entityLabel: `${month}: ${plural(chosen.length, "record")} reviewed`,
      after: { month, capacity: capacity.capacity, items: chosen.map((i) => ({ type: i.type, id: i.id, name: i.name, problems: i.problems })), corrective_action: action || null, lab_id: labId },
      ipAddress: ip ?? undefined,
    });
    res.status(201).json({ ok: true, month, reviewed: chosen.length, capacity_label: capacity.label, signed_at: signedAt });
  });

  app.get("/api/labs/:labId/maintain-reviews/report.xlsx", authMiddleware, labScopeMiddleware, async (req: any, res: any) => {
    if (!gate(req, res)) return;
    const today = labLocalDate(new Date().toISOString());
    const month = isMonth(req.query.month) ? req.query.month : today.slice(0, 7);
    const db0 = sqlite();
    const labId = req.scope.labId;
    const labRow = db0.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(labId) as any;
    const items = monthReviewItems(db0, labId, month);
    const readings = db0.prepare(
      `SELECT u.name AS unit, u.scale, r.reading_date, r.reading_time, r.value, r.in_range, r.initials, r.corrective_action
         FROM temp_log_readings r JOIN temp_log_units u ON u.id = r.unit_id
        WHERE r.lab_id = ? AND substr(r.reading_date, 1, 7) = ? ORDER BY u.name, r.reading_date, r.reading_time, r.id`
    ).all(labId, month) as any[];
    const events = db0.prepare(
      `SELECT e.instrument_name, v.event_type, v.event_date, v.performed_by, v.notes, v.logged_by_name, v.by_vendor, v.vendor_company, v.vendor_technician, v.cost,
              v.completes_pm, v.pm_complete, v.corrected_at, v.corrected_by_name, v.correction_reason, v.voided_at, v.void_reason,
              (SELECT GROUP_CONCAT(f.kind || char(31) || f.original_filename, char(30)) FROM equipment_files f
                WHERE f.lab_id = v.lab_id AND f.event_id = COALESCE(v.root_event_id, v.id) AND f.removed_at IS NULL) AS files
         FROM equipment_maintenance_events v JOIN lab_equipment e ON e.id = v.equipment_id
        WHERE v.lab_id = ? AND substr(v.event_date, 1, 7) = ? AND v.superseded_by_event_id IS NULL AND v.carried_from_lab_id IS NULL ORDER BY e.instrument_name, v.event_date, v.id`
    ).all(labId, month) as any[];
    // A limited Staff login reads what was typed, as on paper, but not a coworker's sign-in name (server/equipment.ts).
    const limited = !!staffOwnScope(db0, req.userId, labId, "veritamaintain");
    if (limited) for (const e of events) { e.logged_by_name = null; e.corrected_by_name = null; }
    const last = lastOfMonth(month);
    const scheduled = scheduleReportRows(db0, labId, { first: `${month}-01`, last, asOf: last < today ? last : today, today });
    if (limited) for (const a of scheduled.answers) if (a.completed_by_user_id !== req.userId) a.completed_by_name = null;
    const nowLocal = labLocalDate(new Date().toISOString(), true).replace(" ", "T");
    const downtime = (db0.prepare(
      `SELECT e.instrument_name, d.down_from, d.down_until, d.reason, d.return_note FROM equipment_downtime d JOIN lab_equipment e ON e.id = d.equipment_id
        WHERE d.lab_id = ? AND d.carried_from_lab_id IS NULL AND substr(d.down_from, 1, 7) <= ? AND (d.down_until IS NULL OR substr(d.down_until, 1, 7) >= ?) ORDER BY e.instrument_name, d.down_from`
    ).all(labId, month, month) as any[]).map((d) => ({ ...d, month_label: durationLabel(minutesInMonth(d, month, nowLocal)) }));
    const stainEntries = db0.prepare(
      `SELECT e.instrument_name, r.name AS row_name, s.log_date, s.code, s.lot_number, s.expiration_date, s.initials, s.corrective_action, s.voided_at, s.void_reason
         FROM stain_log_entries s JOIN stain_log_rows r ON r.id = s.row_id AND r.lab_id = s.lab_id JOIN lab_equipment e ON e.id = s.equipment_id AND e.lab_id = s.lab_id
        WHERE s.lab_id = ? AND substr(s.log_date, 1, 7) = ? ORDER BY e.instrument_name, s.log_date, r.sort_order, s.id`
    ).all(labId, month) as any[];
    const manualEntries = db0.prepare("SELECT log_date, specimen_type, result, test_slide, initials, comments, voided_at, void_reason FROM stain_manual_entries WHERE lab_id = ? AND substr(log_date, 1, 7) = ? ORDER BY log_date, id").all(labId, month) as any[];
    const { generateMaintainReviewReport } = await import("./maintainReviewReport");
    const buf = await generateMaintainReviewReport({ month, items, readings, events, stainEntries, manualEntries, downtime, schedules: scheduled.schedules, answers: scheduled.answers }, { labName: labRow?.lab_name || "Laboratory", cliaNumber: labRow?.clia_number || "Not on file" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="VeritaMaintain_Monthly_Review_${month}.xlsx"`);
    res.send(buf);
  });
}
