// server/qcFileImport.ts
//
// VeritaQC: control results from a CSV or Excel export of an analyzer, middleware or LIS (B12, 2026-11-24). Reading the file is
// shared/qcImportRules.ts; storing and judging a run is server/qcRuns.ts, the code a typed run goes through.
//
//   - Nothing is stored before a preview. Every row is ready, a duplicate, or can't be placed, with the reason beside it. The import
//     names the counts and the file's hash it was shown; the server works them out again and refuses when they changed (409).
//   - Nothing is guessed. A name that isn't one this lab has (case and spaces aside) is offered as a choice a person makes; the choice
//     is remembered for that lab and that place only (a test name for its analyzer, a level for its test, a lot for its test and level).
//   - An imported run is judged as a typed one: in the lot's order (date, then entry), so a row dated before runs already on file is
//     judged against the runs before it and changes no verdict already stored. The rows of a file go in by date and time.
//   - The file is never kept: its name, its SHA-256, the row each run came from and the row numbers left out are.
//   - A whole import can be taken back, by the module's void, for the runs with no corrective action and no signed review on them.
//   - A file with a column that looks like patient information is refused by naming the column, and one with a cell that does by naming
//     the line and column (shared/phiPatterns.ts), the way the antibiogram upload does.
//
// VeritaQC edit on every route (a Staff login and a view-only seat get none of it). Veritas support sets up mappings and names and is
// refused the import and taking one back (server/vlsSupport.ts).

import crypto from "crypto";
import type { Express } from "express";
import { db } from "./db";
import { logAudit } from "./audit";
import { labTimeZoneById } from "./dateLocal";
import { vlsContext } from "./vlsSupport";
import { loadLotRuns, type LotRuns } from "./qcWestgard";
import { addedAfterReview, insertQcRun, judgeQcRun, momentMs, qcRunSettings, signedMonthOf, signedMonths, voidQcRun, type QcRunSettings } from "./qcRuns";
import { detectPhi } from "../shared/phiPatterns";
import {
  cellText, csvDelimiter, dataRowCount, headerLabels, likelyHeaderRow, missingColumns, nameKey, parseDelimited, patientColumn, readMapping, readRuns, sameTime, wallClock,
  NAME_KIND_LABEL, QC_IMPORT_COMMENT_MAX, QC_IMPORT_MAX_HEADER_ROW, QC_IMPORT_MAX_MB, QC_IMPORT_MAX_ROWS, QC_IMPORT_TEXT_MAX,
  type Cell, type Grid, type ImportCounts, type NameKind, type QcImportMapping, type RawRun, type RowOutcome,
} from "../shared/qcImportRules";

type Sqlite = any;
const BASE = "/api/labs/:labId/qc/file-imports";
const MAX_COLUMNS = 300;
const MAX_UNZIPPED = 100 * 1024 * 1024;

class ImportRefused extends Error {
  constructor(message: string, public code: string, public status = 400, public extra: Record<string, any> = {}) { super(message); }
}

// ── Reading the file ──────────────────────────────────────────────────────────────────────────────────────────────────

/** How large a workbook is once opened, from its own directory, so one too large to hold is refused first. */
function unzippedSize(buf: Buffer): number {
  const from = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= from; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return Infinity;
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16), total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) return Infinity;
    total += buf.readUInt32LE(at + 24);
    at += 46 + buf.readUInt16LE(at + 28) + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return total;
}

const p2 = (n: number) => String(n).padStart(2, "0");
function excelCell(cell: any): Cell {
  let v = cell.value;
  if (v && typeof v === "object" && !(v instanceof Date) && ("formula" in v || "sharedFormula" in v)) v = v.result; // a formula reads as its value
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const ms = v.getTime();
    if (!Number.isFinite(ms)) return { error: "#VALUE!" };
    const d = new Date(Math.round(ms / 1000) * 1000); // Excel keeps times as fractions of a day
    const ymd = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
    const fmt = String(cell.numFmt ?? "").replace(/\[[^\]]*]/g, "").replace(/"[^"]*"/g, "");
    if (!/[hs]/i.test(fmt)) return { date: ymd, time: "" };
    const s = d.getUTCSeconds();
    return { date: ymd, time: `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}${s ? `:${p2(s)}` : ""}` };
  }
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (Array.isArray(v.richText)) return v.richText.map((t: any) => t.text ?? "").join("");
  if (v.error) return { error: String(v.error) };
  if ("text" in v) return typeof v.text === "string" ? v.text : Array.isArray(v.text?.richText) ? v.text.richText.map((t: any) => t.text ?? "").join("") : String(v.text ?? "");
  return String(v);
}

function decodeText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  if (buf.subarray(0, 8192).includes(0)) throw new ImportRefused("That file isn't text. Use a CSV or an Excel (.xlsx) file.", "BAD_FILE");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("windows-1252").decode(buf); }
}

export interface FileGrid { kind: "csv" | "xlsx"; sheets: string[]; sheet: string | null; grid: Grid }

export async function readFileGrid(buf: Buffer, sheetName: string | null): Promise<FileGrid> {
  if (!buf.length) throw new ImportRefused("The file is empty.", "BAD_FILE");
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0xd0cf11e0) throw new ImportRefused("That is an older Excel file or one with a password. Save it as .xlsx without a password, or as CSV.", "BAD_FILE");
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
    if (unzippedSize(buf) > MAX_UNZIPPED) throw new ImportRefused("The workbook is too large to open. Save the sheet as CSV, or split the file.", "FILE_TOO_LARGE");
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    try { await (wb.xlsx as any).load(buf, { ignoreNodes: ["dataValidations", "conditionalFormatting", "drawing", "legacyDrawing", "picture", "tableParts", "hyperlinks"] }); } catch { throw new ImportRefused("That file couldn't be read as an Excel workbook.", "BAD_FILE"); }
    const sheets = wb.worksheets.map((s: any) => String(s.name));
    const ws = sheetName ? wb.worksheets.find((s: any) => nameKey(s.name) === nameKey(sheetName)) : wb.worksheets[0];
    if (!ws) throw new ImportRefused(sheetName ? `The workbook has no sheet named "${sheetName}".` : "The workbook has no sheets.", "BAD_FILE", 400, { sheets });
    const grid: Grid = [];
    let filled = 0;
    ws.eachRow({ includeEmpty: false }, (row: any, n: number) => {
      const cells: Cell[] = [];
      const width = Math.min(row.cellCount, MAX_COLUMNS);
      for (let c = 1; c <= width; c++) cells.push(excelCell(row.getCell(c)));
      if (cells.every((c) => c === null || c === "")) return;
      if (++filled > QC_IMPORT_MAX_ROWS + QC_IMPORT_MAX_HEADER_ROW) throw new ImportRefused(tooMany(), "TOO_MANY_ROWS");
      grid[n - 1] = cells;
    });
    return { kind: "xlsx", sheets, sheet: String(ws.name), grid };
  }
  const text = decodeText(buf);
  const rows = parseDelimited(text, csvDelimiter(text), QC_IMPORT_MAX_ROWS * 4);
  if (rows.length > QC_IMPORT_MAX_ROWS * 4) throw new ImportRefused(tooMany(), "TOO_MANY_ROWS");
  return { kind: "csv", sheets: [], sheet: null, grid: rows.map((r) => r.slice(0, MAX_COLUMNS)) };
}

