// shared/qualityIndicators.ts
//
// The VeritaQA rules the server, the screens and the reports share (B15): how a value reads against a target, what an
// organization's indicator is made of, and how a month, a quarter or a year adds up. Pure: no database, no dates from the
// clock. scripts/verify-quality-indicators.mts is the receipt.
//
// Targets are the laboratory's or the organization's own. Nothing here supplies one.

/** A lab's own indicator against its own thresholds (the VeritaQA dashboard's rule, moved here unchanged). */
export function indicatorStatus(
  value: number | null | undefined,
  m: { direction?: string | null; benchmark_green?: number | null; benchmark_yellow?: number | null },
): "green" | "yellow" | "red" | null {
  if (value == null) return null;
  if (m.benchmark_green == null && m.benchmark_yellow == null) return null;
  if (m.direction === "lower_is_better") {
    if (m.benchmark_green != null && value <= m.benchmark_green) return "green";
    if (m.benchmark_yellow != null && value <= m.benchmark_yellow) return "yellow";
    return "red";
  }
  if (m.benchmark_green != null && value >= m.benchmark_green) return "green";
  if (m.benchmark_yellow != null && value >= m.benchmark_yellow) return "yellow";
  return "red";
}

// ── An organization's indicator ─────────────────────────────────────────────

export const ORG_INDICATOR_KINDS = ["percent", "per_1000", "ratio", "count"] as const;
export type OrgIndicatorKind = (typeof ORG_INDICATOR_KINDS)[number];
export const ORG_KIND_LABEL: Record<OrgIndicatorKind, string> = {
  percent: "Percent (numerator / denominator)",
  per_1000: "Rate per 1,000",
  ratio: "Average or ratio (numerator / denominator)",
  count: "Count",
};
export const ORG_FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;
export type OrgFrequency = (typeof ORG_FREQUENCIES)[number];
export const ORG_FREQUENCY_LABEL: Record<OrgFrequency, string> = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };
export const DIRECTIONS = ["lower_is_better", "higher_is_better"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** One version of an organization's indicator. effective_from is a month, YYYY-MM. */
export interface OrgIndicatorVersion {
  version: number;
  effective_from: string;
  name: string;
  definition: string | null;
  numerator_text: string | null;
  denominator_text: string | null;
  kind: OrgIndicatorKind;
  unit: string | null;
  target: number | null;
  direction: Direction;
  frequency: OrgFrequency;
  department: string;
}

export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/** The version in force for a month: the newest one that had started by then, else the first. */
export function versionForMonth<V extends { version: number; effective_from: string }>(versions: V[], ym: string): V | null {
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  let found: V | null = null;
  for (const v of sorted) if (v.effective_from <= ym) found = v;
  return found ?? sorted[0] ?? null;
}

/** The months an indicator takes a number in. A quarter's number goes on its last month, a year's on December. */
export function entryMonths(frequency: OrgFrequency): number[] {
  if (frequency === "quarterly") return [3, 6, 9, 12];
  if (frequency === "yearly") return [12];
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
}

export const orgUnit = (kind: OrgIndicatorKind, unit?: string | null): string =>
  kind === "percent" ? "%" : kind === "per_1000" ? "per 1,000" : (unit || "");

/** The value a numerator and denominator make. Null when they can't (no denominator). */
export function orgValue(kind: OrgIndicatorKind, numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || !Number.isFinite(numerator)) return null;
  if (kind === "count") return numerator;
  if (denominator == null || !Number.isFinite(denominator) || denominator <= 0) return null;
  const r = numerator / denominator;
  return kind === "percent" ? r * 100 : kind === "per_1000" ? r * 1000 : r;
}

export function targetMet(value: number | null, target: number | null | undefined, direction: string | null | undefined): boolean | null {
  if (value == null || target == null) return null;
  return direction === "higher_is_better" ? value >= target : value <= target;
}

export function targetText(target: number | null | undefined, direction: string | null | undefined, unit: string | null | undefined): string {
  if (target == null) return "Not set";
  const u = unit ? (unit === "%" ? "%" : ` ${unit}`) : "";
  return `${direction === "higher_is_better" ? "At least" : "At most"} ${trimNumber(target)}${u}`;
}

/** Up to 2 decimals, trailing zeros dropped; 12.5, 3, 0.25. */
export function trimNumber(n: number): string {
  return String(Math.round((n + Number.EPSILON) * 100) / 100);
}

export function valueText(value: number | null | undefined, unit: string | null | undefined): string {
  if (value == null) return "";
  const u = unit ? (unit === "%" ? "%" : ` ${unit}`) : "";
  return `${trimNumber(value)}${u}`;
}

// ── Periods ────────────────────────────────────────────────────────────────

