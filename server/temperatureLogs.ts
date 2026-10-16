// server/temperatureLogs.ts
//
// VeritaMaintain temperature logs (St. Charles REQ-068, 2026-10-14): "a place to manually record
// temperature logs." Each lab keeps storage units (refrigerators, freezers, incubators, rooms, water baths,
// heat blocks) with an acceptable range and how many readings a day are expected. Staff record readings
// with their initials; a reading outside the range must carry the corrective action taken, so the log a
// surveyor reads shows both the excursion and the response. 42 CFR 493.1252(b) asks the lab to define,
// monitor and document the conditions (temperature among them) essential for reagent and specimen storage
// and test system operation; the ranges are the lab's own (manufacturer instructions), never defaulted.
//
// Access: setup (add / edit / retire a unit) = VeritaMaintain edit (requireModuleEdit('veritamaintain'));
// recording a reading = any active member (requireWriteAccess), the same split as maintenance events.
import type { Express } from "express";
import { db } from "./db";
import { labLocalDate } from "./dateLocal";
import { exportAllPlanBypass } from "./exportAllContext";

export const TEMP_UNIT_TYPES = ["refrigerator", "freezer", "incubator", "room", "water_bath", "heat_block", "platelet_incubator", "other"] as const;

// Same explicit plan allowlist as VeritaMaintain equipment (routes.ts hasEquipmentAccess).
function hasTempLogAccess(user: any, lab?: any): boolean {
  if (exportAllPlanBypass(lab)) return true; // export-all job (server/exportAllContext.ts)
  const plan = lab?.plan ?? user?.plan;
  return ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "clinic", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(plan);
}

