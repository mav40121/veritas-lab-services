// shared/stainLogRules.ts
//
// The rules of the VeritaMaintain stain log (Michael Q178 = 1, 2026-11-06), shared by the server (server/stainLog.ts) and the page
// (client/src/pages/StainLogPage.tsx) so they can't disagree. Pure: no database and no clock. scripts/verify-stain-log-rules.mts
// exercises every branch on a fixed input set.
//
// The stain log is two records. A month grid: each instrument carries the lab's own rows (its stains, rinses and daily checks), and a
// day's cell holds what was done, by code. A list: manual stains, one line each. Neither holds a patient or a specimen number: the
// standing no-PHI rule rejects specimen-to-patient linkage, so the link to a patient stays in the lab's LIS.

import { detectTissuePhi, isYmd } from "./tissueRules";

export { isYmd };

export const STAIN_CODES = ["D", "C", "F", "TO", "R"] as const;
export const CHECK_CODES = ["OK", "PROBLEM"] as const;
export type StainCode = (typeof STAIN_CODES)[number];
export type CheckCode = (typeof CHECK_CODES)[number];

export const CODE_LABELS: Record<string, string> = {
  D: "Dumped",
  C: "Changed or re-filled",
  F: "Filtered",
  TO: "Topped off",
  R: "Rotated",
  OK: "Acceptable",
  PROBLEM: "Problem",
};

/** What a code looks like in a grid cell. */
export const codeMark = (code: string): string => (code === "OK" ? "✓" : code === "PROBLEM" ? "!" : code);

export const ROW_KINDS = [
  { value: "stain", label: "Stain or reagent", hint: "A change (C) needs the lot number and expiration" },
  { value: "solution", label: "Water or rinse", hint: "No lot number needed" },
  { value: "check", label: "Check", hint: "Acceptable or Problem, such as a slide quality check" },
] as const;
export type RowKind = (typeof ROW_KINDS)[number]["value"];

export const ROW_FREQUENCIES = [
  { value: "as_needed", label: "As needed" },
  { value: "daily", label: "Daily, on days the instrument is used" },
  { value: "monthly", label: "Monthly" },
] as const;
export type RowFrequency = (typeof ROW_FREQUENCIES)[number]["value"];

const NAME_MAX = 80;
const LOT_MAX = 60;
const TEXT_MAX = 2000;
const INITIALS_MAX = 8;

const isKind = (v: unknown): v is RowKind => ROW_KINDS.some((k) => k.value === v);
const isFrequency = (v: unknown): v is RowFrequency => ROW_FREQUENCIES.some((f) => f.value === v);
const isStainCode = (v: unknown): v is StainCode => (STAIN_CODES as readonly unknown[]).includes(v);

/** Which codes a row takes. */
export const codesForKind = (kind: string): readonly string[] => (kind === "check" ? CHECK_CODES : STAIN_CODES);

/** How a row's schedule reads, next to its name. */
export function rowScheduleLabel(row: { row_kind?: string | null; frequency?: string | null; required_code?: string | null }): string {
  if (row.frequency === "daily") return row.required_code ? `${row.required_code} daily` : "Daily";
  if (row.frequency === "monthly") return row.required_code ? `${row.required_code} monthly` : "Monthly";
  return "As needed";
}

export interface RowInput { name: string; row_kind: RowKind; frequency: RowFrequency; required_code: StainCode | null }

/** A row a lab sets up. A check counts whichever way it was answered, so only a stain or solution row names a code. */
export function cleanRow(b: any): { row?: RowInput; error?: string } {
  const name = String(b?.name ?? "").trim();
  if (!name) return { error: "Name the row" };
  if (name.length > NAME_MAX) return { error: `The row name must be ${NAME_MAX} characters or fewer` };
  const row_kind = b?.row_kind ?? "stain";
  if (!isKind(row_kind)) return { error: "Row type must be stain, solution or check" };
  const frequency = b?.frequency ?? "as_needed";
  if (!isFrequency(frequency)) return { error: "How often must be as needed, daily or monthly" };
  if (row_kind === "check" || frequency === "as_needed") return { row: { name, row_kind, frequency, required_code: null } };
  if (!isStainCode(b?.required_code)) return { error: `Pick the code this row needs ${frequency === "daily" ? "each day" : "each month"}` };
  return { row: { name, row_kind, frequency, required_code: b.required_code } };
}

