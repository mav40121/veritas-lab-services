// shared/qcImportRules.ts
//
// Reading control runs out of a CSV or Excel export (B12, 2026-11-24; server/qcFileImport.ts does the storing). Pure: no
// database, no file access, so every branch is checked by scripts/verify-qc-import-rules.mts.
//
// Nothing is guessed. A value that isn't a plain number, a date that doesn't read the way the mapping says dates are written,
// or a name that isn't one the lab has (case and spaces aside) stays out with a reason beside it.
//
// Times are the lab's own wall clock: a date and time with no zone, and an Excel date, are read as written; one that carries a
// zone (Z or an offset) is turned into the lab's clock.

export const QC_IMPORT_MAX_ROWS = 10_000;
export const QC_IMPORT_MAX_MB = 10;
export const QC_IMPORT_MAX_HEADER_ROW = 50;
export const QC_IMPORT_COMMENT_MAX = 2000;
export const QC_IMPORT_TEXT_MAX = 120;

// ── Cells ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A cell as read: text, a number, an Excel date as the wall clock written in the cell (time "" when the cell shows none), or an Excel error. */
export type Cell = string | number | { date: string; time: string } | { error: string } | null;
/** A sheet: rows by position (row 1 is index 0), blank rows kept so a row number is the one the file shows. */
export type Grid = Cell[][];

/** Case and spaces aside: "Level 1", "LEVEL1" and " level  1 " are one name. */
export const nameKey = (s: unknown): string => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");

export function cellText(c: Cell | undefined): string {
  if (c === null || c === undefined) return "";
  if (typeof c === "string") return c.trim();
  if (typeof c === "number") return String(c);
  if ("error" in c) return c.error;
  return c.time ? `${c.date} ${c.time}` : c.date;
}
const isBlank = (c: Cell | undefined) => c === null || c === undefined || (typeof c === "string" && c.trim() === "");

/** "A", "B" ... "AA": the column letter a spreadsheet shows. */
export function columnLetter(index: number): string {
  let n = index + 1, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Header labels, one per column: the header text, "Column C" for a blank one, and "Result (2)" for a repeated one. */
export function headerLabels(row: Cell[] | undefined, width: number): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    const base = cellText(row?.[i]).replace(/\s+/g, " ") || `Column ${columnLetter(i)}`;
    const k = nameKey(base);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    out.push(n === 1 ? base : `${base} (${n})`);
  }
  return out;
}

/** The first row that looks like a header: the first with three or more cells filled, else the first with any. */
export function likelyHeaderRow(grid: Grid): number {
  const filled = (r: Cell[]) => r.filter((c) => !isBlank(c)).length;
  const top = Math.min(grid.length, QC_IMPORT_MAX_HEADER_ROW);
  for (let i = 0; i < top; i++) if (filled(grid[i] ?? []) >= 3) return i + 1;
  for (let i = 0; i < top; i++) if (filled(grid[i] ?? []) > 0) return i + 1;
  return 1;
}

// ── CSV ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The separator the file uses: the one that splits its first filled lines most often outside quotes. */
export function csvDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0, "|": 0 };
  let q = false, lines = 0;
  for (let i = 0; i < text.length && lines < 5; i++) {
    const ch = text[i];
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
    else if (!q && ch === "\n") lines++;
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [","])[0];
}

/** RFC 4180: quoted fields, doubled quotes, separators and line breaks inside quotes, CRLF or LF. Blank rows keep their place. */
export function parseDelimited(text: string, delimiter = csvDelimiter(text), maxRows = Infinity): string[][] {
  const s = String(text ?? "").replace(/^﻿/, "");
  const out: string[][] = [];
  let row: string[] = [], field = "", q = false, any = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') { q = true; any = true; }
    else if (ch === delimiter) { row.push(field); field = ""; any = true; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); out.push(row);
      row = []; field = ""; any = false;
      if (out.length > maxRows) return out;
    } else { field += ch; any = true; }
  }
  if (any || field) { row.push(field); out.push(row); }
  return out;
}

