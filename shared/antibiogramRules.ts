// shared/antibiogramRules.ts
//
// VeritaQA(TM) Stewardship tab, the laboratory's share of the hospital's antibiotic stewardship program (parking lot #81,
// docs/ANTIMICROBIAL_STEWARDSHIP_SCOPE.md; Michael 2026-11-23, Decision 14 = 2: the minimum version now).
//
// The cumulative antibiogram is built from the LIS's aggregate totals only: organism x antimicrobial, number tested, number
// susceptible (intermediate and resistant optional). No patient identifiers and no isolate-level rows ever enter VeritaAssure:
// the LIS removes repeat isolates before the lab uploads its totals, and an upload with any column outside the known set is
// refused, so a patient column can't ride along.
//
// PENDING CLSI M39 ED5 (2022): the defaults below (30 isolates, a 12-month period, the first-isolate note, whole-percent
// rounding, intermediate not counted as susceptible) are lab settings, not claims. They are to be checked against the purchased
// M39 before release to customers (Michael is buying it, Decision 14 = 2). Nothing on screen says "per CLSI M39" until then.

export type OrganismGroup = "gram_negative" | "gram_positive" | "other";
export type BelowThresholdMode = "suppress" | "flag";

export const ORGANISM_GROUP_LABELS: Record<OrganismGroup, string> = {
  gram_negative: "Gram-negative organisms",
  gram_positive: "Gram-positive organisms",
  other: "Other organisms",
};
export const ORGANISM_GROUP_ORDER: OrganismGroup[] = ["gram_negative", "gram_positive", "other"];

export interface StewardshipSettings {
  isolate_threshold: number;
  below_threshold: BelowThresholdMode;
  period_months: number;
  first_isolate_note: string;
}

// Pending confirmation against CLSI M39 ED5 (2022); see the header.
export const STEWARDSHIP_DEFAULTS: StewardshipSettings = {
  isolate_threshold: 30,
  below_threshold: "suppress",
  period_months: 12,
  first_isolate_note: "First isolate of each species per patient per analysis period, removed in the laboratory's LIS before upload.",
};
export const M39_PENDING_NOTE = "Default settings pending confirmation against CLSI M39 ED5 (2022).";

export interface AbgRow {
  organism: string;
  organism_group: OrganismGroup;
  antimicrobial: string;
  tested: number;
  susceptible: number;
  intermediate: number | null;
  resistant: number | null;
}

export interface RowError { line: number; message: string }

const clean = (v: unknown, max = 120): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Organism group from what a lab types or its LIS prints. Blank or unknown is "other". */
export function parseOrganismGroup(v: unknown): OrganismGroup {
  const s = clean(v).toLowerCase().replace(/[\s_-]+/g, " ");
  if (!s) return "other";
  if (/^(gram )?neg(ative)?$|^gn$|^gram negative/.test(s)) return "gram_negative";
  if (/^(gram )?pos(itive)?$|^gp$|^gram positive/.test(s)) return "gram_positive";
  return "other";
}

/** A count: a whole number 0 or more. Blank is null. Anything else is an error string. */
export function parseCount(v: unknown): number | null | { error: string } {
  if (v == null) return null;
  const s = String(v).replace(/,/g, "").trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return { error: `"${clean(s, 20)}" is not a whole number` };
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n > 1_000_000) return { error: `${s} is too large` };
  return n;
}