/** The lab's initials as stored, or why they can't be. */
export function cleanInitials(v: unknown): { initials?: string; error?: string } {
  const initials = String(v ?? "").trim();
  if (!initials) return { error: "Enter your initials" };
  if (initials.length > INITIALS_MAX) return { error: `Initials must be ${INITIALS_MAX} characters or fewer` };
  return { initials: initials.toUpperCase() };
}

export interface PlannedEntry { code: string; lot_number: string | null; expiration_date: string | null; lot_expired: 0 | 1; corrective_action: string | null }
export interface ItemInput { codes?: unknown; lot_number?: unknown; expiration_date?: unknown; corrective_action?: unknown }

/** True when this code on this kind of row has to say which lot went in. */
export const needsLot = (kind: string, code: string): boolean => kind === "stain" && code === "C";
/** A lot is only ever about what went into the station: a change or a top-off. */
const carriesLot = (code: string): boolean => code === "C" || code === "TO";

/**
 * What one row gets for one day: one entry per code. A change to a stain needs its lot and expiration. A lot past its expiration on
 * that day, or a Problem on a check, needs the corrective action, the same way an out-of-range temperature does. The entry is still
 * recorded: refusing it would keep what actually happened off the log.
 */
export function planRowEntries(row: { row_kind: string }, item: ItemInput, logDate: string): { entries?: PlannedEntry[]; error?: string; code?: string } {
  const allowed = codesForKind(row.row_kind);
  const codes = Array.isArray(item?.codes) ? item.codes.map(String) : [];
  if (!codes.length) return { error: "Pick at least one code", code: "NO_CODE" };
  if (codes.some((c) => !allowed.includes(c))) return { error: `That row takes ${allowed.join(", ")}`, code: "BAD_CODE" };
  if (new Set(codes).size !== codes.length) return { error: "A code is listed twice", code: "BAD_CODE" };
  if (row.row_kind === "check" && codes.length > 1) return { error: "A check is either Acceptable or Problem", code: "BAD_CODE" };

  const lot = String(item?.lot_number ?? "").trim();
  const expiration = String(item?.expiration_date ?? "").trim();
  const action = String(item?.corrective_action ?? "").trim();
  if (lot.length > LOT_MAX) return { error: `The lot number must be ${LOT_MAX} characters or fewer`, code: "BAD_LOT" };
  if (action.length > TEXT_MAX) return { error: "The corrective action is too long", code: "TOO_LONG" };
  if (expiration && !isYmd(expiration)) return { error: "The expiration must be a date", code: "BAD_EXPIRATION" };

  if (row.row_kind === "check") {
    if (lot || expiration) return { error: "A check has no lot number", code: "BAD_LOT" };
    if (codes[0] === "PROBLEM" && !action) return { error: "A problem needs the corrective action taken", code: "CORRECTIVE_ACTION_REQUIRED" };
    return { entries: [{ code: codes[0], lot_number: null, expiration_date: null, lot_expired: 0, corrective_action: action || null }] };
  }

  const lotCodes = codes.filter(carriesLot);
  if (codes.some((c) => needsLot(row.row_kind, c)) && (!lot || !expiration)) {
    return { error: "A stain change needs the lot number and the expiration", code: "LOT_REQUIRED" };
  }
  if ((lot || expiration) && !lotCodes.length) return { error: "A lot number goes with a change or a top-off", code: "BAD_LOT" };
  if ((lot && !expiration) || (expiration && !lot)) return { error: "Enter both the lot number and the expiration", code: "LOT_REQUIRED" };
  const expired = !!expiration && expiration < logDate;
  if (expired && !action) return { error: `That lot expired on ${expiration}. Record the corrective action taken.`, code: "CORRECTIVE_ACTION_REQUIRED" };
  return {
    entries: codes.map((code) => carriesLot(code)
      ? { code, lot_number: lot || null, expiration_date: expiration || null, lot_expired: expired ? 1 : 0, corrective_action: action || null }
      : { code, lot_number: null, expiration_date: null, lot_expired: 0, corrective_action: action || null }),
  };
}

