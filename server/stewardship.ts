// server/stewardship.ts
//
// VeritaQA(TM) Stewardship tab: the laboratory's share of the hospital's antibiotic stewardship program (parking lot #81,
// docs/ANTIMICROBIAL_STEWARDSHIP_SCOPE.md; Michael 2026-11-23, Decision 14 = 2, the minimum version):
//   - the cumulative antibiogram, from the LIS's aggregate totals (manual entry or a CSV upload), kept as versions: a released
//     antibiogram is locked, and a new version starts as a draft copy of it;
//   - the lab's settings (fewest isolates to report a percent, suppress or flag below it, the analysis period, the first-isolate
//     note), pending confirmation against CLSI M39 ED5 (2022): see shared/antibiogramRules.ts;
//   - the committee participation log, with action items;
//   - the readiness view, CFR rows only (42 CFR 482.42(b)(2)(i), 485.640(b)(2)(i)).
// No patient field exists anywhere here; an upload with any unknown column is refused by name.
//
// Lab-scoped (labScopeMiddleware, req.scope.labId), so a sister lab's path is refused like every other lab route. Writes need
// write access and VeritaQA edit (requireModuleEdit('veritabench'), the same key as every PI write); the settings, like the
// tissue retention period, only the lab's owner or an admin. The signed antibiogram PDF waits on Michael's approval of the mock
// (VeritaQA_Antibiogram_MOCK_2026-11-23.pdf); until then the release is recorded here and the Excel copy is the export.

import type { Express } from "express";
import { db } from "./db";
import { logAudit, type AuditAction } from "./audit";
import { hasOpsAccess } from "./veritabench";
import { blockNonOperatorSeat } from "./seatAccess";
import { labLocalDate, labTimeZoneById, labToday } from "./dateLocal";
import { storePdfToken } from "./pdfTokens";
import { generateAntibiogramExcel } from "./stewardshipExport";
import { antibiogramPdfFilename, generateAntibiogramPDF } from "./antibiogramPdf";
import {
  CFR_AS_OF, CFR_STEWARDSHIP, M39_PENDING_NOTE, STEWARDSHIP_DEFAULTS, computeAntibiogram, findCsvPhi, findStewardshipPhi, isYmd, parseAntibiogramCsv, parseSettings,
  stewardshipPhiMessage,
  stewardshipReadiness, validateRows, type AbgRow, type BelowThresholdMode, type StewardshipSettings,
} from "../shared/antibiogramRules";