const tooMany = () => `The file has more than ${QC_IMPORT_MAX_ROWS.toLocaleString("en-US")} results. Split it and import each part.`;

/** The headers of the chosen row, after the checks that refuse a file: the header row, patient information, too many rows. */
function checkedHeaders(file: FileGrid, headerRow: number): string[] {
  const { grid } = file;
  const row = grid[headerRow - 1] ?? [];
  if (!row.some((c) => cellText(c))) throw new ImportRefused(`Row ${headerRow} is blank, so it can't be the header row.`, "BAD_HEADER_ROW");
  if (dataRowCount(grid, headerRow) > QC_IMPORT_MAX_ROWS) throw new ImportRefused(tooMany(), "TOO_MANY_ROWS");
  let width = 0;
  for (const r of grid) if (r && r.length > width) width = r.length;
  const labels = headerLabels(row, width);
  const column = patientColumn(row);
  if (column) {
    throw new ImportRefused(`The column "${column}" looks like patient information. A control results file holds no patient's details. Remove that column and upload again.`, "PHI_COLUMN", 400, { column });
  }
  for (let r = 0; r < grid.length; r++) {
    const cells = grid[r];
    if (!cells) continue;
    for (let c = 0; c < cells.length; c++) {
      if (typeof cells[c] !== "string" || (cells[c] as string).length < 8) continue; // nothing the detectors match is shorter
      const found = detectPhi(cells[c] as string);
      if (found.length) {
        const what = found.map((l) => l.toLowerCase().replace("labeled ", "")).join(" and ");
        const field = `line ${r + 1}, ${r < headerRow ? `column ${c + 1}` : labels[c]}`;
        throw new ImportRefused(`${field[0].toUpperCase()}${field.slice(1)} looks like patient information (${what}). Remove it and upload again.`, "PHI_REFUSED", 400, { field, labels: found });
      }
    }
  }
  return labels;
}

// ── The lab's names ───────────────────────────────────────────────────────────────────────────────────────────────────

interface LabLot { id: number; analyte: string; level: string; lot_number: string; status: string; expiration_date: string | null; aKey: string; lvKey: string; lotKey: string }
interface LabInstrument { id: number | null; name: string; label: string; keys: string[] }
interface LabNames { lots: LabLot[]; instruments: LabInstrument[]; choices: Map<string, { target: string; map_instrument_id: number | null }> }

const choiceKey = (kind: NameKind, fileKey: string, contextKey: string) => `${kind}\u0000${fileKey}\u0000${contextKey}`;

function loadLabNames(sqlite: Sqlite, labId: number): LabNames {
  const lots = (sqlite.prepare("SELECT id, analyte, level, lot_number, status, expiration_date FROM qc_control_lots WHERE lab_id = ? ORDER BY analyte, level, id").all(labId) as any[])
    .map((l) => ({ ...l, aKey: nameKey(l.analyte), lvKey: nameKey(l.level), lotKey: nameKey(l.lot_number) }));
  const mapped = sqlite.prepare(
    `SELECT i.id, i.instrument_name, i.nickname, i.serial_number, m.name AS map_name
       FROM veritamap_instruments i JOIN veritamap_maps m ON m.id = i.map_id WHERE m.lab_id = ? ORDER BY i.instrument_name, i.id`
  ).all(labId) as any[];
  const instruments: LabInstrument[] = mapped.map((i) => ({
    id: i.id, name: i.nickname || i.instrument_name,
    label: `${i.nickname ? `${i.nickname} (${i.instrument_name})` : i.instrument_name}${i.serial_number ? `, SN ${i.serial_number}` : ""}${i.map_name ? `, ${i.map_name}` : ""}`,
    keys: [i.instrument_name, i.nickname, i.nickname ? `${i.nickname} (${i.instrument_name})` : null].filter(Boolean).map(nameKey),
  }));
  const known = new Set(instruments.flatMap((i) => i.keys));
  for (const r of sqlite.prepare("SELECT DISTINCT TRIM(instrument) AS name FROM qc_results WHERE lab_id = ? AND map_instrument_id IS NULL AND TRIM(COALESCE(instrument, '')) <> '' ORDER BY name").all(labId) as any[]) {
    const k = nameKey(r.name);
    if (known.has(k)) continue;
    known.add(k);
    instruments.push({ id: null, name: r.name, label: `${r.name} (typed on earlier runs)`, keys: [k] });
  }
  const choices = new Map<string, { target: string; map_instrument_id: number | null }>();
  for (const c of sqlite.prepare("SELECT kind, file_key, context_key, target, map_instrument_id FROM qc_import_names WHERE lab_id = ?").all(labId) as any[]) {
    choices.set(choiceKey(c.kind, c.file_key, c.context_key), { target: c.target, map_instrument_id: c.map_instrument_id });
  }
  return { lots, instruments, choices };
}

interface PlacedInstrument { id: number | null; name: string; key: string; keys: string[] }
/** The analyzer a file's name means, or null when a person has to choose. */
function placeInstrument(text: string, names: LabNames): PlacedInstrument | null {
  const k = nameKey(text);
  const asPlaced = (i: LabInstrument): PlacedInstrument => ({ id: i.id, name: i.name, key: i.id ? `i:${i.id}` : `t:${nameKey(i.name)}`, keys: i.keys });
  const exact = names.instruments.filter((i) => i.keys.includes(k));
  if (exact.length === 1) return asPlaced(exact[0]);
  const choice = names.choices.get(choiceKey("instrument", k, ""));
  if (!choice) return null;
  if (choice.map_instrument_id) {
    const i = names.instruments.find((x) => x.id === choice.map_instrument_id);
    return i ? asPlaced(i) : null; // the analyzer has left the test menu: choose again
  }
  const key = nameKey(choice.target);
  const same = names.instruments.find((i) => !i.id && i.keys.includes(key));
  return same ? asPlaced(same) : { id: null, name: choice.target, key: `t:${key}`, keys: [key] };
}

interface NameOption { value: string; label: string; map_instrument_id?: number }
interface NameContext { context_key: string; label: string; rows: number; options: NameOption[] }
export interface UnplacedName { kind: NameKind; text: string; file_key: string; group: string; rows: number; contexts: NameContext[] }

export interface PlannedRow {
  row: number; column: string | null; outcome: RowOutcome; reason: string | null;
  lot_id: number | null; analyte: string; level: string; lot: string; instrument: string; map_instrument_id: number | null;
  date: string | null; time: string | null; value: number | null; operator: string | null; comment: string | null; notes: string[];
}