// ── Columns that look like patient information ────────────────────────────────────────────────────────────────────────
const PHI_HEADER_EXACT = new Set([
  "name", "full name", "last name", "first name", "middle name", "lastname", "firstname", "lname", "fname", "surname", "given name", "family name", "person name",
  "sex", "gender", "age", "race", "ethnicity", "ssn", "dob", "mrn", "fin", "address", "phone", "phone number", "email",
]);
const PHI_HEADER_PATTERNS: RegExp[] = [
  /\bpatients?\b/, /\b(pt|pat) (id|name|no|num|number|dob|mrn)\b/, /\bmrn\b/, /\bmed(ical)? rec(ord)?\b/, /\bchart (no|num|number|id)\b/,
  /\bdob\b/, /\bd o b\b/, /\bbirth ?(date|day)?\b/, /\bdate of birth\b/, /\bssn\b/, /\bsocial sec(urity)?\b/,
  /\baccession(s|ed)?\b/, /\baccn\b/, /\bacc (no|num|number|id)\b/, /\bencounter\b/, /\bvisit (no|num|number|id)\b/, /\bfin (no|num|number)\b/,
];
/** The header words of a column that looks like patient information (name, MRN, date of birth, SSN, accession), or null. */
export function patientColumn(headers: Array<string | Cell>): string | null {
  for (const raw of headers) {
    const shown = typeof raw === "string" ? raw.trim() : cellText(raw as Cell);
    // "PatientID" and "patient_id" read as two words, like "Patient ID".
    const h = shown.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!h) continue;
    if (PHI_HEADER_EXACT.has(h) || PHI_HEADER_PATTERNS.some((re) => re.test(h))) return shown;
  }
  return null;
}

// ── The mapping ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** Where a run's field comes from: a column of the file, or one fixed text for every row. */
export type FieldSource = { column: string } | { fixed: string };
export type DateOrder = "mdy" | "dmy" | "ymd";
/** Wide file: one column of values. What it is for (test, level, lot), where the row itself doesn't say. */
export interface ValueColumn { column: string; analyte?: string; level?: string; lot?: string }
export interface QcImportMapping {
  sheet: string | null;       // Excel sheet name; null = the first sheet
  headerRow: number;          // 1 = the file's first row
  layout: "long" | "wide";    // long: one value on a row; wide: several value columns
  dateOrder: DateOrder;
  dateColumn: string;         // date, or date and time
  timeColumn: string | null;
  instrument: FieldSource | null;
  analyte: FieldSource | null;
  level: FieldSource | null;
  lot: FieldSource | null;
  valueColumn: string | null;
  valueColumns: ValueColumn[];
  operatorColumn: string | null;
  commentColumn: string | null;
}

const str = (v: unknown, max = 200): string => String(v ?? "").trim().slice(0, max);
const orNull = (v: unknown, max = 200): string | null => str(v, max) || null;
function source(v: any): FieldSource | null {
  if (!v || typeof v !== "object") return null;
  if (str(v.column)) return { column: str(v.column) };
  if (str(v.fixed)) return { fixed: str(v.fixed, QC_IMPORT_TEXT_MAX) };
  return null;
}