export const PERIOD_KINDS = ["month", "quarter", "ytd", "year"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
export const PERIOD_LABEL: Record<PeriodKind, string> = { month: "Month", quarter: "Quarter", ytd: "Year to date", year: "Year" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface Period { kind: PeriodKind; year: number; months: number[]; from: string; to: string; label: string; fileTag: string }

/** A period from a request's values, or the reason it isn't one. */
export function parsePeriod(q: { period?: unknown; year?: unknown; month?: unknown; quarter?: unknown }, kinds: readonly PeriodKind[] = PERIOD_KINDS): { period: Period } | { error: string } {
  const kind = String(q.period ?? "") as PeriodKind;
  if (!kinds.includes(kind)) return { error: `period must be one of: ${kinds.join(", ")}.` };
  const year = Number(q.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: "year must be a year, for example 2026." };
  const make = (months: number[], label: string, fileTag: string): { period: Period } => ({
    period: { kind, year, months, from: monthKey(year, months[0]), to: monthKey(year, months[months.length - 1]), label, fileTag },
  });
  if (kind === "year") return make([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], `Year ${year}`, `${year}`);
  if (kind === "quarter") {
    const quarter = Number(q.quarter);
    if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) return { error: "quarter must be 1 to 4." };
    const first = (quarter - 1) * 3 + 1;
    return make([first, first + 1, first + 2], `Quarter ${quarter}, ${year}`, `${year}_Q${quarter}`);
  }
  const month = Number(q.month);
  if (!Number.isInteger(month) || month < 1 || month > 12) return { error: "month must be 1 to 12." };
  if (kind === "month") return make([month], `${MONTHS[month - 1]} ${year}`, monthKey(year, month));
  return make(Array.from({ length: month }, (_, i) => i + 1), `Year to date, January to ${MONTHS[month - 1]} ${year}`, `${year}_YTD_${String(month).padStart(2, "0")}`);
}

/** How many entries a period holds for a frequency. */
export function expectedEntries(frequency: OrgFrequency, months: number[]): number {
  const due = new Set(entryMonths(frequency));
  return months.filter((m) => due.has(m)).length;
}

// ── Adding a period up, from numerators and denominators only ──────────────────────

/** One entry of an organization's indicator, with the kind and target in force when it was entered. */
export interface OrgEntry {
  month: number;
  numerator: number | null;
  denominator: number | null;
  kind: OrgIndicatorKind | null;
  unit: string | null;
  target: number | null;
  direction: string | null;
}

export interface PeriodResult {
  /** "no_entry": nothing was entered, so there is no value, and it counts as neither met nor missed. */
  state: "entered" | "no_entry";
  entered: number;
  expected: number;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  kind: OrgIndicatorKind | null;
  unit: string | null;
  target: number | null;
  direction: string | null;
  met: boolean | null;
  /** Why there is no value or no met or missed, in words. */
  note: string | null;
}

export const TARGET_CHANGED = "The target changed during the period.";

/** A laboratory's number for a period: the sum of numerators over the sum of denominators, never an average of percents. */
export function rollPeriod(entries: OrgEntry[], expected: number): PeriodResult {
  const got = entries.filter((e) => e.kind != null && e.numerator != null && (e.kind === "count" || e.denominator != null));
  const empty: PeriodResult = { state: "no_entry", entered: 0, expected, value: null, numerator: null, denominator: null, kind: null, unit: null, target: null, direction: null, met: null, note: null };
  if (!got.length) return empty;
  const kinds = new Set(got.map((e) => `${e.kind}|${e.unit ?? ""}`));
  if (kinds.size > 1) return { ...empty, state: "entered", entered: got.length, note: "The kind of indicator changed during the period, so its months aren't added together." };
  const kind = got[0].kind as OrgIndicatorKind;
  const numerator = got.reduce((s, e) => s + (e.numerator as number), 0);
  const denominator = kind === "count" ? null : got.reduce((s, e) => s + (e.denominator as number), 0);
  const value = orgValue(kind, numerator, denominator);
  const targets = new Set(got.map((e) => `${e.target ?? ""}|${e.direction ?? ""}`));
  const base = { state: "entered" as const, entered: got.length, expected, value, numerator, denominator, kind, unit: got[0].unit };
  if (targets.size > 1) return { ...base, target: null, direction: null, met: null, note: TARGET_CHANGED };
  const { target, direction } = got[0];
  if (target == null) return { ...base, target: null, direction, met: null, note: "No target set." };
  if (kind === "count" && got.length > 1) return { ...base, target, direction, met: null, note: "The target is for one entry; this is the total of several." };
  return { ...base, target, direction, met: targetMet(value, target, direction), note: null };
}

export interface TotalResult { shown: boolean; reason: string | null; labs_counted: number; value: number | null; numerator: number | null; denominator: number | null; unit: string | null }

/** Across laboratories: sums only, and only when every laboratory counted entered the same kind of indicator. */
export function totalAcross(rows: PeriodResult[]): TotalResult {
  const none: TotalResult = { shown: false, reason: null, labs_counted: 0, value: null, numerator: null, denominator: null, unit: null };
  const entered = rows.filter((r) => r.state === "entered");
  if (!entered.length) return { ...none, reason: "No entries in this period." };
  if (entered.some((r) => r.kind == null)) return { ...none, labs_counted: entered.length, reason: "Not totaled: the kind of indicator changed during the period in at least one laboratory." };
  if (new Set(entered.map((r) => `${r.kind}|${r.unit ?? ""}`)).size > 1) return { ...none, labs_counted: entered.length, reason: "Not totaled: the laboratories entered different kinds of indicator." };
  const kind = entered[0].kind as OrgIndicatorKind;
  const numerator = entered.reduce((s, r) => s + (r.numerator as number), 0);
  const denominator = kind === "count" ? null : entered.reduce((s, r) => s + (r.denominator as number), 0);
  return { shown: true, reason: null, labs_counted: entered.length, value: orgValue(kind, numerator, denominator), numerator, denominator, unit: entered[0].unit };
}

/** The words a report prints for met, missed and neither. */
export const metText = (met: boolean | null, state: "entered" | "no_entry"): string => (state === "no_entry" ? "No entry" : met === true ? "Met" : met === false ? "Missed" : "Not judged");

export const ACCOUNT_WIDE_LABEL = "Account-wide, not assigned to a laboratory";