/** One row from the grid or the upload, checked. Line is for the message only. */
export function validateRow(raw: any, line: number): { row?: AbgRow; errors: RowError[] } {
  const errors: RowError[] = [];
  const organism = clean(raw?.organism);
  const antimicrobial = clean(raw?.antimicrobial);
  if (!organism) errors.push({ line, message: "Organism is blank." });
  if (!antimicrobial) errors.push({ line, message: "Antimicrobial is blank." });
  const counts: Record<string, number | null> = {};
  for (const k of ["tested", "susceptible", "intermediate", "resistant"]) {
    const p = parseCount(raw?.[k]);
    if (p && typeof p === "object") { errors.push({ line, message: `${k[0].toUpperCase()}${k.slice(1)}: ${p.error}.` }); counts[k] = null; }
    else counts[k] = p as number | null;
  }
  if (counts.tested == null) errors.push({ line, message: "Number tested is blank." });
  else if (counts.tested < 1) errors.push({ line, message: "Number tested must be at least 1." });
  if (counts.susceptible == null) errors.push({ line, message: "Number susceptible is blank." });
  if (counts.tested != null && counts.susceptible != null && counts.susceptible > counts.tested) {
    errors.push({ line, message: `Number susceptible (${counts.susceptible}) is more than number tested (${counts.tested}).` });
  }
  if (counts.tested != null && counts.susceptible != null) {
    const sum = counts.susceptible + (counts.intermediate ?? 0) + (counts.resistant ?? 0);
    if (sum > counts.tested) errors.push({ line, message: `Susceptible, intermediate and resistant add up to ${sum}, more than the ${counts.tested} tested.` });
  }
  if (errors.length) return { errors };
  return {
    errors,
    row: {
      organism, antimicrobial, organism_group: parseOrganismGroup(raw?.organism_group),
      tested: counts.tested as number, susceptible: counts.susceptible as number,
      intermediate: counts.intermediate, resistant: counts.resistant,
    },
  };
}

/** A set of rows: each checked, and one organism and antimicrobial pair at most once. */
export function validateRows(raws: any[], firstLine = 1): { rows: AbgRow[]; errors: RowError[] } {
  const rows: AbgRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  (raws || []).forEach((raw, i) => {
    const line = firstLine + i;
    const v = validateRow(raw, line);
    errors.push(...v.errors);
    if (!v.row) return;
    const key = `${v.row.organism.toLowerCase()}|${v.row.antimicrobial.toLowerCase()}`;
    if (seen.has(key)) { errors.push({ line, message: `${v.row.organism} and ${v.row.antimicrobial} is already on line ${seen.get(key)}.` }); return; }
    seen.set(key, line);
    rows.push(v.row);
  });
  return { rows, errors };
}

// The upload's columns. Only these; anything else is refused by name (no patient field can ride along).
const COLUMN_ALIASES: Record<string, keyof AbgRow> = {
  "organism": "organism", "organism name": "organism", "species": "organism",
  "group": "organism_group", "organism group": "organism_group", "gram": "organism_group", "gram stain": "organism_group",
  "antimicrobial": "antimicrobial", "antimicrobial agent": "antimicrobial", "drug": "antimicrobial", "antibiotic": "antimicrobial", "agent": "antimicrobial",
  "tested": "tested", "number tested": "tested", "n tested": "tested", "isolates tested": "tested", "total tested": "tested",
  "susceptible": "susceptible", "number susceptible": "susceptible", "n susceptible": "susceptible", "s": "susceptible",
  "intermediate": "intermediate", "number intermediate": "intermediate", "i": "intermediate",
  "resistant": "resistant", "number resistant": "resistant", "r": "resistant",
};
export const UPLOAD_COLUMNS_HELP = "organism, group (gram-negative, gram-positive or blank), antimicrobial, tested, susceptible, and optionally intermediate and resistant";

/** RFC 4180 style: quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF or LF, a leading BOM. */
export function parseCsvText(text: string): string[][] {
  const s = String(text ?? "").replace(/^﻿/, "");
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) out.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) out.push(row);
  return out;
}