export interface ImportPlan {
  counts: ImportCounts;
  rows: PlannedRow[];
  names: UnplacedName[];
  notes: { backdated: number; same_day: number; after_review: Array<{ analyte: string; level: string; lot: string; month: string; reviewed_by: string | null; reviewed_at: string; rows: number }>; inactive_lot: number; past_expiration: number; maybe_same: number };
}

const uniqueBy = <T,>(items: T[], key: (t: T) => string): T[] => { const seen = new Set<string>(); return items.filter((t) => { const k = key(t); if (seen.has(k)) return false; seen.add(k); return true; }); };

/** What an import of these runs would do: each row's outcome, the names to choose, and what a person should know first. Writes nothing. */
export function planImport(sqlite: Sqlite, labId: number, runs: RawRun[], tz: string, now = new Date()): ImportPlan {
  const names = loadLabNames(sqlite, labId);
  const today = wallClock(now.getTime(), tz);
  const nowText = `${today.date} ${today.time.slice(0, 5)}`;
  const unplaced = new Map<string, UnplacedName & { byContext: Map<string, NameContext> }>();
  const ask = (kind: NameKind, text: string, group: string, contextKey: string, label: string, options: () => NameOption[]) => {
    const fileKey = nameKey(text), k = `${kind}\u0000${fileKey}\u0000${group}`;
    let u = unplaced.get(k);
    if (!u) { u = { kind, text, file_key: fileKey, group, rows: 0, contexts: [], byContext: new Map() }; unplaced.set(k, u); }
    u.rows++;
    let c = u.byContext.get(contextKey);
    if (!c) { c = { context_key: contextKey, label, rows: 0, options: options() }; u.byContext.set(contextKey, c); u.contexts.push(c); }
    c.rows++;
  };
  const quoted = (kind: NameKind, text: string, rest: string) => `${NAME_KIND_LABEL[kind]} "${text.slice(0, 60)}" ${rest}`;

  const rows: PlannedRow[] = runs.map((r) => {
    const when = "date" in r.when ? r.when : null;
    const value = "value" in r.value ? r.value.value : null;
    const out: PlannedRow = {
      row: r.row, column: r.column, outcome: "unplaced", reason: null, lot_id: null, analyte: r.analyte, level: r.level, lot: r.lot, instrument: r.instrument,
      map_instrument_id: null, date: when?.date ?? null, time: when?.time ?? null, value, operator: r.operator, comment: r.comment, notes: [],
    };
    const reasons: string[] = [];
    const inst = r.instrument ? placeInstrument(r.instrument, names) : null;
    if (!r.instrument) reasons.push("There is no analyzer.");
    else if (!inst) {
      ask("instrument", r.instrument, "", "", "", () => names.instruments.map((i) => ({ value: i.name, label: i.label, ...(i.id ? { map_instrument_id: i.id } : {}) })));
      const several = names.instruments.filter((i) => i.keys.includes(nameKey(r.instrument))).length > 1;
      reasons.push(quoted("instrument", r.instrument, several ? "is the name of more than one analyzer here. Choose which." : "isn't one this lab has. Choose which analyzer it is."));
    } else { out.instrument = inst.name; out.map_instrument_id = inst.id; }

    let lots: LabLot[] = [];
    if (!r.analyte) reasons.push("There is no test.");
    else {
      const k = nameKey(r.analyte);
      lots = names.lots.filter((l) => l.aKey === k);
      if (!lots.length && inst) {
        const choice = names.choices.get(choiceKey("analyte", k, inst.key));
        if (choice) { const t = nameKey(choice.target); lots = names.lots.filter((l) => l.aKey === t); }
        if (!lots.length) ask("analyte", r.analyte, "", inst.key, inst.name, () => uniqueBy(names.lots, (l) => l.analyte).map((l) => ({ value: l.analyte, label: l.analyte })));
      }
      if (!lots.length) reasons.push(quoted("analyte", r.analyte, "has no control lot in this lab."));
      else out.analyte = lots[0].analyte;
    }
    if (lots.length) {
      const aKey = lots[0].aKey, aName = lots[0].analyte;
      if (!r.level) { reasons.push("There is no control level."); lots = []; }
      else {
        const k = nameKey(r.level);
        let at = lots.filter((l) => l.lvKey === k);
        if (!at.length) {
          const choice = names.choices.get(choiceKey("level", k, aKey));
          if (choice) { const t = nameKey(choice.target); at = lots.filter((l) => l.lvKey === t); }
          if (!at.length) {
            const here = lots;
            ask("level", r.level, "", aKey, aName, () => uniqueBy(here, (l) => l.level).map((l) => ({ value: l.level, label: l.level })));
            reasons.push(quoted("level", r.level, `isn't a level of ${aName} here. Choose which it is.`));
          }
        }
        lots = at;
        if (lots.length) out.level = lots[0].level;
      }
    }
    if (lots.length) {
      const { aKey, lvKey, analyte, level } = lots[0];
      if (!r.lot) { reasons.push("There is no control lot."); lots = []; }
      else {
        const k = nameKey(r.lot);
        let at = lots.filter((l) => l.lotKey === k);
        if (!at.length) {
          const choice = names.choices.get(choiceKey("lot", k, `${aKey}|${lvKey}`));
          if (choice) { const t = nameKey(choice.target); at = lots.filter((l) => l.lotKey === t); }
          if (!at.length) {
            const here = lots;
            ask("lot", r.lot, level, `${aKey}|${lvKey}`, `${analyte} ${level}`, () => uniqueBy(here, (l) => l.lot_number).map((l) => ({ value: l.lot_number, label: `${l.lot_number}${l.status !== "active" ? ` (${l.status})` : ""}` })));
            reasons.push(quoted("lot", r.lot, `isn't a lot of ${analyte} ${level} here. Choose which it is, or add the lot on VeritaQC first.`));
          }
        }
        if (at.length > 1) { reasons.push("More than one control lot here matches. Give them different lot numbers first."); at = []; }
        lots = at;
        if (lots.length) { out.lot = lots[0].lot_number; out.lot_id = lots[0].id; }
      }
    }
    if ("error" in r.when) reasons.push(r.when.error);
    else if (`${r.when.date} ${(r.when.time ?? "00:00").slice(0, 5)}` > nowText) reasons.push(`The date is in the future (the lab's clock reads ${nowText}).`);
    if ("error" in r.value) reasons.push(r.value.error);
    if (r.operator && r.operator.length > QC_IMPORT_TEXT_MAX) reasons.push(`The operator is longer than ${QC_IMPORT_TEXT_MAX} characters.`);
    if (r.comment && r.comment.length > QC_IMPORT_COMMENT_MAX) reasons.push(`The comment is longer than ${QC_IMPORT_COMMENT_MAX} characters.`);
    if (reasons.length) { out.reason = reasons.join(" "); out.lot_id = null; return out; }
    out.outcome = "ready";
    return out;
  });

  // Duplicates: already stored, or twice in the file.
  const ready = rows.filter((r) => r.outcome === "ready");
  const lotIds = Array.from(new Set(ready.map((r) => r.lot_id as number)));
  const lotById = new Map(names.lots.map((l) => [l.id, l]));
  const instKeys = new Map(names.instruments.map((i) => [i.id ? `i:${i.id}` : `t:${nameKey(i.name)}`, i.keys]));
  const stored = lotIds.length ? sqlite.prepare(
    `SELECT id, control_lot_id, instrument, map_instrument_id, result_value, result_date, run_time, accepted_for_reporting, voided_at, void_reason, void_source
       FROM qc_results WHERE lab_id = ? AND control_lot_id IN (SELECT value FROM json_each(?)) ORDER BY id`
  ).all(labId, JSON.stringify(lotIds)) as any[] : [];
  const byRun = new Map<string, any[]>();
  const runKey = (lot: number, date: string, value: number) => `${lot}|${date}|${value}`;
  const lastDay = new Map<number, string>();
  const dayTimes = new Map<string, string>();
  for (const s of stored) {
    if (s.void_source === "import_undo") continue; // taken back with its import: not one the lab has
    const k = runKey(s.control_lot_id, s.result_date, Number(s.result_value));
    (byRun.get(k) ?? byRun.set(k, []).get(k)!).push(s);
    if (s.voided_at || Number(s.accepted_for_reporting) !== 1) continue;
    if (s.result_date > (lastDay.get(s.control_lot_id) ?? "")) lastDay.set(s.control_lot_id, s.result_date);
    const dk = `${s.control_lot_id}|${s.result_date}`;
    if (s.run_time && String(s.run_time) > (dayTimes.get(dk) ?? "")) dayTimes.set(dk, String(s.run_time));
  }
  const sameInstrument = (s: any, r: PlannedRow): boolean => {
    if (s.map_instrument_id && r.map_instrument_id) return s.map_instrument_id === r.map_instrument_id;
    const k = nameKey(s.instrument);
    return !!k && (k === nameKey(r.instrument) || (instKeys.get(r.map_instrument_id ? `i:${r.map_instrument_id}` : `t:${nameKey(r.instrument)}`) ?? []).includes(k));
  };
  const inFile = new Map<string, PlannedRow[]>();
  const months = signedMonths(sqlite, labId, lotIds);
  const notes: ImportPlan["notes"] = { backdated: 0, same_day: 0, after_review: [], inactive_lot: 0, past_expiration: 0, maybe_same: 0 };
  const afterReview = new Map<string, ImportPlan["notes"]["after_review"][number]>();
  for (const r of ready) {
    const lotId = r.lot_id as number, date = r.date as string, value = r.value as number;
    const here = byRun.get(runKey(lotId, date, value)) ?? [];
    const same = here.find((s) => sameInstrument(s, r) && sameTime(s.run_time, r.time));
    if (same) {
      r.outcome = "duplicate";
      r.reason = same.voided_at ? `The same run is on file and was voided (${String(same.void_reason || "no reason").slice(0, 120)}).` : `Already on file as run #${same.id}.`;
      continue;
    }
    const fk = `${runKey(lotId, date, value)}|${r.map_instrument_id ?? nameKey(r.instrument)}`;
    const twin = (inFile.get(fk) ?? []).find((o) => sameTime(o.time, r.time));
    if (twin) {
      r.outcome = "duplicate";
      r.reason = `The same as row ${twin.row}${twin.column ? `, ${twin.column}` : ""} of this file${r.time ? "" : ", and there is no time to tell them apart"}.`;
      continue;
    }
    (inFile.get(fk) ?? inFile.set(fk, []).get(fk)!).push(r);
    const lot = lotById.get(lotId)!;
    const maybeSame = (s: any) => !s.voided_at && ((!s.map_instrument_id && !nameKey(s.instrument)) || sameInstrument(s, r)) && (!s.run_time || !r.time || sameTime(s.run_time, r.time));
    if (here.some(maybeSame)) {
      notes.maybe_same++;
      r.notes.push("A run with this value that day is on file without a time or an analyzer. Check it isn't the same run.");
    }
    if (date < (lastDay.get(lotId) ?? "")) { notes.backdated++; r.notes.push("Dated before a run already on file."); }
    else if (r.time && r.time < (dayTimes.get(`${lotId}|${date}`) ?? "")) { notes.same_day++; r.notes.push("Earlier in the day than a run already on file that day."); }
    const signed = signedMonthOf(months, lotId, date);
    if (signed) {
      const mk = `${lotId}|${date.slice(0, 7)}`;
      const a = afterReview.get(mk) ?? { analyte: lot.analyte, level: lot.level, lot: lot.lot_number, month: date.slice(0, 7), reviewed_by: signed.reviewed_by, reviewed_at: signed.reviewed_at, rows: 0 };
      a.rows++;
      afterReview.set(mk, a);
      r.notes.push("Its month's review is signed. The run will be marked as added after it.");
    }
    if (lot.status !== "active") { notes.inactive_lot++; r.notes.push(`The control lot is ${lot.status}.`); }
    if (lot.expiration_date && date > lot.expiration_date) { notes.past_expiration++; r.notes.push(`Run after the lot's expiration, ${lot.expiration_date}.`); }
  }
  notes.after_review = Array.from(afterReview.values());
  const counts: ImportCounts = { ready: 0, duplicate: 0, unplaced: 0 };
  for (const r of rows) counts[r.outcome]++;
  const order: NameKind[] = ["instrument", "analyte", "level", "lot"];
  return {
    counts, rows, notes,
    names: Array.from(unplaced.values()).map(({ byContext: _b, ...u }) => u).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.text.localeCompare(b.text)),
  };
}

