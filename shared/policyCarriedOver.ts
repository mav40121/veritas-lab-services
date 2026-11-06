// shared/policyCarriedOver.ts
//
// Documents carried over into VeritaDC from a lab's prior system (Step E of Heywood's move out of MediaLab, 2026-11-06).
// The pure rules, shared by the server route (server/veritadcBulkLoad.ts), the load script (scripts/veritadc-bulk-load.mts)
// and the screens: what a carried-over record must hold, how a raw file-name title is cleaned, and how review reminders
// treat a document that arrived already past due. Receipt: scripts/verify-veritadc-carried-over.mts.

import { cleanDocNumber } from "./policyVersion";

/** The words the record shows wherever carried-over history appears. Never implies anyone signed in VeritaAssure. */
export function carriedOverNotice(sourceSystem: string): string {
  return `History carried over from the prior system (${sourceSystem}), with its original dates. The people on the signature face page approved and reviewed this document in ${sourceSystem}, not in VeritaAssure®.`;
}

// ── Titles ─────────────────────────────────────────────────────────────────
// Only a file extension and copy markers come off. Nothing is reworded, and inner spacing stays as it was.
const EXTENSIONS = "docx?|dotx?|pdf|pptx?|xlsx?|rtf|html?|txt";
const TRAILING_EXTENSION = new RegExp(`\\.(?:${EXTENSIONS})\\d*$`, "i");
// MediaLab's export turns "." into "-" in file names, so "PROBNP II.doc" can arrive as "PROBNP II-doc".
const TRAILING_DASHED_WORD_EXTENSION = /-docx?\d*$/i;
const TRAILING_COPY_MARKER = /\s*\(\d{1,2}\)$/;

export function cleanCarriedTitle(raw: string): { title: string; changed: boolean } {
  const start = String(raw ?? "").trim();
  let title = start;
  for (;;) {
    const next = title
      .replace(TRAILING_COPY_MARKER, "")
      .replace(TRAILING_EXTENSION, "")
      .replace(TRAILING_DASHED_WORD_EXTENSION, "")
      .trimEnd();
    if (next === title) break;
    title = next;
  }
  // A title that was nothing but a marker stays as it came rather than going blank.
  if (!title) return { title: start, changed: false };
  return { title, changed: title !== start };
}

/** Why a cleaned title still doesn't tell a reader what the document is, or null. It is reported, never rewritten. */
export function titleLooksUnclear(title: string): string | null {
  const t = String(title ?? "").trim();
  if (t.length <= 4) return "very short";
  if (/\d{6,}/.test(t)) return "catalog or file number in the title";
  if (/\b(?:docx?|pdf)\d*\b/i.test(t)) return "file type left in the title";
  if (/[\s_-]0\d{2}$/.test(t)) return "ends in a file counter";
  return null;
}

