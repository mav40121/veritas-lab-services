// client/src/lib/dateEntry.ts
//
// Pure helpers behind the shared DateEntry control (parking lot #78 with #75,
// 2026-10-07): the app stores dates as ISO yyyy-mm-dd strings; people type and
// read MM/DD/YYYY. Kept free of React so scripts/verify-date-entry-parse.ts can
// exercise every branch.
import { format, isValid, parse } from "date-fns";

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ISO yyyy-mm-dd -> MM/DD/YYYY for display; anything else -> "". */
export function isoToDisplay(iso: string | null | undefined): string {
  if (!iso || !ISO_DATE_RE.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

/** Keeps only digits as the person types and inserts the two slashes for them: "10072026" -> "10/07/2026". */
export function maskDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += "/" + digits.slice(2, 4);
  if (digits.length > 4) out += "/" + digits.slice(4, 8);
  return out;
}

const ACCEPTED_FORMATS = [
  "MM/dd/yyyy", "M/d/yyyy", "MM/dd/yy", "M/d/yy",
  "MM-dd-yyyy", "M-d-yyyy", "MM-dd-yy", "M-d-yy",
  "MMddyyyy", "yyyy-MM-dd", "yyyy/MM/dd",
];

/**
 * Parses what a person typed or pasted. Returns the ISO date, "" for an empty
 * entry, or null when the text is not a real calendar date (13/45/2026,
 * 02/29/2023). Years outside 1900-2100 are rejected as typos.
 */
export function parseLooseDate(text: string): string | null {
  const t = (text || "").trim();
  if (!t) return "";
  for (const f of ACCEPTED_FORMATS) {
    const d = parse(t, f, new Date(2000, 0, 1));
    // A format only counts when it reproduces the text exactly, so "10/7/26"
    // is read as M/d/yy (2026) and not as MM/dd/yyyy with the year 26; a
    // format that matches but lands outside 1900-2100 falls through to the
    // next one and finally to null.
    if (!isValid(d) || format(d, f) !== t) continue;
    const y = d.getFullYear();
    if (y < 1900 || y > 2100) continue;
    return format(d, "yyyy-MM-dd");
  }
  return null;
}

/** Local calendar date as ISO (not UTC), so "Today" is the lab's today. */
export function todayLocalISO(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/** ISO -> local Date at midnight (for the calendar), or undefined. */
export function isoToLocalDate(iso: string | null | undefined): Date | undefined {
  if (!iso || !ISO_DATE_RE.test(iso)) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  // new Date() rolls an impossible month or day forward; only a real date
  // reproduces its own parts.
  if (!isValid(dt) || dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return undefined;
  return dt;
}