/** A mapping from a request, or what is missing from it. */
export function readMapping(raw: any): { mapping?: QcImportMapping; error?: string } {
  if (!raw || typeof raw !== "object") return { error: "Choose which columns hold what." };
  const layout = raw.layout === "wide" ? "wide" : "long";
  const headerRow = Number(raw.headerRow ?? 1);
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > QC_IMPORT_MAX_HEADER_ROW) return { error: `The header row must be a whole number from 1 to ${QC_IMPORT_MAX_HEADER_ROW}.` };
  const m: QcImportMapping = {
    sheet: orNull(raw.sheet), headerRow, layout,
    dateOrder: raw.dateOrder === "dmy" ? "dmy" : raw.dateOrder === "ymd" ? "ymd" : "mdy",
    dateColumn: str(raw.dateColumn), timeColumn: orNull(raw.timeColumn),
    instrument: source(raw.instrument), analyte: source(raw.analyte), level: source(raw.level), lot: source(raw.lot),
    valueColumn: layout === "long" ? orNull(raw.valueColumn) : null,
    valueColumns: layout === "wide" && Array.isArray(raw.valueColumns)
      ? raw.valueColumns.slice(0, 300).map((v: any) => ({ column: str(v?.column), ...(str(v?.analyte) ? { analyte: str(v.analyte, QC_IMPORT_TEXT_MAX) } : {}), ...(str(v?.level) ? { level: str(v.level, QC_IMPORT_TEXT_MAX) } : {}), ...(str(v?.lot) ? { lot: str(v.lot, QC_IMPORT_TEXT_MAX) } : {}) })).filter((v: ValueColumn) => v.column)
      : [],
    operatorColumn: orNull(raw.operatorColumn), commentColumn: orNull(raw.commentColumn),
  };
  const missing: string[] = [];
  if (!m.dateColumn) missing.push("date and time");
  if (!m.instrument) missing.push("instrument");
  if (layout === "long") {
    if (!m.valueColumn) missing.push("value");
    if (!m.analyte) missing.push("test (analyte)");
    if (!m.level) missing.push("control level");
    if (!m.lot) missing.push("control lot");
  } else {
    if (!m.valueColumns.length) missing.push("at least one value column");
    const unsaid = (k: "analyte" | "level" | "lot") => !m[k] && m.valueColumns.some((v) => !v[k]);
    if (unsaid("analyte")) missing.push("test (analyte), from a column or on each value column");
    if (unsaid("level")) missing.push("control level, from a column or on each value column");
    if (unsaid("lot")) missing.push("control lot, from a column or on each value column");
  }
  return missing.length ? { error: `Still to choose: ${missing.join("; ")}.` } : { mapping: m };
}

// ── Values ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const PLAIN_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
export function readValue(c: Cell | undefined): { value: number } | { error: string } {
  if (isBlank(c)) return { error: "There is no value." };
  if (typeof c === "number") return Number.isFinite(c) ? { value: Number(c.toPrecision(15)) } : { error: "The value isn't a number." };
  if (typeof c === "string") {
    const t = c.trim();
    const n = PLAIN_NUMBER.test(t) ? Number(t) : NaN;
    return Number.isFinite(n) ? { value: n } : { error: `The value "${t.slice(0, 40)}" isn't a number.` };
  }
  if (c && "error" in c) return { error: `The value cell shows ${c.error}.` };
  return { error: "The value cell holds a date." };
}

// ── Dates and times ───────────────────────────────────────────────────────────────────────────────────────────────────
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const p2 = (n: number) => String(n).padStart(2, "0");
function realDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${p2(m)}-${p2(d)}` : null;
}
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
const ORDER_WORDS: Record<DateOrder, string> = { mdy: "month, day, year", dmy: "day, month, year", ymd: "year, month, day" };

/** A time of day as HH:MM, or HH:MM:SS when the file gives seconds. Null when it isn't one. */
export function readTime(text: string): string | null {
  const t = text.trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*([ap])\.?m?\.?$/i.exec(t) || /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(t) || /^(\d{2})(\d{2})(\d{2})?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]), s = m[3] === undefined ? 0 : Number(m[3]);
  const half = m[4]?.toLowerCase();
  if (half) { if (h < 1 || h > 12) return null; h = (h % 12) + (half === "p" ? 12 : 0); }
  if (h > 23 || min > 59 || s > 59) return null;
  return s ? `${p2(h)}:${p2(min)}:${p2(s)}` : `${p2(h)}:${p2(min)}`;
}

/** An instant as the wall clock of a time zone. */
export function wallClock(ms: number, tz: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(ms));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hh = g("hour") === "24" ? "00" : g("hour");
  const ss = g("second");
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: ss === "00" ? `${hh}:${g("minute")}` : `${hh}:${g("minute")}:${ss}` };
}

export interface ReadWhen { date: string; time: string | null }
const ZONE = /\s*(z|utc|gmt|[+-]\d{2}:?\d{2})$/i;

function readDateText(text: string, order: DateOrder, tz: string): ReadWhen | null {
  let t = text.trim().replace(/\s+/g, " ");
  // HL7: 20261120, 20261120071500, 20261120071500-0500
  const hl7 = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?(?:\.\d+)?([+-]\d{4})?)?$/.exec(t);
  if (hl7) {
    const date = realDate(Number(hl7[1]), Number(hl7[2]), Number(hl7[3]));
    if (!date) return null;
    if (hl7[4] === undefined) return { date, time: null };
    const time = readTime(`${hl7[4]}:${hl7[5]}:${hl7[6] ?? "00"}`);
    if (!time) return null;
    return hl7[7] ? zoned(date, time, hl7[7], tz) : { date, time };
  }
  // Split the date from the time: a T or the first space that a time follows.
  let datePart = t, timePart: string | null = null, zone: string | null = null;
  const split = /^(.+?)(?:T|,? )(\d{1,2}:\d{2}.*)$/i.exec(t);
  if (split) {
    datePart = split[1].replace(/,$/, "").trim();
    let rest = split[2].trim();
    const z = ZONE.exec(rest);
    if (z) { zone = z[1]; rest = rest.slice(0, rest.length - z[0].length).trim(); }
    timePart = rest;
  }
  const date = readDay(datePart, order);
  if (!date) return null;
  if (timePart === null) return { date, time: null };
  const time = readTime(timePart);
  if (!time) return null;
  return zone ? zoned(date, time, zone, tz) : { date, time };
}

function zoned(date: string, time: string, zone: string, tz: string): ReadWhen | null {
  const off = /^(z|utc|gmt)$/i.test(zone) ? "Z" : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
  const ms = Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}${off}`);
  return Number.isFinite(ms) ? wallClock(ms, tz) : null;
}