export interface ManualInput { log_date: string; specimen_type: string; result: "good" | "problem"; test_slide: 0 | 1; comments: string | null }

export const MANUAL_TYPE_SUGGESTIONS = ["Frozen section", "Touch preparation"] as const;

/** One line of the manual stain log. There's no specimen number, by the no-PHI rule: only the specimen's type. */
export function cleanManualEntry(b: any): { entry?: ManualInput; error?: string; code?: string } {
  const log_date = String(b?.log_date ?? "");
  if (!isYmd(log_date)) return { error: "Pick the date", code: "BAD_DATE" };
  const specimen_type = String(b?.specimen_type ?? "").trim();
  if (!specimen_type) return { error: "Enter the specimen type", code: "TYPE_REQUIRED" };
  if (specimen_type.length > NAME_MAX) return { error: `The specimen type must be ${NAME_MAX} characters or fewer`, code: "TOO_LONG" };
  if (b?.result !== "good" && b?.result !== "problem") return { error: "Mark the stain Good or Problem", code: "RESULT_REQUIRED" };
  const comments = String(b?.comments ?? "").trim();
  if (comments.length > TEXT_MAX) return { error: "The comment is too long", code: "TOO_LONG" };
  if (b.result === "problem" && !comments) return { error: "A problem needs the corrective action taken", code: "CORRECTIVE_ACTION_REQUIRED" };
  return { entry: { log_date, specimen_type, result: b.result, test_slide: b?.test_slide === true || b?.test_slide === 1 ? 1 : 0, comments: comments || null } };
}

// ── No PHI ───────────────────────────────────────────────────────────────────
export const STAIN_NO_PHI_NOTICE = "No patient information. Do not enter a patient's name, medical record number or date of birth, or a specimen or accession number. The link to the patient stays in your LIS.";