// ── Dates and versions ─────────────────────────────────────────────────────
/** "3/19/2026" -> "2026-03-19". null when blank or not a real calendar date. */
export function usDateToIso(s: string | null | undefined): string | null {
  const m = String(s ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return isRealIsoDate(iso) ? iso : null;
}

export function isRealIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "2.1" -> { major: 2, minor: 1 }. null unless it is exactly major.minor. */
export function parseSourceVersion(s: unknown): { major: number; minor: number } | null {
  const m = String(s ?? "").trim().match(/^(\d{1,4})\.(\d{1,4})$/);
  if (!m) return null;
  const major = Number(m[1]);
  return major >= 1 ? { major, minor: Number(m[2]) } : null;
}

// ── What a load request must hold ──────────────────────────────────────────
export const CARRIED_REVIEW_INTERVALS = [0, 6, 12, 24] as const;
export const CARRIED_MAX_MANUAL_DEPTH = 10;

export interface CarriedMeta {
  labId: number;
  expectedLabName: string;
  ownerUserId: number;
  batch: string;
  loadedBy: string;
  sourceSystem: string;
  sourceStatus: string | null;
  docNumber: string;
  title: string;
  titleAsExported: string | null;
  version: string;
  effectiveDate: string;
  lastApprovalOrReview: string | null;
  nextReviewDue: string | null;
  reviewIntervalMonths: number;
  remindersStartOn: string;
  author: string | null;
  approvalRows: number;
  reviewRows: number;
  versionCount: number;
  manualPath: string[];
  alsoFiledIn: string[];
  convertedFrom: "doc" | "ppt" | null;
  originalFilename: string | null;
  minFreeBytes: number | null;
}

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const count = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

export function validateCarriedMeta(m: any): { ok: true; value: CarriedMeta } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const labId = Number(m?.labId);
  if (!Number.isInteger(labId) || labId <= 0) problems.push("labId");
  const ownerUserId = Number(m?.ownerUserId);
  if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) problems.push("ownerUserId");
  const expectedLabName = text(m?.expectedLabName);
  if (!expectedLabName) problems.push("expectedLabName");
  const batch = text(m?.batch);
  if (!batch || batch.length > 100) problems.push("batch");
  const loadedBy = text(m?.loadedBy);
  if (!loadedBy || loadedBy.length > 100) problems.push("loadedBy");
  const sourceSystem = text(m?.sourceSystem);
  if (!sourceSystem || sourceSystem.length > 40) problems.push("sourceSystem");
  const number = cleanDocNumber(m?.docNumber);
  if (!number || number === "bad") problems.push("docNumber");
  const title = text(m?.title);
  if (!title || title.length > 300) problems.push("title");
  const version = text(m?.version);
  if (!parseSourceVersion(version)) problems.push("version");
  // A carried-over document always has its real effective date. Without one it would read as if approved at load.
  if (!isRealIsoDate(m?.effectiveDate)) problems.push("effectiveDate");
  const last = m?.lastApprovalOrReview ?? null;
  if (last !== null && !isRealIsoDate(last)) problems.push("lastApprovalOrReview");
  const next = m?.nextReviewDue ?? null;
  if (next !== null && !isRealIsoDate(next)) problems.push("nextReviewDue");
  const interval = Number(m?.reviewIntervalMonths ?? (next ? 12 : 0));
  if (!(CARRIED_REVIEW_INTERVALS as readonly number[]).includes(interval)) problems.push("reviewIntervalMonths");
  if (next && interval === 0) problems.push("reviewIntervalMonths: a review date needs an interval");
  // Required so a load can't start the reminder emails by leaving it out.
  if (!isRealIsoDate(m?.remindersStartOn)) problems.push("remindersStartOn");
  const manualPath = Array.isArray(m?.manualPath) ? m.manualPath.map(text) : [];
  if (!manualPath.length || manualPath.length > CARRIED_MAX_MANUAL_DEPTH || manualPath.some((p: string) => !p || p.length > 200)) problems.push("manualPath");
  const alsoFiledIn = Array.isArray(m?.alsoFiledIn) ? m.alsoFiledIn.map(text).filter(Boolean) : [];
  const convertedFrom = m?.convertedFrom ?? null;
  if (convertedFrom !== null && convertedFrom !== "doc" && convertedFrom !== "ppt") problems.push("convertedFrom");
  const originalFilename = text(m?.originalFilename) || null;
  const approvalRows = count(m?.approvalRows);
  const reviewRows = count(m?.reviewRows);
  const versionCount = count(m?.versionCount);
  if (approvalRows === null) problems.push("approvalRows");
  if (reviewRows === null) problems.push("reviewRows");
  if (versionCount === null) problems.push("versionCount");
  const minFree = m?.minFreeBytes ?? null;
  if (minFree !== null && !(Number.isFinite(Number(minFree)) && Number(minFree) >= 0)) problems.push("minFreeBytes");
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    value: {
      labId,
      expectedLabName,
      ownerUserId,
      batch,
      loadedBy,
      sourceSystem,
      sourceStatus: text(m?.sourceStatus) || null,
      docNumber: number as string,
      title,
      titleAsExported: text(m?.titleAsExported) || null,
      version,
      effectiveDate: m.effectiveDate,
      lastApprovalOrReview: last,
      nextReviewDue: next,
      reviewIntervalMonths: interval,
      remindersStartOn: m.remindersStartOn,
      author: text(m?.author) || null,
      approvalRows: approvalRows as number,
      reviewRows: reviewRows as number,
      versionCount: versionCount as number,
      manualPath,
      alsoFiledIn,
      convertedFrom,
      originalFilename,
      minFreeBytes: minFree === null ? null : Number(minFree),
    },
  };
}

// ── Review reminders ───────────────────────────────────────────────────────
export type ReviewReminderType = "30_day_warning" | "overdue" | "final";

/** The notice for a document this many days from its review date (negative = past due). The usual sequence. */
export function reminderTypeForDays(days: number): ReviewReminderType | null {
  if (days > 0 && days <= 30) return "30_day_warning";
  if (days === 0 || (days < 0 && days > -30)) return "overdue";
  if (days <= -30 && days > -60) return "final";
  return null;
}

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86400000;

/**
 * The days used to choose a notice. A document that arrived already past due counts from the day it arrived, not from its
 * old due date, so it starts at the overdue notice instead of skipping every notice because the date is months old. The
 * date the notice shows stays the real one. Every other document counts from its review date as usual.
 */
export function reminderDays(todayIso: string, dueIso: string, carriedLoadedOn?: string | null): number {
  const days = Math.round(dayNumber(dueIso) - dayNumber(todayIso));
  if (!carriedLoadedOn || !isRealIsoDate(carriedLoadedOn) || dueIso >= carriedLoadedOn) return days;
  return Math.max(days, Math.round(dayNumber(carriedLoadedOn) - dayNumber(todayIso)));
}