function readDay(text: string, order: DateOrder): string | null {
  const t = text.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return realDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(t);
  if (m) {
    if (order === "mdy") return realDate(fullYear(m[3]), Number(m[1]), Number(m[2]));
    if (order === "dmy") return realDate(fullYear(m[3]), Number(m[2]), Number(m[1]));
    return m[3].length === 2 ? realDate(fullYear(m[1].padStart(2, "0")), Number(m[2]), Number(m[3])) : null;
  }
  const month = (w: string) => { const i = MONTHS.indexOf(w.slice(0, 3).toLowerCase()); return i < 0 ? 0 : i + 1; };
  m = /^(\d{1,2})[- ]([A-Za-z]{3,9})\.?[- ,]+(\d{4}|\d{2})$/.exec(t);
  if (m) return month(m[2]) ? realDate(fullYear(m[3]), month(m[2]), Number(m[1])) : null;
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(t);
  if (m) return month(m[1]) ? realDate(Number(m[3]), month(m[1]), Number(m[2])) : null;
  return null;
}

/** When the run was made, on the lab's clock: from one date (and time) cell, or a date cell and a time cell. */
export function readWhen(dateCell: Cell | undefined, timeCell: Cell | undefined, hasTimeColumn: boolean, order: DateOrder, tz: string): ReadWhen | { error: string } {
  if (isBlank(dateCell)) return { error: "There is no date." };
  let when: ReadWhen | null = null;
  if (typeof dateCell === "number") {
    // 20261120 as a number is a date some systems write; any other number is an Excel serial nobody formatted as a date.
    when = /^\d{8}$/.test(String(dateCell)) ? readDateText(String(dateCell), order, tz) : null;
    if (!when) return { error: `The date cell holds the number ${dateCell}, not a date. Format the column as a date in Excel.` };
  } else if (typeof dateCell === "string") {
    when = readDateText(dateCell, order, tz);
    if (!when) return { error: `The date "${dateCell.trim().slice(0, 40)}" can't be read as ${ORDER_WORDS[order]}.` };
  } else if (dateCell && "error" in dateCell) {
    return { error: `The date cell shows ${dateCell.error}.` };
  } else {
    const d = dateCell as { date: string; time: string };
    when = { date: d.date, time: d.time || null };
  }
  if (when.date < "2000-01-01") return { error: `The date reads as ${when.date}, which isn't a run date.` };
  if (!hasTimeColumn) return when;
  if (isBlank(timeCell)) return when.time ? when : { error: "There is no time." };
  let time: string | null = null;
  if (typeof timeCell === "string") time = readTime(timeCell);
  else if (typeof timeCell === "number") time = Number.isInteger(timeCell) && (timeCell === 0 || (timeCell >= 100 && timeCell <= 2359)) ? readTime(String(timeCell).padStart(4, "0")) : null;
  else if (timeCell && !("error" in timeCell)) time = timeCell.time || null;
  if (!time) return { error: `The time "${cellText(timeCell).slice(0, 40)}" can't be read.` };
  return { date: when.date, time };
}