/** The import each of these runs came with, by import id (shown on the run). */
export function importsOf(sqlite: Sqlite, labId: number, runs: Array<{ import_id?: number | null }>): Map<number, { id: number; file_name: string; file_sha256: string; imported_by_name: string; imported_at: string }> {
  const ids = Array.from(new Set(runs.map((r) => r.import_id).filter((v): v is number => !!v)));
  const out = new Map<number, any>();
  if (!ids.length) return out;
  for (const i of sqlite.prepare("SELECT id, file_name, file_sha256, imported_by_name, imported_at FROM qc_file_imports WHERE lab_id = ? AND id IN (SELECT value FROM json_each(?))").all(labId, JSON.stringify(ids)) as any[]) out.set(i.id, i);
  return out;
}

// ── Taking an import back ─────────────────────────────────────────────────────────────────────────────────────────────

/** Every run of an import that isn't voided: which would be voided, and which stay and why. */
export function undoPlan(sqlite: Sqlite, labId: number, importId: number): { goes: any[]; stays: Array<any & { why: string }> } {
  const runs = sqlite.prepare(
    `SELECT r.id, r.control_lot_id, r.import_row, r.import_column, r.result_date, r.run_time, r.result_value, r.created_at, l.analyte, l.level, l.lot_number,
            EXISTS (SELECT 1 FROM qc_corrective_actions ca WHERE ca.qc_result_id = r.id) AS has_ca
       FROM qc_results r JOIN qc_control_lots l ON l.id = r.control_lot_id
      WHERE r.lab_id = ? AND r.import_id = ? AND r.voided_at IS NULL ORDER BY r.import_row, r.id`
  ).all(labId, importId) as any[];
  const months = signedMonths(sqlite, labId, runs.map((r) => r.control_lot_id));
  const goes: any[] = [], stays: any[] = [];
  for (const { has_ca, ...r } of runs) {
    const signed = signedMonthOf(months, r.control_lot_id, r.result_date);
    const why = has_ca ? "It has a corrective action."
      : signed && momentMs(signed.reviewed_at) >= momentMs(r.created_at) ? `It is in the ${r.result_date.slice(0, 7)} review${signed.reviewed_by ? ` signed by ${signed.reviewed_by}` : ""}.`
      : null;
    if (why) stays.push({ ...r, why }); else goes.push(r);
  }
  return { goes, stays };
}