const isIsoDay = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isHhMm = (v: any) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const num = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function readingInRange(value: number, min: number | null, max: number | null): boolean {
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

export function registerTemperatureLogRoutes(
  app: Express,
  authMiddleware: any,
  requireWriteAccess: any,
  requireModuleEdit: (mod: string) => any,
) {
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (!labScopeMiddleware) throw new Error("registerTemperatureLogRoutes: labScopeMiddleware not registered");
  const read = [authMiddleware, labScopeMiddleware];
  const record = [authMiddleware, labScopeMiddleware, requireWriteAccess];
  const setup = [authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritamaintain")];
  const sqlite = () => (db as any).$client;
  const gate = (req: any, res: any): boolean => {
    if (hasTempLogAccess(req.user, req.scope?.lab)) return true;
    res.status(403).json({ error: "Temperature logs require a suite subscription" });
    return false;
  };
  const userName = (userId: number): string | null => {
    const u = sqlite().prepare("SELECT name, email FROM users WHERE id = ?").get(userId) as any;
    return u ? (u.name || u.email || null) : null;
  };
  const validateUnit = (b: any, partial: boolean): string | null => {
    if (!partial || b.name !== undefined) {
      if (!b.name || !String(b.name).trim()) return "name required";
      if (String(b.name).length > 120) return "name must be 120 characters or fewer";
    }
    if (b.unit_type !== undefined && !(TEMP_UNIT_TYPES as readonly string[]).includes(b.unit_type)) return `unit_type must be one of ${TEMP_UNIT_TYPES.join(", ")}`;
    if (b.scale !== undefined && !["C", "F"].includes(b.scale)) return "scale must be C or F";
    if (b.readings_per_day !== undefined && ![1, 2, 3].includes(Number(b.readings_per_day))) return "readings_per_day must be 1, 2 or 3";
    const min = b.min_value !== undefined ? num(b.min_value) : undefined;
    const max = b.max_value !== undefined ? num(b.max_value) : undefined;
    if (!partial && (min === null || max === null || min === undefined || max === undefined)) return "min_value and max_value are required (the acceptable range from the manufacturer or your procedure)";
    if (min !== undefined && max !== undefined && min !== null && max !== null && min >= max) return "min_value must be below max_value";
    return null;
  };

  // Units with today's progress (lab calendar day) and the latest reading.
  app.get("/api/labs/:labId/temp-logs/units", ...read, (req: any, res: any) => {
    if (!gate(req, res)) return;
    const labId = req.scope.labId;
    const today = labLocalDate(new Date().toISOString());
    const units = sqlite().prepare("SELECT * FROM temp_log_units WHERE lab_id = ? AND active = 1 ORDER BY name").all(labId) as any[];
    const todayCount = sqlite().prepare("SELECT unit_id, COUNT(*) AS n, SUM(CASE WHEN in_range = 0 THEN 1 ELSE 0 END) AS out_n FROM temp_log_readings WHERE lab_id = ? AND reading_date = ? GROUP BY unit_id").all(labId, today) as any[];
    const byUnit = new Map(todayCount.map((r) => [r.unit_id, r]));
    const last = sqlite().prepare(
      `SELECT r.* FROM temp_log_readings r
         JOIN (SELECT unit_id, MAX(reading_date || ' ' || COALESCE(reading_time,'')) AS k FROM temp_log_readings WHERE lab_id = ? GROUP BY unit_id) m
           ON m.unit_id = r.unit_id AND (r.reading_date || ' ' || COALESCE(r.reading_time,'')) = m.k
        WHERE r.lab_id = ?`
    ).all(labId, labId) as any[];
    const lastBy = new Map(last.map((r) => [r.unit_id, r]));
    res.json({
      today,
      units: units.map((u) => ({
        ...u,
        today_count: (byUnit.get(u.id) as any)?.n ?? 0,
        today_out_of_range: (byUnit.get(u.id) as any)?.out_n ?? 0,
        last_reading: lastBy.get(u.id) || null,
      })),
    });
  });

  app.post("/api/labs/:labId/temp-logs/units", ...setup, (req: any, res: any) => {
    if (!gate(req, res)) return;
    const b = req.body || {};
    const err = validateUnit(b, false);
    if (err) return res.status(400).json({ error: err });
    const now = new Date().toISOString();
    const info = sqlite().prepare(
      `INSERT INTO temp_log_units (lab_id, name, unit_type, location, min_value, max_value, scale, readings_per_day, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(req.scope.labId, String(b.name).trim(), b.unit_type || "refrigerator", b.location ? String(b.location).trim().slice(0, 120) : null,
      num(b.min_value), num(b.max_value), b.scale || "C", Number(b.readings_per_day || 1), now, now);
    res.status(201).json(sqlite().prepare("SELECT * FROM temp_log_units WHERE id = ?").get(info.lastInsertRowid));
  });

  app.put("/api/labs/:labId/temp-logs/units/:id", ...setup, (req: any, res: any) => {
    if (!gate(req, res)) return;
    const id = Number(req.params.id);
    const u = sqlite().prepare("SELECT * FROM temp_log_units WHERE id = ? AND lab_id = ?").get(id, req.scope.labId) as any;
    if (!u) return res.status(404).json({ error: "Storage unit not found in this lab" });
    const b = req.body || {};
    const err = validateUnit({ ...b, min_value: b.min_value ?? u.min_value, max_value: b.max_value ?? u.max_value }, true);
    if (err) return res.status(400).json({ error: err });
    sqlite().prepare(
      `UPDATE temp_log_units SET name = ?, unit_type = ?, location = ?, min_value = ?, max_value = ?, scale = ?, readings_per_day = ?, active = ?, updated_at = ? WHERE id = ?`
    ).run(b.name !== undefined ? String(b.name).trim() : u.name, b.unit_type ?? u.unit_type, b.location !== undefined ? (b.location ? String(b.location).trim().slice(0, 120) : null) : u.location,
      b.min_value !== undefined ? num(b.min_value) : u.min_value, b.max_value !== undefined ? num(b.max_value) : u.max_value, b.scale ?? u.scale,
      b.readings_per_day !== undefined ? Number(b.readings_per_day) : u.readings_per_day, b.active !== undefined ? (b.active ? 1 : 0) : u.active, new Date().toISOString(), id);
    res.json(sqlite().prepare("SELECT * FROM temp_log_units WHERE id = ?").get(id));
  });

  // Record a reading. Recording work, open to every active member. Out of range => corrective action required.
  app.post("/api/labs/:labId/temp-logs/units/:id/readings", ...record, (req: any, res: any) => {
    if (!gate(req, res)) return;
    const id = Number(req.params.id);
    const u = sqlite().prepare("SELECT * FROM temp_log_units WHERE id = ? AND lab_id = ?").get(id, req.scope.labId) as any;
    if (!u) return res.status(404).json({ error: "Storage unit not found in this lab" });
    if (!u.active) return res.status(400).json({ error: "This storage unit is retired" });
    const b = req.body || {};
    const now = new Date().toISOString();
    const today = labLocalDate(now);
    const date = b.reading_date ? String(b.reading_date) : today;
    if (!isIsoDay(date)) return res.status(400).json({ error: "reading_date must be YYYY-MM-DD" });
    if (date > today) return res.status(400).json({ error: "reading_date cannot be in the future" });
    const time = b.reading_time ? String(b.reading_time) : null;
    if (time && !isHhMm(time)) return res.status(400).json({ error: "reading_time must be HH:MM" });
    const value = num(b.value);
    if (value === null) return res.status(400).json({ error: "value (the temperature read) is required" });
    const initials = String(b.initials || "").trim();
    if (!initials) return res.status(400).json({ error: "initials required" });
    if (initials.length > 8) return res.status(400).json({ error: "initials must be 8 characters or fewer" });
    const inRange = readingInRange(value, u.min_value, u.max_value);
    const corrective = String(b.corrective_action || "").trim();
    if (!inRange && !corrective) {
      return res.status(400).json({ error: "Out of range: record the corrective action taken (for example, moved contents, called facilities, re-checked at a time)", code: "CORRECTIVE_ACTION_REQUIRED" });
    }
    const info = sqlite().prepare(
      `INSERT INTO temp_log_readings (lab_id, unit_id, reading_date, reading_time, value, in_range, initials, recorded_by_user_id, recorded_by_name, corrective_action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.scope.labId, id, date, time, value, inRange ? 1 : 0, initials.toUpperCase(), req.userId, userName(req.userId), corrective || null, now);
    res.status(201).json(sqlite().prepare("SELECT * FROM temp_log_readings WHERE id = ?").get(info.lastInsertRowid));
  });

  // One unit's log for a month (YYYY-MM, default the lab's current month), oldest first: the printed-log view.
  app.get("/api/labs/:labId/temp-logs/units/:id/readings", ...read, (req: any, res: any) => {
    if (!gate(req, res)) return;
    const id = Number(req.params.id);
    const u = sqlite().prepare("SELECT * FROM temp_log_units WHERE id = ? AND lab_id = ?").get(id, req.scope.labId) as any;
    if (!u) return res.status(404).json({ error: "Storage unit not found in this lab" });
    const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : labLocalDate(new Date().toISOString()).slice(0, 7);
    const rows = sqlite().prepare(
      "SELECT * FROM temp_log_readings WHERE unit_id = ? AND lab_id = ? AND substr(reading_date, 1, 7) = ? ORDER BY reading_date, reading_time, id"
    ).all(id, req.scope.labId, month);
    res.json({ unit: u, month, readings: rows });
  });
}
