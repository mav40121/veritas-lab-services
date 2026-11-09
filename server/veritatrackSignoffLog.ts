// server/veritatrackSignoffLog.ts
//
// VeritaTrack sign-off log (Michael 2026-11-09: "Does veritatrack hold a log of all historical sign offs and is it
// available to customers? Both of these need to be true because an inspector is going to ask for it.").
//
// One row per sign-off ever recorded for a lab's tasks:
//   - every task, including ones taken off the active list (active = 0, shown as "Removed")
//   - every veritatrack_signoffs row, whatever its date, so rows from before the audit trail (2026-06-12) show
//   - voided rows, marked, with who voided them, when and why (a sign-off is never removed now)
//   - sign-offs hard-deleted before the void rule, read back from the audit trail's "signoff_deleted" events, with the
//     completion date and performer the event's detail holds
// The lab is the TASK's lab (veritatrack_tasks.lab_id). A sign-off's own lab_id is not trusted for this: the VeritaMap import
// wrote sign-offs with no lab_id, and the boot backfill gave those the owner's home lab.
//
// The routes live in server/veritatrack.ts (registerVeritaTrackRoutes) beside the guards they share.

import { labLocalDate, labTimeZoneById, labToday } from "./dateLocal";

type SqliteLike = any;

export interface SignoffLogFilters {
  from: string | null;
  to: string | null;
  taskId: number | null;
  category: string | null;
}

export type SignoffLogEntry = "recorded" | "voided" | "deleted_before_void_rule";

export interface SignoffLogRow {
  key: string;
  entry: SignoffLogEntry;
  entry_label: "Recorded" | "Voided" | "Deleted before the void rule";
  signoff_id: number | null;
  task_id: number | null;
  task_name: string | null;
  category: string | null;
  frequency: string | null;
  task_state: "Active" | "Removed" | null;
  completed_date: string | null;
  performed_by: string | null;
  initials: string | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_at: string | null;      // lab-local "YYYY-MM-DD HH:MM"
  recorded_at_utc: string | null;  // ISO
  voided_at: string | null;        // lab-local
  voided_at_utc: string | null;
  voided_by: string | null;
  void_reason: string | null;
  deleted_at: string | null;       // lab-local
  deleted_at_utc: string | null;
  deleted_by: string | null;
}