const sqliteOf = () => (db as any).$client;
const BASE = "/api/labs/:labId/veritaqa/stewardship";
const clean = (v: unknown, max = 200): string | null => {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const MAX_ROWS = 5000;

export function readStewardshipSettings(sqlite: any, labId: number): StewardshipSettings {
  const r = sqlite.prepare("SELECT * FROM stewardship_settings WHERE lab_id = ?").get(labId) as any;
  if (!r) return { ...STEWARDSHIP_DEFAULTS };
  return {
    isolate_threshold: Number(r.isolate_threshold) || STEWARDSHIP_DEFAULTS.isolate_threshold,
    below_threshold: r.below_threshold === "flag" ? "flag" : "suppress",
    period_months: Number(r.period_months) || STEWARDSHIP_DEFAULTS.period_months,
    first_isolate_note: r.first_isolate_note || STEWARDSHIP_DEFAULTS.first_isolate_note,
  };
}

function loadRows(sqlite: any, antibiogramId: number): AbgRow[] {
  return sqlite.prepare(
    "SELECT organism, organism_group, antimicrobial, tested, susceptible, intermediate, resistant FROM stewardship_antibiogram_rows WHERE antibiogram_id = ? ORDER BY sort_order ASC, id ASC"
  ).all(antibiogramId) as AbgRow[];
}

function replaceRows(sqlite: any, antibiogramId: number, labId: number, rows: AbgRow[]) {
  sqlite.prepare("DELETE FROM stewardship_antibiogram_rows WHERE antibiogram_id = ?").run(antibiogramId);
  const ins = sqlite.prepare(
    "INSERT INTO stewardship_antibiogram_rows (antibiogram_id, lab_id, sort_order, organism, organism_group, antimicrobial, tested, susceptible, intermediate, resistant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  rows.forEach((r, i) => ins.run(antibiogramId, labId, i, r.organism, r.organism_group, r.antimicrobial, r.tested, r.susceptible, r.intermediate, r.resistant));
}

/** The rule a version is shown with: a released one keeps the rule it was released under; a draft follows today's settings. */
function ruleFor(abg: any, settings: StewardshipSettings): { threshold: number; mode: BelowThresholdMode; note: string } {
  if (abg.status === "released" && abg.threshold_used) {
    return { threshold: Number(abg.threshold_used), mode: abg.below_threshold_used === "flag" ? "flag" : "suppress", note: abg.first_isolate_note_used || settings.first_isolate_note };
  }
  return { threshold: settings.isolate_threshold, mode: settings.below_threshold, note: settings.first_isolate_note };
}

export function loadAntibiogram(sqlite: any, labId: number, id: number) {
  const abg = sqlite.prepare("SELECT * FROM stewardship_antibiograms WHERE id = ? AND lab_id = ?").get(id, labId) as any;
  if (!abg) return null;
  const settings = readStewardshipSettings(sqlite, labId);
  const rows = loadRows(sqlite, id);
  const rule = ruleFor(abg, settings);
  const tz = labTimeZoneById(sqlite, labId);
  return {
    antibiogram: { ...abg, released_day: abg.released_at ? labLocalDate(abg.released_at, false, tz) : null },
    rows,
    rule,
    table: computeAntibiogram(rows, { threshold: rule.threshold, mode: rule.mode }),
  };
}

export function registerStewardshipRoutes(
  app: Express,
  authMiddleware: any,
  requireWriteAccess: any,
  requireModuleEdit: (mod: string) => any,
) {
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (!labScopeMiddleware) throw new Error("registerStewardshipRoutes: labScopeMiddleware not registered");
  const planGate = (req: any, res: any, next: any) => (hasOpsAccess(req.user, req.scope?.lab) ? next() : res.status(403).json({ error: "VeritaQA™ requires a suite subscription" }));
  // VeritaQA is a management view: a view-only seat or a Staff login is refused, as on every PI read (blockNonOperatorSeat).
  const operatorOnly = (req: any, res: any, next: any) => (blockNonOperatorSeat(req, res) ? undefined : next());
  const read = [authMiddleware, labScopeMiddleware, operatorOnly, planGate];
  // Every text in every write is refused on patient information, as tissue, the stain log and the digest do (where the platform
  // guard in the browser only warns): 400 PHI_REFUSED with the field and what it looks like, nothing stored. The upload's file is
  // checked cell by cell in its route, so the message names the line and column.
  const noPhi = (req: any, res: any, next: any) => {
    const hit = findStewardshipPhi(req.body, "", ["csv"]);
    if (hit) return res.status(400).json({ error: stewardshipPhiMessage(hit.labels), code: "PHI_REFUSED", field: hit.field, labels: hit.labels });
    next();
  };
  const edit = [authMiddleware, labScopeMiddleware, operatorOnly, requireWriteAccess, requireModuleEdit("veritabench"), planGate, noPhi];
  const ownerOrAdmin = (req: any) => req.scope?.role === "owner" || req.scope?.role === "admin";
  const audit = (req: any, action: AuditAction, entityType: string, entityId: number, label: string, before: unknown, after: unknown) => {
    try {
      logAudit({ userId: req.userId, ownerUserId: req.scope?.lab?.owner_user_id ?? req.userId, module: "veritaqa", action, entityType, entityId, entityLabel: label, before, after, ipAddress: req.ip });
    } catch { /* best-effort, as elsewhere */ }
  };
  const draftOr409 = (abg: any, res: any) => {
    if (abg.status !== "draft") { res.status(409).json({ error: "This antibiogram is released and locked. Start a new version to change it.", code: "RELEASED_LOCKED" }); return false; }
    return true;
  };

  // ── Settings ──────────────────────────────────────────────────────────
  app.get(`${BASE}/settings`, ...read, (req: any, res: any) => {
    res.json({ settings: readStewardshipSettings(sqliteOf(), req.scope.labId), defaults: STEWARDSHIP_DEFAULTS, pending_note: M39_PENDING_NOTE, can_edit: ownerOrAdmin(req) });
  });

  app.put(`${BASE}/settings`, ...edit, (req: any, res: any) => {
    if (!ownerOrAdmin(req)) return res.status(403).json({ error: "Only the lab's owner or an admin can change the antibiogram settings.", code: "OWNER_OR_ADMIN_ONLY" });
    const sqlite = sqliteOf();
    const labId = req.scope.labId;
    const before = readStewardshipSettings(sqlite, labId);
    const parsed = parseSettings(req.body || {}, before);
    if (!parsed.settings) return res.status(400).json({ error: parsed.error, code: "BAD_SETTINGS" });
    const s = parsed.settings;
    sqlite.prepare(
      `INSERT INTO stewardship_settings (lab_id, isolate_threshold, below_threshold, period_months, first_isolate_note, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(lab_id) DO UPDATE SET isolate_threshold = excluded.isolate_threshold, below_threshold = excluded.below_threshold,
         period_months = excluded.period_months, first_isolate_note = excluded.first_isolate_note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    ).run(labId, s.isolate_threshold, s.below_threshold, s.period_months, s.first_isolate_note, req.userId);
    audit(req, "update", "stewardship_settings", labId, `Antibiogram settings: ${s.isolate_threshold} isolates, ${s.below_threshold}, ${s.period_months} months`, before, s);
    res.json({ settings: s, defaults: STEWARDSHIP_DEFAULTS, pending_note: M39_PENDING_NOTE, can_edit: true });
  });

  // ── Antibiograms ──────────────────────────────────────────────────────
  app.get(`${BASE}/antibiograms`, ...read, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const tz = labTimeZoneById(sqlite, req.scope.labId);
    const items = (sqlite.prepare(
      `SELECT a.id, a.title, a.period_start, a.period_end, a.source_filter, a.status, a.version, a.previous_id, a.released_by_name, a.released_at, a.updated_at,
              (SELECT COUNT(*) FROM stewardship_antibiogram_rows r WHERE r.antibiogram_id = a.id) AS row_count
         FROM stewardship_antibiograms a WHERE a.lab_id = ? ORDER BY a.period_end DESC, a.version DESC, a.id DESC`
    ).all(req.scope.labId) as any[]).map((a) => ({ ...a, released_day: a.released_at ? labLocalDate(a.released_at, false, tz) : null }));
    res.json({ items });
  });

  app.post(`${BASE}/antibiograms`, ...edit, (req: any, res: any) => {
    const b = req.body || {};
    const title = clean(b.title, 160);
    if (!title) return res.status(400).json({ error: "Give the antibiogram a title, for example the year it covers." });
    if (!isYmd(b.period_start) || !isYmd(b.period_end)) return res.status(400).json({ error: "Enter the analysis period's first and last day." });
    if (b.period_end < b.period_start) return res.status(400).json({ error: "The period ends before it starts." });
    const sqlite = sqliteOf();
    const id = Number(sqlite.prepare(
      "INSERT INTO stewardship_antibiograms (lab_id, title, period_start, period_end, source_filter, data_source, status, version, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', 1, ?, datetime('now'), datetime('now'))"
    ).run(req.scope.labId, title, b.period_start, b.period_end, clean(b.source_filter, 200), clean(b.data_source, 200), req.userId).lastInsertRowid);
    audit(req, "create", "stewardship_antibiogram", id, `Antibiogram draft: ${title}`, null, { title, period_start: b.period_start, period_end: b.period_end });
    res.status(201).json({ id });
  });

  app.get(`${BASE}/antibiograms/:id`, ...read, (req: any, res: any) => {
    const out = loadAntibiogram(sqliteOf(), req.scope.labId, Number(req.params.id));
    if (!out) return res.status(404).json({ error: "That antibiogram isn't on this lab's list." });
    res.json(out);
  });

  app.put(`${BASE}/antibiograms/:id`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const abg = sqlite.prepare("SELECT * FROM stewardship_antibiograms WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!abg) return res.status(404).json({ error: "That antibiogram isn't on this lab's list." });
    if (!draftOr409(abg, res)) return;
    const b = req.body || {};
    const title = b.title !== undefined ? clean(b.title, 160) : abg.title;
    const ps = b.period_start !== undefined ? b.period_start : abg.period_start;
    const pe = b.period_end !== undefined ? b.period_end : abg.period_end;
    if (!title) return res.status(400).json({ error: "Give the antibiogram a title." });
    if (!isYmd(ps) || !isYmd(pe)) return res.status(400).json({ error: "Enter the analysis period's first and last day." });
    if (pe < ps) return res.status(400).json({ error: "The period ends before it starts." });
    const sf = b.source_filter !== undefined ? clean(b.source_filter, 200) : abg.source_filter;
    const ds = b.data_source !== undefined ? clean(b.data_source, 200) : abg.data_source;
    sqlite.prepare("UPDATE stewardship_antibiograms SET title = ?, period_start = ?, period_end = ?, source_filter = ?, data_source = ?, updated_at = datetime('now') WHERE id = ?").run(title, ps, pe, sf, ds, abg.id);
    res.json(loadAntibiogram(sqlite, req.scope.labId, abg.id));
  });

  // The grid: the whole set of rows, replaced. Every row is checked; nothing is saved if one is wrong.
  app.put(`${BASE}/antibiograms/:id/rows`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const abg = sqlite.prepare("SELECT * FROM stewardship_antibiograms WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!abg) return res.status(404).json({ error: "That antibiogram isn't on this lab's list." });
    if (!draftOr409(abg, res)) return;
    const raws = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!raws) return res.status(400).json({ error: "Send the rows." });
    if (raws.length > MAX_ROWS) return res.status(400).json({ error: `At most ${MAX_ROWS} rows.` });
    const { rows, errors } = validateRows(raws, 1);
    if (errors.length) return res.status(400).json({ error: "Some rows need fixing. Nothing was saved.", code: "BAD_ROWS", errors });
    sqlite.transaction(() => {
      replaceRows(sqlite, abg.id, req.scope.labId, rows);
      sqlite.prepare("UPDATE stewardship_antibiograms SET updated_at = datetime('now') WHERE id = ?").run(abg.id);
    })();
    res.json(loadAntibiogram(sqlite, req.scope.labId, abg.id));
  });

  // The LIS totals file, as text. preview: true checks and returns the table without saving.
  app.post(`${BASE}/antibiograms/:id/upload`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const abg = sqlite.prepare("SELECT * FROM stewardship_antibiograms WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!abg) return res.status(404).json({ error: "That antibiogram isn't on this lab's list." });
    if (!draftOr409(abg, res)) return;
    const text = typeof req.body?.csv === "string" ? req.body.csv : null;
    if (!text) return res.status(400).json({ error: "Choose the CSV file from the LIS antibiogram report." });
    if (text.length > 2_000_000) return res.status(400).json({ error: "The file is too large." });
    const csvPhi = findCsvPhi(text);
    if (csvPhi) return res.status(400).json({ error: stewardshipPhiMessage(csvPhi.labels), code: "PHI_REFUSED", field: csvPhi.field, labels: csvPhi.labels });
    const parsed = parseAntibiogramCsv(text);
    if (parsed.unknown_columns.length) return res.status(400).json({ error: parsed.errors[0].message, code: "UNKNOWN_COLUMNS", unknown_columns: parsed.unknown_columns, errors: parsed.errors });
    if (parsed.errors.length) return res.status(400).json({ error: "Some lines need fixing. Nothing was saved.", code: "BAD_ROWS", errors: parsed.errors });
    if (parsed.rows.length > MAX_ROWS) return res.status(400).json({ error: `At most ${MAX_ROWS} rows.` });
    const settings = readStewardshipSettings(sqlite, req.scope.labId);
    if (req.body?.preview) {
      return res.json({ preview: true, row_count: parsed.rows.length, rows: parsed.rows, table: computeAntibiogram(parsed.rows, { threshold: settings.isolate_threshold, mode: settings.below_threshold }) });
    }
    sqlite.transaction(() => {
      replaceRows(sqlite, abg.id, req.scope.labId, parsed.rows);
      sqlite.prepare("UPDATE stewardship_antibiograms SET updated_at = datetime('now') WHERE id = ?").run(abg.id);
    })();
    audit(req, "update", "stewardship_antibiogram", abg.id, `Antibiogram totals uploaded: ${abg.title} (${parsed.rows.length} rows)`, null, { row_count: parsed.rows.length });
    res.json({ ...loadAntibiogram(sqlite, req.scope.labId, abg.id), row_count: parsed.rows.length });
  });

  // Release: locks the version and keeps the rule it was released under. Who approved it, as typed.
  app.post(`${BASE}/antibiograms/:id/release`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const abg = sqlite.prepare("SELECT * FROM stewardship_antibiograms WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!abg) return res.status(404).json({ error: "That antibiogram isn't on this lab's list." });
    if (!draftOr409(abg, res)) return;
    const name = clean(req.body?.released_by_name, 120);
    const title = clean(req.body?.released_by_title, 120);
    if (!name || !title) return res.status(400).json({ error: "Enter the name and title of the medical director or designee who approved the release." });
    const n = (sqlite.prepare("SELECT COUNT(*) AS n FROM stewardship_antibiogram_rows WHERE antibiogram_id = ?").get(abg.id) as any).n;
    if (!n) return res.status(400).json({ error: "Enter or upload the totals before releasing." });
    const s = readStewardshipSettings(sqlite, req.scope.labId);
    sqlite.prepare(
      "UPDATE stewardship_antibiograms SET status = 'released', threshold_used = ?, below_threshold_used = ?, first_isolate_note_used = ?, released_by_name = ?, released_by_title = ?, released_by_user_id = ?, released_at = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(s.isolate_threshold, s.below_threshold, s.first_isolate_note, name, title, req.userId, new Date().toISOString(), abg.id);
    audit(req, "release", "stewardship_antibiogram", abg.id, `Antibiogram released: ${abg.title}, version ${abg.version}, approved by ${name}, ${title}`, { status: "draft" }, { status: "released", threshold: s.isolate_threshold, mode: s.below_threshold });
    res.json(loadAntibiogram(sqlite, req.scope.labId, abg.id));
  });

  // A new version: a draft copy of a released antibiogram (the released one stays as it was).
  app.post(`${BASE}/antibiograms/:id/new-version`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const abg = sqlite.prepare("SELECT * FROM stewardship_antibiograms WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!abg) return res.status(404).json({ error: "That antibiogram isn't on this lab's list." });
    if (abg.status !== "released") return res.status(409).json({ error: "This one is still a draft; change it directly.", code: "STILL_DRAFT" });
    const open = sqlite.prepare("SELECT id FROM stewardship_antibiograms WHERE lab_id = ? AND previous_id = ? AND status = 'draft'").get(req.scope.labId, abg.id) as any;
    if (open) return res.status(409).json({ error: "A draft of the next version is already open.", code: "DRAFT_EXISTS", id: open.id });
    const maxV = (sqlite.prepare("SELECT MAX(version) AS v FROM stewardship_antibiograms WHERE lab_id = ? AND title = ?").get(req.scope.labId, abg.title) as any).v || abg.version;
    const id = sqlite.transaction(() => {
      const newId = Number(sqlite.prepare(
        "INSERT INTO stewardship_antibiograms (lab_id, title, period_start, period_end, source_filter, data_source, status, version, previous_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, datetime('now'), datetime('now'))"
      ).run(req.scope.labId, abg.title, abg.period_start, abg.period_end, abg.source_filter, abg.data_source, maxV + 1, abg.id, req.userId).lastInsertRowid);
      replaceRows(sqlite, newId, req.scope.labId, loadRows(sqlite, abg.id));
      return newId;
    })();
    audit(req, "create", "stewardship_antibiogram", id, `Antibiogram new version: ${abg.title}, version ${maxV + 1}`, null, { previous_id: abg.id });
    res.status(201).json({ id });
  });

  // Only a draft can be deleted; a released antibiogram is the lab's record.
  app.delete(`${BASE}/antibiograms/:id`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const abg = sqlite.prepare("SELECT * FROM stewardship_antibiograms WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!abg) return res.status(404).json({ error: "That antibiogram isn't on this lab's list." });
    if (abg.status !== "draft") return res.status(409).json({ error: "A released antibiogram is kept as the lab's record and can't be deleted.", code: "RELEASED_KEPT" });
    sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM stewardship_antibiogram_rows WHERE antibiogram_id = ?").run(abg.id);
      sqlite.prepare("DELETE FROM stewardship_antibiograms WHERE id = ?").run(abg.id);
    })();
    audit(req, "delete", "stewardship_antibiogram", abg.id, `Antibiogram draft deleted: ${abg.title}, version ${abg.version}`, { title: abg.title }, null);
    res.json({ success: true });
  });

  app.post(`${BASE}/antibiograms/:id/xlsx`, ...read, async (req: any, res: any) => {
    const sqlite = sqliteOf();
    const out = loadAntibiogram(sqlite, req.scope.labId, Number(req.params.id));
    if (!out) return res.status(404).json({ error: "That antibiogram isn't on this lab's list." });
    const lab = sqlite.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(req.scope.labId) as any;
    try {
      const today = labToday(labTimeZoneById(sqlite, req.scope.labId));
      const buf = await generateAntibiogramExcel(out, { labName: lab?.lab_name ?? null, cliaNumber: lab?.clia_number ?? null, today });
      const safe = String(out.antibiogram.title).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Antibiogram";
      const filename = `VeritaQA_Antibiogram_${safe}_v${out.antibiogram.version}.xlsx`;
      res.json({ token: storePdfToken(buf, filename), filename });
    } catch (err: any) {
      console.error("[stewardship] antibiogram workbook failed:", err?.message || err);
      res.status(500).json({ error: "The workbook could not be built." });
    }
  });

  // The antibiogram as a PDF (Michael approved the mock 2026-11-23, with the standard review block). Exactly the antibiogram
  // read's reach (the same chain and loadAntibiogram on this lab), so another lab's id is the same 404. A draft prints DRAFT.
  app.get(`${BASE}/antibiograms/:id/pdf`, ...read, async (req: any, res: any) => {
    const sqlite = sqliteOf();
    const out = loadAntibiogram(sqlite, req.scope.labId, Number(req.params.id));
    if (!out) return res.status(404).json({ error: "That antibiogram isn't on this lab's list." });
    const lab = sqlite.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(req.scope.labId) as any;
    try {
      const generated = labToday(labTimeZoneById(sqlite, req.scope.labId));
      const { pdf } = await generateAntibiogramPDF(out, { labName: lab?.lab_name ?? null, cliaNumber: lab?.clia_number ?? null, generated });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${antibiogramPdfFilename(out.antibiogram)}"`);
      res.setHeader("Content-Length", pdf.length);
      res.send(pdf);
    } catch (err: any) {
      console.error("[stewardship] antibiogram PDF failed:", err?.message || err);
      res.status(500).json({ error: "The PDF could not be built." });
    }
  });

  // ── Committee participation log ───────────────────────────────────────
  const listMeetings = (labId: number) => {
    const sqlite = sqliteOf();
    const meetings = sqlite.prepare("SELECT * FROM stewardship_meetings WHERE lab_id = ? ORDER BY meeting_date DESC, id DESC").all(labId) as any[];
    const actions = sqlite.prepare("SELECT * FROM stewardship_actions WHERE lab_id = ? ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, due_date IS NULL, due_date ASC, id ASC").all(labId) as any[];
    return meetings.map((m) => ({ ...m, actions: actions.filter((a) => a.meeting_id === m.id) }));
  };
  const meetingFields = (b: any): { error?: string; v?: { meeting_date: string; lab_representative: string; minutes_link: string | null; notes: string | null } } => {
    if (!isYmd(b?.meeting_date)) return { error: "Enter the meeting date." };
    const rep = clean(b?.lab_representative, 120);
    if (!rep) return { error: "Enter who represented the laboratory." };
    const link = clean(b?.minutes_link, 500);
    if (link && !/^https?:\/\//i.test(link)) return { error: "The minutes link must start with http:// or https://." };
    return { v: { meeting_date: b.meeting_date, lab_representative: rep, minutes_link: link, notes: clean(b?.notes, 2000) } };
  };
  const actionFields = (b: any, partial = false): { error?: string; v?: Record<string, unknown> } => {
    const v: Record<string, unknown> = {};
    if (!partial || b?.action !== undefined) { const a = clean(b?.action, 500); if (!a) return { error: "Describe the action item." }; v.action = a; }
    if (!partial || b?.owner !== undefined) v.owner = clean(b?.owner, 120);
    if (!partial || b?.due_date !== undefined) {
      if (b?.due_date != null && b.due_date !== "" && !isYmd(b.due_date)) return { error: "The due date must be a date." };
      v.due_date = b?.due_date || null;
    }
    if (b?.status !== undefined) {
      if (b.status !== "open" && b.status !== "done") return { error: "Status is open or done." };
      v.status = b.status;
      if (b.status === "done") {
        if (b?.completed_on != null && b.completed_on !== "" && !isYmd(b.completed_on)) return { error: "The completed date must be a date." };
        v.completed_on = b?.completed_on || null;
      } else v.completed_on = null;
    }
    return { v };
  };

  app.get(`${BASE}/meetings`, ...read, (req: any, res: any) => res.json({ items: listMeetings(req.scope.labId) }));

  app.post(`${BASE}/meetings`, ...edit, (req: any, res: any) => {
    const f = meetingFields(req.body);
    if (!f.v) return res.status(400).json({ error: f.error });
    const id = Number(sqliteOf().prepare(
      "INSERT INTO stewardship_meetings (lab_id, meeting_date, lab_representative, minutes_link, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))"
    ).run(req.scope.labId, f.v.meeting_date, f.v.lab_representative, f.v.minutes_link, f.v.notes, req.userId).lastInsertRowid);
    audit(req, "create", "stewardship_meeting", id, `Stewardship committee meeting logged: ${f.v.meeting_date}`, null, f.v);
    res.status(201).json({ id });
  });

  app.put(`${BASE}/meetings/:id`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const m = sqlite.prepare("SELECT * FROM stewardship_meetings WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!m) return res.status(404).json({ error: "That meeting isn't on this lab's log." });
    const f = meetingFields({ ...m, ...(req.body || {}) });
    if (!f.v) return res.status(400).json({ error: f.error });
    sqlite.prepare("UPDATE stewardship_meetings SET meeting_date = ?, lab_representative = ?, minutes_link = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(f.v.meeting_date, f.v.lab_representative, f.v.minutes_link, f.v.notes, m.id);
    audit(req, "update", "stewardship_meeting", m.id, `Stewardship committee meeting changed: ${f.v.meeting_date}`, { meeting_date: m.meeting_date, lab_representative: m.lab_representative }, f.v);
    res.json({ success: true });
  });

  app.delete(`${BASE}/meetings/:id`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const m = sqlite.prepare("SELECT * FROM stewardship_meetings WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!m) return res.status(404).json({ error: "That meeting isn't on this lab's log." });
    sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM stewardship_actions WHERE meeting_id = ?").run(m.id);
      sqlite.prepare("DELETE FROM stewardship_meetings WHERE id = ?").run(m.id);
    })();
    audit(req, "delete", "stewardship_meeting", m.id, `Stewardship committee meeting removed: ${m.meeting_date}`, { meeting_date: m.meeting_date, lab_representative: m.lab_representative }, null);
    res.json({ success: true });
  });

  app.post(`${BASE}/meetings/:id/actions`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const m = sqlite.prepare("SELECT id FROM stewardship_meetings WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!m) return res.status(404).json({ error: "That meeting isn't on this lab's log." });
    const f = actionFields(req.body);
    if (!f.v) return res.status(400).json({ error: f.error });
    const id = Number(sqlite.prepare(
      "INSERT INTO stewardship_actions (meeting_id, lab_id, action, owner, due_date, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?, datetime('now'))"
    ).run(m.id, req.scope.labId, f.v.action, f.v.owner, f.v.due_date, req.userId).lastInsertRowid);
    res.status(201).json({ id });
  });

  app.put(`${BASE}/actions/:id`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const a = sqlite.prepare("SELECT * FROM stewardship_actions WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!a) return res.status(404).json({ error: "That action item isn't on this lab's log." });
    const f = actionFields(req.body || {}, true);
    if (!f.v) return res.status(400).json({ error: f.error });
    const keys = Object.keys(f.v);
    if (keys.length) sqlite.prepare(`UPDATE stewardship_actions SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => f.v![k]), a.id);
    res.json({ success: true });
  });

  app.delete(`${BASE}/actions/:id`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const a = sqlite.prepare("SELECT id FROM stewardship_actions WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!a) return res.status(404).json({ error: "That action item isn't on this lab's log." });
    sqlite.prepare("DELETE FROM stewardship_actions WHERE id = ?").run(a.id);
    res.json({ success: true });
  });

  // ── Readiness: CFR rows only ──────────────────────────────────────────
  app.get(`${BASE}/readiness`, ...read, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const labId = req.scope.labId;
    const tz = labTimeZoneById(sqlite, labId);
    const today = labToday(tz);
    const settings = readStewardshipSettings(sqlite, labId);
    const rel = sqlite.prepare("SELECT title, version, period_end, released_at FROM stewardship_antibiograms WHERE lab_id = ? AND status = 'released' ORDER BY released_at DESC, id DESC LIMIT 1").get(labId) as any;
    const lastMeeting = sqlite.prepare("SELECT MAX(meeting_date) AS d FROM stewardship_meetings WHERE lab_id = ?").get(labId) as any;
    const openActions = sqlite.prepare("SELECT due_date FROM stewardship_actions WHERE lab_id = ? AND status = 'open'").all(labId) as any[];
    const items = stewardshipReadiness({
      today, periodMonths: settings.period_months,
      lastReleased: rel ? { released_day: labLocalDate(rel.released_at, false, tz), period_end: rel.period_end, version: rel.version, title: rel.title } : null,
      lastMeetingDate: lastMeeting?.d ?? null,
      openActions,
    });
    res.json({ today, cfr: CFR_STEWARDSHIP, cfr_as_of: CFR_AS_OF, items });
  });
}