// Past the platform's labels: the source forms ask for a specimen number, so someone may type one out of habit. High precision: each
// needs its label. An unlabeled number can't be told from a lot number, which is why no field here asks for one.
const SPECIMEN_LABEL = /\b(?:accession(?:\s*(?:#|no\.?|number|id))?|(?:specimen|case)\s*(?:#|no\.?|number|id))\s*[:#]?\s*[A-Za-z0-9-]*\d/i;

export function detectStainPhi(text: unknown): string[] {
  const s = String(text ?? "");
  if (!s) return [];
  const found = new Set(detectTissuePhi(s));
  if (SPECIMEN_LABEL.test(s)) found.add("Specimen number");
  return Array.from(found);
}

/** The first string anywhere in a request body that looks like patient information: which field, and what it looks like. Never the text. */
export function findStainPhi(body: unknown, path = ""): { field: string; labels: string[] } | null {
  if (typeof body === "string") {
    const labels = detectStainPhi(body);
    return labels.length ? { field: path, labels } : null;
  }
  if (Array.isArray(body)) {
    for (let i = 0; i < body.length; i++) {
      const hit = findStainPhi(body[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      const hit = findStainPhi(v, path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
  }
  return null;
}

export function stainPhiMessage(labels: string[]): string {
  const what = labels.map((l) => l.toLowerCase().replace("labeled ", "")).join(" and ");
  return `This looks like patient information (${what}). The stain log never holds a patient's details or a specimen number: that link stays in your LIS. Remove it and save again.`;
}

// ── Calendar ─────────────────────────────────────────────────────────────────
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const lastOfMonth = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
export const monthDays = (month: string): string[] => {
  const last = Number(lastOfMonth(month).slice(8, 10));
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
};
export const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
};
const shortDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dayList = (days: string[]) => `${days.slice(0, 8).map(shortDay).join(", ")}${days.length > 8 ? " and more" : ""}`;
const dayOf = (stamp: string | null | undefined) => String(stamp ?? "").slice(0, 10);

// ── What the month shows ─────────────────────────────────────────────────────
export interface FindingRow {
  id: number; name: string; row_kind: string; frequency: string; required_code: string | null;
  created_at: string; active: number; retired_at: string | null; first_entry_day?: string | null;
}
export interface FindingEntry {
  row_id: number; log_date: string; code: string; lot_number?: string | null; expiration_date?: string | null;
  lot_expired?: number | null; corrective_action?: string | null; created_at?: string | null;
}

/** The day a row starts being expected: the day it was added, or its first entry if a lab moving over back-entered older logs. */
export function rowInUseFrom(row: Pick<FindingRow, "created_at" | "first_entry_day">): string {
  const created = dayOf(row.created_at);
  return row.first_entry_day && row.first_entry_day < created ? row.first_entry_day : created;
}

/** A row appears on a month's grid unless it was retired before that month and has nothing in it. A new row shows on older months, so a lab can back-enter. */
export function rowShownInMonth(row: Pick<FindingRow, "active" | "retired_at">, month: string, hasEntries: boolean): boolean {
  if (hasEntries || row.active) return true;
  return dayOf(row.retired_at) >= `${month}-01`;
}

const countsForRow = (row: FindingRow, e: FindingEntry): boolean => e.row_id === row.id && (!row.required_code || e.code === row.required_code);

/**
 * A daily row's days short in a month: a day the instrument was used (anything recorded on its grid that day) with nothing on this row.
 * A stainer doesn't run every day, so a day with nothing recorded anywhere isn't called short here; the month's note names those days
 * for the reviewer. Today isn't over, and a row isn't expected before it was in use or from the day it was retired.
 */
export function dailyShortDays(row: FindingRow, entries: FindingEntry[], usedDays: string[], today: string): string[] {
  if (row.frequency !== "daily") return [];
  const from = rowInUseFrom(row);
  const retired = row.active ? "" : dayOf(row.retired_at);
  return usedDays.filter((d) => d < today && d >= from && (!retired || d < retired) && !entries.some((e) => e.log_date === d && countsForRow(row, e)));
}

export interface MonthFindings {
  problems: string[];
  notes: string[];
  used_days: string[];
  summary: { stain_rows: number; stain_entries: number; stain_days: number; stain_changes: number; check_problems: number; expired_lots: number; entered_late: number; voided: number };
}

/**
 * What the month's stain log shows the reviewer. Problems need a corrective action on the review: a daily row short on a day in use, a
 * monthly row with nothing in a finished month, or a lot in the station past its expiration with no action recorded. A check marked
 * Problem and a lot already expired when it was recorded carry their own action, so they're shown and don't force another one.
 * `entries` are the month's live entries. `priorChanges` holds, per row, the last live change before the month, so a lot put in last
 * month and expiring this month is still seen.
 */
export function stainMonthFindings(args: { rows: FindingRow[]; entries: FindingEntry[]; priorChanges: FindingEntry[]; voided: number; month: string; today: string }): MonthFindings {
  const { rows, entries, priorChanges, voided, month, today } = args;
  const first = `${month}-01`;
  const last = lastOfMonth(month);
  const monthOver = last < today;
  const used = Array.from(new Set(entries.map((e) => e.log_date))).sort();
  const problems: string[] = [];

  for (const row of rows) {
    const short = dailyShortDays(row, entries, used, today);
    if (short.length) problems.push(`${row.name}: ${plural(short.length, "day")} in use with ${row.required_code ? `no ${row.required_code} recorded` : "no entry"}: ${dayList(short)}`);

    if (row.frequency === "monthly" && monthOver && used.length && rowInUseFrom(row) <= first && (row.active || dayOf(row.retired_at) > last) && !entries.some((e) => countsForRow(row, e))) {
      problems.push(`${row.name}: ${row.required_code ? `no ${row.required_code} (${CODE_LABELS[row.required_code].toLowerCase()})` : "nothing"} recorded this month`);
    }

    if (row.row_kind === "stain") {
      const changes = [...priorChanges, ...entries].filter((e) => e.row_id === row.id && e.code === "C" && e.expiration_date).sort((a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0));
      const retired = row.active ? "" : dayOf(row.retired_at);
      const pastExpiry = new Map<string, { lot: string; expiration: string; days: string[] }>();
      for (const d of used) {
        if (retired && d >= retired) continue;
        const current = changes.filter((c) => c.log_date <= d).pop();
        // A lot already expired when it went in has its action on that entry. One that expires later, in the station, hasn't had one.
        if (!current || current.lot_expired || String(current.expiration_date) >= d) continue;
        const key = `${current.lot_number}|${current.expiration_date}`;
        if (!pastExpiry.has(key)) pastExpiry.set(key, { lot: String(current.lot_number ?? ""), expiration: String(current.expiration_date), days: [] });
        pastExpiry.get(key)!.days.push(d);
      }
      pastExpiry.forEach((v) => problems.push(`${row.name}: lot ${v.lot} expired ${v.expiration} and was in use on ${plural(v.days.length, "day")} after that: ${dayList(v.days)}`));
    }
  }

  const changes = entries.filter((e) => e.code === "C").length;
  const checkProblems = entries.filter((e) => e.code === "PROBLEM").length;
  const expiredLots = entries.filter((e) => e.lot_expired).length;
  const late = entries.filter((e) => e.created_at && dayOf(e.created_at) > addDays(e.log_date, 2)).length;

  // Days between the log's start and the last finished day with nothing recorded at all: weekends, or a day missed. The reviewer can tell which.
  const startCandidates = rows.map((r) => rowInUseFrom(r)).sort();
  const logStart = startCandidates[0] && startCandidates[0] > first ? startCandidates[0] : first;
  const end = monthOver ? last : addDays(today, -1);
  const quiet = used.length ? monthDays(month).filter((d) => d >= logStart && d <= end && !used.includes(d)) : [];

  const notes = [
    used.length ? `${plural(used.length, "day")} on the stain log` : "",
    changes ? plural(changes, "stain or solution change") : "",
    checkProblems ? `${plural(checkProblems, "check")} marked Problem, each with its corrective action` : "",
    expiredLots ? `${plural(expiredLots, "entry", "entries")} with an expired lot, each with its corrective action` : "",
    late ? `${plural(late, "stain log entry", "stain log entries")} added more than 2 days after the date` : "",
    voided ? `${plural(voided, "stain log entry", "stain log entries")} voided, with the reason` : "",
    quiet.length ? `${plural(quiet.length, "day")} with nothing on the stain log: ${dayList(quiet)}` : "",
  ].filter(Boolean);

  return {
    problems, notes, used_days: used,
    summary: { stain_rows: rows.length, stain_entries: entries.length, stain_days: used.length, stain_changes: changes, check_problems: checkProblems, expired_lots: expiredLots, entered_late: late, voided },
  };
}

/** What a month of the manual stain log shows the reviewer. A Problem carries its own corrective action, so nothing here forces another one. */
export function manualMonthFindings(entries: { result: string; test_slide?: number | null; log_date: string; created_at?: string | null }[], voided: number) {
  const problems = entries.filter((e) => e.result === "problem").length;
  const tests = entries.filter((e) => e.test_slide).length;
  const late = entries.filter((e) => e.created_at && dayOf(e.created_at) > addDays(e.log_date, 2)).length;
  const notes = [
    plural(entries.length, "manual stain"),
    tests ? plural(tests, "test slide") : "",
    problems ? `${plural(problems, "problem")}, each with its corrective action` : "",
    late ? `${plural(late, "entry", "entries")} added more than 2 days after the date` : "",
    voided ? `${plural(voided, "entry", "entries")} voided, with the reason` : "",
  ].filter(Boolean);
  return { notes, summary: { manual_entries: entries.length, test_slides: tests, problems, entered_late: late, voided } };
}