/** The LIS totals file to rows. Refuses unknown columns by name, and needs organism, antimicrobial, tested and susceptible. */
export function parseAntibiogramCsv(text: string): { rows: AbgRow[]; errors: RowError[]; unknown_columns: string[] } {
  const table = parseCsvText(text);
  if (table.length === 0) return { rows: [], errors: [{ line: 1, message: "The file is empty." }], unknown_columns: [] };
  const header = table[0].map((h) => clean(h).toLowerCase().replace(/[_]+/g, " ").replace(/\s*#\s*$/, ""));
  const unknown = header.filter((h) => h && !(h in COLUMN_ALIASES));
  if (unknown.length) {
    return { rows: [], unknown_columns: unknown, errors: [{ line: 1, message: `Columns not accepted: ${unknown.join(", ")}. The file may have only ${UPLOAD_COLUMNS_HELP}. Remove the other columns and upload again.` }] };
  }
  const idx: Partial<Record<keyof AbgRow, number>> = {};
  header.forEach((h, i) => { if (h) { const k = COLUMN_ALIASES[h]; if (idx[k] === undefined) idx[k] = i; } });
  const missing = (["organism", "antimicrobial", "tested", "susceptible"] as (keyof AbgRow)[]).filter((k) => idx[k] === undefined);
  if (missing.length) return { rows: [], unknown_columns: [], errors: [{ line: 1, message: `Missing columns: ${missing.join(", ")}.` }] };
  const raws = table.slice(1).map((cells) => {
    const o: any = {};
    for (const [k, i] of Object.entries(idx)) o[k] = cells[i as number] ?? "";
    return o;
  });
  if (raws.length === 0) return { rows: [], unknown_columns: [], errors: [{ line: 2, message: "The file has a header row and no totals." }] };
  const { rows, errors } = validateRows(raws, 2);
  return { rows, errors, unknown_columns: [] };
}

/** Whole percent susceptible (number susceptible / number tested). Pending M39: the rounding rule. */
export function percentSusceptible(susceptible: number, tested: number): number | null {
  if (!(tested > 0)) return null;
  return Math.round((susceptible * 100) / tested);
}

export interface AbgCell { tested: number; susceptible: number; pct: number | null; below: boolean; shown: boolean }
export interface AbgOrganism { organism: string; isolates: number; below: boolean; cells: Record<string, AbgCell> }
export interface AbgGroup { group: OrganismGroup; label: string; drugs: string[]; organisms: AbgOrganism[] }

/**
 * The table the lab releases: one block per organism group, organisms down and antimicrobials across, in the order the rows
 * came (the LIS report's order). A cell under the threshold is marked below; in "suppress" mode its percent isn't shown, in
 * "flag" mode it is shown and marked. An organism's isolates is the most tested for any of its antimicrobials.
 */
export function computeAntibiogram(rows: AbgRow[], opts: { threshold: number; mode: BelowThresholdMode }): AbgGroup[] {
  const groups: AbgGroup[] = [];
  for (const g of ORGANISM_GROUP_ORDER) {
    const gr = rows.filter((r) => r.organism_group === g);
    if (gr.length === 0) continue;
    const drugs: string[] = [];
    const orgs = new Map<string, AbgOrganism>();
    for (const r of gr) {
      if (!drugs.includes(r.antimicrobial)) drugs.push(r.antimicrobial);
      let o = orgs.get(r.organism);
      if (!o) { o = { organism: r.organism, isolates: 0, below: false, cells: {} }; orgs.set(r.organism, o); }
      const below = r.tested < opts.threshold;
      o.cells[r.antimicrobial] = { tested: r.tested, susceptible: r.susceptible, pct: percentSusceptible(r.susceptible, r.tested), below, shown: !below || opts.mode === "flag" };
      o.isolates = Math.max(o.isolates, r.tested);
    }
    for (const o of orgs.values()) o.below = o.isolates < opts.threshold;
    groups.push({ group: g, label: ORGANISM_GROUP_LABELS[g], drugs, organisms: [...orgs.values()] });
  }
  return groups;
}

/** Settings from a request body, checked. Missing keys keep the current value. */
export function parseSettings(body: any, current: StewardshipSettings): { settings?: StewardshipSettings; error?: string } {
  const out = { ...current };
  if (body?.isolate_threshold !== undefined) {
    const n = Number(body.isolate_threshold);
    if (!Number.isInteger(n) || n < 1 || n > 1000) return { error: "The fewest isolates to report a percent must be a whole number from 1 to 1000." };
    out.isolate_threshold = n;
  }
  if (body?.below_threshold !== undefined) {
    if (body.below_threshold !== "suppress" && body.below_threshold !== "flag") return { error: "Below the threshold, choose suppress or flag." };
    out.below_threshold = body.below_threshold;
  }
  if (body?.period_months !== undefined) {
    const n = Number(body.period_months);
    if (!Number.isInteger(n) || n < 1 || n > 36) return { error: "The analysis period must be a whole number of months from 1 to 36." };
    out.period_months = n;
  }
  if (body?.first_isolate_note !== undefined) {
    const s = clean(body.first_isolate_note, 400);
    if (!s) return { error: "Describe how repeat isolates are removed." };
    out.first_isolate_note = s;
  }
  return { settings: out };
}

export const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(`${v}T00:00:00Z`));

/** The date n months before a YYYY-MM-DD day (end of month clamps). */
export function monthsBefore(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const total = y * 12 + (m - 1) - n;
  const ny = Math.floor(total / 12), nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

// ── The readiness view: CFR rows only (no TJC or CAP row until their source text is verified). ───────────────────────
// Verbatim from eCFR, current as of 2026-11-19 (api/versioner/v1/full/2026-11-19/title-42.xml, sections 482.42 and 485.640).
export const CFR_AS_OF = "2026-11-19";
export const CFR_STEWARDSHIP = [
  {
    key: "482.42(b)(2)(i)",
    citation: "42 CFR 482.42(b)(2)(i)",
    applies_to: "Hospitals",
    lead: "(b) Standard: Antibiotic stewardship program organization and policies. The hospital must demonstrate that: ... (2) The hospital-wide antibiotic stewardship program:",
    text: "(i) Demonstrates coordination among all components of the hospital responsible for antibiotic use and resistance, including, but not limited to, the infection prevention and control program, the QAPI program, the medical staff, nursing services, and pharmacy services;",
  },
  {
    key: "485.640(b)(2)(i)",
    citation: "42 CFR 485.640(b)(2)(i)",
    applies_to: "Critical access hospitals",
    lead: "(b) Standard: Antibiotic stewardship program organization and policies. The CAH must demonstrate that: ... (2) The facility-wide antibiotic stewardship program:",
    text: "(i) Demonstrates coordination among all components of the CAH responsible for antibiotic use and resistance, including, but not limited to, the infection prevention and control program, the QAPI program, the medical staff, nursing services, and pharmacy services;",
  },
] as const;

export type ReadinessState = "met" | "not_met";
export interface ReadinessItem { key: string; label: string; state: ReadinessState; detail: string }

/** The laboratory's evidence of coordination, worked out from what it recorded. today is the lab's today (YYYY-MM-DD). */
export function stewardshipReadiness(input: {
  today: string;
  periodMonths: number;
  lastReleased: { released_day: string; period_end: string; version: number; title: string } | null;
  lastMeetingDate: string | null;
  openActions: { due_date: string | null }[];
}): ReadinessItem[] {
  const since = monthsBefore(input.today, input.periodMonths);
  const yearAgo = monthsBefore(input.today, 12);
  const rel = input.lastReleased;
  const relDay = rel ? rel.released_day : null;
  const overdue = input.openActions.filter((a) => a.due_date && a.due_date < input.today).length;
  return [
    {
      key: "antibiogram",
      label: `A cumulative antibiogram released within the lab's analysis period (${input.periodMonths} months)`,
      state: relDay && relDay >= since ? "met" : "not_met",
      detail: rel ? `Last released: "${rel.title}", version ${rel.version}, on ${relDay}, for the period ending ${rel.period_end}.` : "No antibiogram has been released yet.",
    },
    {
      key: "committee",
      label: "The laboratory's participation in the stewardship committee logged in the last 12 months",
      state: input.lastMeetingDate && input.lastMeetingDate >= yearAgo ? "met" : "not_met",
      detail: input.lastMeetingDate ? `Last meeting logged: ${input.lastMeetingDate}.` : "No committee meeting has been logged yet.",
    },
    {
      key: "actions",
      label: "The laboratory's committee action items on time",
      state: overdue === 0 ? "met" : "not_met",
      detail: overdue === 0 ? `${input.openActions.length} open, none past due.` : `${overdue} open action item${overdue === 1 ? "" : "s"} past due.`,
    },
  ];
}