// ── Routes ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function registerQcFileImportRoutes(app: Express, deps: {
  authMiddleware: any; labScopeMiddleware: any; requireWriteAccess: any; requireModuleEdit: (mod: string) => any;
  resolveLabMapInstrument: (sqlite: any, labId: number, id: any) => any;
}) {
  const { authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit, resolveLabMapInstrument } = deps;
  const sqlite = (): Sqlite => (db as any).$client;
  const multer = require("multer"); // same CJS load as the VeritaLab upload route
  const uploadOne = multer({ storage: multer.memoryStorage(), limits: { fileSize: QC_IMPORT_MAX_MB * 1024 * 1024, files: 1, fields: 20, fieldSize: 512 * 1024 } }).single("file");
  // The upload finishes outside the context labScopeMiddleware opened, so a Veritas support upload re-enters it (BUG-014).
  const upload = (req: any, res: any, next: any) => uploadOne(req, res, (err: any) => {
    if (err) return res.status(400).json(err.code === "LIMIT_FILE_SIZE" ? { error: `The file is too large (the limit is ${QC_IMPORT_MAX_MB} MB).`, code: "FILE_TOO_LARGE" } : { error: "The upload failed.", code: "BAD_FILE" });
    if (req.scope?.viaVlsSupport) return vlsContext.run({ actingAs: "vls_support", labId: req.scope.labId, userId: req.userId }, () => next());
    next();
  });
  const view = [authMiddleware, labScopeMiddleware, requireModuleEdit("veritaqc")];
  const edit = [authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritaqc")];

  const userName = (userId: number): string => {
    const u = sqlite().prepare("SELECT name, email FROM users WHERE id = ?").get(userId) as any;
    return (u?.name && String(u.name).trim()) || u?.email || `user ${userId}`;
  };
  const audit = (req: any, action: any, entityType: string, entityId: number | string, label: string, before: any, after: any) => logAudit({
    userId: req.userId, ownerUserId: req.scope?.lab?.owner_user_id ?? req.userId, module: "veritaqc", action, entityType, entityId, entityLabel: label,
    before: before ?? undefined, after: { ...(after ?? {}), lab_id: req.scope.labId }, ipAddress: req.ip,
  });
  const refusing = (fn: (req: any, res: any) => Promise<any> | any) => async (req: any, res: any) => {
    try { await fn(req, res); } catch (e: any) {
      if (e instanceof ImportRefused) return res.status(e.status).json({ error: e.message, code: e.code, ...e.extra });
      console.error("[qc/file-imports]", e?.message);
      if (!res.headersSent) res.status(500).json({ error: "The file couldn't be read." });
    }
  };
  const fileOf = (req: any): { buffer: Buffer; name: string; sha256: string } => {
    if (!req.file?.buffer) throw new ImportRefused("Choose a CSV or Excel file.", "NO_FILE");
    // multer reads the name as latin1; a browser sends UTF-8.
    const raw = String(req.file.originalname ?? "file");
    const utf8 = Buffer.from(raw, "latin1").toString("utf8");
    const name = (utf8.includes(String.fromCharCode(0xfffd)) ? raw : utf8).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200) || "file";
    const phi = detectPhi(name);
    if (phi.length) throw new ImportRefused("The file's name looks like patient information. Rename it and upload again.", "PHI_REFUSED", 400, { field: "file name", labels: phi });
    return { buffer: req.file.buffer, name, sha256: crypto.createHash("sha256").update(req.file.buffer).digest("hex") };
  };
  const mappingOf = (req: any): QcImportMapping => {
    let raw: any = null;
    try { raw = JSON.parse(String(req.body?.mapping ?? "")); } catch { raw = null; }
    const { mapping, error } = readMapping(raw);
    if (!mapping) throw new ImportRefused(error!, "BAD_MAPPING");
    const phi = detectPhi(JSON.stringify(mapping));
    if (phi.length) throw new ImportRefused("The mapping holds text that looks like patient information. Remove it.", "PHI_REFUSED", 400, { field: "mapping", labels: phi });
    return mapping;
  };
  /** The file's runs under this mapping. */
  const readFor = async (buffer: Buffer, mapping: QcImportMapping, labId: number): Promise<{ runs: RawRun[]; tz: string }> => {
    const file = await readFileGrid(buffer, mapping.sheet);
    const headers = checkedHeaders(file, mapping.headerRow);
    const missing = missingColumns(mapping, headers);
    if (missing.length) throw new ImportRefused(`The file has no column named ${missing.map((m) => `"${m}"`).join(", ")}. Choose the columns again.`, "COLUMNS_MISSING", 400, { columns: missing, headers });
    const tz = labTimeZoneById(sqlite(), labId);
    const runs = readRuns(file.grid, headers, mapping, tz);
    if (runs.length > QC_IMPORT_MAX_ROWS) throw new ImportRefused(tooMany(), "TOO_MANY_ROWS");
    if (!runs.length) throw new ImportRefused("The file has no results under that header row.", "NO_ROWS");
    return { runs, tz };
  };
  const importIn = (req: any): any => {
    const id = Number(req.params.id);
    return Number.isInteger(id) && id > 0 ? sqlite().prepare("SELECT * FROM qc_file_imports WHERE id = ? AND lab_id = ?").get(id, req.scope.labId) ?? null : null;
  };
  const importView = (i: any) => ({
    id: i.id, file_name: i.file_name, file_sha256: i.file_sha256, mapping_name: i.mapping_name, imported_by_name: i.imported_by_name, imported_at: i.imported_at,
    run_count: i.run_count, duplicate_count: i.duplicate_count, unplaced_count: i.unplaced_count,
    undone_at: i.undone_at, undone_by_name: i.undone_by_name, undo_reason: i.undo_reason, undone_count: i.undone_count,
  });
  const mappingsOf = (labId: number) => (sqlite().prepare("SELECT id, name, config_json, updated_at FROM qc_import_mappings WHERE lab_id = ? ORDER BY name COLLATE NOCASE").all(labId) as any[])
    .map((m) => ({ id: m.id, name: m.name, updated_at: m.updated_at, mapping: JSON.parse(m.config_json) }));
  const namesOf = (labId: number) => sqlite().prepare(
    "SELECT id, kind, file_text, context_label, target, chosen_by_name, chosen_at FROM qc_import_names WHERE lab_id = ? ORDER BY kind, file_text COLLATE NOCASE, context_label COLLATE NOCASE"
  ).all(labId);

  // ── Setup: saved mappings and remembered names ──
  app.get(`${BASE}/setup`, ...view, (req: any, res) => {
    const tz = labTimeZoneById(sqlite(), req.scope.labId);
    res.json({
      mappings: mappingsOf(req.scope.labId), names: namesOf(req.scope.labId), time_zone: tz, can_import: !req.scope.viaVlsSupport,
      instruments: loadLabNames(sqlite(), req.scope.labId).instruments.map((i) => ({ id: i.id, name: i.name, label: i.label })),
      max_rows: QC_IMPORT_MAX_ROWS, max_mb: QC_IMPORT_MAX_MB,
    });
  });

  app.put(`${BASE}/mappings`, ...edit, refusing((req, res) => {
    const name = String(req.body?.name ?? "").replace(/\s+/g, " ").trim();
    if (!name || name.length > 80) throw new ImportRefused("Give the mapping a name of 80 characters or fewer.", "BAD_NAME");
    const { mapping, error } = readMapping(req.body?.mapping);
    if (!mapping) throw new ImportRefused(error!, "BAD_MAPPING");
    const phi = detectPhi(`${name} ${JSON.stringify(mapping)}`);
    if (phi.length) throw new ImportRefused("The mapping holds text that looks like patient information. Remove it.", "PHI_REFUSED", 400, { field: "mapping", labels: phi });
    const at = new Date().toISOString(), labId = req.scope.labId;
    const before = sqlite().prepare("SELECT id, name, config_json FROM qc_import_mappings WHERE lab_id = ? AND name = ? COLLATE NOCASE").get(labId, name) as any;
    const config = JSON.stringify(mapping);
    let id: number;
    if (before) {
      id = before.id;
      sqlite().prepare("UPDATE qc_import_mappings SET name = ?, config_json = ?, updated_by_user_id = ?, updated_at = ? WHERE id = ? AND lab_id = ?").run(name, config, req.userId, at, id, labId);
    } else {
      id = Number(sqlite().prepare("INSERT INTO qc_import_mappings (lab_id, name, config_json, created_by_user_id, updated_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(labId, name, config, req.userId, req.userId, at, at).lastInsertRowid);
    }
    if (!before || before.config_json !== config || before.name !== name) {
      audit(req, before ? "update" : "create", "qc_import_mapping", id, `QC file import mapping: ${name}`, before ? { name: before.name, mapping: JSON.parse(before.config_json) } : null, { name, mapping });
    }
    res.json({ ok: true, id, mappings: mappingsOf(labId) });
  }));

  app.delete(`${BASE}/mappings/:id`, ...edit, (req: any, res) => {
    const row = sqlite().prepare("SELECT id, name, config_json FROM qc_import_mappings WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!row) return res.status(404).json({ error: "That mapping isn't in this lab." });
    audit(req, "delete", "qc_import_mapping", row.id, `QC file import mapping: ${row.name}`, { name: row.name, mapping: JSON.parse(row.config_json) }, null);
    sqlite().prepare("DELETE FROM qc_import_mappings WHERE id = ? AND lab_id = ?").run(row.id, req.scope.labId);
    res.json({ ok: true, mappings: mappingsOf(req.scope.labId) });
  });

  // A person's choice of what a file's name means here. Each is checked against this lab's own names; another lab's analyzer id is refused.
  app.put(`${BASE}/names`, ...edit, refusing((req, res) => {
    const list: any[] = Array.isArray(req.body?.choices) ? req.body.choices : [];
    if (!list.length || list.length > 2000) throw new ImportRefused("Choose at least one name.", "NO_CHOICES");
    const labId = req.scope.labId, at = new Date().toISOString(), who = userName(req.userId);
    const names = loadLabNames(sqlite(), labId);
    const kept = list.map((c) => {
      const kind = String(c?.kind ?? "") as NameKind, text = String(c?.text ?? "").replace(/\s+/g, " ").trim(), context = String(c?.context_key ?? "");
      const bad = (m: string) => new ImportRefused(m, "BAD_CHOICE", 400, { kind, text });
      if (!(kind in NAME_KIND_LABEL) || !text || text.length > QC_IMPORT_TEXT_MAX) throw bad("That name can't be remembered.");
      if (detectPhi(`${text} ${c?.target ?? ""}`).length) throw new ImportRefused("That name looks like patient information.", "PHI_REFUSED", 400, { field: "name", labels: detectPhi(`${text} ${c?.target ?? ""}`) });
      const target = String(c?.target ?? "").trim();
      let contextLabel: string | null = null, mapId: number | null = null, kept = target;
      if (kind === "instrument") {
        if (context) throw bad("That name can't be remembered.");
        if (c?.map_instrument_id !== undefined && c?.map_instrument_id !== null && c?.map_instrument_id !== "") {
          const inst = resolveLabMapInstrument(sqlite(), labId, c.map_instrument_id);
          if (!inst) throw bad("Analyzer not found on this lab's test menu.");
          mapId = inst.id; kept = inst.nickname || inst.instrument_name;
        } else if (!target || target.length > QC_IMPORT_TEXT_MAX) throw bad("Name the analyzer.");
      } else if (kind === "analyte") {
        const m = /^(i|t):(.+)$/.exec(context);
        const inst = m ? names.instruments.find((i) => (m[1] === "i" ? i.id === Number(m[2]) : !i.id && i.keys.includes(m[2]))) : undefined;
        const remembered = m?.[1] === "t" ? Array.from(names.choices.entries()).find(([k, v]) => k.startsWith("instrument\u0000") && !v.map_instrument_id && nameKey(v.target) === m[2])?.[1] : undefined;
        if (!inst && !remembered) throw bad("Choose the analyzer first.");
        contextLabel = inst?.name ?? remembered!.target;
        const lot = names.lots.find((l) => l.analyte === target);
        if (!lot) throw bad(`"${target}" isn't a test with a control lot in this lab.`);
      } else if (kind === "level") {
        const lot = names.lots.find((l) => l.aKey === context && l.level === target);
        if (!lot) throw bad(`"${target}" isn't a level of that test in this lab.`);
        contextLabel = lot.analyte;
      } else {
        const lot = names.lots.find((l) => `${l.aKey}|${l.lvKey}` === context && l.lot_number === target);
        if (!lot) throw bad(`"${target}" isn't a lot of that test and level in this lab.`);
        contextLabel = `${lot.analyte} ${lot.level}`;
      }
      return { kind, text, fileKey: nameKey(text), context, contextLabel, target: kept, mapId };
    });
    const put = sqlite().prepare(
      `INSERT INTO qc_import_names (lab_id, kind, file_text, file_key, context_key, context_label, target, map_instrument_id, chosen_by_user_id, chosen_by_name, chosen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(lab_id, kind, file_key, context_key) DO UPDATE SET file_text = excluded.file_text, context_label = excluded.context_label, target = excluded.target,
         map_instrument_id = excluded.map_instrument_id, chosen_by_user_id = excluded.chosen_by_user_id, chosen_by_name = excluded.chosen_by_name, chosen_at = excluded.chosen_at`
    );
    sqlite().transaction(() => { for (const k of kept) put.run(labId, k.kind, k.text, k.fileKey, k.context, k.contextLabel, k.target, k.mapId, req.userId, who, at); })();
    audit(req, "update", "qc_import_names", labId, `QC file import names chosen: ${kept.length}`, null,
      { choices: kept.slice(0, 200).map((k) => ({ kind: k.kind, file: k.text, for: k.contextLabel, means: k.target, map_instrument_id: k.mapId })) });
    res.json({ ok: true, saved: kept.length, names: namesOf(labId) });
  }));

  app.delete(`${BASE}/names/:id`, ...edit, (req: any, res) => {
    const row = sqlite().prepare("SELECT id, kind, file_text, context_label, target FROM qc_import_names WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!row) return res.status(404).json({ error: "That name isn't in this lab." });
    audit(req, "delete", "qc_import_names", row.id, `QC file import name forgotten: ${row.file_text}`, row, null);
    sqlite().prepare("DELETE FROM qc_import_names WHERE id = ? AND lab_id = ?").run(row.id, req.scope.labId);
    res.json({ ok: true, names: namesOf(req.scope.labId) });
  });

  // ── The file: its columns and a few rows ──
  app.post(`${BASE}/inspect`, ...edit, upload, refusing(async (req, res) => {
    const f = fileOf(req);
    const file = await readFileGrid(f.buffer, req.body?.sheet ? String(req.body.sheet) : null);
    const asked = Number(req.body?.headerRow);
    const headerRow = Number.isInteger(asked) && asked >= 1 && asked <= QC_IMPORT_MAX_HEADER_ROW ? asked : likelyHeaderRow(file.grid);
    const headers = checkedHeaders(file, headerRow);
    const sample: Array<{ row: number; cells: string[] }> = [];
    for (let r = headerRow; r < file.grid.length && sample.length < 8; r++) {
      const cells = file.grid[r];
      if (!cells || !cells.some((c) => cellText(c))) continue;
      sample.push({ row: r + 1, cells: headers.map((_h, i) => cellText(cells[i]).slice(0, 60)) });
    }
    res.json({ file_name: f.name, file_sha256: f.sha256, kind: file.kind, sheets: file.sheets, sheet: file.sheet, header_row: headerRow, headers, sample, data_rows: dataRowCount(file.grid, headerRow) });
  }));

  // ── Preview ──
  app.post(`${BASE}/preview`, ...edit, upload, refusing(async (req, res) => {
    const f = fileOf(req);
    const mapping = mappingOf(req);
    const { runs, tz } = await readFor(f.buffer, mapping, req.scope.labId);
    const plan = planImport(sqlite(), req.scope.labId, runs, tz);
    res.json({ file_name: f.name, file_sha256: f.sha256, time_zone: tz, can_import: !req.scope.viaVlsSupport, ...plan, rows: plan.rows.map(({ comment: _c, lot_id: _l, ...r }) => r) });
  }));

  // ── Import ──
  app.post(BASE, ...edit, upload, refusing(async (req, res) => {
    const f = fileOf(req);
    const mapping = mappingOf(req);
    let expected: any = null;
    try { expected = JSON.parse(String(req.body?.expected ?? "")); } catch { expected = null; }
    if (!expected || ["ready", "duplicate", "unplaced"].some((k) => !Number.isInteger(expected[k])) || typeof expected.file_sha256 !== "string") throw new ImportRefused("Look at the preview before importing.", "PREVIEW_FIRST");
    if (expected.file_sha256 !== f.sha256) throw new ImportRefused("This isn't the file the preview showed. Look at the preview again.", "FILE_CHANGED", 409);
    const labId: number = req.scope.labId;
    const { runs, tz } = await readFor(f.buffer, mapping, labId);
    const at = new Date().toISOString(), who = userName(req.userId);
    const mappingName = String(req.body?.mapping_name ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
    const client = sqlite();
    const result = client.transaction(() => {
      const plan = planImport(client, labId, runs, tz);
      if (plan.counts.ready !== expected.ready || plan.counts.duplicate !== expected.duplicate || plan.counts.unplaced !== expected.unplaced) {
        throw new ImportRefused("The counts have changed since the preview. Look at it again.", "COUNT_CHANGED", 409, { counts: plan.counts });
      }
      if (!plan.counts.ready) throw new ImportRefused("There is nothing to import: no row is ready.", "NOTHING_READY");
      const rowNumbers = (o: RowOutcome) => JSON.stringify(uniqueBy(plan.rows.filter((r) => r.outcome === o).map((r) => r.row), String));
      const importId = Number(client.prepare(
        `INSERT INTO qc_file_imports (lab_id, file_name, file_sha256, mapping_name, mapping_json, imported_by_user_id, imported_by_name, imported_at, run_count, duplicate_count, unplaced_count, duplicate_rows_json, unplaced_rows_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(labId, f.name, f.sha256, mappingName, JSON.stringify(mapping), req.userId, who, at, plan.counts.ready, plan.counts.duplicate, plan.counts.unplaced, rowNumbers("duplicate"), rowNumbers("unplaced")).lastInsertRowid);
      // By lot, date and time (then the file's order), so a file's runs of one day are judged in the order they were made.
      const ready = plan.rows.map((r, i) => ({ r, i })).filter((x) => x.r.outcome === "ready")
        .sort((a, b) => (a.r.lot_id! - b.r.lot_id!) || (a.r.date! < b.r.date! ? -1 : a.r.date! > b.r.date! ? 1 : 0) || ((a.r.time ?? "") < (b.r.time ?? "") ? -1 : (a.r.time ?? "") > (b.r.time ?? "") ? 1 : 0) || a.i - b.i);
      let lotId = -1, loaded: LotRuns | null = null, settings: QcRunSettings | null = null, flagged = 0, rejected = 0;
      for (const { r } of ready) {
        if (r.lot_id !== lotId) {
          lotId = r.lot_id!;
          loaded = loadLotRuns(client, labId, lotId);
          settings = qcRunSettings(client, labId, loaded.lot?.analyte ?? r.analyte);
        }
        const id = insertQcRun(client, {
          labId, controlLotId: lotId, instrument: r.instrument, mapInstrumentId: r.map_instrument_id, value: r.value!, date: r.date!, time: r.time,
          operatorUserId: null, comment: r.comment, now: at, from: { importId, row: r.row, column: r.column, operator: r.operator },
        });
        // The run's place in the lot's order (date, then entry): after every run of its day or before.
        const h = loaded!.history;
        let lo = 0, hi = h.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (h[mid].result_date <= r.date!) lo = mid + 1; else hi = mid; }
        h.splice(lo, 0, { id, result_value: r.value!, result_date: r.date! });
        const judged = judgeQcRun(client, labId, lotId, id, settings!, at, loaded!);
        if (judged.violations.length) flagged++;
        if (judged.requires_corrective_action) rejected++;
      }
      return { importId, counts: plan.counts, flagged, rejected, lots: new Set(ready.map((x) => x.r.lot_id)).size };
    })();
    audit(req, "create", "qc_file_import", result.importId, `QC results imported from ${f.name}: ${result.counts.ready} runs`, null,
      { file_name: f.name, file_sha256: f.sha256, mapping_name: mappingName, ...result.counts, lots: result.lots, with_rules_fired: result.flagged, need_corrective_action: result.rejected });
    res.json({ ok: true, import_id: result.importId, counts: result.counts, with_rules_fired: result.flagged, need_corrective_action: result.rejected });
  }));

  // ── Imports on file ──
  app.get(BASE, ...view, (req: any, res) => {
    const rows = sqlite().prepare("SELECT * FROM qc_file_imports WHERE lab_id = ? ORDER BY id DESC LIMIT 200").all(req.scope.labId) as any[];
    const live = new Map<number, any>((sqlite().prepare(
      `SELECT r.import_id AS id, COUNT(*) AS n,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM qc_rule_violations v WHERE v.qc_result_id = r.id AND v.severity = 'rejection' AND v.superseded_at IS NULL)
                        AND NOT EXISTS (SELECT 1 FROM qc_corrective_actions ca WHERE ca.qc_result_id = r.id) THEN 1 ELSE 0 END) AS missing_ca
         FROM qc_results r WHERE r.lab_id = ? AND r.import_id IS NOT NULL AND r.voided_at IS NULL GROUP BY r.import_id`
    ).all(req.scope.labId) as any[]).map((r) => [r.id, r]));
    res.json({ imports: rows.map((i) => ({ ...importView(i), runs_on_file: live.get(i.id)?.n ?? 0, missing_corrective_action: live.get(i.id)?.missing_ca ?? 0 })) });
  });

  app.get(`${BASE}/:id`, ...view, (req: any, res) => {
    const imp = importIn(req);
    if (!imp) return res.status(404).json({ error: "That import isn't in this lab." });
    const client = sqlite();
    const runs = client.prepare(
      `SELECT r.id, r.control_lot_id, r.import_row, r.import_column, r.import_operator, r.instrument, r.map_instrument_id, r.result_value, r.result_date, r.run_time, r.comment, r.created_at,
              r.accepted_for_reporting, r.voided_at, r.void_reason, l.analyte, l.level, l.lot_number
         FROM qc_results r JOIN qc_control_lots l ON l.id = r.control_lot_id WHERE r.lab_id = ? AND r.import_id = ? ORDER BY r.import_row, r.id`
    ).all(req.scope.labId, imp.id) as any[];
    const byRun = new Map<number, any[]>();
    for (const v of client.prepare(
      "SELECT v.id, v.qc_result_id, v.rule_code, v.severity, v.detail FROM qc_rule_violations v JOIN qc_results r ON r.id = v.qc_result_id WHERE r.lab_id = ? AND r.import_id = ? AND v.superseded_at IS NULL ORDER BY v.id"
    ).all(req.scope.labId, imp.id) as any[]) (byRun.get(v.qc_result_id) ?? byRun.set(v.qc_result_id, []).get(v.qc_result_id)!).push(v);
    const cas = new Set((client.prepare("SELECT DISTINCT ca.qc_result_id AS id FROM qc_corrective_actions ca JOIN qc_results r ON r.id = ca.qc_result_id WHERE r.lab_id = ? AND r.import_id = ?").all(req.scope.labId, imp.id) as any[]).map((x) => x.id));
    const months = signedMonths(client, req.scope.labId, runs.map((r) => r.control_lot_id));
    const plan = undoPlan(client, req.scope.labId, imp.id);
    res.json({
      import: { ...importView(imp), duplicate_rows: JSON.parse(imp.duplicate_rows_json || "[]"), unplaced_rows: JSON.parse(imp.unplaced_rows_json || "[]") },
      runs: runs.map((r) => ({ ...r, violations: byRun.get(r.id) ?? [], has_corrective_action: cas.has(r.id), added_after_review: r.voided_at ? null : addedAfterReview(months, r) })),
      undo: { will_void: plan.goes.length, stays: plan.stays }, can_import: !req.scope.viaVlsSupport,
    });
  });

  app.post(`${BASE}/:id/undo`, ...edit, refusing((req, res) => {
    const imp = importIn(req);
    if (!imp) throw new ImportRefused("That import isn't in this lab.", "NOT_FOUND", 404);
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason || reason.length > 500) throw new ImportRefused("Say why the import is taken back, in 500 characters or fewer.", "REASON_REQUIRED");
    if (imp.undone_at) throw new ImportRefused("This import was already taken back.", "ALREADY_TAKEN_BACK", 409);
    const at = new Date().toISOString(), who = userName(req.userId), client = sqlite();
    const plan = client.transaction(() => {
      const p = undoPlan(client, req.scope.labId, imp.id);
      if (req.body?.expected_void !== undefined && Number(req.body.expected_void) !== p.goes.length) throw new ImportRefused("What would be taken back has changed. Look at it again.", "COUNT_CHANGED", 409, { will_void: p.goes.length });
      if (!p.goes.length) throw new ImportRefused("No run of this import can be taken back.", "NOTHING_TO_TAKE_BACK", 409, { stays: p.stays });
      for (const r of p.goes) voidQcRun(client, r.id, req.userId, `Import #${imp.id} taken back: ${reason}`, "import_undo");
      client.prepare("UPDATE qc_file_imports SET undone_at = ?, undone_by_user_id = ?, undone_by_name = ?, undo_reason = ?, undone_count = ? WHERE id = ? AND lab_id = ?")
        .run(at, req.userId, who, reason, p.goes.length, imp.id, req.scope.labId);
      return p;
    })();
    audit(req, "update", "qc_file_import.undo", imp.id, `QC import #${imp.id} (${imp.file_name}) taken back: ${plan.goes.length} runs voided, ${plan.stays.length} stay`,
      { run_count: imp.run_count }, { voided: plan.goes.length, stay: plan.stays.length, stay_run_ids: plan.stays.map((s: any) => s.id).slice(0, 500), reason });
    res.json({ ok: true, voided: plan.goes.length, stays: plan.stays });
  }));
}