// ── Runs out of the sheet ─────────────────────────────────────────────────────────────────────────────────────────────
export interface RawRun {
  row: number;                  // the row number the file shows
  column: string | null;        // wide file: the value's column
  instrument: string; analyte: string; level: string; lot: string;
  when: ReadWhen | { error: string };
  value: { value: number } | { error: string };
  operator: string | null;
  comment: string | null;
}

/** A column of the mapping that the file doesn't have, by name. */
export function missingColumns(m: QcImportMapping, headers: string[]): string[] {
  const have = new Set(headers.map(nameKey));
  const want: string[] = [m.dateColumn];
  for (const s of [m.instrument, m.analyte, m.level, m.lot]) if (s && "column" in s) want.push(s.column);
  for (const c of [m.timeColumn, m.valueColumn, m.operatorColumn, m.commentColumn]) if (c) want.push(c);
  for (const v of m.valueColumns) want.push(v.column);
  return Array.from(new Set(want.filter((c) => !have.has(nameKey(c)))));
}

/** Every run the sheet holds, in the file's order. Blank rows, and blank value cells of a wide file, hold no run. */
export function readRuns(grid: Grid, headers: string[], m: QcImportMapping, tz: string): RawRun[] {
  const at = new Map<string, number>();
  headers.forEach((h, i) => { const k = nameKey(h); if (!at.has(k)) at.set(k, i); });
  const idx = (c: string | null): number => (c ? at.get(nameKey(c)) ?? -1 : -1);
  const cell = (row: Cell[], i: number): Cell | undefined => (i >= 0 ? row[i] : undefined);
  const from = (row: Cell[], s: FieldSource | null): string => (!s ? "" : "fixed" in s ? s.fixed : cellText(cell(row, idx(s.column))));
  const dateAt = idx(m.dateColumn), timeAt = idx(m.timeColumn), opAt = idx(m.operatorColumn), comAt = idx(m.commentColumn);
  const values: ValueColumn[] = m.layout === "wide" ? m.valueColumns : [{ column: m.valueColumn ?? "" }];
  const out: RawRun[] = [];
  for (let r = m.headerRow; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (row.every((c) => isBlank(c))) continue;
    const when = readWhen(cell(row, dateAt), cell(row, timeAt), !!m.timeColumn, m.dateOrder, tz);
    const base = {
      row: r + 1, instrument: from(row, m.instrument), when,
      operator: cellText(cell(row, opAt)) || null, comment: cellText(cell(row, comAt)) || null,
    };
    for (const v of values) {
      const c = cell(row, idx(v.column));
      if (m.layout === "wide" && isBlank(c)) continue;
      out.push({
        ...base, column: m.layout === "wide" ? v.column : null,
        analyte: v.analyte || from(row, m.analyte), level: v.level || from(row, m.level), lot: v.lot || from(row, m.lot),
        value: readValue(c),
      });
    }
  }
  return out;
}

/** The most data rows a file may have is QC_IMPORT_MAX_ROWS; a wide file's values count one by one. */
export const dataRowCount = (grid: Grid, headerRow: number): number => grid.slice(headerRow).filter((r) => !r.every((c) => isBlank(c))).length;

// ── Times compared ────────────────────────────────────────────────────────────────────────────────────────────────────
/** The same time of day: to the second when both give seconds, else to the minute. No time matches only no time. */
export function sameTime(a: string | null, b: string | null): boolean {
  const x = a ? a.trim() : "", y = b ? b.trim() : "";
  if (!x || !y) return !x && !y;
  return x.length > 5 && y.length > 5 ? x === y : x.slice(0, 5) === y.slice(0, 5);
}

export type RowOutcome = "ready" | "duplicate" | "unplaced";
export interface ImportCounts { ready: number; duplicate: number; unplaced: number }
export type NameKind = "instrument" | "analyte" | "level" | "lot";
export const NAME_KIND_LABEL: Record<NameKind, string> = { instrument: "Analyzer", analyte: "Test", level: "Level", lot: "Control lot" };
