// scripts/veritadc-load-plan.mts
//
// The pure half of the VeritaDC bulk load (scripts/veritadc-bulk-load.mts): which manifest rows load, into which lab and
// manual, and with what dates. No files, no network. Receipt: scripts/verify-veritadc-carried-over.mts.

import { usDateToIso, parseSourceVersion } from "../shared/policyCarriedOver";

export interface LoadConfig {
  batch: string;
  sourceSystem: string;
  loadedBy: string;
  ownerUserId: number;
  reviewIntervalMonths: number;
  // Lab id -> the lab's exact name. The server refuses a document when the name doesn't match.
  labs: Record<string, { expectedLabName: string }>;
  // Top-level manual in the export -> the lab or labs it goes in.
  topLevel: Record<string, number[]>;
  // Document-number prefix -> lab, only for reporting a document that is in no manual and has no file.
  noManualLabByPrefix?: Record<string, number>;
}

export type Selection = "load" | "retired" | "past_due_excluded" | "not_current";

/** "approved and current" loads. A document past its review date is in use, so it loads when the flag says so. */
export function selectByStatus(status: string, includePastDue: boolean): Selection {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "approved and current") return "load";
  if (s === "retired") return "retired";
  if (s.startsWith("past periodic review date")) return includePastDue ? "load" : "past_due_excluded";
  return "not_current";
}

export const splitPaths = (manualPaths: string): string[][] =>
  String(manualPaths ?? "")
    .split(" || ")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split(" / ").map((x) => x.trim()));

export interface Placement {
  labId: number;
  manualPath: string[];
  alsoFiledIn: string[];
}

/**
 * One placement per lab the document belongs to. VeritaDC holds a document in one manual per lab, so when a document is
 * filed in several places in a lab: a folder shared by every lab (Systemwide Laboratory General) wins, then the deepest
 * folder (the most specific), then the first by name. Every other place it was filed is kept on the record.
 */
export function placementsFor(manualPaths: string, config: LoadConfig): { placements: Placement[]; unmapped: string[] } {
  const paths = splitPaths(manualPaths);
  const unmapped = paths.filter((p) => !config.topLevel[p[0]]).map((p) => p.join(" / "));
  const byLab = new Map<number, string[][]>();
  for (const p of paths) {
    for (const lab of config.topLevel[p[0]] || []) {
      if (!byLab.has(lab)) byLab.set(lab, []);
      byLab.get(lab)!.push(p);
    }
  }
  const shared = (p: string[]) => (config.topLevel[p[0]] || []).length > 1;
  const placements: Placement[] = [...byLab.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([labId, candidates]) => {
      const best = [...candidates].sort(
        (a, b) => Number(shared(b)) - Number(shared(a)) || b.length - a.length || a.join("/").localeCompare(b.join("/"))
      )[0];
      const bestKey = best.join(" / ");
      return { labId, manualPath: best, alsoFiledIn: paths.map((p) => p.join(" / ")).filter((p) => p !== bestKey).sort() };
    });
  return { placements, unmapped };
}

/** Months from the last approval or review to the next review due, when both are known. */
export function reviewGapMonths(lastIso: string | null, nextIso: string | null): number | null {
  if (!lastIso || !nextIso) return null;
  const [ly, lm] = lastIso.split("-").map(Number);
  const [ny, nm] = nextIso.split("-").map(Number);
  return (ny - ly) * 12 + (nm - lm);
}

export interface RowDates {
  version: string;
  versionOk: boolean;
  effectiveDate: string | null;
  lastApprovalOrReview: string | null;
  nextReviewDue: string | null;
  badDates: string[];
}

export function datesFor(row: { version?: string; effective_date?: string; last_approval_or_review?: string; next_review_due?: string }): RowDates {
  const badDates: string[] = [];
  const parse = (label: string, raw: string | undefined) => {
    if (!String(raw ?? "").trim()) return null;
    const iso = usDateToIso(raw);
    if (!iso) badDates.push(label);
    return iso;
  };
  const version = String(row.version ?? "").trim();
  return {
    version,
    versionOk: !!parseSourceVersion(version),
    effectiveDate: parse("effective_date", row.effective_date),
    lastApprovalOrReview: parse("last_approval_or_review", row.last_approval_or_review),
    nextReviewDue: parse("next_review_due", row.next_review_due),
    badDates,
  };
}

/** The raw title as the prior system shows it: the face page's first heading, less the number. "" if it can't be read. */
export function titleFromFacePage(html: string, number: string): string {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!m) return "";
  const text = m[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
  const numberPart = String(number ?? "").replace(/\s+/g, " ").trim();
  if (text.toLowerCase().startsWith(numberPart.toLowerCase() + " ")) return text.slice(numberPart.length + 1).trim();
  return "";
}

export function parseCsv(textIn: string): Record<string, string>[] {
  const text = textIn.replace(/^﻿/, "");
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

export const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