export interface SignoffLog {
  lab: { id: number; name: string; clia: string; time_zone: string };
  today: string;
  filters: SignoffLogFilters;
  counts: { rows: number; recorded: number; voided: number; deleted_before_void_rule: number };
  rows: SignoffLogRow[];
  tasks: { id: number; name: string; category: string; active: boolean }[];
  categories: string[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The log's filters from a query string. Dates are completed dates, both ends included. */
export function parseSignoffLogFilters(q: any): { filters: SignoffLogFilters } | { error: string } {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const from = text(q?.from), to = text(q?.to), task = text(q?.task_id), category = text(q?.category);
  if (from && !DAY.test(from)) return { error: "from must be a date (YYYY-MM-DD)" };
  if (to && !DAY.test(to)) return { error: "to must be a date (YYYY-MM-DD)" };
  if (from && to && from > to) return { error: "The start date is after the end date" };
  let taskId: number | null = null;
  if (task && task !== "all") {
    taskId = Number(task);
    if (!Number.isInteger(taskId) || taskId <= 0) return { error: "task_id must be a task id" };
  }
  return { filters: { from, to, taskId, category: category && category !== "all" ? category : null } };
}

// SQLite's datetime('now') is UTC with a space and no zone; an ISO string is left as it is.
function isoOf(s: unknown): string | null {
  if (s == null || s === "") return null;
  const t = String(s).trim();
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t) ? t.replace(" ", "T") + "Z" : t;
}

/** "Removed sign-off dated 2026-05-15 (Pat Example)", the detail the old DELETE wrote. */
export function parseDeletedDetail(detail: unknown): { completed_date: string | null; performed_by: string | null } {
  const m = /^Removed sign-off dated (\S+)(?: \((.*)\))?\s*$/.exec(String(detail ?? ""));
  if (!m) return { completed_date: null, performed_by: null };
  return { completed_date: m[1].slice(0, 10), performed_by: m[2] ? m[2] : null };
}

function inRange(day: string | null, f: SignoffLogFilters): boolean {
  if (!f.from && !f.to) return true;
  if (!day) return false;
  if (f.from && day < f.from) return false;
  if (f.to && day > f.to) return false;
  return true;
}

export function buildSignoffLog(sqlite: SqliteLike, labId: number, f: SignoffLogFilters): SignoffLog {
  const tz = labTimeZoneById(sqlite, labId);
  const local = (iso: string | null) => (iso ? labLocalDate(iso, true, tz) : null);
  const labRow = sqlite.prepare(
    "SELECT l.lab_name, l.clia_number, u.clia_lab_name, u.clia_number AS owner_clia, u.name AS owner_name FROM labs l LEFT JOIN users u ON u.id = l.owner_user_id WHERE l.id = ?"
  ).get(labId) as any;

  const where: string[] = ["t.lab_id = ?"];
  const params: any[] = [labId];
  if (f.from) { where.push("substr(s.completed_date, 1, 10) >= ?"); params.push(f.from); }
  if (f.to) { where.push("substr(s.completed_date, 1, 10) <= ?"); params.push(f.to); }
  if (f.taskId) { where.push("t.id = ?"); params.push(f.taskId); }
  if (f.category) { where.push("t.category = ?"); params.push(f.category); }
  // Recorded by: the person the audit row names (the real signed-in person, where a seat's own user_id holds its owner),
  // and for a row from before the audit trail, the account on the sign-off.
  const signoffs = sqlite.prepare(`
    SELECT s.id, s.task_id, s.completed_date, s.performed_by, s.initials, s.notes, s.created_at, s.voided_at, s.void_reason,
           t.name AS task_name, t.category, t.frequency, t.active,
           COALESCE(ru.name, su.name) AS recorded_by, vu.name AS voided_by
      FROM veritatrack_signoffs s
      JOIN veritatrack_tasks t ON t.id = s.task_id
      LEFT JOIN users su ON su.id = s.user_id
      LEFT JOIN users ru ON ru.id = (
        SELECT a.by_user_id FROM veritatrack_audit a
         WHERE a.signoff_id = s.id AND a.task_id = s.task_id AND a.event = 'signoff_recorded'
         ORDER BY a.id LIMIT 1)
      LEFT JOIN users vu ON vu.id = s.voided_by_user_id
     WHERE ${where.join(" AND ")}
  `).all(...params) as any[];

  const rows: SignoffLogRow[] = signoffs.map((s) => {
    const voided = !!s.voided_at;
    const recordedIso = isoOf(s.created_at), voidedIso = isoOf(s.voided_at);
    return {
      key: `s${s.id}`,
      entry: voided ? "voided" : "recorded",
      entry_label: voided ? "Voided" : "Recorded",
      signoff_id: s.id,
      task_id: s.task_id,
      task_name: s.task_name ?? null,
      category: s.category ?? null,
      frequency: s.frequency ?? null,
      task_state: s.active === 1 ? "Active" : "Removed",
      completed_date: s.completed_date ? String(s.completed_date).slice(0, 10) : null,
      performed_by: s.performed_by || null,
      initials: s.initials || null,
      notes: s.notes || null,
      recorded_by: s.recorded_by || null,
      recorded_at: local(recordedIso),
      recorded_at_utc: recordedIso,
      voided_at: local(voidedIso),
      voided_at_utc: voidedIso,
      voided_by: voided ? (s.voided_by || null) : null,
      void_reason: voided ? (s.void_reason || null) : null,
      deleted_at: null,
      deleted_at_utc: null,
      deleted_by: null,
    };
  });

  // Hard deletions from before the void rule: only the audit trail holds them. The task's lab decides where one shows;
  // the event's own lab_id is the fallback for a task row that is gone.
  const dWhere: string[] = ["a.event = 'signoff_deleted'", "COALESCE(t.lab_id, a.lab_id) = ?"];
  const dParams: any[] = [labId];
  if (f.taskId) { dWhere.push("a.task_id = ?"); dParams.push(f.taskId); }
  if (f.category) { dWhere.push("t.category = ?"); dParams.push(f.category); }
  const deletions = sqlite.prepare(`
    SELECT a.id, a.task_id, a.signoff_id, a.detail, a.at, du.name AS deleted_by,
           t.name AS task_name, t.category, t.frequency, t.active
      FROM veritatrack_audit a
      LEFT JOIN veritatrack_tasks t ON t.id = a.task_id
      LEFT JOIN users du ON du.id = a.by_user_id
     WHERE ${dWhere.join(" AND ")}
  `).all(...dParams) as any[];
  for (const d of deletions) {
    const parsed = parseDeletedDetail(d.detail);
    if (!inRange(parsed.completed_date, f)) continue;
    const deletedIso = isoOf(d.at);
    rows.push({
      key: `d${d.id}`,
      entry: "deleted_before_void_rule",
      entry_label: "Deleted before the void rule",
      signoff_id: d.signoff_id ?? null,
      task_id: d.task_id ?? null,
      task_name: d.task_name ?? null,
      category: d.category ?? null,
      frequency: d.frequency ?? null,
      task_state: d.task_name == null ? null : d.active === 1 ? "Active" : "Removed",
      completed_date: parsed.completed_date,
      performed_by: parsed.performed_by,
      initials: null,
      notes: null,
      recorded_by: null,
      recorded_at: null,
      recorded_at_utc: null,
      voided_at: null,
      voided_at_utc: null,
      voided_by: null,
      void_reason: null,
      deleted_at: local(deletedIso),
      deleted_at_utc: deletedIso,
      deleted_by: d.deleted_by || null,
    });
  }

  // Newest completed date first; a row with no readable date goes last. Ties: the later entry first.
  const stamp = (r: SignoffLogRow) => r.recorded_at_utc || r.deleted_at_utc || "";
  rows.sort((a, b) => {
    if (a.completed_date !== b.completed_date) {
      if (!a.completed_date) return 1;
      if (!b.completed_date) return -1;
      return a.completed_date < b.completed_date ? 1 : -1;
    }
    const sa = stamp(a), sb = stamp(b);
    if (sa !== sb) return sa < sb ? 1 : -1;
    return a.key < b.key ? 1 : -1;
  });

  const tasks = (sqlite.prepare("SELECT id, name, category, active FROM veritatrack_tasks WHERE lab_id = ? ORDER BY name COLLATE NOCASE, id").all(labId) as any[])
    .map((t) => ({ id: t.id, name: t.name, category: t.category, active: t.active === 1 }));
  const categories = Array.from(new Set(tasks.map((t) => t.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));

  return {
    lab: {
      id: labId,
      name: labRow?.lab_name || labRow?.clia_lab_name || labRow?.owner_name || "Laboratory",
      clia: labRow?.clia_number || labRow?.owner_clia || "Not on file",
      time_zone: tz,
    },
    today: labToday(tz),
    filters: f,
    counts: {
      rows: rows.length,
      recorded: rows.filter((r) => r.entry === "recorded").length,
      voided: rows.filter((r) => r.entry === "voided").length,
      deleted_before_void_rule: rows.filter((r) => r.entry === "deleted_before_void_rule").length,
    },
    rows,
    tasks,
    categories,
  };
}

/** What the filters cover, in words, for the About sheet. */
export function describeSignoffLogFilters(log: SignoffLog): string {
  const f = log.filters;
  const dates = f.from && f.to ? `completed ${f.from} through ${f.to}` : f.from ? `completed on or after ${f.from}` : f.to ? `completed on or before ${f.to}` : "all completed dates";
  const task = f.taskId ? `task: ${log.tasks.find((t) => t.id === f.taskId)?.name ?? `#${f.taskId}`}` : "all tasks";
  const cat = f.category ? `category: ${f.category}` : "all categories";
  return `${dates}; ${task}; ${cat}`;
}

// Header and footer codes treat & as a control character.
const hf = (s: string) => s.replace(/&/g, "&&");

/** The customer-facing workbook: About first, then one Sign-off Log row per log row. CLAUDE.md section 6. */
export async function buildSignoffLogWorkbook(log: SignoffLog, applyLicense: (wb: any) => void): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Perplexity Computer";
  wb.created = new Date();
  const labName = log.lab.name, cliaNumber = log.lab.clia;
  const identity = `${labName}    CLIA: ${cliaNumber}`;
  const exportPwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";
  const border: any = {
    top: { style: "thin", color: { argb: "FFD0D0D0" } },
    bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
    left: { style: "thin", color: { argb: "FFD0D0D0" } },
    right: { style: "thin", color: { argb: "FFD0D0D0" } },
  };
  const header = `&L&"Calibri,Regular"&10VeritaTrack Sign-off Log&R&"Calibri,Regular"&10${hf(identity)}`;
  const footer = `&L&"Calibri,Regular"&9${hf(identity)}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;

  // ===== About (sheet 1), written for this workbook =====
  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const title = about.getCell("A1");
  title.value = "VeritaTrack™ Sign-off Log";
  title.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  about.getRow(1).height = 30;
  const idCell = about.getCell("A2");
  idCell.value = `Prepared for: ${identity}`;
  idCell.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF0A3A3D" } };
  idCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
  idCell.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
  idCell.border = border;
  about.getRow(2).height = 24;
  let r = 3;
  const section = (text: string) => {
    const c = about.getCell(`A${r}`);
    c.value = text;
    c.font = { name: "Calibri", bold: true, size: 12, color: { argb: "FF0A3A3D" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    c.border = border;
    about.getRow(r).height = 22; r += 1;
  };
  const body = (text: string) => {
    const c = about.getCell(`A${r}`);
    c.value = text;
    c.font = { name: "Calibri", size: 11, color: { argb: "FF28251D" } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    c.border = border;
    about.getRow(r).height = Math.max(20, (Math.floor(text.length / 100) + 1) * 16); r += 1;
  };
  const blank = () => { about.getRow(r).height = 8; r += 1; };
  const c = log.counts;
  section("About this workbook");
  body("The Sign-off Log sheet holds every sign-off recorded in VeritaTrack for this laboratory within the filters below, one row per sign-off: the date the task was completed, the task with its category and frequency, who performed it, the initials and notes entered, the VeritaAssure account that recorded it, and when it was recorded. It includes tasks that have since been removed from the active list (Task State: Removed), sign-offs that were voided (Entry Status: Voided, with who voided it, when, and the reason given), and sign-offs deleted before VeritaTrack kept voided entries (Entry Status: Deleted before the void rule).");
  blank();
  section("What this export covers");
  body(`Filters: ${describeSignoffLogFilters(log)}. Rows: ${c.rows} (${c.recorded} recorded, ${c.voided} voided, ${c.deleted_before_void_rule} deleted before the void rule). Exported ${log.today}. Times are the laboratory's local time (${log.lab.time_zone}).`);
  blank();
  section("How to use this workbook");
  body("The Sign-off Log sheet is sorted by completed date, newest first. Filter Entry Status to Recorded to see the sign-offs that count toward each task's schedule; a voided sign-off stays on the log but does not count toward a task's status or next due date. Filter Task or Category to answer a question about one task. Performed By and Initials are what was typed when the sign-off was entered; Recorded By is the account that entered it.");
  blank();
  section("What is recorded");
  body("VeritaTrack keeps each sign-off as it was entered and no longer removes one: a mistaken sign-off is voided with a reason and stays on this log. Before that rule a sign-off could be deleted. Deletions made on or after June 12, 2026 were written to VeritaTrack's audit trail with the completion date and the performer, and they appear here as Deleted before the void rule with who deleted them and when. A deletion made before June 12, 2026 left no record and cannot appear. Sign-offs recorded before June 12, 2026 that were never deleted are on this log; their Recorded By is the account on the sign-off.");
  blank();
  section("Disclaimer");
  body("This workbook lists what was entered in VeritaTrack. It does not confirm that the work was performed competently, that the recorded initials belong to the named person, or that the procedure followed the laboratory's SOP. The laboratory's own source records (paper logs, instrument printouts, LIS records) remain the source if they differ from this log. VeritaAssure does not certify regulatory compliance and does not advise on whether a given sign-off satisfies a specific accreditation standard.");
  blank();
  section("Lab identity");
  body(`This workbook was prepared for ${labName} (CLIA ${cliaNumber}). The lab name and CLIA appear on every printed page header and footer.`);
  blank();
  section("Coverage gaps");
  body("If your laboratory needs a column or view not represented here, please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision.");
  about.headerFooter.oddHeader = header;
  about.headerFooter.oddFooter = footer;
  await about.protect(exportPwd, {
    selectLockedCells: false, selectUnlockedCells: false,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false,
    deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: false, pivotTables: false,
  });

  // ===== Sign-off Log =====
  const ws = wb.addWorksheet("Sign-off Log");
  const cols: Array<[string, number]> = [
    ["Completed Date", 14], ["Task", 40], ["Category", 24], ["Frequency", 12], ["Task State", 11],
    ["Performed By", 20], ["Initials", 9], ["Notes", 32], ["Recorded By", 20], ["Recorded At", 17],
    ["Entry Status", 18], ["Voided or Deleted At", 17], ["Voided or Deleted By", 20], ["Void Reason", 32],
  ];
  ws.columns = cols.map(([h, w], i) => ({ header: h, key: `c${i}`, width: w }));
  const head = ws.getRow(1);
  head.height = 20;
  head.eachCell((cell) => {
    cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = border;
  });
  const v = (x: string | null | undefined) => (x == null ? "" : x);
  const GREEN = "FF437A22", RED = "FFA12C7B", GRAY = "FF7A7974";
  log.rows.forEach((row, i) => {
    const out = ws.addRow([
      v(row.completed_date), v(row.task_name), v(row.category), v(row.frequency), v(row.task_state),
      v(row.performed_by), v(row.initials), v(row.notes), v(row.recorded_by), v(row.recorded_at),
      row.entry_label, v(row.voided_at ?? row.deleted_at), v(row.voided_by ?? row.deleted_by), v(row.void_reason),
    ]);
    const even = (i + 2) % 2 === 0;
    out.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF28251D" } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: even ? "FFEBF3F8" : "FFFFFFFF" } };
      cell.border = border;
      if (col === 5) {
        if (cell.value === "Active") cell.font = { name: "Calibri", bold: true, size: 10, color: { argb: GREEN } };
        else if (cell.value === "Removed") cell.font = { name: "Calibri", bold: true, size: 10, color: { argb: GRAY } };
      }
      if (col === 11) {
        const color = row.entry === "recorded" ? GREEN : row.entry === "voided" ? GRAY : RED;
        cell.font = { name: "Calibri", bold: true, size: 10, color: { argb: color } };
      }
    });
  });
  ws.views = [{ state: "frozen" as const, xSplit: 2, ySplit: 1, topLeftCell: "C2" }];
  ws.autoFilter = { from: "A1", to: ws.getCell(1, cols.length).address };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" } as any;
  ws.headerFooter.oddHeader = header;
  ws.headerFooter.oddFooter = footer;
  await ws.protect(exportPwd, {
    selectLockedCells: true, selectUnlockedCells: true,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false,
    deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: true, pivotTables: false,
  });

  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" }];
  applyLicense(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
